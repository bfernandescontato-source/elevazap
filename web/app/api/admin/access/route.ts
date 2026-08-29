import { NextResponse } from "next/server";
import { requireInternalAdmin } from "@/lib/internal-admin";

export async function GET() {
  const guard = await requireInternalAdmin();
  if (guard.error) return guard.error;
  return NextResponse.json({ admin: true });
}
