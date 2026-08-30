# Contas manuais da WhatsApp Cloud API

Painel: `/admin/whatsapp-oficial/contas` (administrador interno apenas).

## Cadastro

1. Informe App ID, WABA ID, Phone Number ID, versão Graph, token do usuário do sistema e App Secret. O ID da BM é opcional e informativo.
2. O servidor valida o aplicativo do token, as permissões `whatsapp_business_management` e `whatsapp_business_messaging`, o acesso à WABA e a associação do número.
3. Copie o token de verificação exibido uma única vez. Configure o callback HTTPS `/api/webhooks/meta` no aplicativo Meta e assine o campo `messages`.
4. Vincule o aplicativo à WABA pelo botão do painel, caso ainda não esteja vinculado. Teste a conexão.
5. Selecione a conta nos fluxos, disparos ou automações e faça um envio de teste consentido antes da campanha.

Não é criado outro aplicativo automaticamente. Use o aplicativo que tem acesso autorizado à WABA. A configuração manual não substitui cadastro/registro do número, pagamento, aprovação de templates ou permissões da Meta. Não há rodízio automático de contas nem promessa de somar limites. Consulte o WhatsApp Manager para os limites vigentes.

## Segurança e compatibilidade

- Access Token e App Secret cifrados com AES-256-GCM, IV aleatório e `INTEGRATION_ENCRYPTION_KEY` de 32 bytes em base64, fora do banco. Preserve essa chave; substituí-la sem migrar o ciphertext impede decriptar credenciais existentes.
- Listagens usam allowlist de campos sem segredos. Respostas administrativas de contas usam `Cache-Control: no-store`.
- O token de verificação é persistido apenas como SHA-256. É possível gerar outro pelo painel; atualize a Meta após a troca.
- HMAC do webhook vinculado ao aplicativo, número e WABA. Números desconhecidos nunca usam a conta principal como fallback. Status e respostas permanecem vinculados à conexão original.
- Novos envios são bloqueados até validar callback e inscrição da WABA. A assinatura do campo `messages` deve ser conferida na Meta; o painel não a infere apenas de `/subscribed_apps`.
- Desativar preserva histórico e recebimento de status antigos. Campanhas em andamento devem ser pausadas antes de desativar. Respostas automáticas ficam bloqueadas enquanto a conta estiver desativada.
- `connection_id = null` significa a configuração legada em `META_*`. A migração não altera campanhas, números nem credenciais existentes.
- RLS habilitado; `anon` e `authenticated` não têm privilégios na tabela de credenciais. API exige administrador interno, valida origem nas mutações e limita tentativas.
- Troca de token/segredo conserva App ID, WABA e número. Outra identidade exige novo cadastro para preservar histórico.

## Publicação

Aplique `20260830164000_official_multi_connections.sql` antes do código. A migração é aditiva e transacional. Não execute migrações pendentes de outras tarefas sem auditoria. Se aplicada isoladamente, registre somente esta versão no histórico de migrações.

Rollback do código pode manter a tabela e as colunas novas; não apague credenciais ou histórico. Um rollback antigo não deve ser usado para processar campanhas de contas novas, pois não sabe selecionar o remetente.

## Validação

Testes: `official-connections.test.ts`, `official-webhook-connections.test.ts`, `official-whatsapp.test.ts`. Cobrem criptografia autenticada, permissões, associação app/WABA/número, conta desativada/incompleta, fallback proibido, HMAC, idempotência e legado. Teste real de um número novo requer suas credenciais e uma mensagem consentida; não é substituído por mocks.

Referência: [documentação oficial da Meta no Postman](https://www.postman.com/meta/whatsapp-business-platform/overview), incluindo `/debug_token` e `/{WABA-ID}/subscribed_apps`.
