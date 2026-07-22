import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Disparei",
    template: "%s | Disparei"
  },
  description: "Campanhas e envios de WhatsApp em um só lugar"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
