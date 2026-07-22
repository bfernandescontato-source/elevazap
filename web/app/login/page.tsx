import { BrandLogo } from "../../components/brand-logo";

export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form action="/api/auth/login" method="post" className="w-full max-w-sm rounded-lg border border-line bg-panel p-6 shadow-soft">
        <div className="mb-6">
          <BrandLogo className="h-16 w-full" imageClassName="w-[310px]" />
          <p className="mt-1 text-center text-sm text-muted">Acesse sua central de envios</p>
        </div>
        {searchParams.error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">Credenciais inválidas.</div> : null}
        <label className="text-sm font-medium text-ink">Email</label>
        <input name="email" type="email" required className="focus-ring mt-1 h-11 w-full rounded-lg border border-line px-3" />
        <label className="mt-4 block text-sm font-medium text-ink">Senha</label>
        <input name="password" type="password" required className="focus-ring mt-1 h-11 w-full rounded-lg border border-line px-3" />
        <button className="mt-6 h-11 w-full rounded-lg bg-black text-sm font-medium text-white transition hover:bg-zinc-800">Entrar</button>
      </form>
    </main>
  );
}
