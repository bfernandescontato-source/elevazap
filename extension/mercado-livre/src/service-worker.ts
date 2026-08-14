import { CONNECT, GENERATE, type Config, type Job } from "./shared.js";

const CONFIG_KEY = "dispareiMercadoLivre";
const LINK_BUILDER = "https://www.mercadolivre.com.br/afiliados/linkbuilder";
let processing = false;

async function getConfig() { return (await chrome.storage.local.get(CONFIG_KEY))[CONFIG_KEY] as Config | undefined; }
async function api(config: Config, path: string, init: RequestInit = {}) {
  const response = await fetch(`${config.backendOrigin}${path}`, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${config.extensionToken}`, ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "O Disparei recusou a operação.");
  return body;
}
async function execute(job: Job) {
  const tab = await chrome.tabs.create({ url: LINK_BUILDER, active: false });
  if (!tab.id) throw new Error("Não foi possível abrir o Gerador.");
  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if ((await chrome.tabs.get(tab.id)).status === "complete") break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const result = await chrome.tabs.sendMessage(tab.id, { type: GENERATE, inputUrl: job.input_url, affiliateTag: job.affiliate_tag });
    if (!result?.ok) throw new Error(result?.error || "Falha na geração.");
    return result as { affiliateLink: string; affiliateTag: string | null };
  } finally { await chrome.tabs.remove(tab.id).catch(() => undefined); }
}
async function poll() {
  if (processing) return;
  const config = await getConfig();
  if (!config) return;
  processing = true;
  try {
    const { job } = await api(config, "/api/piloto-automatico/mercado-livre/extension/jobs");
    if (!job) return;
    try {
      const result = await execute(job);
      await api(config, `/api/piloto-automatico/mercado-livre/extension/jobs/${job.id}`, { method: "POST", body: JSON.stringify({ status: "completed", affiliate_link: result.affiliateLink, affiliate_tag: result.affiliateTag }) });
    } catch (error) {
      await api(config, `/api/piloto-automatico/mercado-livre/extension/jobs/${job.id}`, { method: "POST", body: JSON.stringify({ status: "failed", error_message: error instanceof Error ? error.message : "Falha no Mercado Livre." }) });
    }
  } finally { processing = false; }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== CONNECT) return false;
  void (async () => {
    const response = await fetch(`${message.backendOrigin}/api/piloto-automatico/mercado-livre/extension/connect`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nonce: message.nonce }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Não foi possível vincular a extensão.");
    await chrome.storage.local.set({ [CONFIG_KEY]: { backendOrigin: message.backendOrigin, extensionToken: body.extension_token, connectedAt: new Date().toISOString() } satisfies Config });
    chrome.alarms.create("disparei-ml-poll", { periodInMinutes: 0.5 });
    await poll();
    return { ok: true };
  })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Falha na conexão." }));
  return true;
});
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === "disparei-ml-poll") void poll(); });
chrome.runtime.onStartup.addListener(() => void poll());
chrome.runtime.onInstalled.addListener(() => void poll());
