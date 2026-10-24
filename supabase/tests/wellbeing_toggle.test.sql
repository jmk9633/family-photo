-- 0011 안부 확인 켜고 끄기 테스트 (개발 7-2, F-MNBFHT)
-- 1) 초대로 켜지면 기록이 남고, 내 상태(my_wellbeing)에 처음 안내가 필요하다고 나온다
-- 2) 변경 기록은 그 그룹 관리자와 본인만 본다 (다른 그룹 사용자·같은 그룹 다른 구성원은 못 본다)
-- 3) 본인 스위치 하나로 모든 가족 끄기·다시 켜기 (본인이 끈 곳만), 끔 알림은 가족별로 한 번
-- 4) 관리자가 끄면 본인은 다시 못 켜고 요청 + '좋아요'로만. 꺼지면 열린 안부 알림이 닫힌다
-- 5) '아니요' 뒤 7일 동안 다시 요청 못 함
-- 6) 앱은 기록·안내·거절 칸을 직접 못 고치고, 끔 알림 함수를 부를 수 없다
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

-- A: G1 관리자 / N: G2 관리자 / M: 엄마(익명, G1·G2 안부 대상) / C: G1 구성원 / B: 다른 그룹 GB 관리자
insert into auth.users (id, email, raw_user_meta_data, is_anonymous) values
  ('a2020202-0000-0000-0000-000000000001', 'a@tg.dev', '{}', false),
  ('b2020202-0000-0000-0000-000000000002', 'b@tg.dev', '{}', false),
  ('c2020202-0000-0000-0000-000000000003', 'c@tg.dev', '{}', false),
  ('d2020202-0000-0000-0000-000000000004', null, '{}', true),
  ('e2020202-0000-0000-0000-000000000005', 'n@tg.dev', '{}', false);

create temp table t_g (who text primary key, id uuid, code text);
grant all on t_g to authenticated;
set local role authenticated;

set local request.jwt.claims to '{"sub":"a2020202-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';
insert into t_g (who, id) values ('g1', public.create_group('전주 엄마네', '막내'));
insert into t_g (who, code) select 'm1', code from public.create_invite((select id from t_g where who = 'g1'), '엄마', false, true, true);
insert into t_g (who, code) select 'c1', code from public.create_invite((select id from t_g where who = 'g1'), '아빠', false, false, false);

set local request.jwt.claims to '{"sub":"e2020202-0000-0000-0000-000000000005","role":"authenticated","is_anonymous":false}';
insert into t_g (who, id) values ('g2', public.create_group('서울 큰집', '민수'));
insert into t_g (who, code) select 'm2', code from public.create_invite((select id from t_g where who = 'g2'), '어머니', false, true, true);

set local request.jwt.claims to '{"sub":"b2020202-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}';
insert into t_g (who, id) values ('gb', public.create_group('B네', '비'));

set local request.jwt.claims to '{"sub":"c2020202-0000-0000-0000-000000000003","role":"authenticated","is_anonymous":false}';
select is(public.redeem_invite((select code from t_g where who = 'c1'))->>'status', 'ok', 'C가 G1에 들어온다');

-- ── 엄마(익명)가 두 가족에 안부 확인 켜진 채로 들어온다 ──────────────
set local request.jwt.claims to '{"sub":"d2020202-0000-0000-0000-000000000004","role":"authenticated","is_anonymous":true}';
select is(public.redeem_invite((select code from t_g where who = 'm1'))->>'status', 'ok', '엄마가 G1에 들어온다');
select is(public.redeem_invite((select code from t_g where who = 'm2'))->>'status', 'ok', '엄마가 G2에 들어온다');
insert into t_g (who, id) select 'mm1', id from public.members
  where user_id = auth.uid() and group_id = (select id from t_g where who = 'g1');
insert into t_g (who, id) select 'mm2', id from public.members
  where user_id = auth.uid() and group_id = (select id from t_g where who = 'g2');

select is((select count(*) from public.wellbeing_changes where how = 'invite' and value)::int, 2,
  '초대로 켜진 두 가족의 기록이 남고 본인은 자기 기록을 본다');
select is((select count(*) from public.my_wellbeing() where is_on and intro_needed and ever_on)::int, 2,
  '내 상태: 두 가족 모두 켜짐, 처음 안내가 필요하다');
