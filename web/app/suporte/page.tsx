"use client";

import { AppShell, Toast } from "@/components/ui";
import { BookOpen, Bot, DollarSign, Inbox } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ConfigTab } from "@/modules/support/ui/config-tab";
import { InboxTab } from "@/modules/support/ui/inbox-tab";
import { KnowledgeBaseTab } from "@/modules/support/ui/knowledge-base-tab";
import { RefundsTab } from "@/modules/support/ui/refunds-tab";

type Tab = "config" | "inbox" | "kb" | "refunds";

export default function SuportePage() {
  const [tab, setTab] = useState<Tab>("config");
  const [toast, setToast] = useState("");
  const notify = (message: string) => { setToast(message); setTimeout(() => setToast(""), 3000); };
  const tabs: Array<[Tab, string, ReactNode]> = [
    ["config", "Configuração", <Bot key="config" size={15} />],
    ["inbox", "Caixa de entrada", <Inbox key="inbox" size={15} />],
    ["kb", "Base de conhecimento", <BookOpen key="kb" size={15} />],
    ["refunds", "Reembolsos", <DollarSign key="refunds" size={15} />]
  ];

  return <AppShell title="Suporte via IA" subtitle="Atendimento automático no WhatsApp">
    <div className="space-y-5">
      <div className="flex gap-1 rounded-lg border border-line bg-wash p-1">
        {tabs.map(([id, label, icon]) => <button key={id} onClick={() => setTab(id)} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${tab === id ? "bg-panel text-ink shadow-soft" : "text-muted hover:text-ink"}`}>{icon}{label}</button>)}
      </div>
      {tab === "config" && <ConfigTab notify={notify} />}
      {tab === "inbox" && <InboxTab notify={notify} />}
      {tab === "kb" && <KnowledgeBaseTab notify={notify} />}
      {tab === "refunds" && <RefundsTab notify={notify} />}
      <Toast message={toast} />
    </div>
  </AppShell>;
}
