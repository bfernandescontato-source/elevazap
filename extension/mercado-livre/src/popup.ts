import { VITRINE_ALTERNAR_PAINEL, VITRINE_STATUS, type VitrineStatus } from "./shared.js";

const CONFIG_KEY = "dispareiMercadoLivre";
const LOJAS = /^https?:\/\/([^/]*\.)?(mercadolivre\.com(\.br)?|mercadolibre\.com|amazon\.com(\.br)?|shopee\.com(\.br)?|magazineluiza\.com\.br|magazinevoce\.com\.br)\//i;
const statusElement = document.querySelector<HTMLParagraphElement>("#status")!;
const cartButton = document.querySelector<HTMLButtonElement>("#carrinho")!;
void chrome.storage.local.get(CONFIG_KEY).then((value) => { statusElement.textContent = value[CONFIG_KEY] ? "● Conectada ao Disparei" : "○ Ainda não conectada"; });
document.querySelector("#open")?.addEventListener("click", () => void chrome.tabs.create({ url: "https://www.disparei.pro/piloto-automatico" }));

// Carrinho da Vitrine: só aparece em aba de loja e para conta liberada.
void (async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !LOJAS.test(tab.url || "")) return;
  const status = await chrome.runtime.sendMessage({ type: VITRINE_STATUS }).catch(() => null) as VitrineStatus | null;
  if (!status?.liberada) return;
  cartButton.hidden = false;
  cartButton.addEventListener("click", () => { void chrome.tabs.sendMessage(tab.id!, { type: VITRINE_ALTERNAR_PAINEL }).catch(() => undefined); window.close(); });
})();
