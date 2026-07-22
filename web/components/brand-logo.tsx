import Image from "next/image";

export function BrandLogo({
  className = "h-12 w-full",
  imageClassName = "w-[250px]"
}: {
  className?: string;
  imageClassName?: string;
}) {
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <Image
        src="/disparei-logo.png"
        alt="Disparei"
        width={1450}
        height={1086}
        priority
        className={`absolute left-1/2 top-1/2 h-auto max-w-none -translate-x-1/2 -translate-y-1/2 ${imageClassName}`}
      />
    </div>
  );
}
