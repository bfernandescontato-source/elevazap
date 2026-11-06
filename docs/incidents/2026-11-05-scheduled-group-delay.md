# Atraso do disparo FACECLUB de 05/11/2026

Horários abaixo em America/Sao_Paulo. Investigação somente de leitura; nenhuma mensagem de teste foi enviada aos grupos, e os 25 itens incertos não foram reenviados.

## Evidências

- Lote `48acd0ba-924c-4358-a643-d77484494fa0`, marcado para 12h, reivindicado às 12:00:00.515 e primeiro item iniciado às 12:00:00.763. O início do agendador não atrasou minutos.
- Todos os 25 itens excederam os 30 s da operação `whatsapp.sendMessage`, ficando incertos. Última tentativa iniciou às 12:06:55.854.
- Texto sem link ou mídia; marcar todos habilitado. O primeiro grupo tinha 691 participantes e 1.061 dispositivos. Uma consulta posterior de metadados levou 298 ms. Não há evidência de queda de conexão como gatilho.
- Logs de `edge_logs` do Supabase, filtrados pelo nome da sessão, mostram centenas de leituras de `whatsapp_auth_keys` por minuto entre 12:00 e 12:22. Quase todas retornavam lista vazia, com média de 90–100 ms por requisição. A persistência de 10.019 sessões ocorreu em torno de 12:23.
- `parseAndInjectE2ESessions` do Baileys inicializa sessões frias em grupos de 100 operações concorrentes; libsignal consulta individualmente cada sessão. O armazenamento local serializava cada leitura com `withAuthOperationLock`. O cache do Baileys só guarda valores presentes. Resultado: milhares de buscas vazias serializadas, em vez de buscas agrupadas.
- `withTimeout` usa Promise.race. O prazo rejeitava a espera, mas não cancelava `sendMessage`; operações antigas continuavam, causando entregas tardias e discrepância com o painel.

## Correção

- Coalescer leituras simultâneas por tipo, antes do bloqueio ordenado. Preservar barreiras de gravação/limpeza, erros e isolamento por sessão. Buscar até 100 chaves por requisição.
- Preparar metadados, dispositivos e sessões dos grupos nos dois minutos anteriores ao agendamento, sem enviar mensagens. Persistir a preparação em transação de chaves. Usar o mesmo cache no Baileys e invalidar quando houver alteração de grupo/participantes ou socket.
- Abortar antes de enviar se a preparação ultrapassar o prazo total. Se o prazo acabar durante o envio, encerrar apenas o socket responsável, impedindo transmissões novas por promessas antigas. Resultados já transmitidos continuam incertos e não são reenviados automaticamente.
- Registrar separadamente tempo de preparação, atraso desde o agendamento e duração do envio.

## Validação e limites

Testes de regressão cobrem 10 mil consultas concorrentes, tipos distintos, ordem leitura/gravação/leitura, falha do banco, isolamento de sockets, expiração/invalidação, preparação sem transmissão, prazo total e fechamento do socket em envio travado. Build do serviço e suíte completa executados antes da publicação.

A precisão observada do agendador neste incidente foi inferior a um segundo; isso não equivale a garantia de recebimento simultâneo em 25 grupos. A entrega final depende do WhatsApp, da rede e das conexões dos destinatários. Não se deve prometer garantia absoluta de recebimento no mesmo segundo.
