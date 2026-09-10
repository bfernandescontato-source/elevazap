begin;

-- Advisor de performance (auth_rls_initplan): as políticas abaixo chamavam
-- auth.uid()/current_account_id()/current_account_is_active() sem envolver
-- em (select ...), o que faz o Postgres reavaliar essas funções linha a
-- linha em vez de uma vez por consulta. community_notifications em
-- particular é consultada por todo usuário logado a cada 60s (sino de
-- notificações), então isso é carga constante na base inteira. Mesma
-- semântica, só a forma de invocar muda.

drop policy if exists community_posts_insert_own on public.community_posts;
create policy community_posts_insert_own on public.community_posts for insert to authenticated
  with check (user_id = (select auth.uid()) and account_id = (select public.current_account_id()) and (select public.current_account_is_active()));

drop policy if exists community_posts_update_own on public.community_posts;
create policy community_posts_update_own on public.community_posts for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists community_likes_insert_own on public.community_likes;
create policy community_likes_insert_own on public.community_likes for insert to authenticated
  with check (user_id = (select auth.uid()) and account_id = (select public.current_account_id()) and (select public.current_account_is_active()));

drop policy if exists community_likes_delete_own on public.community_likes;
create policy community_likes_delete_own on public.community_likes for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists community_comments_insert_own on public.community_comments;
create policy community_comments_insert_own on public.community_comments for insert to authenticated
  with check (user_id = (select auth.uid()) and account_id = (select public.current_account_id()) and (select public.current_account_is_active()));

drop policy if exists community_comments_update_own on public.community_comments;
create policy community_comments_update_own on public.community_comments for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists community_reports_select_own on public.community_reports;
create policy community_reports_select_own on public.community_reports for select to authenticated
  using (reporter_user_id = (select auth.uid()));

drop policy if exists community_reports_insert_own on public.community_reports;
create policy community_reports_insert_own on public.community_reports for insert to authenticated
  with check (reporter_user_id = (select auth.uid()) and account_id = (select public.current_account_id()) and (select public.current_account_is_active()));

drop policy if exists community_notifications_select_own on public.community_notifications;
create policy community_notifications_select_own on public.community_notifications for select to authenticated
  using (recipient_user_id = (select auth.uid()));

drop policy if exists community_notifications_update_own on public.community_notifications;
create policy community_notifications_update_own on public.community_notifications for update to authenticated
  using (recipient_user_id = (select auth.uid())) with check (recipient_user_id = (select auth.uid()));

commit;
