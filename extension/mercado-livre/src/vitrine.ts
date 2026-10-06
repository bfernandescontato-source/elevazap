// Content script das lojas: botões nos cards, card na página de produto e o
// painel do carrinho. Fica inerte até o service worker confirmar que a conta
// conectada tem a Vitrine liberada.
import { VITRINE_ALTERNAR_PAINEL, VITRINE_CAPTURAR, VITRINE_CUPONS, VITRINE_ENVIAR, VITRINE_STATUS, type ModoDeEnvio, type VitrineStatus } from "./shared.js";
import { adicionar, aoMudar, chaveDo, lerCarrinho, limpar, remover } from "./vitrine/carrinho.js";
import { detectarLoja, ehPaginaDeProduto, lojaMagazineVoce, type LeitorDeLoja, type Loja, type Produto } from "./vitrine/lojas.js";
import { leitorAmazon } from "./vitrine/loja-amazon.js";
import { leitorMagalu } from "./vitrine/loja-magalu.js";
import { leitorML } from "./vitrine/loja-ml.js";
import { leitorShopee } from "./vitrine/loja-shopee.js";

const LEITORES: Record<Loja, LeitorDeLoja> = { ML: leitorML, Amazon: leitorAmazon, Shopee: leitorShopee, Magalu: leitorMagalu };
const NOME_DA_LOJA: Record<Loja, string> = { ML: "Mercado Livre", Amazon: "Amazon", Shopee: "Shopee", Magalu: "Magalu" };
const COR_DA_LOJA: Record<Loja, string> = { ML: "#c9a800", Amazon: "#e47911", Shopee: "#ee4d2d", Magalu: "#0086ff" };

const escapar = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!);

const ESTILO_DA_PAGINA = `
.dsp-card-btns{position:absolute;top:6px;right:6px;z-index:30;display:flex;gap:4px;font:600 12px/1 system-ui,sans-serif}
.dsp-card-btns button{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:4px;padding:6px 8px;border-radius:999px;background:#0f766e;color:#fff;box-shadow:0 2px 6px rgba(0,0,0,.25)}
.dsp-card-btns button:hover{background:#115e59}
.dsp-card-btns button.dsp-no-carrinho{background:#fff;color:#0f766e;outline:1.5px solid #0f766e}
.dsp-card-btns button.dsp-raio{background:#f97362}
`;

