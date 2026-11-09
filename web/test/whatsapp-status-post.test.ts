import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  flag: true as boolean | null,
  sender: { id: "11111111-1111-4111-8111-111111111111", session_name: "numero-1" } as any,
  linkedGroups: ["1@g.us", "2@g.us"],
  todayCount: 0,
  failEnvio: false,
  inserts: [] as Array<{ table: string; values: any }>,
  deletes: [] as string[],
  filters: [] as Array<{ table: string; column: string; value: unknown }>,
  uploads: [] as string[],
  removed: [] as string[]
}));

function chain(table: string) {
  const state: { op: "select" | "insert" | "delete"; values?: any; head?: boolean; inValues?: string[] } = { op: "select" };
  const result = async () => {
    if (state.op === "insert") {
      db.inserts.push({ table, values: state.values });
      if (table === "envios_grupo" && db.failEnvio) return { data: null, error: { message: "falhou" } };
      return { data: { id: "lote-1" }, error: null };
    }
    if (state.op === "delete") { db.deletes.push(table); return { data: null, error: null }; }
    if (table === "accounts") return db.flag === null ? { data: null, error: { code: "42703" } } : { data: { whatsapp_status_enabled: db.flag }, error: null };
    if (table === "whatsapp_senders") return { data: db.sender, error: null };
    if (table === "whatsapp_sender_grupos") return { data: (state.inValues || []).filter(jid => db.linkedGroups.includes(jid)).map(group_jid => ({ group_jid })), error: null };
    if (table === "envios_grupo" && state.head) return { count: db.todayCount, data: null, error: null };
    return { data: null, error: null };
  };
  const api: any = {
    select: (_columns?: string, options?: { head?: boolean }) => { if (state.op === "select") state.head = Boolean(options?.head); return api; },
    insert: (values: any) => { state.op = "insert"; state.values = values; return api; },
    delete: () => { state.op = "delete"; return api; },
    eq: (column: string, value: unknown) => { db.filters.push({ table, column, value }); return api; },
    neq: () => api, gte: () => api,
    in: (_column: string, values: string[]) => { state.inValues = values; return api; },
    maybeSingle: result, single: result,
    then: (resolve: any, reject: any) => result().then(resolve, reject)
  };
  return api;
}

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: () => ({
    from: (table: string) => chain(table),
    storage: { from: () => ({
      upload: async (path: string) => { db.uploads.push(path); return { error: null }; },
      remove: async (paths: string[]) => { db.removed.push(...paths); return { error: null }; }
    }) }
  })
}));
vi.mock("../modules/offer-story/server/story-renderer", () => ({ renderOfferStory: vi.fn(async () => Buffer.from("jpeg")) }));
vi.mock("../modules/offer-story/server/story-photo", () => ({ fetchStoryPhoto: vi.fn(async () => null) }));

const { STATUS_JID, STATUS_DAILY_LIMIT, buildStatusEnvio, brasiliaDayStart, createStatusPost } = await import("../modules/offer-story/server/status-post-service");
const { statusPostSchema } = await import("../modules/offer-story/schemas");

const ACCOUNT = "acc-1";
const SENDER_ID = "11111111-1111-4111-8111-111111111111";
const offer = { provider: "SHOPEE" as const, externalItemId: "123", name: "Fone Bluetooth", priceMin: 99.9, originalPrice: 149.9, affiliateUrl: "https://s.shopee.com.br/abc" };
const input = () => ({ accountId: ACCOUNT, offer, message: "Achado! De R$ 149,90 por R$ 99,90 https://s.shopee.com.br/abc", senderId: SENDER_ID, audienceGroupJids: ["1@g.us", "2@g.us", "1@g.us"] });

