import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { callWhatsappService } from "@/lib/whatsapp-service";

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "admin_action_ip");
  if (guard) return guard;

  const sb = supabaseAdmin();

  await callWhatsappService("/refresh-groups", { method: "POST" }).catch(() => undefined);

  const { data: senders } = await sb.from("whatsapp_senders").select("session_name");
  await Promise.all(
    (senders || []).map((s) =>
      callWhatsappService(`/senders/${s.session_name}/refresh-groups`, { method: "POST" }).catch(() => undefined)
    )
  );

  const { data, error } = await sb.from("grupos").select("*").order("nome");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}
