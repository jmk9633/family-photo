-- 0004 보낸 알림 기록 테스트: 앱 사용자는 읽지도 쓰지도 못하고, 같은 알림은 두 번 기록되지 않는다
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1111111-1111-1111-1111-111111111111', 'a@nl.dev', '{}');
insert into public.posts (id, sender_id, status) values
  ('00000000-0000-0000-0000-0000000000a1', 'a1111111-1111-1111-1111-111111111111', 'ready');

-- 함수(service role)가 넣는 것처럼 소유자 권한으로 한 줄
insert into public.notification_log (kind, post_id, actor_id, on_date) values
  ('heart', '00000000-0000-0000-0000-0000000000a1', 'a1111111-1111-1111-1111-111111111111', '1970-01-01');
select throws_ok(
  $$insert into public.notification_log (kind, post_id, actor_id, on_date) values
    ('heart', '00000000-0000-0000-0000-0000000000a1', 'a1111111-1111-1111-1111-111111111111', '1970-01-01')$$,
  '23505', null, '같은 알림은 두 번 기록되지 않는다');

set local role authenticated;
set local request.jwt.claims to '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok($$select * from public.notification_log$$, '42501', null, '앱 사용자는 알림 기록을 읽을 수 없다 (자기 묶음이어도)');
select throws_ok(
  $$insert into public.notification_log (kind, post_id, actor_id, on_date) values
    ('seen', '00000000-0000-0000-0000-0000000000a1', 'a1111111-1111-1111-1111-111111111111', '2026-10-17')$$,
  '42501', null, '앱 사용자는 알림 기록을 넣을 수 없다');
set local role anon;
select throws_ok($$select * from public.notification_log$$, '42501', null, '로그인 안 한 사용자도 읽을 수 없다');
reset role;

select * from finish();
rollback;
