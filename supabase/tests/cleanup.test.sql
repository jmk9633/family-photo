-- 0012 새벽 정리 작업 테스트 (개발 7-3)
-- 1) 앱(로그인 사용자)은 정리 기록을 못 보고 정리 함수를 못 부른다. 다른 그룹 사용자는 남의 묶음을 못 본다
-- 2) 지우는 중(deleting)인 묶음은 앱이 다시 '완료'로 못 바꾼다 (올리는 중 → 완료는 그대로 된다)
-- 3) start_cleanup: 90일 지난 초대·하루 지난 숫자 시도 기록을 지우고 일회용 표를 만든다. 표는 한 번만, 10분 안에만 쓸 수 있다
-- 4) 지울 묶음: 24시간 넘은 '올리는 중'과 'deleting'만 (방금 올리는 중·완료된 묶음은 아님). 완료된 묶음은 지우지 않는다
-- 5) 주인 없는 파일 폴더: 묶음 기록이 없고 24시간 지난 것만
-- 6) 지울 익명 계정: 한 번도 연결 못 한 채 7일 지난 것만 (나갔·내보내진 익명, 7일 안, 계정 있는 사람, TV, 보낸 묶음이 남은 사람은 아님)
-- 실행: supabase test db (로컬) / supabase test db --linked (원격, 마지막에 rollback)
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

-- A: G1 관리자(계정) / B: 다른 그룹 GB 관리자 / M: 익명, 8일 전, 연결 못 함 / N: 익명, 3일 전, 연결 못 함
-- R: 익명, 8일 전, 연결했다가 내보내짐 / S: 익명, 8일 전, 연결 못 함 + 올리다 만 묶음 / T: 익명 TV, 8일 전 / K: 계정, 8일 전, 그룹 없음
insert into auth.users (id, email, raw_user_meta_data, is_anonymous, created_at) values
  ('a1212121-0000-0000-0000-000000000001', 'a@cl.dev', '{}', false, now() - interval '30 days'),
  ('b1212121-0000-0000-0000-000000000002', 'b@cl.dev', '{}', false, now() - interval '30 days'),
  ('c1212121-0000-0000-0000-000000000003', null, '{}', true, now() - interval '8 days'),
  ('d1212121-0000-0000-0000-000000000004', null, '{}', true, now() - interval '3 days'),
  ('e1212121-0000-0000-0000-000000000005', null, '{}', true, now() - interval '8 days'),
  ('f1212121-0000-0000-0000-000000000006', null, '{}', true, now() - interval '8 days'),
  ('a2121212-0000-0000-0000-000000000007', null, '{}', true, now() - interval '8 days'),
  ('b2121212-0000-0000-0000-000000000008', 'k@cl.dev', '{}', false, now() - interval '8 days');

create temp table t_g (who text primary key, id uuid);
grant all on t_g to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1212121-0000-0000-0000-000000000001","role":"authenticated"}';
insert into t_g values ('g1', public.create_group('전주 엄마네', '막내'));
set local request.jwt.claims to '{"sub":"b1212121-0000-0000-0000-000000000002","role":"authenticated"}';
insert into t_g values ('gb', public.create_group('B네', '비'));
reset role;

-- R은 들어왔다가 내보내졌다
insert into public.members (group_id, user_id, display_name, status, left_at) values
  ((select id from t_g where who = 'g1'), 'e1212121-0000-0000-0000-000000000005', '아빠', 'removed', now() - interval '1 day');
-- T는 TV로 G1에 연결돼 있다
insert into public.devices (id, user_id, kind, platform) values
  ('00000000-0000-0000-0000-00000000c0d1', 'a2121212-0000-0000-0000-000000000007', 'tv', 'tizen');
insert into public.device_groups (device_id, group_id) values
  ('00000000-0000-0000-0000-00000000c0d1', (select id from t_g where who = 'g1'));

-- 묶음: p_old(올리는 중, 25시간 전), p_new(올리는 중, 2시간 전), p_ready(완료, 30일 전),
--       p_del(지우는 중), p_del2(지우는 중, 앱이 지울 것), p_s(S의 올리는 중, 8일 전)
insert into public.posts (id, sender_id, status, created_at) values
  ('00000000-0000-0000-0000-000000012a01', 'a1212121-0000-0000-0000-000000000001', 'uploading', now() - interval '25 hours'),
  ('00000000-0000-0000-0000-000000012a02', 'a1212121-0000-0000-0000-000000000001', 'uploading', now() - interval '2 hours'),
  ('00000000-0000-0000-0000-000000012a03', 'a1212121-0000-0000-0000-000000000001', 'ready',     now() - interval '30 days'),
  ('00000000-0000-0000-0000-000000012a04', 'a1212121-0000-0000-0000-000000000001', 'deleting',  now() - interval '30 days'),
  ('00000000-0000-0000-0000-000000012a05', 'a1212121-0000-0000-0000-000000000001', 'deleting',  now() - interval '30 days'),
  ('00000000-0000-0000-0000-000000012a06', 'f1212121-0000-0000-0000-000000000006', 'uploading', now() - interval '8 days');
