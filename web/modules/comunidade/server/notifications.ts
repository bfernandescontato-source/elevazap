import type { SupabaseClient } from "@supabase/supabase-js";
import { attachAuthors } from "./service";

export async function notify(admin: SupabaseClient, params: {
  recipientUserId: string | null; actorUserId: string; accountId: string; type: "like" | "comment"; postId: string;
}) {
  if (!params.recipientUserId || params.recipientUserId === params.actorUserId) return;
  const { error } = await admin.from("community_notifications").insert({
    recipient_user_id: params.recipientUserId, account_id: params.accountId,
    actor_user_id: params.actorUserId, type: params.type, post_id: params.postId
  });
  if (error) throw error;
}

export async function listNotifications(database: SupabaseClient, userId: string) {
  const { data, error } = await database.from("community_notifications")
    .select("id,type,post_id,actor_user_id,read_at,created_at")
    .eq("recipient_user_id", userId).order("created_at", { ascending: false }).limit(30);
  if (error) throw error;
  const rows = data || [];
  const authors = await attachAuthors(database, rows.map((row) => ({ user_id: row.actor_user_id })));
  const notifications = rows.map((row) => ({
    ...row, actor: { user_id: row.actor_user_id, ...(authors.get(row.actor_user_id || "") || { name: null, email: null }) }
  }));
  return { notifications, unread_count: rows.filter((row) => !row.read_at).length };
}

export async function markRead(database: SupabaseClient, userId: string, id?: string) {
  let query = database.from("community_notifications").update({ read_at: new Date().toISOString() }).eq("recipient_user_id", userId).is("read_at", null);
  if (id) query = query.eq("id", id);
  const { error } = await query;
  if (error) throw error;
}
