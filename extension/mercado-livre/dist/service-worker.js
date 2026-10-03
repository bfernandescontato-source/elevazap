import { CONNECT, GENERATE, IMPORT_CATALOG } from "./shared.js";
const CONFIG_KEY = "dispareiMercadoLivre";
const LINK_BUILDER = "https://www.mercadolivre.com.br/afiliados/linkbuilder";
const POLL_ALARM = "disparei-ml-poll";
let processing = false;
async function getConfig() { return (await chrome.storage.local.get(CONFIG_KEY))[CONFIG_KEY]; }
async function ensurePolling() {
    const alarm = await chrome.alarms.get(POLL_ALARM);
    if (!alarm)
        chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
}
async function api(config, path, init = {}) {
    const response = await fetch(`${config.backendOrigin}${path}`, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${config.extensionToken}`, ...(init.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
        throw new Error(body.error || "O Disparei recusou a operação.");
    return body;
}
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
// O Chrome só acorda a extensão a cada 30 s. Cada pedido de link vale 2 min no
// Disparei, então ao acordar a extensão esvazia a fila inteira (antes fazia 1 por
// vez e o resto vencia) e continua olhando a fila por mais um tempo enquanto há
// movimento. O limite de 4 min fica abaixo do corte de 5 min do Chrome.
const MAX_RUN_MS = 4 * 60_000;
const IDLE_WATCH_MS = 25_000;
const IDLE_POLL_MS = 3_000;
// Uma única aba escondida do Gerador é reaproveitada para toda a fila.
let builderTabId;
async function openBuilder() {
    if (builderTabId !== undefined) {
        const reused = await chrome.tabs.update(builderTabId, { url: LINK_BUILDER }).catch(() => undefined);
        if (reused?.id)
            return reused.id;
        builderTabId = undefined;
    }
    const tab = await chrome.tabs.create({ url: LINK_BUILDER, active: false });
    if (!tab.id)
        throw new Error("Não foi possível abrir o Gerador.");
    builderTabId = tab.id;
    return tab.id;
}
async function closeBuilder() {
    if (builderTabId === undefined)
        return;
    await chrome.tabs.remove(builderTabId).catch(() => undefined);
    builderTabId = undefined;
}
async function execute(job) {
    const tabId = await openBuilder();
    // Na aba reaproveitada o status pode ainda ser "complete" da página anterior:
    // espera a recarga começar (até 1 s) antes de esperar ela terminar.
    let sawLoading = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
        await sleep(250);
        const status = (await chrome.tabs.get(tabId)).status;
        if (status !== "complete")
            sawLoading = true;
        else if (sawLoading || attempt >= 4)
            break;
    }
    const request = { type: GENERATE, inputUrl: job.input_url, affiliateTag: job.affiliate_tag };
    let result;
    for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
            result = await chrome.tabs.sendMessage(tabId, request);
            break;
        }
        catch (error) {
            if (attempt === 7)
                throw error;
            await sleep(500);
        } // script da página ainda carregando
    }
    if (!result?.ok)
        throw new Error(result?.error || "Falha na geração.");
    return result;
}
async function runJob(config, job) {
    try {
        const result = await execute(job);
        await api(config, `/api/piloto-automatico/mercado-livre/extension/jobs/${job.id}`, { method: "POST", body: JSON.stringify({ status: "completed", affiliate_link: result.affiliateLink, affiliate_tag: result.affiliateTag }) });
    }
    catch (error) {
        await closeBuilder(); // aba em estado ruim não é reaproveitada
        await api(config, `/api/piloto-automatico/mercado-livre/extension/jobs/${job.id}`, { method: "POST", body: JSON.stringify({ status: "failed", error_message: error instanceof Error ? error.message : "Falha no Mercado Livre." }) });
    }
}
async function poll() {
    if (processing)
        return;
    const config = await getConfig();
    if (!config)
        return;
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
            if (!lastJobAt || Date.now() - lastJobAt > IDLE_WATCH_MS)
                break;
            await sleep(IDLE_POLL_MS);
        }
    }
    finally {
        await closeBuilder();
        processing = false;
    }
}
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === IMPORT_CATALOG) {
        void (async () => {
            const config = await getConfig();
            if (!config)
                throw new Error("Conecte a extensão à Disparei antes de importar o catálogo.");
            const products = Array.isArray(message.products) ? message.products : [];
            if (!products.length)
                return { received: 0, inserted: 0, updated: 0, errors: 0 };
            return api(config, "/api/catalog/mercado-livre/import", { method: "POST", body: JSON.stringify(products.slice(0, 500)) });
        })().then(sendResponse).catch(error => sendResponse({ error: error instanceof Error ? error.message : "Falha ao importar catálogo." }));
        return true;
    }
    if (message?.type !== CONNECT)
        return false;
    void (async () => {
        const response = await fetch(`${message.backendOrigin}/api/piloto-automatico/mercado-livre/extension/connect`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nonce: message.nonce }) });
        const body = await response.json();
        if (!response.ok)
            throw new Error(body.error || "Não foi possível vincular a extensão.");
        await chrome.storage.local.set({ [CONFIG_KEY]: { backendOrigin: message.backendOrigin, extensionToken: body.extension_token, connectedAt: new Date().toISOString() } });
        await ensurePolling();
        await poll();
        return { ok: true };
    })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Falha na conexão." }));
    return true;
});
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === POLL_ALARM)
    void poll(); });
chrome.runtime.onStartup.addListener(() => { void ensurePolling().then(poll); });
chrome.runtime.onInstalled.addListener(() => { void ensurePolling().then(poll); });
