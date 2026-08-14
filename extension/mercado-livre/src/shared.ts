export const CONNECT = "DISPAREI_ML_CONNECT";
export const CONNECT_RESULT = "DISPAREI_ML_CONNECTION_RESULT";
export const GENERATE = "DISPAREI_ML_GENERATE_LINK";
export type Config = { backendOrigin: string; extensionToken: string; connectedAt: string };
export type Job = { id: string; input_url: string; affiliate_tag?: string | null; kind: "connection_test" | "conversion" };
