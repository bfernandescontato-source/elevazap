import Link from "next/link";
import { ReactNode } from "react";
import { BrandLogo } from "./brand-logo";

export function AuthShell({ title, description, children, footer }: { title: string; description: string; children: ReactNode; footer?: ReactNode }) {
  return <main className="grid min-h-screen place-items-center px-4 py-10">
    <section className="w-full max-w-md rounded-lg border border-line bg-panel p-6 shadow-soft">
      <BrandLogo className="mb-5 h-14 w-full" imageClassName="w-[280px]" />
      <h1 className="text-xl font-semibold text-ink">{title}</h1>
      <p className="mt-1 text-sm leading-6 text-muted">{description}</p>
      <div className="mt-6">{children}</div>
      {footer ? <div className="mt-6 border-t border-line pt-5 text-center text-sm text-muted">{footer}</div> : null}
    </section>
  </main>;
}

export const authInputClass = "mt-1 h-11 w-full rounded-lg border border-line px-3 focus:outline-none focus:ring-2 focus:ring-black/20";
export const authButtonClass = "mt-5 h-11 w-full rounded-lg bg-black text-sm font-medium text-white transition hover:bg-zinc-800";
export const authLinkClass = "font-medium text-ink underline underline-offset-4";

export function AuthNotice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{children}</div>;
}

export function BackToLogin() {
  return <Link href="/login" className={authLinkClass}>Voltar para o login</Link>;
}
