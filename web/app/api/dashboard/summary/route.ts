import { NextResponse } from "next/server";
import { requireTenantDatabase } from "@/lib/tenant-database";
import { callWhatsappService } from "@/lib/whatsapp-service";
import { maskPhone } from "@/lib/phone";

function maskedPhone(value?: string) {
  if (!value) return "";
  try { return maskPhone(value); } catch { return `•••• ${value.slice(-4)}`; }
}

export async function GET() {
  const context = await requireTenantDatabase();
  if (context.error) return context.error;

  const sb = context.database;
  const statuses = ["pendente", "enfileirado", "processando", "sucesso", "erro", "incerto"] as const;
  const [campaigns, groups, senders, ...queueCounts] = await Promise.all([
    sb.from("campanhas").select("id", { count: "exact", head: true }).eq("account_id", context.accountId),
    sb.from("grupos").select("id", { count: "exact", head: true }).eq("account_id", context.accountId),
    sb.from("whatsapp_senders").select("session_name").eq("account_id", context.accountId),
    ...statuses.flatMap((status) => ["envios", "envios_grupo"].map((table) =>
      sb.from(table).select("id", { count: "exact", head: true }).eq("account_id", context.accountId).eq("status", status)
    ))
  ]);

  const additionalStatuses = await Promise.all((senders.data || []).map((sender) =>
    callWhatsappService(`/senders/${sender.session_name}/status`).catch(() => ({ status: "disconnected", phone_number: "" }))
  ));
  const connectedAdditional = additionalStatuses.filter((sender) => sender.status === "connected");
  const firstConnectedPhone = connectedAdditional.find((sender) => sender.phone_number)?.phone_number;

  const queue = Object.fromEntries(statuses.map((status, index) => [status,
    (queueCounts[index * 2]?.count || 0) + (queueCounts[index * 2 + 1]?.count || 0)
  ]));

  return NextResponse.json({
    connection: {
      connected: connectedAdditional.length > 0,
      count: connectedAdditional.length,
      phone: maskedPhone(firstConnectedPhone)
    },
    counts: {
      campaigns: campaigns.count || 0,
      groups: groups.count || 0
    },
    queue
  });
}
