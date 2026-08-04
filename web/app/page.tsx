"use client";

import { useEffect, useState } from "react";
import { AuthShell } from "@/components/auth-shell";

export default function RootPage() {
  const [error, setError] = useState("");

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    if (code) {
      window.history.replaceState(null, "", "/");
      window.location.replace(`/auth/confirm?code=${encodeURIComponent(code)}&next=/redefinir-senha`);
      return;
    }

    const hash = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    const type = hash.get("type") || undefined;
    const providerError = hash.get("error_description");

    window.history.replaceState(null, "", "/");
    if (providerError) {
      setError(providerError);
      return;
    }
    if (!accessToken || !refreshToken) {
      window.location.replace("/dashboard");
      return;
    }

    fetch("/api/auth/hash-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ access_token: accessToken, refresh_token: refreshToken, type })
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível validar o link.");
      window.location.replace(data.redirectTo || "/dashboard");
    }).catch((currentError) => setError(currentError.message));
  }, []);

  return <AuthShell title="Validando acesso" description={error || "Aguarde enquanto verificamos seu link seguro."}>
    {error ? <a href="/recuperar-senha" className="inline-flex h-10 items-center rounded-lg bg-black px-4 text-sm font-medium text-white">Solicitar novo link</a> : <div className="h-2 overflow-hidden rounded-full bg-zinc-200"><div className="h-full w-1/2 animate-pulse rounded-full bg-black" /></div>}
  </AuthShell>;
}
