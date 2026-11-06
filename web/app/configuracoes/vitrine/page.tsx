"use client";

import { AppShell } from "@/components/ui";
import { OfferPageSettings } from "@/components/offer-page-settings";

export default function MinhaVitrinePage() {
  return <AppShell title="Minha vitrine" subtitle="Sua página de ofertas para a bio do Instagram">
    <OfferPageSettings />
  </AppShell>;
}
