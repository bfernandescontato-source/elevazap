import { NextRequest, NextResponse } from "next/server";
import { publicUrl } from "@/lib/public-url";
import { requireValidOrigin } from "@/lib/security";

export async function POST(request: NextRequest) {
  const originError = requireValidOrigin(request);
  if (originError) return originError;
  return NextResponse.redirect(publicUrl("/login?error=hubla-required", request), { status: 303 });
}
