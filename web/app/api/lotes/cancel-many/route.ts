import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guardAdminMutation, requireAccountContext } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

const inputSchema = z.object({ lote_ids: z.array(z.string().uuid()).min(1).max(200) });

export async function POST(request: NextRequest) {
  const guard = await guardAdminMutation(request, "admin_action_ip");
  if (guard) return guard;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const parsed = inputSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Selecione entre 1 e 200 agendamentos." }, { status: 400 });

  const loteIds = Array.from(new Set(parsed.data.lote_ids));
  const sb = supabaseAdmin();
  const { data: batches, error } = await sb.from("envios_grupo_lotes").select("id,status")
    .eq("account_id", context.accountId).in("id", loteIds);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if ((batches || []).length !== loteIds.length) return NextResponse.json({ error: "Um ou mais agendamentos não foram encontrados." }, { status: 404 });

  const cancelled: string[] = [];
  const skipped: string[] = [];
  for (const batch of batches || []) {
    if (["sucesso", "erro", "cancelado", "parcial", "concluido_com_erros"].includes(batch.status || "")) {
      skipped.push(batch.id);
      continue;
    }
    const { error: cancelError } = await sb.rpc("transition_lote_atomic", { p_lote_id: batch.id, p_action: "cancel" });
    if (cancelError) return NextResponse.json({ error: `Falha ao cancelar os agendamentos selecionados: ${cancelError.message}`, cancelled, skipped }, { status: 409 });
    cancelled.push(batch.id);
  }

  return NextResponse.json({ ok: true, cancelled, skipped });
}
