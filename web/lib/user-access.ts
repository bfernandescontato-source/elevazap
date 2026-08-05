import type { User } from "@supabase/supabase-js";
import { supabaseAdmin } from "./supabase";

export type AppUserProfile = {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "operator";
  status: "pending" | "active" | "disabled";
  account_id: string;
  accounts?: { status: "active" | "past_due" | "suspended" | "cancelled" | "expired" | "refunded"; plan: string; name: string } | { status: "active" | "past_due" | "suspended" | "cancelled" | "expired" | "refunded"; plan: string; name: string }[] | null;
  created_at?: string;
};

export async function getOrCreateUserProfile(user: User): Promise<AppUserProfile | null> {
  const admin = supabaseAdmin();
  const { data: existing } = await admin.from("app_users").select("id,email,name,role,status,created_at,account_id,accounts(status,plan,name)").eq("id", user.id).maybeSingle();
  if (existing) return existing as AppUserProfile;

  const metadataAccount = typeof user.user_metadata?.account_id === "string" ? user.user_metadata.account_id : null;
  if (!metadataAccount) return null;
  const { data, error } = await admin.from("app_users").upsert({
    id: user.id,
    email: String(user.email || "").toLowerCase(),
    name: typeof user.user_metadata?.name === "string" ? user.user_metadata.name.trim() || null : null,
    role: "admin", status: "active", approved_at: new Date().toISOString(), account_id: metadataAccount
  }).select("id,email,name,role,status,created_at,account_id,accounts(status,plan,name)").single();
  if (error) return null;
  return data as AppUserProfile;
}