const ESTILO_DO_PAINEL = `
:host{all:initial}
*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
button{font:inherit;cursor:pointer}
.fab{position:fixed;right:18px;bottom:18px;z-index:2147483646;display:flex;align-items:center;gap:8px;border:0;border-radius:999px;background:#0f766e;color:#fff;padding:12px 16px;font-weight:700;font-size:14px;box-shadow:0 6px 18px rgba(0,0,0,.25)}
.fab b{background:#fff;color:#0f766e;border-radius:999px;min-width:22px;padding:2px 6px;font-size:12px;text-align:center}
.pdp{position:fixed;right:18px;bottom:76px;z-index:2147483646;width:300px;background:#fff;color:#18181b;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.22);overflow:hidden;font-size:13px}
.pdp header{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#0f766e;color:#fff;font-weight:700}
.pdp header button{border:0;background:transparent;color:#fff;font-size:18px;line-height:1}
.pdp .info{display:flex;gap:10px;padding:10px 12px}
.pdp img{width:56px;height:56px;object-fit:contain;border-radius:8px;background:#f4f4f5}
.pdp .titulo{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-weight:600}
.pdp .preco{margin-top:4px;font-weight:800;color:#0f766e}
.acoes{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;padding:0 12px 12px}
.acoes button{border:0;border-radius:8px;padding:9px 6px;font-weight:700;font-size:12px;background:#e6f4f1;color:#0f766e}
.acoes button.forte{background:#0f766e;color:#fff}
.acoes button.raio{background:#f97362;color:#fff}
.painel{position:fixed;top:0;right:0;z-index:2147483647;width:380px;max-width:100vw;height:100vh;background:#fff;color:#18181b;box-shadow:-8px 0 30px rgba(0,0,0,.2);display:flex;flex-direction:column;font-size:13px}
.painel header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #e4e4e7}
.painel header strong{font-size:15px}
.painel header small{display:block;color:#71717a;font-weight:500;margin-top:2px}
.painel header button{border:0;background:#f4f4f5;border-radius:999px;width:32px;height:32px;font-size:18px}
.aviso{margin:10px 16px 0;padding:10px 12px;border-radius:10px;background:#fff7ed;color:#9a3412;font-size:12px;line-height:1.4}
.ok{background:#ecfdf5;color:#065f46}
.captura{margin:12px 16px 0;display:flex;gap:8px}
.captura button{flex:1;border:1px dashed #0f766e;background:#f0fdfa;color:#0f766e;border-radius:10px;padding:10px;font-weight:700}
.lista{flex:1;overflow-y:auto;padding:8px 16px}
.vazio{color:#71717a;text-align:center;margin-top:40px;line-height:1.5}
.item{display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #f4f4f5;position:relative}
.item img{width:58px;height:58px;object-fit:contain;border-radius:8px;background:#f4f4f5;flex:none}
.item .corpo{min-width:0;flex:1}
.item .loja{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.03em}
.item .titulo{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-weight:600;margin:2px 0}
.item .preco{font-weight:800}
.item .antigo{color:#a1a1aa;text-decoration:line-through;font-size:11px;margin-left:6px;font-weight:500}
.selos{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.selo{font-size:10px;font-weight:700;border-radius:6px;padding:2px 6px;background:#f4f4f5;color:#3f3f46}
.selo.d{background:#dcfce7;color:#166534}.selo.c{background:#fef3c7;color:#92400e}
.item .tirar{position:absolute;top:8px;right:0;border:0;background:transparent;color:#a1a1aa;font-size:18px}
footer{border-top:1px solid #e4e4e7;padding:12px 16px;display:grid;gap:8px}
footer .linha{display:flex;gap:8px}
footer .linha button{flex:1;border:1px solid #e4e4e7;background:#fff;border-radius:10px;padding:9px;font-weight:600}
footer .principal{border:0;border-radius:10px;padding:12px;font-weight:800;font-size:14px;background:#0f766e;color:#fff}
footer .raio{border:0;border-radius:10px;padding:12px;font-weight:800;font-size:14px;background:#f97362;color:#fff}
footer button:disabled{opacity:.45;cursor:not-allowed}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;background:#18181b;color:#fff;padding:10px 16px;border-radius:999px;font-size:13px;font-weight:600;box-shadow:0 6px 18px rgba(0,0,0,.3)}
`;

const loja = detectarLoja();

