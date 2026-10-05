// Roda no mundo da página da Shopee (injetado pelo service worker): faz a busca
// com os cookies e cabeçalhos da própria loja e devolve por postMessage.
(() => {
  const ATTRIBUTE = "data-dsp-pedido";
  const raw = document.documentElement.getAttribute(ATTRIBUTE);
  if (!raw) return;
  document.documentElement.removeAttribute(ATTRIBUTE);
  let request: { url?: string; bilhete?: string } | null = null;
  try { request = JSON.parse(raw); } catch { return; }
  if (!request?.url || !request.bilhete) return;
  let url: URL;
  try { url = new URL(request.url, location.origin); } catch { return; }
  if (url.origin !== location.origin) return; // só a própria Shopee
  const reply = (data: object) => { try { window.postMessage({ dsp: request!.bilhete, ...data }, location.origin); } catch { /* aba fechando */ } };
  fetch(url.href, { credentials: "include", headers: { "x-api-source": "pc", "x-requested-with": "XMLHttpRequest", Accept: "application/json" } })
    .then(response => response.ok ? response.json().then(dados => reply({ ok: true, dados })) : reply({ ok: false, erro: `HTTP ${response.status}` }))
    .catch(error => reply({ ok: false, erro: error instanceof Error ? error.message : "falha na busca" }));
})();
