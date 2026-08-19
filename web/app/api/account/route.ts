import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAccountContext, requireValidOrigin } from "@/lib/security";
import { getSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getPlanLimits, getPlanLabel, UNLIMITED_SENDERS } from "@/lib/plans";

export async function GET() {
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const session = await getSession();

  const plan = context.account?.plan || "default";
  const limits = getPlanLimits(plan);
  const { data: profile } = await context.database.from("app_users")
    .select("name,email").eq("id", context.session.userId).eq("account_id", context.accountId).single();
  const authUser = await supabaseAdmin().auth.admin.getUserById(context.session.userId!);
  const avatarPath = typeof authUser.data.user?.user_metadata?.avatar_path === "string" ? authUser.data.user.user_metadata.avatar_path : null;
  let avatarUrl: string | null = null;
  if (avatarPath) {
    const { data } = await supabaseAdmin().storage.from("community-media").createSignedUrl(avatarPath, 3600);
    avatarUrl = data?.signedUrl || null;
  }

  const { count: senderCount } = await supabaseAdmin()
    .from("whatsapp_senders")
    .select("*", { count: "exact", head: true })
    .eq("account_id", context.accountId);

  return NextResponse.json({
    account: {
      name: profile?.name || null,
      email: profile?.email || session?.email || "",
      avatarUrl,
      role: session?.role === "admin" ? "Administrador" : "Operador",
      plan,
      planLabel: getPlanLabel(plan),
      status: context.account?.status || "active",
      accountName: context.account?.name || null,
    },
    limits: {
      maxSenders: limits.maxSenders,
      unlimitedSenders: limits.maxSenders >= UNLIMITED_SENDERS,
    },
    usage: {
      senders: senderCount ?? 0,
    },
    capabilities: {
      profileEditing: false,
      userManagement: session?.role === "admin",
      passwordChange: session?.source === "supabase",
      billing: true,
    },
  });
}

export async function PATCH(request: NextRequest) {
  const origin = requireValidOrigin(request);
  if (origin) return origin;
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const parsed = z.object({
    name: z.string().trim().min(2, "Informe um nome com pelo menos 2 caracteres.").max(80),
    avatar_path: z.string().max(500).nullable().optional()
  }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Perfil inválido." }, { status: 400 });
  if (parsed.data.avatar_path && !parsed.data.avatar_path.startsWith(`community/${context.accountId}/${context.session.userId}/`)) {
    return NextResponse.json({ error: "Foto de perfil inválida." }, { status: 400 });
  }
  const { data, error } = await context.database.from("app_users").update({ name: parsed.data.name, updated_at: new Date().toISOString() })
    .eq("id", context.session.userId).eq("account_id", context.accountId)
    .select("name,email").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const currentAuth = await supabaseAdmin().auth.admin.getUserById(context.session.userId!);
  const currentMetadata = currentAuth.data.user?.user_metadata || {};
  const avatarPath = "avatar_path" in parsed.data ? parsed.data.avatar_path || null : currentMetadata.avatar_path || null;
  const authUpdate = await supabaseAdmin().auth.admin.updateUserById(context.session.userId!, {
    user_metadata: { ...currentMetadata, name: parsed.data.name, avatar_path: avatarPath }
  });
  if (authUpdate.error) return NextResponse.json({ error: "O nome foi salvo, mas não foi possível vincular a foto." }, { status: 500 });
  let avatarUrl: string | null = null;
  if (avatarPath) {
    const signed = await supabaseAdmin().storage.from("community-media").createSignedUrl(avatarPath, 3600);
    avatarUrl = signed.data?.signedUrl || null;
  }
  return NextResponse.json({ profile: { name: data.name, email: data.email, avatarUrl } });
}
