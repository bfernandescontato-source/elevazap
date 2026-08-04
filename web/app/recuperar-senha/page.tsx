import { AuthNotice, AuthShell, BackToLogin, authButtonClass, authInputClass } from "@/components/auth-shell";

export default async function RecuperarSenhaPage({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  const query = await searchParams;
  return <AuthShell title="Recuperar senha" description="Enviaremos um link seguro para definir uma nova senha." footer={<BackToLogin />}>
    {query.sent ? <AuthNotice>Se o e-mail estiver cadastrado, você receberá as instruções.</AuthNotice> : null}
    {query.error ? <AuthNotice error>O link expirou ou houve muitas tentativas. Solicite um novo.</AuthNotice> : null}
    <form action="/api/auth/recover" method="post">
      <label className="text-sm font-medium text-ink">E-mail<input name="email" type="email" autoComplete="email" required className={authInputClass} /></label>
      <button className={authButtonClass}>Enviar recuperação</button>
    </form>
  </AuthShell>;
}
