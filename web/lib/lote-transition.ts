import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { guardAdminMutation } from "./security";
import { supabaseAdmin } from "./supabase";

const inputSchema = z.object({ lote_id: z.string().uuid() });

export async function transitionLote(request: NextRequest, action: "pause" | "resume" | "cancel") {
  const guard = await guardAdminMutation(request, "admin_action_ip");
  if (guard) return guard;
  const parsed = inputSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Campanha inválida." }, { status: 400 });
  const { data, error } = await supabaseAdmin().rpc("transition_lote_atomic", {
    p_lote_id: parsed.data.lote_id,
    p_action: action
  });
  if (error) {
    const status = error.code === "P0002" ? 404 : error.code === "22023" ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json(data);
}
