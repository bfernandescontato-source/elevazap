import type { SupabaseClient } from "@supabase/supabase-js";
import axios from "axios";
import OpenAI from "openai";
import { createHash } from "crypto";
import { decryptIntegrationSecret } from "../utils/integration-crypto.js";

// Descobre o nicho de uma oferta capturada para as rotas do Piloto
// (public.pilot_routes). Só roda quando a automação tem alguma rota ativa que
// filtra por nicho; sem isso, nenhuma consulta extra é feita.
//   1. Shopee com código do produto: categoria oficial (productOfferV2).
//   2. Demais (Mercado Livre, Amazon, sem código): IA escolhe o nicho pelo texto.
// O resultado inclui os nichos "pais" (Maquiagem → Beleza). Falhou → null, e a
// oferta só segue para rotas que aceitam qualquer nicho.

type NicheRow = { id: string; label: string; parent_id: string | null; shopee_category_ids: number[] | null };
type OfferRow = { id: string; account_id: string; automation_id: string; item_id: string | null; affiliate_provider: string | null; processed_text: string | null; original_text: string | null };
export type NicheResult = { nicheIds: string[]; source: "shopee_category" | "ai" | "none" };

const SHOPEE_ENDPOINT = "https://open-api.affiliate.shopee.com.br/graphql";
const NICHES_TTL_MS = 5 * 60_000;
const ROUTES_TTL_MS = 60_000;
const CACHE_DAYS = 30;

function log(event: string, fields: Record<string, unknown>) { console.info({ event, component: "offer-niche", ...fields }); }

export class OfferNicheResolver {
  private niches: { expires: number; rows: NicheRow[] } | null = null;
  private routeFlags = new Map<string, { expires: number; value: boolean }>();
  private openai: OpenAI | null;

  constructor(private database: SupabaseClient, apiKey = process.env.OPENAI_API_KEY, private model = process.env.OPENAI_NICHE_MODEL || process.env.OPENAI_REWRITE_MODEL || "gpt-4o-mini") {
    this.openai = apiKey ? new OpenAI({ apiKey }) : null;
  }

  async automationUsesNiches(accountId: string, automationId: string) {
    const hit = this.routeFlags.get(automationId);
    if (hit && hit.expires > Date.now()) return hit.value;
    const { data, error } = await this.database.from("pilot_routes").select("id").eq("account_id", accountId).eq("automation_id", automationId)
      .eq("enabled", true).eq("any_niche", false).limit(1);
    if (error) throw error;
    const value = Boolean(data?.length);
    this.routeFlags.set(automationId, { expires: Date.now() + ROUTES_TTL_MS, value });
    return value;
  }

