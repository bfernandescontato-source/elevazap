import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeBrazilianPhone } from "../lib/phone";
import { isInternalAdmin } from "../lib/internal-admin";
import { buildTestComponents, summarizeTemplateVariables, type WhatsAppTemplate } from "../modules/official-whatsapp/server/templates";
import { extractEventType, extractProviderEventId, extractRelevantHeaders } from "../modules/official-whatsapp/server/hubla-events";
import { parseHublaEvent } from "../modules/official-whatsapp/server/hubla-parser";
import hublaInvoicePaymentSucceeded from "./fixtures/hubla-invoice-payment-succeeded.json";
import { buildTemplateComponents, missingRequiredVariables, renderTemplateBodyPreview, renderTemplateText, type EventContext } from "../modules/official-whatsapp/server/variable-resolver";
import { classifyContacts } from "../modules/official-whatsapp/server/broadcast-contacts";
import { buildQuickReplyMessage } from "../modules/official-whatsapp/server/send-interactive";
import type { QuickReplyAction } from "../modules/official-whatsapp/server/quick-reply-actions";
import { generateExternalSecret, hashExternalSecret, externalSecretMatches, parseExternalSourceInput } from "../modules/official-whatsapp/server/external-sources";
import { extractLeadFields, resolveContentName, buildLeadContext } from "../modules/official-whatsapp/server/external-leads";
import { createTrackedLinkToken, verifyTrackedLinkToken } from "../modules/official-whatsapp/server/tracked-links";

describe("normalização de telefone (reaproveitada no WhatsApp Oficial)", () => {
  it("aceita formatos comuns de telefone brasileiro", () => {
    expect(normalizeBrazilianPhone("(19) 99999-9999")).toBe("5519999999999");
    expect(normalizeBrazilianPhone("19 99999-9999")).toBe("5519999999999");
    expect(normalizeBrazilianPhone("5519999999999")).toBe("5519999999999");
    expect(normalizeBrazilianPhone("+55 19 99999-9999")).toBe("5519999999999");
  });

  it("não adiciona 55 quando o número já traz o código do país", () => {
    expect(normalizeBrazilianPhone("+55 19 99999-9999")).not.toBe("55" + "5519999999999");
  });

  it("rejeita telefone vazio ou inválido em vez de tentar adivinhar", () => {
    expect(() => normalizeBrazilianPhone("")).toThrow();
    expect(() => normalizeBrazilianPhone("123")).toThrow();
    expect(() => normalizeBrazilianPhone("55 00 99999-9999")).toThrow();
  });
});

describe("autorização do módulo WhatsApp Oficial", () => {
  const requiredEnv: Record<string, string> = {
    NEXT_PUBLIC_APP_URL: "https://example.com",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_KEY: "service",
    WHATSAPP_SERVICE_URL: "https://example.com",
    INTERNAL_API_KEY: "x".repeat(24),
    ELEVAPAY_WEBHOOK_TOKEN: "x".repeat(16),
    MEU_NUMERO_TESTE: "5511999999999",
    ADMIN_EMAIL: "admin@example.com",
    ADMIN_PASSWORD_HASH: "x".repeat(20),
    AUTH_SECRET: "x".repeat(32)
  };
  const original: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const [key, value] of Object.entries(requiredEnv)) {
      original[key] = process.env[key];
      process.env[key] = value;
    }
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("permite apenas a sessão cujo e-mail é o ADMIN_EMAIL configurado", () => {
    expect(isInternalAdmin({ email: "admin@example.com" })).toBe(true);
    expect(isInternalAdmin({ email: "ADMIN@EXAMPLE.COM" })).toBe(true);
  });

  it("bloqueia qualquer outro usuário, mesmo com role admin de conta/tenant", () => {
    expect(isInternalAdmin({ email: "admin-de-outra-conta@empresa.com" })).toBe(false);
    expect(isInternalAdmin(null)).toBe(false);
    expect(isInternalAdmin(undefined)).toBe(false);
  });
});

