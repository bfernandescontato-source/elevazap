import { requireTenantDatabase } from "./tenant-database";

export async function requireTenantSender(senderId?: string | null) {
  const tenant = await requireTenantDatabase();
  if (tenant.error) return tenant;
  let query = tenant.database.from("whatsapp_senders")
    .select("id,session_name,label,account_id")
    .eq("account_id", tenant.accountId);
  if (senderId) query = query.eq("id", senderId);
  const { data, error } = await query.order("created_at", { ascending: true }).limit(1).maybeSingle();
  return { ...tenant, sender: data, senderError: error };
}

