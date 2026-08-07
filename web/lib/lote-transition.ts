import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation, requireAccountContext } from "./security";
import { supabaseAdmin } from "./supabase";

const inputSchema = z.object({ lote_id: z.string().uuid() });

const ACTION_STATUS: Record<string, { lote: string; envio: string; allowedLote: string[] }> = {
  cancel: { lote: "cancelado", envio: "cancelado", allowedLote: ["pendente", "processando", "programado"] },
  pause:  { lote: "pausado",   envio: "cancelado", allowedLote: ["pendente", "processando"] },
  resume: { lote: "pendente",  envio: "pendente",  allowedLote: ["pausado"] }
};

export async function transitionLote(request: NextRequest, action: "pause" | "resume" | "cancel") {
  const guard = await guardAdminMutation(request, "admin_action_ip");
  if (guard) return guard;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const parsed = inputSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Lote inválido." }, { status: 400 });

  const sb = supabaseAdmin();
  const { accountId } = context;
  const loteId = parsed.data.lote_id;
  const cfg = ACTION_STATUS[action];

  // Try RPC first, fall back to direct queries if it doesn't exist
  const { data, error } = await sb.rpc("transition_lote_atomic", { p_lote_id: loteId, p_action: action });
  const rpcMissing = error && (
    error.code === "PGRST202" || error.code === "42883" ||
    /could not find the function.*transition_lote_atomic/i.test(error.message || "")
  );

  if (!rpcMissing) {
    if (error) {
      const status = error.code === "P0002" ? 404 : error.code === "22023" ? 409 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json(data);
  }

  // Fallback: direct queries
  const { data: lote } = await sb.from("envios_grupo_lotes").select("id,status").eq("id", loteId).eq("account_id", accountId).maybeSingle();
  if (!lote) return NextResponse.json({ error: "Lote não encontrado." }, { status: 404 });
  if (!cfg.allowedLote.includes(lote.status || "")) {
    return NextResponse.json({ error: `Não é possível ${action} um lote com status "${lote.status}".` }, { status: 409 });
  }

  await sb.from("envios_grupo").update({ status: cfg.envio, updated_at: new Date().toISOString() })
    .eq("lote_id", loteId).eq("account_id", accountId).eq("status", "pendente");

  await sb.from("envios_grupo_lotes").update({ status: cfg.lote, updated_at: new Date().toISOString() })
    .eq("id", loteId).eq("account_id", accountId);

  return NextResponse.json({ ok: true });
}
