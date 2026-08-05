# Liberação gradual

O teste de carga nunca envia mensagens e deve apontar primeiro para preview ou ambiente local.

## Portões de liberação

1. **10 contas:** 48 horas, nenhuma exposição entre contas, erros abaixo de 1% e nenhum envio incerto sem explicação.
2. **50 contas:** 72 horas, fila sem crescimento contínuo e p95 das APIs abaixo de 800 ms.
3. **200 contas:** sete dias, sessões reconectando corretamente e banco sem consultas críticas lentas.
4. **1.000 contas:** liberar somente após teste com tráfego equivalente, alertas operacionais e capacidade contratada confirmada.

Interromper a expansão se a fila crescer por 15 minutos, erros superarem 1%, houver falha de isolamento ou aumento anormal de envios incertos.

## Teste não destrutivo

```bash
LOAD_TEST_URL=https://preview.vercel.app LOAD_TEST_CONCURRENCY=10 LOAD_TEST_DURATION_SECONDS=30 npm run load:test
```

Subir gradualmente para 25, 50 e 100 conexões, observando Vercel, Supabase, Railway e o painel de saúde da fila.

