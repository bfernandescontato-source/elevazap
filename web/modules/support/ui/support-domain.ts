export type Agent = {
  id: string; name: string; enabled: boolean; system_prompt: string;
  model: string; temperature: number; max_history: number;
  aggregation_seconds: number; human_takeover_minutes: number;
  business_hours: any; fallback_message: string; whatsapp_session_id: string;
};
export type KBEntry = { id: string; title: string; content: string };
export type Conversation = { id: string; contact_jid: string; contact_name: string; status: string; last_message_at: string; ai_paused_until: string | null };
export type Message = { id: string; direction: string; sender: string; content: string; created_at: string };
export type RefundRequest = {
  id: string; contact_jid: string; elevapay_order_id: string; amount: number | null; reason: string;
  status: string; created_at: string; customer_name?: string | null; customer_email?: string | null;
  support_conversation: { contact_name: string; contact_jid: string } | null;
};
export const fmt = (value: string) => new Date(value).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
export const statusLabel: Record<string, string> = { open: "Aberta", ai_active: "IA ativa", human_active: "Humano", closed: "Fechada" };
export const statusColor: Record<string, string> = { open: "bg-zinc-100 text-zinc-700", ai_active: "bg-blue-50 text-blue-700", human_active: "bg-amber-50 text-amber-700", closed: "bg-slate-100 text-slate-500" };

