import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guardInternalAdminMutation } from "@/lib/internal-admin";
import { replaceOfficialConnectionCredentials, rotateConnectionWebhookToken, testStoredOfficialConnection, updateOfficialConnection } from "@/modules/official-whatsapp/server/official-connections";
import { graphRequest } from "@/modules/official-whatsapp/server/meta-client";
import { resolveOfficialConnection } from "@/modules/official-whatsapp/server/official-connections";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardInternalAdminMutation(request, "official_connection_write");
  if (guard) return guard;
  try {
    const { id } = await params;
    z.string().uuid().parse(id);
    const body = await request.json();
    if (body.action === "test") await testStoredOfficialConnection(id);
    else if (body.action === "credentials") await replaceOfficialConnectionCredentials(id, body.credentials);
    else if (body.action === "webhook-token") return NextResponse.json({ verifyToken: await rotateConnectionWebhookToken(id) }, { headers: { "Cache-Control": "no-store" } });
    else if (body.action === "subscribe") {
      const config = await resolveOfficialConnection(id);
      await graphRequest(`/${config.wabaId}/subscribed_apps`, { method: "POST" }, id);
      await testStoredOfficialConnection(id);
    } else {
      const input = z.object({ label: z.string().trim().min(2).max(80).optional(), status: z.enum(["connected", "disabled"]).optional() }).strict().parse(body);
      await updateOfficialConnection(id, input);
      if (input.status === "connected") await testStoredOfficialConnection(id);
    }
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? "Dados inválidos." : error instanceof Error ? error.message : "Não foi possível atualizar a conta." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
