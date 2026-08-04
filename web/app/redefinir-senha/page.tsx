import { AuthNotice, AuthShell, authButtonClass, authInputClass } from "@/components/auth-shell";

export default async function RedefinirSenhaPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const query = await searchParams;
  return <AuthShell title="Definir nova senha" description="Use pelo menos 8 caracteres e evite reutilizar senhas antigas.">
    {query.error ? <AuthNotice error>As senhas precisam coincidir e ter pelo menos 8 caracteres.</AuthNotice> : null}
    <form action="/api/auth/update-password" method="post">
      <label className="text-sm font-medium text-ink">Nova senha<input name="password" type="password" autoComplete="new-password" minLength={8} required className={authInputClass} /></label>
      <label className="mt-4 block text-sm font-medium text-ink">Confirmar senha<input name="confirmation" type="password" autoComplete="new-password" minLength={8} required className={authInputClass} /></label>
      <button className={authButtonClass}>Atualizar senha</button>
    </form>
  </AuthShell>;
}
