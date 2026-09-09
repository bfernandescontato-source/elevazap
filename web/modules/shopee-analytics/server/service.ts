import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { decryptIntegrationSecret } from "@/lib/integration-crypto";
import { shopeeGraphQl } from "@/modules/offer-autopilot/server/shopee-client";

type Item = { itemId?: string; modelId?: string; itemName?: string; shopId?: string; shopName?: string; itemPrice?: number; actualAmount?: number; refundAmount?: number; qty?: number; itemTotalCommission?: number; itemSellerCommission?: number; itemShopeeCommissionCapped?: number; itemSellerCommissionRate?: number; itemShopeeCommissionRate?: number; displayItemStatus?: string; completeTime?: number; imageUrl?: string };
type Order = { orderId: string; orderStatus: string; items?: Item[] };
type Conversion = { purchaseTime: number; conversionId?: string; checkoutId?: string; conversionStatus: string; estimatedTotalCommission?: number; totalCommission?: number; netCommission?: number; orders?: Order[] };
type Report = { conversionReport: { nodes: Conversion[]; pageInfo: { hasNextPage: boolean; scrollId?: string } } };

const FIELDS = `purchaseTime conversionId conversionStatus estimatedTotalCommission totalCommission netCommission orders { orderId orderStatus items { itemId itemName shopId shopName itemPrice actualAmount refundAmount qty itemTotalCommission itemSellerCommission itemShopeeCommissionCapped itemSellerCommissionRate itemShopeeCommissionRate displayItemStatus completeTime } }`;
const iso = (seconds?: number) => seconds ? new Date(seconds * 1000).toISOString() : null;
const number = (value?: number | string) => Number(String(value ?? 0).replace("%", "")) || 0;
const rate = (value?: number | string) => value == null ? null : Number(String(value).replace("%", "")) || 0;

export async function connectedShopee(accountId: string) {
  const database = supabaseAdmin();
  const { data, error } = await database.from("affiliate_integrations").select("id,app_id,encrypted_app_secret,status").eq("account_id", accountId).eq("provider", "shopee").maybeSingle();
  if (error) throw error;
  return data?.status === "connected" && data.app_id && data.encrypted_app_secret ? data : null;
}

