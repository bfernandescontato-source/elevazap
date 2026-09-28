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

// O tema terra é o padrão (inclusive nas telas sem login). Uma conta ainda no
// clássico grava o cookie (/api/ui-theme) e o script o aplica antes da primeira
// pintura; o AppShell confere o tema de novo a cada carregamento.
const themeScript = `try{var m=document.cookie.match(/(?:^|; )${UI_THEME_COOKIE}=([a-z]+)/);if(m){if(m[1]==="classic")delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=m[1]}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR" data-theme="terra" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head><body>{children}</body></html>;
}
