// Variável {link_do_grupo}: no envio, entra o link de convite atual do grupo de
// destino. O link vem do próprio WhatsApp (groupInviteCode, exige admin) e fica
// em memória por pouco tempo, para não pedir o mesmo link a cada mensagem.
// Sem link (número não é admin, erro, tempo esgotado), a linha com a variável sai
// da mensagem: nunca vai texto com link quebrado ou com a variável crua.

export const GROUP_LINK_PLACEHOLDER = "{link_do_grupo}";

export function hasGroupLinkPlaceholder(text: unknown): text is string {
  return typeof text === "string" && text.includes(GROUP_LINK_PLACEHOLDER);
}

export function applyGroupLinkPlaceholder(text: string, link: string | null): string {
  if (!text.includes(GROUP_LINK_PLACEHOLDER)) return text;
  if (link) return text.split(GROUP_LINK_PLACEHOLDER).join(link);
  return text
    .split("\n")
    .filter((line) => !line.includes(GROUP_LINK_PLACEHOLDER))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function inviteUrlFromCode(code: unknown): string | null {
  if (typeof code !== "string") return null;
  const clean = code.trim();
  return /^[A-Za-z0-9]{10,64}$/.test(clean) ? `https://chat.whatsapp.com/${clean}` : null;
}

type CacheEntry = { link: string | null; expiresAt: number };

export class GroupInviteLinkCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<string | null>>();

  constructor(
    private readonly successTtlMs = 15 * 60_000,
    private readonly failureTtlMs = 5 * 60_000,
    private readonly maxEntries = 5_000,
    private readonly now: () => number = Date.now
  ) {}

  /** `fetchCode` pede o código ao WhatsApp; qualquer erro vira "sem link". */
  async resolve(sessionKey: string, groupJid: string, fetchCode: () => Promise<unknown>): Promise<string | null> {
    const key = `${sessionKey}:${groupJid}`;
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.link;
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;

    const request = (async () => {
      let link: string | null = null;
      try { link = inviteUrlFromCode(await fetchCode()); } catch { link = null; }
      if (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value as string);
      this.entries.set(key, { link, expiresAt: this.now() + (link ? this.successTtlMs : this.failureTtlMs) });
      return link;
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }

  forget(sessionKey: string, groupJid: string) {
    this.entries.delete(`${sessionKey}:${groupJid}`);
  }
}

export const groupInviteLinks = new GroupInviteLinkCache();
