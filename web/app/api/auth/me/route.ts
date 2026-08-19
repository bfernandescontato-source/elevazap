import { NextResponse } from "next/server";
import { requireAccountContext } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const context = await requireAccountContext();
  if (context.error) return NextResponse.json({ authenticated: false, user: null });
  const { data: profile } = await context.database.from("app_users").select("name,email")
    .eq("id", context.session.userId).eq("account_id", context.accountId).single();
  const authUser = await supabaseAdmin().auth.admin.getUserById(context.session.userId!);
  const avatarPath = typeof authUser.data.user?.user_metadata?.avatar_path === "string" ? authUser.data.user.user_metadata.avatar_path : null;
  let avatarUrl: string | null = null;
  if (avatarPath) {
    const signed = await supabaseAdmin().storage.from("community-media").createSignedUrl(avatarPath, 3600);
    avatarUrl = signed.data?.signedUrl || null;
  }
  return NextResponse.json({ authenticated: true, user: {
    user_id: context.session.userId, email: profile?.email || context.session.email,
    name: profile?.name || null, avatar_url: avatarUrl, role: context.session.role
  } });
}
