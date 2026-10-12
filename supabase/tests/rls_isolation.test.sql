-- RLS·정책 테스트
-- 1) 다른 그룹 사용자는 사진·구성원·초대·그룹을 볼 수 없다
-- 2) 그룹 만들기, 표시 이름, 초대 재발급·취소·만료·사용·없는 코드·5회 제한·50명, 합류,
--    칸 단위 수정 제한, 안부 확인 동의, 묶음 30장, 안부 기간 선택지
-- 실행: supabase test db (로컬) / supabase test db --linked (원격, 마지막에 rollback되어 흔적이 남지 않음)
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

-- 사용자 A(그룹 관리자, 카카오 이름 있음), B(다른 그룹), C(초대받아 합류, 쉬운 모드), D(늦게 온 사람), E(인원 초과)
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.dev', '{"name":"정문기"}'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.dev', '{}'),
  ('33333333-3333-3333-3333-333333333333', 'c@test.dev', '{}'),
  ('44444444-4444-4444-4444-444444444444', 'd@test.dev', '{}'),
  ('55555555-5555-5555-5555-555555555555', 'e@test.dev', '{}');

-- 서버가 만든 ID·코드를 역할을 바꿔가며 넘기기 위한 임시 표
create temp table t_ids (who text primary key, id uuid, code text);
grant all on t_ids to authenticated;

-- ── 가입: 소셜 이름이 기본 표시 이름이 된다 ──────────────────────
select is((select display_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  '정문기', '카카오·구글 이름이 기본 표시 이름으로 들어간다');
select is((select display_name from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  '', '이름이 없는 가입은 빈칸으로 시작한다');

-- ── A로 로그인: 그룹, 묶음, 초대 만들기 ─────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

insert into t_ids (who, id) values ('group', public.create_group('전주 엄마네', '  막내  '));
insert into t_ids (who, id) values ('group2', public.create_group('회사 동기', '문기'));

select is((select count(*) from public.groups)::int, 2, 'A는 자기가 만든 그룹을 바로 본다');
select ok(
  (select is_admin and display_name = '막내' from public.members
    where group_id = (select id from t_ids where who = 'group') and user_id = auth.uid()),
  '만든 사람은 관리자이고, 입력한 이름(공백 제거)이 그 그룹의 표시 이름이 된다');
select throws_ok(
  $$select public.create_group('이름 없는 사람', '   ')$$,
  'P0001', 'invalid_display_name', '표시 이름이 비어 있으면 그룹을 만들 수 없다');
select throws_ok(
  $$insert into public.groups (name, created_by) values ('직접', '11111111-1111-1111-1111-111111111111')$$,
  '42501', null, '그룹은 create_group으로만 만든다 (직접 넣기 금지)');

select lives_ok(
  $$select public.set_my_display_name((select id from t_ids where who = 'group'), '큰아들')$$,
  '내 표시 이름은 언제든 바꿀 수 있다');
select is(
  (select display_name from public.members
    where group_id = (select id from t_ids where who = 'group2') and user_id = auth.uid()),
  '문기', '표시 이름은 그룹마다 따로다');

insert into public.posts (id, sender_id, status, title)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'ready', '첫 걸음마');
insert into public.post_groups (post_id, group_id)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', (select id from t_ids where who = 'group'));

insert into t_ids (who, id, code) select '엄마', invite_id, code
  from public.create_invite((select id from t_ids where who = 'group'), '엄마', false, true, false);
insert into t_ids (who, id, code) select '아빠', invite_id, code
  from public.create_invite((select id from t_ids where who = 'group'), '아빠', false, true, false);
insert into t_ids (who, id, code) select '삼촌', invite_id, code
  from public.create_invite((select id from t_ids where who = 'group'), '삼촌', false, false, false);

-- 엄마 코드만 재발급
insert into t_ids (who, id, code) select '엄마-새', invite_id, code
  from public.reissue_invite((select id from t_ids where who = '엄마'));

select is((select count(*) from public.posts)::int, 1, 'A는 자기 묶음을 본다');
select is(
  (select count(*) from public.invites where used_at is null and revoked_at is null)::int, 3,
  '재발급은 그 초대만 바꾼다 (엄마-새, 아빠, 삼촌이 열려 있음)');
select ok(
  (select expires_at = public.invite_expiry(created_at) from public.invites
    where id = (select id from t_ids where who = '엄마-새')),
  '만료는 발급일 + 5일 날짜의 끝 (한국 시간)');
select throws_ok(
  $$select * from public.reissue_invite((select id from t_ids where who = '엄마'))$$,
  'P0001', 'already_revoked', '이미 바뀐 초대는 다시 재발급하지 않는다');
select throws_ok(
  $$update public.groups set wellbeing_days = 1 where id = (select id from t_ids where who = 'group')$$,
  '23514', null, '안부 기간은 2·3·5·7일만 고를 수 있다');
select throws_ok(
  $$update public.members set group_id = (select id from t_ids where who = 'group2')
    where group_id = (select id from t_ids where who = 'group')$$,
  '42501', null, '관리자도 구성원을 다른 그룹으로 옮길 수 없다');
select throws_ok(
  $$update public.posts set created_at = now() - interval '1 year'
    where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'$$,
  '42501', null, '보낸 시각은 바꿀 수 없다');

-- ── B로 로그인: 아무것도 보이지 않아야 한다 ──────────────────────
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select is((select count(*) from public.groups)::int,  0, 'B는 A의 그룹을 못 본다');
select is((select count(*) from public.posts)::int,   0, 'B는 A 그룹 묶음을 못 본다');
select is((select count(*) from public.members)::int, 0, 'B는 A 그룹 구성원을 못 본다');
select is((select count(*) from public.invites)::int, 0, 'B는 A 그룹 초대 코드를 못 본다');
select throws_ok(
  $$insert into public.post_groups (post_id, group_id)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', (select id from t_ids where who = 'group'))$$,
  '42501', null, 'B는 남의 묶음을 그룹에 붙일 수 없다');
select throws_ok(
  $$select * from public.create_invite((select id from t_ids where who = 'group'), '침입', true, false, false)$$,
  'P0001', 'forbidden', 'B는 A 그룹 초대를 만들 수 없다');
select is(public.redeem_invite('xxxxxx')->>'status', 'invalid', '없는 코드는 invalid');
do $$ begin perform public.redeem_invite('xxxxxx') from generate_series(1, 4); end $$;   -- 지금까지 5번
select is(public.redeem_invite((select code from t_ids where who = '삼촌'))->>'status', 'too_many_attempts',
  '10분에 5번을 넘으면 맞는 코드도 막는다');

-- ── C로 로그인: 옛 코드는 '바뀜', 새 코드로 합류 ────────────────
set local request.jwt.claims to '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select is(public.redeem_invite((select code from t_ids where who = '엄마'))->>'status', 'revoked',
  '재발급으로 취소된 코드는 revoked를 돌려준다');
