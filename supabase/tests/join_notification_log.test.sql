-- 0006 합류 알림 기록 테스트: 앱 사용자는 읽지도 쓰지도 못하고, 같은 합류는 두 번 기록되지 않는다
-- (다른 그룹 사용자는 물론 같은 그룹 구성원도 못 읽는다)
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a6666666-0000-0000-0000-000000000001', 'a@jn.dev', '{}'),
  ('b6666666-0000-0000-0000-000000000002', 'b@jn.dev', '{}');

create temp table t_j (id uuid);
grant all on t_j to authenticated;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a6666666-0000-0000-0000-000000000001","role":"authenticated"}';
insert into t_j values (public.create_group('전주 엄마네', '막내'));
reset role;
insert into public.members (group_id, user_id, display_name)
  values ((select id from t_j), 'b6666666-0000-0000-0000-000000000002', '엄마');

-- 함수(service role)가 넣는 것처럼 소유자 권한으로 한 줄
insert into public.join_notification_log (member_id, joined_at)
  select id, joined_at from public.members where user_id = 'b6666666-0000-0000-0000-000000000002';
select throws_ok(
  $$insert into public.join_notification_log (member_id, joined_at)
    select id, joined_at from public.members where user_id = 'b6666666-0000-0000-0000-000000000002'$$,
  '23505', null, '같은 합류는 두 번 기록되지 않는다');
select lives_ok(
  $$insert into public.join_notification_log (member_id, joined_at)
    select id, joined_at + interval '1 day' from public.members where user_id = 'b6666666-0000-0000-0000-000000000002'$$,
  '나갔다가 다시 들어오면(들어온 시각이 다르면) 다시 기록된다');

set local role authenticated;
set local request.jwt.claims to '{"sub":"a6666666-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select * from public.join_notification_log$$, '42501', null, '같은 그룹 구성원도 합류 기록을 읽을 수 없다');
select throws_ok(
  $$insert into public.join_notification_log (member_id, joined_at)
    select id, now() from public.members where user_id = 'a6666666-0000-0000-0000-000000000001'$$,
  '42501', null, '앱 사용자는 합류 기록을 넣을 수 없다');
set local role anon;
select throws_ok($$select * from public.join_notification_log$$, '42501', null, '로그인 안 한 사용자도 읽을 수 없다');
reset role;

select * from finish();
rollback;
