"use client";

const PALETTE = [
  "bg-red-100 text-red-700", "bg-orange-100 text-orange-700", "bg-amber-100 text-amber-700", "bg-emerald-100 text-emerald-700",
  "bg-blue-100 text-blue-700", "bg-indigo-100 text-indigo-700", "bg-purple-100 text-purple-700", "bg-pink-100 text-pink-700"
];

function initials(name?: string | null, email?: string | null) {
  const source = (name || email || "?").trim();
  if (!source) return "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function colorFor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export function ComunidadeAvatar({ name, email, size = 40 }: { name?: string | null; email?: string | null; size?: number }) {
  const seed = name || email || "?";
  return (
    <div
      className={`grid shrink-0 place-items-center rounded-full font-semibold ${colorFor(seed)}`}
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.38) }}
      title={name || email || undefined}
    >
      {initials(name, email)}
    </div>
  );
}
