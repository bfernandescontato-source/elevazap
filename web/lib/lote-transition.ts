import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation, requireAccountContext } from "./security";
import { supabaseAdmin } from "./supabase";

const inputSchema = z.object({ lote_id: z.string().uuid() });

export async function transitionLote(request: NextRequest, action: "pause" | "resume" | "cancel") {
  const guard = await guardAdminMutation(request, "admin_action_ip");
  if (guard) return guard;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const parsed = inputSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Campanha inválida." }, { status: 400 });
  const sb = supabaseAdmin();
  const { data: lote } = await sb.from("envios_grupo_lotes").select("id").eq("id", parsed.data.lote_id).eq("account_id", context.accountId).maybeSingle();
  if (!lote) return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });
  const { data, error } = await sb.rpc("transition_lote_atomic", {
    p_lote_id: parsed.data.lote_id,
    p_action: action
  });
  if (error) {
    const status = error.code === "P0002" ? 404 : error.code === "22023" ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json(data);
}
