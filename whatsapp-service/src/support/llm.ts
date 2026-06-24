import OpenAI from "openai";
import { env } from "../env.js";

export type LLMMessage = { role: "system" | "user" | "assistant" | "tool"; content: string; tool_call_id?: string; name?: string };
export type LLMTool = { name: string; description: string; parameters: Record<string, unknown> };
export type ToolCall = { id: string; name: string; args: Record<string, unknown> };
export type LLMResult = { content: string | null; toolCalls: ToolCall[] };

let _openai: OpenAI | null = null;
function openai() {
  if (!_openai) _openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return _openai;
}

export async function callLLM(
  model: string,
  temperature: number,
  messages: LLMMessage[],
  tools: LLMTool[]
): Promise<LLMResult> {
  const openaiMessages = messages.map((m): OpenAI.ChatCompletionMessageParam => {
    if (m.role === "tool") {
      return { role: "tool", content: m.content, tool_call_id: m.tool_call_id! };
    }
    return { role: m.role as "system" | "user" | "assistant", content: m.content };
  });

  const openaiTools: OpenAI.ChatCompletionTool[] = tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }));

  const resp = await openai().chat.completions.create({
    model,
    temperature,
    messages: openaiMessages,
    tools: openaiTools.length ? openaiTools : undefined,
    tool_choice: openaiTools.length ? "auto" : undefined
  });

  const msg = resp.choices[0]?.message;
  if (!msg) return { content: null, toolCalls: [] };

  const toolCalls: ToolCall[] = (msg.tool_calls || []).map((tc: any) => ({
    id: tc.id,
    name: tc.function?.name ?? "",
    args: JSON.parse(tc.function?.arguments || "{}")
  }));

  return { content: msg.content ?? null, toolCalls };
}
