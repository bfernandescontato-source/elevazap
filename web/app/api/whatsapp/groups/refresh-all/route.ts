import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { callWhatsappService } from "@/lib/whatsapp-service";

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "admin_action_ip");
  if (guard) return guard;
  const context = await requireAccountContext();
  if (context.error) return context.error;

  const sb = supabaseAdmin();

  const { data: senders } = await sb.from("whatsapp_senders").select("session_name").eq("account_id", context.accountId);
  await Promise.all(
    (senders || []).map((s) =>
      callWhatsappService(`/senders/${s.session_name}/refresh-groups`, { method: "POST" }).catch(() => undefined)
    )
  );

  const { data, error } = await sb.from("grupos").select("*").eq("account_id", context.accountId).order("nome");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}
