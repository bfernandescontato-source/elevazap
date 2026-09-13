const AMAZON_BR_HOSTS = new Set(["amazon.com.br", "www.amazon.com.br"]);
// amzlink.me e amzlinks.in não são operados pela Amazon, mas foram verificados
// manualmente: cada um redireciona em um único salto direto para amazon.com.br (às
// vezes já com a tag de afiliado de outra conta, que addAmazonPartnerTag substitui).
// Confiados explicitamente a pedido do usuário, um de cada vez — não adicione outros
// domínios de terceiros aqui sem antes confirmar o mesmo comportamento (deve ir direto
// pra AMAZON_BR_HOSTS, sem saltos intermediários para domínios desconhecidos).
const AMAZON_SHORT_HOSTS = new Set(["amzn.to", "a.co", "link.amazon", "amzlink.me", "amzlinks.in"]);
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 7_000;

function parseAllowedInput(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error("Cole um link válido da Amazon."); }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("Cole um link HTTPS válido da Amazon.");
  if (!AMAZON_BR_HOSTS.has(hostname) && !AMAZON_SHORT_HOSTS.has(hostname)) throw new Error("Use um link amazon.com.br ou um link curto oficial da Amazon.");
  return url;
}

function assertAllowedRedirect(value, base) {
  let url;
  try { url = new URL(value, base); }
  catch { throw new Error("O link curto da Amazon retornou um destino inválido."); }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("O redirecionamento da Amazon não é seguro.");
  if (!AMAZON_BR_HOSTS.has(hostname) && !AMAZON_SHORT_HOSTS.has(hostname)) throw new Error("O link curto não direcionou para a Amazon Brasil.");
  return url;
}

export function isAmazonUrl(value) {
  try {
    const url = parseAllowedInput(value);
    return AMAZON_BR_HOSTS.has(url.hostname.toLowerCase()) || AMAZON_SHORT_HOSTS.has(url.hostname.toLowerCase());
  } catch { return false; }
}

export function addAmazonPartnerTag(value, partnerTag) {
  const url = parseAllowedInput(value);
  if (!AMAZON_BR_HOSTS.has(url.hostname.toLowerCase())) throw new Error("Resolva o link curto antes de converter.");
  for (const key of Array.from(url.searchParams.keys())) if (key.toLowerCase() === "tag") url.searchParams.delete(key);
  url.searchParams.set("tag", partnerTag);
  return url.toString();
}

export function validateAmazonAffiliateUrl(value, partnerTag) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !AMAZON_BR_HOSTS.has(url.hostname.toLowerCase()) || url.username || url.password || url.port) return false;
    const tags = Array.from(url.searchParams.entries()).filter(([key]) => key.toLowerCase() === "tag").map(([, tag]) => tag);
    return tags.length === 1 && tags[0] === partnerTag;
  } catch { return false; }
}

export async function resolveAmazonUrl(value, fetcher = fetch) {
  let current = parseAllowedInput(value);
  if (AMAZON_BR_HOSTS.has(current.hostname.toLowerCase())) return current.toString();
  for (let redirects = 0; redirects < MAX_REDIRECTS; redirects += 1) {
    let response;
    try {
      response = await fetcher(current.toString(), { method: "GET", redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: { "user-agent": "Disparei/1.0 (+https://www.disparei.pro)" } });
    } catch { throw new Error("Não foi possível resolver o link curto da Amazon."); }
    response.body?.cancel().catch(() => undefined);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("O link curto da Amazon não informou o destino.");
      current = assertAllowedRedirect(location, current);
      if (AMAZON_BR_HOSTS.has(current.hostname.toLowerCase())) return current.toString();
      continue;
    }
    throw new Error("Não foi possível resolver o link curto da Amazon.");
  }
  throw new Error("O link curto da Amazon excedeu o limite de redirecionamentos.");
}

export async function convertAmazonLink(value, partnerTag, fetcher = fetch) {
  if (!partnerTag) throw new Error("Configure seu ID de Associado Amazon antes de converter.");
  const resolvedUrl = await resolveAmazonUrl(value, fetcher);
  const affiliateUrl = addAmazonPartnerTag(resolvedUrl, partnerTag);
  if (!validateAmazonAffiliateUrl(affiliateUrl, partnerTag)) throw new Error("Não foi possível confirmar a conversão do link Amazon.");
  return { affiliate_url: affiliateUrl, resolved_url: resolvedUrl };
}
