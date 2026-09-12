import { describe, expect, it } from "vitest";
import { OfferProcessor } from "../offers/offer-processor.js";
import type { RawOfferMessage } from "../offers/types.js";

// Fake mínimo do client Supabase cobrindo só as chamadas que OfferProcessor.process()
// realmente faz: offer_automations (checagem de enabled), affiliate_integrations
// (status da integração) e captured_offers (insert + updates), além do rpc de
// agendamento. Cada from(table) devolve um novo "chain" encadeável e awaitable.
function makeDatabase(options: {
  automationEnabled?: boolean;
  integrations?: Array<{ provider: string; status: string }>;
  scheduleStatus?: "scheduled" | "waiting";
}) {
  const automationEnabled = options.automationEnabled ?? true;
  const integrations = options.integrations ?? [];
  const updates: Array<{ table: string; payload: any }> = [];
  let insertedOffer: any = null;

  function chain(result: { data: any; error: any }, onInsert?: (payload: any) => void, table?: string) {
    const self: any = {
      select: () => self,
      eq: () => self,
      in: () => self,
      insert: (payload: any) => {
        insertedOffer = { id: "offer-1", status: "processing", processing_attempts: 0, ...payload };
        return chain({ data: insertedOffer, error: null });
      },
      update: (payload: any) => {
        if (table) updates.push({ table, payload });
        return chain({ data: null, error: null });
      },
      maybeSingle: async () => Array.isArray(result.data) ? { data: result.data[0] || null, error: result.error } : result,
      single: async () => result,
      then: (onFulfilled: any, onRejected: any) => Promise.resolve(result).then(onFulfilled, onRejected)
    };
    return self;
  }

  const database = {
    from(table: string) {
      if (table === "offer_automations") return chain({ data: { enabled: automationEnabled }, error: null }, undefined, table);
      if (table === "affiliate_integrations") return chain({ data: integrations, error: null }, undefined, table);
      if (table === "captured_offers") return chain({ data: insertedOffer, error: null }, undefined, table);
      return chain({ data: null, error: null }, undefined, table);
    },
    rpc: async (name: string) => {
      if (name === "schedule_pilot_offer") {
        return { data: { status: options.scheduleStatus || "scheduled", scheduled_at: options.scheduleStatus === "waiting" ? undefined : new Date().toISOString(), destinations: 1 }, error: null };
      }
      return { data: null, error: null };
    },
    storage: { from: () => ({ upload: async () => ({ error: null }) }) }
  };

  return { database, updates, getInsertedOffer: () => insertedOffer };
}

const baseAutomation = {
  id: "automation-1",
  account_id: "account-1",
  created_by: null,
  whatsapp_sender_id: "sender-1",
  interval_minutes: 5,
  operating_start: "00:00",
  operating_end: "23:59",
  timezone: "America/Sao_Paulo",
  keep_original_text: true,
  keep_original_media: false,
  ai_rewrite_enabled: false,
  shopee_conversion_enabled: false,
  mercado_livre_conversion_enabled: false,
  conversion_failure_policy: "pause" as const,
  whatsapp_senders: { session_name: "session-1" }
};

function buildMessage(text: string): RawOfferMessage {
  return {
    sourceType: "whatsapp",
    sourceMessageId: `msg-${Math.random().toString(36).slice(2)}`,
    sourceGroupId: "120363000000000@g.us",
    text,
    timestamp: new Date()
  };
}

const SHOPEE_LINK = "https://shopee.com.br/produto-teste";
const MERCADO_LIVRE_LINK = "https://www.mercadolivre.com.br/produto-teste";
const AMAZON_LINK = "https://www.amazon.com.br/produto-teste";