function makeTemplate(overrides: Partial<WhatsAppTemplate>): WhatsAppTemplate {
  return { name: "t", category: "UTILITY", status: "APPROVED", language: "pt_BR", components: [], variables: { header: 0, body: 0, buttons: 0 }, parameterFormat: "POSITIONAL", namedVariables: { header: [], body: [] }, dynamicUrlButtonIndexes: [], ...overrides };
}

describe("detecção de variáveis de template Meta (header, body e botões)", () => {
  it("conta variáveis no corpo do template", () => {
    expect(summarizeTemplateVariables([{ type: "BODY", text: "Olá {{1}}, seu pagamento do {{2}} foi confirmado." }]).body).toBe(2);
    expect(summarizeTemplateVariables([{ type: "BODY", text: "Sem variáveis." }]).body).toBe(0);
    expect(summarizeTemplateVariables([]).body).toBe(0);
  });

  it("conta variáveis no header apenas quando o formato é TEXT", () => {
    expect(summarizeTemplateVariables([{ type: "HEADER", format: "TEXT", text: "Oi {{1}}" }]).header).toBe(1);
    expect(summarizeTemplateVariables([{ type: "HEADER", format: "IMAGE" }]).header).toBe(0);
  });

  it("conta variáveis em botões de URL dinâmica", () => {
    expect(summarizeTemplateVariables([{ type: "BUTTONS", buttons: [{ type: "URL", text: "Ver pedido", url: "https://x.com/{{1}}" }, { type: "QUICK_REPLY", text: "Ok" }] }]).buttons).toBe(1);
  });

  it("gera parâmetros de teste correspondentes ao número de variáveis do corpo e do header", () => {
    const template = makeTemplate({ variables: { header: 1, body: 2, buttons: 0 } });
    expect(buildTestComponents(template)).toEqual([
      { type: "header", parameters: [{ type: "text", text: "Cabeçalho 1" }] },
      { type: "body", parameters: [{ type: "text", text: "Teste 1" }, { type: "text", text: "Teste 2" }] }
    ]);
  });

  it("não envia components quando o template não tem variáveis", () => {
    expect(buildTestComponents(makeTemplate({}))).toEqual([]);
  });

  it("recusa envio de teste simples para templates com variável em botão dinâmico", () => {
    const template = makeTemplate({ variables: { header: 0, body: 0, buttons: 1 } });
    expect(() => buildTestComponents(template)).toThrow();
  });

  it("detecta variáveis nomeadas (parameter_format NAMED) a partir de example.body_text_named_params", () => {
    const components = [{ type: "BODY", text: "Olá {{first_name}}! Seu pagamento do {{product_name}} foi confirmado.", example: { body_text_named_params: [{ param_name: "first_name" }, { param_name: "product_name" }] } }];
    expect(summarizeTemplateVariables(components, "NAMED")).toEqual({ header: 0, body: 2, buttons: 0 });
  });

  it("gera parâmetros de teste com parameter_name para templates NAMED", () => {
    const template = makeTemplate({
      parameterFormat: "NAMED",
      namedVariables: { header: [], body: ["first_name", "bonus_name"] },
      variables: { header: 0, body: 2, buttons: 0 }
    });
    expect(buildTestComponents(template)).toEqual([
      { type: "body", parameters: [{ type: "text", parameter_name: "first_name", text: "Teste (first_name)" }, { type: "text", parameter_name: "bonus_name", text: "Teste (bonus_name)" }] }
    ]);
  });
});

