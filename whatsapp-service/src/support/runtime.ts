import { supabase } from "../supabase.js";
import { createSupportSession, type SupportSession } from "./session.js";
import { handleIncomingMessages } from "./agent.js";

// Map of agentId → SupportSession
const sessions = new Map<string, SupportSession>();

async function startAgentSession(agent: any) {
  if (sessions.has(agent.id)) return;

  const session = await createSupportSession(agent.whatsapp_session_id, async (messages) => {
    await handleIncomingMessages(agent.id, agent, session.sock, messages);
  });

  sessions.set(agent.id, session);
  console.log(`[support] Session started for agent ${agent.id} (${agent.whatsapp_session_id})`);
}

function stopAgentSession(agentId: string) {
  const session = sessions.get(agentId);
  if (session) {
    session.stop();
    sessions.delete(agentId);
    console.log(`[support] Session stopped for agent ${agentId}`);
  }
}

export async function bootSupportRuntime() {
  const { data: agents } = await supabase
    .from("support_agent")
    .select("*")
    .eq("enabled", true);

  for (const agent of agents || []) {
    await startAgentSession(agent).catch((e) =>
      console.error(`[support] Failed to start session for agent ${agent.id}:`, e)
    );
  }
}

export async function reloadSupportAgent(agentId: string) {
  stopAgentSession(agentId);

  const { data: agent } = await supabase
    .from("support_agent")
    .select("*")
    .eq("id", agentId)
    .maybeSingle();

  if (agent?.enabled) {
    await startAgentSession(agent);
  }
}

export async function disconnectSupportSession(agentId: string) {
  const session = sessions.get(agentId);
  if (session) {
    await session.logout();
    sessions.delete(agentId);
  }
}

export function getSupportSessionStatus(agentId: string) {
  const session = sessions.get(agentId);
  if (!session) return { status: "disconnected", qr: "" };
  return { status: session.getStatus(), qr: session.getQr() };
}

export async function sendViaAgent(agentId: string, jid: string, text: string): Promise<string | null> {
  const session = sessions.get(agentId);
  if (!session || session.getStatus() !== "connected") throw new Error("Sessão não conectada.");
  const result = await session.sock.sendMessage(jid, { text });
  return result?.key?.id || null;
}

export async function startNewSupportSession(agentId: string, sessionId: string) {
  stopAgentSession(agentId);

  const { data: agent } = await supabase
    .from("support_agent")
    .select("*")
    .eq("id", agentId)
    .maybeSingle();

  if (!agent) throw new Error("Agente não encontrado.");

  await supabase.from("support_agent")
    .update({ whatsapp_session_id: sessionId, updated_at: new Date().toISOString() })
    .eq("id", agentId);

  const updatedAgent = { ...agent, whatsapp_session_id: sessionId };
  await startAgentSession(updatedAgent);
}
