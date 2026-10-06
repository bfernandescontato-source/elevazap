// Mensagem padrão de um cupom Shopee para enviar aos grupos (com o link de afiliado).
export function mensagemCupom(cupom: { bold_text?: string | null; light_text?: string | null; voucher_code: string }, affiliateUrl: string) {
  return [
    `🎟️ ${cupom.bold_text || "Cupom Shopee"}${cupom.light_text ? ` — ${cupom.light_text}` : ""}`,
    `🔑 Use o cupom: ${cupom.voucher_code}`,
    `🛒 ${affiliateUrl}`,
    "⏰ Corre que é limitado, acaba rápido!"
  ].join("\n");
}
