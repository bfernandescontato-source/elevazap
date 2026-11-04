"use client";

import Image from "next/image";
import { KeyRound } from "lucide-react";
import { useState } from "react";
import { ActionButton } from "@/components/ui";

/**
 * Conectar o WhatsApp lendo o QR ou digitando um código no celular.
 * O código serve para quem só tem o celular: não dá para escanear o QR da própria tela.
 */
export function WhatsappConnectBox({ senderId, label, qr, phoneHint }: { senderId: string; label: string; qr?: string; phoneHint?: string }) {
  const [phone, setPhone] = useState(phoneHint || "");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function requestCode() {
    setBusy(true);
    setError("");
    setCode("");
    try {
      const response = await fetch(`/api/whatsapp/senders/${senderId}/pairing-code`, { method: "POST", body: JSON.stringify({ phone_number: phone }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível gerar o código agora.");
      if (data.status === "connected") setError("Este número já está conectado.");
      else setCode(data.code || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível gerar o código agora.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="mt-4 grid gap-4">
    {qr ? <div>
      <p className="mb-3 text-center text-sm text-muted">Escaneie com o WhatsApp deste número</p>
      <div className="flex justify-center rounded-lg bg-wash p-4"><Image src={qr} alt={`QR Code de ${label}`} width={224} height={224} unoptimized className="h-56 w-56 rounded-lg bg-white p-2" /></div>
    </div> : null}
    <div className="rounded-lg border border-line bg-white p-4">
      <p className="text-sm font-medium text-ink">Está só com o celular? Conecte por código</p>
      <p className="mt-1 text-xs text-muted">Digite o número deste WhatsApp com DDD.</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" placeholder="11 99999-8888" className="focus-ring h-11 flex-1 rounded-lg border border-line px-3 text-sm" />
        <ActionButton icon={<KeyRound size={15} />} disabled={busy || phone.replace(/\D/g, "").length < 10} className="border border-line bg-white text-ink" onClick={() => void requestCode()}>{busy ? "Gerando..." : "Receber código"}</ActionButton>
      </div>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      {code ? <div className="mt-3 rounded-lg bg-wash p-3">
        <p className="text-center font-mono text-2xl font-semibold tracking-widest text-ink" data-testid="pairing-code">{code}</p>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-muted">
          <li>No celular, abra o WhatsApp e toque nos 3 pontinhos.</li>
          <li>Toque em Aparelhos conectados e depois em Conectar um aparelho.</li>
          <li>Toque em Conectar com número de telefone e digite o código.</li>
        </ol>
      </div> : null}
    </div>
  </div>;
}
