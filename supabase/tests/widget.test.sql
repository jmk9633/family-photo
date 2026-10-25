-- 0014 홈 화면 위젯 테스트 (개발 8-1, F-NGOJFO)
-- 1) 앱(로그인 사용자)은 남의 열쇠를 못 보고, 열쇠 값(key_hash)은 내 것도 못 보고, 표를 직접 못 고친다. widget_feed는 못 부른다
-- 2) 열쇠는 로그인한 사람만 만든다(가입 없이 쓰는 익명 포함). 한 사람에 5개까지, 지우면 바로 못 쓴다
-- 3) 새 사진 = 내가 안 본 남의 완료 묶음 중 가장 최근 (장 수 포함). 없으면 남이 보낸 최근, 그것도 없으면 내 것
-- 4) 다른 그룹 사용자의 사진은 보이지 않는다. 지우는 중·올리는 중 묶음, 나간 가족의 사진도 보이지 않는다
-- 5) 위젯이 읽어도 '봤어요'(post_views)와 활동 시각(last_active_at)은 바뀌지 않는다
-- 실행: supabase test db (로컬) / supabase test db --linked (원격, 마지막에 rollback)
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

-- A: G1 관리자(지은) / M: 익명 엄마, G1 구성원 / B: 다른 그룹 GB 관리자 / K: 계정, 그룹 없음
insert into auth.users (id, email, raw_user_meta_data, is_anonymous) values
  ('a1414141-0000-0000-0000-000000000001', 'a@wg.dev', '{}', false),
  ('b1414141-0000-0000-0000-000000000002', 'b@wg.dev', '{}', false),
  ('c1414141-0000-0000-0000-000000000003', null, '{}', true),
  ('d1414141-0000-0000-0000-000000000004', 'k@wg.dev', '{}', false);

create temp table t_g (who text primary key, id uuid);
create temp table t_k (who text primary key, k text);
grant all on t_g, t_k to authenticated, service_role, anon;

set local role authenticated;
set local request.jwt.claims to '{"sub":"a1414141-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';
insert into t_g values ('g1', public.create_group('전주 엄마네', '지은'));
set local request.jwt.claims to '{"sub":"b1414141-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}';
insert into t_g values ('gb', public.create_group('B네', '비'));
reset role;

insert into public.members (group_id, user_id, display_name, joined_at) values
  ((select id from t_g where who = 'g1'), 'c1414141-0000-0000-0000-000000000003', '엄마', now() + interval '1 minute');

-- 열쇠 만들기 (A, B, M, K)
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1414141-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';
insert into t_k values ('a', public.create_widget_key() ->> 'key');
set local request.jwt.claims to '{"sub":"b1414141-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}';
insert into t_k values ('b', public.create_widget_key() ->> 'key');
set local request.jwt.claims to '{"sub":"c1414141-0000-0000-0000-000000000003","role":"authenticated","is_anonymous":true}';
insert into t_k values ('m', public.create_widget_key() ->> 'key');
set local request.jwt.claims to '{"sub":"d1414141-0000-0000-0000-000000000004","role":"authenticated","is_anonymous":false}';
insert into t_k values ('k', public.create_widget_key() ->> 'key');
reset role;

select ok((select k from t_k where who = 'a') ~ '^[0-9a-f]{64}$', '열쇠는 64자리 16진수');
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1414141-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';
insert into t_k values ('a2', public.create_widget_key() ->> 'id');
select is((select count(*)::int from public.widget_keys where id = (select k from t_k where who = 'a2')::uuid), 1,
  '앱은 돌려받은 id로 내 열쇠가 아직 있는지 확인할 수 있다');
reset role;
select ok((select k from t_k where who = 'm') ~ '^[0-9a-f]{64}$', '가입 없이 쓰는 익명 사용자도 열쇠를 만든다');
select is((select count(*)::int from public.widget_keys k join t_k t on k.key_hash = encode(digest(t.k, 'sha256'), 'hex')), 4,
  'DB에는 열쇠 원문이 아니라 SHA-256 값이 들어간다');
select is((select count(*)::int from public.widget_keys k join t_k t on k.key_hash = t.k), 0, '열쇠 원문은 저장하지 않는다');

-- ── 1) 앱 권한 ─────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1414141-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';
select is((select count(*)::int from public.widget_keys), 2, '앱은 내 열쇠 행만 본다 (다른 그룹 사용자 B의 열쇠는 안 보임)');
select is((select count(*)::int from public.widget_keys where user_id = 'b1414141-0000-0000-0000-000000000002'), 0,
  '다른 그룹 사용자의 열쇠 행은 읽을 수 없다');
select throws_ok($$ select key_hash from public.widget_keys $$, '42501', null, '내 열쇠라도 열쇠 값은 읽을 수 없다');
select throws_ok($$ insert into public.widget_keys (user_id, key_hash) values ('a1414141-0000-0000-0000-000000000001', 'x') $$,
  '42501', null, '열쇠 표에 직접 넣을 수 없다');
