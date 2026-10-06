// Gera o meli.la pelo servidor, com a sessão Mercado Livre do próprio afiliado
// (cookies enviados pela extensão, guardados criptografados). É a mesma chamada
// que o Gerador de links do ML faz no navegador; assim o Piloto converte mesmo
// com o computador do afiliado desligado. Sem sessão válida, quem chama cai na
// fila da extensão.
const CREATE_LINK = "https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink";
const LINK_BUILDER = "https://www.mercadolivre.com.br/afiliados/linkbuilder";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const TIMEOUT_MS = 12_000;

export class MercadoLivreSessionError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

/** Cookies vêm como { nome: valor }; só nomes e valores seguros entram no cabeçalho. */
export function cookieHeader(cookies) {
  return Object.entries(cookies || {})
    .filter(([name, value]) => /^[\w.\-]+$/.test(name) && typeof value === "string" && !/[\r\n;]/.test(value))
    .map(([name, value]) => `${name}=${value}`).join("; ");
}

export async function createMercadoLivreLinkWithSession({ cookies, productUrl, tag, fetcher = fetch }) {
  if (!tag) throw new MercadoLivreSessionError("Etiqueta de afiliado desconhecida.", "NO_TAG");
  const header = cookieHeader(cookies);
  if (!header || !cookies.ssid) throw new MercadoLivreSessionError("Sem sessão Mercado Livre.", "SESSION_INVALID");
  // A API aceita a chamada só com os cookies (testado em produção). O x-csrf-token
  // vai junto quando o cookie _csrf existe, mas não é obrigatório — e nunca
  // buscamos a página do Gerador (num servidor ela redireciona e derrubaria a sessão à toa).
  let response;
  try {
    response = await fetcher(CREATE_LINK, {
      method: "POST",
      headers: {
        cookie: header, "content-type": "application/json", accept: "application/json", "user-agent": USER_AGENT,
        origin: "https://www.mercadolivre.com.br", referer: LINK_BUILDER, "accept-language": "pt-BR,pt;q=0.9",
        ...(cookies._csrf ? { "x-csrf-token": cookies._csrf } : {})
      },
      body: JSON.stringify({ urls: [productUrl], tag }),
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch { throw new MercadoLivreSessionError("O Mercado Livre não respondeu.", "UNAVAILABLE"); }
  if (response.status === 401 || response.status === 403 || (response.status >= 300 && response.status < 400)) {
    throw new MercadoLivreSessionError("Sessão Mercado Livre expirada.", "SESSION_INVALID");
  }
  const body = await response.json().catch(() => null);
  const item = body?.urls?.[0];
  const link = item?.created ? item.short_url : null;
  if (!response.ok || typeof link !== "string" || !/^https:\/\/meli\.la\/[A-Za-z0-9_-]+$/.test(link)) {
    // error_code 111 = produto fora do programa de afiliados; não é falha de sessão.
    throw new MercadoLivreSessionError(item?.message || "O Mercado Livre não gerou o link.", "REJECTED");
  }
  return link;
}
