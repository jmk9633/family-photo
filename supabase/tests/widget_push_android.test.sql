-- 0016 안드로이드 위젯 신호 주소 테스트 (개발 8-3-2, F-NGOJFO)
-- 1) Expo 신호 주소('ExponentPushToken[...]')는 'expo' 종류로만 저장된다. 모양이 이상하면 저장하지 않는다
-- 2) 애플 주소 규칙(0015)은 그대로다 (16진수만, sandbox·production)
-- 3) 받을 위젯 고르기는 안드로이드·아이폰을 함께 돌려주고, 다른 그룹 사용자·보낸 사람은 뺀다
-- 4) 앱은 신호 주소를 읽거나 저장할 수 없다 / 저장은 '봤어요'·활동 시각을 바꾸지 않는다
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

-- A: G1 관리자 지은(아이폰, 보내는 사람) / M: 익명 엄마(안드로이드), G1 / B: 다른 그룹 GB(안드로이드)
insert into auth.users (id, email, raw_user_meta_data, is_anonymous) values
  ('a1616161-0000-0000-0000-000000000001', 'a@wpa.dev', '{}', false),
  ('b1616161-0000-0000-0000-000000000002', 'b@wpa.dev', '{}', false),
  ('c1616161-0000-0000-0000-000000000003', null, '{}', true);

create temp table t_g (who text primary key, id uuid);
create temp table t_k (who text primary key, k text);
grant all on t_g, t_k to authenticated, service_role, anon;

set local role authenticated;
set local request.jwt.claims to '{"sub":"a1616161-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';
insert into t_g values ('g1', public.create_group('전주 엄마네', '지은'));
insert into t_k values ('a', public.create_widget_key() ->> 'key');
set local request.jwt.claims to '{"sub":"b1616161-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}';
insert into t_g values ('gb', public.create_group('B네', '비'));
insert into t_k values ('b', public.create_widget_key() ->> 'key');
reset role;

insert into public.members (group_id, user_id, display_name) values
  ((select id from t_g where who = 'g1'), 'c1616161-0000-0000-0000-000000000003', '엄마');

set local role authenticated;
set local request.jwt.claims to '{"sub":"c1616161-0000-0000-0000-000000000003","role":"authenticated","is_anonymous":true}';
insert into t_k values ('m', public.create_widget_key() ->> 'key');
insert into t_k values ('m2', public.create_widget_key() ->> 'key');  -- 엄마가 앱을 다시 깔았을 때
reset role;

update public.profiles set last_active_at = now() - interval '4 days' where id = 'c1616161-0000-0000-0000-000000000003';
create temp table t_before as
  select (select last_active_at from public.profiles where id = 'c1616161-0000-0000-0000-000000000003') as active,
         (select count(*) from public.post_views) as views;
grant all on t_before to service_role;

-- ── 1)·2) 저장 ───────────────────────────────────────
create temp table t_r (n text primary key, r text);
grant all on t_r to service_role;
set local role service_role;
insert into t_r values ('m', public.set_widget_push_token((select k from t_k where who = 'm'), 'ExponentPushToken[mOm_Android-1]', 'expo'));
insert into t_r values ('b', public.set_widget_push_token((select k from t_k where who = 'b'), 'ExponentPushToken[bBb2]', 'expo'));
insert into t_r values ('a', public.set_widget_push_token((select k from t_k where who = 'a'), repeat('a1', 32), 'sandbox'));
insert into t_r values ('expo_hex', public.set_widget_push_token((select k from t_k where who = 'm'), repeat('c3', 32), 'expo'));
insert into t_r values ('apns_expo', public.set_widget_push_token((select k from t_k where who = 'm'), 'ExponentPushToken[x]', 'sandbox'));
insert into t_r values ('bad_shape', public.set_widget_push_token((select k from t_k where who = 'm'), 'ExponentPushToken[x]; drop', 'expo'));
insert into t_r values ('too_long', public.set_widget_push_token((select k from t_k where who = 'm'),
  'ExponentPushToken[' || repeat('z', 240) || ']', 'expo'));
insert into t_r values ('nokey', public.set_widget_push_token(repeat('0', 64), 'ExponentPushToken[zzz]', 'expo'));
reset role;

