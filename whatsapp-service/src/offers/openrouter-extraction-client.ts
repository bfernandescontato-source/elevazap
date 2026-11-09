import { parseModelList } from "@disparei/affiliate-links/offer-hooks";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const TOTAL_TIMEOUT_MS = 30_000;

type InputMessage = { role: string; content: string };
type CreateParams = {
  max_output_tokens?: number;
  input: InputMessage[];
  text?: { format?: { schema?: { properties?: Record<string, unknown> } } };
};
export type ExtractionResponse = { status: "completed" | "failed"; output_text: string; model: string; usage?: unknown };

function firstJsonObject(content: string): string | null {
  const text = content.replace(/```(?:json)?/gi, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const candidate = text.slice(start, end + 1);
  try { JSON.parse(candidate); return candidate; } catch { return null; }
}

/**
 * Extração dos dados da oferta por modelos gratuitos do OpenRouter, com a mesma
 * forma de resposta que o rewriter espera da OpenAI. Os modelos são tentados em
 * ordem até um devolver JSON; quem valida preço e número é verifyExtractedOffer.
 */
export function createOpenRouterExtractionClient(options: { apiKey: string; models: string | string[]; fetch?: typeof fetch; timeoutMs?: number }) {
  const models = Array.isArray(options.models) ? options.models : parseModelList(options.models);
  const doFetch = options.fetch || globalThis.fetch;
  return {
    responses: {
      async create(params: CreateParams): Promise<ExtractionResponse> {
        const keys = Object.keys(params.text?.format?.schema?.properties || {});
        const messages = params.input.map((message) => ({ role: message.role, content: message.content }));
        if (keys.length) messages.unshift({ role: "system", content: `Responda só com um objeto JSON com exatamente estas chaves: ${keys.join(", ")}. Use null quando não houver o dado. Sem texto fora do JSON.` });
        const deadline = Date.now() + (options.timeoutMs || TOTAL_TIMEOUT_MS);
        let lastError = "Nenhum modelo gratuito configurado.";
        for (const model of models) {
          const remaining = deadline - Date.now();
          if (remaining <= 100) break;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), remaining);
          try {
            const response = await doFetch(OPENROUTER_URL, {
              method: "POST", signal: controller.signal,
              headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json", "x-title": "Disparei" },
              body: JSON.stringify({ model, messages, max_tokens: Math.max(params.max_output_tokens || 400, 600), temperature: 0 })
            });
            if (!response.ok) { lastError = `OpenRouter respondeu ${response.status}.`; continue; }
            const body = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: unknown };
            const json = firstJsonObject(body.choices?.[0]?.message?.content || "");
            if (json) return { status: "completed", output_text: json, model: `openrouter:${model}`, usage: body.usage };
            lastError = "O modelo não devolveu JSON.";
          } catch (error) {
            lastError = error instanceof Error ? error.message : "Falha no OpenRouter.";
          } finally {
            clearTimeout(timer);
          }
        }
        throw new Error(`IA gratuita indisponível: ${lastError}`);
      }
    }
  };
}
