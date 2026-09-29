"use client";

import { useEffect, useState } from "react";

const CHECK_MS = 3 * 60_000;

async function publishedVersion(): Promise<string | null> {
  try {
    const response = await fetch("/api/versao", { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()).version || null;
  } catch { return null; }
}

/**
 * Aba aberta antes de um deploy continua rodando o código antigo (o celular
 * mantém a página na memória). Ao voltar para a aba com versão nova, recarrega;
 * com a aba em uso, mostra um aviso com botão.
 */
export function NovaVersao() {
  const [outdated, setOutdated] = useState(false);
  useEffect(() => {
    let loaded: string | null = null;
    let stale = false;
    const check = async (reloadIfStale: boolean) => {
      const current = await publishedVersion();
      if (!current) return;
      if (!loaded) { loaded = current; return; }
      if (current !== loaded) {
        stale = true;
        if (reloadIfStale) window.location.reload(); else setOutdated(true);
      }
    };
    void check(false);
    const timer = setInterval(() => void check(false), CHECK_MS);
    const onVisible = () => { if (document.visibilityState === "visible") { if (stale) window.location.reload(); else void check(true); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);
  if (!outdated) return null;
  return <div role="status" className="fixed inset-x-3 bottom-20 z-[60] mx-auto flex max-w-md items-center gap-3 rounded-xl bg-ink p-3 text-sm text-white shadow-2xl sm:bottom-6">
    <span className="flex-1">Saiu uma versão nova do Disparei.</span>
    <button onClick={() => window.location.reload()} className="rounded-lg bg-white px-3 py-2 font-medium text-ink">Atualizar</button>
  </div>;
}
