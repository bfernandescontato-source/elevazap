import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";
import { getMercadoLivreIntegration, getShopeeIntegration, hasConnectedIntegration } from "@/modules/integrations/server/service";
import { assertOwnedGroupSelection } from "../ownership";

export async function loadAutopilot(database: SupabaseClient, accountId: string) {
  const [{ data: automation, error: automationError }, { data: senders, error: sendersError }, shopeeIntegration, mercadoLivreIntegration] = await Promise.all([
    database.from("offer_automations").select("*").eq("account_id", accountId).maybeSingle(),
    database.from("whatsapp_senders").select("id,label,session_name").eq("account_id", accountId).order("created_at"),
    getShopeeIntegration(database, accountId), getMercadoLivreIntegration(database, accountId)
  ]);
  if (automationError) throw automationError;
  if (sendersError) throw sendersError;
  const senderId = automation?.whatsapp_sender_id || senders?.[0]?.id;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [{ data: groups, error: groupsError }, { data: sources }, { data: destinations }, { data: offers, error: offersError }, capturedCount, convertedCount, queuedCount, sentCount, ignoredCount, conversionFailedCount] = await Promise.all([
    senderId ? database.from("whatsapp_sender_grupos").select("group_jid,grupos(group_jid,nome,foto_url)").eq("account_id", accountId).eq("whatsapp_sender_id", senderId) : Promise.resolve({ data: [], error: null }),
    automation ? database.from("automation_source_groups").select("whatsapp_group_id").eq("account_id", accountId).eq("automation_id", automation.id).eq("enabled", true) : Promise.resolve({ data: [] }),
    automation ? database.from("automation_destinations").select("whatsapp_group_id").eq("account_id", accountId).eq("automation_id", automation.id).eq("enabled", true) : Promise.resolve({ data: [] }),
    database.from("captured_offers").select("id,original_text,processed_text,original_media_url,media_bucket,media_path,original_link,affiliate_link,affiliate_conversion_status,affiliate_conversion_error,status,error_code,error_message,captured_at,scheduled_at,sent_at,source_group_id,grupos!captured_offers_account_id_source_group_id_fkey(nome)")
      .eq("account_id", accountId).order("captured_at", { ascending: false }).limit(50),
    database.from("captured_offers").select("id", { count: "exact", head: true }).eq("account_id", accountId).gte("captured_at", today.toISOString()),
    database.from("captured_offers").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("affiliate_conversion_status", "converted"),
    database.from("captured_offers").select("id", { count: "exact", head: true }).eq("account_id", accountId).in("status", ["captured", "processing", "ready", "scheduled", "sending"]),
    database.from("captured_offers").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("status", "sent").gte("sent_at", today.toISOString()),
    database.from("captured_offers").select("id", { count: "exact", head: true }).eq("account_id", accountId).in("status", ["ignored", "duplicate"]),
    database.from("captured_offers").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("affiliate_conversion_status", "failed")
  ]);
  if (groupsError) throw groupsError;
  if (offersError) throw offersError;
  return {
    automation,
    shopee_integration: shopeeIntegration,
    mercado_livre_integration: mercadoLivreIntegration,
    senders: senders || [],
    groups: (groups || []).map((row: any) => row.grupos || { group_jid: row.group_jid, nome: row.group_jid }),
    source_group_ids: (sources || []).map((row) => row.whatsapp_group_id),
    destination_group_ids: (destinations || []).map((row) => row.whatsapp_group_id),
    offers: offers || [],
    metrics: {
      captured_today: capturedCount.count || 0,
      converted: convertedCount.count || 0,
      queued: automation?.active_queue_count ?? queuedCount.count ?? 0,
      queue_limit: 5,
      sent_today: sentCount.count || 0,
      ignored: ignoredCount.count || 0,
      conversion_failed: conversionFailedCount.count || 0
    }
  };
}

export async function saveAutopilot(database: SupabaseClient, accountId: string, _userId: string, input: any) {
  const uniqueGroups = Array.from(new Set([...input.source_group_ids, ...input.destination_group_ids])) as string[];
  const [{ data: sender }, { data: senderGroups }] = await Promise.all([
    database.from("whatsapp_senders").select("id").eq("id", input.whatsapp_sender_id).eq("account_id", accountId).maybeSingle(),
    database.from("whatsapp_sender_grupos").select("group_jid").eq("whatsapp_sender_id", input.whatsapp_sender_id).eq("account_id", accountId).in("group_jid", uniqueGroups.length ? uniqueGroups : ["__none__"])
  ]);
  if (!sender) throw new Error("Número responsável não pertence à sua conta.");
  assertOwnedGroupSelection(uniqueGroups, senderGroups || []);
  if (input.enabled && input.shopee_conversion_enabled) {
    if (!await hasConnectedIntegration(database, accountId, "shopee")) throw new Error("Conecte a Shopee Affiliate antes de ativar a conversão.");
  }
  if (input.enabled && input.mercado_livre_conversion_enabled) {
    if (!await hasConnectedIntegration(database, accountId, "mercado_livre")) throw new Error("Conecte o Mercado Livre antes de ativar a conversão.");
  }

  const { data, error } = await database.rpc("save_offer_autopilot_configuration", {
    p_account_id: accountId,
    p_input: input
  });
  if (error) throw error;
  const automation = Array.isArray(data) ? data[0] : data;
  if (!automation) throw new Error("Não foi possível salvar as alterações.");
  return automation;
}

export async function loadOffer(database: SupabaseClient, accountId: string, offerId: string) {
  const { data: offer, error } = await database.from("captured_offers").select("*,grupos!captured_offers_account_id_source_group_id_fkey(nome),offer_deliveries(*,grupos!offer_deliveries_account_id_destination_group_id_fkey(nome))")
    .eq("id", offerId).eq("account_id", accountId).maybeSingle();
  if (error) throw error;
  if (!offer) return null;
  let media_url = offer.original_media_url;
  if (offer.media_bucket && offer.media_path) {
    const { data } = await supabaseAdmin().storage.from(offer.media_bucket).createSignedUrl(offer.media_path, 300);
    media_url = data?.signedUrl || null;
  }
  return { ...offer, media_url };
}
