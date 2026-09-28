// Suporte por WhatsApp (bolinha flutuante do painel). Para trocar o número ou a
// mensagem sem mexer no componente, defina NEXT_PUBLIC_SUPPORT_WHATSAPP (só
// dígitos, com DDI) e NEXT_PUBLIC_SUPPORT_MESSAGE no ambiente do build.
export const SUPPORT_WHATSAPP_NUMBER = (process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP || "559180900908").replace(/\D/g, "");
export const SUPPORT_WHATSAPP_MESSAGE = process.env.NEXT_PUBLIC_SUPPORT_MESSAGE || "Olá! Preciso de ajuda com o Disparei.";

export function supportWhatsappUrl() {
  return `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(SUPPORT_WHATSAPP_MESSAGE)}`;
}
