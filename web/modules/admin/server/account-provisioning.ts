import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";

export const adminAccountSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da conta.").max(80, "O nome deve ter no máximo 80 caracteres."),
  email: z.string().trim().toLowerCase().email("Informe um e-mail válido."),
  password: z.string().min(6, "A senha deve ter pelo menos 6 caracteres.").max(72, "A senha deve ter no máximo 72 caracteres."),
  plan: z.enum(["start", "pro", "scale"]),
});

export type AdminAccountInput = z.infer<typeof adminAccountSchema>;

export class AccountProvisioningError extends Error {
  constructor(message: string, public readonly status = 500) {
    super(message);
    this.name = "AccountProvisioningError";
  }
}

export async function provisionAccount(input: AdminAccountInput) {
  const admin = supabaseAdmin({ timeoutMs: 15_000 });
  const email = input.email.toLowerCase();

  const existing = await admin.from("app_users").select("id").eq("email", email).maybeSingle();
  if (existing.error) throw new AccountProvisioningError("Não foi possível verificar o e-mail agora. Tente novamente.");
  if (existing.data) throw new AccountProvisioningError("Já existe um usuário com este e-mail.", 409);

  const accountResult = await admin.from("accounts").insert({
    name: input.name,
    status: "active",
    plan: input.plan,
    subscription_started_at: new Date().toISOString(),
  }).select("id,name,status,plan,created_at").single();
  if (accountResult.error || !accountResult.data) {
    throw new AccountProvisioningError("Não foi possível criar a conta. Tente novamente.");
  }

  const account = accountResult.data;
  let userId: string | null = null;
  try {
    const authResult = await admin.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
      user_metadata: {
        name: input.name,
        source: "internal_admin",
        account_id: account.id,
      },
    });
    if (authResult.error || !authResult.data.user) {
      if (/already|registered|exists/i.test(authResult.error?.message || "")) {
        throw new AccountProvisioningError("Já existe um usuário com este e-mail.", 409);
      }
      throw new AccountProvisioningError("A conta foi iniciada, mas o usuário não pôde ser criado.");
    }
    userId = authResult.data.user.id;

    const profile = await admin.from("app_users").upsert({
      id: userId,
      account_id: account.id,
      email,
      name: input.name,
      role: "admin",
      status: "active",
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).select("id,email,name,role,status").single();
    if (profile.error || !profile.data) {
      throw new AccountProvisioningError("O usuário foi criado, mas o perfil não pôde ser ativado.");
    }

    const owner = await admin.from("accounts").update({ owner_user_id: userId }).eq("id", account.id);
    if (owner.error) throw new AccountProvisioningError("O usuário foi criado, mas não pôde ser vinculado à conta.");

    return { account, user: profile.data };
  } catch (error) {
    if (userId) await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    await admin.from("accounts").delete().eq("id", account.id);
    if (error instanceof AccountProvisioningError) throw error;
    throw new AccountProvisioningError("Não foi possível concluir a criação da conta.");
  }
}

export async function listProvisionedAccounts() {
  const admin = supabaseAdmin({ timeoutMs: 15_000 });
  const accountsResult = await admin.from("accounts")
    .select("id,name,status,plan,owner_user_id,created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (accountsResult.error) throw new AccountProvisioningError("Não foi possível carregar as contas.");

  const accounts = accountsResult.data || [];
  const ownerIds = accounts.map((account) => account.owner_user_id).filter((id): id is string => Boolean(id));
  const profilesResult = ownerIds.length
    ? await admin.from("app_users").select("id,email,name,status").in("id", ownerIds)
    : { data: [], error: null };
  if (profilesResult.error) throw new AccountProvisioningError("Não foi possível carregar os responsáveis das contas.");
  const profiles = new Map((profilesResult.data || []).map((profile) => [profile.id, profile]));

  return accounts.map((account) => ({
    ...account,
    owner: account.owner_user_id ? profiles.get(account.owner_user_id) || null : null,
  }));
}
