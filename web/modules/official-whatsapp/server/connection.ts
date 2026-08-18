import { graphRequest, metaConfigStatus, metaIdentifiers } from "./meta-client";
import { officialErrorCode } from "./errors";

async function check<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; code: ReturnType<typeof officialErrorCode> }> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    return { ok: false, code: officialErrorCode(error) };
  }
}

// Confirma separadamente token + acesso ao número + acesso à WABA. Nunca lê nem
// retorna META_ACCESS_TOKEN — apenas os campos públicos que a Graph API devolve.
export async function testMetaConnection() {
  const configStatus = metaConfigStatus();
  if (!configStatus.tokenConfigured || !configStatus.phoneNumberIdConfigured || !configStatus.graphVersion) {
    return {
      connected: false as const,
      configStatus,
      tokenValid: false,
      phoneNumber: { accessible: false as const },
      waba: { checked: false as const, accessible: false as const }
    };
  }

  const { phoneNumberId, wabaId } = metaIdentifiers();

  const phoneCheck = await check(() => graphRequest(`/${phoneNumberId}?fields=verified_name,display_phone_number,quality_rating`));
  const wabaCheck = wabaId ? await check(() => graphRequest(`/${wabaId}?fields=id,name`)) : null;

  const authFailed = (!phoneCheck.ok && phoneCheck.code === "META_AUTH_ERROR") || (wabaCheck !== null && !wabaCheck.ok && wabaCheck.code === "META_AUTH_ERROR");

  return {
    connected: phoneCheck.ok && (!wabaId || Boolean(wabaCheck?.ok)),
    configStatus,
    tokenValid: !authFailed,
    phoneNumber: phoneCheck.ok
      ? {
          accessible: true as const,
          verifiedName: phoneCheck.data.verified_name as string | undefined,
          displayPhoneNumber: phoneCheck.data.display_phone_number as string | undefined,
          qualityRating: phoneCheck.data.quality_rating as string | undefined
        }
      : { accessible: false as const, error: phoneCheck.code },
    waba: !wabaId
      ? { checked: false as const, accessible: false as const }
      : wabaCheck!.ok
        ? { checked: true as const, accessible: true as const, name: wabaCheck!.data.name as string | undefined }
        : { checked: true as const, accessible: false as const, error: wabaCheck!.code }
  };
}
