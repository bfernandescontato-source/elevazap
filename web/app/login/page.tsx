import { Shield } from "lucide-react";

export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form action="/api/auth/login" method="post" className="w-full max-w-sm rounded-lg border border-line bg-panel p-6 shadow-soft">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-lg bg-accent text-white"><Shield size={20} /></div>
          <div>
            <h1 className="text-lg font-semibold text-ink">ElevaZap Ops</h1>
            <p className="text-sm text-muted">Acesso administrativo</p>
          </div>
        </div>
        {searchParams.error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">Credenciais inválidas.</div> : null}
        <label className="text-sm font-medium text-ink">Email</label>
        <input name="email" type="email" required className="focus-ring mt-1 h-11 w-full rounded-lg border border-line px-3" />
        <label className="mt-4 block text-sm font-medium text-ink">Senha</label>
        <input name="password" type="password" required className="focus-ring mt-1 h-11 w-full rounded-lg border border-line px-3" />
        <button className="mt-6 h-11 w-full rounded-lg bg-accent text-sm font-medium text-white">Entrar</button>
      </form>
    </main>
  );
}
