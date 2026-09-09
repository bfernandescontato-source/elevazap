import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptIntegrationSecret } from "@/lib/integration-crypto";
import { shopeeGraphQl } from "@/modules/offer-autopilot/server/shopee-client";

type SchemaTypeRef = { kind: string; name?: string | null; ofType?: SchemaTypeRef | null };
type SchemaInput = { name: string; type: SchemaTypeRef; defaultValue?: string | null };
type SchemaField = { name: string; args?: SchemaInput[]; type: SchemaTypeRef };
type SchemaType = { kind: string; name?: string | null; fields?: SchemaField[] | null; inputFields?: SchemaInput[] | null; enumValues?: Array<{ name: string }> | null };
type SchemaProbe = { __schema: { queryType?: { name?: string; fields?: SchemaField[] }; types?: SchemaType[] } };

const INTROSPECTION_QUERY = `query ShopeeAnalyticsSchema {
  __schema {
    queryType { name fields { name args { name defaultValue type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } type { kind name ofType { kind name ofType { kind name } } } } }
    types { kind name fields { name args { name defaultValue type { kind name ofType { kind name ofType { kind name } } } } type { kind name ofType { kind name ofType { kind name } } } } inputFields { name defaultValue type { kind name ofType { kind name ofType { kind name } } } } enumValues { name } }
  }
}`;

function namedType(reference?: SchemaTypeRef | null): string | null {
  let current = reference;
  while (current?.ofType) current = current.ofType;
  return current?.name || null;
}

export async function probeShopeeAnalyticsSchema(database: SupabaseClient, accountId: string) {
  const { data: integration, error } = await database.from("affiliate_integrations")
    .select("app_id,encrypted_app_secret,status")
    .eq("account_id", accountId).eq("provider", "shopee").maybeSingle();
  if (error) throw error;
  if (!integration || integration.status !== "connected" || !integration.app_id || !integration.encrypted_app_secret) {
    throw new Error("SHOPEE_NOT_CONNECTED");
  }

  const schema = await shopeeGraphQl<SchemaProbe>(
    integration.app_id,
    decryptIntegrationSecret(integration.encrypted_app_secret),
    INTROSPECTION_QUERY
  );
  const rootFields = schema.__schema.queryType?.fields || [];
  const reportFields = rootFields.filter(field => /conversion|valid|report/i.test(field.name));
  const typeByName = new Map((schema.__schema.types || []).map(type => [type.name, type]));
  const selected = new Map<string, SchemaType>();
  const queue = reportFields.flatMap(field => [namedType(field.type), ...(field.args || []).map(arg => namedType(arg.type))]).filter(Boolean) as string[];
  while (queue.length && selected.size < 80) {
    const name = queue.shift()!;
    if (selected.has(name)) continue;
    const type = typeByName.get(name);
    if (!type) continue;
    selected.set(name, type);
    for (const field of type.fields || []) {
      const child = namedType(field.type);
      if (child && !selected.has(child)) queue.push(child);
      for (const argument of field.args || []) {
        const argumentType = namedType(argument.type);
        if (argumentType && !selected.has(argumentType)) queue.push(argumentType);
      }
    }
    for (const field of type.inputFields || []) {
      const child = namedType(field.type);
      if (child && !selected.has(child)) queue.push(child);
    }
  }
  return { operations: reportFields, types: [...selected.values()] };
}

export async function probeShopeeConversions(database: SupabaseClient, accountId: string) {
  const { data: integration, error } = await database.from("affiliate_integrations")
    .select("app_id,encrypted_app_secret,status")
    .eq("account_id", accountId).eq("provider", "shopee").maybeSingle();
  if (error) throw error;
  if (!integration || integration.status !== "connected" || !integration.app_id || !integration.encrypted_app_secret) throw new Error("SHOPEE_NOT_CONNECTED");
  const start = Math.floor(new Date("2026-09-07T00:00:00-03:00").getTime() / 1000);
  const end = Math.floor(new Date("2026-09-08T00:00:00-03:00").getTime() / 1000) - 1;
  const query = `query ProbeConversions {
    conversionReport(purchaseTimeStart: ${start}, purchaseTimeEnd: ${end}, limit: 20) {
      nodes {
        purchaseTime conversionId conversionStatus estimatedTotalCommission totalCommission netCommission
        orders { orderId orderStatus items { itemId itemName shopId shopName itemPrice actualAmount qty itemTotalCommission itemSellerCommission itemShopeeCommissionCapped itemSellerCommissionRate itemShopeeCommissionRate completeTime displayItemStatus refundAmount } }
      }
      pageInfo { limit hasNextPage scrollId }
    }
  }`;
  return shopeeGraphQl<Record<string, unknown>>(integration.app_id, decryptIntegrationSecret(integration.encrypted_app_secret), query);
}
