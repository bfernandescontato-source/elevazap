import { supabase } from "../supabase.js";
import { env } from "../env.js";
import { callLLM, type LLMMessage } from "./llm.js";
import { SUPPORT_TOOLS, executeTool, type ToolContext } from "./tools.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const random = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

// In-memory aggregation timers: conversationId → timeout handle
const aggregationTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Track AI-sent wa_message_ids in memory (per session) to detect human takeover
const aiSentIds = new Set<string>();

export function markAiSent(waMessageId: string) {
  aiSentIds.add(waMessageId);
  // Prune after 2h to avoid unbounded growth
  setTimeout(() => aiSentIds.delete(waMessageId), 2 * 60 * 60 * 1000);
}

export function isAiSent(waMessageId: string) {
  return aiSentIds.has(waMessageId);
}

function extractText(msg: any): string {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    msg.message?.documentMessage?.caption ||
    ""
  );
}

function isIgnorable(jid: string): boolean {
  return jid.endsWith("@g.us") || jid === "status@broadcast" || jid.includes("@newsletter");
}

function isInBusinessHours(businessHours: any): boolean {
  if (!businessHours) return true;
  const now = new Date();
  const day = now.getDay(); // 0=Sunday
  const hour = now.getHours();
  const minute = now.getMinutes();
  const current = hour * 60 + minute;

  const schedule = businessHours[day];
  if (!schedule || !schedule.enabled) return false;

  const [startH, startM] = (schedule.start || "09:00").split(":").map(Number);
  const [endH, endM] = (schedule.end || "18:00").split(":").map(Number);
  const start = startH * 60 + startM;
  const end = endH * 60 + endM;
  return current >= start && current < end;
}

async function getOrCreateConversation(agentId: string, contactJid: string, contactName: string) {
  const { data: existing } = await supabase
    .from("support_conversation")
    .select("*")
    .eq("agent_id", agentId)
    .eq("contact_jid", contactJid)
    .maybeSingle();

  if (existing) return existing;

  const { data: created } = await supabase
    .from("support_conversation")
    .insert({
      agent_id: agentId,
      contact_jid: contactJid,
      contact_name: contactName,
      status: "ai_active",
      last_message_at: new Date().toISOString()
    })
    .select("*")
    .single();

  return created;
}

async function saveIncomingMessage(conversationId: string, waMessageId: string, content: string) {
  const { data, error } = await supabase
    .from("support_message")
    .insert({
      conversation_id: conversationId,
      wa_message_id: waMessageId,
      direction: "in",
      sender: "contact",
      content
    })
    .select("id")
    .maybeSingle();

  if (error?.code === "23505") return null; // duplicate wa_message_id
  if (error) throw error;
  return data;
}

