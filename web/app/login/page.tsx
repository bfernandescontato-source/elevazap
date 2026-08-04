import Link from "next/link";
import { AuthNotice, AuthShell, authButtonClass, authInputClass, authLinkClass } from "../../components/auth-shell";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; password?: string }> }) {
  const resolvedSearchParams = await searchParams;
  const errorMessages: Record<string, string> = {
    invalid: "E-mail ou senha inválidos.", pending: "Seu cadastro ainda aguarda aprovação.",
    disabled: "Este acesso foi desativado.", link: "Este link é inválido ou expirou.",
    setup: "O cadastro existe, mas a estrutura de perfis ainda precisa ser ativada no banco."
  };
  return (
    <AuthShell title="Entrar" description="Acesse sua central de envios" footer={<span>Não possui acesso? <Link href="/cadastro" className={authLinkClass}>Solicitar cadastro</Link></span>}>
      <form action="/api/auth/login" method="post">
        {resolvedSearchParams.error ? <AuthNotice error>{errorMessages[resolvedSearchParams.error] || "Não foi possível entrar."}</AuthNotice> : null}
        {resolvedSearchParams.password === "updated" ? <AuthNotice>Senha atualizada. Entre com a nova senha.</AuthNotice> : null}
        <label className="text-sm font-medium text-ink">Email</label>
        <input name="email" type="email" autoComplete="email" required className={authInputClass} />
        <label className="mt-4 block text-sm font-medium text-ink">Senha</label>
        <input name="password" type="password" autoComplete="current-password" required className={authInputClass} />
        <button className={authButtonClass}>Entrar</button>
      </form>
      <div className="mt-4 flex flex-wrap justify-between gap-3 text-sm"><Link href="/recuperar-senha" className={authLinkClass}>Esqueci minha senha</Link><Link href="/magic-link" className={authLinkClass}>Entrar por link</Link></div>
    </AuthShell>
  );
}
