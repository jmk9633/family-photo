-- 0016 새 사진이 오면 안드로이드 위젯도 바로 바꾸기 (개발 8-3-2, F-NGOJFO, 10/26 결정)
--
-- 0015는 애플 위젯 신호 주소(16진수, sandbox/production)만 받는다. 안드로이드는 Expo 푸시 주소
-- ('ExponentPushToken[...]')로 '조용한 신호'(화면에 안 뜨는 데이터 메시지)를 보내 앱이 화면 없이 위젯만 다시 그리게 한다.
--   - 신호 주소 종류(push_env)에 'expo'를 더한다. 애플 주소와 같은 칸·같은 규칙(같은 주소는 마지막 열쇠에만)을 쓴다.
--   - 알림을 껐어도 안드로이드는 이 주소를 받을 수 있다(알림 주소 표 devices와 따로 둔다 — devices에는 알림을 허용한 폰만 있다).
--   - 받을 위젯 고르기(widget_push_targets)·지우기(clear_widget_push_token)는 0015 그대로 쓴다.
--   - 신호는 '봤어요'·활동이 아니다. 이 함수는 post_views·profiles를 바꾸지 않는다 (widget_push_android.test.sql).
-- 0015는 원격에 적용된 파일이라 고치지 않고 여기서 바꾼다.

alter table public.widget_keys drop constraint if exists widget_keys_push_env_check;
alter table public.widget_keys
  add constraint widget_keys_push_env_check check (push_env in ('sandbox', 'production', 'expo'));

-- 신호 주소 저장 (Edge Function `widget` 전용). 'ok' 또는 'invalid'.
-- 애플(sandbox·production): 16진수 32~400자 (0015와 같음) / 안드로이드(expo): 'ExponentPushToken[...]' 모양, 250자까지
create or replace function public.set_widget_push_token(p_key text, p_token text, p_env text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  v_hash text;
  v_id   uuid;
begin
  if p_key is null or p_key !~ '^[0-9a-f]{64}$' then return 'invalid'; end if;
  if p_env is null or p_env not in ('sandbox', 'production', 'expo') then return 'invalid'; end if;
  if p_env = 'expo' then
    if p_token is null or length(p_token) > 250 or p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$' then
      return 'invalid';
    end if;
  else
    if p_token is null or p_token !~ '^[0-9a-f]+$' or length(p_token) not between 32 and 400 then return 'invalid'; end if;
  end if;
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

revoke execute on function public.set_widget_push_token(text, text, text) from public, anon, authenticated;
grant  execute on function public.set_widget_push_token(text, text, text) to service_role;
