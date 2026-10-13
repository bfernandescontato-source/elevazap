# Publicação em produção

As publicações de produção passam pelo fluxo `Release production` do GitHub
Actions. A Vercel não cria mais uma produção automaticamente ao receber um
commit: o fluxo primeiro aplica todas as migrações pendentes, executa os testes
e só então publica o build validado.

Configure estes segredos no repositório, no ambiente GitHub `production`:

- `SUPABASE_ACCESS_TOKEN`: token pessoal do Supabase usado apenas pela automação.
- `SUPABASE_DB_PASSWORD`: senha do banco do projeto.
- `SUPABASE_PROJECT_ID`: `ckcqlylbehchmgnarkxb`.
- `VERCEL_TOKEN`: token de automação da Vercel.
- `VERCEL_ORG_ID`: identificador da equipe da Vercel.
- `VERCEL_PROJECT_ID`: identificador do projeto `elevazap-web`.

Os valores devem existir somente como segredos do GitHub. Nunca os adicione a
arquivos `.env` versionados ou ao código da aplicação.

Se uma migração ou teste falhar, o fluxo para antes de publicar qualquer nova
versão na Vercel. Para uma publicação intencional, envie a alteração para
`main` ou inicie manualmente o fluxo em **Actions → Release production**.