async function processAggregation(conversationId: string, agentId: string, sock: any) {
  const { data: conv } = await supabase
    .from("support_conversation")
    .select("*, support_agent(*)")
    .eq("id", conversationId)
    .single();

  if (!conv) return;

  const agent = conv.support_agent;
  if (!agent?.enabled) return;

  // Skip if human has taken over or AI is paused
  if (conv.status === "human_active" || conv.status === "closed") return;
  if (conv.ai_paused_until && new Date(conv.ai_paused_until) > new Date()) return;

  // Check business hours
  if (!isInBusinessHours(agent.business_hours)) {
    if (agent.fallback_message) {
      const result = await sock.sendMessage(conv.contact_jid, { text: agent.fallback_message });
      const outId = result?.key?.id;
      if (outId) {
        markAiSent(outId);
        await supabase.from("support_message").insert({
          conversation_id: conversationId,
          wa_message_id: outId,
          direction: "out",
          sender: "ai",
          content: agent.fallback_message
        });
      }
    }
    return;
  }

  // Anti-loop: count consecutive AI messages without contact reply
  const { data: recentMessages } = await supabase
    .from("support_message")
    .select("sender")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(10);

  let consecutiveAi = 0;
  for (const m of (recentMessages || [])) {
    if (m.sender === "ai") consecutiveAi++;
    else break;
  }
  if (consecutiveAi >= 5) {
    console.warn(`[support] Anti-loop: ${conv.contact_jid} — parando após ${consecutiveAi} respostas consecutivas`);
    return;
  }

  // Fetch conversation history
  const { data: history } = await supabase
    .from("support_message")
    .select("wa_message_id,sender,content,created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(agent.max_history);

  // Fetch knowledge base
  const { data: kbEntries } = await supabase
    .from("support_kb")
    .select("title,content")
    .eq("agent_id", agentId);

  const kbText = (kbEntries || [])
    .map((kb) => `### ${kb.title}\n${kb.content}`)
    .join("\n\n");

  const systemPrompt = [
    agent.system_prompt,
    kbText ? `\n\n## Base de Conhecimento\n${kbText}` : ""
  ].join("").trim();

  const llmMessages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    ...(history || []).map((m) => ({
      role: (m.sender === "contact" ? "user" : "assistant") as "user" | "assistant",
      content: m.content
    }))
  ];

  // Opt-out keywords
  const lastUserMsg = (history || []).filter((m) => m.sender === "contact").at(-1)?.content?.toLowerCase() || "";
  const optOutKeywords = ["parar", "stop", "cancelar", "atendente", "humano", "pessoa", "ajuda humana"];
  if (optOutKeywords.some((k) => lastUserMsg.includes(k))) {
    await supabase.from("support_conversation")
      .update({ status: "human_active", updated_at: new Date().toISOString() })
      .eq("id", conversationId);

    const escalationMsg = "Vou transferir você para um de nossos atendentes. Aguarde um momento.";
    await sock.readMessages([{ remoteJid: conv.contact_jid, id: (history || []).at(-1)?.wa_message_id }]).catch(() => undefined);
    await sock.sendPresenceUpdate("composing", conv.contact_jid).catch(() => undefined);
    await sleep(random(1500, 3000));
    const result = await sock.sendMessage(conv.contact_jid, { text: escalationMsg });
    const outId = result?.key?.id;
    if (outId) {
      markAiSent(outId);
      await supabase.from("support_message").insert({
        conversation_id: conversationId,
        wa_message_id: outId,
        direction: "out",
        sender: "ai",
        content: escalationMsg
      });
    }

    if (env.SUPPORT_NOTIFY_JID) {
      await sock.sendMessage(env.SUPPORT_NOTIFY_JID, {
        text: `🚨 Atendimento solicitado por ${conv.contact_name || conv.contact_jid}`
      }).catch(() => undefined);
    }
    return;
  }

  // Show typing indicator
  await sock.readMessages([]).catch(() => undefined);
  await sock.sendPresenceUpdate("composing", conv.contact_jid).catch(() => undefined);

  // Call LLM with tool loop
  const toolCtx: ToolContext = {
    conversationId,
    contactJid: conv.contact_jid,
    notifyJid: env.SUPPORT_NOTIFY_JID,
    sock
  };

  let currentMessages = [...llmMessages];
  let finalText: string | null = null;
  let sideEffect: { type: string } | undefined;

  try {
    for (let turn = 0; turn < 5; turn++) {
      const result = await callLLM(agent.model, agent.temperature, currentMessages, SUPPORT_TOOLS);

      if (result.toolCalls.length === 0) {
        finalText = result.content;
        break;
      }

      // Execute each tool call
      const assistantToolMsg: LLMMessage = {
        role: "assistant",
        content: result.content || "",
      };
      currentMessages.push(assistantToolMsg);

      for (const tc of result.toolCalls) {
        const { result: toolResult, sideEffect: se } = await executeTool(tc.name, tc.args, toolCtx);
        if (se) sideEffect = se;
        currentMessages.push({
          role: "tool",
          content: toolResult,
          tool_call_id: tc.id,
          name: tc.name
        });
      }

      if (sideEffect?.type === "escalate" || sideEffect?.type === "close") {
        finalText = result.content;
        break;
      }
    }
  } catch (error: any) {
    const content = `Falha interna da IA: ${error.message}`;
    await supabase.from("support_message").insert({
      conversation_id: conversationId,
      wa_message_id: `ai_error_${Date.now()}`,
      direction: "out",
      sender: "ai",
      content
    });
    console.error(`[support] LLM error for ${conversationId}:`, error);
    return;
  }

  if (!finalText) return;

  // Humanized delay
  await sleep(random(1500, 4000));

  const sendResult = await sock.sendMessage(conv.contact_jid, { text: finalText });
  const outId = sendResult?.key?.id;

  if (outId) {
    markAiSent(outId);
    await supabase.from("support_message").insert({
      conversation_id: conversationId,
      wa_message_id: outId,
      direction: "out",
      sender: "ai",
      content: finalText
    });
  }

  await supabase.from("support_conversation")
    .update({ last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", conversationId);
}

export async function handleIncomingMessages(
  agentId: string,
  agent: any,
  sock: any,
  rawMessages: any[]
) {
  for (const msg of rawMessages) {
    try {
      const jid = msg.key?.remoteJid;
      if (!jid) continue;
      if (isIgnorable(jid)) continue;

      const waMessageId = msg.key?.id;
      if (!waMessageId) continue;

      const isFromMe = msg.key?.fromMe === true;
      console.log(`[support] message received jid=${jid} fromMe=${isFromMe} id=${waMessageId}`);

      if (isFromMe) {
        // Human takeover detection: fromMe message NOT sent by AI
        if (!isAiSent(waMessageId)) {
          const text = extractText(msg);
          if (!text) continue;

          // Find the conversation
          const { data: conv } = await supabase
            .from("support_conversation")
            .select("id, status")
            .eq("agent_id", agentId)
            .eq("contact_jid", jid)
            .maybeSingle();

          if (conv && conv.status !== "human_active") {
            const pauseUntil = new Date(Date.now() + agent.human_takeover_minutes * 60 * 1000).toISOString();
            await supabase.from("support_conversation").update({
              status: "human_active",
              ai_paused_until: pauseUntil,
              updated_at: new Date().toISOString()
            }).eq("id", conv.id);

            // Record the human-sent message
            await supabase.from("support_message").insert({
              conversation_id: conv.id,
              wa_message_id: waMessageId,
              direction: "out",
              sender: "human",
              content: text
            }).then(() => undefined);
          }
        }
        continue;
      }

      const text = extractText(msg);
      if (!text) {
        console.log(`[support] ignored empty message jid=${jid} id=${waMessageId}`);
        continue;
      }

      const pushName = msg.pushName || "";
      const conv = await getOrCreateConversation(agentId, jid, pushName);
      if (!conv) continue;

      // Save with idempotency (UNIQUE wa_message_id)
      const saved = await saveIncomingMessage(conv.id, waMessageId, text);
      if (!saved) continue; // already processed
      console.log(`[support] incoming saved conversation=${conv.id} jid=${jid}`);

      // Update last_message_at
      await supabase.from("support_conversation")
        .update({ last_message_at: new Date().toISOString(), contact_name: pushName || conv.contact_name, updated_at: new Date().toISOString() })
        .eq("id", conv.id);

      // Don't respond if human active or AI paused
      if (conv.status === "human_active" || conv.status === "closed") continue;
      if (conv.ai_paused_until && new Date(conv.ai_paused_until) > new Date()) continue;

      // Schedule aggregation window
      const existing = aggregationTimers.get(conv.id);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(async () => {
        aggregationTimers.delete(conv.id);
        await processAggregation(conv.id, agentId, sock).catch((e) =>
          console.error(`[support] aggregation error for ${conv.id}:`, e)
        );
      }, (agent.aggregation_seconds || 8) * 1000);

      aggregationTimers.set(conv.id, timer);
    } catch (e) {
      console.error("[support] handleIncomingMessages error:", e);
    }
  }
}
