import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * PostgREST falso, só em 127.0.0.1, para as tabelas whatsapp_auth_keys e
 * whatsapp_auth_creds. Cada número (session_name) tem um modo de resposta:
 *  - "ok": responde com as linhas guardadas;
 *  - "521": página HTML 521 da Cloudflare, igual à que derrubou o serviço;
 *  - "hang": nunca responde (o cliente esgota DB_TIMEOUT_MS);
 *  - "400": Bad Request do PostgREST (chave malformada).
 * Uma fila de modos (`script`) vale antes do modo fixo, uma requisição por item.
 */
export type FakeMode = "ok" | "521" | "hang" | "400";
export type FakeRequest = { at: number; method: string; table: string; session: string | null; keyIds: string[]; mode: FakeMode | null };

export const CLOUDFLARE_521 = `<!DOCTYPE html>
<html lang="en-US"><head><title>supabase.co | 521: Web server is down</title></head>
<body><div id="cf-wrapper"><div id="cf-error-details" class="p-0">
<h1><span class="inline-block">Web server is down</span> <span class="code-label">Error code 521</span></h1>
<p>The web server is not returning a connection. As a result, the web page is not displaying.</p>
</div></div></body></html>`;

function parseIn(value: string | null) {
  if (!value) return [];
  const inner = value.replace(/^in\.\(/, "").replace(/\)$/, "");
  return inner.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((item) => item.replace(/^"|"$/g, ""));
}

const eqValue = (value: string | null) => (value?.startsWith("eq.") ? value.slice(3) : null);

export async function startFakePostgrest() {
  const keys = new Map<string, any>(); // `${session}|${type}|${id}` -> key_data
  const creds = new Map<string, any>();
  const modes = new Map<string, FakeMode>();
  const scripts = new Map<string, FakeMode[]>();
  const requests: FakeRequest[] = [];
  const hanging = new Set<ServerResponse>();

  const send = (res: ServerResponse, status: number, body: unknown, type = "application/json") => {
    res.writeHead(status, { "content-type": type });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const table = url.pathname.replace("/rest/v1/", "");
      const body = raw ? JSON.parse(raw) : null;
      const session = eqValue(url.searchParams.get("session_name"))
        || (Array.isArray(body) ? body[0]?.session_name : body?.session_name) || null;
      const keyIds = parseIn(url.searchParams.get("key_id"));
      const scripted = session ? scripts.get(session)?.shift() : undefined;
      const mode = scripted || (session ? modes.get(session) : undefined) || "ok";
      requests.push({ at: Date.now(), method: req.method || "", table, session, keyIds, mode: table === "whatsapp_auth_keys" && req.method === "GET" ? mode : null });

      if (table === "whatsapp_auth_keys" && req.method === "GET") {
        if (mode === "hang") { hanging.add(res); return; }
        if (mode === "521") return send(res, 521, CLOUDFLARE_521, "text/html; charset=UTF-8");
        if (mode === "400") return send(res, 400, { code: "22P02", message: "Bad Request", details: null, hint: null });
        const type = eqValue(url.searchParams.get("key_type"));
        const rows = keyIds.filter((id) => keys.has(`${session}|${type}|${id}`))
          .map((id) => ({ key_id: id, key_data: keys.get(`${session}|${type}|${id}`) }));
        return send(res, 200, rows);
      }
      if (table === "whatsapp_auth_keys" && req.method === "POST") {
        for (const row of body as any[]) keys.set(`${row.session_name}|${row.key_type}|${row.key_id}`, row.key_data);
        return send(res, 201, []);
      }
      if (table === "whatsapp_auth_creds" && req.method === "GET") {
        const row = session && creds.has(session) ? [{ creds: creds.get(session), account_id: "conta-teste" }] : [];
        return send(res, 200, row);
      }
      if (table === "whatsapp_auth_creds" && req.method === "POST") {
        creds.set(body.session_name, body.creds);
        return send(res, 201, []);
      }
      // DELETE (limpar chaves/credenciais) fica registrado: os testes exigem que nunca aconteça.
      return send(res, 204, "");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    keys,
    setMode: (session: string, mode: FakeMode) => modes.set(session, mode),
    script: (session: string, ...sequence: FakeMode[]) => scripts.set(session, sequence),
    keyReads: (session: string) => requests.filter((r) => r.session === session && r.table === "whatsapp_auth_keys" && r.method === "GET"),
    destructive: () => requests.filter((r) => r.method === "DELETE" || (r.table === "whatsapp_auth_creds" && r.method !== "GET")),
    seedKey: (session: string, type: string, id: string, data: unknown) => keys.set(`${session}|${type}|${id}`, data),
    close: async () => {
      for (const res of hanging) res.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}

export type FakePostgrest = Awaited<ReturnType<typeof startFakePostgrest>>;
