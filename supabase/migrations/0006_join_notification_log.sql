-- 0006: 합류 알림 기록 (개발 6단계, 10/18 결정: '가족이 들어왔어요'는 그 그룹 구성원 모두에게, 들어온 본인 제외)
--
-- 초대 코드로 그룹에 들어간 앱이 Edge Function `notify`를 { type: 'joined', groupId }로 부른다.
-- 함수는 부른 사람이 그 그룹 활성 구성원이고 방금(10분 안) 들어왔는지 DB로 확인한 뒤,
-- 이 표에 (구성원, 들어온 시각)을 먼저 넣고 성공했을 때만 보낸다. 같은 합류는 한 번만 알린다.
-- 나갔다가 다시 초대받아 들어오면 들어온 시각이 바뀌므로 다시 알린다.
-- notification_log(0004)는 묶음 단위(post_id 필수)라 따로 둔다.
--
-- 앱(anon, authenticated)은 이 표를 읽지도 쓰지도 못한다. 정책 없이 RLS만 켜 두고 권한도 걷는다.

create table public.join_notification_log (
  member_id  uuid not null references public.members(id) on delete cascade,
  joined_at  timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (member_id, joined_at)
);

alter table public.join_notification_log enable row level security;
revoke all on public.join_notification_log from anon, authenticated;
