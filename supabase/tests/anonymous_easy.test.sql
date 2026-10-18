-- 0005 가입 없이 연결한 사용자(익명 로그인) 테스트
-- 1) 익명 사용자는 그룹·초대를 만들거나 재발급하지 못한다
-- 2) 숫자로 합류하면 초대 태그와 상관없이 쉬운 화면으로 열리고, 쉬운 화면을 끌 수 없다
-- 3) 합류한 그룹의 사진만 보이고 다른 그룹 사진은 보이지 않는다, 합류 전에는 아무것도 안 보인다
-- 4) 틀린 숫자는 같은 익명 계정에 쌓여 10분 5번 제한이 걸린다
-- 5) 계정이 있는 사람은 쉬운 화면을 끌 수 있다 (기존 동작 유지)
-- 실행: supabase test db (로컬) / supabase test db --linked (원격, 마지막에 rollback)
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- A: 그룹 관리자(계정), B: 다른 그룹 관리자, N: 익명(쉬운 화면 태그 없는 초대로 합류), M: 익명(틀린 숫자만)
insert into auth.users (id, email, raw_user_meta_data, is_anonymous) values
  ('a5555555-0000-0000-0000-000000000001', 'a@an.dev', '{}', false),
  ('b5555555-0000-0000-0000-000000000002', 'b@an.dev', '{}', false),
  ('c5555555-0000-0000-0000-000000000003', null, '{}', true),
  ('d5555555-0000-0000-0000-000000000004', null, '{}', true);

create temp table t_x (who text primary key, id uuid, code text);
grant all on t_x to authenticated;

set local role authenticated;
set local request.jwt.claims to '{"sub":"a5555555-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';
insert into t_x (who, id) values ('ga', public.create_group('전주 엄마네', '막내'));
insert into t_x (who, id, code) select 'inv', invite_id, code from public.create_invite(
  (select id from t_x where who = 'ga'), '엄마', false, false, false);
insert into t_x (who, id, code) select 'inv2', invite_id, code from public.create_invite(
  (select id from t_x where who = 'ga'), '아빠', true, true, false);
set local request.jwt.claims to '{"sub":"b5555555-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}';
insert into t_x (who, id) values ('gb', public.create_group('B네', '비'));
reset role;

-- 각 그룹에 완료 묶음 하나씩
insert into public.posts (id, sender_id, status) values
  ('00000000-0000-0000-0000-0000000005a1', 'a5555555-0000-0000-0000-000000000001', 'ready'),
  ('00000000-0000-0000-0000-0000000005b1', 'b5555555-0000-0000-0000-000000000002', 'ready');
insert into public.post_groups (post_id, group_id) values
  ('00000000-0000-0000-0000-0000000005a1', (select id from t_x where who = 'ga')),
  ('00000000-0000-0000-0000-0000000005b1', (select id from t_x where who = 'gb'));

-- ── N (익명) ─────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"c5555555-0000-0000-0000-000000000003","role":"authenticated","is_anonymous":true}';

select is(public.is_anonymous_user(), true, '익명 로그인이면 is_anonymous_user()가 참');
select is((select count(*) from public.posts)::int, 0, '합류 전 익명 사용자는 사진 묶음을 하나도 못 본다');
select throws_ok($$select public.create_group('익명네', '나')$$,
  'P0001', 'anonymous_not_allowed', '익명 사용자는 그룹을 만들 수 없다');

select is((public.redeem_invite((select code from t_x where who = 'inv'))) ->> 'status', 'ok',
  '익명 사용자도 유효한 숫자로 합류한다');
select is((select easy_mode from public.profiles where id = 'c5555555-0000-0000-0000-000000000003'), true,
  '쉬운 화면 태그가 없는 초대여도 익명 사용자는 쉬운 화면으로 열린다');
select is((select count(*) from public.posts where id = '00000000-0000-0000-0000-0000000005a1')::int, 1,
  '합류한 그룹의 사진은 보인다');
select is((select count(*) from public.posts where id = '00000000-0000-0000-0000-0000000005b1')::int, 0,
  '다른 그룹 사진은 보이지 않는다');
select is((select count(*) from public.members where group_id = (select id from t_x where who = 'gb'))::int, 0,
  '다른 그룹 구성원은 보이지 않는다');
select throws_ok(
  $$select public.create_invite((select id from t_x where who = 'ga'), '삼촌', false, false, false)$$,
  'P0001', 'forbidden', '관리자가 아닌 익명 사용자는 초대를 만들 수 없다');
select throws_ok(
  $$update public.profiles set easy_mode = false where id = 'c5555555-0000-0000-0000-000000000003'$$,
  'P0001', 'anonymous_easy_only', '익명 사용자는 쉬운 화면을 끌 수 없다');

-- 관리자 태그가 붙은 초대로 들어와도 익명 사용자는 초대·재발급을 못 한다
select is((public.redeem_invite((select code from t_x where who = 'inv2'))) ->> 'status', 'ok',
  '이미 그 그룹 구성원이면 바로 ok');
reset role;
update public.members set is_admin = true
 where user_id = 'c5555555-0000-0000-0000-000000000003';
set local role authenticated;
set local request.jwt.claims to '{"sub":"c5555555-0000-0000-0000-000000000003","role":"authenticated","is_anonymous":true}';
select throws_ok(
  $$select public.create_invite((select id from t_x where who = 'ga'), '삼촌', false, false, false)$$,
  'P0001', 'anonymous_not_allowed', '관리자 태그가 있어도 익명 사용자는 초대를 만들 수 없다');
select throws_ok(
  $$select public.reissue_invite((select id from t_x where who = 'inv2'))$$,
  'P0001', 'anonymous_not_allowed', '익명 사용자는 초대를 재발급할 수 없다');

-- ── M (익명, 틀린 숫자) ──────────────────────────────────
set local request.jwt.claims to '{"sub":"d5555555-0000-0000-0000-000000000004","role":"authenticated","is_anonymous":true}';
select public.redeem_invite('000000') from generate_series(1, 5);
select is((public.redeem_invite((select code from t_x where who = 'inv2'))) ->> 'status', 'too_many_attempts',
  '같은 익명 계정으로 5번 틀리면 맞는 숫자도 10분 동안 막힌다');
select is((select easy_mode from public.profiles where id = 'd5555555-0000-0000-0000-000000000004'), false,
  '합류하지 못한 익명 사용자는 쉬운 화면 표시가 켜지지 않는다');

-- ── A (계정): 쉬운 화면을 끌 수 있다 ─────────────────────
set local request.jwt.claims to '{"sub":"a5555555-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';
update public.profiles set easy_mode = true where id = 'a5555555-0000-0000-0000-000000000001';
update public.profiles set easy_mode = false where id = 'a5555555-0000-0000-0000-000000000001';
select is((select easy_mode from public.profiles where id = 'a5555555-0000-0000-0000-000000000001'), false,
  '계정이 있는 사람은 쉬운 화면을 끌 수 있다');

select * from finish();
rollback;
