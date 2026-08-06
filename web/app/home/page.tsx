"use client";

import Script from "next/script";
import { useState } from "react";

type MockPanel = "inicio" | "numeros" | "campanhas" | "modelos" | "disparos";

const css = `
  * { margin:0; padding:0; box-sizing:border-box; }
  :root{
    --black:#0a0a0a;
    --gray-900:#111111;
    --gray-700:#3a3a3a;
    --gray-500:#6b6b6b;
    --gray-300:#d4d4d4;
    --gray-100:#f5f5f5;
    --white:#ffffff;
  }
  body{
    font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif;
    background:var(--white); color:var(--black); line-height:1.5; -webkit-font-smoothing:antialiased;
  }
  a{ text-decoration:none; color:inherit; }
  .wrap{ max-width:1120px; margin:0 auto; padding:0 32px; }

  nav{
    display:flex; align-items:center; justify-content:space-between;
    padding:24px 32px; border-bottom:1px solid var(--gray-100);
  }
  .logo-img{ height:26px; width:auto; display:block; }
  .navlinks{ display:flex; gap:34px; font-size:14.5px; color:var(--gray-700); font-weight:500; }
  .navlinks a:hover{ color:var(--black); }
  .navright{ display:flex; align-items:center; gap:12px; }
  .navlogin{ font-size:14px; font-weight:600; color:var(--gray-700); padding:10px 16px; }
  .navlogin:hover{ color:var(--black); }
  nav .cta{
    background:var(--black); color:var(--white); padding:11px 22px;
    border-radius:8px; font-weight:600; font-size:14px; transition:opacity .2s;
  }
  nav .cta:hover{ opacity:.85; }

  .hero{ padding:96px 32px 60px; text-align:center; }
  .badge{
    display:inline-flex; align-items:center; gap:8px; border:1px solid var(--gray-300); border-radius:999px;
    padding:7px 18px; font-size:12.5px; letter-spacing:1px; color:var(--gray-700);
    margin-bottom:30px; font-weight:700; text-transform:uppercase;
  }
  .dot{ width:6px; height:6px; border-radius:50%; background:#22c55e; display:inline-block; }
  h1{
    font-size:58px; font-weight:800; letter-spacing:-2px; line-height:1.05;
    margin-bottom:22px; max-width:780px; margin-left:auto; margin-right:auto;
  }
  .hero p.sub{ font-size:18px; color:var(--gray-500); max-width:560px; margin:0 auto 36px; }
  h1 .strike{ color:var(--gray-500); text-decoration:line-through; text-decoration-color:#e11d48; text-decoration-thickness:3px; }
  .hero-ctas{ display:flex; gap:14px; justify-content:center; flex-wrap:wrap; margin-bottom:20px; }
  .micro{ font-size:13px; color:var(--gray-500); }
  .mock-wrap{ padding:0 32px 100px; }
  .mock{
    max-width:1000px; margin:0 auto; border:1px solid var(--gray-100); border-radius:20px; overflow:hidden;
    box-shadow:0 30px 80px -30px rgba(0,0,0,0.15);
  }
  .mock-bar{ background:var(--gray-100); padding:14px 20px; display:flex; gap:8px; }
  .mock-bar span{ width:11px; height:11px; border-radius:50%; background:var(--gray-300); }
  .mock-body{ display:flex; min-height:380px; }
  .mock-side{ width:210px; background:var(--white); border-right:1px solid var(--gray-100); padding:24px 18px; font-size:14px; color:var(--gray-700); }
  .mock-side .item{ padding:10px 12px; border-radius:8px; margin-bottom:4px; cursor:pointer; transition:background .15s; border:none; background:none; font-family:inherit; font-size:14px; color:var(--gray-700); text-align:left; width:100%; display:block; }
  .mock-side .item:hover{ background:var(--gray-100); }
  .mock-side .item.active{ background:var(--black); color:var(--white); font-weight:600; }
  .mock-side .item.active:hover{ background:var(--black); }
  .mock-main{ flex:1; padding:36px; text-align:left; }
  .mock-main h3{ font-size:22px; font-weight:700; margin-bottom:6px; }
  .mock-main p.desc{ color:var(--gray-500); font-size:14px; margin-bottom:24px; }
  .mock-card{ border:1px solid var(--gray-100); border-radius:14px; padding:22px; width:260px; }
  .mock-card .folder{ font-size:24px; margin-bottom:14px; }
  .mock-card h4{ font-size:16px; font-weight:700; margin-bottom:6px; }
  .mock-card p{ font-size:13px; margin:0; color:var(--gray-500); }
  .mock-panel{ display:none; }
  .mock-panel.active{ display:block; }

  .mock-badge-green{
    display:flex; align-items:center; gap:8px; font-size:13.5px; color:#16a34a; font-weight:600;
    border-left:3px solid #16a34a; padding:8px 0 8px 12px; margin-bottom:22px;
  }
  .mock-stats3{ display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-bottom:16px; }
  .mock-stat{ border:1px solid var(--gray-100); border-radius:12px; padding:16px; }
  .mock-stat .lab{ font-size:12px; color:var(--gray-500); margin-bottom:6px; }
  .mock-stat .val{ font-size:22px; font-weight:800; }
  .mock-queue{ border:1px solid var(--gray-100); border-radius:12px; padding:18px; }
  .mock-queue .top{ display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; }
  .mock-queue .top h5{ font-size:14px; font-weight:700; }
  .mock-queue .top span{ font-size:11px; color:#b45309; background:#fef3c7; padding:3px 10px; border-radius:999px; font-weight:600; }
  .mock-queue .row5{ display:grid; grid-template-columns:repeat(5,1fr); gap:10px; }
  .mock-queue .row5 div{ font-size:11.5px; color:var(--gray-500); }
  .mock-queue .row5 strong{ display:block; font-size:16px; color:var(--black); font-weight:800; margin-top:2px; }

  .mock-numbox{ display:flex; gap:10px; margin-bottom:18px; }
  .mock-input-fake{ flex:1; border:1px solid var(--gray-300); border-radius:8px; padding:11px 14px; font-size:12.5px; color:var(--gray-500); }
  .mock-btn-fake{ background:var(--black); color:var(--white); border-radius:8px; padding:11px 16px; font-size:12.5px; font-weight:700; white-space:nowrap; }
  .mock-numcard{ border:1px solid var(--gray-100); border-radius:12px; padding:20px; }
  .mock-numcard .head{ display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; }
  .mock-numcard .head h5{ font-size:15px; font-weight:700; }
  .mock-numcard .head .status{ font-size:10.5px; color:#16a34a; background:#dcfce7; padding:3px 10px; border-radius:999px; font-weight:700; }
  .mock-numcard .phone{ font-size:13px; color:var(--gray-500); margin-bottom:14px; }
  .mock-numcard .kv{ display:flex; justify-content:space-between; font-size:12px; color:var(--gray-500); padding:6px 0; border-top:1px solid var(--gray-100); }
  .mock-numcard .actions{ display:flex; gap:8px; margin-top:14px; }
  .mock-numcard .actions span{ border:1px solid var(--gray-300); border-radius:7px; padding:7px 12px; font-size:11px; font-weight:600; }

  .mock-campcard{ border:1px solid var(--gray-100); border-radius:12px; padding:18px 20px; display:flex; justify-content:space-between; align-items:center; }
  .mock-campcard h5{ font-size:15px; font-weight:700; margin-bottom:3px; }
  .mock-campcard span.sub{ font-size:12px; color:var(--gray-500); }
  .mock-campcard .arrow{ color:var(--gray-300); font-size:16px; }

  .mock-tabs2{ display:flex; gap:10px; margin-bottom:18px; }
  .mock-tabs2 span{ font-size:12px; font-weight:700; padding:9px 16px; border-radius:8px; }
  .mock-tabs2 span.on{ background:var(--black); color:var(--white); }
  .mock-tabs2 span.off{ border:1px solid var(--gray-300); color:var(--gray-500); }
  .mock-step{ border:1px solid var(--gray-100); border-radius:12px; padding:16px 18px; margin-bottom:10px; }
  .mock-step h6{ font-size:12.5px; font-weight:700; margin-bottom:8px; }
  .mock-select-fake{ border:1px solid var(--gray-300); border-radius:7px; padding:9px 12px; font-size:12px; color:var(--gray-500); }
  .btn-primary{
    background:var(--black); color:var(--white); padding:16px 30px; border-radius:10px;
    font-weight:700; font-size:15.5px; display:inline-flex; align-items:center; gap:8px;
    transition:transform .15s, opacity .15s;
  }
  .btn-primary:hover{ transform:translateY(-2px); opacity:.9; }
  .btn-secondary{
    border:1px solid var(--gray-300); padding:16px 30px; border-radius:10px; font-weight:600;
    font-size:15.5px; color:var(--black); display:inline-flex; align-items:center; gap:8px; transition:background .15s;
  }
  .btn-secondary:hover{ background:var(--gray-100); }

  .phones-section{ padding:70px 32px 110px; position:relative; overflow:hidden; }
  .phones-wrap{ max-width:640px; margin:0 auto; position:relative; display:flex; justify-content:center; }
  .phone{
    width:260px; border:8px solid var(--black); border-radius:40px; background:var(--white);
    padding:18px 14px; position:relative; box-shadow:0 40px 80px -30px rgba(0,0,0,0.25);
  }
  .phone.back{ transform:rotate(-8deg) translateX(-40px); opacity:.5; z-index:1; }
  .phone.front{ transform:rotate(6deg) translateX(40px); z-index:2; }
  .phone-time{ text-align:center; font-size:28px; font-weight:700; margin-bottom:2px; }
  .phone-date{ text-align:center; font-size:12px; color:var(--gray-500); margin-bottom:16px; }
  .notif{
    background:var(--gray-100); border-radius:12px; padding:10px 12px; display:flex; gap:10px;
    align-items:center; margin-bottom:8px;
  }
  .notif .ic{
    width:26px; height:26px; border-radius:7px; background:var(--black); color:var(--white);
    display:flex; align-items:center; justify-content:center; font-size:12px; flex-shrink:0;
  }
  .notif .txt{ font-size:11.5px; font-weight:600; line-height:1.3; }
  .notif .txt span{ display:block; font-weight:400; color:var(--gray-500); font-size:10.5px; }

  .statbar{ border-top:1px solid var(--gray-100); border-bottom:1px solid var(--gray-100); padding:44px 32px; }
  .statbar .wrap{ display:flex; justify-content:space-between; flex-wrap:wrap; gap:30px; }
  .stat{ text-align:center; flex:1; min-width:140px; }
  .stat .num{ font-size:34px; font-weight:800; letter-spacing:-1px; }
  .stat .lab{ font-size:13.5px; color:var(--gray-500); margin-top:4px; }

  section{ padding:100px 0; }
  section.gray{ background:var(--gray-100); }
  .section-head{ text-align:center; max-width:640px; margin:0 auto 56px; }
  .eyebrow{
    display:inline-block; font-size:12px; font-weight:700; letter-spacing:1.5px; text-transform:uppercase;
    color:var(--gray-500); border:1px solid var(--gray-300); padding:5px 14px; border-radius:999px; margin-bottom:18px;
  }
  .section-head h2{ font-size:38px; font-weight:800; letter-spacing:-1px; margin-bottom:14px; }
  .section-head p{ color:var(--gray-500); font-size:17px; }

  .benefits-grid{ display:grid; grid-template-columns:repeat(2,1fr); gap:20px; }
  .b-card{ border:1px solid var(--gray-300); border-radius:16px; padding:28px; background:var(--white); }
  .b-card .ic{
    width:38px; height:38px; border-radius:9px; background:var(--black); color:var(--white);
    display:flex; align-items:center; justify-content:center; font-size:17px; margin-bottom:16px;
  }
  .b-card h4{ font-size:16.5px; font-weight:700; margin-bottom:8px; }
  .b-card ul{ list-style:none; }
  .b-card ul li{ font-size:13.5px; color:var(--gray-500); margin-bottom:4px; padding-left:14px; position:relative; }
  .b-card ul li:before{ content:"→"; position:absolute; left:0; color:var(--gray-300); }
  .b-visual{
    grid-row:span 2; border:1px solid var(--gray-300); border-radius:16px; background:var(--black);
    padding:32px; display:flex; flex-direction:column; justify-content:flex-end; color:var(--white); min-height:100%;
  }
  .b-visual .mini-mock{ background:#1a1a1a; border-radius:12px; padding:18px; margin-bottom:20px; }
  .b-visual .mini-mock .row{
    display:flex; justify-content:space-between; align-items:center; padding:9px 0; border-bottom:1px solid #2a2a2a;
    font-size:12.5px;
  }
  .b-visual .mini-mock .row:last-child{ border-bottom:none; }
  .b-visual h4{ font-size:16px; font-weight:700; }

  .guarantee-top{ display:grid; grid-template-columns:1.3fr 1fr; gap:20px; margin-bottom:20px; }
  .guarantee-hero{
    border:1px solid var(--gray-300); border-radius:16px; padding:32px; background:var(--white);
  }
  .guarantee-hero h4{ font-size:18px; font-weight:700; margin-bottom:12px; }
  .guarantee-hero .pricerow{ display:flex; justify-content:space-between; font-size:14.5px; padding:9px 0; border-bottom:1px solid var(--gray-100); }
  .guarantee-hero .pricerow:last-child{ border:none; }
  .guarantee-side{
    border:1px solid var(--gray-300); border-radius:16px; padding:28px; background:var(--gray-100);
    display:flex; flex-direction:column; justify-content:center;
  }
  .guarantee-side .tag{
    display:inline-block; background:var(--black); color:var(--white); font-size:11.5px; font-weight:700;
    padding:5px 12px; border-radius:999px; margin-bottom:14px; width:fit-content;
  }
  .guarantee-side p{ font-size:15px; font-weight:600; }
  .guarantee-bottom{ display:grid; grid-template-columns:1fr; gap:20px; }
  .guarantee-bottom .card{
    border:1px solid var(--gray-300); border-radius:16px; padding:26px; background:var(--white);
  }
  .guarantee-bottom .tag{
    display:inline-block; background:var(--black); color:var(--white); font-size:11.5px; font-weight:700;
    padding:5px 12px; border-radius:999px; margin-bottom:12px;
  }
  .guarantee-bottom p{ font-size:14.5px; color:var(--gray-700); }

  .steps{ display:grid; grid-template-columns:repeat(3,1fr); gap:24px; }
  .step{ border:1px solid var(--gray-100); border-radius:16px; padding:32px; }
  .step .num{ font-size:46px; font-weight:800; color:var(--gray-300); letter-spacing:-2px; margin-bottom:14px; }
  .step h3{ font-size:18.5px; font-weight:700; margin-bottom:8px; }
  .step p{ color:var(--gray-500); font-size:14.5px; }

  .price-card{
    border:1px solid var(--gray-300); border-radius:20px; padding:40px 32px; text-align:center; position:relative;
  }
  .price-card.featured{ border:2px solid var(--black); }
  .pricing-grid{ display:grid; grid-template-columns:repeat(3,1fr); gap:24px; align-items:start; max-width:1080px; margin:0 auto; }
  .featured-badge{
    position:absolute; top:-14px; left:50%; transform:translateX(-50%);
    background:var(--black); color:var(--white); font-size:12px; font-weight:700;
    padding:6px 16px; border-radius:999px; white-space:nowrap;
  }
  .price-card .tag{
    display:inline-block; background:var(--black); color:var(--white); font-size:12px; font-weight:700;
    padding:5px 14px; border-radius:999px; margin-bottom:20px; letter-spacing:0.5px;
  }
  .price{ font-size:44px; font-weight:800; letter-spacing:-2px; margin-bottom:4px; }
  .price span{ font-size:16px; color:var(--gray-500); font-weight:500; }
  .price-sub{ color:var(--gray-500); font-size:13px; margin-bottom:28px; }
  .price-list{ text-align:left; display:flex; flex-direction:column; gap:12px; margin-bottom:30px; }
  .price-list .row{ display:flex; gap:10px; align-items:flex-start; font-size:13.5px; }
  .price-list .check{
    width:20px; height:20px; border-radius:50%; background:var(--black); color:var(--white);
    display:flex; align-items:center; justify-content:center; font-size:11px; flex-shrink:0; margin-top:2px;
  }
  .btn-full{ width:100%; text-align:center; padding:18px; justify-content:center; }

  .faq-item{ border:1px solid var(--gray-300); border-radius:12px; margin-bottom:12px; overflow:hidden; }
  .faq-item summary{
    padding:20px 22px; font-size:15.5px; font-weight:700; cursor:pointer; list-style:none;
    display:flex; justify-content:space-between; align-items:center;
  }
  .faq-item summary::-webkit-details-marker{ display:none; }
  .faq-item summary:after{ content:"+"; font-size:20px; color:var(--gray-500); font-weight:400; }
  .faq-item[open] summary:after{ content:"–"; }
  .faq-item .a{ padding:0 22px 20px; color:var(--gray-500); font-size:14.5px; }

  .final-cta{ text-align:center; padding:120px 32px; }
  .final-cta h2{ font-size:44px; font-weight:800; letter-spacing:-1.5px; margin-bottom:18px; }
  .final-cta p{ color:var(--gray-500); font-size:18px; margin-bottom:36px; }

  footer{ border-top:1px solid var(--gray-100); padding:50px 32px 30px; }
  .foot-grid{ display:flex; justify-content:space-between; flex-wrap:wrap; gap:30px; margin-bottom:30px; }
  .foot-logo{ font-size:19px; font-weight:800; }
  .foot-col h5{ font-size:13px; font-weight:700; margin-bottom:10px; }
  .foot-col p, .foot-col a{ font-size:13.5px; color:var(--gray-500); display:block; margin-bottom:6px; }
  .foot-social{ display:flex; gap:14px; margin-top:8px; }
  .foot-social a{ width:32px; height:32px; border:1px solid var(--gray-300); border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:14px; }
  .foot-bottom{ border-top:1px solid var(--gray-100); padding-top:24px; text-align:center; color:var(--gray-500); font-size:13px; }

  @media (max-width: 900px){
    h1{ font-size:36px; }
    .benefits-grid{ grid-template-columns:1fr; }
    .guarantee-top, .guarantee-bottom, .steps, .pricing-grid{ grid-template-columns:1fr; }
    .navlinks{ display:none; }
    .phone{ width:200px; }
    .section-head h2{ font-size:28px; }
  }
`;

