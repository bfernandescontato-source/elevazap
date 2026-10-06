// Roda no MUNDO DA PÁGINA da Shopee (world: MAIN, document_start), nas páginas de
// cupom. Não chama nada: só observa o fetch/XHR que a própria Shopee faz para
// get_vouchers_by_collections e repassa a resposta (que já vem assinada pela Shopee)
// via postMessage. Assim não precisamos gerar as assinaturas anti-robô.
(() => {
  const ALVO = "get_vouchers_by_collections";
  const entregar = (data: unknown) => {
    try { window.postMessage({ __dspCupons: true, data }, location.origin); } catch { /* aba fechando */ }
  };

  const fetchOriginal = window.fetch;
  window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
    const url = typeof args[0] === "string" ? args[0] : (args[0] as Request)?.url || "";
    const promessa = fetchOriginal.apply(this as any, args as any);
    if (url.includes(ALVO)) {
      promessa.then(resposta => { resposta.clone().json().then(entregar).catch(() => undefined); }).catch(() => undefined);
    }
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
    if (this.__dspUrl && this.__dspUrl.includes(ALVO)) {
      this.addEventListener("load", () => { try { entregar(JSON.parse(this.responseText)); } catch { /* resposta não-JSON */ } });
    }
    return sendOriginal.apply(this, args as []);
  };
})();
