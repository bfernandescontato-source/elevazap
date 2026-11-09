"use client";

import { AppShell } from "@/components/ui";
import { RecurringMessages } from "@/components/recurring-messages";

export default function MensagensAutomaticasPage() {
  return <AppShell title="Mensagens automáticas" subtitle="Avisos, regras e convite que saem sozinhos todo dia nos seus grupos.">
    <RecurringMessages />
  </AppShell>;
}