do $$ begin perform public.wellbeing_seen_intro(); end $$;
select is((select count(*) from public.my_wellbeing() where intro_needed)::int, 0, '안내를 보면 다시 안 나온다');
select throws_ok(
  $$update public.members set wellbeing_intro_at = null where user_id = auth.uid()$$,
  '42501', null, '안내 본 시각은 앱이 직접 못 고친다');
select throws_ok(
  $$insert into public.wellbeing_changes (member_id, group_id, user_id, value, how)
    values ((select id from t_g where who = 'mm1'), (select id from t_g where who = 'g1'), auth.uid(), true, 'consent')$$,
  '42501', null, '변경 기록은 앱이 직접 못 넣는다');

-- ── 누가 기록을 보나 ─────────────────────────────────────────────
set local request.jwt.claims to '{"sub":"b2020202-0000-0000-0000-000000000002","role":"authenticated","is_anonymous":false}';
select is((select count(*) from public.wellbeing_changes)::int, 0, '다른 그룹 사용자는 변경 기록을 못 본다');
select is((select count(*) from public.my_wellbeing())::int, 0, '안부 확인이 한 번도 없었던 사람은 내 상태가 비어 있다');
select throws_ok($$select public.stop_wellbeing((select id from t_g where who = 'mm1'))$$,
  'P0001', 'forbidden', '다른 그룹 사용자는 끌 수 없다');
select throws_ok($$select public.request_wellbeing((select id from t_g where who = 'mm1'))$$,
  'P0001', 'forbidden', '다른 그룹 사용자는 켜기를 요청할 수 없다');

set local request.jwt.claims to '{"sub":"c2020202-0000-0000-0000-000000000003","role":"authenticated","is_anonymous":false}';
select is((select count(*) from public.wellbeing_changes)::int, 0, '같은 그룹 다른 구성원(관리자 아님)도 못 본다');
select throws_ok($$select public.stop_wellbeing((select id from t_g where who = 'mm1'))$$,
  'P0001', 'forbidden', '관리자가 아닌 구성원은 끌 수 없다');

set local request.jwt.claims to '{"sub":"a2020202-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';
select is((select count(*) from public.wellbeing_changes)::int, 1, 'G1 관리자는 G1 기록만 본다 (G2 것은 못 본다)');

-- ── 엄마가 스위치 하나로 끈다 → 두 가족 모두, 끔 알림은 가족별로 한 번 ─────
set local request.jwt.claims to '{"sub":"d2020202-0000-0000-0000-000000000004","role":"authenticated","is_anonymous":true}';
select is(public.set_my_wellbeing_all(false), 2, '본인이 끄면 켜진 모든 가족에서 꺼진다');
select is((select count(*) from public.my_wellbeing() where not is_on and can_turn_on)::int, 2,
  '본인이 끈 곳은 본인이 다시 켤 수 있다고 나온다');
select throws_ok($$select * from public.claim_wellbeing_off_notices(auth.uid())$$,
  '42501', null, '앱 사용자는 끔 알림 함수를 부를 수 없다');

reset role;
select is((select count(*) from public.wellbeing_changes where how = 'self' and not value)::int, 2, '본인이 끈 기록이 두 줄');
select is(
  (select admin_ids from public.claim_wellbeing_off_notices('d2020202-0000-0000-0000-000000000004')
    where group_id = (select id from t_g where who = 'g1')),
  array['a2020202-0000-0000-0000-000000000001'::uuid], '끔 알림은 그 그룹 관리자에게 (가족별 한 줄)');
select is((select count(*) from public.claim_wellbeing_off_notices('d2020202-0000-0000-0000-000000000004'))::int, 0,
  '같은 끔은 한 번만 알린다');
set local role authenticated;

set local request.jwt.claims to '{"sub":"d2020202-0000-0000-0000-000000000004","role":"authenticated","is_anonymous":true}';
select is(public.set_my_wellbeing_all(true), 2, '본인이 껐던 곳은 본인이 바로 다시 켠다');

-- ── 관리자가 G1에서 끈다 → 열린 알림이 닫히고, 엄마는 다시 못 켠다 ─────────
reset role;
insert into public.wellbeing_alerts (id, group_id, target_user_id, kind)
values ('0a0a0a0a-0000-0000-0000-000000000001', (select id from t_g where who = 'g1'),
        'd2020202-0000-0000-0000-000000000004', 'check');