describe("captura de webhook da Hubla (modo captura, sem assumir formato)", () => {
  it("extrai id de evento a partir dos nomes de campo mais comuns", () => {
    expect(extractProviderEventId({ event_id: "evt_123" })).toBe("evt_123");
    expect(extractProviderEventId({ transaction_id: "txn_456" })).toBe("txn_456");
    expect(extractProviderEventId({ data: { id: "abc" } })).toBe("abc");
    expect(extractProviderEventId({ event: { transaction_id: "txn_789" } })).toBe("txn_789");
    expect(extractProviderEventId({ id: 12345 })).toBe("12345");
  });

  it("retorna null quando nenhum campo conhecido existe, sem quebrar", () => {
    expect(extractProviderEventId({ foo: "bar" })).toBeNull();
    expect(extractProviderEventId(null)).toBeNull();
    expect(extractProviderEventId("string qualquer")).toBeNull();
    expect(extractProviderEventId({ event_id: "" })).toBeNull();
  });

  it("extrai o tipo do evento de 'type' ou 'event' quando são string", () => {
    expect(extractEventType({ type: "pix.criado" })).toBe("pix.criado");
    expect(extractEventType({ event: "compra.aprovada" })).toBe("compra.aprovada");
    expect(extractEventType({ type: 123 })).toBeNull();
    expect(extractEventType({})).toBeNull();
  });

  it("interpreta o payload real de invoice.payment_succeeded observado em produção", () => {
    const parsed = parseHublaEvent(hublaInvoicePaymentSucceeded);
    expect(parsed.eventType).toBe("invoice.payment_succeeded");
    expect(parsed.providerEventId).toBe("53a0a7ba-d2f8-4285-addd-6cdf0a937568-tester");
    expect(parsed.productId).toBe("8Qndp0ld0K9vFW0hkDos");
    expect(parsed.productName).toBe("ACHADINHOS ADS E AUTOMAÇÕES");
    expect(parsed.customerName).toBe("BWB User Name");
    expect(parsed.customerEmail).toBe("test-payer-email@example.com");
    expect(parsed.customerPhone).toBe("B4TBBT");
    expect(parsed.amountCents).toBe(990);
  });

  it("não quebra e devolve tudo null para um payload em formato desconhecido", () => {
    expect(() => parseHublaEvent({ something: "unexpected" })).not.toThrow();
    const parsed = parseHublaEvent({ something: "unexpected" });
    expect(parsed).toEqual({
      eventType: null, providerEventId: null, productId: null, productName: null,
      customerName: null, customerPhone: null, customerEmail: null, amountCents: null,
      paymentUrl: null, accessUrl: null
    });
    expect(parseHublaEvent(null)).toEqual(parseHublaEvent({}));
  });

  it("captura apenas headers seguros, nunca Authorization/Cookie", () => {
    const headers = new Headers({
      "content-type": "application/json",
      "user-agent": "Hubla/1.0",
      "x-hubla-signature": "abc",
      authorization: "Bearer secret",
      cookie: "session=secret"
    });
    const captured = extractRelevantHeaders(headers);
    expect(captured["content-type"]).toBe("application/json");
    expect(captured["x-hubla-signature"]).toBe("abc");
    expect(captured.authorization).toBeUndefined();
    expect(captured.cookie).toBeUndefined();
  });
});

function makeContext(overrides: Partial<EventContext> = {}): EventContext {
  return { customerName: "Maria Silva", productName: "Shop Lab", customerEmail: "maria@example.com", customerPhone: "5519999999999", amountCents: 4990, paymentUrl: null, accessUrl: null, ...overrides };
}

