"use client";

import { Loader2, Moon, Repeat } from "lucide-react";
import { useEffect, useState } from "react";
import { LoadingState } from "@/components/ui";
import { DEFAULT_SEND_RULES, MAX_REPEAT_DAYS, SUGGESTED_QUIET_END, SUGGESTED_QUIET_START, SUGGESTED_REPEAT_DAYS, type SendRules } from "@/modules/send-guard/rules";

type Loaded = SendRules & { available: boolean };

const inputClass = "focus-ring mt-1 h-11 w-full rounded-lg border border-line bg-white px-3 text-ink disabled:bg-wash disabled:text-muted";

export function SendRulesSettings() {
  const [rules, setRules] = useState<Loaded | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/account/send-rules", { cache: "no-store" }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível carregar as regras de envio.");
      setRules(body.rules); setCanEdit(body.canEdit === true);
    }).catch((current) => { setRules({ ...DEFAULT_SEND_RULES, available: false }); setError(current.message); });
  }, []);

  if (!rules) return <LoadingState />;
  const locked = !canEdit || !rules.available || saving;
  const change = (patch: Partial<SendRules>) => { setRules({ ...rules, ...patch }); setMessage(""); setError(""); };

  async function save() {
    if (!rules) return;
    setSaving(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/account/send-rules", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ quietHoursEnabled: rules.quietHoursEnabled, quietStart: rules.quietStart, quietEnd: rules.quietEnd, productRepeatDays: rules.productRepeatDays })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Não foi possível salvar as regras de envio.");
      setRules(body.rules); setMessage("Regras salvas. Já valem para os próximos envios.");
    } catch (current) {
      setError(current instanceof Error ? current.message : "Não foi possível salvar as regras de envio.");
    } finally { setSaving(false); }
  }

  return <section className="max-w-2xl space-y-5">
    <div>
      <h2 className="text-lg font-semibold text-ink">Regras de envio</h2>
      <p className="mt-1 text-sm text-muted">Valem para tudo o que sai dos seus números: Piloto, Catálogo, Agenda e disparos para grupos.</p>
    </div>
    {!rules.available ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Esta opção ainda não está disponível para sua conta.</div> : null}
    {rules.available && !canEdit ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Somente administradores podem mudar estas regras.</div> : null}

    <div className="rounded-lg border border-line bg-panel p-5 shadow-soft sm:p-6">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary text-white"><Moon size={18} /></div>
        <div className="min-w-0">
          <h3 className="font-semibold text-ink">Pausa noturna</h3>
          <p className="mt-1 text-sm text-muted">Nada sai nesse horário. O que estiver marcado para a pausa sai assim que ela terminar.</p>
        </div>
      </div>
      <label className="mt-5 flex items-center gap-3 text-sm font-medium text-ink">
        <input type="checkbox" className="h-5 w-5 accent-primary" checked={rules.quietHoursEnabled} disabled={locked}
          onChange={(event) => change({ quietHoursEnabled: event.target.checked })} />
        Pausar os envios à noite
      </label>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <label className="text-sm font-medium text-ink">Começa às<input type="time" value={rules.quietStart} disabled={locked} onChange={(event) => change({ quietStart: event.target.value })} className={inputClass} /></label>
        <label className="text-sm font-medium text-ink">Termina às<input type="time" value={rules.quietEnd} disabled={locked} onChange={(event) => change({ quietEnd: event.target.value })} className={inputClass} /></label>
      </div>
      <p className="mt-3 text-xs text-muted">Sugestão: das {SUGGESTED_QUIET_START} às {SUGGESTED_QUIET_END}. O horário do Piloto continua valendo junto com a pausa.</p>
    </div>

    <div className="rounded-lg border border-line bg-panel p-5 shadow-soft sm:p-6">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary text-white"><Repeat size={18} /></div>
        <div className="min-w-0">
          <h3 className="font-semibold text-ink">Produto repetido</h3>
          <p className="mt-1 text-sm text-muted">Evita que o mesmo produto volte para o mesmo grupo cedo demais.</p>
        </div>
      </div>
      <label className="mt-5 block text-sm font-medium text-ink">Não repetir o mesmo produto no mesmo grupo por quantos dias?
        <div className="mt-1 flex items-center gap-3">
          <input type="number" inputMode="numeric" min={0} max={MAX_REPEAT_DAYS} value={rules.productRepeatDays} disabled={locked}
            onChange={(event) => change({ productRepeatDays: Math.max(0, Math.min(MAX_REPEAT_DAYS, Math.floor(Number(event.target.value) || 0))) })}
            className="focus-ring h-11 w-24 rounded-lg border border-line bg-white px-3 text-ink disabled:bg-wash disabled:text-muted" />
          <span className="text-sm text-muted">dias</span>
        </div>
      </label>
      <p className="mt-3 text-xs text-muted">Use 0 para desligar. Sugestão: {SUGGESTED_REPEAT_DAYS} dias.</p>
      <p className="mt-2 text-xs text-muted">Se o produto já foi para o grupo nesse prazo, o envio para esse grupo é pulado. Ele aparece como cancelado, com o motivo. Vale para produtos do Piloto e do Catálogo. Disparos com texto livre não entram nessa regra.</p>
    </div>

    {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
    {message ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div> : null}
    <button type="button" onClick={save} disabled={locked || rules.quietStart === rules.quietEnd} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white disabled:opacity-50 sm:w-auto">
      {saving ? <Loader2 size={16} className="animate-spin" /> : null} Salvar regras
    </button>
  </section>;
}
