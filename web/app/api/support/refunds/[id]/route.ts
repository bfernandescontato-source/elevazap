import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import axios from "axios";
import { env } from "@/lib/env";

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await guardAdminMutation(request);
  if (guard) return guard;

  const { action } = await request.json();
  if (!["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "Ação inválida. Use 'approve' ou 'reject'." }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  const { data: refund } = await supabase
    .from("refund_request")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();

  if (!refund) return NextResponse.json({ error: "Solicitação não encontrada." }, { status: 404 });
  if (refund.status !== "pending") return NextResponse.json({ error: "Solicitação já processada." }, { status: 409 });

  if (action === "reject") {
    await supabase.from("refund_request").update({
      status: "rejected",
      decided_by: "admin",
      decided_at: new Date().toISOString()
    }).eq("id", params.id);
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  // Approve: trigger real refund via ElevaPay
  const e = env();
  const elevapayUrl = process.env.ELEVAPAY_API_URL;
  const elevapayKey = process.env.ELEVAPAY_API_KEY;

  if (!elevapayUrl || !elevapayKey) {
    return NextResponse.json({ error: "ElevaPay não configurado. Defina ELEVAPAY_API_URL e ELEVAPAY_API_KEY." }, { status: 503 });
  }

  try {
    await axios.post(
      `${elevapayUrl}/orders/${refund.elevapay_order_id}/refund`,
      { reason: refund.reason, amount: refund.amount },
      { headers: { Authorization: `Bearer ${elevapayKey}` }, timeout: 15_000 }
    );

    await supabase.from("refund_request").update({
      status: "processed",
      decided_by: "admin",
      decided_at: new Date().toISOString()
    }).eq("id", params.id);

    return NextResponse.json({ ok: true, status: "processed" });
  } catch (err: any) {
    return NextResponse.json({ error: `Falha ao processar reembolso: ${err.message}` }, { status: 502 });
  }
}