describe("resolução de variáveis de automação", () => {
  it("resolve first_name, full_name e product_name a partir do contexto do evento", () => {
    const components = buildTemplateComponents({ body: { "1": "first_name", "2": "product_name" } }, makeContext());
    expect(components).toEqual([{ type: "body", parameters: [{ type: "text", text: "Maria" }, { type: "text", text: "Shop Lab" }] }]);
  });

  it("formata amount em reais", () => {
    const components = buildTemplateComponents({ body: { "1": "amount" } }, makeContext({ amountCents: 4990 }));
    expect(components[0].parameters[0].text).toContain("49,90");
  });

  it("monta header e body juntos, respeitando a ordem numérica", () => {
    const components = buildTemplateComponents({ header: { "1": "product_name" }, body: { "1": "first_name", "2": "email" } }, makeContext());
    expect(components).toEqual([
      { type: "header", parameters: [{ type: "text", text: "Shop Lab" }] },
      { type: "body", parameters: [{ type: "text", text: "Maria" }, { type: "text", text: "maria@example.com" }] }
    ]);
  });

  it("acusa variável faltante quando o valor resolvido é vazio, em vez de mandar parâmetro em branco", () => {
    const missing = missingRequiredVariables({ body: { "1": "product_name" } }, makeContext({ productName: null }));
    expect(missing).toEqual(["product_name"]);
  });

  it("não acusa nada quando todas as variáveis mapeadas resolvem", () => {
    expect(missingRequiredVariables({ body: { "1": "first_name" } }, makeContext())).toEqual([]);
    expect(missingRequiredVariables({}, makeContext())).toEqual([]);
  });

  it("resolve valor fixo (static:) para variáveis que não vêm do evento, ex: {{bonus_name}}", () => {
    const components = buildTemplateComponents({ body: { first_name: "first_name", bonus_name: "static:Aulão ao vivo" } }, makeContext(), "NAMED");
    expect(components).toEqual([{ type: "body", parameters: [
      { type: "text", parameter_name: "first_name", text: "Maria" },
      { type: "text", parameter_name: "bonus_name", text: "Aulão ao vivo" }
    ] }]);
  });

  it("preserva todas as quebras de linha de texto fixo até o parâmetro do template", () => {
    const fixedText = `🎁 BÔNUS LIBERADO

Eu liberei um bônus especial para você:

🔥 MÁQUINA DE VENDAS™

Como construir uma operação de achadinhos para buscar seus primeiros R$10 MIL POR MÊS em comissões.

Nessa aula, eu vou abrir a estratégia que junta grupos cheios + produtos que já vendem + IA + automação para transformar seus grupos em uma verdadeira Máquina de Vendas™.

⚠️ IMPORTANTE: essa aula será liberada EXCLUSIVAMENTE dentro do Grupo VIP.

Se você não entrar, não receberá o link da aula.

👇 Entre agora para garantir o seu acesso:`;
    const savedMapping = JSON.parse(JSON.stringify({ body: { "1": `static:${fixedText}` } }));

    const components = buildTemplateComponents(savedMapping, makeContext());

    expect(components).toEqual([{ type: "body", parameters: [{ type: "text", text: fixedText }] }]);
    expect(components[0].parameters[0].text).toContain("LIBERADO\n\nEu liberei");
    expect(components[0].parameters[0].text).toContain("Grupo VIP.\n\nSe você");
  });

  it("monta components com parameter_name para templates NAMED, casando pelo nome do template", () => {
    const components = buildTemplateComponents({ body: { product_name: "product_name" } }, makeContext(), "NAMED");
    expect(components).toEqual([{ type: "body", parameters: [{ type: "text", parameter_name: "product_name", text: "Shop Lab" }] }]);
  });

  it("acusa valor fixo em branco como variável faltante, igual a uma dinâmica vazia", () => {
    expect(missingRequiredVariables({ body: { x: "static:" } }, makeContext())).toEqual(["static:"]);
  });
});

describe("renderTemplateText (texto livre de resposta a clique de botão)", () => {
  it("substitui {{var}} por valores do contexto, mantendo o resto do texto literal", () => {
    const result = renderTemplateText("Oi {{first_name}}! Seu produto {{product_name}} chegou.", makeContext());
    expect(result.text).toBe("Oi Maria! Seu produto Shop Lab chegou.");
    expect(result.missing).toEqual([]);
  });

  it("reporta variável não resolvida sem quebrar o texto", () => {
    const result = renderTemplateText("Oi {{first_name}}, bônus: {{bonus_name}}", makeContext());
    expect(result.missing).toEqual(["bonus_name"]);
    expect(result.text).toBe("Oi Maria, bônus: ");
  });

  it("texto sem variável nenhuma passa direto", () => {
    const result = renderTemplateText("Mensagem fixa, sem variável.", makeContext());
    expect(result.text).toBe("Mensagem fixa, sem variável.");
    expect(result.missing).toEqual([]);
  });
});

function makeAction(overrides: Partial<QuickReplyAction> = {}): QuickReplyAction {
  return {
    id: "a1", payload: "access_bonus", button_label: "QUERO ACESSAR", response_type: "text",
    response_text: null, media_bucket: null, media_path: null, mime_type: null, file_name: null,
    caption: null, button_config: null, active: true, created_at: "", updated_at: "", ...overrides
  };
}

