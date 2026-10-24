-- 0013 관리자 사진 내리기 · 내보낼 때 사진도 지우기 테스트 (개발 7-4, F-LMXBXX)
-- 1) 다른 그룹 사용자·같은 그룹 일반 구성원·익명 관리자는 내릴 수 없다 (다른 그룹 사용자는 처음부터 못 본다)
-- 2) 관리자가 내리면: 내가 관리자인 그룹에만 보낸 묶음은 'deleting'(아무에게도 안 보임),
--    내가 관리자가 아닌 그룹에도 보낸 묶음은 내 그룹에서만 빠지고 그 그룹에는 남는다
-- 3) 내보내기 기본값은 사진을 남긴다. '사진도 지우기'면 이 그룹에만 보낸 묶음은 deleting, 다른 그룹에도 보낸 묶음은 이 그룹에서만 빠진다
-- 4) 일반 구성원은 내보낼 수 없다. 내린·지운 묶음은 새벽 정리 대상이 된다
-- 실행: supabase test db (로컬) / supabase test db --linked (원격, 마지막에 rollback)
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

-- A: G1·G2 관리자 / C: G1 구성원(G4 관리자) / D: G1·G2 구성원(G3 관리자) / X: G1 구성원 / B: 다른 그룹 GB 관리자
-- E: 익명, G1 구성원(관리자 태그)
insert into auth.users (id, email, raw_user_meta_data, is_anonymous) values
  ('a1313131-0000-0000-0000-000000000001', 'a@td.dev', '{}', false),
  ('b1313131-0000-0000-0000-000000000002', 'b@td.dev', '{}', false),
  ('c1313131-0000-0000-0000-000000000003', 'c@td.dev', '{}', false),
  ('d1313131-0000-0000-0000-000000000004', 'd@td.dev', '{}', false),
  ('e1313131-0000-0000-0000-000000000005', null, '{}', true),
  ('f1313131-0000-0000-0000-000000000006', 'x@td.dev', '{}', false);

create temp table t_g (who text primary key, id uuid);
grant all on t_g to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1313131-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';
insert into t_g values ('g1', public.create_group('전주 엄마네', '지은'));
insert into t_g values ('g2', public.create_group('대구 할머니네', '지은'));
set local request.jwt.claims to '{"sub":"b1313131-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}';
insert into t_g values ('gb', public.create_group('B네', '비'));
set local request.jwt.claims to '{"sub":"d1313131-0000-0000-0000-000000000004","role":"authenticated","is_anonymous":false}';
insert into t_g values ('g3', public.create_group('D 친구들', '민수'));
set local request.jwt.claims to '{"sub":"c1313131-0000-0000-0000-000000000003","role":"authenticated","is_anonymous":false}';
insert into t_g values ('g4', public.create_group('C 회사', '아빠'));
reset role;

insert into public.members (group_id, user_id, display_name, is_admin, joined_at) values
  ((select id from t_g where who = 'g1'), 'c1313131-0000-0000-0000-000000000003', '아빠', false, now() + interval '1 minute'),
  ((select id from t_g where who = 'g1'), 'd1313131-0000-0000-0000-000000000004', '민수', false, now() + interval '2 minutes'),
  ((select id from t_g where who = 'g2'), 'd1313131-0000-0000-0000-000000000004', '민수', false, now() + interval '2 minutes'),
  ((select id from t_g where who = 'g1'), 'e1313131-0000-0000-0000-000000000005', '엄마', true,  now() + interval '3 minutes'),
  ((select id from t_g where who = 'g1'), 'f1313131-0000-0000-0000-000000000006', '삼촌', false, now() + interval '4 minutes');

-- 묶음: c1(C, G1만), c2(C, G1+G4), c3(C, G1만, 내보내기용), d1(D, G1+G2), d2(D, G1+G3), x1(X, G1만)
insert into public.posts (id, sender_id, status) values
  ('00000000-0000-0000-0000-0000000013c1', 'c1313131-0000-0000-0000-000000000003', 'ready'),
  ('00000000-0000-0000-0000-0000000013c2', 'c1313131-0000-0000-0000-000000000003', 'ready'),
  ('00000000-0000-0000-0000-0000000013c3', 'c1313131-0000-0000-0000-000000000003', 'ready'),
  ('00000000-0000-0000-0000-0000000013d1', 'd1313131-0000-0000-0000-000000000004', 'ready'),
  ('00000000-0000-0000-0000-0000000013d2', 'd1313131-0000-0000-0000-000000000004', 'ready'),
  ('00000000-0000-0000-0000-0000000013f1', 'f1313131-0000-0000-0000-000000000006', 'ready');
insert into public.post_groups (post_id, group_id) values
  ('00000000-0000-0000-0000-0000000013c1', (select id from t_g where who = 'g1')),
  ('00000000-0000-0000-0000-0000000013c2', (select id from t_g where who = 'g1')),
  ('00000000-0000-0000-0000-0000000013c2', (select id from t_g where who = 'g4')),
  ('00000000-0000-0000-0000-0000000013c3', (select id from t_g where who = 'g1')),
  ('00000000-0000-0000-0000-0000000013d1', (select id from t_g where who = 'g1')),
  ('00000000-0000-0000-0000-0000000013d1', (select id from t_g where who = 'g2')),
  ('00000000-0000-0000-0000-0000000013d2', (select id from t_g where who = 'g1')),
  ('00000000-0000-0000-0000-0000000013d2', (select id from t_g where who = 'g3')),
  ('00000000-0000-0000-0000-0000000013f1', (select id from t_g where who = 'g1'));

set local role authenticated;

