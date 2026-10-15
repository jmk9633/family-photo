-- 0002 앨범 집계 함수 테스트
-- 1) 다른 그룹 사용자는 남의 그룹 ID를 넘겨도 아무것도 세지 못한다
-- 2) 여러 그룹에 보낸 묶음은 한 번만, 올리는 중인 묶음은 세지 않는다, 월은 한국 시간
-- 실행: supabase test db (로컬) / supabase test db --linked (원격, 마지막에 rollback)
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- A: 그룹 둘(G1, G2), B: 자기 그룹(GB)
insert into auth.users (id, email, raw_user_meta_data) values
  ('a1111111-1111-1111-1111-111111111111', 'a@album.dev', '{}'),
  ('b2222222-2222-2222-2222-222222222222', 'b@album.dev', '{}');

create temp table t_g (who text primary key, id uuid);
grant all on t_g to authenticated;

set local role authenticated;
set local request.jwt.claims to '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}';
insert into t_g values ('g1', public.create_group('전주 엄마네', '막내'));
insert into t_g values ('g2', public.create_group('대구 시댁', '문기'));
set local request.jwt.claims to '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}';
insert into t_g values ('gb', public.create_group('B네', '비'));
reset role;

-- 묶음 (보낸 시각은 앱이 못 바꾸므로 소유자 권한으로 직접 넣는다)
-- p1: A, 10월 5일, G1+G2, 사진 2장, #추석
-- p2: A, 9월 30일 23:30 KST (= UTC 9월 30일 14:30) → 9월, G1, 사진 1장, #추석 #여행
-- p3: A, 10월 1일 00:30 KST (= UTC 9월 30일 15:30) → 10월, G2, 사진 3장, 태그 없음
-- p4: A, 올리는 중, G1 → 세지 않음
-- pb: B, GB, 사진 1장, #추석
insert into public.posts (id, sender_id, status, tags, created_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'a1111111-1111-1111-1111-111111111111', 'ready',     '{추석}',      '2026-10-05 03:00+00'),
  ('00000000-0000-0000-0000-0000000000a2', 'a1111111-1111-1111-1111-111111111111', 'ready',     '{추석,여행}', '2026-09-30 14:30+00'),
  ('00000000-0000-0000-0000-0000000000a3', 'a1111111-1111-1111-1111-111111111111', 'ready',     '{}',          '2026-09-30 15:30+00'),
  ('00000000-0000-0000-0000-0000000000a4', 'a1111111-1111-1111-1111-111111111111', 'uploading', '{추석}',      '2026-10-06 03:00+00'),
  ('00000000-0000-0000-0000-0000000000b1', 'b2222222-2222-2222-2222-222222222222', 'ready',     '{추석}',      '2026-10-05 03:00+00');
insert into public.post_groups (post_id, group_id) values
  ('00000000-0000-0000-0000-0000000000a1', (select id from t_g where who = 'g1')),
  ('00000000-0000-0000-0000-0000000000a1', (select id from t_g where who = 'g2')),
  ('00000000-0000-0000-0000-0000000000a2', (select id from t_g where who = 'g1')),
  ('00000000-0000-0000-0000-0000000000a3', (select id from t_g where who = 'g2')),
  ('00000000-0000-0000-0000-0000000000a4', (select id from t_g where who = 'g1')),
  ('00000000-0000-0000-0000-0000000000b1', (select id from t_g where who = 'gb'));
insert into public.media (post_id, type, path, thumb_path, sort_order) values
  ('00000000-0000-0000-0000-0000000000a1', 'photo', 'p/a1/1.jpg', 'p/a1/1_thumb.jpg', 0),
  ('00000000-0000-0000-0000-0000000000a1', 'photo', 'p/a1/2.jpg', 'p/a1/2_thumb.jpg', 1),
  ('00000000-0000-0000-0000-0000000000a2', 'photo', 'p/a2/1.jpg', 'p/a2/1_thumb.jpg', 0),
  ('00000000-0000-0000-0000-0000000000a3', 'photo', 'p/a3/1.jpg', 'p/a3/1_thumb.jpg', 0),
  ('00000000-0000-0000-0000-0000000000a3', 'photo', 'p/a3/2.jpg', 'p/a3/2_thumb.jpg', 1),
  ('00000000-0000-0000-0000-0000000000a3', 'photo', 'p/a3/3.jpg', 'p/a3/3_thumb.jpg', 2),
  ('00000000-0000-0000-0000-0000000000a4', 'photo', 'p/a4/1.jpg', 'p/a4/1_thumb.jpg', 0),
  ('00000000-0000-0000-0000-0000000000b1', 'photo', 'p/b1/1.jpg', 'p/b1/1_thumb.jpg', 0);

