import { COLETA_HORA_KEY, COLETA_HORA_PADRAO, COLETA_ULTIMA_KEY, CONNECT, ENVIO_KEY, GENERATE, IMPORT_CATALOG, VITRINE_BUSCA_SHOPEE, VITRINE_CAPTURAR, VITRINE_COLETA_AGORA, VITRINE_ENVIAR, VITRINE_STATUS, type CatalogProduct, type Config, type Job, type VitrineStatus } from "./shared.js";

const CONFIG_KEY = "dispareiMercadoLivre";
const LINK_BUILDER = "https://www.mercadolivre.com.br/afiliados/linkbuilder";
const POLL_ALARM = "disparei-ml-poll";
const SESSION_ALARM = "disparei-ml-session";
const COLETA_ALARM = "disparei-coleta-diaria";
let processing = false;
let coletando = false;

// Envia a sessão Mercado Livre (cookies deste navegador) para a Disparei, para o
// servidor gerar o meli.la com o computador do afiliado desligado. Só os cookies
// do próprio ML, guardados criptografados no servidor. Sem login no ML, não envia.
async function syncSession(config?: Config) {
  const current = config || (await getConfig());
  if (!current) return;
  const all = await chrome.cookies.getAll({ domain: "mercadolivre.com.br" }).catch(() => [] as chrome.cookies.Cookie[]);
  const cookies: Record<string, string> = {};
  for (const cookie of all) if (!(cookie.name in cookies)) cookies[cookie.name] = cookie.value;
  if (!cookies.ssid) return; // não logado no ML; nada a enviar
  await fetch(`${current.backendOrigin}/api/piloto-automatico/mercado-livre/extension/session`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${current.extensionToken}` }, body: JSON.stringify({ cookies })
  }).catch(() => undefined);
}

async function getConfig() { return (await chrome.storage.local.get(CONFIG_KEY))[CONFIG_KEY] as Config | undefined; }
async function ensurePolling() {
  const alarm = await chrome.alarms.get(POLL_ALARM);
  if (!alarm) chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
  const sessionAlarm = await chrome.alarms.get(SESSION_ALARM);
  if (!sessionAlarm) chrome.alarms.create(SESSION_ALARM, { periodInMinutes: 360 }); // reenvia a sessão a cada 6 h
  const coletaAlarm = await chrome.alarms.get(COLETA_ALARM);
  if (!coletaAlarm) chrome.alarms.create(COLETA_ALARM, { periodInMinutes: 20 }); // confere de 20 em 20 min se é hora da coleta
}

// Páginas de "ofertas do dia" que a coleta diária abre e lê. A Shopee do catálogo
// já é ao vivo; a Magalu entra junto com a área dela (link só pela Magazine Você).
const LOJAS_COLETA = [
  { url: "https://www.mercadolivre.com.br/ofertas", rota: "/api/catalog/mercado-livre/import", provider: "mercado_livre" as const },
  { url: "https://www.amazon.com.br/deals", rota: "/api/catalog/daily/import", provider: "AMAZON" as const }
];

const dinheiro = (value?: string) => {
  const match = String(value || "").match(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/);
  if (!match) return undefined;
  const parsed = Number(`${match[1].replace(/\./g, "")}.${match[2] || "0"}`);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const percentual = (value?: string) => { const n = Number(String(value || "").replace(/\D/g, "")); return n > 0 && n <= 100 ? n : undefined; };

/** Abre a página num aba escondida, pede os produtos ao content script e fecha. */
async function coletarDaPagina(url: string) {
  const tab = await chrome.tabs.create({ url, active: false });
  if (!tab.id) return [];
  try {
    for (let attempt = 0; attempt < 80; attempt += 1) { // espera a página carregar (até 20 s)
      await sleep(250);
      if ((await chrome.tabs.get(tab.id).catch(() => undefined))?.status === "complete") break;
    }
    await sleep(2500); // as lojas carregam os cards depois do "complete"
    let resposta: any;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try { resposta = await chrome.tabs.sendMessage(tab.id, { type: VITRINE_CAPTURAR }); break; }
      catch { await sleep(600); } // content script ainda subindo
    }
    return Array.isArray(resposta?.produtos) ? resposta.produtos : [];
  } finally { await chrome.tabs.remove(tab.id).catch(() => undefined); }
}

async function coletaDiaria(forcar = false) {
  if (coletando) return;
  const config = await getConfig();
  if (!config) return;
  if (!forcar) {
    const status = await vitrineStatus();
    if (!status.liberada) return;
    const hora = Number((await chrome.storage.local.get(COLETA_HORA_KEY))[COLETA_HORA_KEY] ?? COLETA_HORA_PADRAO);
    const hoje = new Date().toISOString().slice(0, 10);
    const ultima = (await chrome.storage.local.get(COLETA_ULTIMA_KEY))[COLETA_ULTIMA_KEY];
    // Só roda uma vez por dia, a partir da hora marcada. Se o aparelho estava
    // desligado na hora, o primeiro alarme/startup depois da hora já dispara (recuperação).
    if (ultima === hoje || new Date().getHours() < hora) return;
  }
  coletando = true;
  try {
    await chrome.storage.local.set({ [COLETA_ULTIMA_KEY]: new Date().toISOString().slice(0, 10) });
    for (const loja of LOJAS_COLETA) {
      const produtos = await coletarDaPagina(loja.url).catch(() => []);
      if (!produtos.length) continue;
      const agora = new Date().toISOString();
      if (loja.provider === "mercado_livre") {
        const payload: CatalogProduct[] = produtos.map((p: any) => ({
          ml_item_id: p.itemId, product_name: p.title, image_url: p.imageUrl || undefined,
          price: dinheiro(p.price), original_price: dinheiro(p.oldPrice), discount_rate: percentual(p.discount),
          product_link: p.originalUrl, sales: p.vendas || undefined, is_full: p.mercadoFull || false,
          free_shipping: p.freteGratis || false, badges: Array.isArray(p.badges) ? p.badges : undefined, captured_at: agora
        }));
        await api(config, loja.rota, { method: "POST", body: JSON.stringify(payload.slice(0, 500)) }).catch(() => undefined);
      } else {
        const offers = produtos.map((p: any) => ({
          external_item_id: p.itemId, name: p.title, image_url: p.imageUrl || undefined,
          price: dinheiro(p.price), original_price: dinheiro(p.oldPrice), discount_rate: percentual(p.discount),
          product_url: p.originalUrl, coupon: p.coupon || undefined, captured_at: agora
        }));
        await api(config, loja.rota, { method: "POST", body: JSON.stringify({ provider: loja.provider, offers: offers.slice(0, 500) }) }).catch(() => undefined);
      }
    }
  } finally { coletando = false; }
}
async function api(config: Config, path: string, init: RequestInit = {}) {
  const response = await fetch(`${config.backendOrigin}${path}`, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${config.extensionToken}`, ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "O Disparei recusou a operação.");
  return body;
}
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
// O Chrome só acorda a extensão a cada 30 s. Cada pedido de link vale 2 min no
// Disparei, então ao acordar a extensão esvazia a fila inteira (antes fazia 1 por
// vez e o resto vencia) e continua olhando a fila por mais um tempo enquanto há
// movimento. O limite de 4 min fica abaixo do corte de 5 min do Chrome.
const MAX_RUN_MS = 4 * 60_000;
const IDLE_WATCH_MS = 25_000;
const IDLE_POLL_MS = 3_000;

