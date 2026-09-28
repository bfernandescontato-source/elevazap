import type { Metadata } from "next";
import { UI_THEME_COOKIE } from "@/lib/ui-theme-shared";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Disparei",
    template: "%s | Disparei"
  },
  description: "Campanhas e envios de WhatsApp em um só lugar"
};

// Aplica o tema da conta (cookie gravado por /api/ui-theme) antes da primeira
// pintura. O AppShell confere o tema de novo a cada carregamento.
const themeScript = `try{var m=document.cookie.match(/(?:^|; )${UI_THEME_COOKIE}=([a-z]+)/);if(m&&m[1]!=="classic")document.documentElement.dataset.theme=m[1]}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head><body>{children}</body></html>;
}