select is(public.redeem_invite((select code from t_ids where who = '엄마-새'))->>'group_id',
  (select id::text from t_ids where who = 'group'), 'C는 새 코드로 합류한다');
select is((select count(*) from public.posts)::int, 1, '합류한 C는 이전 묶음도 본다');
select ok((select easy_mode from public.profiles where id = auth.uid()), '쉬운 모드 초대면 C는 쉬운 모드로 시작한다');
select is((select display_name from public.members where user_id = auth.uid()), '엄마',
  '초대에서 정한 이름이 적용된다');
select is(public.redeem_invite((select code from t_ids where who = '아빠'))->>'status', 'ok',
  '이미 구성원이 다른 코드를 넣으면 그룹으로 바로 간다');
update public.members set is_admin = true where user_id = auth.uid();   -- 관리자가 아니면 바뀌는 행이 없다
select ok((select not is_admin from public.members where user_id = auth.uid()),
  '구성원은 스스로 관리자가 될 수 없다');

-- ── D로 로그인: 이미 쓴 코드, 만료된 코드 ─────────────────────────
set local request.jwt.claims to '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

select is(public.redeem_invite((select code from t_ids where who = '엄마-새'))->>'status', 'used',
  '다른 사람이 이미 쓴 코드는 used');
reset role;   -- 테스트 준비: 삼촌 초대를 만료시킨다
update public.invites set expires_at = now() - interval '1 second'
 where id = (select id from t_ids where who = '삼촌');
set local role authenticated;
select is(public.redeem_invite((select code from t_ids where who = '삼촌'))->>'status', 'expired',
  '기한이 지난 코드는 expired');

-- ── 안부 확인 동의: 관리자는 직접 켤 수 없고 요청만 한다 ──────────
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is((select used_at from public.invites where id = (select id from t_ids where who = '아빠')), null,
  '이미 구성원이 넣은 코드는 쓰이지 않고 남는다');
select throws_ok(
  $$update public.members set wellbeing_check = true
    where user_id = '33333333-3333-3333-3333-333333333333'$$,
  'P0001', 'consent_required', '관리자가 남의 안부 확인을 직접 켤 수 없다');
do $$ begin perform public.request_wellbeing(
  (select id from public.members where user_id = '33333333-3333-3333-3333-333333333333')); end $$;

set local request.jwt.claims to '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
do $$ begin perform public.set_my_wellbeing((select id from t_ids where who = 'group'), true); end $$;
select ok(
  (select wellbeing_check and wellbeing_requested_at is null from public.members where user_id = auth.uid()),
  '대상자가 좋아요를 누르면 켜지고 요청은 지워진다');

-- ── 인원 50명이면 합류를 막는다 ────────────────────────────────
reset role;   -- 테스트 준비: 가짜 구성원 48명 추가 (A, C + 48 = 50)
insert into auth.users (id, email)
select ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'u' || g || '@test.dev'
from generate_series(1, 48) g;
insert into public.members (group_id, user_id)
select (select id from t_ids where who = 'group'), ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid
from generate_series(1, 48) g;
set local role authenticated;
set local request.jwt.claims to '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';
select is(public.redeem_invite((select code from t_ids where who = '아빠'))->>'status', 'group_full',
  '활성 구성원이 50명이면 group_full');

-- ── 묶음은 최대 30장 ──────────────────────────────────────────
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
insert into public.media (post_id, type, path, thumb_path, sort_order)
select 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'photo', 'posts/x/' || g || '.jpg', 'posts/x/' || g || '_thumb.jpg', g
from generate_series(1, 30) g;
select throws_ok(
  $$insert into public.media (post_id, type, path, thumb_path)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'photo', 'posts/x/31.jpg', 'posts/x/31_thumb.jpg')$$,
  'P0001', 'too_many_media', '31번째 사진은 막는다');

select * from finish();
rollback;