async function iniciar(status: VitrineStatus) {
  if (!loja) return;
  const leitor = LEITORES[loja];
  let carrinho = await lerCarrinho();
  let painelAberto = false; let pdpMinimizado = false; let produtoAtual: Produto | null = null; let capturando = false;

  const estiloDaPagina = document.createElement("style");
  estiloDaPagina.textContent = ESTILO_DA_PAGINA;
  document.documentElement.appendChild(estiloDaPagina);

  const host = document.createElement("div");
  host.id = "disparei-vitrine";
  const raiz = host.attachShadow({ mode: "open" });
  document.documentElement.appendChild(host);

  const noCarrinho = () => new Set(carrinho.map(chaveDo));

  function avisar(texto: string) {
    raiz.querySelector(".toast")?.remove();
    const toast = document.createElement("div");
    toast.className = "toast"; toast.textContent = texto;
    raiz.appendChild(toast);
    setTimeout(() => toast.remove(), 2600);
  }

  /** Magalu só tem link de afiliado na loja Magazine Você do próprio afiliado. */
  function avisoDaLoja() {
    if (!status.conectada) return "<div class=\"aviso\">Conecte a extensão à Disparei (Integrações › Mercado Livre) para enviar os produtos.</div>";
    if (loja === "Magalu" && !lojaMagazineVoce()) return "<div class=\"aviso\">Para enviar produtos da Magalu, navegue pela sua loja Magazine Você (magazinevoce.com.br/sua-loja). O link de lá já é o seu link de afiliado.</div>";
    return "";
  }

  async function enviar(modo: ModoDeEnvio, itens: Produto[]) {
    if (!itens.length) return;
    if (!status.conectada) { avisar("Conecte a extensão à Disparei primeiro."); return; }
    const resposta = await chrome.runtime.sendMessage({ type: VITRINE_ENVIAR, modo, itens }).catch(() => null);
    if (!resposta?.ok) avisar(resposta?.error || "Não foi possível abrir a Disparei.");
  }

  async function copiarLinks() {
    const links = carrinho.map(produto => produto.originalUrl).filter(Boolean).join("\n");
    try { await navigator.clipboard.writeText(links); avisar(`${carrinho.length} link(s) copiado(s).`); }
    catch { avisar("O navegador não deixou copiar."); }
  }

  async function capturarPagina() {
    if (capturando || !leitor.todosDaPagina) return;
    capturando = true; desenhar();
    try {
      const produtos = await leitor.todosDaPagina();
      const { adicionados, cheio } = await adicionar(produtos);
      avisar(cheio ? `Carrinho cheio. Entraram ${adicionados}.` : adicionados ? `${adicionados} produto(s) no carrinho.` : produtos.length ? "Todos já estavam no carrinho." : "Nenhum produto encontrado nesta página.");
    } finally { capturando = false; desenhar(); }
  }

  function itemHtml(produto: Produto) {
    const chave = escapar(chaveDo(produto));
    return `<div class="item"><img src="${escapar(produto.imageUrl)}" alt="" loading="lazy">
      <div class="corpo"><div class="loja" style="color:${COR_DA_LOJA[produto.platform]}">${escapar(NOME_DA_LOJA[produto.platform])}</div>
      <div class="titulo">${escapar(produto.title)}</div>
      <div><span class="preco">${escapar(produto.price || "—")}</span>${produto.oldPrice ? `<span class="antigo">${escapar(produto.oldPrice)}</span>` : ""}</div>
      <div class="selos">${produto.discount ? `<span class="selo d">-${escapar(produto.discount)}</span>` : ""}${produto.coupon ? `<span class="selo c">Cupom ${escapar(produto.coupon)}</span>` : ""}${produto.installment ? `<span class="selo">${escapar(produto.installment.slice(0, 35))}</span>` : ""}${produto.freteGratis ? "<span class=\"selo\">Frete grátis</span>" : ""}${produto.mercadoFull ? "<span class=\"selo\">FULL</span>" : ""}</div></div>
      <button class="tirar" data-tirar="${chave}" title="Tirar do carrinho">×</button></div>`;
  }

  function desenhar() {
    const total = carrinho.length;
    const naListagem = !ehPaginaDeProduto();
    const pdp = produtoAtual && !painelAberto && !pdpMinimizado
      ? `<div class="pdp"><header><span>Disparei</span><button data-acao="minimizar" title="Minimizar">−</button></header>
          <div class="info">${produtoAtual.imageUrl ? `<img src="${escapar(produtoAtual.imageUrl)}" alt="">` : ""}<div><div class="titulo">${escapar(produtoAtual.title)}</div><div class="preco">${escapar(produtoAtual.price)}</div></div></div>
          <div class="acoes"><button class="forte" data-acao="pdp-carrinho">${noCarrinho().has(chaveDo(produtoAtual)) ? "✓ No carrinho" : "+ Carrinho"}</button><button class="raio" data-acao="pdp-agora">⚡ Disparar</button><button data-acao="pdp-lote">Enviar ao lote</button></div></div>`
      : "";
    const painel = painelAberto
      ? `<aside class="painel"><header><div><strong>Carrinho Disparei</strong><small>${escapar(NOME_DA_LOJA[loja!])} · ${total} produto(s)</small></div><button data-acao="fechar" title="Fechar">×</button></header>
          ${avisoDaLoja()}
          ${naListagem && leitor.todosDaPagina ? `<div class="captura"><button data-acao="capturar" ${capturando ? "disabled" : ""}>${capturando ? "Capturando…" : "Capturar produtos desta página"}</button></div>` : ""}
          <div class="lista">${total ? carrinho.map(itemHtml).join("") : "<p class=\"vazio\">Seu carrinho está vazio.<br>Use os botões nos produtos para adicionar.</p>"}</div>
          <footer><div class="linha"><button data-acao="copiar" ${total ? "" : "disabled"}>Copiar links</button><button data-acao="limpar" ${total ? "" : "disabled"}>Limpar</button></div>
          <button class="principal" data-acao="lote" ${total ? "" : "disabled"}>Enviar ao lote (${total})</button>
          <button class="raio" data-acao="agora" ${total ? "" : "disabled"}>⚡ Disparar agora (${total})</button></footer></aside>`
      : "";
    raiz.innerHTML = `<style>${ESTILO_DO_PAINEL}</style>${pdp}${painel}${painelAberto ? "" : `<button class="fab" data-acao="abrir">Disparei <b>${total}</b></button>`}`;
  }

  raiz.addEventListener("click", event => {
    const alvo = (event.target as HTMLElement).closest<HTMLElement>("[data-acao],[data-tirar]");
    if (!alvo) return;
    const tirar = alvo.getAttribute("data-tirar");
    if (tirar) { void remover(tirar); return; }
    const acao = alvo.getAttribute("data-acao");
    if (acao === "abrir") { painelAberto = true; desenhar(); }
    else if (acao === "fechar") { painelAberto = false; desenhar(); }
    else if (acao === "minimizar") { pdpMinimizado = true; desenhar(); }
    else if (acao === "capturar") void capturarPagina();
    else if (acao === "copiar") void copiarLinks();
    else if (acao === "limpar") { if (confirm("Tirar todos os produtos do carrinho?")) void limpar(); }
    else if (acao === "lote") void enviar("lote", carrinho);
    else if (acao === "agora") void enviar("agora", carrinho);
    else if (produtoAtual && acao === "pdp-carrinho") {
      const chave = chaveDo(produtoAtual);
      if (noCarrinho().has(chave)) void remover(chave); else void adicionar([produtoAtual]).then(() => avisar("Adicionado ao carrinho."));
    }
    else if (produtoAtual && acao === "pdp-agora") void enviar("agora", [produtoAtual]);
    else if (produtoAtual && acao === "pdp-lote") void enviar("lote", [produtoAtual]);
  });

  // Botões nos cards da listagem.
  function botoesDoCard(card: Element, produto: Produto, releitura: () => Produto | null) {
    const caixa = document.createElement("div");
    caixa.className = "dsp-card-btns";
    caixa.dataset.chave = chaveDo(produto);
    const adicionarBtn = document.createElement("button");
    const raio = document.createElement("button");
    raio.className = "dsp-raio"; raio.textContent = "⚡"; raio.title = "Disparar agora";
    const atualizar = () => {
      const dentro = noCarrinho().has(chaveDo(produto));
      adicionarBtn.className = dentro ? "dsp-no-carrinho" : "";
      adicionarBtn.textContent = dentro ? "✓ No carrinho" : "+ Carrinho";
    };
    atualizar();
    adicionarBtn.addEventListener("click", event => {
      event.preventDefault(); event.stopPropagation();
      // Lê o card de novo na hora do clique: preço e foto podem ter carregado depois.
      const fresco = releitura() || produto;
      if (noCarrinho().has(chaveDo(fresco))) void remover(chaveDo(fresco)); else void adicionar([fresco]);
    });
    raio.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); void enviar("agora", [releitura() || produto]); });
    caixa.append(adicionarBtn, raio);
    (caixa as any).__atualizar = atualizar;
    if (getComputedStyle(card).position === "static") (card as HTMLElement).style.position = "relative";
    card.appendChild(caixa);
  }

  function atualizarBotoes() {
    document.querySelectorAll<HTMLElement>(".dsp-card-btns").forEach(caixa => (caixa as any).__atualizar?.());
  }

  function injetarNosCards() {
    if (ehPaginaDeProduto()) return;
    for (const card of leitor.cards()) {
      if (card.querySelector(":scope > .dsp-card-btns")) continue;
      const produto = leitor.doCard(card);
      if (produto) botoesDoCard(card, produto, () => leitor.doCard(card));
    }
  }

  function lerPaginaDeProduto() {
    const anterior = produtoAtual ? chaveDo(produtoAtual) : null;
    produtoAtual = leitor.daPagina();
    const atual = produtoAtual ? chaveDo(produtoAtual) : null;
    if (atual !== anterior) { pdpMinimizado = false; desenhar(); }
  }

  function varrer() { lerPaginaDeProduto(); injetarNosCards(); }

  aoMudar(itens => { carrinho = itens; desenhar(); atualizarBotoes(); });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== VITRINE_ALTERNAR_PAINEL) return false;
    painelAberto = !painelAberto; desenhar(); sendResponse({ ok: true });
    return false;
  });

  desenhar();
  varrer();
  // As lojas são SPA e carregam cards ao rolar: varre de novo quando a página muda.
  let ultimaVarredura = 0; let agendada: ReturnType<typeof setTimeout> | undefined;
  new MutationObserver(mutations => {
    if (mutations.every(mutation => host.contains(mutation.target) || (mutation.target as Element).closest?.(".dsp-card-btns"))) return;
    clearTimeout(agendada);
    agendada = setTimeout(() => { ultimaVarredura = Date.now(); varrer(); }, Math.max(400, 2000 - (Date.now() - ultimaVarredura)));
  }).observe(document.body, { childList: true, subtree: true });
  let ultimaUrl = location.href;
  setInterval(() => { if (location.href !== ultimaUrl) { ultimaUrl = location.href; produtoAtual = null; setTimeout(varrer, 900); } }, 1000);
}

