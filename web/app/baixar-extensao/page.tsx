import { CheckCircle2, Chrome, Download, ExternalLink, Puzzle } from "lucide-react";

export const metadata = {
  title: "Baixar extensão do Mercado Livre",
  description: "Baixe e instale a extensão Disparei para Mercado Livre."
};

const steps = [
  "Baixe o arquivo ZIP usando o botão abaixo.",
  "Descompacte o arquivo em uma pasta no seu computador.",
  "No Chrome, abra chrome://extensions e ative o Modo do desenvolvedor.",
  "Clique em Carregar sem compactação e selecione a pasta descompactada."
];

export default function DownloadExtensionPage() {
  return (
    <main className="min-h-screen bg-[#f7f7f7] px-4 py-10 sm:px-6 sm:py-16">
      <div className="mx-auto max-w-3xl">
        <div className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-xl shadow-zinc-950/5">
          <section className="bg-zinc-950 px-6 py-10 text-white sm:px-12 sm:py-14">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#ffe600] text-zinc-950">
              <Chrome size={26} strokeWidth={2.4} />
            </div>
            <p className="mt-7 text-sm font-semibold uppercase tracking-[0.18em] text-[#ffe600]">Extensão para Chrome</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Disparei para Mercado Livre</h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-zinc-300">Instale a extensão para conectar sua conta do Mercado Livre e gerar links de afiliado direto pela Disparei.</p>
          </section>

          <section className="px-6 py-8 sm:px-12 sm:py-10">
            <a
              href="/downloads/mercado-livre.zip"
              download="mercado-livre.zip"
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#ffe600] px-5 text-sm font-bold text-zinc-950 transition hover:bg-[#f5d900] sm:w-auto"
            >
              <Download size={18} />
              Baixar extensão
            </a>
            <p className="mt-3 text-sm text-zinc-500">Arquivo ZIP · aproximadamente 4,5 MB</p>

            <div className="my-9 h-px bg-zinc-200" />

            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-lg bg-zinc-100 p-2 text-zinc-700"><Puzzle size={19} /></div>
              <div>
                <h2 className="text-xl font-bold tracking-tight text-zinc-950">Como instalar</h2>
                <ol className="mt-5 space-y-4">
                  {steps.map((step, index) => (
                    <li key={step} className="flex gap-3 text-sm leading-6 text-zinc-600">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-xs font-bold text-white">{index + 1}</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            <div className="mt-9 flex items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm leading-6 text-emerald-950">
              <CheckCircle2 className="mt-0.5 shrink-0 text-emerald-600" size={19} />
              <p>Depois da instalação, acesse a área de <strong>Integrações</strong> na Disparei e conecte sua conta do Mercado Livre.</p>
            </div>

            <a href="https://chrome.google.com/webstore" target="_blank" rel="noreferrer" className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-zinc-600 hover:text-zinc-950">
              Saiba mais sobre extensões do Chrome <ExternalLink size={15} />
            </a>
          </section>
        </div>
      </div>
    </main>
  );
}
