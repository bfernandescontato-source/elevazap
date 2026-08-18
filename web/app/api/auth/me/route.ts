import { NextResponse } from "next/server";
import { requireAccountContext } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const context = await requireAccountContext();
  if (context.error) return NextResponse.json({ authenticated: false, user: null });
  const { data: profile } = await context.database.from("app_users").select("name,email,avatar_path")
    .eq("id", context.session.userId).eq("account_id", context.accountId).single();
  let avatarUrl: string | null = null;
  if (profile?.avatar_path) {
    const signed = await supabaseAdmin().storage.from("community-media").createSignedUrl(profile.avatar_path, 3600);
    avatarUrl = signed.data?.signedUrl || null;
  }
  return NextResponse.json({ authenticated: true, user: {
    user_id: context.session.userId, email: profile?.email || context.session.email,
    name: profile?.name || null, avatar_url: avatarUrl, role: context.session.role
  } });
}
