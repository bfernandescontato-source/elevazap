import { supportWhatsappUrl } from "@/lib/support";

// Bolinha fixa de suporte (canto inferior direito). No celular fica acima da
// barra de navegação; sobe quando a tela tem uma barra flutuante de ação
// (atributo data-floating-bar), para não cobrir botões.
export function SupportBubble() {
  return <a href={supportWhatsappUrl()} target="_blank" rel="noopener noreferrer" aria-label="Fale com o suporte pelo WhatsApp" className="support-bubble group fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom))] right-4 z-40 flex items-center gap-2 transition-transform duration-200 lg:bottom-6 lg:right-6">
    <span className="pointer-events-none hidden translate-x-2 whitespace-nowrap rounded-full bg-panel px-3 py-1.5 text-sm font-medium text-ink opacity-0 shadow-soft ring-1 ring-line transition group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100 lg:block">Precisa de ajuda?</span>
    <span className="grid h-14 w-14 place-items-center rounded-full bg-[#25D366] text-white shadow-[0_10px_24px_-8px_rgb(0_0_0/0.35)] transition group-hover:scale-105 group-active:scale-95">
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true" fill="currentColor">
        <path d="M16 3.2C9 3.2 3.3 8.8 3.3 15.7c0 2.4.7 4.7 1.9 6.7L3.2 28.8l6.6-2c1.9 1 4 1.6 6.2 1.6 7 0 12.7-5.6 12.7-12.6S23 3.2 16 3.2Zm0 22.9c-2 0-3.9-.6-5.6-1.6l-.4-.2-3.9 1.2 1.2-3.8-.3-.4c-1.1-1.7-1.7-3.6-1.7-5.6 0-5.7 4.7-10.3 10.6-10.3s10.6 4.6 10.6 10.3S21.9 26.1 16 26.1Z"/>
        <path d="M12.3 9.9c-.3-.6-.6-.6-.9-.6h-.8c-.3 0-.7.1-1 .5-.4.4-1.3 1.3-1.3 3.1s1.4 3.6 1.5 3.9c.2.3 2.6 4.1 6.5 5.6 3.2 1.2 3.8 1 4.5.9.7-.1 2.2-.9 2.5-1.8.3-.9.3-1.6.2-1.8-.1-.2-.4-.3-.8-.5l-2.6-1.3c-.4-.1-.6-.2-.9.2-.3.4-1 1.2-1.2 1.5-.2.3-.5.3-.9.1-.4-.2-1.6-.6-3-1.8-1.1-1-1.9-2.2-2.1-2.6-.2-.4 0-.6.2-.8l.6-.7c.2-.2.3-.4.4-.7.1-.3.1-.5 0-.7l-1.2-2.8Z"/>
      </svg>
    </span>
  </a>;
}
