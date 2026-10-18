-- 0007 그룹 나가기와 내보내기 테스트
-- 1) 나가면 그 그룹 사진·구성원을 못 보고, 올린 사진은 남는다 (다른 그룹 사용자는 처음부터 못 본다)
-- 2) '내 사진도 지우기': 이 그룹에만 보낸 묶음은 deleting(아무에게도 안 보임), 다른 그룹에도 보낸 묶음은 이 그룹에서만 빠진다
-- 3) 관리자가 나가면 가장 먼저 들어온 구성원이 관리자가 되고 기록이 남는다, 마지막 한 명이 나가면 보관
-- 4) 내보내기는 그 그룹 관리자만, 본인·익명·다른 그룹 관리자는 못 한다. 내보내진 사람은 못 본다
-- 실행: supabase test db (로컬) / supabase test db --linked (원격, 마지막에 rollback)
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

-- A: G1 관리자, C·D: G1 구성원(먼저 C), B: 다른 그룹(GB) 관리자, N: 익명 관리자(G1)
insert into auth.users (id, email, raw_user_meta_data, is_anonymous) values
  ('a7777777-0000-0000-0000-000000000001', 'a@lr.dev', '{}', false),
  ('b7777777-0000-0000-0000-000000000002', 'b@lr.dev', '{}', false),
  ('c7777777-0000-0000-0000-000000000003', 'c@lr.dev', '{}', false),
  ('d7777777-0000-0000-0000-000000000004', 'd@lr.dev', '{}', false),
  ('e7777777-0000-0000-0000-000000000005', null, '{}', true);

create temp table t_g (who text primary key, id uuid);
grant all on t_g to authenticated;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a7777777-0000-0000-0000-000000000001","role":"authenticated"}';
insert into t_g values ('g1', public.create_group('전주 엄마네', '막내'));
insert into t_g values ('g2', public.create_group('대구 할머니네', '막내'));
set local request.jwt.claims to '{"sub":"b7777777-0000-0000-0000-000000000002","role":"authenticated"}';
insert into t_g values ('gb', public.create_group('B네', '비'));
reset role;

insert into public.members (group_id, user_id, display_name, joined_at) values
  ((select id from t_g where who = 'g1'), 'c7777777-0000-0000-0000-000000000003', '엄마', now() + interval '1 minute'),
  ((select id from t_g where who = 'g1'), 'd7777777-0000-0000-0000-000000000004', '아빠', now() + interval '2 minutes'),
  ((select id from t_g where who = 'g2'), 'c7777777-0000-0000-0000-000000000003', '엄마', now() + interval '1 minute'),
  ((select id from t_g where who = 'g1'), 'e7777777-0000-0000-0000-000000000005', '이모', now() + interval '3 minutes');

-- A가 보낸 묶음: p1(G1만), p2(G1+G2), C가 보낸 묶음: pc(G1만)
insert into public.posts (id, sender_id, status) values
  ('00000000-0000-0000-0000-0000000007a1', 'a7777777-0000-0000-0000-000000000001', 'ready'),
  ('00000000-0000-0000-0000-0000000007a2', 'a7777777-0000-0000-0000-000000000001', 'ready'),
  ('00000000-0000-0000-0000-0000000007c1', 'c7777777-0000-0000-0000-000000000003', 'ready');
insert into public.post_groups (post_id, group_id) values
  ('00000000-0000-0000-0000-0000000007a1', (select id from t_g where who = 'g1')),
  ('00000000-0000-0000-0000-0000000007a2', (select id from t_g where who = 'g1')),
  ('00000000-0000-0000-0000-0000000007a2', (select id from t_g where who = 'g2')),
  ('00000000-0000-0000-0000-0000000007c1', (select id from t_g where who = 'g1'));

set local role authenticated;

-- ── 내보내기 ─────────────────────────────────────────────
set local request.jwt.claims to '{"sub":"c7777777-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok(
  $$select public.remove_member((select id from public.members where user_id = 'd7777777-0000-0000-0000-000000000004'))$$,
  'P0001', 'forbidden', '관리자가 아니면 내보낼 수 없다');
set local request.jwt.claims to '{"sub":"b7777777-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok(
  $$select public.remove_member('00000000-0000-0000-0000-000000000000')$$,
  'P0001', 'not_member', '없는 구성원은 내보낼 수 없다');
select is((select count(*) from public.members where group_id = (select id from t_g where who = 'g1'))::int, 0,
  '다른 그룹 관리자는 G1 구성원을 보지도 못한다');
set local request.jwt.claims to '{"sub":"a7777777-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
  $$select public.remove_member((select id from public.members where user_id = 'a7777777-0000-0000-0000-000000000001' and group_id = (select id from t_g where who = 'g1')))$$,
  'P0001', 'use_leave', '관리자도 자기 자신은 내보낼 수 없다 (나가기로)');
