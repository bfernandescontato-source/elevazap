export class MercadoLivreSessionError extends Error {
  readonly code: "SESSION_INVALID" | "NO_TAG" | "UNAVAILABLE" | "REJECTED";
}
export function cookieHeader(cookies: Record<string, string>): string;
export function createMercadoLivreLinkWithSession(input: { cookies: Record<string, string>; productUrl: string; tag?: string | null; fetcher?: typeof fetch }): Promise<string>;
