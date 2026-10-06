import { VITRINE_ALTERNAR_PAINEL, VITRINE_COLETA_AGORA, VITRINE_STATUS, type VitrineStatus } from "./shared.js";

const CONFIG_KEY = "dispareiMercadoLivre";
const LOJAS = /^https?:\/\/([^/]*\.)?(mercadolivre\.com(\.br)?|mercadolibre\.com|amazon\.com(\.br)?|shopee\.com(\.br)?|magazineluiza\.com\.br|magazinevoce\.com\.br)\//i;
const statusElement = document.querySelector<HTMLParagraphElement>("#status")!;
try { const v = document.querySelector("#ver"); if (v) v.textContent = "v" + chrome.runtime.getManifest().version; } catch {}
const cartButton = document.querySelector<HTMLButtonElement>("#carrinho")!;
const coletaButton = document.querySelector<HTMLButtonElement>("#coleta")!;
const coletaMsg = document.querySelector<HTMLParagraphElement>("#coletaMsg")!;
void chrome.storage.local.get(CONFIG_KEY).then((value) => { statusElement.textContent = value[CONFIG_KEY] ? "● Conectada ao Disparei" : "○ Ainda não conectada"; });
document.querySelector("#open")?.addEventListener("click", () => void chrome.tabs.create({ url: "https://www.disparei.pro/piloto-automatico" }));

// Carrinho (em aba de loja) e coleta diária (teste), só para conta liberada.
void (async () => {
  const status = await chrome.runtime.sendMessage({ type: VITRINE_STATUS }).catch(() => null) as VitrineStatus | null;
  if (!status?.liberada) return;
  coletaButton.hidden = false;
  coletaButton.addEventListener("click", () => {
    coletaButton.disabled = true; coletaMsg.hidden = false; coletaMsg.textContent = "Coletando… pode levar um minuto. Pode fechar.";
    void chrome.runtime.sendMessage({ type: VITRINE_COLETA_AGORA }).then(() => { coletaMsg.textContent = "Coleta concluída. Veja no Catálogo."; coletaButton.disabled = false; }).catch(() => { coletaMsg.textContent = "Falha ao coletar."; coletaButton.disabled = false; });
  });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !LOJAS.test(tab.url || "")) return;
  cartButton.hidden = false;
  cartButton.addEventListener("click", () => { void chrome.tabs.sendMessage(tab.id!, { type: VITRINE_ALTERNAR_PAINEL }).catch(() => undefined); window.close(); });
})();
