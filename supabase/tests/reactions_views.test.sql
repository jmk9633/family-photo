-- 0003 하트·'봤어요' 테스트
-- 1) 다른 그룹 사용자는 하트·시청을 읽지도 넣지도 못한다
-- 2) 하트는 같은 그룹 구성원 누구나 본다, '봤어요'는 보낸 사람(과 본인)만 본다
-- 3) 시청 표시를 끈 사람은 보낸 사람에게도 안 보인다, 시청 날짜는 서버가 오늘로 정한다
-- 4) 하트·시청은 활동 시각(last_active_at)을 갱신한다
-- 실행: supabase test db (로컬) / supabase test db --linked (원격, 마지막에 rollback)
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

-- A: 보낸 사람, C·D: 같은 그룹(G1) 구성원, B: 다른 그룹(GB)
insert into auth.users (id, email, raw_user_meta_data) values
  ('a1111111-1111-1111-1111-111111111111', 'a@rv.dev', '{}'),
  ('b2222222-2222-2222-2222-222222222222', 'b@rv.dev', '{}'),
  ('c3333333-3333-3333-3333-333333333333', 'c@rv.dev', '{}'),
  ('d4444444-4444-4444-4444-444444444444', 'd@rv.dev', '{}');

create temp table t_g (who text primary key, id uuid);
grant all on t_g to authenticated;

set local role authenticated;
set local request.jwt.claims to '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}';
insert into t_g values ('g1', public.create_group('전주 엄마네', '막내'));
set local request.jwt.claims to '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}';
insert into t_g values ('gb', public.create_group('B네', '비'));
reset role;

-- C·D를 G1에 넣는다 (초대 과정은 rls_isolation 테스트가 본다)
insert into public.members (group_id, user_id, display_name) values
  ((select id from t_g where who = 'g1'), 'c3333333-3333-3333-3333-333333333333', '엄마'),
  ((select id from t_g where who = 'g1'), 'd4444444-4444-4444-4444-444444444444', '아빠');

-- pa: A가 G1에 보낸 완료 묶음 (사진 2장), pu: A가 올리는 중인 묶음
insert into public.posts (id, sender_id, status) values
  ('00000000-0000-0000-0000-0000000000a1', 'a1111111-1111-1111-1111-111111111111', 'ready'),
  ('00000000-0000-0000-0000-0000000000a9', 'a1111111-1111-1111-1111-111111111111', 'uploading');
insert into public.post_groups (post_id, group_id) values
  ('00000000-0000-0000-0000-0000000000a1', (select id from t_g where who = 'g1')),
  ('00000000-0000-0000-0000-0000000000a9', (select id from t_g where who = 'g1'));
insert into public.media (id, post_id, type, path, thumb_path, sort_order) values
  ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-0000000000a1', 'photo', 'p/a1/1.jpg', 'p/a1/1_thumb.jpg', 0),
  ('00000000-0000-0000-0000-00000000aa02', '00000000-0000-0000-0000-0000000000a1', 'photo', 'p/a1/2.jpg', 'p/a1/2_thumb.jpg', 1),
  ('00000000-0000-0000-0000-00000000aa09', '00000000-0000-0000-0000-0000000000a9', 'photo', 'p/a9/1.jpg', 'p/a9/1_thumb.jpg', 0);

select is((select last_active_at from public.profiles where id = 'c3333333-3333-3333-3333-333333333333'),
  null, '처음에는 C의 활동 시각이 없다');

-- ── C (같은 그룹) ─────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}';

select lives_ok(
  $$insert into public.reactions (media_id, user_id) values ('00000000-0000-0000-0000-00000000aa01', 'c3333333-3333-3333-3333-333333333333')$$,
  'C는 같은 그룹 사진에 하트를 누를 수 있다');
select throws_ok(
  $$insert into public.reactions (media_id, user_id) values ('00000000-0000-0000-0000-00000000aa01', 'c3333333-3333-3333-3333-333333333333')$$,
  '23505', null, '같은 사진에 하트를 또 넣으면 23505 (앱은 성공으로 처리)');
select throws_ok(
  $$insert into public.reactions (media_id, user_id) values ('00000000-0000-0000-0000-00000000aa02', 'd4444444-4444-4444-4444-444444444444')$$,
  '42501', null, 'C가 D 이름으로 하트를 넣을 수 없다');