describe("montagem do payload de resposta a Quick Reply (Cloud API)", () => {
  it("mensagem de texto simples, sem botão", () => {
    const message = buildQuickReplyMessage(makeAction({ response_type: "text" }), "5519999999999", { text: "Oi!", caption: null, mediaId: null });
    expect(message).toEqual({ messaging_product: "whatsapp", to: "5519999999999", type: "text", text: { body: "Oi!", preview_url: false } });
  });

  it("imagem com legenda, sem botão", () => {
    const message = buildQuickReplyMessage(makeAction({ response_type: "image" }), "5519999999999", { text: null, caption: "Seu bônus!", mediaId: "media123" });
    expect(message).toEqual({ messaging_product: "whatsapp", to: "5519999999999", type: "image", image: { id: "media123", caption: "Seu bônus!" } });
  });

  it("áudio nunca recebe legenda", () => {
    const message: any = buildQuickReplyMessage(makeAction({ response_type: "audio" }), "5519999999999", { text: null, caption: "ignorada", mediaId: "media123" });
    expect(message.audio).toEqual({ id: "media123" });
  });

  it("áudio ignora button_config mesmo se presente (Cloud API não aceita)", () => {
    const action = makeAction({ response_type: "audio", button_config: { type: "url", text: "Abrir", url: "https://x.com" } });
    const message: any = buildQuickReplyMessage(action, "5519999999999", { text: null, caption: null, mediaId: "media123" });
    expect(message.type).toBe("audio");
    expect(message.interactive).toBeUndefined();
  });

  it("texto com botão de resposta rápida vira mensagem interactive tipo button", () => {
    const action = makeAction({ response_type: "text", button_config: { type: "quick_reply", text: "ENTRAR", payload: "access_group" } });
    const message: any = buildQuickReplyMessage(action, "5519999999999", { text: "Confirmado!", caption: null, mediaId: null });
    expect(message.type).toBe("interactive");
    expect(message.interactive.type).toBe("button");
    expect(message.interactive.body).toEqual({ text: "Confirmado!" });
    expect(message.interactive.action).toEqual({ buttons: [{ type: "reply", reply: { id: "access_group", title: "ENTRAR" } }] });
    expect(message.interactive.header).toBeUndefined();
  });

  it("imagem com botão de URL vira interactive cta_url com header de imagem e legenda como body", () => {
    const action = makeAction({ response_type: "image", file_name: null, button_config: { type: "url", text: "ACESSAR", url: "https://x.com/bonus" } });
    const message: any = buildQuickReplyMessage(action, "5519999999999", { text: null, caption: "Seu bônus chegou!", mediaId: "media123" });
    expect(message.type).toBe("interactive");
    expect(message.interactive.type).toBe("cta_url");
    expect(message.interactive.header).toEqual({ type: "image", image: { id: "media123" } });
    expect(message.interactive.body).toEqual({ text: "Seu bônus chegou!" });
    expect(message.interactive.action).toEqual({ name: "cta_url", parameters: { display_text: "ACESSAR", url: "https://x.com/bonus" } });
  });

  it("substitui a URL direta pelo redirecionamento rastreável sem alterar o texto do botão", () => {
    const action = makeAction({ response_type: "text", response_text: "Entre agora", button_config: { type: "url", text: "ENTRAR NO GRUPO", url: "https://chat.whatsapp.com/original" } });
    const message: any = buildQuickReplyMessage(action, "5519999999999", { text: "Entre agora", caption: null, mediaId: null }, "https://disparei.pro/o/token");
    expect(message.interactive.action).toEqual({ name: "cta_url", parameters: { display_text: "ENTRAR NO GRUPO", url: "https://disparei.pro/o/token" } });
  });

  it("documento com botão inclui filename no header", () => {
    const action = makeAction({ response_type: "document", file_name: "contrato.pdf", button_config: { type: "quick_reply", text: "OK", payload: "ok" } });
    const message: any = buildQuickReplyMessage(action, "5519999999999", { text: null, caption: "Segue o arquivo", mediaId: "media123" });
    expect(message.interactive.header).toEqual({ type: "document", document: { id: "media123", filename: "contrato.pdf" } });
  });
});

