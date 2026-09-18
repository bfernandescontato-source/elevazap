# Disparei no Coolify

Crie o projeto `disparei` e o ambiente `staging` no Coolify. Os serviços devem
ser aplicações separadas, construídas a partir da raiz deste repositório:

| Serviço | Dockerfile | Porta interna | Exposição pública |
| --- | --- | --- | --- |
| `disparei-web` | `deploy/web.Dockerfile` | 3000 | Sim, via domínio de teste |
| `disparei-whatsapp` | `deploy/whatsapp-service.Dockerfile` | 3001 | Não |

O proxy público é exclusivamente o Traefik já administrado pelo Coolify. Não
instale Caddy, Nginx ou outro proxy no host e não publique a porta 3001.

Configure `WHATSAPP_SERVICE_URL` do painel com o nome interno do serviço
`http://disparei-whatsapp:3001`, e use o mesmo `INTERNAL_API_KEY` nos dois
serviços. Crie um volume persistente exclusivo para os dados de sessão do
WhatsApp somente depois de confirmar o caminho usado pelo serviço.

Antes da virada de DNS, valide no domínio de teste: login, Supabase, webhook
de homologação, upload, conexão WhatsApp, processamento de fila e os três
agendadores atualmente executados pela Vercel.

## Validar a chave de integração antes da virada

`INTEGRATION_ENCRYPTION_KEY` protege os segredos da Shopee, do Mercado Livre e da
Meta gravados no banco. Ela é opcional no schema: se estiver errada ou ausente,
os serviços sobem normalmente e as integrações falham só depois. Por isso, antes
de qualquer virada, confira a chave contra os segredos reais (somente leitura):

```sh
node scripts/verify-integration-key.mjs
```

O script pergunta `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` e
`INTEGRATION_ENCRYPTION_KEY` (as duas chaves não aparecem na tela). Se as
variáveis já estiverem definidas no ambiente, ele não pergunta.

O resultado deve ser `Todos os segredos descriptografam` (exit 0). O fingerprint
impresso no topo identifica a chave sem revelá-la e deve ser igual no Railway,
na Vercel e na VPS. Qualquer `FALHOU` significa chave errada: não faça a virada.
