import { NextResponse } from "next/server";
import { getPlanLabel } from "@/lib/plans";
import { requireAccountContext } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { getAccountUiTheme, UI_THEME_COOKIE } from "@/lib/ui-theme";

export async function GET() {
  const context = await requireAccountContext(); if (context.error) return context.error;
  const theme = await getAccountUiTheme(context.accountId);
  // O cabeçalho do tema terra mostra nome, plano e foto; o clássico não usa.
  const profile = theme === "terra" ? await headerProfile(context) : null;
  const response = NextResponse.json({ theme, profile });
  response.cookies.set(UI_THEME_COOKIE, theme, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: false });
  return response;
}

async function headerProfile(context: Exclude<Awaited<ReturnType<typeof requireAccountContext>>, { error: NextResponse }>) {
  const [{ data: user }, auth] = await Promise.all([
    context.database.from("app_users").select("name,email").eq("id", context.session.userId).eq("account_id", context.accountId).maybeSingle(),
    supabaseAdmin().auth.admin.getUserById(context.session.userId!)
  ]);
  const avatarPath = auth.data.user?.user_metadata?.avatar_path;
  const avatar = typeof avatarPath === "string" ? await supabaseAdmin().storage.from("community-media").createSignedUrl(avatarPath, 3600) : null;
  return {
    name: user?.name || context.session.name || (user?.email || context.session.email).split("@")[0],
    planLabel: getPlanLabel(context.account?.plan || "default"),
    roleLabel: context.session.role === "admin" ? "Administrador" : "Operador",
    avatarUrl: avatar?.data?.signedUrl || null
  };
}
