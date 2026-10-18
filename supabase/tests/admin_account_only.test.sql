-- 0008 관리자는 계정이 있는 사람에게만 테스트
-- 1) 계정 관리자가 나가면 익명보다 늦게 들어왔어도 계정 구성원에게 넘어간다
-- 2) 계정이 있는 사람이 없으면 넘기지 않는다 (익명은 관리자가 되지 않는다)
-- 3) leave_warning: 남는 사람이 모두 익명일 때만 경고, 구성원이 아니면(다른 그룹 사용자) 못 부른다
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

-- A: 관리자(계정), N1·N2: 익명(먼저 들어옴), C: 계정(늦게), B: 다른 그룹
insert into auth.users (id, email, raw_user_meta_data, is_anonymous) values
  ('a8888888-0000-0000-0000-000000000001', 'a@ao.dev', '{}', false),
  ('b8888888-0000-0000-0000-000000000002', 'b@ao.dev', '{}', false),
  ('c8888888-0000-0000-0000-000000000003', 'c@ao.dev', '{}', false),
  ('d8888888-0000-0000-0000-000000000004', null, '{}', true),
  ('e8888888-0000-0000-0000-000000000005', null, '{}', true);

create temp table t_g (who text primary key, id uuid);
grant all on t_g to authenticated;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a8888888-0000-0000-0000-000000000001","role":"authenticated"}';
insert into t_g values ('g1', public.create_group('전주 엄마네', '막내'));
insert into t_g values ('g2', public.create_group('대구 할머니네', '막내'));
set local request.jwt.claims to '{"sub":"b8888888-0000-0000-0000-000000000002","role":"authenticated"}';
insert into t_g values ('gb', public.create_group('B네', '비'));
reset role;

-- G1: 익명 N1(+1분), 계정 C(+5분) / G2: 익명 N1·N2만
insert into public.members (group_id, user_id, display_name, joined_at) values
  ((select id from t_g where who = 'g1'), 'd8888888-0000-0000-0000-000000000004', '엄마', now() + interval '1 minute'),
  ((select id from t_g where who = 'g1'), 'c8888888-0000-0000-0000-000000000003', '형', now() + interval '5 minutes'),
  ((select id from t_g where who = 'g2'), 'd8888888-0000-0000-0000-000000000004', '엄마', now() + interval '1 minute'),
  ((select id from t_g where who = 'g2'), 'e8888888-0000-0000-0000-000000000005', '아빠', now() + interval '2 minutes');

set local role authenticated;
set local request.jwt.claims to '{"sub":"a8888888-0000-0000-0000-000000000001","role":"authenticated"}';
select is((public.leave_warning((select id from t_g where who = 'g1'))) ->> 'no_manager', 'false',
  '계정 있는 사람이 남으면 경고하지 않는다');
select is((public.leave_warning((select id from t_g where who = 'g2'))) ->> 'no_manager', 'true',
  '남는 사람이 모두 익명이면 경고한다');
set local request.jwt.claims to '{"sub":"b8888888-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select public.leave_warning((select id from t_g where who = 'g1'))$$,
  'P0001', 'not_member', '다른 그룹 사용자는 경고를 물어볼 수 없다');
select is((public.leave_warning((select id from t_g where who = 'gb'))) ->> 'no_manager', 'false',
  '혼자인 그룹은 남는 사람이 없어 경고하지 않는다 (나가면 보관)');

set local request.jwt.claims to '{"sub":"a8888888-0000-0000-0000-000000000001","role":"authenticated"}';
select public.leave_group((select id from t_g where who = 'g1'));
select public.leave_group((select id from t_g where who = 'g2'));
reset role;

select is((select is_admin from public.members where user_id = 'c8888888-0000-0000-0000-000000000003'), true,
  '익명보다 늦게 들어왔어도 계정이 있는 구성원이 관리자가 된다');
select is((select is_admin from public.members where user_id = 'd8888888-0000-0000-0000-000000000004'
           and group_id = (select id from t_g where who = 'g1')), false, 'G1의 익명 엄마는 관리자가 되지 않는다');
select is((select count(*) from public.members where group_id = (select id from t_g where who = 'g2') and is_admin and status = 'active')::int, 0,
  '계정 있는 사람이 없으면 관리자를 넘기지 않는다');
select is((select status from public.groups where id = (select id from t_g where who = 'g2')), 'active',
  '익명 구성원이 남아 있으면 그룹은 계속 쓰인다 (보기·보내기)');

select * from finish();
rollback;
