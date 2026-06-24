import axios from "axios";
import { env } from "../env.js";
import { supabase } from "../supabase.js";
import type { LLMTool } from "./llm.js";

export const SUPPORT_TOOLS: LLMTool[] = [
  {
    name: "buscar_pedido",
    description: "Busca informações read-only de um pedido no ElevaPay por e-mail, telefone ou order_id. Retorna status, valor, data e produto.",
    parameters: {
      type: "object",
      properties: {
        identificador: { type: "string", description: "E-mail, telefone ou order_id do pedido" }
      },
      required: ["identificador"]
    }
  },
  {
    name: "consultar_status_reembolso",
    description: "Consulta o status de uma solicitação de reembolso pelo order_id.",
    parameters: {
      type: "object",
      properties: {
        order_id: { type: "string", description: "ID do pedido" }
      },
      required: ["order_id"]
    }
  },
  {
    name: "solicitar_reembolso",
    description: "Abre uma solicitação de reembolso pendente de aprovação humana. NÃO processa o estorno automaticamente.",
    parameters: {
      type: "object",
      properties: {
        order_id: { type: "string", description: "ID do pedido" },
        motivo: { type: "string", description: "Motivo do reembolso descrito pelo cliente" }
      },
      required: ["order_id", "motivo"]
    }
  },
  {
    name: "escalar_humano",
    description: "Escala a conversa para atendimento humano e notifica o dono.",
    parameters: {
      type: "object",
      properties: {
        motivo: { type: "string", description: "Motivo da escalação" }
      },
      required: ["motivo"]
    }
  },
  {
    name: "registrar_resolvido",
    description: "Marca a conversa como resolvida/fechada.",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  }
];

async function elevapayGet(path: string) {
  if (!env.ELEVAPAY_API_URL || !env.ELEVAPAY_API_KEY) return null;
  const resp = await axios.get(`${env.ELEVAPAY_API_URL}${path}`, {
    headers: { Authorization: `Bearer ${env.ELEVAPAY_API_KEY}` },
    timeout: 10_000
  });
  return resp.data;
}

export type ToolContext = {
  conversationId: string;
  contactJid: string;
  notifyJid?: string;
  sock: any;
};

export type ToolSideEffect =
  | { type: "escalate" }
  | { type: "close" };

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<{ result: string; sideEffect?: ToolSideEffect }> {
  try {
    switch (name) {
      case "buscar_pedido": {
        const id = String(args.identificador || "");
        const data = await elevapayGet(`/orders/search?q=${encodeURIComponent(id)}`).catch(() => null);
        if (!data) return { result: "Não foi possível localizar o pedido. Verifique o identificador informado." };
        return { result: JSON.stringify(data) };
      }

      case "consultar_status_reembolso": {
        const orderId = String(args.order_id || "");
        const { data: req } = await supabase
          .from("refund_request")
          .select("status, created_at, decided_at")
          .eq("elevapay_order_id", orderId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!req) return { result: "Nenhuma solicitação de reembolso encontrada para este pedido." };
        return { result: `Status do reembolso: ${req.status}. Criado em: ${req.created_at}${req.decided_at ? `. Decidido em: ${req.decided_at}` : ""}.` };
      }

      case "solicitar_reembolso": {
        const orderId = String(args.order_id || "");
        const motivo = String(args.motivo || "");
        let amount: number | null = null;
        try {
          const data = await elevapayGet(`/orders/${encodeURIComponent(orderId)}`);
          amount = data?.amount ?? null;
        } catch {}

        await supabase.from("refund_request").insert({
          conversation_id: ctx.conversationId,
          contact_jid: ctx.contactJid,
          elevapay_order_id: orderId,
          amount,
          reason: motivo,
          status: "pending"
        });

        if (ctx.notifyJid && ctx.sock) {
          await ctx.sock.sendMessage(ctx.notifyJid, {
            text: `⚠️ Nova solicitação de reembolso pendente de aprovação.\nPedido: ${orderId}\nMotivo: ${motivo}`
          }).catch(() => undefined);
        }

        return { result: "Solicitação de reembolso registrada com sucesso e enviada para aprovação da equipe. Você receberá um retorno em breve." };
      }

      case "escalar_humano": {
        const motivo = String(args.motivo || "");
        await supabase.from("support_conversation")
          .update({ status: "human_active", updated_at: new Date().toISOString() })
          .eq("id", ctx.conversationId);

        if (ctx.notifyJid && ctx.sock) {
          await ctx.sock.sendMessage(ctx.notifyJid, {
            text: `🚨 Conversa escalada para atendimento humano.\nContato: ${ctx.contactJid}\nMotivo: ${motivo}`
          }).catch(() => undefined);
        }

        return { result: "Conversa transferida para nossa equipe. Um atendente entrará em contato em breve.", sideEffect: { type: "escalate" } };
      }

      case "registrar_resolvido": {
        await supabase.from("support_conversation")
          .update({ status: "closed", updated_at: new Date().toISOString() })
          .eq("id", ctx.conversationId);
        return { result: "Conversa encerrada com sucesso.", sideEffect: { type: "close" } };
      }

      default:
        return { result: `Ferramenta desconhecida: ${name}` };
    }
  } catch (e: any) {
    return { result: `Erro ao executar ${name}: ${e.message}` };
  }
}
