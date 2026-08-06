import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "Disparei — Dispare para todos os seus grupos de uma vez" },
};

export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