insert into public.post_groups (post_id, group_id)
select p, (select id from t_g where who = 'g1') from unnest(array[
  '00000000-0000-0000-0000-000000012a03', '00000000-0000-0000-0000-000000012a04']::uuid[]) p;
insert into public.media (id, post_id, type, path, thumb_path) values
  ('00000000-0000-0000-0000-000000012b01', '00000000-0000-0000-0000-000000012a01', 'photo',
   'posts/00000000-0000-0000-0000-000000012a01/00000000-0000-0000-0000-000000012b01.jpg',
   'posts/00000000-0000-0000-0000-000000012a01/00000000-0000-0000-0000-000000012b01_thumb.jpg');

-- 저장소 파일: 묶음 있는 폴더 2개 + 주인 없는 폴더(2일 전, 1시간 전)
insert into storage.objects (bucket_id, name, created_at) values
  ('media', 'posts/00000000-0000-0000-0000-000000012a01/00000000-0000-0000-0000-000000012b01.jpg', now() - interval '25 hours'),
  ('media', 'posts/00000000-0000-0000-0000-000000012a03/x.jpg', now() - interval '30 days'),
  ('media', 'posts/00000000-0000-0000-0000-0000000fff01/x.jpg', now() - interval '2 days'),
  ('media', 'posts/00000000-0000-0000-0000-0000000fff01/x_thumb.jpg', now() - interval '2 days'),
  ('media', 'posts/00000000-0000-0000-0000-0000000fff02/x.jpg', now() - interval '1 hour');

-- 초대 기록: 91일 전(지울 것), 어제(남길 것) / 숫자 시도: 2일 전(지울 것), 방금(남길 것)
insert into public.invites (group_id, code, created_by, expires_at, created_at) values
  ((select id from t_g where who = 'g1'), '901201', 'a1212121-0000-0000-0000-000000000001', now() - interval '85 days', now() - interval '91 days'),
  ((select id from t_g where who = 'g1'), '901202', 'a1212121-0000-0000-0000-000000000001', now() + interval '4 days', now() - interval '1 day');
insert into public.invite_attempts (user_id, attempted_at) values
  ('c1212121-0000-0000-0000-000000000003', now() - interval '2 days'),
  ('c1212121-0000-0000-0000-000000000003', now());

-- ── 앱(로그인 사용자)에서는 ────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"b1212121-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*) from public.posts where sender_id = 'a1212121-0000-0000-0000-000000000001')::int, 0,
  '다른 그룹 사용자는 A의 묶음(올리는 중·지우는 중·완료)을 하나도 못 본다');
select throws_ok($$select count(*) from public.cleanup_runs$$, '42501', null, '정리 기록은 앱이 못 본다');
select throws_ok($$select public.start_cleanup()$$, '42501', null, '앱은 정리를 시작할 수 없다');
select throws_ok($$select public.claim_cleanup(gen_random_uuid())$$, '42501', null, '앱은 정리 표를 쓸 수 없다');
select throws_ok($$select * from public.cleanup_take_posts()$$, '42501', null, '앱은 지울 묶음을 고를 수 없다');
select throws_ok($$select public.cleanup_finish_posts(array['00000000-0000-0000-0000-000000012a03'::uuid])$$,
  '42501', null, '앱은 정리 함수로 묶음을 지울 수 없다');
select throws_ok($$select * from public.cleanup_anonymous_targets()$$, '42501', null, '앱은 익명 계정 목록을 못 본다');

set local request.jwt.claims to '{"sub":"a1212121-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
  $$update public.posts set status = 'ready' where id = '00000000-0000-0000-0000-000000012a04'$$,
  'P0001', 'post_deleting', '지우는 중인 묶음은 보낸 사람도 다시 완료로 못 바꾼다');
select lives_ok(
  $$update public.posts set status = 'ready' where id = '00000000-0000-0000-0000-000000012a02'$$,
  '올리는 중 → 완료는 그대로 된다');
