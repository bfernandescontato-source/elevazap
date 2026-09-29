"use client";

import { useEffect } from "react";

// Durante uma publicação do painel, o roteador da VPS responde por alguns
// segundos "no available server" (502/503, texto puro). As telas liam essa
// resposta como JSON e mostravam o erro técnico ("Unexpected token 'o'…").
// Aqui, uma vez por aba:
//  1. Leituras (GET/HEAD) do próprio painel que voltam 502/503/504 são refeitas
//     sozinhas (até 2 vezes, 1,5 s de intervalo) — o aluno nem percebe.
//  2. Resposta que não é JSON vira uma mensagem clara em vez do erro do parser.
// Envios (POST/PUT/PATCH/DELETE) NUNCA são repetidos: poderiam duplicar efeito.
const MENSAGEM = "O Disparei está sendo atualizado. Tente de novo em alguns segundos.";
const TENTATIVAS = 2;
const ESPERA_MS = 1_500;

declare global { interface Window { __disparei_fetch_resiliente?: boolean } }

export function FetchResiliente() {
  useEffect(() => {
    if (window.__disparei_fetch_resiliente) return;
    window.__disparei_fetch_resiliente = true;

    const fetchOriginal = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const metodo = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
      const doPainel = url.startsWith("/") || url.startsWith(window.location.origin);
      let resposta = await fetchOriginal(input, init);
      if (!doPainel || (metodo !== "GET" && metodo !== "HEAD")) return resposta;
      for (let tentativa = 0; tentativa < TENTATIVAS && [502, 503, 504].includes(resposta.status); tentativa++) {
        await new Promise((resolve) => setTimeout(resolve, ESPERA_MS));
        resposta = await fetchOriginal(input, init);
      }
      return resposta;
    };

    const jsonOriginal = Response.prototype.json;
    Response.prototype.json = async function json(this: Response) {
      try {
        return await jsonOriginal.call(this);
      } catch (erro) {
        if (erro instanceof SyntaxError) throw new Error(MENSAGEM);
        throw erro;
      }
    };
  }, []);
  return null;
}