select throws_ok($$ delete from public.widget_keys $$, '42501', null, '열쇠 표를 직접 지울 수 없다');
select throws_ok($$ select public.widget_feed((select k from t_k where who = 'a')) $$, '42501', null,
  '앱은 widget_feed를 부를 수 없다 (Edge Function 전용)');
reset role;

set local role anon;
select throws_ok($$ select public.create_widget_key() $$, '42501', null, '로그인 안 한 사람은 열쇠를 못 만든다');
select throws_ok($$ select public.widget_feed('0000000000000000000000000000000000000000000000000000000000000000') $$,
  '42501', null, '로그인 안 한 사람도 widget_feed를 부를 수 없다');
reset role;

-- ── 2) 열쇠 상태별 응답 ─────────────────────────────────
set local role service_role;
select is(public.widget_feed('not-a-key') ->> 'status', 'invalid', '열쇠 모양이 아니면 invalid');
select is(public.widget_feed(repeat('0', 64)) ->> 'status', 'invalid', '없는 열쇠면 invalid');
select is(public.widget_feed((select k from t_k where who = 'k')) ->> 'status', 'no_group', '연결된 가족이 없으면 no_group');
select is(public.widget_feed((select k from t_k where who = 'm')) ->> 'status', 'empty', '가족에 사진이 없으면 empty');
reset role;

