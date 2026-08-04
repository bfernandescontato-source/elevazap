import { env } from "../env.js";
import { withTimeout } from "./timeout.js";

type SupabaseResult<T> = { data: T | null; error: { message: string; code?: string } | null };

export async function dbResult<T>(operation: string, query: PromiseLike<SupabaseResult<T>>) {
  const result = await withTimeout(operation, env.DB_TIMEOUT_MS, query);
  if (result.error) {
    const error = new Error(`${operation}: ${result.error.message}`);
    (error as any).code = result.error.code || "DATABASE_ERROR";
    throw error;
  }
  return result.data;
}
