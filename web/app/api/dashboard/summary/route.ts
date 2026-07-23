import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { callWhatsappService } from "@/lib/whatsapp-service";
import { maskPhone } from "@/lib/phone";

function maskedPhone(value?: string) {
  if (!value) return "";
  try { return maskPhone(value); } catch { return `•••• ${value.slice(-4)}`; }
}

export async function GET() {
  const guard = await requireAdmin();
  if (guard) return guard;

  const sb = supabaseAdmin();
  const [campaigns, groups, senders, principal] = await Promise.all([
    sb.from("envios_grupo_lotes").select("id", { count: "exact", head: true }),
    sb.from("grupos").select("id", { count: "exact", head: true }),
    sb.from("whatsapp_senders").select("session_name"),
    callWhatsappService("/status").catch(() => ({ status: "disconnected", phone_number: "" }))
  ]);

  const additionalStatuses = await Promise.all((senders.data || []).map((sender) =>
    callWhatsappService(`/senders/${sender.session_name}/status`).catch(() => ({ status: "disconnected", phone_number: "" }))
  ));
  const connectedAdditional = additionalStatuses.filter((sender) => sender.status === "connected");
  const principalConnected = principal.status === "connected";
  const firstConnectedPhone = principalConnected
    ? principal.phone_number
    : connectedAdditional.find((sender) => sender.phone_number)?.phone_number;

  return NextResponse.json({
    connection: {
      connected: principalConnected || connectedAdditional.length > 0,
      count: (principalConnected ? 1 : 0) + connectedAdditional.length,
      phone: maskedPhone(firstConnectedPhone)
    },
    counts: {
      campaigns: campaigns.count || 0,
      groups: groups.count || 0
    }
  });
}
