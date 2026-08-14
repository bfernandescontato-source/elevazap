export const OFFER_STATUSES = [
  "captured", "processing", "ready", "scheduled", "sending", "sent",
  "ignored", "duplicate", "processing_failed", "send_failed"
] as const;

export type OfferStatus = typeof OFFER_STATUSES[number];

export type RawOfferMessage = {
  sourceType: "whatsapp" | "shopee_finder";
  sourceMessageId: string;
  sourceGroupId: string;
  senderId?: string;
  text?: string;
  caption?: string;
  media?: { buffer: Buffer; mimeType: string; extension: string };
  timestamp: Date;
};

export type ParsedOffer = {
  text: string;
  media: RawOfferMessage["media"];
  links: string[];
  shopeeLinks: string[];
  sourceMessageId: string;
  sourceGroupId: string;
  senderId?: string;
  capturedAt: Date;
  contentHash: string;
};

export type AutomationSchedule = {
  intervalMinutes: number;
  operatingStart: string;
  operatingEnd: string;
  timezone: string;
};
