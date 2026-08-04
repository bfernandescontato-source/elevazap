import type { User } from "@supabase/supabase-js";
import { supabaseAdmin } from "./supabase";

export type AppUserProfile = {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "operator";
  status: "pending" | "active" | "disabled";
  created_at?: string;
};

export async function getOrCreateUserProfile(user: User): Promise<AppUserProfile | null> {
  const admin = supabaseAdmin();
  const { data: existing } = await admin.from("app_users").select("id,email,name,role,status,created_at").eq("id", user.id).maybeSingle();
  if (existing) return existing as AppUserProfile;

  const { count } = await admin.from("app_users").select("id", { count: "exact", head: true });
  const firstUser = Number(count || 0) === 0;
  const { data, error } = await admin.from("app_users").upsert({
    id: user.id,
    email: String(user.email || "").toLowerCase(),
    name: typeof user.user_metadata?.name === "string" ? user.user_metadata.name.trim() || null : null,
    role: firstUser ? "admin" : "operator",
    status: firstUser ? "active" : "pending",
    approved_at: firstUser ? new Date().toISOString() : null
  }).select("id,email,name,role,status,created_at").single();
  if (error) return null;
  return data as AppUserProfile;
}
