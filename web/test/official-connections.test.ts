import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

const mocks = vi.hoisted(() => ({ result: { data: null as any, error: null as any }, writes: [] as any[], config: {} as Record<string, string> }));
vi.mock("@/lib/env", () => ({ env: () => mocks.config }));
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: () => ({ from: () => {
  const query: any = {};
  for (const key of ["select", "eq", "neq", "order", "limit"]) query[key] = () => query;
  for (const key of ["insert", "update"]) query[key] = (data: unknown) => { mocks.writes.push(data); return query; };
  query.single = query.maybeSingle = async () => mocks.result;
  query.then = (resolve: any) => Promise.resolve(mocks.result).then(resolve);
  return query;
} }) }));

import { connectionIdSchema, createOfficialConnection, listOfficialConnections, listWebhookCredentials, officialConnectionInputSchema, resolveOfficialConnection, webhookVerifyTokenMatches } from "../modules/official-whatsapp/server/official-connections";
import { decryptIntegrationSecret, encryptIntegrationSecret } from "../lib/integration-crypto";

const input = { label: "Conta de teste", appId: "123456", wabaId: "234567", phoneNumberId: "345678", accessToken: "test-access-token-".repeat(5), appSecret: "test-app-secret-123456789", graphVersion: "v25.0" };
const connectionId = "a88036ae-0f27-4162-bc29-0bcded31b2fe";