export default function HomePage() {
  const [activePanel, setActivePanel] = useState<MockPanel>("inicio");

  return (
    <>
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: css }} />

      <Script id="meta-pixel" strategy="afterInteractive">{`
        !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
        n.callMethod.apply(n,arguments):n.queue.push(arguments)};
        if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
        n.queue=[];t=b.createElement(e);t.async=!0;
        t.src=v;s=b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t,s)}(window,document,'script',
        'https://connect.facebook.net/en_US/fbevents.js');
        fbq('init','955453115580482');
        fbq('track','PageView');
      `}</Script>

      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          src="https://www.facebook.com/tr?id=955453115580482&ev=PageView&noscript=1"
          alt=""
        />
      </noscript>

      <nav>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://anaclara.shop/wp-content/uploads/2026/08/disparei-logo.webp"
          alt="Disparei"
          className="logo-img"
        />
        <div className="navlinks">
          <a href="#recursos">Recursos</a>
          <a href="#como-funciona">Como funciona</a>
          <a href="#preco">Preço</a>
          <a href="#faq">FAQ</a>
        </div>
        <div className="navright">
          <a href="https://www.disparei.pro/login" className="navlogin">Login</a>
        </div>
      </nav>

      <div className="hero">
        <div className="badge"><span className="dot"></span> Conecte, dispare, escale</div>
        <h1>Pare de disparar mensagem <span className="strike">no manual</span>.</h1>
        <p className="sub">O Disparei conecta seu WhatsApp e envia suas mensagens para todos os seus grupos em segundos. Sem app travando, sem número banido, sem perder tempo copiando e colando.</p>
        <div className="hero-ctas">
          <a href="#preco" className="btn-primary">Quero automatizar meus disparos</a>
          <a href="#como-funciona" className="btn-secondary">Ver como funciona</a>
        </div>
        <div className="micro">Configuração em menos de 5 minutos · Sem precisar de suporte técnico</div>
      </div>

      <div className="mock-wrap">
        <div className="mock">
          <div className="mock-bar"><span></span><span></span><span></span></div>
          <div className="mock-body">
            <div className="mock-side">
              <button className={`item${activePanel === "inicio" ? " active" : ""}`} onClick={() => setActivePanel("inicio")}>Início</button>
              <button className={`item${activePanel === "numeros" ? " active" : ""}`} onClick={() => setActivePanel("numeros")}>Números</button>
              <button className={`item${activePanel === "campanhas" ? " active" : ""}`} onClick={() => setActivePanel("campanhas")}>Campanhas</button>
              <button className={`item${activePanel === "modelos" ? " active" : ""}`} onClick={() => setActivePanel("modelos")}>Modelos</button>
              <button className={`item${activePanel === "disparos" ? " active" : ""}`} onClick={() => setActivePanel("disparos")}>Disparos</button>
            </div>
            <div className="mock-main">

              <div className={`mock-panel${activePanel === "inicio" ? " active" : ""}`}>
                <h3>Início</h3>
                <p className="desc">Sua operação num olhar só</p>
                <div className="mock-badge-green">● WhatsApp conectado · 55 12 *****-1853</div>
                <div className="mock-stats3">
                  <div className="mock-stat"><div className="lab">Números conectados</div><div className="val">1</div></div>
                  <div className="mock-stat"><div className="lab">Campanhas</div><div className="val">1</div></div>
                  <div className="mock-stat"><div className="lab">Grupos</div><div className="val">924</div></div>
                </div>
              </div>

              <div className={`mock-panel${activePanel === "numeros" ? " active" : ""}`}>
                <h3>Números conectados</h3>
                <p className="desc">Gerencie os telefones usados nos disparos</p>
                <div className="mock-numbox">
                  <div className="mock-input-fake">Ex: Comercial ou Campanha semanal</div>
                  <div className="mock-btn-fake">+ Conectar novo número</div>
                </div>
                <div className="mock-numcard">
                  <div className="head"><h5>📞 SUPORTE 01</h5><span className="status">Conectado</span></div>
                  <div className="phone">5512982341853</div>
                  <div className="kv"><span>Nome no WhatsApp</span><span>Não disponível</span></div>
                  <div className="kv"><span>Adicionado em</span><span>05/08/2026, 14:36</span></div>
                  <div className="actions"><span>Gerar QR</span><span>Atualizar grupos</span><span>Desconectar</span></div>
                </div>
              </div>

              <div className={`mock-panel${activePanel === "campanhas" ? " active" : ""}`}>
                <h3>Campanhas</h3>
                <p className="desc">Organize grupos por campanha para facilitar os disparos</p>
                <div className="mock-campcard">
                  <div><h5>ACHADINHOS TP</h5><span className="sub">SUPORTE 01 · 1 grupo(s)</span></div>
                  <span className="arrow">›</span>
                </div>
              </div>

              <div className={`mock-panel${activePanel === "modelos" ? " active" : ""}`}>
                <h3>Modelos</h3>
                <p className="desc">Organize suas mensagens em pastas</p>
                <div className="mock-card">
                  <div className="folder">📁</div>
                  <h4>ACHADINHOS</h4>
                  <p>1 modelo · Atualizado agora</p>
                </div>
              </div>

              <div className={`mock-panel${activePanel === "disparos" ? " active" : ""}`}>
                <h3>Disparos</h3>
                <p className="desc">Escolha a campanha, a mensagem e o momento do envio</p>
                <div className="mock-tabs2"><span className="on">Novo disparo</span><span className="off">Programados</span></div>
                <div className="mock-step">
                  <h6>1. Escolher campanha</h6>
                  <div className="mock-select-fake">Selecionar campanha</div>
                </div>
                <div className="mock-step">
                  <h6>2. Escolher telefone responsável</h6>
                  <div className="mock-select-fake">Número principal conectado</div>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>

      <div className="statbar">
        <div className="wrap">
          <div className="stat"><div className="num">&lt;1min</div><div className="lab">para conectar seu número</div></div>
          <div className="stat"><div className="num">0</div><div className="lab">linhas de código pra configurar</div></div>
          <div className="stat"><div className="num">100%</div><div className="lab">controle do que foi enviado</div></div>
        </div>
      </div>

      <section id="recursos">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">Recursos</div>
            <h2>Feito pra extrair o máximo potencial dos seus grupos</h2>
            <p>Cada grupo parado é audiência que você já conquistou e não está usando. O Disparei existe pra virar isso em venda, todos os dias.</p>
          </div>
          <div className="benefits-grid">
            <div className="b-card">
              <div className="ic">⚡</div>
              <h4>Disparo em massa de verdade</h4>
              <ul><li>Um clique, todos os grupos recebendo ao mesmo tempo</li><li>Nada de plugin remendado que trava no meio do envio</li></ul>
            </div>
            <div className="b-card">
              <div className="ic">🔒</div>
              <h4>Seu número blindado</h4>
              <ul><li>Estrutura construída pra manter a conexão de pé</li><li>Chega de perder chip por ferramenta amadora</li></ul>
            </div>
            <div className="b-card">
              <div className="ic">📁</div>
              <h4>Modelos prontos pra reusar</h4>
              <ul><li>Guarde a mensagem que converte em pastas</li><li>Dispare de novo sem reescrever nada</li></ul>
            </div>
            <div className="b-card">
              <div className="ic">🗂️</div>
              <h4>Campanhas segmentadas</h4>
              <ul><li>Separe os grupos por objetivo: venda, aviso, VIP</li><li>Fale só com quem interessa, na hora certa</li></ul>
            </div>
          </div>
        </div>
      </section>

      <section className="gray" id="como-funciona">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">Como funciona</div>
            <h2>Ao conectar seu número agora, você garante</h2>
          </div>
          <div className="guarantee-top">
            <div className="guarantee-hero">
              <h4>Setup em 3 passos. Sem curso, sem treinamento.</h4>
              <div className="pricerow"><span>1. Escaneia o QR code</span><span>&lt; 1 min</span></div>
              <div className="pricerow"><span>2. Organiza os grupos em campanhas</span><span>2 min</span></div>
              <div className="pricerow"><span>3. Escolhe o modelo e dispara pra todos</span><span>10 seg</span></div>
            </div>
            <div className="guarantee-side">
              <div className="tag">Feito pra quem não é de TI</div>
              <p>Se você sabe usar WhatsApp no seu celular, você já sabe usar o Disparei.</p>
            </div>
          </div>
          <div className="guarantee-bottom">
            <div className="card">
              <div className="tag">Controle total do envio</div>
              <p>Veja exatamente o que foi enviado, pra quantos grupos e o que falhou. Sem achismo, com número na mão.</p>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">Passo a passo</div>
            <h2>Simples assim. De propósito.</h2>
          </div>
          <div className="steps">
            <div className="step">
              <div className="num">01</div>
              <h3>Conecta seu número</h3>
              <p>Escaneia o QR code e seu WhatsApp já está ligado à plataforma. Sem instalar nada.</p>
            </div>
            <div className="step">
              <div className="num">02</div>
              <h3>Organiza suas campanhas</h3>
              <p>Agrupa seus grupos por tema — Achadinhos, VIP, Ofertas — do jeito que faz sentido pro seu negócio.</p>
            </div>
            <div className="step">
              <div className="num">03</div>
              <h3>Dispara pra todos de uma vez</h3>
              <p>Escolhe o modelo, escolhe a campanha, aperta enviar. Pronto — todo mundo recebeu.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="gray" id="preco">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">Preço</div>
            <h2>Um plano. Sem letra miúda, sem pegadinha.</h2>
          </div>
          <div className="pricing-grid">
            <div className="price-card">
              <div className="tag">START</div>
              <div className="price">R$39<span>/mês</span></div>
              <div className="price-sub">Cancele quando quiser, sem multa</div>
              <div className="price-list">
                <div className="row"><div className="check">✓</div> 1 número de WhatsApp conectado</div>
                <div className="row"><div className="check">✓</div> Campanhas ilimitadas</div>
                <div className="row"><div className="check">✓</div> Grupos ilimitados</div>
                <div className="row"><div className="check">✓</div> Disparos em massa ilimitados</div>
                <div className="row"><div className="check">✓</div> Agendamento de disparos</div>
                <div className="row"><div className="check">✓</div> Modelos de mensagem</div>
                <div className="row"><div className="check">✓</div> Histórico de envios (30 dias)</div>
              </div>
              <a href="https://pay.hub.la/LI3Txcm3rWNDfrCIybVW" className="btn-secondary btn-full">Começar com o START</a>
            </div>

            <div className="price-card featured">
              <div className="featured-badge">⭐ Mais escolhido</div>
              <div className="tag">PRO</div>
              <div className="price">R$79<span>/mês</span></div>
              <div className="price-sub">Cancele quando quiser, sem multa</div>
              <div className="price-list">
                <div className="row"><div className="check">✓</div> Até 3 números de WhatsApp conectados</div>
                <div className="row"><div className="check">✓</div> Campanhas ilimitadas</div>
                <div className="row"><div className="check">✓</div> Grupos ilimitados</div>
                <div className="row"><div className="check">✓</div> Disparos em massa ilimitados</div>
                <div className="row"><div className="check">✓</div> Agendamento de disparos</div>
                <div className="row"><div className="check">✓</div> Modelos organizados por pastas</div>
                <div className="row"><div className="check">✓</div> Histórico completo de envios e falhas</div>
                <div className="row"><div className="check">✓</div> Estatísticas básicas</div>
                <div className="row"><div className="check">✓</div> Fila inteligente</div>
              </div>
              <a href="https://pay.hub.la/BRRDudofJKxPpKFJHBxe" className="btn-primary btn-full">Quero extrair o máximo dos meus grupos</a>
            </div>

            <div className="price-card">
              <div className="tag">SCALE</div>
              <div className="price">R$149<span>/mês</span></div>
              <div className="price-sub">Cancele quando quiser, sem multa</div>
              <div className="price-list">
                <div className="row"><div className="check">✓</div> Até 10 números de WhatsApp conectados</div>
                <div className="row"><div className="check">✓</div> Campanhas ilimitadas</div>
                <div className="row"><div className="check">✓</div> Grupos ilimitados</div>
                <div className="row"><div className="check">✓</div> Disparos em massa ilimitados</div>
                <div className="row"><div className="check">✓</div> Agendamento de disparos</div>
                <div className="row"><div className="check">✓</div> Modelos organizados por pastas</div>
                <div className="row"><div className="check">✓</div> Histórico completo de envios e falhas</div>
                <div className="row"><div className="check">✓</div> Estatísticas avançadas</div>
                <div className="row"><div className="check">✓</div> Fila inteligente com prioridade</div>
                <div className="row"><div className="check">✓</div> Múltiplos usuários (equipe)</div>
                <div className="row"><div className="check">✓</div> Acesso antecipado a novos recursos</div>
              </div>
              <a href="https://pay.hub.la/3kJ87CEotVEFhsSsGCYC" className="btn-secondary btn-full">Começar com o SCALE</a>
            </div>
          </div>
        </div>
      </section>

      <section id="faq">
        <div className="wrap" style={{ maxWidth: "760px" }}>
          <div className="section-head">
            <div className="eyebrow">FAQ</div>
            <h2>Perguntas frequentes</h2>
          </div>
          <details className="faq-item" open>
            <summary>Preciso entender de tecnologia pra usar?</summary>
            <div className="a">Não. Se você sabe usar o WhatsApp do seu celular, você sabe usar o Disparei. A conexão é feita escaneando um QR code, igual você já faz no WhatsApp Web.</div>
          </details>
          <details className="faq-item">
            <summary>Meu número corre risco de ser banido?</summary>
            <div className="a">O Disparei foi construído pra manter a conexão estável e reduzir o risco de bloqueio — o oposto de ferramenta amadora que derruba número por mau uso.</div>
          </details>
          <details className="faq-item">
            <summary>Quantos grupos eu posso disparar de uma vez?</summary>
            <div className="a">Sem limite de grupos, campanhas ou números conectados. Organiza do jeito que fizer sentido pro seu negócio e dispara pra todos de uma vez.</div>
          </details>
          <details className="faq-item">
            <summary>Consigo cancelar quando quiser?</summary>
            <div className="a">Sim. Sem fidelidade, sem multa. Se não fizer sentido pra você, cancela e pronto.</div>
          </details>
        </div>
      </section>

      <div className="final-cta">
        <h2>Seus grupos já têm audiência. Falta você usar direito.</h2>
        <p>Conecta seu número agora e dispara sua primeira mensagem em massa hoje mesmo.</p>
        <a href="#preco" className="btn-primary">Quero extrair o máximo dos meus grupos →</a>
      </div>

      <footer>
        <div className="wrap">
          <div className="foot-grid">
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://anaclara.shop/wp-content/uploads/2026/08/disparei-logo.webp"
                alt="Disparei"
                style={{ height: "22px", width: "auto" }}
              />
            </div>
            <div className="foot-col">
              <h5>Acompanhe</h5>
              <div className="foot-social">
                <a href="#">IG</a><a href="#">FB</a><a href="#">IN</a>
              </div>
            </div>
            <div className="foot-col">
              <h5>Horário de atendimento</h5>
              <p>Segunda a sexta das 8h às 12h</p>
              <p>e das 14h às 18h</p>
            </div>
          </div>
          <div className="foot-bottom">© 2026 Disparei. Todos os direitos reservados.</div>
        </div>
      </footer>
    </>
  );
}
