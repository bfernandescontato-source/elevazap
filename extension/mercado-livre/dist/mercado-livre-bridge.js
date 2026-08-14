"use strict";
const GENERATE = "DISPAREI_ML_GENERATE_LINK";
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function generateLink(request) {
    if (!window.location.pathname.startsWith("/afiliados/linkbuilder"))
        throw new Error("Gerador oficial não está aberto.");
    const input = document.querySelector('textarea[placeholder*="mercadolivre"]');
    if (!input)
        throw new Error("Sua sessão Mercado Livre não está disponível. Reconecte sua conta.");
    const tagControl = document.querySelector('[role="combobox"][aria-label*="etiqueta" i]');
    const currentTag = tagControl?.textContent?.trim() || null;
    if (request.affiliateTag && currentTag && currentTag !== request.affiliateTag)
        throw new Error("A etiqueta Mercado Livre foi alterada. Reconecte para atualizar.");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(input, request.inputUrl);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(250);
    const button = Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.trim() === "Gerar");
    if (!button || button.disabled)
        throw new Error("O Mercado Livre recusou a URL informada.");
    button.click();
    for (let attempt = 0; attempt < 80; attempt += 1) {
        await sleep(250);
        const affiliateLink = Array.from(document.querySelectorAll("input,textarea"))
            .map((element) => element.value.trim()).find((value) => /^https:\/\/meli\.la\/[A-Za-z0-9_-]+$/i.test(value));
        if (affiliateLink)
            return { affiliateLink, affiliateTag: currentTag };
        if (/não pudemos|erro|inválid/i.test(document.querySelector('[role="alert"]')?.textContent || ""))
            throw new Error("O Gerador não conseguiu criar o link.");
    }
    throw new Error("O Gerador demorou mais que o esperado.");
}
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== GENERATE)
        return false;
    void generateLink(message).then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Falha no Gerador." }));
    return true;
});
