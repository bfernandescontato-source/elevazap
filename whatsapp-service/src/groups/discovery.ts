type GroupMetadata = {
  id?: string;
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
  console.log(`[groups] ${discovered.size} grupos encontrados em ${successfulAttempts} consulta(s).`);
  return Array.from(discovered.values());
}
