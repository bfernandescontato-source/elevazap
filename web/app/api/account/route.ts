import { NextResponse } from "next/server";
import { requireAccountContext } from "@/lib/security";
import { getSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getPlanLimits, getPlanLabel, UNLIMITED_SENDERS } from "@/lib/plans";

export async function GET() {
  const context = await requireAccountContext();
  if (context.error) return context.error;
  const session = await getSession();

  const plan = context.account?.plan || "default";
  const limits = getPlanLimits(plan);

  const { count: senderCount } = await supabaseAdmin()
    .from("whatsapp_senders")
    .select("*", { count: "exact", head: true })
    .eq("account_id", context.accountId);

  return NextResponse.json({
    account: {
      name: session?.name || null,
      email: session?.email || "",
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