set local role authenticated;
set local request.jwt.claims to '{"sub":"a2020202-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';
do $$ begin perform public.stop_wellbeing((select id from t_g where who = 'mm1')); end $$;
select is((select how from public.wellbeing_changes order by created_at desc limit 1), 'admin', '관리자가 끈 기록');
reset role;
select isnt((select closed_at from public.wellbeing_alerts where id = '0a0a0a0a-0000-0000-0000-000000000001'), null,
  '꺼지면 열린 안부 알림이 바로 닫힌다');
select is((select count(*) from public.claim_wellbeing_off_notices('d2020202-0000-0000-0000-000000000004'))::int, 0,
  '관리자가 끈 것은 끔 알림을 보내지 않는다');
set local role authenticated;

set local request.jwt.claims to '{"sub":"d2020202-0000-0000-0000-000000000004","role":"authenticated","is_anonymous":true}';
select is(public.set_my_wellbeing_all(true), 0, '관리자가 끈 곳은 스위치로 다시 안 켜진다');
select throws_ok($$select public.set_my_wellbeing((select id from t_g where who = 'g1'), true)$$,
  'P0001', 'request_required', '관리자가 끈 곳은 요청 없이 본인이 켤 수 없다');

-- ── 요청 → '아니요' → 7일 동안 다시 요청 못 함 → '좋아요' ─────────────
set local request.jwt.claims to '{"sub":"a2020202-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';
do $$ begin perform public.request_wellbeing((select id from t_g where who = 'mm1')); end $$;

set local request.jwt.claims to '{"sub":"d2020202-0000-0000-0000-000000000004","role":"authenticated","is_anonymous":true}';
select ok((select requested and not is_on and ever_on from public.my_wellbeing()
            where group_id = (select id from t_g where who = 'g1')), '요청이 오면 내 상태에 보인다 (다시 켜기 문구용 ever_on)');
select is(public.answer_wellbeing_requests(false), 1, '''아니요''는 와 있는 요청에 답한다');
select ok((select not wellbeing_check and wellbeing_requested_at is null and wellbeing_declined_at is not null
             from public.members where id = (select id from t_g where who = 'mm1')), '''아니요''면 꺼진 채 요청이 지워지고 거절 시각이 남는다');

set local request.jwt.claims to '{"sub":"a2020202-0000-0000-0000-000000000001","role":"authenticated","is_anonymous":false}';
select throws_ok($$select public.request_wellbeing((select id from t_g where who = 'mm1'))$$,
  'P0001', 'recently_declined', '''아니요'' 뒤 7일 동안은 다시 요청할 수 없다');
reset role;
update public.members set wellbeing_declined_at = now() - interval '7 days 1 minute'
 where id = (select id from t_g where who = 'mm1');
set local role authenticated;
select lives_ok($$select public.request_wellbeing((select id from t_g where who = 'mm1'))$$, '7일이 지나면 다시 요청할 수 있다');

set local request.jwt.claims to '{"sub":"d2020202-0000-0000-0000-000000000004","role":"authenticated","is_anonymous":true}';
select is(public.answer_wellbeing_requests(true), 1, '''좋아요''는 와 있는 요청에 답한다');
select ok((select is_on and not requested and not intro_needed from public.my_wellbeing()
            where group_id = (select id from t_g where who = 'g1')), '''좋아요''면 켜지고 안내는 본 것으로 한다');
select is((select how from public.wellbeing_changes where member_id = (select id from t_g where who = 'mm1')
            order by created_at desc limit 1), 'consent', '''좋아요''로 켜진 기록');

-- ── 밤에는 끔 알림도 아침 알림으로 모을 수 있다 (notify → night_queue) ─────
reset role;
select lives_ok(
  $$insert into public.night_queue (user_id, kind, group_id, title, body)
    values ('a2020202-0000-0000-0000-000000000001', 'wellbeing_off', (select id from t_g where who = 'g1'),
            '안부 확인이 꺼졌어요', '엄마가 안부 확인을 껐어요')$$,
  '끔 알림도 밤 알림 모으기 표에 넣을 수 있다');

select * from finish();
rollback;
