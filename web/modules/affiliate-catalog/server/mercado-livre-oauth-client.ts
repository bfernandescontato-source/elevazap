import { env } from "@/lib/env";

const AUTH_BASE = "https://auth.mercadolivre.com.br";
const API = "https://api.mercadolibre.com";

export type MercadoLivreTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  user_id?: number;
  refresh_token: string;
};

function config() {
  const e = env();
  if (!e.MERCADO_LIVRE_CLIENT_ID || !e.MERCADO_LIVRE_CLIENT_SECRET || !e.MERCADO_LIVRE_REDIRECT_URI) {
    throw new Error("MERCADO_LIVRE_OAUTH_NOT_CONFIGURED");
  }
  return { clientId: e.MERCADO_LIVRE_CLIENT_ID, clientSecret: e.MERCADO_LIVRE_CLIENT_SECRET, redirectUri: e.MERCADO_LIVRE_REDIRECT_URI };
}

export function buildMercadoLivreAuthorizationUrl(state: string) {
  const { clientId, redirectUri } = config();
  const url = new URL("/authorization", AUTH_BASE);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

async function tokenRequest(body: Record<string, string>): Promise<MercadoLivreTokenResponse> {
  let response: Response;
  try {
    response = await fetch(`${API}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(10_000)
    });
  } catch {
    throw new Error("MERCADO_LIVRE_UNAVAILABLE");
  }
  if (!response.ok) throw new Error("MERCADO_LIVRE_OAUTH_TOKEN_REQUEST_FAILED");
  return response.json() as Promise<MercadoLivreTokenResponse>;
}

export function exchangeMercadoLivreCode(code: string) {
  const { clientId, clientSecret, redirectUri } = config();
  return tokenRequest({ grant_type: "authorization_code", client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri });
}

export function refreshMercadoLivreToken(refreshToken: string) {
  const { clientId, clientSecret } = config();
  return tokenRequest({ grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken });
}