  // Classifica e grava em captured_offers. Nunca lança: erro = sem nicho.
  async resolveAndStore(offerId: string, accountId: string): Promise<NicheResult | null> {
    try {
      const { data: offer, error } = await this.database.from("captured_offers")
        .select("id,account_id,automation_id,item_id,affiliate_provider,processed_text,original_text").eq("id", offerId).eq("account_id", accountId).maybeSingle();
      if (error) throw error;
      if (!offer) return null;
      const result = await this.resolve(offer as OfferRow);
      await this.database.from("captured_offers").update({ niche_ids: result.nicheIds.length ? result.nicheIds : null, niche_source: result.source, niche_resolved_at: new Date().toISOString() })
        .eq("id", offerId).eq("account_id", accountId);
      log("offer_niche_resolved", { account_id: accountId, offer_id: offerId, source: result.source, niches: result.nicheIds });
      return result;
    } catch (error) {
      console.error({ event: "offer_niche_failed", component: "offer-niche", account_id: accountId, offer_id: offerId, error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  private async resolve(offer: OfferRow): Promise<NicheResult> {
    const niches = await this.loadNiches();
    const provider = (offer.affiliate_provider || "").toLowerCase();
    if (offer.item_id && (provider === "shopee" || provider === "multiple")) {
      const categories = await this.shopeeCategories(offer.account_id, offer.item_id).catch(error => {
        log("offer_niche_shopee_lookup_failed", { offer_id: offer.id, error: error instanceof Error ? error.message : String(error) });
        return null;
      });
      if (categories?.length) {
        const matched = niches.filter(niche => (niche.shopee_category_ids || []).some(id => categories.includes(Number(id)))).map(niche => niche.id);
        if (matched.length) return { nicheIds: this.withParents(matched, niches), source: "shopee_category" };
      }
    }
    const text = (offer.processed_text || offer.original_text || "").trim();
    const aiNiche = text ? await this.classifyWithAi(text, niches) : null;
    if (aiNiche) return { nicheIds: this.withParents([aiNiche], niches), source: "ai" };
    return { nicheIds: [], source: "none" };
  }

  private withParents(ids: string[], niches: NicheRow[]) {
    const byId = new Map(niches.map(niche => [niche.id, niche]));
    const result = new Set<string>();
    for (const id of ids) {
      let current = byId.get(id);
      for (let depth = 0; current && depth < 4; depth++) { result.add(current.id); current = current.parent_id ? byId.get(current.parent_id) : undefined; }
    }
    return [...result];
  }

  private async loadNiches() {
    if (this.niches && this.niches.expires > Date.now()) return this.niches.rows;
    const { data, error } = await this.database.from("niches").select("id,label,parent_id,shopee_category_ids").eq("active", true).order("sort");
    if (error) { if (this.niches) return this.niches.rows; throw error; }
    this.niches = { expires: Date.now() + NICHES_TTL_MS, rows: (data || []) as NicheRow[] };
    return this.niches.rows;
  }

  // Categorias Shopee do produto, com cache global por item (30 dias).
  private async shopeeCategories(accountId: string, itemId: string) {
    const since = new Date(Date.now() - CACHE_DAYS * 86_400_000).toISOString();
    const { data: cached } = await this.database.from("product_niches").select("category_ids").eq("provider", "shopee").eq("product_key", itemId).gte("resolved_at", since).maybeSingle();
    if (cached?.category_ids?.length) return (cached.category_ids as Array<number | string>).map(Number);
    const { data: integration, error } = await this.database.from("affiliate_integrations").select("app_id,encrypted_app_secret")
      .eq("account_id", accountId).eq("provider", "shopee").eq("status", "connected").maybeSingle();
    if (error) throw error;
    if (!integration) return null;
    const appSecret = decryptIntegrationSecret(integration.encrypted_app_secret);
    const payload = JSON.stringify({ query: "query($itemId:Int64){productOfferV2(itemId:$itemId,limit:1){nodes{productCatIds}}}", variables: { itemId: itemId } });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHash("sha256").update(`${integration.app_id}${timestamp}${payload}${appSecret}`).digest("hex");
    const response = await axios.post(SHOPEE_ENDPOINT, payload, {
      timeout: 8_000, validateStatus: () => true,
      headers: { "content-type": "application/json", authorization: `SHA256 Credential=${integration.app_id}, Timestamp=${timestamp}, Signature=${signature}` }
    });
    if (response.status !== 200 || response.data?.errors?.length) throw new Error(`Shopee ${response.status} ${response.data?.errors?.[0]?.extensions?.code ?? ""}`.trim());
    const categories = ((response.data?.data?.productOfferV2?.nodes?.[0]?.productCatIds || []) as Array<number | string>).map(Number).filter(Number.isFinite);
    if (categories.length) {
      await this.database.from("product_niches").upsert({ provider: "shopee", product_key: itemId, category_ids: categories, resolved_at: new Date().toISOString() }, { onConflict: "provider,product_key" });
    }
    return categories;
  }

  private async classifyWithAi(text: string, niches: NicheRow[]) {
    if (!this.openai) return null;
    try {
      const response = await this.openai.responses.create({
        model: this.model,
        max_output_tokens: 40,
        input: [
          { role: "system", content: "Classifique o produto desta oferta de grupo de WhatsApp brasileiro em UM nicho da lista. Prefira o nicho mais específico que se aplica. Se não der para saber o produto, responda \"none\".\n" + niches.map(niche => `${niche.id}: ${niche.label}`).join("\n") },
          { role: "user", content: text.slice(0, 700) }
        ],
        text: { format: { type: "json_schema", name: "offer_niche", strict: true, schema: { type: "object", properties: { niche: { type: "string", enum: [...niches.map(niche => niche.id), "none"] } }, required: ["niche"], additionalProperties: false } } }
      });
      if (response.status !== "completed" || !response.output_text) return null;
      const niche = JSON.parse(response.output_text).niche as string;
      return niches.some(row => row.id === niche) ? niche : null;
    } catch (error) {
      log("offer_niche_ai_failed", { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }
}
