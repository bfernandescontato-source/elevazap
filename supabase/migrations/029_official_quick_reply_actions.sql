-- Respostas a Quick Reply de templates: cliente clica no botão do template, a Meta manda
-- webhook, respondemos com UMA mensagem configurada (sem flow/steps/delay). Cada payload de
-- botão tem no máximo uma ação — não é fila de mensagens, é resposta única.
create table if not exists public.official_quick_reply_actions (
  id uuid primary key default gen_random_uuid(),
  payload text not null unique,
  button_label text,
  response_type text not null check (response_type in ('text', 'image', 'video', 'audio', 'document')),
  response_text text,
  media_bucket text,
  media_path text,
  mime_type text,
  file_name text,
  caption text,
  button_config jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.official_events
  add column if not exists quick_reply_action_id uuid references public.official_quick_reply_actions(id) on delete set null;

-- official_messages passa a registrar também respostas livres (não-template) a cliques de
-- botão; nesses casos não existe nome/idioma de template.
alter table public.official_messages alter column template_name drop not null;
alter table public.official_messages alter column template_language drop not null;

alter table public.official_quick_reply_actions enable row level security;
-- Nenhuma policy criada de propósito: sem acesso para authenticated/anon, só service role.
