type GroupMetadata = {
  id?: string;
  subject?: string;
  [key: string]: unknown;
};

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function discoverParticipatingGroups(
  sock: any,
  attempts = 2,
  waitMs = 700
): Promise<GroupMetadata[]> {
  const discovered = new Map<string, GroupMetadata>();
  let successfulAttempts = 0;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const groups = await sock.groupFetchAllParticipating();
      successfulAttempts += 1;
      for (const [jid, value] of Object.entries(groups || {})) {
        const group = value as GroupMetadata;
        const groupJid = group.id || jid;
        if (groupJid) discovered.set(groupJid, group);
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts - 1 && waitMs > 0) await pause(waitMs);
  }

  if (!successfulAttempts) throw lastError || new Error("O WhatsApp não retornou os grupos.");

  const missingNames = Array.from(discovered.entries()).filter(([, group]) => !group.subject?.trim());
  let unresolvedNames = 0;
  for (let index = 0; index < missingNames.length; index += 4) {
    await Promise.all(missingNames.slice(index, index + 4).map(async ([groupJid, current]) => {
      try {
        const metadata = await sock.groupMetadata(groupJid);
        discovered.set(groupJid, { ...current, ...metadata, id: metadata.id || groupJid });
      } catch {
        unresolvedNames += 1;
      }
    }));
  }
  if (unresolvedNames) console.warn(`[groups] ${unresolvedNames} grupo(s) continuam sem nome.`);

  console.log(`[groups] ${discovered.size} grupos encontrados em ${successfulAttempts} consulta(s).`);
  return Array.from(discovered.values());
}