describe("assinatura do link final rastreável", () => {
  const flowRunId = "123e4567-e89b-42d3-a456-426614174000";
  const secret = "s".repeat(32);

  it("aceita o token íntegro e rejeita adulteração", () => {
    const token = createTrackedLinkToken(flowRunId, secret);
    expect(verifyTrackedLinkToken(token, secret)).toBe(flowRunId);
    expect(verifyTrackedLinkToken(`${flowRunId}.${token.split(".")[1]}x`, secret)).toBeNull();
    expect(verifyTrackedLinkToken(token, "x".repeat(32))).toBeNull();
  });
});

describe("renderTemplateBodyPreview (preview de disparo em massa)", () => {
  it("substitui {{n}} POSITIONAL usando o mapeamento do fluxo", () => {
    const text = renderTemplateBodyPreview("Olá {{1}}, seu pagamento do {{2}} foi confirmado.", { "1": "first_name", "2": "product_name" }, makeContext(), "POSITIONAL");
    expect(text).toBe("Olá Maria, seu pagamento do Shop Lab foi confirmado.");
  });

  it("substitui {{nome}} NAMED usando o mapeamento do fluxo", () => {
    const text = renderTemplateBodyPreview("Olá {{first_name}}! {{bonus_name}} liberado.", { first_name: "first_name", bonus_name: "static:Grupo VIP" }, makeContext(), "NAMED");
    expect(text).toBe("Olá Maria! Grupo VIP liberado.");
  });

  it("mantém o placeholder visível quando não há mapeamento pra ele (preview, não bloqueia)", () => {
    const text = renderTemplateBodyPreview("Olá {{1}}, {{2}}!", { "1": "first_name" }, makeContext(), "POSITIONAL");
    expect(text).toBe("Olá Maria, {{2}}!");
  });
});

describe("classificação de contatos de disparo (CSV/XLSX)", () => {
  it("deduplica pelo telefone já normalizado, mantendo o primeiro", () => {
    const result = classifyContacts([
      { phone: "(19) 99999-9999", name: "Primeiro" },
      { phone: "19999999999", name: "Segundo" },
      { phone: "+55 19 99999-9999", name: "Terceiro" }
    ]);
    expect(result.validCount).toBe(1);
    expect(result.duplicateCount).toBe(2);
    expect(result.validContacts).toEqual([{ phone: "5519999999999", name: "Primeiro", email: null, product: null }]);
  });

  it("conta telefone inválido sem travar o resto do lote", () => {
    const result = classifyContacts([{ phone: "123" }, { phone: "5519999999999" }, { phone: "" }]);
    expect(result.invalidCount).toBe(2);
    expect(result.validCount).toBe(1);
    expect(result.totalRows).toBe(3);
  });

  it("três telefones iguais viram 1 válido + 2 duplicados, igual ao exemplo do pedido", () => {
    const result = classifyContacts([{ phone: "5519999999999" }, { phone: "5519999999999" }, { phone: "5519999999999" }]);
    expect(result.validCount).toBe(1);
    expect(result.duplicateCount).toBe(2);
  });
});

describe("secret de entrada externa (roleta / leads de fora)", () => {
  it("gera segredos aleatórios e únicos", () => {
    const a = generateExternalSecret();
    const b = generateExternalSecret();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(30);
  });

  it("o hash nunca é igual ao valor original e é determinístico", () => {
    const secret = generateExternalSecret();
    const hash = hashExternalSecret(secret);
    expect(hash).not.toBe(secret);
    expect(hashExternalSecret(secret)).toBe(hash);
  });

  it("externalSecretMatches confirma o segredo certo e rejeita qualquer outro", () => {
    const secret = generateExternalSecret();
    const hash = hashExternalSecret(secret);
    expect(externalSecretMatches(secret, hash)).toBe(true);
    expect(externalSecretMatches(secret + "x", hash)).toBe(false);
    expect(externalSecretMatches("valor-errado-qualquer", hash)).toBe(false);
    expect(externalSecretMatches("", hash)).toBe(false);
  });
});