-- ── A로 로그인 ────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}';
create temp view v_all as select array_agg(id) as ids from t_g where who in ('g1', 'g2');

select results_eq(
  $$select month, post_count, media_count, cover_thumb
      from public.album_months((select ids from v_all))$$,
  $$values ('2026-10-01'::date, 2, 5, 'p/a1/1_thumb.jpg'),
           ('2026-09-01'::date, 1, 1, 'p/a2/1_thumb.jpg')$$,
  '모든 가족: 두 그룹에 보낸 묶음은 한 번만, 올리는 중은 빼고, 월은 한국 시간');
select results_eq(
  $$select month, post_count, media_count
      from public.album_months(array[(select id from t_g where who = 'g1')])$$,
  $$values ('2026-10-01'::date, 1, 2), ('2026-09-01'::date, 1, 1)$$,
  '한 그룹만 고르면 그 그룹 묶음만 센다');
select is(
  (select cover_thumb from public.album_months(array[(select id from t_g where who = 'g2')])),
  'p/a1/1_thumb.jpg', '대표 사진은 그 달 가장 최근 묶음의 첫 장');
select is(
  (select count(*) from public.album_months('{}'::uuid[]))::int, 0,
  '그룹을 하나도 넘기지 않으면 빈 결과');

select results_eq(
  $$select sender_id, post_count, media_count from public.album_senders((select ids from v_all))$$,
  $$values ('a1111111-1111-1111-1111-111111111111'::uuid, 3, 6)$$,
  '보낸 사람별: 내 묶음 3개 6장 (올리는 중 제외)');

select results_eq(
  $$select tag, post_count, media_count from public.album_tags((select ids from v_all))$$,
  $$values ('추석'::text, 2, 3), ('여행'::text, 1, 1)$$,
  '태그별: 많이 쓴 순, 올리는 중인 묶음의 태그는 세지 않는다');

-- A가 B의 그룹 ID를 넘겨도 아무것도 없다
select is(
  (select count(*) from public.album_months(array[(select id from t_g where who = 'gb')]))::int, 0,
  'A는 B 그룹 ID를 넘겨도 월별 집계를 못 본다');

-- ── B로 로그인: A 그룹 ID를 넘겨도 아무것도 세지 못한다 ──────────
set local request.jwt.claims to '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select count(*) from public.album_months((select ids from v_all)))::int, 0,
  'B는 A 그룹의 월별 집계를 못 본다');
select is((select count(*) from public.album_senders((select ids from v_all)))::int, 0,
  'B는 A 그룹의 보낸 사람별 집계를 못 본다');
select is((select count(*) from public.album_tags((select ids from v_all)))::int, 0,
  'B는 A 그룹의 태그별 집계를 못 본다');
select results_eq(
  $$select tag, post_count from public.album_tags(
      array[(select id from t_g where who = 'gb')] || (select ids from v_all))$$,
  $$values ('추석'::text, 1)$$,
  'B가 자기 그룹과 A 그룹을 섞어 넘겨도 자기 그룹 것만 센다');

-- ── 로그인하지 않은 사용자(anon)는 부를 수 없다 ───────────────────
reset role;
set local role anon;
select throws_ok($$select * from public.album_months('{}'::uuid[])$$,  '42501', null, 'anon은 album_months를 부를 수 없다');
select throws_ok($$select * from public.album_senders('{}'::uuid[])$$, '42501', null, 'anon은 album_senders를 부를 수 없다');
select throws_ok($$select * from public.album_tags('{}'::uuid[])$$,    '42501', null, 'anon은 album_tags를 부를 수 없다');

select * from finish();
rollback;
