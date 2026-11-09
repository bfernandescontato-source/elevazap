import { jidEncode, jidNormalizedUser } from "@whiskeysockets/baileys";
import { validateGroupJid } from "../utils/phone.js";

/**
 * Postagem no Status do WhatsApp pela fila normal de grupos.
 *
 * O painel cria um envio comum (envios_grupo, tipo imagem) com o destino
 * `status@broadcast`. A fila reivindica, cadencia e confirma como qualquer
 * outro envio do número; só a montagem do destino muda.
 *
 * No Baileys 6.7.23 o Status é um "grupo" sem metadados: quem vê é a lista
 * `statusJidList` passada no envio. Não guardamos contatos do celular, então o
 * público são os participantes dos grupos que o aluno escolheu (no máximo 5
 * grupos, sem repetição, até 300 pessoas), mais o próprio número, para o
 * story aparecer em "Meu status" no celular dele.
 *
 * Custo: a cada postagem o Baileys reenvia a chave do Status para todos os
 * aparelhos da lista (não reaproveita como nos grupos). Por isso o público é
 * limitado e os aparelhos e sessões são preparados antes, fora do prazo de
 * envio, igual à preparação dos grupos.
 */

export const STATUS_JID = "status@broadcast";
export const STATUS_AUDIENCE_MAX = 300;
export const STATUS_AUDIENCE_GROUPS_MAX = 5;

const USER_JID = /^\d{8,15}@s\.whatsapp\.net$/;

export function isStatusJob(row: { group_jid?: string | null } | null | undefined) {
  return row?.group_jid === STATUS_JID;
}

/** Grupos de público gravados no envio, já filtrados (formato, repetição, limite). */
export function statusAudienceGroups(row: { status_audience_jids?: unknown }): string[] {
  const raw = Array.isArray(row.status_audience_jids) ? row.status_audience_jids : [];
  return Array.from(new Set(raw.filter((jid): jid is string => typeof jid === "string" && validateGroupJid(jid)))).slice(0, STATUS_AUDIENCE_GROUPS_MAX);
}

type Participant = { id?: string; jid?: string };

/**
 * Lista de quem verá o Status, sempre em número de telefone (@s.whatsapp.net):
 * o Baileys monta os destinos do Status nesse formato, e um id @lid viraria um
 * destino inválido. Participante sem telefone conhecido fica de fora.
 */
export function buildStatusAudience(groups: Array<{ participants?: Participant[] }>, ownJid: string, max = STATUS_AUDIENCE_MAX): string[] {
  const own = ownJid ? jidNormalizedUser(ownJid) : "";
  const audience = new Set<string>();
  for (const group of groups) {
    for (const participant of group.participants || []) {
      const candidate = [participant.jid, participant.id].find(value => typeof value === "string" && USER_JID.test(jidNormalizedUser(value)));
      if (!candidate) continue;
      const jid = jidNormalizedUser(candidate);
      if (jid === own) continue;
      audience.add(jid);
      if (audience.size >= max) break;
    }
    if (audience.size >= max) break;
  }
  return own ? [own, ...audience] : [...audience];
}

export function buildStatusMessage(row: { legenda?: string | null; texto?: string | null }, media: Buffer) {
  const caption = String(row.legenda || row.texto || "").trim();
  return caption ? { image: media, caption } : { image: media };
}

/**
 * Lê os participantes dos grupos e prepara aparelhos e sessões de quem verá o
 * Status, sem enviar nada. Roda antes do prazo de envio; se demorar, falha só
 * esta etapa e a conexão do número não é derrubada.
 */
export async function prepareStatusAudience(sock: any, groupJids: string[]): Promise<string[]> {
  const groups: Array<{ participants?: Participant[] }> = [];
  for (const jid of groupJids) groups.push(await sock.groupMetadata(jid));
  const audience = buildStatusAudience(groups, String(sock.user?.id || ""));
  if (audience.length <= 1) return audience;
  const devices = await sock.getUSyncDevices(audience, true, false);
  await sock.authState.keys.transaction(async () => {
    await sock.assertSessions(devices.map((device: any) => jidEncode(device.user, "s.whatsapp.net", device.device)), false);
  });
  return audience;
}
