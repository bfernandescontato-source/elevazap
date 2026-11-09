"use client";

import { AppShell } from "@/components/ui";
import { CatalogTabs } from "@/components/catalog/catalog-tabs";
import { LinkList } from "@/components/catalog/link-list";

export default function CatalogLinkListPage() {
  return <AppShell title="Lista de links" subtitle="Cole vários links de produtos. O robô troca pelo seu link afiliado, monta a mensagem e envia um por vez nos seus grupos.">
    <div className="space-y-5">
      <CatalogTabs active="lista"/>
      <LinkList/>
    </div>
  </AppShell>;
}
