import { NextRequest, NextResponse } from "next/server";
import { requireAccountContext } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const senderId = request.nextUrl.searchParams.get("sender_id");
  if (senderId) {
    const { data, error } = await supabaseAdmin().from("whatsapp_sender_grupos").select("group_jid,grupos(*)").eq("whatsapp_sender_id", senderId).eq("account_id", context.accountId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json((data || []).map((item: any) => item.grupos || { group_jid: item.group_jid }));
  }
  const { data, error } = await supabaseAdmin().from("grupos").select("*").eq("account_id", context.accountId).order("nome");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}
