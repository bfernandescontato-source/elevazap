import { AuthNotice, AuthShell, BackToLogin, authButtonClass, authInputClass } from "@/components/auth-shell";

export default async function CadastroPage({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  const query = await searchParams;
  return <AuthShell title="Solicitar cadastro" description="O primeiro cadastro torna-se administrador. Os próximos precisam ser aprovados por um administrador." footer={<BackToLogin />}>
    {query.sent ? <AuthNotice>Confira seu e-mail para confirmar o cadastro.</AuthNotice> : null}
    {query.error ? <AuthNotice error>{query.error === "rate" ? "Muitas tentativas. Aguarde antes de tentar novamente." : query.error === "exists" ? "Este e-mail já está cadastrado. Tente entrar ou recuperar a senha." : query.error === "disabled" ? "O cadastro de novos usuários está temporariamente desativado." : query.error === "provider" ? "O serviço de e-mail não aceitou o cadastro. Verifique a configuração de autenticação." : "Revise os dados informados."}</AuthNotice> : null}
    <form action="/api/auth/signup" method="post">
      <label className="text-sm font-medium text-ink">Nome<input name="name" autoComplete="name" minLength={2} maxLength={100} required className={authInputClass} /></label>
      <label className="mt-4 block text-sm font-medium text-ink">E-mail<input name="email" type="email" autoComplete="email" required className={authInputClass} /></label>
      <label className="mt-4 block text-sm font-medium text-ink">Senha<input name="password" type="password" autoComplete="new-password" minLength={8} required className={authInputClass} /></label>
      <button className={authButtonClass}>Criar cadastro</button>
    </form>
  </AuthShell>;
}
