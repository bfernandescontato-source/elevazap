const GENERATE = "DISPAREI_ML_GENERATE_LINK";
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function generateLink(request: { type: string; inputUrl: string; affiliateTag?: string | null }) {
  if (!window.location.pathname.startsWith("/afiliados/linkbuilder")) throw new Error("Gerador oficial não está aberto.");
  // A página do Gerador monta o campo depois do carregamento; acusar sessão
  // antes disso marcava contas conectadas como desconectadas.
  let input: HTMLTextAreaElement | null = null;
  for (let attempt = 0; attempt < 40 && !input; attempt += 1) {
    input = document.querySelector<HTMLTextAreaElement>('textarea[placeholder*="mercadolivre"]');
    if (!input) await sleep(250);
  }
  if (!input) throw new Error("Sua sessão Mercado Livre não está disponível. Reconecte sua conta.");
  const meliLinks = () => Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea"))
    .map((element) => element.value.trim()).filter((value) => /^https:\/\/meli\.la\/[A-Za-z0-9_-]+$/i.test(value));
  const previous = new Set(meliLinks()); // nunca devolver o link de um pedido anterior
  const tagControl = document.querySelector<HTMLElement>('[role="combobox"][aria-label*="etiqueta" i]');
  const currentTag = tagControl?.textContent?.trim() || null;
  if (request.affiliateTag && currentTag && currentTag !== request.affiliateTag) throw new Error("A etiqueta Mercado Livre foi alterada. Reconecte para atualizar.");
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(input, request.inputUrl);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(250);
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.trim() === "Gerar");
  if (!button || button.disabled) throw new Error("O Mercado Livre recusou a URL informada.");
  button.click();
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await sleep(250);
    const affiliateLink = meliLinks().find((value) => !previous.has(value));
    if (affiliateLink) return { affiliateLink, affiliateTag: currentTag };
    if (/não pudemos|erro|inválid/i.test(document.querySelector('[role="alert"]')?.textContent || "")) throw new Error("O Gerador não conseguiu criar o link.");
  }
  throw new Error("O Gerador demorou mais que o esperado.");
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== GENERATE) return false;
  void generateLink(message).then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Falha no Gerador." }));
  return true;
});
