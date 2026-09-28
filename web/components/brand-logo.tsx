import Image from "next/image";

export function BrandLogo({
  className = "h-12 w-full",
  imageClassName = "w-[250px]"
}: {
  className?: string;
  imageClassName?: string;
}) {
  const position = `absolute left-1/2 top-1/2 h-auto max-w-none -translate-x-1/2 -translate-y-1/2 ${imageClassName}`;
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <Image
        src="/disparei-logo.png"
        alt="Disparei"
        width={1450}
        height={1086}
        priority
        className={`brand-logo terra:hidden ${position}`}
      />
      {/* Tema terra: logo em teal com fundo transparente. Escondida no clássico
          (loading="lazy" + display:none → o navegador não baixa). */}
      <img src="/disparei-logo-terra.png" alt="Disparei" width={1448} height={1086} loading="lazy" className={`hidden terra:block ${position}`} />
    </div>
  );
}