reset role;
update public.members set is_admin = true where user_id = 'e7777777-0000-0000-0000-000000000005';
set local role authenticated;
set local request.jwt.claims to '{"sub":"e7777777-0000-0000-0000-000000000005","role":"authenticated","is_anonymous":true}';
select throws_ok(
  $$select public.remove_member((select id from public.members where user_id = 'd7777777-0000-0000-0000-000000000004'))$$,
  'P0001', 'anonymous_not_allowed', '익명 사용자는 관리자 태그가 있어도 내보낼 수 없다');
set local request.jwt.claims to '{"sub":"a7777777-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok(
  $$select public.remove_member((select id from public.members where user_id = 'd7777777-0000-0000-0000-000000000004'))$$,
  '관리자는 다른 구성원을 내보낼 수 있다');
select is((select status from public.members where user_id = 'd7777777-0000-0000-0000-000000000004'), 'removed',
  '내보낸 구성원은 removed');
set local request.jwt.claims to '{"sub":"d7777777-0000-0000-0000-000000000004","role":"authenticated"}';
select is((select count(*) from public.posts)::int, 0, '내보내진 사람은 그룹 사진을 볼 수 없다');
select throws_ok($$select public.leave_group((select id from t_g where who = 'g1'))$$,
  'P0001', 'not_member', '이미 나간 사람은 다시 나갈 수 없다');

-- ── C가 나가기 (사진은 남긴다) ───────────────────────────
set local request.jwt.claims to '{"sub":"c7777777-0000-0000-0000-000000000003","role":"authenticated"}';
select is((public.leave_group((select id from t_g where who = 'g1'))) -> 'deleting', '[]'::jsonb,
  '사진을 남기고 나가면 지울 묶음이 없다');
select is((select count(*) from public.posts where id = '00000000-0000-0000-0000-0000000007a1')::int, 0,
  '나간 사람은 그 그룹 사진을 볼 수 없다');
select is((select count(*) from public.posts where id = '00000000-0000-0000-0000-0000000007a2')::int, 1,
  'G2에도 있는 묶음은 G2 구성원으로서 계속 본다');
set local request.jwt.claims to '{"sub":"a7777777-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select status from public.posts where id = '00000000-0000-0000-0000-0000000007c1'), 'ready',
  '나간 사람이 올린 사진은 그룹에 남는다');

-- ── A(유일한 관리자)가 내 사진도 지우고 나가기 ───────────
select set_eq(
  $$select jsonb_array_elements_text(public.leave_group((select id from t_g where who = 'g1'), true) -> 'deleting')$$,
  $$values ('00000000-0000-0000-0000-0000000007a1')$$,
  '이 그룹에만 보낸 내 묶음만 지울 목록으로 돌려준다');
select is((select status from public.posts where id = '00000000-0000-0000-0000-0000000007a1'), 'deleting',
  '보낸 사람은 지우는 중인 묶음을 아직 본다 (앱이 파일과 함께 지울 수 있게)');
select is((select array_agg(group_id) from public.post_groups where post_id = '00000000-0000-0000-0000-0000000007a2'),
  array[(select id from t_g where who = 'g2')], '다른 그룹에도 보낸 묶음은 G1에서만 빠진다');
select lives_ok($$delete from public.posts where id = '00000000-0000-0000-0000-0000000007a1'$$,
  '보낸 사람은 나간 뒤에도 자기 묶음을 지울 수 있다');
reset role;
select is((select is_admin from public.members where user_id = 'e7777777-0000-0000-0000-000000000005'), true,
  '남은 관리자(익명 이모)가 있으면 그대로');
select is((select count(*) from public.admin_transfer_log)::int, 0, '관리자가 남아 있으면 이전 기록이 없다');

-- 이모도 나가면 남은 사람이 없다 → 보관
set local role authenticated;
set local request.jwt.claims to '{"sub":"e7777777-0000-0000-0000-000000000005","role":"authenticated","is_anonymous":true}';
select public.leave_group((select id from t_g where who = 'g1'));
reset role;
select is((select status from public.groups where id = (select id from t_g where who = 'g1')), 'archived',
  '마지막 한 명이 나가면 그룹은 보관된다');

-- G2: A(관리자)가 나가면 C가 관리자가 되고 기록이 남는다
set local role authenticated;
set local request.jwt.claims to '{"sub":"a7777777-0000-0000-0000-000000000001","role":"authenticated"}';
select public.leave_group((select id from t_g where who = 'g2'));
reset role;
select is((select is_admin from public.members where user_id = 'c7777777-0000-0000-0000-000000000003' and group_id = (select id from t_g where who = 'g2')), true,
  '관리자가 0명이 되면 가장 먼저 들어온 구성원이 관리자가 된다');
select is((select count(*) from public.admin_transfer_log where group_id = (select id from t_g where who = 'g2'))::int, 1,
  '관리자 이전이 기록된다 (알림 한 번용)');

select * from finish();
rollback;
