// ============================================================
// RECEPTOR DE LEADS — Roleta Achadinhos Ads
// Planilha NOVA e independente. Nao mexe em nada do Mapa.
// Cole este codigo inteiro no Apps Script da planilha nova.
// ============================================================

// CONFIGURAÇÃO (uma vez só, antes de testar):
// No editor: Configurações do projeto (ícone de engrenagem) > Propriedades do script >
// Adicionar propriedade do script.
// Nome: DISPARAI_SECRET   Valor: o secret mostrado uma única vez ao criar a entrada
// externa em /admin/whatsapp-oficial/entradas-externas (source key "achadinhos-ads-roleta").
var DISPARAI_LEADS_URL = "https://www.disparei.pro/api/webhooks/official/leads";

function doPost(e) {
  try {
    var dados = JSON.parse(e.postData.contents);

    var planilha = SpreadsheetApp.getActiveSpreadsheet();
    var aba = planilha.getSheetByName("Roleta") || planilha.insertSheet("Roleta");

    // Cria o cabecalho na primeira vez
    if (aba.getLastRow() === 0) {
      aba.appendRow([
        "Data/Hora","Nome","Telefone","Premio","Origem",
        "utm_source","utm_medium","utm_campaign","utm_content","utm_term","fbclid"
      ]);
      aba.getRange("A1:K1").setFontWeight("bold");
      aba.setFrozenRows(1);
    }

    aba.appendRow([
      new Date(),
      dados.nome || "",
      "'" + (dados.telefone || ""),   // apostrofo evita o Sheets converter em numero
      dados.premio || "",
      dados.origem || "",
      dados.utm_source || "",
      dados.utm_medium || "",
      dados.utm_campaign || "",
      dados.utm_content || "",
      dados.utm_term || "",
      dados.fbclid || ""
    ]);

    // Planilha já salva — agora, e só agora, notifica a Disparei pra disparar o WhatsApp.
    // Nunca lança erro: se a Disparei estiver fora do ar, o lead já está salvo de qualquer forma.
    notifyDisparei_(dados);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (erro) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, erro: String(erro) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Serve so pra testar: abra a URL /exec no navegador.
// Se aparecer a mensagem abaixo, a implantacao esta no ar.
function doGet() {
  return ContentService.createTextOutput("Webhook da Roleta ativo.");
}

/**
 * Chama a Disparei pra iniciar o fluxo de WhatsApp do lead. Nunca lança erro pro chamador —
 * pior caso é só ficar registrado no log de execução (Ver > Execuções no editor).
 * @param {Object} lead { nome, telefone, origem, premio, utm_source, utm_medium,
 *                         utm_campaign, utm_content, utm_term, fbclid }
 */
function notifyDisparei_(lead) {
  var secret = PropertiesService.getScriptProperties().getProperty("DISPARAI_SECRET");
  if (!secret) {
    console.error("DISPARAI_SECRET não configurado nas Propriedades do script — pulando notificação.");
    return;
  }

  var idempotencyKey = Utilities.getUuid();

  var payload = {
    nome: lead.nome,
    telefone: lead.telefone,
    origem: lead.origem,
    premio: lead.premio,
    utm_source: lead.utm_source,
    utm_medium: lead.utm_medium,
    utm_campaign: lead.utm_campaign,
    utm_content: lead.utm_content,
    utm_term: lead.utm_term,
    fbclid: lead.fbclid
  };

  var options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "X-Disparei-Secret": secret,
      "X-Disparei-Idempotency-Key": idempotencyKey
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true // essencial: sem isso, um erro HTTP (4xx/5xx) lançaria
                              // exceção e cairia no catch do doPost, mascarando o "ok:true"
                              // que a planilha já mereceria receber.
  };

  try {
    var response = UrlFetchApp.fetch(DISPARAI_LEADS_URL, options);
    var status = response.getResponseCode();
    var body = response.getContentText();
    console.log("Disparei /leads -> HTTP " + status + " -- " + body);

    if (status !== 200) {
      console.error("Disparei recusou o lead (" + lead.origem + "): HTTP " + status + " -- " + body);
    }
  } catch (error) {
    console.error("Falha ao chamar a Disparei (" + lead.origem + "): " + error);
  }
}

// ------------------------------------------------------------------------------------
// SÓ PRA TESTE MANUAL: roda notifyDisparei_ direto no editor, sem precisar do formulário
// do site. Selecione "testarNotifyDisparei" no menu ao lado do botão Executar e rode.
// Depois olhe em Execuções (ícone de relógio na lateral) o que foi logado.
// ------------------------------------------------------------------------------------
function testarNotifyDisparei() {
  notifyDisparei_({
    nome: "Teste Manual",
    telefone: "5519999999999", // troque pelo seu número de verdade se quiser receber o WhatsApp
    origem: "achadinhos-ads-roleta",
    premio: "Bônus Secreto"
  });
}