select is((select r from t_r where n = 'm'), 'ok', '안드로이드(Expo) 신호 주소를 저장한다 (가입 없이 쓰는 엄마도)');
select is((select r from t_r where n = 'a'), 'ok', '애플 신호 주소는 0015 규칙 그대로 저장된다');
select is((select r from t_r where n = 'expo_hex'), 'invalid', '종류가 expo인데 애플 모양 주소면 저장하지 않는다');
select is((select r from t_r where n = 'apns_expo'), 'invalid', '종류가 애플인데 Expo 모양 주소면 저장하지 않는다');
select is((select r from t_r where n = 'bad_shape'), 'invalid', '모양이 이상한 Expo 주소는 저장하지 않는다');
select is((select r from t_r where n = 'too_long'), 'invalid', '너무 긴 주소는 저장하지 않는다');
select is((select r from t_r where n = 'nokey'), 'invalid', '없는 열쇠로는 저장하지 않는다');
select is((select push_env from public.widget_keys where push_token = 'ExponentPushToken[mOm_Android-1]'), 'expo',
  '이상한 값이 와도 엄마의 주소·종류는 그대로');
select throws_ok($$ update public.widget_keys set push_env = 'fcm' where push_token = 'ExponentPushToken[bBb2]' $$,
  '23514', null, '신호 종류는 sandbox·production·expo만');

-- ── 4) 앱 권한 ─────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"c1616161-0000-0000-0000-000000000003","role":"authenticated","is_anonymous":true}';
select throws_ok($$ select push_token from public.widget_keys $$, '42501', null, '앱은 내 위젯의 신호 주소도 읽을 수 없다');
select throws_ok($$ select public.set_widget_push_token((select k from t_k where who = 'm'), 'ExponentPushToken[ff]', 'expo') $$,
  '42501', null, '앱은 신호 주소를 직접 저장할 수 없다');
set local request.jwt.claims to '{"sub":"b1616161-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}';
select throws_ok($$ select push_env from public.widget_keys $$, '42501', null, '다른 그룹 사용자도 신호 종류를 읽을 수 없다');
reset role;

-- ── 3) 받을 위젯 ───────────────────────────────────────
insert into public.posts (id, sender_id, status) values
  ('00000000-0000-0000-0000-000000016a01', 'a1616161-0000-0000-0000-000000000001', 'ready'),
  ('00000000-0000-0000-0000-000000016a02', 'c1616161-0000-0000-0000-000000000003', 'ready');
insert into public.post_groups (post_id, group_id)
select p, (select id from t_g where who = 'g1') from unnest(array[
  '00000000-0000-0000-0000-000000016a01', '00000000-0000-0000-0000-000000016a02']::uuid[]) p;

set local role service_role;
select is((select array_agg(push_token || ':' || push_env) from public.widget_push_targets('00000000-0000-0000-0000-000000016a01')),
  array['ExponentPushToken[mOm_Android-1]:expo'], '지은이 보내면 엄마의 안드로이드 위젯에 (다른 그룹 B는 아님)');
select is((select array_agg(push_token || ':' || push_env) from public.widget_push_targets('00000000-0000-0000-0000-000000016a02')),
  array[repeat('a1', 32) || ':sandbox'], '엄마가 보내면 지은의 아이폰 위젯에 (엄마 자신 제외)');

-- 엄마가 앱을 다시 깔아 새 열쇠로 같은 주소가 오면 예전 열쇠에서는 지워진다
select public.set_widget_push_token((select k from t_k where who = 'm2'), 'ExponentPushToken[mOm_Android-1]', 'expo');
reset role;
select is((select count(*)::int from public.widget_keys where push_token = 'ExponentPushToken[mOm_Android-1]'), 1,
  '같은 Expo 주소는 마지막 열쇠 하나에만 남는다');

select is((select last_active_at from public.profiles where id = 'c1616161-0000-0000-0000-000000000003'),
  (select active from t_before), '신호 주소 저장·받을 위젯 고르기는 활동 시각을 바꾸지 않는다');
select is((select count(*) from public.post_views), (select views from t_before), '''봤어요'' 기록도 생기지 않는다');

select * from finish();
rollback;
