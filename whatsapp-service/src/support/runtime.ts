import { supabase } from "../supabase.js";
import { createSupportSession, type SupportSession } from "./session.js";
import { handleIncomingMessages } from "./agent.js";

type ManagedSupportSession = {
  agent: any;
  session: SupportSession;
};

// Map of agentId → current agent config + WhatsApp session
const sessions = new Map<string, ManagedSupportSession>();

async function startAgentSession(agent: any) {
  if (sessions.has(agent.id)) return;

  const session = await createSupportSession(agent.whatsapp_session_id, async (messages) => {
    const current = sessions.get(agent.id);
    await handleIncomingMessages(agent.id, current?.agent || agent, session.sock, messages);
  });

  sessions.set(agent.id, { agent, session });
  console.log(`[support] Session started for agent ${agent.id} (${agent.whatsapp_session_id})`);
}

function stopAgentSession(agentId: string) {
  const managed = sessions.get(agentId);
  if (managed) {
    managed.session.stop();
    sessions.delete(agentId);
    console.log(`[support] Session stopped for agent ${agentId}`);
  }
}

export async function bootSupportRuntime() {
  const { data: agents } = await supabase
    .from("support_agent")
    .select("*");

  for (const agent of agents || []) {
    await startAgentSession(agent).catch((e) =>
      console.error(`[support] Failed to start session for agent ${agent.id}:`, e)
    );
  }
}

export async function reloadSupportAgent(agentId: string) {
  const { data: agent } = await supabase
    .from("support_agent")
    .select("*")
    .eq("id", agentId)
    .maybeSingle();

  if (!agent) {
    stopAgentSession(agentId);
    return;
  }

  const managed = sessions.get(agentId);
  if (managed) {
    if (managed.session.sessionId === agent.whatsapp_session_id) {
      managed.agent = agent;
      console.log(`[support] Agent config reloaded without disconnect ${agentId}`);
      return;
    }
    stopAgentSession(agentId);
  }

  await startAgentSession(agent);
}

export async function disconnectSupportSession(agentId: string) {
  const managed = sessions.get(agentId);
  if (managed) {
    await managed.session.logout();
    sessions.delete(agentId);
  }
}

export function getSupportSessionStatus(agentId: string) {
  const managed = sessions.get(agentId);
  if (!managed) return { status: "disconnected", qr: "" };
  return { status: managed.session.getStatus(), qr: managed.session.getQr() };
}

export async function sendViaAgent(agentId: string, jid: string, text: string): Promise<string | null> {
  const managed = sessions.get(agentId);
  if (!managed || managed.session.getStatus() !== "connected") throw new Error("Sessão não conectada.");
  const result = await managed.session.sock.sendMessage(jid, { text });
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
