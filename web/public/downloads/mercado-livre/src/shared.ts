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
