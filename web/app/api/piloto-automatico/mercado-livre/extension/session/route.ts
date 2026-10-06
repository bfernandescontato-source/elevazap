import { NextRequest, NextResponse } from "next/server";
import { encryptIntegrationSecret } from "@/lib/integration-crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { extensionCorsHeaders, requireMercadoLivreExtension } from "@/modules/offer-autopilot/server/mercado-livre-extension";

export function OPTIONS() { return new NextResponse(null, { status: 204, headers: extensionCorsHeaders }); }

const MAX_COOKIES = 120;
const MAX_BYTES = 24_000;

// A extensão manda a sessão Mercado Livre da conta conectada (cookies do
// navegador do afiliado). Fica criptografada e só serve para gerar meli.la pelo servidor.
export async function POST(request: NextRequest) {
  const integration = await requireMercadoLivreExtension(request);
  if (!integration) return NextResponse.json({ error: "Extensão não autorizada." }, { status: 401, headers: extensionCorsHeaders });
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return NextResponse.json({ error: "Sessão grande demais." }, { status: 413, headers: extensionCorsHeaders });
  let cookies: Record<string, string> = {};
  try {
    const body = JSON.parse(raw);
    for (const [name, value] of Object.entries(body?.cookies || {}).slice(0, MAX_COOKIES)) {
      if (/^[\w.\-]{1,100}$/.test(name) && typeof value === "string" && value.length <= 4096 && !/[\r\n;]/.test(value)) cookies[name] = value;
    }
  } catch { return NextResponse.json({ error: "Formato inválido." }, { status: 400, headers: extensionCorsHeaders }); }
  if (!cookies.ssid) return NextResponse.json({ error: "Entre no Mercado Livre neste navegador." }, { status: 422, headers: extensionCorsHeaders });
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin().from("affiliate_integrations").update({
    encrypted_session_cookies: encryptIntegrationSecret(JSON.stringify(cookies)), session_synced_at: now, session_status: "ok", updated_at: now
  }).eq("id", integration.id).eq("account_id", integration.account_id);
  if (error) return NextResponse.json({ error: "Não foi possível guardar a sessão." }, { status: 500, headers: extensionCorsHeaders });
  return NextResponse.json({ ok: true }, { headers: extensionCorsHeaders });
}
