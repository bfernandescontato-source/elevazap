// Roda no MUNDO DA PÁGINA da Shopee (world: MAIN, document_start), nas páginas de
// cupom. Não chama nada: observa o fetch/XHR que a própria Shopee faz e, quando a
// resposta tem cara de cupom (URL ou conteúdo), repassa por postMessage. Assim não
// precisamos gerar as assinaturas anti-robô.
(() => {
  const URL_CUPOM = /voucher|coupon|cupom|promotion|microsite/i;
  const temCupom = (texto: string) => /voucher_identifier|voucher_code|collection_voucher_entity_info/.test(texto);
  const entregar = (data: unknown) => { try { window.postMessage({ __dspCupons: true, data }, location.origin); } catch { /* aba fechando */ } };
  const talvezEntregar = (url: string, texto: string) => {
    if (!texto) return;
    if (URL_CUPOM.test(url) || temCupom(texto)) {
      try { entregar(JSON.parse(texto)); } catch { /* não-JSON */ }
    }
  };

  const fetchOriginal = window.fetch;
  window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
    const url = typeof args[0] === "string" ? args[0] : (args[0] as Request)?.url || "";
    const promessa = fetchOriginal.apply(this as any, args as any);
    promessa.then(resposta => {
      const ct = resposta.headers.get("content-type") || "";
      if (!ct.includes("json") && !URL_CUPOM.test(url)) return;
      resposta.clone().text().then(texto => talvezEntregar(url, texto)).catch(() => undefined);
    }).catch(() => undefined);
    return promessa;
  };

  const XHR = window.XMLHttpRequest.prototype;
  const openOriginal = XHR.open;
  XHR.open = function (this: XMLHttpRequest & { __dspUrl?: string }, method: string, url: string, ...rest: any[]) {
    this.__dspUrl = url;
    return (openOriginal as any).call(this, method, url, ...rest);
  };
  const sendOriginal = XHR.send;
  XHR.send = function (this: XMLHttpRequest & { __dspUrl?: string }, ...args: any[]) {
    this.addEventListener("load", () => { try { talvezEntregar(this.__dspUrl || "", this.responseText); } catch { /* ignore */ } });
    return sendOriginal.apply(this, args as []);
  };
})();
