import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

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
  const elevapayUrl = process.env.ELEVAPAY_API_URL;
  const elevapayKey = process.env.ELEVAPAY_API_KEY;

  if (!elevapayUrl || !elevapayKey) {
    return NextResponse.json({ error: "ElevaPay não configurado. Defina ELEVAPAY_API_URL e ELEVAPAY_API_KEY." }, { status: 503 });
  }

  try {
    const resp = await fetch(`${elevapayUrl}/orders/${refund.elevapay_order_id}/refund`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${elevapayKey}` },
      body: JSON.stringify({ reason: refund.reason, amount: refund.amount }),
      signal: AbortSignal.timeout(15_000)
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`ElevaPay retornou ${resp.status}: ${text}`);
    }

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