// Cupons Shopee: o gancho no mundo da página (shopee-cupom-hook) captura a resposta
// de get_vouchers_by_collections e posta aqui. Guardamos até o service worker pedir.
const cuponsCapturados: any[] = [];
window.addEventListener("message", event => {
  if (event.source === window && event.origin === location.origin && event.data?.__dspCupons) cuponsCapturados.push(event.data.data);
});

// Coleta diária: o service worker abre a página de ofertas e pede os produtos.
// Responde mesmo sem o painel montado (independe da conta estar liberada aqui;
// a liberação é conferida no service worker antes de abrir a aba).
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === VITRINE_CUPONS) { sendResponse({ ok: true, cupons: cuponsCapturados.splice(0) }); return false; }
  if (message?.type !== VITRINE_CAPTURAR) return false;
  const leitor = loja ? LEITORES[loja] : null;
  if (!leitor?.todosDaPagina) { sendResponse({ ok: false, produtos: [] }); return false; }
  void leitor.todosDaPagina().then(produtos => sendResponse({ ok: true, produtos })).catch(() => sendResponse({ ok: false, produtos: [] }));
  return true;
});

// Só na janela principal: iframes de anúncio não ganham painel.
if (loja && window.top === window) {
  chrome.runtime.sendMessage({ type: VITRINE_STATUS }).then((status: VitrineStatus | undefined) => {
    if (status?.liberada) void iniciar(status);
  }).catch(() => undefined);
}
