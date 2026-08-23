import { supabaseAdmin } from "@/lib/supabase";

export async function getOfficialFunnelSummary(hours = 24) {
  const safeHours = Math.min(Math.max(Math.trunc(hours) || 24, 1), 24 * 31);
  const since = new Date(Date.now() - safeHours * 60 * 60 * 1_000).toISOString();
  const admin = supabaseAdmin();

  const [{ data: runs, error: runsError }, { data: messages, error: messagesError }] = await Promise.all([
    admin.from("official_flow_runs")
      .select("id,phone,status,initial_meta_message_id,final_meta_message_id,created_at,clicked_at,completed_at,final_link_clicked_at,joined_group_at,joined_group_jid,official_flows(name)")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5_000),
    admin.from("official_messages")
      .select("meta_message_id,status")
      .gte("created_at", since)
      .limit(10_000)
  ]);
  if (runsError) throw runsError;
  if (messagesError) throw messagesError;

  const messageStatus = new Map((messages || []).filter((message) => message.meta_message_id).map((message) => [message.meta_message_id as string, message.status as string]));
  const enriched = (runs || []).map((run) => ({
    ...run,
    initial_message_status: run.initial_meta_message_id ? messageStatus.get(run.initial_meta_message_id) || "accepted" : "accepted",
    final_message_status: run.final_meta_message_id ? messageStatus.get(run.final_meta_message_id) || "accepted" : null
  }));

  return {
    hours: safeHours,
    since,
    totals: {
      sent: enriched.length,
      delivered: enriched.filter((run) => run.initial_message_status === "delivered" || run.initial_message_status === "read").length,
      read: enriched.filter((run) => run.initial_message_status === "read").length,
      first_button_clicks: enriched.filter((run) => run.clicked_at).length,
      final_messages: enriched.filter((run) => run.final_meta_message_id || run.completed_at).length,
      final_link_clicks: enriched.filter((run) => run.final_link_clicked_at).length,
      group_joins: enriched.filter((run) => run.joined_group_at).length,
      failures: enriched.filter((run) => run.status === "failed" || run.initial_message_status === "failed" || run.final_message_status === "failed").length
    },
    recent: enriched.slice(0, 50)
  };
}
