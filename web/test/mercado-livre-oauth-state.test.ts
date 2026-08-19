import { describe, expect, it } from "vitest";
import { signMercadoLivreOAuthState, verifyMercadoLivreOAuthState } from "../modules/affiliate-catalog/server/mercado-livre-oauth-state";

const secret = new TextEncoder().encode("a".repeat(32));
const otherSecret = new TextEncoder().encode("b".repeat(32));

describe("mercado-livre-oauth-state", () => {
  it("assina e verifica um state válido", async () => {
    const state = await signMercadoLivreOAuthState(secret);
    expect(await verifyMercadoLivreOAuthState(state, secret)).toBe(true);
  });

  it("rejeita um token adulterado", async () => {
    const state = await signMercadoLivreOAuthState(secret);
    const tampered = `${state}x`;
    expect(await verifyMercadoLivreOAuthState(tampered, secret)).toBe(false);
  });

  it("rejeita quando o segredo usado na verificação é diferente", async () => {
    const state = await signMercadoLivreOAuthState(secret);
    expect(await verifyMercadoLivreOAuthState(state, otherSecret)).toBe(false);
  });
});
