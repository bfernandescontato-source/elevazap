"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { brasiliaDate } from "@/modules/affiliate-catalog/schedule-plan";

/** A Agenda só existe para contas liberadas; a própria rota responde 403 para as outras. */
export function useCatalogAgendaEnabled() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/catalogo/agenda?day=${brasiliaDate()}`, { cache: "no-store" })
      .then(response => { if (!cancelled) setEnabled(response.ok); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  return enabled;
}

export function CatalogTabs({ active }: { active: "catalogo" | "agenda" }) {
  const tab = (href: string, id: typeof active, label: string) => (
    <Link href={href} className={`border-b-2 px-4 py-3 text-sm font-medium ${active === id ? "border-black text-ink" : "border-transparent text-muted hover:text-ink"}`}>{label}</Link>
  );
  return <nav className="flex gap-2 border-b border-line">{tab("/catalogo", "catalogo", "Catálogo")}{tab("/catalogo/agenda", "agenda", "Agenda")}</nav>;
}
