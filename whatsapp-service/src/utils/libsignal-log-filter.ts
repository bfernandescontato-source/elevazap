/**
 * A libsignal escreve direto no console a cada falha de decriptação (stack
 * trace) e a cada sessão aberta/fechada (o objeto inteiro da sessão, com as
 * chaves). Num pico de Bad MAC isso passou de 7 mil linhas por segundo
 * (07/10). No Linux a escrita do Node no stdout/stderr de um pipe é síncrona:
 * cada linha trava o processo até ser gravada no log do Docker, saturando a
 * CPU e o event loop.
 *
 * Este filtro só troca essas mensagens fixas da libsignal por um contador e
 * imprime um resumo por minuto. Nada muda na decriptação, nos retries ou nos
 * sockets. Mensagens de outras origens passam intactas.
 * Desligar: LIBSIGNAL_LOG_FILTER=false.
 */

const LIBSIGNAL_PREFIXES = [
  "Session error:",
  "Failed to decrypt message with any known session",
  "Decrypted message with closed session",
  "Closing session:",
  "Opening session:",
  "Closing open session in favor of incoming prekey bundle",
  "Removing old closed session:",
  "Session already closed",
  "Session already open",
  "Migrating session to:"
];

const SUMMARY_INTERVAL_MS = 60_000;

function summaryKey(prefix: string, first: string) {
  // "Session error:Error: Bad MAC" -> separa o tipo de erro.
  if (prefix === "Session error:") return first.slice(0, 80).split("\n")[0];
  return prefix;
}

let installed = false;

export function installLibsignalLogFilter() {
  if (installed || process.env.LIBSIGNAL_LOG_FILTER === "false") return;
  installed = true;
  const counts = new Map<string, number>();
  const original = { log: console.log.bind(console), info: console.info.bind(console), warn: console.warn.bind(console), error: console.error.bind(console) };

  for (const level of ["log", "info", "warn", "error"] as const) {
    console[level] = (...args: unknown[]) => {
      const first = args[0];
      if (typeof first === "string") {
        const prefix = LIBSIGNAL_PREFIXES.find((candidate) => first.startsWith(candidate));
        if (prefix) {
          const key = summaryKey(prefix, first);
          counts.set(key, (counts.get(key) || 0) + 1);
          return;
        }
      }
      original[level](...args);
    };
  }

  setInterval(() => {
    if (!counts.size) return;
    const suppressed = Object.fromEntries(counts);
    counts.clear();
    original.info({ event: "libsignal.log_suppressed", component: "runtime", window_s: SUMMARY_INTERVAL_MS / 1000, counts: suppressed });
  }, SUMMARY_INTERVAL_MS).unref?.();
}
