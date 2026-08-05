import { env } from "../env.js";

export const queueSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export const randomDelay = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

export function retryDelay(attempts: number) {
  if (attempts >= env.MAX_SEND_ATTEMPTS) return null;
  return env.RETRY_BASE_DELAY_MS * (attempts <= 1 ? 1 : 5 ** (attempts - 1));
}

export function isMissingRpc(error: unknown, name: string) {
  if (!error || typeof error !== "object") return false;
  const current = error as { code?: string; message?: string };
  return current.code === "PGRST202" || current.code === "42883" ||
    new RegExp(`could not find the function.*${name}|function.*${name}.*does not exist`, "i").test(current.message || "");
}

