-- 0015 위젯 바로 바꾸기 신호 테스트 (개발 8-2, F-NGOJFO)
-- 1) 앱(로그인 사용자)은 신호 주소를 못 읽고, 신호 함수들을 못 부른다
-- 2) 신호 주소는 맞는 위젯 열쇠로만 저장된다. 모양이 이상하면 저장하지 않는다. 같은 주소는 마지막 열쇠에만 남는다
-- 3) 받을 위젯: 묶음을 받은 그룹의 활성 구성원(보낸 사람 제외). 다른 그룹 사용자·나간 사람·완료 안 된 묶음은 아님
-- 4) 신호 주소 저장·받을 위젯 고르기는 '봤어요'·활동 시각을 바꾸지 않는다
-- 실행: supabase test db (로컬) / supabase test db --linked (원격, 마지막에 rollback)
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

-- A: G1 관리자(보내는 사람) / M: 익명 엄마, G1 / D: G1 구성원(나감) / B: 다른 그룹 GB
insert into auth.users (id, email, raw_user_meta_data, is_anonymous) values
  ('a1515151-0000-0000-0000-000000000001', 'a@wp.dev', '{}', false),
  ('b1515151-0000-0000-0000-000000000002', 'b@wp.dev', '{}', false),
  ('c1515151-0000-0000-0000-000000000003', null, '{}', true),
  ('d1515151-0000-0000-0000-000000000004', 'd@wp.dev', '{}', false);

create temp table t_g (who text primary key, id uuid);
create temp table t_k (who text primary key, k text);
grant all on t_g, t_k to authenticated, service_role, anon;

set local role authenticated;
set local request.jwt.claims to '{"sub":"a1515151-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';
insert into t_g values ('g1', public.create_group('전주 엄마네', '지은'));
insert into t_k values ('a', public.create_widget_key() ->> 'key');
set local request.jwt.claims to '{"sub":"b1515151-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}';
insert into t_g values ('gb', public.create_group('B네', '비'));
insert into t_k values ('b', public.create_widget_key() ->> 'key');
reset role;

insert into public.members (group_id, user_id, display_name) values
  ((select id from t_g where who = 'g1'), 'c1515151-0000-0000-0000-000000000003', '엄마'),
  ((select id from t_g where who = 'g1'), 'd1515151-0000-0000-0000-000000000004', '아빠');

set local role authenticated;
set local request.jwt.claims to '{"sub":"c1515151-0000-0000-0000-000000000003","role":"authenticated","is_anonymous":true}';
insert into t_k values ('m', public.create_widget_key() ->> 'key');
insert into t_k values ('m2', public.create_widget_key() ->> 'key');  -- 같은 엄마의 다른 폰(또는 다시 깐 앱)
set local request.jwt.claims to '{"sub":"d1515151-0000-0000-0000-000000000004","role":"authenticated","is_anonymous":false}';
insert into t_k values ('d', public.create_widget_key() ->> 'key');
reset role;

update public.profiles set last_active_at = now() - interval '4 days' where id = 'c1515151-0000-0000-0000-000000000003';
create temp table t_before as
  select (select last_active_at from public.profiles where id = 'c1515151-0000-0000-0000-000000000003') as active,
         (select count(*) from public.post_views) as views;
grant all on t_before to service_role;

-- ── 2) 신호 주소 저장 ──────────────────────────────────
create temp table t_r (n text primary key, r text);
grant all on t_r to service_role;
set local role service_role;
insert into t_r values ('a', public.set_widget_push_token((select k from t_k where who = 'a'), repeat('a1', 32), 'sandbox'));
insert into t_r values ('m', public.set_widget_push_token((select k from t_k where who = 'm'), repeat('c3', 32), 'sandbox'));
insert into t_r values ('b', public.set_widget_push_token((select k from t_k where who = 'b'), repeat('b2', 32), 'production'));
insert into t_r values ('d', public.set_widget_push_token((select k from t_k where who = 'd'), repeat('d4', 32), 'sandbox'));
insert into t_r values ('nokey', public.set_widget_push_token(repeat('0', 64), repeat('e5', 32), 'sandbox'));
insert into t_r values ('badtoken', public.set_widget_push_token((select k from t_k where who = 'm'), 'not hex!', 'sandbox'));
insert into t_r values ('badenv', public.set_widget_push_token((select k from t_k where who = 'm'), repeat('c3', 32), 'staging'));
reset role;

select is((select r from t_r where n = 'm'), 'ok', '맞는 열쇠면 신호 주소를 저장한다 (가입 없이 쓰는 엄마도)');
select is((select r from t_r where n = 'nokey'), 'invalid', '없는 열쇠로는 저장하지 않는다');
select is((select r from t_r where n = 'badtoken'), 'invalid', '신호 주소 모양이 이상하면 저장하지 않는다');
select is((select r from t_r where n = 'badenv'), 'invalid', '환경 값이 sandbox·production이 아니면 저장하지 않는다');
select is((select count(*)::int from public.widget_keys where push_token = repeat('c3', 32) and push_env = 'sandbox'), 1,
  '이상한 값이 와도 저장된 신호 주소는 그대로');