describe("Status do WhatsApp: linha da fila", () => {
  it("monta um envio de imagem para status@broadcast com os grupos de público", () => {
    const row = buildStatusEnvio({ accountId: ACCOUNT, loteId: "lote-1", sender: { id: "s1", session_name: "numero-1" }, media: { bucket: "whatsapp-media", path: "accounts/acc-1/stories/x.jpg", size: 10 }, message: "Oferta https://s.shopee.com.br/abc", audienceGroupJids: ["1@g.us", "1@g.us", "2@g.us"], scheduledAt: "2026-11-06T12:00:00.000Z" });
    expect(row).toMatchObject({ account_id: ACCOUNT, lote_id: "lote-1", group_jid: "status@broadcast", tipo: "imagem", legenda: "Oferta https://s.shopee.com.br/abc", texto: null, media_bucket: "whatsapp-media", mime_type: "image/jpeg", whatsapp_session_name: "numero-1", status: "pendente", priority: "high" });
    expect(row.status_audience_jids).toEqual(["1@g.us", "2@g.us"]);
  });

  it("conta o dia pelo horário de Brasília", () => {
    expect(brasiliaDayStart(new Date("2026-11-06T02:30:00Z"))).toBe("2026-11-05T03:00:00.000Z");
    expect(brasiliaDayStart(new Date("2026-11-06T15:00:00Z"))).toBe("2026-11-06T03:00:00.000Z");
  });

  it("valida a entrada: até 5 grupos e legenda curta", () => {
    expect(statusPostSchema.safeParse({ offer, message: "x", senderId: db.sender.id, audienceGroupJids: ["1@g.us", "2@g.us", "3@g.us", "4@g.us", "5@g.us", "6@g.us"] }).success).toBe(false);
    expect(statusPostSchema.safeParse({ offer, message: "x".repeat(701), senderId: db.sender.id, audienceGroupJids: ["1@g.us"] }).success).toBe(false);
    expect(statusPostSchema.safeParse({ offer, message: "x", senderId: db.sender.id, audienceGroupJids: ["status@broadcast"] }).success).toBe(false);
    const parsed = statusPostSchema.parse({ offer, message: "x", senderId: db.sender.id, audienceGroupJids: ["1@g.us"], accountId: "outra-conta" } as any);
    expect("accountId" in parsed).toBe(false);
  });
});

describe("Status do WhatsApp: criação da postagem", () => {
  beforeEach(() => {
    Object.assign(db, { flag: true, sender: { id: "11111111-1111-4111-8111-111111111111", session_name: "numero-1" }, linkedGroups: ["1@g.us", "2@g.us"], todayCount: 0, failEnvio: false, inserts: [], deletes: [], filters: [], uploads: [], removed: [] });
  });

  it("cria um lote e um envio na fila do número, sempre na conta da sessão", async () => {
    const result = await createStatusPost(input());
    expect(result.loteId).toBe("lote-1");
    const lote = db.inserts.find(i => i.table === "envios_grupo_lotes")!.values;
    const envio = db.inserts.find(i => i.table === "envios_grupo")!.values;
    expect(lote).toMatchObject({ account_id: ACCOUNT, tipo: "imagem", total: 1, priority: "high", whatsapp_session_name: "numero-1" });
    expect(envio).toMatchObject({ account_id: ACCOUNT, group_jid: STATUS_JID, status_audience_jids: ["1@g.us", "2@g.us"] });
    expect(db.uploads[0]).toMatch(/^accounts\/acc-1\/stories\/.+\.jpg$/);
    expect(db.filters.filter(f => ["whatsapp_senders", "whatsapp_sender_grupos", "accounts"].includes(f.table)).every(f => f.column !== "account_id" || f.value === ACCOUNT)).toBe(true);
  });

  it("conta não liberada (ou coluna ausente) não cria nada", async () => {
    db.flag = false;
    await expect(createStatusPost(input())).rejects.toMatchObject({ status: 403 });
    db.flag = null;
    await expect(createStatusPost(input())).rejects.toMatchObject({ status: 403 });
    expect(db.inserts).toHaveLength(0); expect(db.uploads).toHaveLength(0);
  });

  it("exige o link afiliado confirmado na mensagem", async () => {
    await expect(createStatusPost({ ...input(), message: "sem link" })).rejects.toMatchObject({ status: 400 });
    await expect(createStatusPost({ ...input(), offer: { ...offer, affiliateUrl: "https://shopee.com.br/produto" }, message: "https://shopee.com.br/produto" })).rejects.toMatchObject({ status: 400 });
  });

  it("recusa número de outra conta e grupo em que o número não está", async () => {
    db.sender = null;
    await expect(createStatusPost(input())).rejects.toMatchObject({ status: 403 });
    db.sender = { id: "11111111-1111-4111-8111-111111111111", session_name: "numero-1" };
    db.linkedGroups = ["1@g.us"];
    await expect(createStatusPost(input())).rejects.toMatchObject({ status: 403 });
    expect(db.inserts).toHaveLength(0);
  });

  it("respeita o limite diário por número", async () => {
    db.todayCount = STATUS_DAILY_LIMIT;
    await expect(createStatusPost(input())).rejects.toMatchObject({ status: 429 });
    expect(db.uploads).toHaveLength(0);
  });

  it("desfaz lote e imagem se o envio não entrar na fila", async () => {
    db.failEnvio = true;
    await expect(createStatusPost(input())).rejects.toMatchObject({ status: 500 });
    expect(db.deletes).toContain("envios_grupo_lotes");
    expect(db.removed).toHaveLength(1);
  });
});
