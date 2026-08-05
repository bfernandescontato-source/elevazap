import { NextResponse } from "next/server";

// Tombstone kept so callers of the retired legacy integration get an explicit
// response instead of retrying indefinitely against a missing endpoint.
export async function POST() {
  return NextResponse.json({ error: "Integração legada desativada." }, { status: 410 });
}
