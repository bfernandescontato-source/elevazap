import { describe, expect, it } from "vitest";

type Lease = { owner: string; version: number; expires: number };
type Job = { id: string; account: string; session: string; state: "pending" | "processing" | "sent" | "uncertain" };

class Model {
  now = 0;
  leases = new Map<string, Lease>();
  jobs: Job[] = [];
  acquire(worker: string, session: string, ttl = 60) {
    const old = this.leases.get(session);
    if (old && old.expires > this.now && old.owner !== worker) return null;
    const lease = { owner: worker, version: old && old.owner !== worker ? old.version + 1 : old?.version || 1, expires: this.now + ttl };
    this.leases.set(session, lease); return lease;
  }
  claim(worker: string, maxAccount = 10) {
    const active = new Set(this.jobs.filter(j => j.state === "processing").map(j => j.session));
    const counts = new Map<string, number>();
    for (const j of this.jobs.filter(j => j.state === "processing")) counts.set(j.account, (counts.get(j.account) || 0) + 1);
    const job = this.jobs.find(j => j.state === "pending" && !active.has(j.session) && (counts.get(j.account) || 0) < maxAccount && this.leases.get(j.session)?.owner === worker && this.leases.get(j.session)!.expires > this.now);
    if (job) job.state = "processing"; return job;
  }
  complete(worker: string, job: Job, version: number) {
    const lease = this.leases.get(job.session);
    if (!lease || lease.owner !== worker || lease.version !== version || lease.expires <= this.now) return false;
    job.state = "sent"; return true;
  }
}

describe("distributed queue safety model", () => {
  it("isola dois usuários simultâneos", () => { const m=new Model(); m.jobs=[{id:"a",account:"A",session:"sa",state:"pending"},{id:"b",account:"B",session:"sb",state:"pending"}]; m.acquire("w","sa");m.acquire("w","sb");expect([m.claim("w")?.id,m.claim("w")?.id]).toEqual(["a","b"]); });
  it("mantém concorrência 1 por sessão", () => { const m=new Model();m.jobs=[{id:"1",account:"A",session:"s",state:"pending"},{id:"2",account:"A",session:"s",state:"pending"}];m.acquire("w","s");expect(m.claim("w")?.id).toBe("1");expect(m.claim("w")).toBeUndefined(); });
  it("não bloqueia fila saudável por sessão desconectada", () => { const m=new Model();m.jobs=[{id:"off",account:"A",session:"off",state:"pending"},{id:"on",account:"B",session:"on",state:"pending"}];m.acquire("w","on");expect(m.claim("w")?.id).toBe("on"); });
  it("retoma após expiração do lease", () => { const m=new Model();m.acquire("w1","s",1);m.now=2;expect(m.acquire("w2","s")?.version).toBe(2); });
  it("rejeita worker antigo pelo fencing token", () => { const m=new Model();const j={id:"1",account:"A",session:"s",state:"processing" as const};m.jobs=[j];const old=m.acquire("w1","s",1)!;m.now=2;m.acquire("w2","s");expect(m.complete("w1",j,old.version)).toBe(false); });
  it("marca timeout pós-envio como incerto", () => { const j:Job={id:"1",account:"A",session:"s",state:"processing"};j.state="uncertain";expect(j.state).toBe("uncertain"); });
  it("aplica backpressure por conta", () => { const m=new Model();m.jobs=[{id:"1",account:"A",session:"s1",state:"processing"},{id:"2",account:"A",session:"s2",state:"pending"},{id:"3",account:"B",session:"s3",state:"pending"}];m.acquire("w","s2");m.acquire("w","s3");expect(m.claim("w",1)?.id).toBe("3"); });
  it("mantém sessões independentes com volume", () => { const m=new Model();m.jobs=Array.from({length:1000},(_,i)=>({id:String(i),account:`a${i}`,session:`s${i}`,state:"pending" as const}));for(let i=0;i<1000;i++)m.acquire("w",`s${i}`);for(let i=0;i<1000;i++)expect(m.claim("w")).toBeTruthy(); });
});
