import { describe, expect, it } from "vitest";
import { filterMetaPayloadForPhoneNumber, metaRelayIdempotencyKey, metaRelayRetryDelaySeconds, shouldRetryMetaRelay } from "../modules/official-whatsapp/server/meta-relay";

const relayPhone = "1238424652690963";
const otherPhone = "9999999999999999";

function payload(changes: unknown[]) {
  return { object: "whatsapp_business_account", entry: [{ id: "waba-1", changes }] };
}

function change(phoneNumberId: string, value: Record<string, unknown>) {
  return { field: "messages", value: { metadata: { phone_number_id: phoneNumberId, display_phone_number: "+55 11 99999-9999" }, ...value } };
}

describe("filtro de privacidade do relay Meta", () => {
  it("não cria payload para outro phone_number_id", () => {
    expect(filterMetaPayloadForPhoneNumber(payload([change(otherPhone, { messages: [{ id: "wamid.other" }] })]), relayPhone)).toBeNull();
  });

  it("preserva a mensagem recebida e todos os campos originais", () => {
    const original = payload([change(relayPhone, { contacts: [{ profile: { name: "Ana" } }], messages: [{ id: "wamid.inbound", from: "5511999999999", type: "text", text: { body: "Olá" } }], referral: { source_url: "https://example.com" } })]);
    expect(filterMetaPayloadForPhoneNumber(original, relayPhone)).toEqual(original);
  });

  it.each(["sent", "delivered", "read"])("preserva status %s", (status) => {
    const original = payload([change(relayPhone, { statuses: [{ id: "wamid.status", status, timestamp: "1720000000", recipient_id: "5511999999999" }] })]);
    expect(filterMetaPayloadForPhoneNumber(original, relayPhone)).toEqual(original);
  });

  it("filtra múltiplos changes e nunca vaza dados de outro número", () => {
    const original = payload([
      change(relayPhone, { messages: [{ id: "wamid.target", type: "interactive", interactive: { type: "button_reply" } }] }),
      change(otherPhone, { messages: [{ id: "wamid.private", text: { body: "não encaminhar" } }] }),
      change(relayPhone, { statuses: [{ id: "wamid.target", status: "read", timestamp: "1720000001" }] })
    ]);
    const filtered = filterMetaPayloadForPhoneNumber(original, relayPhone);
    expect(filtered?.entry?.[0].changes).toHaveLength(2);
    expect(JSON.stringify(filtered)).not.toContain("wamid.private");
    expect(JSON.stringify(filtered)).toContain("wamid.target");
  });

  it("deduplica uma repetição idêntica, mas mantém cada mudança de status do mesmo wamid", () => {
    const sent = payload([change(relayPhone, { statuses: [{ id: "wamid.same", status: "sent", timestamp: "1720000000" }] })]);
    const delivered = payload([change(relayPhone, { statuses: [{ id: "wamid.same", status: "delivered", timestamp: "1720000001" }] })]);
    expect(metaRelayIdempotencyKey(sent, relayPhone)).toBe(metaRelayIdempotencyKey(structuredClone(sent), relayPhone));
    expect(metaRelayIdempotencyKey(sent, relayPhone)).not.toBe(metaRelayIdempotencyKey(delivered, relayPhone));
  });

  it("reagenda timeout, 429 e 5xx, mas encerra 4xx permanente", () => {
    expect(shouldRetryMetaRelay(null)).toBe(true);
    expect(shouldRetryMetaRelay(429)).toBe(true);
    expect(shouldRetryMetaRelay(500)).toBe(true);
    expect(shouldRetryMetaRelay(400)).toBe(false);
    expect([1, 2, 3, 4].map(metaRelayRetryDelaySeconds)).toEqual([30, 120, 600, 1800]);
  });
});