update public.posts set status = 'uploading' where id = '00000000-0000-0000-0000-000000012a02';   -- 되돌려 둔다
select lives_ok(
  $$delete from public.posts where id = '00000000-0000-0000-0000-000000012a05'$$,
  '지우는 중인 내 묶음은 앱이 지울 수 있다 (그룹 나가기 뒤 deleteMyPost)');
reset role;

-- ── 새벽 정리 시작 (pg_cron = postgres) ──────────────────────────
insert into t_g values ('token', public.start_cleanup());
select is((select count(*) from public.cleanup_runs)::int, 1, '시작하면 일회용 표가 하나 생긴다');
select is((select array_agg(code order by code) from public.invites), array['901202'],
  '90일 지난 초대 기록만 지운다');
select is((select count(*) from public.invite_attempts)::int, 1, '하루 지난 숫자 시도 기록만 지운다');

-- ── Edge Function (service role) ────────────────────────────────
set local role service_role;
select ok(not public.claim_cleanup(gen_random_uuid()), '없는 표로는 정리할 수 없다');
select ok(public.claim_cleanup((select id from t_g where who = 'token')), '방금 만든 표로 정리를 시작한다');
select ok(not public.claim_cleanup((select id from t_g where who = 'token')), '같은 표는 두 번 못 쓴다');
reset role;
insert into public.cleanup_runs (started_at) values (now() - interval '11 minutes');
set local role service_role;
select ok(not public.claim_cleanup((select token from public.cleanup_runs where claimed_at is null)),
  '10분 지난 표는 쓸 수 없다');

create temp table t_take as select * from public.cleanup_take_posts();
select is((select array_agg(post_id::text order by post_id) from t_take),
  array['00000000-0000-0000-0000-000000012a01', '00000000-0000-0000-0000-000000012a04',
        '00000000-0000-0000-0000-000000012a06'],
  '24시간 넘은 올리는 중(A·S)과 지우는 중만 고른다 (2시간 전 올리는 중·완료는 아님)');
select is((select status from public.posts where id = '00000000-0000-0000-0000-000000012a01'), 'deleting',
  '고른 올리는 중 묶음은 지우는 중으로 바뀐다');
select is((select status from public.posts where id = '00000000-0000-0000-0000-000000012a02'), 'uploading',
  '2시간 전 올리는 중 묶음은 그대로');
reset role;

-- 정리 사이에 앱의 다시 보내기가 완료로 바꾸려 해도 막힌다
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1212121-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
  $$update public.posts set status = 'ready' where id = '00000000-0000-0000-0000-000000012a01'$$,
  'P0001', 'post_deleting', '정리 중인 묶음은 다시 보내기가 완료로 못 바꾼다');
reset role;

set local role service_role;
select is((select array_agg(folder) from public.cleanup_orphan_folders()),
  array['00000000-0000-0000-0000-0000000fff01'],
  '묶음 기록 없이 24시간 지난 파일 폴더만 고른다');
select is((select array_agg(user_id::text) from public.cleanup_anonymous_targets()),
  array['c1212121-0000-0000-0000-000000000003'],
  '연결 못 한 채 7일 지난 익명 계정만 (S는 올리다 만 묶음이 남아 있어 아직 아님)');

select is(public.cleanup_finish_posts(array(
    select post_id from t_take union all select '00000000-0000-0000-0000-000000012a03'::uuid)), 3,
  '고른 세 묶음만 지운다 (완료된 묶음 id를 섞어 넣어도 지우지 않는다)');
select is((select status from public.posts where id = '00000000-0000-0000-0000-000000012a03'), 'ready',
  '완료된 묶음은 그대로 남는다');
select is((select count(*) from public.media where post_id = '00000000-0000-0000-0000-000000012a01')::int, 0,
  '묶음을 지우면 사진 기록도 함께 지워진다');
select is((select array_agg(user_id::text order by user_id) from public.cleanup_anonymous_targets()),
  array['c1212121-0000-0000-0000-000000000003', 'f1212121-0000-0000-0000-000000000006'],
  '올리다 만 묶음이 지워지면 S도 지울 대상이 된다 (R·N·T·K는 계속 아님)');

do $$ begin perform public.finish_cleanup((select id from t_g where who = 'token'), '{"posts":3}'); end $$;
reset role;
select is((select result->>'posts' from public.cleanup_runs where token = (select id from t_g where who = 'token')), '3',
  '정리 결과가 기록된다');

-- 30일 지난 정리 기록은 다음 시작 때 지운다
update public.cleanup_runs set started_at = now() - interval '31 days';
do $$ begin perform public.start_cleanup(); end $$;
select is((select count(*) from public.cleanup_runs)::int, 1, '30일 지난 정리 기록은 지운다');

select * from finish();
rollback;
