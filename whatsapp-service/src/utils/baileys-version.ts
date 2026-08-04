import { fetchLatestBaileysVersion } from "@whiskeysockets/baileys";

type BaileysVersion = Awaited<ReturnType<typeof fetchLatestBaileysVersion>>["version"];

let versionPromise: Promise<BaileysVersion> | null = null;

export function getBaileysVersion() {
  if (!versionPromise) {
    versionPromise = fetchLatestBaileysVersion()
      .then(({ version }) => version)
      .catch((error) => {
        versionPromise = null;
        throw error;
      });
  }
  return versionPromise;
}
