import { describe, expect, it } from "vitest";
import { maskPhone, normalizeBrazilianPhone, phoneToWhatsAppJid, validateGroupJid } from "../lib/phone";
import { validateMedia, webhookPayloadSchema } from "../lib/schemas";
import { canMoveToProcessing, nextQueueKind, recoverStuckStatus, shouldAutoRetry } from "../lib/state-machine";

describe("telefone e JID", () => {
  it("normaliza telefones brasileiros", () => {
    expect(normalizeBrazilianPhone("+55 (11) 99999-9999")).toBe("5511999999999");
    expect(normalizeBrazilianPhone("11999999999")).toBe("5511999999999");
  });

  it("gera máscara e JID", () => {
    expect(maskPhone("5511999999999")).toBe("55 11 *****-9999");
    expect(phoneToWhatsAppJid("5511999999999")).toBe("5511999999999@s.whatsapp.net");
  });

  it("valida group_jid", () => {
    expect(validateGroupJid("120363123456@g.us")).toBe(true);
    expect(validateGroupJid("5511999999999@s.whatsapp.net")).toBe(false);
  });
});

describe("webhook e mídia", () => {
  it("valida payload ElevaPay", () => {
    expect(webhookPayloadSchema.safeParse({
      event: "compra.aprovada",
      order_id: "ord_123",
      transaction_id: "txn_456",
      nome: "Fulano",
      telefone: "5511999999999",
      produto: "Shop Lab",
      email: "fulano@email.com"
    }).success).toBe(true);
  });

  it("rejeita mídia inválida e aceita imagem dentro do limite", () => {
    expect(validateMedia("imagem", "image/png", 1024).ok).toBe(true);
    expect(validateMedia("imagem", "video/mp4", 1024).ok).toBe(false);
    expect(validateMedia("video", "video/mp4", 30 * 1024 * 1024).ok).toBe(false);
  });
});

describe("fila e estados", () => {
  it("claim_token é obrigatório para processar", () => {
    expect(canMoveToProcessing({ status: "enfileirado", claim_token: "a" }, "a")).toBe(true);
    expect(canMoveToProcessing({ status: "enfileirado", claim_token: "a" }, "b")).toBe(false);
    expect(canMoveToProcessing({ status: "pausado", claim_token: "a" }, "a")).toBe(false);
    expect(canMoveToProcessing({ status: "cancelado", claim_token: "a" }, "a")).toBe(false);
  });

  it("recupera travados sem reenviar incertos automaticamente", () => {
    const now = Date.now();
    expect(recoverStuckStatus({ status: "processando", started_at: new Date(now - 6 * 60 * 1000).toISOString() }, now)).toBe("incerto");
    expect(recoverStuckStatus({ status: "enfileirado", claimed_at: new Date(now - 16 * 60 * 1000).toISOString() }, now)).toBe("pendente");
    expect(shouldAutoRetry("incerto")).toBe(false);
  });

  it("boas-vindas têm prioridade sobre grupos e buffer pode ser pequeno", () => {
    expect(nextQueueKind(true, true)).toBe("envio");
    expect(nextQueueKind(false, true)).toBe("grupo");
  });
});
