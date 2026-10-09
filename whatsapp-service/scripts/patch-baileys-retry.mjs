// Corrige o pedido de reenvio (retry receipt) do Baileys 6.7.23 sem editar node_modules à mão.
//
// Defeito: quando o WhatsApp pede o reenvio de uma mensagem que o serviço não tem mais,
// `sendMessagesAgain` força uma sessão Signal nova (assertSessions(..., true)) ANTES de saber
// que não há o que reenviar, e não conta a tentativa. Pedidos repetidos criam centenas de
// sessões no mesmo registro (vistos 117, 469 e 680) e cada mensagem que falha passa a testar
// todas elas, travando o processo. Aqui: sem mensagem disponível, nada de sessão nova e a
// tentativa conta para o limite (maxMsgRetryCount). Com mensagem, o reenvio segue igual.
//
// Roda no `prebuild` e no `pretest`. Se a biblioteca mudar e o trecho não bater, FALHA
// (não publica uma versão sem a correção).
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkgPath = require.resolve("@whiskeysockets/baileys/package.json");
const version = JSON.parse(readFileSync(pkgPath, "utf8")).version;
const file = join(dirname(pkgPath), "lib", "Socket", "messages-recv.js");
const MARKER = "// disparei-patch: retry-sem-mensagem";

const ORIGINAL_HEAD = `        const remoteJid = key.remoteJid;
        const participant = key.participant || remoteJid;
        // if it's the primary jid sending the request
        // just re-send the message to everyone
        // prevents the first message decryption failure
        const sendToAll = !jidDecode(participant)?.device;
        await assertSessions([participant], true);`;
const PATCHED_HEAD = `        const remoteJid = key.remoteJid;
        const participant = key.participant || remoteJid;
        ${MARKER}
        if (!msgs.some(Boolean)) {
            for (const id of ids) updateSendMessageAgainCount(id, participant);
            logger.debug({ jid: remoteJid, ids }, 'recv retry request, but no message available: skip forced session');
            return;
        }
        // if it's the primary jid sending the request
        // just re-send the message to everyone
        // prevents the first message decryption failure
        const sendToAll = !jidDecode(participant)?.device;
        await assertSessions([participant], true);`;
const ORIGINAL_ELSE = `            else {
                logger.debug({ jid: key.remoteJid, id: ids[i] }, 'recv retry request, but message not available');
            }`;
const PATCHED_ELSE = `            else {
                updateSendMessageAgainCount(ids[i], participant);
                logger.debug({ jid: key.remoteJid, id: ids[i] }, 'recv retry request, but message not available');
            }`;

function fail(message) {
  console.error(`[patch-baileys-retry] ERRO: ${message}`);
  process.exit(1);
}

const source = readFileSync(file, "utf8");
if (source.includes(MARKER)) {
  if (!source.includes(PATCHED_HEAD) || !source.includes(PATCHED_ELSE)) fail(`marcador presente mas o trecho corrigido não confere em ${file}`);
  console.log(`[patch-baileys-retry] já aplicado (baileys ${version})`);
  process.exit(0);
}
if (version !== "6.7.23") fail(`feito para baileys 6.7.23, instalado ${version}. Revise a correção antes de atualizar.`);
if (source.split(ORIGINAL_HEAD).length !== 2) fail("trecho de sendMessagesAgain não encontrado (ou repetido)");
if (source.split(ORIGINAL_ELSE).length !== 2) fail("trecho 'message not available' não encontrado (ou repetido)");
const patched = source.replace(ORIGINAL_HEAD, PATCHED_HEAD).replace(ORIGINAL_ELSE, PATCHED_ELSE);
writeFileSync(file, patched);
console.log(`[patch-baileys-retry] aplicado em baileys ${version}`);
