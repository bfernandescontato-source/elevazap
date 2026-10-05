// Gera o zip que os alunos baixam: só o necessário para o Chrome rodar
// (manifest, popup e JS minificado em um arquivo por entrada). O código-fonte
// (src/*.ts, comentários, package.json) não vai mais junto.
//
// Uso: node extension/mercado-livre/scripts/build-release.mjs [--publish]
//   --publish copia o zip para web/public/downloads (botão "Baixar extensão").
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(root, "../..");
const require = createRequire(join(repo, "package.json"));
const esbuild = require("esbuild");
const JSZip = require("jszip");

const out = join(root, "release", "mercado-livre");
rmSync(join(root, "release"), { recursive: true, force: true });
mkdirSync(join(out, "dist"), { recursive: true });

execFileSync(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc"), "-p", join(root, "tsconfig.json"), "--noEmit"], { stdio: "inherit" });

// Service worker e popup carregam como módulo; os content scripts não aceitam
// import, então cada um vira um arquivo único (IIFE).
const entries = [
  { name: "service-worker", format: "esm" },
  { name: "popup", format: "esm" },
  { name: "disparei-bridge", format: "iife" },
  { name: "mercado-livre-bridge", format: "iife" },
  { name: "vitrine", format: "iife" },
  { name: "shopee-page", format: "iife" }
];
for (const entry of entries) {
  await esbuild.build({
    entryPoints: [join(root, "src", `${entry.name}.ts`)],
    outfile: join(out, "dist", `${entry.name}.js`),
    bundle: true, format: entry.format, minify: true, legalComments: "none",
    target: "chrome120", charset: "utf8", logLevel: "warning"
  });
}

const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
// catalog-capture nunca rodou em produção (content script com import quebra no
// Chrome). Fica fora para a extensão não passar a enviar o catálogo de quem só
// navega no Mercado Livre.
manifest.content_scripts = manifest.content_scripts.filter((script) => !script.js.includes("dist/catalog-capture.js"));
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
cpSync(join(root, "popup"), join(out, "popup"), { recursive: true });

const zip = new JSZip();
const add = (relative) => zip.file(`mercado-livre/${relative}`, readFileSync(join(out, relative)));
add("manifest.json");
add("popup/index.html");
add("popup/style.css");
for (const entry of entries) add(`dist/${entry.name}.js`);
const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
const zipPath = join(root, "release", "mercado-livre.zip");
writeFileSync(zipPath, buffer);
console.log(`v${manifest.version}: ${zipPath} (${buffer.length} bytes)`);

if (process.argv.includes("--publish")) {
  for (const name of ["mercado-livre.zip", "disparei-mercado-livre-extensao.zip"]) {
    writeFileSync(join(repo, "web", "public", "downloads", name), buffer);
  }
  console.log("Copiado para web/public/downloads.");
}
