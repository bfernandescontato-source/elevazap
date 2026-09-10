begin;

-- Advisor de performance (auth_rls_initplan), parte 2: a política
-- "tenant_isolation" (aplicada em ~40 tabelas — todo o núcleo multi-tenant do
-- produto: captured_offers, offer_deliveries, envios_grupo, app_users,
-- accounts e o restante) chama current_account_id()/current_account_is_active()
-- sem (select ...), fazendo o Postgres reavaliar essas funções STABLE
-- LINHA A LINHA em vez de uma vez por consulta. Com as tabelas do Piloto
-- crescendo (milhares de linhas por conta), isso é reavaliado repetidamente
-- em praticamente toda leitura/escrita autenticada da plataforma inteira —
-- a suspeita principal para a pressão crônica de CPU/memória do banco.
-- Reescreve todas as políticas "tenant_isolation" existentes dinamicamente
-- (mesmo texto, só envolvendo as funções em subquery escalar) e depois trata
-- as três políticas nomeadas fora desse padrão (accounts, app_users).

do $$
declare t text;
begin
  for t in select tablename from pg_policies where schemaname = 'public' and policyname = 'tenant_isolation'
  loop
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format(
      'create policy tenant_isolation on public.%I for all to authenticated ' ||
      'using (account_id = (select public.current_account_id()) and (select public.current_account_is_active())) ' ||
      'with check (account_id = (select public.current_account_id()) and (select public.current_account_is_active()))',
      t
    );
  end loop;
end $$;

drop policy if exists accounts_read_own on public.accounts;
create policy accounts_read_own on public.accounts for select to authenticated
  using (id = (select public.current_account_id()));

drop policy if exists app_users_read_self_or_admin on public.app_users;
create policy app_users_read_self_or_admin on public.app_users
  for select to authenticated
  using (id = (select auth.uid()) or (select public.current_user_is_app_admin()));

drop policy if exists app_users_admin_update on public.app_users;
create policy app_users_admin_update on public.app_users
  for update to authenticated
  using ((select public.current_user_is_app_admin()))
  with check ((select public.current_user_is_app_admin()));

commit;
