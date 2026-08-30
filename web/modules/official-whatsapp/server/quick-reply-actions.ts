import { supabaseAdmin } from "@/lib/supabase";

export type ButtonConfig =
  | { type: "url"; text: string; url: string }
  | { type: "quick_reply"; text: string; payload: string };

export type QuickReplyAction = {
  id: string;
  payload: string;
  button_label: string | null;
  response_type: "text" | "image" | "video" | "audio" | "document";
  response_text: string | null;
  media_bucket: string | null;
  media_path: string | null;
  mime_type: string | null;
  file_name: string | null;
  caption: string | null;
  button_config: ButtonConfig | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export async function listQuickReplyActions(): Promise<QuickReplyAction[]> {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_quick_reply_actions").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).filter((action) => !action.payload.startsWith("flow-private:"));
}

export async function findActiveQuickReplyAction(payload: string): Promise<QuickReplyAction | null> {
  if (payload.startsWith("flow-private:") || payload.startsWith("automation:")) return null;
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_quick_reply_actions").select("*").eq("payload", payload).eq("active", true).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createQuickReplyAction(input: {
  payload: string;
  buttonLabel: string | null;
  responseType: QuickReplyAction["response_type"];
  responseText: string | null;
  mediaBucket: string | null;
  mediaPath: string | null;
  mimeType: string | null;
  fileName: string | null;
  caption: string | null;
  buttonConfig: ButtonConfig | null;
  active: boolean;
}): Promise<QuickReplyAction> {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_quick_reply_actions").upsert({
    payload: input.payload,
    button_label: input.buttonLabel,
    response_type: input.responseType,
    response_text: input.responseText,
    media_bucket: input.mediaBucket,
    media_path: input.mediaPath,
    mime_type: input.mimeType,
    file_name: input.fileName,
    caption: input.caption,
    button_config: input.buttonConfig,
    active: input.active,
    updated_at: new Date().toISOString()
  }, { onConflict: "payload" }).select("*").single();
  if (error) throw error;
  return data;
}

export async function updateQuickReplyActionActive(id: string, active: boolean): Promise<QuickReplyAction> {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from("official_quick_reply_actions").update({ active, updated_at: new Date().toISOString() }).eq("id", id).select("*").single();
  if (error) throw error;
  return data;
}
