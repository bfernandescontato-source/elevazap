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
