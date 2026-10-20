-- 0010 안부 알림 테스트 (개발 7-1)
-- 1) 판단: 기간 동안 활동이 없고 새 묶음이 있었으면 안부 알림, 없었으면 넛지, 활동했으면 없음, 다시 돌려도 중복 없음
-- 2) 푸시 문구와 받는 사람: 그 그룹 관리자만, 대상자 본인은 빼고
-- 3) 전화번호: 관리자만 넣고 관리자만 본다 (같은 그룹 다른 구성원·다른 그룹 사용자는 못 본다)
-- 4) 안부 띠(my_wellbeing_alerts): 관리자 본인 그룹 것만, 대상이 나인 것은 빼고, 다른 그룹 사용자는 못 본다
-- 5) 닫기: '괜찮아요'(관리자만) 뒤 기간 안에는 다시 안 만듦, 다시 활동하면 닫힘, 새 묶음이 오면 넛지 닫힘, 안부 확인을 끄면 닫힘
-- 6) 앱 사용자는 판단·보내기 함수를 부를 수 없다
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

-- A: G1·G2 관리자 / C 엄마(G1 대상) / D 아빠(G1 구성원) / F 이모(G1 대상, 최근 활동)
-- G 고모(G1 대상) / E 할머니(G2 대상이면서 G2 관리자) / H 할아버지(G2 대상) / B: 다른 그룹 GB 관리자
insert into auth.users (id, email, raw_user_meta_data) values
  ('a1010101-0000-0000-0000-000000000001', 'a@wb.dev', '{}'),
  ('b1010101-0000-0000-0000-000000000002', 'b@wb.dev', '{}'),
  ('c1010101-0000-0000-0000-000000000003', 'c@wb.dev', '{}'),
  ('d1010101-0000-0000-0000-000000000004', 'd@wb.dev', '{}'),
  ('e1010101-0000-0000-0000-000000000005', 'e@wb.dev', '{}'),
  ('f1010101-0000-0000-0000-000000000006', 'f@wb.dev', '{}'),
  ('11010101-0000-0000-0000-000000000007', 'g@wb.dev', '{}'),
  ('21010101-0000-0000-0000-000000000008', 'h@wb.dev', '{}');

create temp table t_g (who text primary key, id uuid);
grant all on t_g to authenticated;
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1010101-0000-0000-0000-000000000001","role":"authenticated"}';
insert into t_g values ('g1', public.create_group('전주 엄마네', '막내'));
insert into t_g values ('g2', public.create_group('대구 할머니네', '막내'));
set local request.jwt.claims to '{"sub":"b1010101-0000-0000-0000-000000000002","role":"authenticated"}';
insert into t_g values ('gb', public.create_group('B네', '비'));
reset role;

insert into public.members (group_id, user_id, display_name, is_admin, wellbeing_check, joined_at) values
  ((select id from t_g where who = 'g1'), 'c1010101-0000-0000-0000-000000000003', '엄마',     false, true,  now() - interval '30 days'),
  ((select id from t_g where who = 'g1'), 'd1010101-0000-0000-0000-000000000004', '아빠',     false, false, now() - interval '30 days'),
  ((select id from t_g where who = 'g1'), 'f1010101-0000-0000-0000-000000000006', '이모',     false, true,  now() - interval '30 days'),
  ((select id from t_g where who = 'g1'), '11010101-0000-0000-0000-000000000007', '고모',     false, true,  now() - interval '30 days'),
  ((select id from t_g where who = 'g2'), 'e1010101-0000-0000-0000-000000000005', '할머니',   true,  true,  now() - interval '30 days'),
  ((select id from t_g where who = 'g2'), '21010101-0000-0000-0000-000000000008', '할아버지', false, true,  now() - interval '30 days');

update public.profiles set last_active_at = now() - interval '4 days 1 hour'
 where id in ('c1010101-0000-0000-0000-000000000003', '11010101-0000-0000-0000-000000000007',
              'e1010101-0000-0000-0000-000000000005', '21010101-0000-0000-0000-000000000008');
update public.profiles set last_active_at = now() - interval '1 day'
 where id = 'f1010101-0000-0000-0000-000000000006';

