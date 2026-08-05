import { NextResponse } from "next/server";
import { requireAccountContext } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { callWhatsappService } from "@/lib/whatsapp-service";
import { maskPhone } from "@/lib/phone";

function maskedPhone(value?: string) {
  if (!value) return "";
  try { return maskPhone(value); } catch { return `•••• ${value.slice(-4)}`; }
}

export async function GET() {
  const context = await requireAccountContext();
  if (context.error) return context.error;

  const sb = supabaseAdmin();
  const [campaigns, groups, senders] = await Promise.all([
    sb.from("campanhas").select("id", { count: "exact", head: true }).eq("account_id", context.accountId),
    sb.from("grupos").select("id", { count: "exact", head: true }).eq("account_id", context.accountId),
    sb.from("whatsapp_senders").select("session_name").eq("account_id", context.accountId)
  ]);

  const additionalStatuses = await Promise.all((senders.data || []).map((sender) =>
    callWhatsappService(`/senders/${sender.session_name}/status`).catch(() => ({ status: "disconnected", phone_number: "" }))
  ));
  const connectedAdditional = additionalStatuses.filter((sender) => sender.status === "connected");
  const firstConnectedPhone = connectedAdditional.find((sender) => sender.phone_number)?.phone_number;

  return NextResponse.json({
    connection: {
      connected: connectedAdditional.length > 0,
      count: connectedAdditional.length,
      phone: maskedPhone(firstConnectedPhone)
    },
    counts: {
      campaigns: campaigns.count || 0,
      groups: groups.count || 0
    }
  });
}
