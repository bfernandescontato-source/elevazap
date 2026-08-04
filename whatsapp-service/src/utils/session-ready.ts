export type SessionSnapshot = {
  status: string;
  qr?: string;
  error?: string | null;
  [key: string]: unknown;
};

const terminalStatuses = new Set(["connected", "failed", "logged_out"]);

export async function waitForSessionReady(
  read: () => SessionSnapshot,
  timeoutMs = 10_000,
  intervalMs = 250
) {
  const deadline = Date.now() + timeoutMs;
  let snapshot = read();

  while (!snapshot.qr && !terminalStatuses.has(snapshot.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, Math.max(1, deadline - Date.now()))));
    snapshot = read();
  }

  return snapshot;
}
