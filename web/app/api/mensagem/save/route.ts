import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { defaultApprovedPurchaseMessage } from "@/lib/message-template";

export async function GET() {
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const { data, error } = await supabaseAdmin().from("config").select("welcome_message").eq("account_id", context.accountId).limit(1).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    welcome_message: data?.welcome_message || defaultApprovedPurchaseMessage,
    webhook_url: `${env().NEXT_PUBLIC_APP_URL}/api/webhook/elevapay`,
    webhook_header: "x-elevapay-token"
  });
}

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "admin_action_ip");
  if (guard) return guard;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const { welcome_message } = await request.json();
  if (!welcome_message || String(welcome_message).length > 4000) return NextResponse.json({ error: "Mensagem inválida." }, { status: 400 });
  const sb = supabaseAdmin();
  const existing = await sb.from("config").select("id").eq("account_id", context.accountId).limit(1).maybeSingle();
  const result = existing.data?.id
    ? await sb.from("config").update({ welcome_message, updated_at: new Date().toISOString() }).eq("id", existing.data.id).eq("account_id", context.accountId)
    : await sb.from("config").insert({ welcome_message, account_id: context.accountId });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
