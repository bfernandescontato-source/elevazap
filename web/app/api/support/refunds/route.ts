import { NextResponse } from "next/server";
import { requireAccountContext } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const context = await requireAccountContext();
  if (context.error) return context.error;

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("refund_request")
    .select("*, support_conversation(contact_jid, contact_name)")
    .eq("account_id", context.accountId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ refunds: data || [] });
}
