import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OfferPageGrid } from "@/components/offer-page-grid";
import { getPublicOfferPage } from "@/modules/offer-page/server/offer-page-service";

// Vitrine pública do aluno (link da bio). Fora do middleware de login.
// O conteúdo é refeito no máximo a cada 60 s (cache em getPublicOfferPage).
export const revalidate = 60;

type Props = { params: Promise<{ slug: string }> };

function siteUrl() {
  try { return new URL(process.env.NEXT_PUBLIC_APP_URL || ""); } catch { return undefined; }
}

async function loadPage(slug: string) {
  try { return await getPublicOfferPage(slug); }
  catch { return null; }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const page = await loadPage(slug);
  if (!page) return { title: "Vitrine não encontrada", robots: { index: false, follow: false } };
  const description = page.bio || `Ofertas com link direto para comprar. ${page.items.length} ofertas recentes.`;
  const image = page.items.find((item) => item.imageUrl)?.imageUrl || page.avatarUrl || undefined;
  return {
    title: { absolute: page.title },
    description,
    metadataBase: siteUrl(),
    alternates: { canonical: `/v/${page.slug}` },
    openGraph: { type: "website", title: page.title, description, url: `/v/${page.slug}`, images: image ? [{ url: image }] : undefined, locale: "pt_BR" },
    twitter: { card: image ? "summary_large_image" : "summary", title: page.title, description, images: image ? [image] : undefined }
  };
}

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("") || "?";

export default async function OfferPage({ params }: Props) {
  const { slug } = await params;
  // Erro do banco aqui não vira 404: o Next mantém a última versão boa da página.
  const page = await getPublicOfferPage(slug);
  if (!page) notFound();
  return <div className="min-h-dvh bg-[#FAF5EE] text-[#3A332E]">
    <main className="mx-auto max-w-5xl px-4 pb-16 pt-[max(1.5rem,env(safe-area-inset-top))]">
      <header className="mb-4 flex flex-col items-center text-center">
        {page.avatarUrl
          ? <img src={page.avatarUrl} alt="" className="h-20 w-20 rounded-full border-4 border-[#FFFDFC] object-cover shadow-[0_8px_24px_rgba(58,51,46,0.12)]" />
          : <span className="grid h-20 w-20 place-items-center rounded-full bg-[#2F7F88] text-2xl font-semibold text-white">{initials(page.title)}</span>}
        <h1 className="mt-3 text-2xl font-bold leading-tight">{page.title}</h1>
        {page.bio ? <p className="mt-1 max-w-md text-sm leading-relaxed text-[#746D68]">{page.bio}</p> : null}
      </header>
      <OfferPageGrid items={page.items} />
      <p className="mt-10 text-center text-xs leading-relaxed text-[#746D68]">Preço e estoque podem mudar a qualquer momento no site da loja.<br />Os links desta página são de afiliado.</p>
    </main>
  </div>;
}
