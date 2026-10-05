import { CARRINHO_KEY, ENVIO_KEY, PAGINA_ENVIADOS, PAGINA_ENVIO, PAGINA_PEDIR_ENVIO } from "./shared.js";

const CONNECT = "DISPAREI_ML_CONNECT";
const CONNECT_RESULT = "DISPAREI_ML_CONNECTION_RESULT";
// Envio vindo do carrinho vale 30 min; depois disso a página abre vazia.
const ENVIO_VALIDO_MS = 30 * 60_000;

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const type = event.data?.type;
  if (type === CONNECT) {
    const { nonce, backendOrigin } = event.data;
    if (typeof nonce !== "string" || nonce.length < 32 || backendOrigin !== window.location.origin) return;
    chrome.runtime.sendMessage({ type: CONNECT, nonce, backendOrigin }, (response) => {
      window.postMessage({ type: CONNECT_RESULT, ok: Boolean(response?.ok), error: response?.error }, window.location.origin);
    });
    return;
  }
  // Página /catalogo/extensao pede os produtos que o carrinho mandou.
  if (type === PAGINA_PEDIR_ENVIO) {
    void chrome.storage.local.get([ENVIO_KEY, CARRINHO_KEY]).then(stored => {
      const envio = stored[ENVIO_KEY];
      const valido = envio && Date.now() - Number(envio.criadoEm || 0) < ENVIO_VALIDO_MS;
      window.postMessage({ type: PAGINA_ENVIO, extensao: true, modo: valido ? envio.modo : null, itens: valido ? envio.itens : [], carrinho: Array.isArray(stored[CARRINHO_KEY]) ? stored[CARRINHO_KEY] : [] }, window.location.origin);
      if (valido) void chrome.storage.local.remove(ENVIO_KEY); // usado uma vez só
    });
    return;
  }
  // Agendados com sucesso saem do carrinho.
  if (type === PAGINA_ENVIADOS && Array.isArray(event.data.chaves)) {
    const chaves = new Set(event.data.chaves.map(String));
    void chrome.storage.local.get(CARRINHO_KEY).then(stored => {
      const carrinho = Array.isArray(stored[CARRINHO_KEY]) ? stored[CARRINHO_KEY] : [];
      return chrome.storage.local.set({ [CARRINHO_KEY]: carrinho.filter((item: any) => !chaves.has(`${item.platform}:${item.itemId}`)) });
    });
  }
});
