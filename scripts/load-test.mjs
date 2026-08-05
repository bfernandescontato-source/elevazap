import { performance } from "node:perf_hooks";

const target = process.env.LOAD_TEST_URL;
const durationSeconds = Number(process.env.LOAD_TEST_DURATION_SECONDS || 30);
const concurrency = Number(process.env.LOAD_TEST_CONCURRENCY || 10);
const path = process.env.LOAD_TEST_PATH || "/api/auth/me";
const cookie = process.env.LOAD_TEST_COOKIE || "";

if (!target) throw new Error("Defina LOAD_TEST_URL para um ambiente de teste.");
if (/vercel\.app|localhost|127\.0\.0\.1/.test(new URL(target).hostname) === false && process.env.ALLOW_PRODUCTION_LOAD_TEST !== "true") {
  throw new Error("Teste bloqueado fora de preview/local. Use ALLOW_PRODUCTION_LOAD_TEST=true somente com autorização explícita.");
}
if (concurrency < 1 || concurrency > 200) throw new Error("LOAD_TEST_CONCURRENCY deve ficar entre 1 e 200.");

const deadline = Date.now() + durationSeconds * 1000;
const results = [];

async function worker() {
  while (Date.now() < deadline) {
    const start = performance.now();
    try {
      const response = await fetch(new URL(path, target), { headers: cookie ? { cookie } : {} });
      results.push({ status: response.status, ms: performance.now() - start });
      await response.arrayBuffer();
    } catch {
      results.push({ status: 0, ms: performance.now() - start });
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));
const latencies = results.map((item) => item.ms).sort((a, b) => a - b);
const percentile = (p) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] || 0;
const failures = results.filter((item) => item.status === 0 || item.status >= 500).length;
console.log(JSON.stringify({
  requests: results.length,
  requests_per_second: Number((results.length / durationSeconds).toFixed(2)),
  failures,
  failure_rate: Number((failures / Math.max(1, results.length)).toFixed(4)),
  latency_ms: { p50: Math.round(percentile(.5)), p95: Math.round(percentile(.95)), p99: Math.round(percentile(.99)) },
  statuses: Object.fromEntries([...new Set(results.map((item) => item.status))].map((status) => [status, results.filter((item) => item.status === status).length]))
}, null, 2));

if (failures / Math.max(1, results.length) > 0.01) process.exitCode = 1;

