import { AuthShell, BackToLogin } from "@/components/auth-shell";

export default function PendingPage() {
  return <AuthShell title="Cadastro recebido" description="Seu cadastro foi criado. Um administrador precisa aprovar o acesso antes de você entrar no painel." footer={<BackToLogin />}>
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">Por segurança, novos cadastros não recebem acesso automático aos dados da operação.</div>
  </AuthShell>;
}
