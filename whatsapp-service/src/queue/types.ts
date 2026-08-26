import type { QueueTable } from "../database-capabilities.js";

export type QueueItem = {
  id: string;
  kind: "envio" | "grupo";
  priority: "alta" | "normal";
  claim_token: string;
  account_id: string;
  whatsapp_session_id: string;
  lease_version: number;
  attempt: number;
};

export type QueueTableName = QueueTable;

export type QueueReconciliation = {
  table: QueueTableName;
  row: any;
  messageId: string | null;
  reason: string;
};
