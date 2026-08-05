import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const violations = [];

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", ".next", "dist", ".git", ".codex", ".agents"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if ([".ts", ".tsx"].includes(extname(entry.name))) result.push(path);
  }
  return result;
}

for (const path of await files(root)) {
  const source = await readFile(path, "utf8");
  const name = relative(root, path);
  const lines = source.split("\n").length;
  if (name.includes("/app/api/") && name.endsWith("route.ts") && lines > 180) violations.push(`${name}: rota com ${lines} linhas (máximo 180)`);
  if (name.includes("/app/") && name.endsWith("page.tsx") && lines > 500) violations.push(`${name}: página com ${lines} linhas (máximo 500)`);
  if (name.includes("/modules/") && /from ["']@\/app\//.test(source)) violations.push(`${name}: módulo não pode importar a camada app`);
  if (name.includes("/shared/") && /from ["']@\/(app|modules)\//.test(source)) violations.push(`${name}: shared não pode depender de app ou modules`);
  if (name.endsWith("page.tsx") && source.includes("supabaseAdmin")) violations.push(`${name}: página cliente não pode acessar cliente administrativo`);
  if (/account_id\s*:\s*(body|parsed\.data)\.account_id/.test(source)) violations.push(`${name}: account_id não pode vir do navegador`);
}

if (violations.length) {
  console.error(`Arquitetura reprovada (${violations.length}):\n- ${violations.join("\n- ")}`);
  process.exit(1);
}
console.log("Arquitetura aprovada: limites e dependências respeitados.");
