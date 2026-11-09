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

export function CatalogTabs({ active, agenda = true }: { active: "catalogo" | "agenda" | "lista" | "ganchos"; agenda?: boolean }) {
  const tab = (href: string, id: typeof active, label: string) => (
    <Link href={href} className={`shrink-0 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium ${active === id ? "border-primary text-ink" : "border-transparent text-muted hover:text-ink"}`}>{label}</Link>
  );
  return <nav className="flex gap-2 overflow-x-auto border-b border-line">{tab("/catalogo", "catalogo", "Catálogo")}{agenda ? tab("/catalogo/agenda", "agenda", "Agenda") : null}{tab("/catalogo/lista", "lista", "Lista de links")}{tab("/catalogo/ganchos", "ganchos", "Ganchos")}</nav>;
}