beforeEach(() => {
  mocks.config = { INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"), META_ACCESS_TOKEN: "legacy-token", META_PHONE_NUMBER_ID: "999999", META_WABA_ID: "888888", META_APP_SECRET: "legacy-app-secret-123", META_GRAPH_VERSION: "v25.0", META_WEBHOOK_VERIFY_TOKEN: "legacy-verify-token" };
  mocks.result = { data: { id: connectionId, label: input.label }, error: null };
  mocks.writes = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const data = url.includes("debug_token") ? { data: { is_valid: true, app_id: input.appId, scopes: ["whatsapp_business_management", "whatsapp_business_messaging"] } }
      : url.includes("phone_numbers") ? { data: [{ id: input.phoneNumberId }] }
      : url.includes("subscribed_apps") ? { data: [{ whatsapp_business_api_data: { id: input.appId } }] }
      : { id: input.phoneNumberId, display_phone_number: "+55 11 99999-9999", quality_rating: "GREEN", throughput: { level: "STANDARD" } };
    return new Response(JSON.stringify(data), { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("contas oficiais: validação e proteção de credenciais", () => {
  it("normaliza a conta atual e rejeita IDs arbitrários", () => {
    expect(connectionIdSchema.parse("legacy")).toBeNull();
    expect(connectionIdSchema.parse(undefined)).toBeNull();
    expect(connectionIdSchema.parse(connectionId)).toBe(connectionId);
    expect(() => connectionIdSchema.parse("other-account")).toThrow();
  });
  it("exige IDs numéricos, aplicativo e credenciais completas", () => {
    expect(officialConnectionInputSchema.safeParse(input).success).toBe(true);
    for (const invalid of [{ appId: "" }, { phoneNumberId: "+55 11 99999-9999" }, { accessToken: "short" }, { graphVersion: "../../secrets" }]) expect(officialConnectionInputSchema.safeParse({ ...input, ...invalid }).success).toBe(false);
  });
  it("cifra tokens com IV aleatório e autentica alterações no ciphertext", () => {
    const a = encryptIntegrationSecret(input.accessToken);
    const b = encryptIntegrationSecret(input.accessToken);
    expect(a).not.toEqual(b);
    expect(a).not.toContain(input.accessToken);
    expect(decryptIntegrationSecret(a)).toBe(input.accessToken);
    const parts = a.split("."); parts[2] = Buffer.alloc(16).toString("base64url");
    expect(() => decryptIntegrationSecret(parts.join("."))).toThrow();
  });
  it("preserva a conta atual e bloqueia conta desativada sem fallback", async () => {
    expect((await resolveOfficialConnection("legacy")).phoneNumberId).toBe("999999");
    mocks.result.data = { status: "disabled" };
    await expect(resolveOfficialConnection(connectionId)).rejects.toThrow(/desativada/);
    mocks.result.data = null;
    await expect(resolveOfficialConnection(connectionId)).rejects.toThrow();
  });
  it("não duplica o número legado", async () => {
    await expect(createOfficialConnection({ ...input, phoneNumberId: "999999" }, "admin@example.com")).rejects.toThrow(/principal/);
    expect(mocks.writes).toHaveLength(0);
  });
  it("bloqueia envios de conta ainda sem webhook completo", async () => {
    mocks.result.data = { id: connectionId, status: "connected", webhook_verified_at: null, app_subscribed: true };
    await expect(resolveOfficialConnection(connectionId, true)).rejects.toThrow(/Finalize/);
  });
  it("salva somente credenciais cifradas e hash do token de verificação", async () => {
    const result = await createOfficialConnection(input, "admin@example.com");
    expect(result.verifyToken).toHaveLength(64);
    const saved = mocks.writes[0];
    expect(decryptIntegrationSecret(saved.encrypted_access_token)).toBe(input.accessToken);
    expect(decryptIntegrationSecret(saved.encrypted_app_secret)).toBe(input.appSecret);
    expect(JSON.stringify(saved)).not.toContain(result.verifyToken);
    expect(saved.webhook_verify_token_hash).toHaveLength(64);
    expect(saved.app_subscribed).toBe(true);
    expect(JSON.stringify(result)).not.toContain(input.accessToken);
  });
  it("rejeita token de outro aplicativo antes de persistir", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: { is_valid: true, app_id: "another-app" } })));
    await expect(createOfficialConnection(input, "admin@example.com")).rejects.toThrow(/aplicativo/);
    expect(mocks.writes).toHaveLength(0);
  });
  it("rejeita token sem permissão de envio", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: { is_valid: true, app_id: input.appId, scopes: ["whatsapp_business_management"] } })));
    await expect(createOfficialConnection(input, "admin@example.com")).rejects.toThrow(/whatsapp_business_messaging/);
    expect(mocks.writes).toHaveLength(0);
  });
  it("rejeita número que não pertence à WABA", async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (...args) => String(args[0]).includes("phone_numbers") ? new Response(JSON.stringify({ data: [] })) : original(...args));
    await expect(createOfficialConnection(input, "admin@example.com")).rejects.toThrow(/não pertence/);
    expect(mocks.writes).toHaveLength(0);
  });
  it("não expõe segredos na lista e mantém o legado", async () => {
    mocks.result.data = [{ id: connectionId, label: "Conta B" }];
    const list = await listOfficialConnections();
    expect(list.map((row) => row.id)).toEqual(["legacy", connectionId]);
    expect(JSON.stringify(list)).not.toContain("legacy-token");
  });
  it("aceita handshake legado e recusa token inválido sem falhar com Unicode", async () => {
    expect(await webhookVerifyTokenMatches("legacy-verify-token")).toBe(true);
    mocks.result.data = [];
    expect(await webhookVerifyTokenMatches("é".repeat(19))).toBe(false);
  });
  it("mantém assinatura vinculada à identidade do número mesmo após desativação", async () => {
    mocks.result.data = [{ id: connectionId, phone_number_id: input.phoneNumberId, waba_id: input.wabaId, encrypted_app_secret: encryptIntegrationSecret(input.appSecret) }];
    const credentials = await listWebhookCredentials();
    const signed = createHmac("sha256", input.appSecret).update("payload").digest("hex");
    const matching = credentials.filter((credential) => createHmac("sha256", credential.appSecret).update("payload").digest("hex") === signed);
    expect(matching.map((row) => row.id)).toEqual([connectionId]);
    expect(matching[0].phoneNumberId).toBe(input.phoneNumberId);
  });
});