describe("gate de marketplace conectado/não conectado no Piloto Automático", () => {
  it("Mercado Livre conectado + link ML → envia (segue para agendamento)", async () => {
    const { database, updates } = makeDatabase({ integrations: [{ provider: "mercado_livre", status: "connected" }] });
    const processor = new OfferProcessor(database as any);
    const result = await processor.process(baseAutomation, buildMessage(`Oferta boa\n${MERCADO_LIVRE_LINK}`));
    expect(result?.status).toBe("scheduled");
    expect(updates.some((u) => u.payload.status === "ignored")).toBe(false);
  });

  it("Mercado Livre desconectado + link ML → não envia", async () => {
    const { database, updates } = makeDatabase({ integrations: [] });
    const processor = new OfferProcessor(database as any);
    const result = await processor.process(baseAutomation, buildMessage(`Oferta boa\n${MERCADO_LIVRE_LINK}`));
    expect(result?.status).toBe("ignored");
    const ignoreUpdate = updates.find((u) => u.payload.status === "ignored");
    expect(ignoreUpdate?.payload.error_code).toBe("MERCADO_LIVRE_NOT_CONNECTED");
  });

  it("Shopee conectada + link Shopee → envia (segue para agendamento)", async () => {
    const { database, updates } = makeDatabase({ integrations: [{ provider: "shopee", status: "connected" }] });
    const processor = new OfferProcessor(database as any);
    const result = await processor.process(baseAutomation, buildMessage(`Corre\n${SHOPEE_LINK}`));
    expect(result?.status).toBe("scheduled");
    expect(updates.some((u) => u.payload.status === "ignored")).toBe(false);
  });

  it("mantém a oferta de texto quando a mídia do WhatsApp não pode ser descriptografada", async () => {
    const { database, updates } = makeDatabase({ integrations: [{ provider: "shopee", status: "connected" }] });
    const processor = new OfferProcessor(database as any);
    const message = buildMessage(`Corre\n${SHOPEE_LINK}`);
    message.hasMedia = true;
    message.mediaLoader = async () => { throw new Error("bad decrypt"); };
    const result = await processor.process(baseAutomation, message);
    expect(result?.status).toBe("scheduled");
    expect(updates.some((u) => u.payload.status === "processing_failed")).toBe(false);
  });

  it("Shopee desconectada + link Shopee → não envia", async () => {
    const { database, updates } = makeDatabase({ integrations: [] });
    const processor = new OfferProcessor(database as any);
    const result = await processor.process(baseAutomation, buildMessage(`Corre\n${SHOPEE_LINK}`));
    expect(result?.status).toBe("ignored");
    const ignoreUpdate = updates.find((u) => u.payload.status === "ignored");
    expect(ignoreUpdate?.payload.error_code).toBe("SHOPEE_NOT_CONNECTED");
  });

  it("Amazon sem Partner Tag → não envia", async () => {
    const { database, updates } = makeDatabase({ integrations: [] });
    const processor = new OfferProcessor(database as any);
    const result = await processor.process(baseAutomation, buildMessage(`Promo\n${AMAZON_LINK}`));
    expect(result?.status).toBe("ignored");
    const ignoreUpdate = updates.find((u) => u.payload.status === "ignored");
    expect(ignoreUpdate?.payload.error_code).toBe("AMAZON_NOT_CONNECTED");
  });

  it("Amazon conectada converte com o Partner Tag da conta e segue para agendamento", async () => {
    const { database, updates } = makeDatabase({ integrations: [{ provider: "amazon", status: "connected", affiliate_tag: "conta-certa-20" }] as any });
    const processor = new OfferProcessor(database as any);
    const result = await processor.process(baseAutomation, buildMessage(`Promo\n${AMAZON_LINK}?ref_=grupo&tag=outra-conta-20&TAG=duplicada-20`));
    expect(result?.status).toBe("scheduled");
    const converted = updates.find((u) => typeof u.payload.processed_text === "string" && u.payload.affiliate_conversion_status === "converted");
    const link = new URL(converted?.payload.affiliate_link);
    expect(link.searchParams.get("ref_")).toBe("grupo");
    expect(Array.from(link.searchParams.entries()).filter(([key]) => key.toLowerCase() === "tag")).toEqual([["tag", "conta-certa-20"]]);
  });

  it("Amazon excedente usa o mesmo resultado waiting da fila existente", async () => {
    const { database } = makeDatabase({ integrations: [{ provider: "amazon", status: "connected", affiliate_tag: "conta-certa-20" }] as any, scheduleStatus: "waiting" });
    const processor = new OfferProcessor(database as any);
    const result = await processor.process(baseAutomation, buildMessage(`Promo\n${AMAZON_LINK}`));
    expect(result?.status).toBe("waiting");
    expect(result?.scheduled_at).toBeUndefined();
  });

  it("falha de conversão Amazon nunca usa send_original nem agenda a oferta", async () => {
    const { database, updates } = makeDatabase({ integrations: [{ provider: "amazon", status: "connected", affiliate_tag: "conta-certa-20" }] as any });
    const automation = { ...baseAutomation, conversion_failure_policy: "send_original" as const };
    const failedConverter = { convert: async () => { throw new Error("Link curto inválido"); } };
    const processor = new OfferProcessor(database as any, failedConverter as any);
    const result = await processor.process(automation, buildMessage(`Promo\n${AMAZON_LINK}`));
    expect(result?.status).toBe("processing_failed");
    expect(result?.error_code).toBe("AMAZON_LINK_CONVERSION_FAILED");
    expect(updates.some((update) => update.payload.status === "processing_failed")).toBe(true);
    expect(updates.some((update) => update.payload.status === "scheduled")).toBe(false);
  });

  it("só cupom, sem link válido → não envia", async () => {
    const { database, updates } = makeDatabase({ integrations: [] });
    const processor = new OfferProcessor(database as any);
    const result = await processor.process(baseAutomation, buildMessage("Use o cupom PROMO10 e ganhe 10% de desconto!"));
    expect(result?.status).toBe("ignored");
    const ignoreUpdate = updates.find((u) => u.payload.status === "ignored");
    expect(ignoreUpdate?.payload.error_code).toBe("UNSUPPORTED_MARKETPLACE_LINK");
  });

  it("cupom + link de marketplace conectado → pode enviar a mensagem normalmente", async () => {
    const { database, updates } = makeDatabase({ integrations: [{ provider: "shopee", status: "connected" }] });
    const processor = new OfferProcessor(database as any);
    const text = `Use o cupom PROMO10\n${SHOPEE_LINK}`;
    const result = await processor.process(baseAutomation, buildMessage(text));
    expect(result?.status).toBe("scheduled");
    expect(updates.some((u) => u.payload.status === "ignored")).toBe(false);
  });

  it("cupom + link de marketplace desconectado → não envia a mensagem inteira (não remove o link, não envia parcial)", async () => {
    const { database, updates, getInsertedOffer } = makeDatabase({ integrations: [] });
    const processor = new OfferProcessor(database as any);
    const text = `Use o cupom PROMO10\n${MERCADO_LIVRE_LINK}`;
    const result = await processor.process(baseAutomation, buildMessage(text));
    expect(result?.status).toBe("ignored");
    const ignoreUpdate = updates.find((u) => u.payload.status === "ignored");
    expect(ignoreUpdate?.payload.error_code).toBe("MERCADO_LIVRE_NOT_CONNECTED");
    // A oferta inteira (cupom + link) fica preservada intacta no registro
    // capturado — o link não é removido, e nada é reenviado parcialmente.
    expect(getInsertedOffer()?.original_text).toContain(MERCADO_LIVRE_LINK);
    expect(getInsertedOffer()?.original_text).toContain("PROMO10");
  });

  it("status 'connected' é a única condição aceita — 'pending'/'error'/'disabled' contam como não conectado", async () => {
    const { database, updates } = makeDatabase({ integrations: [{ provider: "shopee", status: "error" }] });
    const processor = new OfferProcessor(database as any);
    const result = await processor.process(baseAutomation, buildMessage(`Corre\n${SHOPEE_LINK}`));
    expect(result?.status).toBe("ignored");
    const ignoreUpdate = updates.find((u) => u.payload.status === "ignored");
    expect(ignoreUpdate?.payload.error_code).toBe("SHOPEE_NOT_CONNECTED");
  });
});