export async function syncShopeeAnalytics(accountId: string, from: string, to: string, force = false) {
  const database = supabaseAdmin();
  const integration = await connectedShopee(accountId);
  if (!integration) return { connected: false, synced: false };
  const { data: state } = await database.from("shopee_affiliate_sync_state").select("last_success_at,coverage_start,coverage_end").eq("account_id", accountId).eq("integration_id", integration.id).maybeSingle();
  const fresh = state?.last_success_at && Date.now() - new Date(state.last_success_at).getTime() < 15 * 60_000 && state.coverage_start <= from && state.coverage_end >= to;
  if (fresh && !force) return { connected: true, synced: false };
  const start = Math.floor(new Date(`${from}T00:00:00-03:00`).getTime() / 1000);
  const end = Math.floor(new Date(`${to}T23:59:59-03:00`).getTime() / 1000);
  const secret = decryptIntegrationSecret(integration.encrypted_app_secret);
  let scrollId = "";
  let pages = 0;
  try {
    do {
      const cursorArgument = scrollId ? `,scrollId:${JSON.stringify(scrollId)}` : "";
      const query = `query Analytics { conversionReport(purchaseTimeStart:${start},purchaseTimeEnd:${end},limit:20${cursorArgument}){ nodes { ${FIELDS} } pageInfo { hasNextPage scrollId } } }`;
      const result = await shopeeGraphQl<Report>(integration.app_id, secret, query);
      const report = result.conversionReport;
      const orders = report.nodes.flatMap(conversion => (conversion.orders || []).map(order => ({
        account_id: accountId, integration_id: integration.id, order_id: String(order.orderId), conversion_id: conversion.conversionId ? String(conversion.conversionId) : null, checkout_id: conversion.checkoutId ? String(conversion.checkoutId) : null,
        purchase_time: iso(conversion.purchaseTime), conversion_status: conversion.conversionStatus, order_status: order.orderStatus,
        estimated_commission: number(conversion.estimatedTotalCommission), total_commission: number(conversion.totalCommission), net_commission: number(conversion.netCommission), synced_at: new Date().toISOString()
      })));
      if (orders.length) { const { error } = await database.from("shopee_affiliate_orders").upsert(orders, { onConflict: "account_id,integration_id,order_id" }); if (error) throw error; }
      const items = report.nodes.flatMap(conversion => (conversion.orders || []).flatMap(order => (order.items || []).map((item, index) => ({
        account_id: accountId, integration_id: integration.id, order_id: String(order.orderId), item_key: createHash("sha256").update(`${item.itemId || ""}:${item.modelId || ""}:${index}`).digest("hex"), item_id: item.itemId ? String(item.itemId) : null, model_id: item.modelId ? String(item.modelId) : null,
        item_name: item.itemName || "Produto sem nome", shop_id: item.shopId ? String(item.shopId) : null, shop_name: item.shopName || "Loja não informada", item_price: number(item.itemPrice), actual_amount: number(item.actualAmount), refund_amount: number(item.refundAmount), quantity: Math.max(0, Number(item.qty || 0)), commission: number(item.itemTotalCommission), seller_commission: number(item.itemSellerCommission), shopee_commission: number(item.itemShopeeCommissionCapped), seller_commission_rate: rate(item.itemSellerCommissionRate), shopee_commission_rate: rate(item.itemShopeeCommissionRate), item_status: item.displayItemStatus || null, complete_time: iso(item.completeTime), image_url: item.imageUrl || null, synced_at: new Date().toISOString()
      }))));
      if (items.length) { const { error } = await database.from("shopee_affiliate_order_items").upsert(items, { onConflict: "account_id,integration_id,order_id,item_key" }); if (error) throw error; }
      scrollId = report.pageInfo.hasNextPage ? report.pageInfo.scrollId || "" : "";
      pages += 1;
      if (pages > 200) throw new Error("SHOPEE_PAGINATION_LIMIT");
    } while (scrollId);
    const coverageStart = !state?.coverage_start || state.coverage_start > from ? from : state.coverage_start;
    const coverageEnd = !state?.coverage_end || state.coverage_end < to ? to : state.coverage_end;
    await database.from("shopee_affiliate_sync_state").upsert({ account_id: accountId, integration_id: integration.id, coverage_start: coverageStart, coverage_end: coverageEnd, last_success_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() });
    return { connected: true, synced: true, pages };
  } catch (error) {
    const code = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String(error.message) : "SHOPEE_UNAVAILABLE";
    await database.from("shopee_affiliate_sync_state").upsert({ account_id: accountId, integration_id: integration.id, last_error: code, updated_at: new Date().toISOString() });
    throw new Error(code);
  }
}