select throws_ok(
  $$insert into public.reactions (media_id, user_id) values ('00000000-0000-0000-0000-00000000aa09', 'c3333333-3333-3333-3333-333333333333')$$,
  '42501', null, '올리는 중인 묶음에는 하트를 누를 수 없다');
select lives_ok(
  $$insert into public.post_views (post_id, user_id, viewed_on) values ('00000000-0000-0000-0000-0000000000a1', 'c3333333-3333-3333-3333-333333333333', '2020-01-01')$$,
  'C는 같은 그룹 묶음을 본 기록을 남길 수 있다');
select is((select viewed_on from public.post_views where user_id = 'c3333333-3333-3333-3333-333333333333'),
  (now() at time zone 'Asia/Seoul')::date, '앱이 다른 날짜를 넣어도 시청 날짜는 한국 시간 오늘');
select throws_ok(
  $$insert into public.post_views (post_id, user_id) values ('00000000-0000-0000-0000-0000000000a1', 'c3333333-3333-3333-3333-333333333333')$$,
  '23505', null, '같은 날 또 보면 23505 (하루 한 줄, 앱은 성공으로 처리)');

-- ── D (같은 그룹) ─────────────────────────────────────────────
set local request.jwt.claims to '{"sub":"d4444444-4444-4444-4444-444444444444","role":"authenticated"}';
insert into public.post_views (post_id, user_id) values ('00000000-0000-0000-0000-0000000000a1', 'd4444444-4444-4444-4444-444444444444');

select is((select count(*)::int from public.reactions), 1, 'D는 같은 그룹 구성원 C의 하트를 본다 (하트는 모두에게)');
select is((select array_agg(user_id::text) from public.post_views), array['d4444444-4444-4444-4444-444444444444'],
  'D는 C의 시청 기록을 못 보고 자기 기록만 본다 (봤어요는 보낸 사람에게만)');
delete from public.reactions where user_id = 'c3333333-3333-3333-3333-333333333333';
-- ── B (다른 그룹) ─────────────────────────────────────────────
set local request.jwt.claims to '{"sub":"b2222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is((select count(*)::int from public.reactions), 0, '다른 그룹 B는 하트를 읽을 수 없다');
select is((select count(*)::int from public.post_views), 0, '다른 그룹 B는 시청 기록을 읽을 수 없다');
select throws_ok(
  $$insert into public.reactions (media_id, user_id) values ('00000000-0000-0000-0000-00000000aa01', 'b2222222-2222-2222-2222-222222222222')$$,
  '42501', null, '다른 그룹 B는 하트를 누를 수 없다');
select throws_ok(
  $$insert into public.post_views (post_id, user_id) values ('00000000-0000-0000-0000-0000000000a1', 'b2222222-2222-2222-2222-222222222222')$$,
  '42501', null, '다른 그룹 B는 시청 기록을 남길 수 없다');

-- ── A (보낸 사람) ─────────────────────────────────────────────
set local request.jwt.claims to '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is((select count(*)::int from public.reactions), 1, 'D가 C의 하트를 지우려 해도 남아 있다 (본인 것만 취소)');
select is((select array_agg(user_id::text order by user_id) from public.post_views),
  array['c3333333-3333-3333-3333-333333333333', 'd4444444-4444-4444-4444-444444444444'],
  '보낸 사람 A는 C·D가 본 것을 본다');

-- D가 시청 표시를 끈다
set local request.jwt.claims to '{"sub":"d4444444-4444-4444-4444-444444444444","role":"authenticated"}';
update public.profiles set show_seen = false where id = 'd4444444-4444-4444-4444-444444444444';
set local request.jwt.claims to '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select array_agg(user_id::text) from public.post_views), array['c3333333-3333-3333-3333-333333333333'],
  '시청 표시를 끈 D는 보낸 사람에게도 안 보인다');

-- C가 자기 하트를 취소한다
set local request.jwt.claims to '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}';
delete from public.reactions where user_id = 'c3333333-3333-3333-3333-333333333333';
select is((select count(*)::int from public.reactions), 0, 'C는 자기 하트를 취소할 수 있다');
reset role;

select isnt((select last_active_at from public.profiles where id = 'c3333333-3333-3333-3333-333333333333'),
  null, '하트·시청을 하면 C의 활동 시각이 생긴다');
select isnt((select last_active_at from public.profiles where id = 'd4444444-4444-4444-4444-444444444444'),
  null, '시청 표시를 꺼도 D의 활동 시각은 남는다');

select * from finish();
rollback;
