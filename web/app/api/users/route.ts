import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { guardAdminMutation, requireAccountContext, requireAdminRole } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const guard = await requireAdminRole();
  if (guard) return guard;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const { data, error } = await supabaseAdmin().from("app_users")
    .select("id,email,name,role,status,approved_at,created_at").eq("account_id", context.accountId)
    .order("created_at", { ascending: false }).limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ users: data || [] });
}

export async function PATCH(request: NextRequest) {
  const mutationGuard = await guardAdminMutation(request, "user_management_ip");
  if (mutationGuard) return mutationGuard;
  const roleGuard = await requireAdminRole();
  if (roleGuard) return roleGuard;
  const session = await getSession();
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const parsed = z.object({
    id: z.string().uuid(),
    status: z.enum(["active", "disabled"]).optional(),
    role: z.enum(["admin", "operator"]).optional()
  }).refine((value) => value.status || value.role).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Alteração inválida." }, { status: 400 });
  if (parsed.data.id === session?.userId && (parsed.data.status === "disabled" || parsed.data.role === "operator")) {
    return NextResponse.json({ error: "Você não pode remover o próprio acesso administrativo." }, { status: 400 });
  }
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.status) {
    update.status = parsed.data.status;
    update.approved_at = parsed.data.status === "active" ? new Date().toISOString() : null;
    update.approved_by = parsed.data.status === "active" ? session?.userId : null;
  }
  if (parsed.data.role) update.role = parsed.data.role;
  const { data, error } = await supabaseAdmin().from("app_users").update(update).eq("id", parsed.data.id).eq("account_id", context.accountId)
    .select("id,email,name,role,status,approved_at,created_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ user: data });
}