// Uma única aba escondida do Gerador é reaproveitada para toda a fila.
let builderTabId: number | undefined;
async function openBuilder() {
  if (builderTabId !== undefined) {
    const reused = await chrome.tabs.update(builderTabId, { url: LINK_BUILDER }).catch(() => undefined);
    if (reused?.id) return reused.id;
    builderTabId = undefined;
  }
  const tab = await chrome.tabs.create({ url: LINK_BUILDER, active: false });
  if (!tab.id) throw new Error("Não foi possível abrir o Gerador.");
  builderTabId = tab.id;
  return tab.id;
}
async function closeBuilder() {
  if (builderTabId === undefined) return;
  await chrome.tabs.remove(builderTabId).catch(() => undefined);
  builderTabId = undefined;
}
async function execute(job: Job) {
  const tabId = await openBuilder();
  // Na aba reaproveitada o status pode ainda ser "complete" da página anterior:
  // espera a recarga começar (até 1 s) antes de esperar ela terminar.
  let sawLoading = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(250);
    const status = (await chrome.tabs.get(tabId)).status;
    if (status !== "complete") sawLoading = true;
    else if (sawLoading || attempt >= 4) break;
  }
  const request = { type: GENERATE, inputUrl: job.input_url, affiliateTag: job.affiliate_tag };
  let result: any;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try { result = await chrome.tabs.sendMessage(tabId, request); break; }
    catch (error) { if (attempt === 7) throw error; await sleep(500); } // script da página ainda carregando
  }
  if (!result?.ok) throw new Error(result?.error || "Falha na geração.");
  return result as { affiliateLink: string; affiliateTag: string | null };
}
async function runJob(config: Config, job: Job) {
  try {
    const result = await execute(job);
    await api(config, `/api/piloto-automatico/mercado-livre/extension/jobs/${job.id}`, { method: "POST", body: JSON.stringify({ status: "completed", affiliate_link: result.affiliateLink, affiliate_tag: result.affiliateTag }) });
  } catch (error) {
    await closeBuilder(); // aba em estado ruim não é reaproveitada
    await api(config, `/api/piloto-automatico/mercado-livre/extension/jobs/${job.id}`, { method: "POST", body: JSON.stringify({ status: "failed", error_message: error instanceof Error ? error.message : "Falha no Mercado Livre." }) });
  }
}
async function poll() {
  if (processing) return;
  const config = await getConfig();
  if (!config) return;
  processing = true;
  try {
    const startedAt = Date.now();
    let lastJobAt = 0;
    while (Date.now() - startedAt < MAX_RUN_MS) {
      const { job } = await api(config, "/api/piloto-automatico/mercado-livre/extension/jobs");
      if (job) {
        await runJob(config, job);
        lastJobAt = Date.now();
        continue;
      }
      if (!lastJobAt || Date.now() - lastJobAt > IDLE_WATCH_MS) break;
      await sleep(IDLE_POLL_MS);
    }
  } finally {
    await closeBuilder();
    processing = false;
  }
}

