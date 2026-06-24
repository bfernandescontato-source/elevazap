import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { supabaseAdmin } from "@/lib/supabase";
import { callWhatsappService } from "@/lib/whatsapp-service";

export async function GET() {
  const guard = await requireAdmin();
  if (guard) return guard;

  const supabase = supabaseAdmin();
  const { data: agent } = await supabase.from("support_agent").select("id").limit(1).maybeSingle();
  if (!agent) return NextResponse.json({ qr: "", status: "disconnected" });

  try {
    const data = await callWhatsappService(`/support/${agent.id}/status`);
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ qr: "", status: "disconnected" });
  }
}
