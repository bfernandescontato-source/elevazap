export const CONNECT = "DISPAREI_ML_CONNECT";
export const CONNECT_RESULT = "DISPAREI_ML_CONNECTION_RESULT";
export const GENERATE = "DISPAREI_ML_GENERATE_LINK";
export const IMPORT_CATALOG = "DISPAREI_ML_IMPORT_CATALOG";
export type Config = { backendOrigin: string; extensionToken: string; connectedAt: string };
export type Job = { id: string; input_url: string; affiliate_tag?: string | null; kind: "connection_test" | "conversion" };
export type CatalogProduct = {
  ml_item_id: string; product_name: string; image_url?: string; price?: number; original_price?: number;
  commission_rate?: number; commission_value?: number; product_link?: string; category?: string;
  ml_category?: string; sales?: number; rating_star?: number; discount_rate?: number; is_hot?: boolean;
  is_full?: boolean; free_shipping?: boolean; seller_name?: string; captured_at: string;
};

// Vitrine (carrinho nas lojas). Mensagens entre content script, service worker e painel.
export const VITRINE_STATUS = "DISPAREI_VITRINE_STATUS";
export const VITRINE_ENVIAR = "DISPAREI_VITRINE_ENVIAR";
export const VITRINE_BUSCA_SHOPEE = "DISPAREI_VITRINE_BUSCA_SHOPEE";
export const VITRINE_ALTERNAR_PAINEL = "DISPAREI_VITRINE_ALTERNAR_PAINEL";
export const CARRINHO_KEY = "dispareiVitrineCarrinho";
export const ENVIO_KEY = "dispareiVitrineEnvio";
export const CARRINHO_MAXIMO = 500;
export type VitrineStatus = { conectada: boolean; liberada: boolean; painel: string };
export type ModoDeEnvio = "lote" | "agora";

// Painel da Disparei (página /catalogo/extensao) <-> disparei-bridge.
export const PAGINA_PEDIR_ENVIO = "DISPAREI_VITRINE_PEDIR_ENVIO";
export const PAGINA_ENVIO = "DISPAREI_VITRINE_ENVIO";
export const PAGINA_ENVIADOS = "DISPAREI_VITRINE_ENVIADOS";