// Vitrine: liberada por conta no painel (accounts.extensao_vitrine_enabled).
// A resposta fica guardada 15 min para cada aba de loja não bater no servidor.
const VITRINE_CACHE_KEY = "dispareiVitrineStatus";
const VITRINE_CACHE_MS = 15 * 60_000;
async function vitrineStatus(): Promise<VitrineStatus> {
  const config = await getConfig();
  if (!config) return { conectada: false, liberada: false, painel: "https://www.disparei.pro" };
  const cached = (await chrome.storage.local.get(VITRINE_CACHE_KEY))[VITRINE_CACHE_KEY] as (VitrineStatus & { em: number; token: string }) | undefined;
  if (cached && cached.token === config.extensionToken.slice(0, 8) && Date.now() - cached.em < VITRINE_CACHE_MS) return cached;
  let liberada = false;
  try { liberada = (await api(config, "/api/extensao/vitrine")).liberada === true; }
  catch { if (cached) return cached; } // servidor fora do ar: mantém a última resposta
  const status = { conectada: true, liberada, painel: config.backendOrigin };
  await chrome.storage.local.set({ [VITRINE_CACHE_KEY]: { ...status, em: Date.now(), token: config.extensionToken.slice(0, 8) } });
  return status;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === VITRINE_STATUS) {
    void vitrineStatus().then(sendResponse).catch(() => sendResponse({ conectada: false, liberada: false }));
    return true;
  }
  if (message?.type === VITRINE_COLETA_AGORA) {
    void coletaDiaria(true).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === VITRINE_ENVIAR) {
    void (async () => {
      const status = await vitrineStatus();
      if (!status.liberada) throw new Error("A Vitrine não está liberada para esta conta.");
      const itens = Array.isArray(message.itens) ? message.itens.slice(0, 500) : [];
      if (!itens.length) throw new Error("Carrinho vazio.");
      const modo = message.modo === "agora" ? "agora" : "lote";
      // A página /catalogo/extensao pede esse envio ao disparei-bridge assim que abre.
      await chrome.storage.local.set({ [ENVIO_KEY]: { modo, itens, criadoEm: Date.now() } });
      await chrome.tabs.create({ url: `${status.painel}/catalogo/extensao?modo=${modo}`, active: true });
      return { ok: true };
    })().then(sendResponse).catch(error => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Falha ao abrir a Disparei." }));
    return true;
  }
  if (message?.type === VITRINE_BUSCA_SHOPEE) {
    const tabId = sender.tab?.id;
    if (!tabId || !/^https:\/\/([a-z0-9-]+\.)?shopee\.com(\.br)?\//i.test(sender.tab?.url || "")) { sendResponse({ ok: false }); return false; }
    void chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["dist/shopee-page.js"] })
      .then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === IMPORT_CATALOG) {
    void (async () => {
      const config = await getConfig();
      if (!config) throw new Error("Conecte a extensão à Disparei antes de importar o catálogo.");
      const products = Array.isArray(message.products) ? message.products as CatalogProduct[] : [];
      if (!products.length) return { received: 0, inserted: 0, updated: 0, errors: 0 };
      return api(config, "/api/catalog/mercado-livre/import", { method: "POST", body: JSON.stringify(products.slice(0, 500)) });
    })().then(sendResponse).catch(error => sendResponse({ error: error instanceof Error ? error.message : "Falha ao importar catálogo." }));
    return true;
  }
  if (message?.type !== CONNECT) return false;
  void (async () => {
    const response = await fetch(`${message.backendOrigin}/api/piloto-automatico/mercado-livre/extension/connect`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nonce: message.nonce }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Não foi possível vincular a extensão.");
    await chrome.storage.local.remove(VITRINE_CACHE_KEY);
    const newConfig: Config = { backendOrigin: message.backendOrigin, extensionToken: body.extension_token, connectedAt: new Date().toISOString() };
    await chrome.storage.local.set({ [CONFIG_KEY]: newConfig });
    await ensurePolling();
    await syncSession(newConfig);
    await poll();
    return { ok: true };
  })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Falha na conexão." }));
  return true;
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) void poll();
  if (alarm.name === SESSION_ALARM) void syncSession();
  if (alarm.name === COLETA_ALARM) void coletaDiaria();
});
// Recuperação: ao ligar o aparelho, se a coleta do dia ainda não rodou e já passou da hora, roda.
chrome.runtime.onStartup.addListener(() => { void ensurePolling().then(poll); void syncSession(); void coletaDiaria(); });
chrome.runtime.onInstalled.addListener(() => { void ensurePolling().then(poll); void syncSession(); });