export async function getShopeeAnalytics(accountId: string, from: string, to: string, page: number, pageSize: number, search: string, status: string) {
  const database = supabaseAdmin();
  const integration = await connectedShopee(accountId);
  if (!integration) return { connected: false };
  const startIso = new Date(`${from}T00:00:00-03:00`).toISOString();
  const endIso = new Date(`${to}T23:59:59-03:00`).toISOString();
  const { data: orders, error: ordersError } = await database.from("shopee_affiliate_orders").select("order_id,purchase_time,conversion_status,order_status,estimated_commission,total_commission,net_commission").eq("account_id", accountId).eq("integration_id", integration.id).gte("purchase_time", startIso).lte("purchase_time", endIso).limit(10000);
  if (ordersError) throw ordersError;
  const orderIds = (orders || []).map(row => row.order_id);
  const allItems: Record<string, any>[] = [];
  for (let index = 0; index < orderIds.length; index += 500) {
    const { data, error } = await database.from("shopee_affiliate_order_items").select("*").eq("account_id", accountId).eq("integration_id", integration.id).in("order_id", orderIds.slice(index, index + 500)).limit(10000);
    if (error) throw error;
    allItems.push(...(data || []));
  }
  const byOrder = new Map((orders || []).map(row => [row.order_id, row]));
  const estimated = allItems.reduce((sum, row) => sum + number(row.commission), 0);
  const confirmed = allItems.filter(row => byOrder.get(row.order_id)?.conversion_status === "COMPLETED").reduce((sum, row) => sum + number(row.commission), 0);
  const pending = allItems.filter(row => byOrder.get(row.order_id)?.conversion_status === "PENDING").reduce((sum, row) => sum + number(row.commission), 0);
  const gmv = allItems.reduce((sum, row) => sum + number(row.actual_amount), 0);
  const units = allItems.reduce((sum, row) => sum + number(row.quantity), 0);
  const productMap = new Map<string, { name: string; units: number; commission: number }>();
  const shopMap = new Map<string, { name: string; orders: Set<string>; commission: number }>();
  const dailyMap = new Map<string, { date: string; orders: Set<string>; commission: number; units: number; gmv: number }>();
  for (const item of allItems) {
    const productKey = item.item_id || item.item_name;
    const product = productMap.get(productKey) || { name: item.item_name, units: 0, commission: 0 };
    product.units += number(item.quantity); product.commission += number(item.commission); productMap.set(productKey, product);
    const shopKey = item.shop_id || item.shop_name;
    const shop = shopMap.get(shopKey) || { name: item.shop_name, orders: new Set<string>(), commission: 0 };
    shop.orders.add(item.order_id); shop.commission += number(item.commission); shopMap.set(shopKey, shop);
    const ordered = byOrder.get(item.order_id); if (!ordered) continue;
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ordered.purchase_time));
    const daily = dailyMap.get(date) || { date, orders: new Set<string>(), commission: 0, units: 0, gmv: 0 };
    daily.orders.add(item.order_id); daily.commission += number(item.commission); daily.units += number(item.quantity); daily.gmv += number(item.actual_amount); dailyMap.set(date, daily);
  }
  let details: Record<string, any>[] = allItems.map(item => ({ ...item, ...(byOrder.get(item.order_id) || {}) })) as Record<string, any>[];
  if (search) { const needle = search.toLocaleLowerCase("pt-BR"); details = details.filter(row => row.order_id.toLocaleLowerCase().includes(needle) || row.item_name.toLocaleLowerCase().includes(needle)); }
  if (status && status !== "ALL") details = details.filter(row => row.conversion_status === status || row.order_status === status);
  details.sort((a, b) => new Date(b.purchase_time).getTime() - new Date(a.purchase_time).getTime() || a.order_id.localeCompare(b.order_id));
  const statusOptions = [...new Set((orders || []).flatMap(row => [row.conversion_status, row.order_status]).filter(Boolean))].sort();
  const { data: state } = await database.from("shopee_affiliate_sync_state").select("last_success_at,last_error").eq("account_id", accountId).eq("integration_id", integration.id).maybeSingle();
  return {
    connected: true, summary: { estimated, confirmed, pending, gmv, orders: new Set(orderIds).size, pendingOrders: (orders || []).filter(row => row.conversion_status === "PENDING").length, units },
    topProducts: [...productMap.values()].sort((a,b) => b.commission-a.commission || a.name.localeCompare(b.name)).slice(0,5),
    topShops: [...shopMap.values()].map(row => ({ name: row.name, orders: row.orders.size, commission: row.commission })).sort((a,b) => b.commission-a.commission || a.name.localeCompare(b.name)).slice(0,5),
    daily: [...dailyMap.values()].map(row => ({ date: row.date, orders: row.orders.size, commission: row.commission, units: row.units, gmv: row.gmv })).sort((a,b) => a.date.localeCompare(b.date)),
    details: { rows: details.slice((page-1)*pageSize, page*pageSize), total: details.length, page, pageSize }, statusOptions, sync: state
  };
}
