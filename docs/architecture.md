# Arquitetura do ElevaZap

## Camadas

```text
web/app       → entrega HTTP e composição de páginas
web/modules   → regras e serviços organizados por domínio
web/shared    → infraestrutura reutilizável sem conhecimento dos domínios
web/lib       → adaptadores legados em migração gradual para modules/shared

whatsapp-service/src/queue    → claim, política, métricas e processamento
whatsapp-service/src/senders  → ciclo de vida das sessões tenant
whatsapp-service/src/groups   → descoberta e sincronização
whatsapp-service/src/support  → atendimento e automações
whatsapp-service/src/offers   → captura, normalização, deduplicação e agendamento de ofertas
```

## Regras obrigatórias

1. Rotas validam entrada, obtêm o tenant e delegam; regras de negócio ficam em `modules`.
2. `modules` nunca importa `app`; `shared` nunca importa `app` ou `modules`.
3. `account_id` sempre vem da sessão autenticada, nunca do corpo da requisição.
4. Componentes cliente não conhecem credenciais administrativas.
5. Toda operação tenant mantém RLS e filtro explícito de conta quando usa privilégio elevado.
6. Integrações externas possuem adaptador, timeout, validação e erro sanitizado.
7. Estados da fila só mudam por serviços responsáveis por transição e reconciliação.
8. Fontes de oferta entregam um objeto normalizado ao processador; o processador não depende do WhatsApp.
9. Credenciais de afiliados são criptografadas com AES-256-GCM e só são descriptografadas no backend operacional.
10. Links externos só são resolvidos por adaptadores com allowlist, validação DNS por salto e limite explícito de redirects.

Execute `npm run architecture:check` em toda alteração estrutural.

## Decisões

- A migração do diretório `web/lib` é incremental para evitar uma reescrita arriscada.
- Campanhas e consultas de disparos são os primeiros módulos de referência.
- Arquivos de página existentes serão divididos por fluxo funcional, sem alterar URLs públicas.