-- ── 1) 앱 권한 ─────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"c1515151-0000-0000-0000-000000000003","role":"authenticated","is_anonymous":true}';
select throws_ok($$ select push_token from public.widget_keys $$, '42501', null, '앱은 내 위젯의 신호 주소도 읽을 수 없다');
select throws_ok($$ select public.set_widget_push_token((select k from t_k where who = 'm'), repeat('ff', 32), 'sandbox') $$,
  '42501', null, '앱은 신호 주소를 직접 저장할 수 없다');
select throws_ok($$ select * from public.widget_push_targets('00000000-0000-0000-0000-000000015a01') $$,
  '42501', null, '앱은 받을 위젯 목록을 볼 수 없다');
select throws_ok($$ select public.clear_widget_push_token(repeat('a1', 32)) $$, '42501', null, '앱은 신호 주소를 지울 수 없다');
reset role;

-- ── 3) 받을 위젯 고르기 ─────────────────────────────────
insert into public.posts (id, sender_id, status) values
  ('00000000-0000-0000-0000-000000015a01', 'a1515151-0000-0000-0000-000000000001', 'ready'),
  ('00000000-0000-0000-0000-000000015a02', 'a1515151-0000-0000-0000-000000000001', 'uploading'),
  ('00000000-0000-0000-0000-000000015a03', 'c1515151-0000-0000-0000-000000000003', 'ready');
insert into public.post_groups (post_id, group_id)
select p, (select id from t_g where who = 'g1') from unnest(array[
  '00000000-0000-0000-0000-000000015a01', '00000000-0000-0000-0000-000000015a02', '00000000-0000-0000-0000-000000015a03']::uuid[]) p;

create temp table t_t (n text, push_token text, push_env text);
grant all on t_t to service_role;
set local role service_role;
insert into t_t select 'p1', * from public.widget_push_targets('00000000-0000-0000-0000-000000015a01');
insert into t_t select 'up', * from public.widget_push_targets('00000000-0000-0000-0000-000000015a02');
insert into t_t select 'pm', * from public.widget_push_targets('00000000-0000-0000-0000-000000015a03');
reset role;

select is((select array_agg(push_token order by push_token) from t_t where n = 'p1'),
  array[repeat('c3', 32), repeat('d4', 32)], '받을 위젯: 그 가족의 다른 구성원(엄마·아빠), 보낸 사람(지은) 제외');
select is((select count(*)::int from t_t where n = 'p1' and push_token = repeat('b2', 32)), 0,
  '다른 그룹 사용자의 위젯에는 보내지 않는다');
select is((select count(*)::int from t_t where n = 'up'), 0, '완료되지 않은(올리는 중) 묶음은 보내지 않는다');
select is((select array_agg(push_token order by push_token) from t_t where n = 'pm'),
  array[repeat('a1', 32), repeat('d4', 32)], '엄마가 보내면 지은·아빠의 위젯에 (엄마 자신 제외)');

-- 아빠가 가족을 나가면 받지 않는다
update public.members set status = 'left', left_at = now() where user_id = 'd1515151-0000-0000-0000-000000000004';
set local role service_role;
select is((select array_agg(push_token) from public.widget_push_targets('00000000-0000-0000-0000-000000015a01')),
  array[repeat('c3', 32)], '나간 사람의 위젯에는 보내지 않는다');

-- 같은 신호 주소가 엄마의 새 열쇠로 오면 예전 열쇠에서는 지워진다 (중복 신호 없음)
select public.set_widget_push_token((select k from t_k where who = 'm2'), repeat('c3', 32), 'sandbox');
reset role;
select is((select count(*)::int from public.widget_keys where push_token = repeat('c3', 32)), 1,
  '같은 신호 주소는 마지막 열쇠 하나에만 남는다');

-- 애플이 없는 주소라고 하면 지운다
set local role service_role;
select public.clear_widget_push_token(repeat('c3', 32));
reset role;
select is((select count(*)::int from public.widget_keys where push_token = repeat('c3', 32)), 0, '없는 주소는 지운다');

-- ── 4) 활동·봤어요 아님 ─────────────────────────────────
select is((select last_active_at from public.profiles where id = 'c1515151-0000-0000-0000-000000000003'),
  (select active from t_before), '신호 주소 저장·받을 위젯 고르기는 활동 시각을 바꾸지 않는다');
select is((select count(*) from public.post_views), (select views from t_before), '''봤어요'' 기록도 생기지 않는다');

select * from finish();
rollback;