-- G1에는 A가 방금 보낸 새 묶음이 있고, G2에는 없다
insert into public.posts (id, sender_id, status) values
  ('00000000-0000-0000-0000-00000000a0a1', 'a1010101-0000-0000-0000-000000000001', 'ready');
insert into public.post_groups (post_id, group_id) values
  ('00000000-0000-0000-0000-00000000a0a1', (select id from t_g where who = 'g1'));

select public.run_wellbeing_check();

-- ── 1) 판단 ───────────────────────────────────────────────
select is((select kind from public.wellbeing_alerts where target_user_id = 'c1010101-0000-0000-0000-000000000003'), 'check',
  '활동이 없고 새 묶음이 있었으면 안부 알림');
select is((select kind from public.wellbeing_alerts where target_user_id = 'e1010101-0000-0000-0000-000000000005'), 'nudge',
  '활동이 없고 새 묶음이 없었으면 넛지');
select is((select count(*) from public.wellbeing_alerts where target_user_id = 'f1010101-0000-0000-0000-000000000006')::int, 0,
  '기간 안에 활동했으면 알림이 없다');
select public.run_wellbeing_check();
select is((select count(*) from public.wellbeing_alerts)::int, 4, '다시 돌려도 같은 무활동 구간에 알림은 하나');

-- ── 2) 푸시 문구와 받는 사람 ───────────────────────────────
create temp table t_msg as select * from public.wellbeing_push_messages();
grant all on t_msg to authenticated;
select is((select title from t_msg w join public.wellbeing_alerts a on a.id = w.alert_id
            where a.target_user_id = 'c1010101-0000-0000-0000-000000000003'),
  '엄마가 4일째 새 사진을 안 보셨어요', '안부 알림 제목: 그룹 안 이름 + 며칠째');
select is((select body from t_msg w join public.wellbeing_alerts a on a.id = w.alert_id
            where a.target_user_id = 'c1010101-0000-0000-0000-000000000003'),
  '안부 전화 드려볼까요? 응급 상황 알림은 아니에요', '안부 알림 내용: 응급 상황 알림이 아니라는 안내');
select is((select body from t_msg w join public.wellbeing_alerts a on a.id = w.alert_id
            where a.target_user_id = 'e1010101-0000-0000-0000-000000000005'),
  '할머니에게 새 사진을 보내 드려 볼까요?', '넛지 내용');
select results_eq(
  $$select w.user_id from t_msg w join public.wellbeing_alerts a on a.id = w.alert_id
     where a.target_user_id = 'c1010101-0000-0000-0000-000000000003'$$,
  $$values ('a1010101-0000-0000-0000-000000000001'::uuid)$$,
  '관리자에게만 보낸다 (관리자가 아닌 구성원은 받지 않는다)');
select results_eq(
  $$select w.user_id from t_msg w join public.wellbeing_alerts a on a.id = w.alert_id
     where a.target_user_id = 'e1010101-0000-0000-0000-000000000005'$$,
  $$values ('a1010101-0000-0000-0000-000000000001'::uuid)$$,
  '대상자가 관리자여도 본인에게는 보내지 않는다');
select ok(not exists (select 1 from t_msg where title ~ '위험|이상 징후' or body ~ '위험|이상 징후'),
  '문구에 위험·이상 징후 표현을 쓰지 않는다');

-- ── 3) 전화번호 ───────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1010101-0000-0000-0000-000000000001","role":"authenticated"}';
select public.set_member_phone(
  (select id from public.members where user_id = 'c1010101-0000-0000-0000-000000000003'), '010-1234-5678');
select is((select phone from public.member_phones), '01012345678', '관리자가 넣은 번호는 숫자만 저장되고 관리자는 본다');
select throws_ok(
  $$select public.set_member_phone((select id from public.members where user_id = 'c1010101-0000-0000-0000-000000000003'), '1234')$$,
  'P0001', 'invalid_phone', '전화번호 형식이 아니면 넣지 않는다');
set local request.jwt.claims to '{"sub":"d1010101-0000-0000-0000-000000000004","role":"authenticated"}';
select throws_ok(
  $$select public.set_member_phone((select id from public.members where user_id = 'c1010101-0000-0000-0000-000000000003'), '01099998888')$$,
  'P0001', 'forbidden', '관리자가 아니면 번호를 넣을 수 없다');
