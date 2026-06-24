import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const guard = await requireAdmin();
  if (guard) return guard;

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("refund_request")
    .select("*, support_conversation(contact_jid, contact_name)")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ refunds: data || [] });
}