-- ── 내릴 수 없는 사람 ───────────────────────────────────────────
set local request.jwt.claims to '{"sub":"b1313131-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}';
select is((select count(*) from public.posts)::int, 0, '다른 그룹 사용자는 G1 사진을 하나도 못 본다');
select throws_ok($$select public.take_down_post('00000000-0000-0000-0000-0000000013c1')$$,
  'P0001', 'forbidden', '다른 그룹 관리자는 G1 사진을 내릴 수 없다');
select throws_ok($$select public.remove_member(
    (select id from public.members where user_id = 'c1313131-0000-0000-0000-000000000003' limit 1), true)$$,
  'P0001', 'not_member', '다른 그룹 사용자는 G1 구성원을 내보낼 수 없다 (구성원이 보이지도 않음)');

set local request.jwt.claims to '{"sub":"d1313131-0000-0000-0000-000000000004","role":"authenticated","is_anonymous":false}';
select throws_ok($$select public.take_down_post('00000000-0000-0000-0000-0000000013c1')$$,
  'P0001', 'forbidden', 'G1 일반 구성원은 남의 사진을 내릴 수 없다');
select throws_ok($$select public.remove_member(
    (select id from public.members where user_id = 'c1313131-0000-0000-0000-000000000003'
        and group_id = (select id from t_g where who = 'g1')), true)$$,
  'P0001', 'forbidden', 'G1 일반 구성원은 내보낼 수 없다');

set local request.jwt.claims to '{"sub":"e1313131-0000-0000-0000-000000000005","role":"authenticated","is_anonymous":true}';
select throws_ok($$select public.take_down_post('00000000-0000-0000-0000-0000000013c1')$$,
  'P0001', 'anonymous_not_allowed', '가입 없이 쓰는 사람은 관리자 태그가 있어도 내릴 수 없다');

-- ── 관리자 A가 내린다 ──────────────────────────────────────────
set local request.jwt.claims to '{"sub":"a1313131-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';
select is(public.take_down_post('00000000-0000-0000-0000-0000000013c1')->>'removed', 'post',
  'G1에만 보낸 아빠 사진을 내리면 묶음이 통째로 내려간다');
select is((select count(*) from public.posts where id = '00000000-0000-0000-0000-0000000013c1' and status = 'ready')::int, 0,
  '내린 사진은 더 이상 완료 상태가 아니다 (목록에 안 보임)');
select is(public.take_down_post('00000000-0000-0000-0000-0000000013d1')->>'removed', 'post',
  '내가 관리자인 G1·G2에만 보낸 사진도 통째로 내려간다');
select is(public.take_down_post('00000000-0000-0000-0000-0000000013d2')->>'removed', 'groups',
  '내가 관리자가 아닌 G3에도 보낸 사진은 내 그룹에서만 빠진다');
select is((select count(*) from public.posts where id = '00000000-0000-0000-0000-0000000013d2')::int, 0,
  'G1에서 빠진 사진은 A에게 더 이상 안 보인다');
select throws_ok($$select public.take_down_post('00000000-0000-0000-0000-0000000013c1')$$,
  'P0001', 'not_found', '이미 내린 사진은 다시 내릴 수 없다');

set local request.jwt.claims to '{"sub":"d1313131-0000-0000-0000-000000000004","role":"authenticated","is_anonymous":false}';
select is((select status from public.posts where id = '00000000-0000-0000-0000-0000000013d2'), 'ready',
  'G3에는 민수 사진이 그대로 남는다');
select is((select count(*) from public.post_groups where post_id = '00000000-0000-0000-0000-0000000013d2')::int, 1,
  'G3 연결만 남는다');

-- ── 내보내기 ─────────────────────────────────────────────────
set local request.jwt.claims to '{"sub":"a1313131-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';
select lives_ok($$select public.remove_member(
    (select id from public.members where user_id = 'f1313131-0000-0000-0000-000000000006'))$$,
  '사진 여부를 안 넘기면(기본값) 삼촌을 내보낸다');
reset role;
select is((select status from public.posts where id = '00000000-0000-0000-0000-0000000013f1'), 'ready',
  '기본값으로 내보내면 삼촌 사진은 그대로 남는다');
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1313131-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';
select lives_ok($$select public.remove_member(
    (select id from public.members where user_id = 'c1313131-0000-0000-0000-000000000003'
        and group_id = (select id from t_g where who = 'g1')), true)$$,
  '사진도 지우기로 아빠를 내보낸다');
reset role;
select is((select status from public.posts where id = '00000000-0000-0000-0000-0000000013c3'), 'deleting',
  'G1에만 보낸 아빠 사진은 지우는 중이 된다');
select ok((select status = 'ready' and not exists (
             select 1 from public.post_groups where post_id = p.id and group_id = (select id from t_g where who = 'g1'))
             and exists (
             select 1 from public.post_groups where post_id = p.id and group_id = (select id from t_g where who = 'g4'))
           from public.posts p where p.id = '00000000-0000-0000-0000-0000000013c2'),
  'G4에도 보낸 아빠 사진은 G1에서만 빠지고 G4에는 남는다');

-- ── 새벽 정리가 내린·지운 사진을 고른다 ─────────────────────────
set local role service_role;
select is((select array_agg(post_id::text order by post_id) from public.cleanup_take_posts()),
  array['00000000-0000-0000-0000-0000000013c1', '00000000-0000-0000-0000-0000000013c3',
        '00000000-0000-0000-0000-0000000013d1'],
  '내린 사진과 내보내며 지운 사진은 새벽 정리가 파일과 함께 지운다');
reset role;

select * from finish();
rollback;
