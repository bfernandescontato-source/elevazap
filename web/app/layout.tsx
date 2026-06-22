import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ElevaZap Ops",
  description: "Operação interna segura de WhatsApp"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
