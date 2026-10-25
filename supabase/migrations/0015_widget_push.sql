-- 0015 새 사진이 오면 위젯 바로 바꾸기 (개발 8-2, F-NGOJFO, 10/25 결정 C)
--
-- iOS 26부터 애플이 '위젯만 다시 그리게 하는 신호'(WidgetKit 푸시)를 제공한다. 알림처럼 화면에 뜨지 않는다.
--   - 위젯이 애플에서 받은 신호 주소(push token)를 위젯 열쇠와 함께 Edge Function `widget`에 보내면 set_widget_push_token이 저장한다.
--   - 새 묶음이 완료되면 Edge Function `notify`(new_post)가 widget_push_targets로 받을 위젯을 골라 애플(APNs)에 직접 보낸다.
--   - 애플이 '없는 주소'라고 하면 clear_widget_push_token으로 지운다.
--   - iOS 26보다 오래된 폰은 신호 주소가 없어 지금처럼 30분 확인으로 바뀐다 (8-1 그대로).
--
-- 신호는 받는 사람의 '봤어요'·활동이 아니다. 이 함수들은 post_views·profiles를 바꾸지 않는다 (widget_push.test.sql에서 확인).
-- 신호 주소는 앱(로그인 사용자)이 읽을 수 없다 (0014의 열 단위 권한에 새 열을 넣지 않는다).

alter table public.widget_keys
  add column push_token      text,         -- 애플이 그 폰의 위젯에 준 신호 주소 (16진수)
  add column push_env        text check (push_env in ('sandbox', 'production')),  -- 개발 빌드 = sandbox, 출시 빌드 = production
  add column push_updated_at timestamptz;
create index widget_keys_push_token on public.widget_keys (push_token) where push_token is not null;

-- 위젯이 보낸 신호 주소 저장 (Edge Function `widget` 전용). 'ok' 또는 'invalid'를 돌려준다.
-- 같은 주소가 다른 열쇠에 남아 있으면(앱을 다시 깔았거나 다른 사람으로 로그인) 그쪽에서는 지운다.
create or replace function public.set_widget_push_token(p_key text, p_token text, p_env text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  v_hash text;
  v_id   uuid;
begin
  if p_key is null or p_key !~ '^[0-9a-f]{64}$' then return 'invalid'; end if;
  if p_token is null or p_token !~ '^[0-9a-f]+$' or length(p_token) not between 32 and 400 then return 'invalid'; end if;
  if p_env is null or p_env not in ('sandbox', 'production') then return 'invalid'; end if;
  v_hash := encode(digest(p_key, 'sha256'), 'hex');

  select id into v_id from public.widget_keys where key_hash = v_hash;
  if v_id is null then return 'invalid'; end if;

  update public.widget_keys set push_token = null, push_env = null, push_updated_at = now()
  where push_token = p_token and id <> v_id;
  update public.widget_keys set push_token = p_token, push_env = p_env, push_updated_at = now()
  where id = v_id and (push_token is distinct from p_token or push_env is distinct from p_env);
  return 'ok';
end;
$$;

-- 이 묶음이 완료됐을 때 신호를 받을 위젯 (Edge Function `notify` 전용).
-- 묶음을 받은 그룹의 활성 구성원 중 보낸 사람을 뺀 사람들의 위젯. 완료(ready)된 묶음만.
create or replace function public.widget_push_targets(p_post uuid)
returns table (push_token text, push_env text) language sql stable security definer set search_path = public as $$
  select distinct k.push_token, k.push_env
  from public.posts p
  join public.post_groups pg on pg.post_id = p.id
  join public.members m on m.group_id = pg.group_id and m.status = 'active'
  join public.widget_keys k on k.user_id = m.user_id
  where p.id = p_post and p.status = 'ready'
    and m.user_id <> p.sender_id
    and k.push_token is not null and k.push_env is not null;
$$;

-- 애플이 없는 주소라고 하면 지운다 (Edge Function `notify` 전용)
create or replace function public.clear_widget_push_token(p_token text)
returns void language sql security definer set search_path = public as $$
  update public.widget_keys set push_token = null, push_env = null, push_updated_at = now()
  where push_token = p_token;
$$;

revoke execute on function public.set_widget_push_token(text, text, text) from public, anon, authenticated;
revoke execute on function public.widget_push_targets(uuid)               from public, anon, authenticated;
revoke execute on function public.clear_widget_push_token(text)           from public, anon, authenticated;
grant  execute on function public.set_widget_push_token(text, text, text) to service_role;
grant  execute on function public.widget_push_targets(uuid)               to service_role;
grant  execute on function public.clear_widget_push_token(text)           to service_role;
