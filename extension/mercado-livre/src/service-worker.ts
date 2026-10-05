import { CONNECT, ENVIO_KEY, GENERATE, IMPORT_CATALOG, VITRINE_BUSCA_SHOPEE, VITRINE_ENVIAR, VITRINE_STATUS, type CatalogProduct, type Config, type Job, type VitrineStatus } from "./shared.js";

const CONFIG_KEY = "dispareiMercadoLivre";
const LINK_BUILDER = "https://www.mercadolivre.com.br/afiliados/linkbuilder";
const POLL_ALARM = "disparei-ml-poll";
let processing = false;

async function getConfig() { return (await chrome.storage.local.get(CONFIG_KEY))[CONFIG_KEY] as Config | undefined; }
async function ensurePolling() {
  const alarm = await chrome.alarms.get(POLL_ALARM);
  if (!alarm) chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
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
    await chrome.storage.local.set({ [CONFIG_KEY]: { backendOrigin: message.backendOrigin, extensionToken: body.extension_token, connectedAt: new Date().toISOString() } satisfies Config });
    await ensurePolling();
    await poll();
    return { ok: true };
  })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Falha na conexão." }));
  return true;
});
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === POLL_ALARM) void poll(); });
chrome.runtime.onStartup.addListener(() => { void ensurePolling().then(poll); });
chrome.runtime.onInstalled.addListener(() => { void ensurePolling().then(poll); });
