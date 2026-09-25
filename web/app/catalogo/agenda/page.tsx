"use client";

import { AppShell } from "@/components/ui";
import { CatalogAgenda } from "@/components/catalog/catalog-agenda";
import { CatalogTabs } from "@/components/catalog/catalog-tabs";

export default function CatalogAgendaPage() {
  return <AppShell title="Agenda do Catálogo" subtitle="Ofertas do Catálogo agendadas por dia: mude horários, passe para amanhã, envie agora ou remova.">
    <div className="space-y-5">
      <CatalogTabs active="agenda"/>
      <CatalogAgenda/>
    </div>
  </AppShell>;
}