-- ── 3) 새 사진 고르기 ──────────────────────────────────
-- p1: A가 2시간 전 2장 / p2: A가 1시간 전 1장(영상 한마디) / p_up: 올리는 중(가장 최근) / p_del: 지우는 중 / pb: B가 다른 그룹에 방금
insert into public.posts (id, sender_id, kind, title, status, created_at) values
  ('00000000-0000-0000-0000-000000014a01', 'a1414141-0000-0000-0000-000000000001', 'normal', '처음으로 혼자 걸었어요!', 'ready', now() - interval '2 hours'),
  ('00000000-0000-0000-0000-000000014a02', 'a1414141-0000-0000-0000-000000000001', 'video_message', null, 'ready', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000014a03', 'a1414141-0000-0000-0000-000000000001', 'normal', null, 'uploading', now() - interval '1 minute'),
  ('00000000-0000-0000-0000-000000014a04', 'a1414141-0000-0000-0000-000000000001', 'normal', null, 'deleting', now() - interval '2 minutes'),
  ('00000000-0000-0000-0000-000000014a05', 'b1414141-0000-0000-0000-000000000002', 'normal', 'B네 사진', 'ready', now());
insert into public.post_groups (post_id, group_id) values
  ('00000000-0000-0000-0000-000000014a01', (select id from t_g where who = 'g1')),
  ('00000000-0000-0000-0000-000000014a02', (select id from t_g where who = 'g1')),
  ('00000000-0000-0000-0000-000000014a03', (select id from t_g where who = 'g1')),
  ('00000000-0000-0000-0000-000000014a04', (select id from t_g where who = 'g1')),
  ('00000000-0000-0000-0000-000000014a05', (select id from t_g where who = 'gb'));
insert into public.media (post_id, type, path, thumb_path, sort_order) values
  ('00000000-0000-0000-0000-000000014a01', 'photo', 'posts/14a01/b.jpg', 'posts/14a01/b_thumb.jpg', 1),
  ('00000000-0000-0000-0000-000000014a01', 'photo', 'posts/14a01/a.jpg', 'posts/14a01/a_thumb.jpg', 0),
  ('00000000-0000-0000-0000-000000014a02', 'video', 'posts/14a02/v.mp4', 'posts/14a02/v_thumb.jpg', 0),
  ('00000000-0000-0000-0000-000000014a03', 'photo', 'posts/14a03/u.jpg', 'posts/14a03/u_thumb.jpg', 0),
  ('00000000-0000-0000-0000-000000014a04', 'photo', 'posts/14a04/d.jpg', 'posts/14a04/d_thumb.jpg', 0),
  ('00000000-0000-0000-0000-000000014a05', 'photo', 'posts/14a05/x.jpg', 'posts/14a05/x_thumb.jpg', 0);

-- 엄마의 활동 시각·봤어요 기록을 위젯 읽기 전에 적어 둔다
update public.profiles set last_active_at = now() - interval '4 days' where id = 'c1414141-0000-0000-0000-000000000003';
create temp table t_before as
  select (select last_active_at from public.profiles where id = 'c1414141-0000-0000-0000-000000000003') as active,
         (select count(*) from public.post_views) as views;
grant all on t_before to service_role;

create temp table t_feed (n int primary key, f jsonb);
grant all on t_feed to service_role;
set local role service_role;
insert into t_feed values (1, public.widget_feed((select k from t_k where who = 'm')));
reset role;

select is((select f ->> 'post_id' from t_feed where n = 1), '00000000-0000-0000-0000-000000014a02',
  '새 사진: 안 본 남의 완료 묶음 중 가장 최근 (올리는 중·지우는 중 묶음, 다른 그룹 묶음은 아님)');
select is((select f ->> 'is_new' from t_feed where n = 1), 'true', '새 사진이면 is_new');
select is((select (f ->> 'count')::int from t_feed where n = 1), 1, '''새 사진 N장''은 그 묶음의 장 수');
select is((select f ->> 'kind' from t_feed where n = 1), 'video_message', '영상 한마디는 kind로 알려준다');
select is((select f ->> 'thumb_path' from t_feed where n = 1), 'posts/14a02/v_thumb.jpg', '영상은 대표 프레임(썸네일)');
select is((select f ->> 'sender_name' from t_feed where n = 1), '지은', '보낸 사람 이름은 그 가족에서의 이름');
select is((select f ->> 'media_type' from t_feed where n = 1), 'video', '첫 장 종류');

-- ── 5) 위젯이 읽어도 활동·봤어요가 바뀌지 않는다 ──────────
select is((select last_active_at from public.profiles where id = 'c1414141-0000-0000-0000-000000000003'),
  (select active from t_before), '위젯이 읽어도 활동 시각(last_active_at)은 그대로 (안부 판단에 안 셈)');
select is((select count(*) from public.post_views), (select views from t_before), '위젯이 읽어도 ''봤어요'' 기록은 생기지 않는다');

-- 엄마가 p2를 보면 다음 새 묶음 p1 (첫 장은 정렬 순서 0번, 장 수 2)
insert into public.post_views (post_id, user_id) values ('00000000-0000-0000-0000-000000014a02', 'c1414141-0000-0000-0000-000000000003');
set local role service_role;
insert into t_feed values (2, public.widget_feed((select k from t_k where who = 'm')));
reset role;
select is((select f ->> 'post_id' from t_feed where n = 2), '00000000-0000-0000-0000-000000014a01', '하나를 보면 다음 새 묶음');
select is((select (f ->> 'count')::int || ' ' || (f ->> 'thumb_path') from t_feed where n = 2), '2 posts/14a01/a_thumb.jpg',
  '장 수 2, 첫 장은 정렬 순서 맨 앞');

-- 다 보면 새 사진 없음 → 남이 보낸 가장 최근 묶음, is_new false
insert into public.post_views (post_id, user_id) values ('00000000-0000-0000-0000-000000014a01', 'c1414141-0000-0000-0000-000000000003');
set local role service_role;
insert into t_feed values (3, public.widget_feed((select k from t_k where who = 'm')));
insert into t_feed values (4, public.widget_feed((select k from t_k where who = 'a')));
insert into t_feed values (5, public.widget_feed((select k from t_k where who = 'b')));
reset role;
select is((select (f ->> 'post_id') || ' ' || (f ->> 'is_new') from t_feed where n = 3),
  '00000000-0000-0000-0000-000000014a02 false', '새 사진이 없으면 최근 사진 (새 사진 표시 없음)');
select is((select (f ->> 'post_id') || ' ' || (f ->> 'is_new') from t_feed where n = 4),
  '00000000-0000-0000-0000-000000014a02 false', '남이 보낸 사진이 없으면 내가 보낸 최근 사진 (내 사진은 새 사진이 아님)');
select is((select f ->> 'post_id' from t_feed where n = 5), '00000000-0000-0000-0000-000000014a05',
  '다른 그룹 사용자 B에게는 B 가족의 사진만 (G1 사진은 안 보임)');

-- ── 4) 가족을 나가면 그 가족 사진은 안 보인다 ──────────────
update public.members set status = 'left', left_at = now()
where user_id = 'c1414141-0000-0000-0000-000000000003';
set local role service_role;
select is(public.widget_feed((select k from t_k where who = 'm')) ->> 'status', 'no_group', '가족을 나가면 no_group');
reset role;

-- ── 2) 지우기·개수 제한 ─────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1414141-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';
select public.revoke_widget_key((select k from t_k where who = 'b'));  -- 남의 열쇠는 못 지운다
select public.revoke_widget_key((select k from t_k where who = 'a'));
reset role;
set local role service_role;
select is(public.widget_feed((select k from t_k where who = 'a')) ->> 'status', 'invalid', '지운 열쇠는 바로 못 쓴다');
select is(public.widget_feed((select k from t_k where who = 'b')) ->> 'status', 'ok', '남의 열쇠는 지워지지 않는다');
reset role;

set local role authenticated;
set local request.jwt.claims to '{"sub":"d1414141-0000-0000-0000-000000000004","role":"authenticated","is_anonymous":false}';
select public.create_widget_key() from generate_series(1, 6);
reset role;
select is((select count(*)::int from public.widget_keys where user_id = 'd1414141-0000-0000-0000-000000000004'), 5,
  '한 사람에 열쇠는 최근 5개까지');
set local role service_role;
select is(public.widget_feed((select k from t_k where who = 'k')) ->> 'status', 'invalid', '밀려난 오래된 열쇠는 못 쓴다');
reset role;

select * from finish();
rollback;
