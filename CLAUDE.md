# Disparei / ElevaZap — guia para agentes e desenvolvedores

Este repositório é **público**. Nunca escreva aqui segredos, endereços de painéis administrativos, IPs de servidores nem identificadores de projetos. O mapa de infraestrutura e o roteiro de operação ficam num documento privado (cofre de senhas da equipe).

## O que é

SaaS multi-tenant de comunicação por WhatsApp (disparos para grupos, Piloto Automático de ofertas de afiliados, WhatsApp oficial da Meta). Detalhes de produto no `README.md`; camadas e regras obrigatórias em `docs/architecture.md`.

- `web/` — painel Next.js 15 (App Router, TypeScript, Tailwind). Roda em container (`deploy/web.Dockerfile`).
- `whatsapp-service/` — Node.js 24/7 com Baileys. **Mantém sessões WhatsApp em memória e é stateful.**
- `supabase/migrations/` — esquema do banco (Postgres no Supabase).
- `deploy/` — Dockerfiles e notas de deploy. `scripts/` — utilitários de diagnóstico.

## Comandos

- `npm run dev:web`, `npm run dev:service`
- `npm run validate` (arquitetura + testes + build). `npm run architecture:check` em toda mudança estrutural.
- Hoje 2 testes de `web/test/multi-tenant-security.test.ts` já falham na `main` (vincular campanhas legadas, APIs de leitura com RLS). Não são causados por mudanças novas; não mascare, corrija ou registre.

## Regras que já custaram incidentes

1. **Nunca rode duas instâncias do `whatsapp-service` contra o mesmo banco.** Elas disputam as mesmas sessões e derrubam todos os números. Só uma instância ativa; a outra deve estar parada.
2. **Multi-tenant:** `account_id` vem da sessão autenticada, nunca do corpo da requisição. Mantenha RLS e filtro explícito de conta quando usar `service_role`.
3. **Limite de 8 s do PostgREST** (papéis `authenticator`/`service_role` via API): qualquer função de banco que passe disso é desfeita e a tela mostra erro. Trabalho longo deve ser dividido em várias chamadas (RPCs), cada uma curta. `set_config('statement_timeout')` dentro da função **não** estende o limite.
4. **Mudanças de banco:** migrations não são aplicadas automaticamente. Antes de assumir que um objeto existe, confira o banco real (o histórico de produção já divergiu dos arquivos). Teste em transação desfeita (`do $$ ... raise exception 'RESULTADO: %', ... $$`) antes de aplicar. Nunca reescreva milhares de linhas de histórico numa só instrução.
5. **Segredos:** nunca versionar. Segredos de integração usam AES-256-GCM (`INTEGRATION_ENCRYPTION_KEY`); trocar essa chave inutiliza tudo o que foi criptografado.
6. **Publicar em `main` dispara builds** em serviços externos. Não faça push de teste na `main`.

## Fluxo de trabalho

- Alterações em branch própria; abra PR para a `main`.
- Rode `npm run validate` antes de pedir revisão.
- Para operar produção (deploy, reinício, mudança de banco, filas), siga o roteiro privado de operação; não improvise em produção.
