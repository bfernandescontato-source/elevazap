import { createHash } from "crypto";

const ENDPOINT = "https://open-api.affiliate.shopee.com.br/graphql";
type ResponseBody = { data?: { generateShortLink?: { shortLink?: string } }; errors?: Array<{ message?: string; extensions?: { code?: number; message?: string } }> };

export async function testShopeeCredentials(appId: string, appSecret: string) {
  const query = 'mutation { generateShortLink(input: { originUrl: "https://shopee.com.br", subIds: ["disparei-connection-test"] }) { shortLink } }';
  const payload = JSON.stringify({ query });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHash("sha256").update(`${appId}${timestamp}${payload}${appSecret}`).digest("hex");
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}` },
    body: payload,
    signal: AbortSignal.timeout(10_000),
    cache: "no-store"
  });
  const body = await response.json() as ResponseBody;
  const error = body.errors?.[0];
  if (error) {
    const code = error.extensions?.code;
    if (code === 10020) throw new Error("Credenciais Shopee inválidas.");
    if (code === 10030 || response.status === 429) throw new Error("Limite de chamadas da Shopee atingido. Tente novamente mais tarde.");
    throw new Error("A Shopee recusou o teste de conexão.");
  }
  if (!body.data?.generateShortLink?.shortLink) throw new Error("A Shopee não confirmou a conexão.");
  return true;
}
