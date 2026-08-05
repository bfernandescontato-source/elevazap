import { NextRequest, NextResponse } from "next/server";
import { requireValidOrigin } from "@/lib/security";

export async function POST(request: NextRequest) {
  const originError = requireValidOrigin(request);
  if (originError) return originError;
  return NextResponse.redirect(new URL("/login?error=hubla-required", request.url), { status: 303 });
}