describe("validação da entrada externa (nome, source key, fluxo)", () => {
  it("aceita source key em minúsculas, números, hífen e underscore", () => {
    const parsed = parseExternalSourceInput({ name: "Roleta Achadinhos", sourceKey: "achadinhos-ads-roleta", flowId: "flow-1" });
    expect("error" in parsed).toBe(false);
    if (!("error" in parsed)) expect(parsed.sourceKey).toBe("achadinhos-ads-roleta");
  });

  it("normaliza source key pra minúsculas", () => {
    const parsed = parseExternalSourceInput({ name: "Roleta", sourceKey: "Achadinhos-ADS", flowId: "flow-1" });
    if (!("error" in parsed)) expect(parsed.sourceKey).toBe("achadinhos-ads");
    else throw new Error("não deveria falhar");
  });

  it("rejeita source key com espaço ou caractere especial", () => {
    expect(parseExternalSourceInput({ name: "Roleta", sourceKey: "achadinhos ads", flowId: "flow-1" })).toHaveProperty("error");
    expect(parseExternalSourceInput({ name: "Roleta", sourceKey: "achadinhos/ads", flowId: "flow-1" })).toHaveProperty("error");
  });

  it("exige nome e fluxo", () => {
    expect(parseExternalSourceInput({ sourceKey: "x-1", flowId: "flow-1" })).toHaveProperty("error");
    expect(parseExternalSourceInput({ name: "Roleta", sourceKey: "x-1" })).toHaveProperty("error");
  });

  it("valor fixo de content_name é opcional e vira null se vazio", () => {
    const parsed = parseExternalSourceInput({ name: "Roleta", sourceKey: "x-1", flowId: "flow-1" });
    if (!("error" in parsed)) expect(parsed.fixedContentName).toBeNull();
    else throw new Error("não deveria falhar");
  });
});

describe("payload de lead externo (roleta) — extração e mapeamento pro EventContext", () => {
  it("extrai nome, telefone, origem e prêmio do payload cru da roleta", () => {
    const fields = extractLeadFields({ nome: "Bruno Fernandes", telefone: "5519999999999", origem: "achadinhos-ads-roleta", premio: "Bônus Secreto" });
    expect(fields).toEqual({ fullName: "Bruno Fernandes", rawPhone: "5519999999999", sourceKey: "achadinhos-ads-roleta", premio: "Bônus Secreto" });
  });

  it("campos ausentes ou não-string viram null em vez de quebrar", () => {
    const fields = extractLeadFields({ nome: "", telefone: 123 as any, origem: null });
    expect(fields.fullName).toBeNull();
    expect(fields.rawPhone).toBeNull();
    expect(fields.sourceKey).toBeNull();
  });

  it("body nulo não lança erro", () => {
    expect(extractLeadFields(null)).toEqual({ fullName: null, rawPhone: null, sourceKey: null, premio: null });
  });

  it("valor fixo da entrada externa sempre vence sobre o prêmio do payload", () => {
    expect(resolveContentName("Material solicitado", "Bônus Secreto")).toBe("Material solicitado");
  });

  it("sem valor fixo, usa o prêmio do payload", () => {
    expect(resolveContentName(null, "Bônus Secreto")).toBe("Bônus Secreto");
  });

  it("sem valor fixo e sem prêmio, content_name fica null", () => {
    expect(resolveContentName(null, null)).toBeNull();
  });

  it("monta o EventContext esperado (nome->customerName, telefone normalizado->customerPhone, content_name->productName)", () => {
    const context = buildLeadContext("Bruno Fernandes", "5519999999999", "Conteúdo solicitado");
    expect(context).toEqual({
      customerName: "Bruno Fernandes", productName: "Conteúdo solicitado", customerEmail: null,
      customerPhone: "5519999999999", amountCents: null, paymentUrl: null, accessUrl: null
    });
  });

  it("first_name é derivado de customerName pelo resolveVariable já existente (reaproveitado, não reimplementado)", () => {
    const context: EventContext = buildLeadContext("Bruno Fernandes", "5519999999999", null);
    const rendered = renderTemplateText("Olá {{first_name}}!", context);
    expect(rendered.text).toBe("Olá Bruno!");
    expect(rendered.missing).toEqual([]);
  });
});