select is((select count(*) from public.member_phones)::int, 0, '같은 그룹이어도 관리자가 아니면 번호를 못 본다');
select is((select count(*) from public.my_wellbeing_alerts())::int, 0, '관리자가 아니면 안부 띠가 없다');
select is((select count(*) from public.wellbeing_alerts)::int, 0, '관리자가 아니면 안부 알림 기록을 못 본다');
select throws_ok(
  $$select public.respond_wellbeing((select alert_id from t_msg limit 1), 'ok')$$,
  'P0001', 'forbidden', '관리자가 아니면 응답할 수 없다');
set local request.jwt.claims to '{"sub":"b1010101-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*) from public.member_phones)::int, 0, '다른 그룹 사용자는 번호를 못 본다');
select is((select count(*) from public.my_wellbeing_alerts())::int, 0, '다른 그룹 사용자는 안부 띠가 없다');

-- ── 4) 안부 띠 ───────────────────────────────────────────
set local request.jwt.claims to '{"sub":"a1010101-0000-0000-0000-000000000001","role":"authenticated"}';
select results_eq(
  $$select target_name, kind, days, phone from public.my_wellbeing_alerts() order by target_name$$,
  $$values ('고모'::text, 'check'::text, 4, null::text), ('엄마', 'check', 4, '01012345678'),
           ('할머니', 'nudge', 4, null), ('할아버지', 'nudge', 4, null)$$,
  '관리자는 자기 그룹의 열린 알림을 이름·며칠째·번호와 함께 본다');
set local request.jwt.claims to '{"sub":"e1010101-0000-0000-0000-000000000005","role":"authenticated"}';
select results_eq($$select target_name from public.my_wellbeing_alerts()$$, $$values ('할아버지'::text)$$,
  '대상이 나인 알림은 내 안부 띠에 없다');

-- ── 5) 닫기 ───────────────────────────────────────────────
set local request.jwt.claims to '{"sub":"a1010101-0000-0000-0000-000000000001","role":"authenticated"}';
select public.respond_wellbeing(
  (select alert_id from public.my_wellbeing_alerts() where target_name = '엄마'), 'ok');
reset role;
select public.run_wellbeing_check();
select is((select count(*) from public.wellbeing_alerts
            where target_user_id = 'c1010101-0000-0000-0000-000000000003' and closed_at is null)::int, 0,
  '괜찮아요 뒤에는 기간이 지날 때까지 다시 만들지 않는다');

update public.profiles set last_active_at = clock_timestamp() where id = '11010101-0000-0000-0000-000000000007';
select is((select count(*) from public.wellbeing_alerts
            where target_user_id = '11010101-0000-0000-0000-000000000007' and closed_at is null)::int, 0,
  '대상자가 다시 활동하면 알림이 닫힌다');

update public.members set wellbeing_check = false where user_id = '21010101-0000-0000-0000-000000000008';
select public.run_wellbeing_check();
select is((select count(*) from public.wellbeing_alerts
            where target_user_id = '21010101-0000-0000-0000-000000000008' and closed_at is null)::int, 0,
  '안부 확인을 끄면 열린 알림이 닫힌다');

insert into public.posts (id, sender_id, status) values
  ('00000000-0000-0000-0000-00000000a0a2', 'a1010101-0000-0000-0000-000000000001', 'uploading');
insert into public.post_groups (post_id, group_id) values
  ('00000000-0000-0000-0000-00000000a0a2', (select id from t_g where who = 'g2'));
update public.posts set status = 'ready' where id = '00000000-0000-0000-0000-00000000a0a2';
select is((select count(*) from public.wellbeing_alerts
            where target_user_id = 'e1010101-0000-0000-0000-000000000005' and closed_at is null)::int, 0,
  '그룹에 새 묶음이 올라오면 넛지가 닫힌다');

-- ── 6) 앱 사용자 권한 ─────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"a1010101-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.wellbeing_daily()$$, '42501', null, '앱 사용자는 안부 판단·보내기를 부를 수 없다');
reset role;

select * from finish();
rollback;
