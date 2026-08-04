import { AuthNotice, AuthShell, BackToLogin, authButtonClass, authInputClass } from "@/components/auth-shell";

export default async function MagicLinkPage({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  const query = await searchParams;
  return <AuthShell title="Entrar por magic link" description="Receba um link de acesso no e-mail. O link só funciona para usuários já cadastrados e aprovados." footer={<BackToLogin />}>
    {query.sent ? <AuthNotice>Se o e-mail estiver ativo, o link de acesso será enviado.</AuthNotice> : null}
    {query.error ? <AuthNotice error>Não foi possível solicitar o link agora.</AuthNotice> : null}
    <form action="/api/auth/magic-link" method="post">
      <label className="text-sm font-medium text-ink">E-mail<input name="email" type="email" autoComplete="email" required className={authInputClass} /></label>
      <button className={authButtonClass}>Enviar link de acesso</button>
    </form>
  </AuthShell>;
}
