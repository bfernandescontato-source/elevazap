"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderOpen, Smartphone, Users } from "lucide-react";
import { ReactNode } from "react";

const items = [
  { href: "/grupos", label: "Grupos", icon: Users },
  { href: "/grupos/numeros", label: "Números conectados", icon: Smartphone },
  { href: "/grupos/modelos", label: "Modelos e Pastas", icon: FolderOpen }
];

export function GroupNav({ children, showRoot = true }: { children?: ReactNode; showRoot?: boolean }) {
  const pathname = usePathname();
  return <nav aria-label="Área de grupos" className="mb-6 flex gap-2 overflow-x-auto border-b border-line pb-3">
    {children}
    {items.filter((item) => showRoot || item.href !== "/grupos").map((item) => {
      const active = pathname === item.href;
      const Icon = item.icon;
      return <Link key={item.href} href={item.href} className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition ${active ? "bg-black text-white" : "border border-line bg-white text-muted hover:border-zinc-400 hover:text-ink"}`}>
        <Icon size={16} />{item.label}
      </Link>;
    })}
  </nav>;
}
