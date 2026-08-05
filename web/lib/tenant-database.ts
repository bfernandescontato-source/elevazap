import { requireAccountContext } from "./security";

export async function requireTenantDatabase() {
  const context = await requireAccountContext();
  if (context.error) return { error: context.error };
  return context;
}
