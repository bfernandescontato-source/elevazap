import { Boom } from "@hapi/boom";
import { DisconnectReason } from "@whiskeysockets/baileys";

/**
 * Em 07/10 o serviço caiu três vezes (15:29, 21:26, 21:38) pelo mesmo erro:
 * o Baileys decripta cada frame do transporte (Noise) dentro do evento
 * "message" do WebSocket e, quando a decriptação falha ("Unsupported state or
 * unable to authenticate data" em noise-handler/aesDecryptGCM), a exceção não
 * tem dono e derruba o processo inteiro — os 72 números reiniciam.
 *
 * A falha é de um socket só: o estado do Noise dele ficou inválido. Aqui ela
 * fecha apenas esse socket (que reconecta pelo caminho normal, com handshake
 * novo) e o processo segue. Qualquer outro erro continua sendo lançado.
 */
export function isNoiseDecryptError(error: unknown) {
  const value = error as { message?: unknown; stack?: unknown } | null;
  return Boolean(value)
    && /Unsupported state or unable to authenticate data/.test(String(value?.message))
    && /noise-handler|aesDecryptGCM/.test(String(value?.stack));
}

export function guardNoiseDecrypt(sock: any, onCaught: (error: Error) => void) {
  const ws = sock?.ws;
  if (!ws || typeof ws.emit !== "function") return;
  const originalEmit = ws.emit;
  ws.emit = function guardedEmit(this: unknown, event: string, ...args: unknown[]) {
    if (event !== "message") return originalEmit.call(this, event, ...args);
    try {
      return originalEmit.call(this, event, ...args);
    } catch (error) {
      if (!isNoiseDecryptError(error)) throw error;
      try { onCaught(error as Error); } catch { /* registro não pode impedir o fechamento */ }
      try { sock.end(new Boom("Falha ao decriptar frame do transporte (Noise)", { statusCode: DisconnectReason.connectionLost })); } catch { /* já fechado */ }
      return false;
    }
  };
}
