import type { ReactNode } from "react";

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;

export function linkify(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  const pattern = new RegExp(URL_PATTERN);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const raw = match[0];
    const trimmed = raw.replace(/[),.!?;:]+$/g, "");
    const trailing = raw.slice(trimmed.length);
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    parts.push(
      <a key={key++} href={trimmed} target="_blank" rel="noreferrer" className="break-all text-blue-600 underline underline-offset-2 hover:text-blue-700">
        {trimmed}
      </a>
    );
    if (trailing) parts.push(trailing);
    lastIndex = match.index + raw.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}
