import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("session supervisor reliability", () => {
  it("renews first and persists all runtime heartbeats in one RPC", () => {
    const runtime = read("whatsapp-service/src/senders/runtime.ts");
    expect(runtime).toContain('supabase.rpc("renew_whatsapp_session_leases"');
    expect(runtime).toContain('supabase.rpc("heartbeat_whatsapp_session_runtime"');
    expect(runtime).not.toContain("await timed(cycle, \"persist_status\"");
    expect(runtime).toContain("Math.max(env.SESSION_LEASE_TTL_SECONDS, 120)");
  });

  it("does not overlap supervisor cycles", () => {
    const index = read("whatsapp-service/src/index.ts");
    expect(index).toContain("let senderSupervisorRunning = false");
    expect(index).toContain('reason: "previous_cycle_still_running"');
  });

  it("allows safe same-worker lease recovery and protects the batch heartbeat", () => {
    const migration = read("supabase/migrations/20261008000319_stabilize_whatsapp_session_supervisor.sql");
    expect(migration).toContain("create or replace function public.heartbeat_whatsapp_session_runtime");
    expect(migration).toContain("lease.owner_worker_id=p_worker_id");
    expect(migration).toContain("lease.lease_version=requested.lease_version");
  });
});
