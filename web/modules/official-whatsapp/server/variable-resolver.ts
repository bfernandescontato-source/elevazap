export type InternalVariable = "first_name" | "full_name" | "product_name" | "email" | "phone" | "amount" | "payment_url" | "access_url";

export const INTERNAL_VARIABLES: { value: InternalVariable; label: string }[] = [
  { value: "first_name", label: "Primeiro nome" },
  { value: "full_name", label: "Nome completo" },
  { value: "product_name", label: "Nome do produto" },
  { value: "email", label: "E-mail" },
  { value: "phone", label: "Telefone" },
  { value: "amount", label: "Valor" },
  { value: "payment_url", label: "Link de pagamento" },
  { value: "access_url", label: "Link de acesso" }
];

export const STATIC_VALUE_PREFIX = "static:";

export type EventContext = {
  customerName: string | null;
  productName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  amountCents: number | null;
  paymentUrl: string | null;
  accessUrl: string | null;
};

// Cada slot do template pode mapear para uma variável interna do evento (dinâmica) ou para um
// valor fixo por automação (ex: {{bonus_name}} não vem da Hubla — é texto constante), marcado
// com o prefixo "static:". Em templates POSITIONAL a chave é a posição ("1","2"); em NAMED é o
// parameter_name do próprio template ("first_name", "bonus_name"...).
export type VariableMapping = { header?: Record<string, string>; body?: Record<string, string> };

function resolveVariable(name: string, context: EventContext): string {
  if (name.startsWith(STATIC_VALUE_PREFIX)) return name.slice(STATIC_VALUE_PREFIX.length);
  switch (name) {
    case "first_name": return context.customerName?.split(" ")[0] || "";
    case "full_name": return context.customerName || "";
    case "product_name": return context.productName || "";
    case "email": return context.customerEmail || "";
    case "phone": return context.customerPhone || "";
    case "amount": return context.amountCents != null ? (context.amountCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "";
    case "payment_url": return context.paymentUrl || "";
    case "access_url": return context.accessUrl || "";
    default: return "";
  }
}

function orderedEntries(section: Record<string, string> | undefined, parameterFormat: "POSITIONAL" | "NAMED") {
  const entries = Object.entries(section || {});
  return parameterFormat === "NAMED" ? entries : entries.sort(([a], [b]) => Number(a) - Number(b));
}

// Variáveis que resolvem para string vazia bloqueiam o envio — não mandamos template com
// parâmetro em branco pra Meta. Um valor "static:" só fica vazio se o admin deixou em branco.
export function missingRequiredVariables(mapping: VariableMapping, context: EventContext): string[] {
  const missing: string[] = [];
  for (const section of [mapping.header, mapping.body]) {
    for (const [, varName] of orderedEntries(section, "POSITIONAL")) {
      if (!resolveVariable(varName, context)) missing.push(varName);
    }
  }
  return missing;
}

const FREE_TEXT_VARIABLE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

// Substitui {{var}} em texto livre (respostas a clique de botão) — mesma semântica de
// resolveVariable. O admin digita o resto do texto literalmente, sem prefixo "static:".
export function renderTemplateText(text: string, context: EventContext): { text: string; missing: string[] } {
  const missing: string[] = [];
  const rendered = text.replace(FREE_TEXT_VARIABLE_PATTERN, (_match, name: string) => {
    const value = resolveVariable(name, context);
    if (!value) missing.push(name);
    return value;
  });
  return { text: rendered, missing };
}

// Texto legível pra preview de disparo (não é o payload da Meta, é só pra admin conferir antes
// de confirmar) — substitui {{1}}/{{name}} no corpo do template usando o mesmo mapeamento do
// fluxo. Placeholder sem entrada no mapeamento fica visível como está, não vira string vazia.
export function renderTemplateBodyPreview(bodyText: string, bodyMapping: Record<string, string> | undefined, context: EventContext, parameterFormat: "POSITIONAL" | "NAMED"): string {
  if (!bodyMapping) return bodyText;
  const pattern = parameterFormat === "NAMED" ? /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g : /\{\{\s*(\d+)\s*\}\}/g;
  return bodyText.replace(pattern, (match, key: string) => {
    const varName = bodyMapping[key];
    return varName ? resolveVariable(varName, context) || match : match;
  });
}

export function buildTemplateComponents(mapping: VariableMapping, context: EventContext, parameterFormat: "POSITIONAL" | "NAMED" = "POSITIONAL") {
  const components: Array<{ type: string; parameters: Array<{ type: "text"; text: string; parameter_name?: string }> }> = [];
  const header = orderedEntries(mapping.header, parameterFormat);
  const body = orderedEntries(mapping.body, parameterFormat);
  const toParameter = ([key, varName]: [string, string]) => parameterFormat === "NAMED"
    ? { type: "text" as const, parameter_name: key, text: resolveVariable(varName, context) }
    : { type: "text" as const, text: resolveVariable(varName, context) };
  if (header.length) components.push({ type: "header", parameters: header.map(toParameter) });
  if (body.length) components.push({ type: "body", parameters: body.map(toParameter) });
  return components;
}
