import { graphRequest, metaIdentifiers } from "./meta-client";
import { OfficialWhatsAppError } from "./errors";

export type WhatsAppTemplateButton = { type: string; text?: string; url?: string; phone_number?: string; example?: string[] };
export type WhatsAppTemplateComponent = {
  type: string;
  format?: string;
  text?: string;
  buttons?: WhatsAppTemplateButton[];
  example?: { header_text_named_params?: { param_name: string }[]; body_text_named_params?: { param_name: string }[]; [key: string]: unknown };
  [key: string]: unknown;
};

// Contagem de variáveis por posição no template — a Meta permite variáveis em HEADER (formato
// TEXT), BODY e em botões do tipo URL dinâmica. Guardamos os três separadamente para que a
// UI de mapeamento saiba onde cada variável se aplica.
export type TemplateVariableSummary = { header: number; body: number; buttons: number };

// A Meta suporta dois formatos de parâmetro: POSITIONAL ({{1}}, {{2}}, casado por ordem) e
// NAMED ({{first_name}}, {{product_name}}, casado por parameter_name). O payload de envio é
// diferente para cada um — nunca assumir POSITIONAL sem checar parameter_format primeiro.
export type ParameterFormat = "POSITIONAL" | "NAMED";

export type WhatsAppTemplate = {
  name: string;
  category: string;
  status: string;
  language: string;
  components: WhatsAppTemplateComponent[];
  variables: TemplateVariableSummary;
  parameterFormat: ParameterFormat;
  namedVariables: { header: string[]; body: string[] };
  dynamicUrlButtonIndexes: string[];
};

function countPlaceholders(text?: string) {
  if (!text) return 0;
  return new Set(String(text).match(/\{\{\s*\d+\s*\}\}/g) || []).size;
}

function namedParams(component?: WhatsAppTemplateComponent, key: "header_text_named_params" | "body_text_named_params" = "body_text_named_params") {
  const list = component?.example?.[key];
  return Array.isArray(list) ? list.map((item) => item.param_name).filter((name): name is string => typeof name === "string" && name.length > 0) : [];
}

export function summarizeTemplateVariables(components: WhatsAppTemplateComponent[], parameterFormat: ParameterFormat = "POSITIONAL"): TemplateVariableSummary {
  const header = components.find((component) => component.type === "HEADER");
  const body = components.find((component) => component.type === "BODY");
  const buttons = components.find((component) => component.type === "BUTTONS");
  const buttonVariables = (buttons?.buttons || []).reduce((total, button) => total + countPlaceholders(button.url), 0);
  if (parameterFormat === "NAMED") {
    return {
      header: namedParams(header, "header_text_named_params").length,
      body: namedParams(body, "body_text_named_params").length,
      buttons: buttonVariables
    };
  }
  return {
    header: header?.format === "TEXT" ? countPlaceholders(header.text) : 0,
    body: countPlaceholders(body?.text),
    buttons: buttonVariables
  };
}

export async function listTemplates(connectionId?: string | null): Promise<WhatsAppTemplate[]> {
  const { wabaId } = await metaIdentifiers(connectionId);
  if (!wabaId) throw new OfficialWhatsAppError("META_NOT_CONFIGURED", "Configure META_WABA_ID.");
  const data = await graphRequest(`/${wabaId}/message_templates?fields=name,category,status,language,parameter_format,components&limit=200`, undefined, connectionId);
  const templates: WhatsAppTemplate[] = (data.data || []).map((item: any) => {
    const components: WhatsAppTemplateComponent[] = item.components || [];
    const parameterFormat: ParameterFormat = item.parameter_format === "NAMED" ? "NAMED" : "POSITIONAL";
    const header = components.find((component) => component.type === "HEADER");
    const body = components.find((component) => component.type === "BODY");
    const buttons = components.find((component) => component.type === "BUTTONS");
    return {
      name: item.name,
      category: item.category,
      status: item.status,
      language: item.language,
      components,
      parameterFormat,
      namedVariables: parameterFormat === "NAMED"
        ? { header: namedParams(header, "header_text_named_params"), body: namedParams(body, "body_text_named_params") }
        : { header: [], body: [] },
      dynamicUrlButtonIndexes: (buttons?.buttons || []).flatMap((button, index) => countPlaceholders(button.url) ? [String(index)] : []),
      variables: summarizeTemplateVariables(components, parameterFormat)
    };
  });
  return templates.sort((a, b) => {
    if (a.status !== b.status) return a.status === "APPROVED" ? -1 : b.status === "APPROVED" ? 1 : 0;
    return a.name.localeCompare(b.name);
  });
}

export async function findTemplate(name: string, language?: string, connectionId?: string | null): Promise<WhatsAppTemplate> {
  const templates = await listTemplates(connectionId);
  const template = templates.find((item) => item.name === name && (!language || item.language === language));
  if (!template) throw new OfficialWhatsAppError("TEMPLATE_NOT_FOUND", `Template "${name}" não encontrado.`);
  if (template.status !== "APPROVED") throw new OfficialWhatsAppError("TEMPLATE_NOT_APPROVED", `Template "${name}" não está aprovado (status: ${template.status}).`);
  return template;
}

// MVP: envio de teste simples preenche header/body com valores genéricos — em POSITIONAL por
// ordem, em NAMED usando parameter_name. Botões com URL dinâmica não são suportados aqui.
export function buildTestComponents(template: WhatsAppTemplate) {
  if (template.variables.buttons > 0) {
    throw new OfficialWhatsAppError("MISSING_TEMPLATE_VARIABLE", `Template "${template.name}" tem variável em botão dinâmico, não suportado no envio de teste simples.`);
  }
  const components: Array<{ type: string; parameters: Array<{ type: "text"; text: string; parameter_name?: string }> }> = [];
  if (template.parameterFormat === "NAMED") {
    if (template.namedVariables.header.length) components.push({ type: "header", parameters: template.namedVariables.header.map((name) => ({ type: "text", parameter_name: name, text: `Teste (${name})` })) });
    if (template.namedVariables.body.length) components.push({ type: "body", parameters: template.namedVariables.body.map((name) => ({ type: "text", parameter_name: name, text: `Teste (${name})` })) });
    return components;
  }
  if (template.variables.header > 0) {
    components.push({ type: "header", parameters: Array.from({ length: template.variables.header }, (_, index) => ({ type: "text", text: `Cabeçalho ${index + 1}` })) });
  }
  if (template.variables.body > 0) {
    components.push({ type: "body", parameters: Array.from({ length: template.variables.body }, (_, index) => ({ type: "text", text: `Teste ${index + 1}` })) });
  }
  return components;
}
