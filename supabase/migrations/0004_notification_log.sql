-- 0004: 보낸 알림 기록 (개발 5단계 후반, 푸시 알림)
--
-- 알림은 앱이 Edge Function `notify`를 불러 출발시킨다 (10/17 결정 A). 함수는 service role로
-- DB를 다시 확인한 뒤, 이 표에 한 줄을 먼저 넣고 성공했을 때만 알림을 보낸다.
-- 같은 알림을 또 요청해도 기본 키가 겹쳐 두 번 보내지 않는다.
--
--   new_post: 묶음이 완료됐을 때 받은 그룹 구성원에게 (묶음당 한 번)
--   heart   : 그 사람이 그 묶음에 처음 하트를 눌렀을 때 보낸 사람에게 (사람·묶음당 한 번, 10/16 결정)
--   seen    : 그 사람이 그 묶음을 그날 처음 봤을 때 보낸 사람에게 (사람·묶음·날짜당 한 번)
--
-- 앱(anon, authenticated)은 이 표를 읽지도 쓰지도 못한다. 정책 없이 RLS만 켜 두고 권한도 걷는다.

create table public.notification_log (
  kind       text not null check (kind in ('new_post', 'heart', 'seen')),
  post_id    uuid not null references public.posts(id) on delete cascade,
  actor_id   uuid not null references public.profiles(id) on delete cascade,  -- 보내기·하트·시청을 한 사람
  on_date    date not null,  -- seen은 한국 시간 그날, 나머지는 1970-01-01 (하루 단위가 아님)
  created_at timestamptz not null default now(),
  primary key (kind, post_id, actor_id, on_date)
);

alter table public.notification_log enable row level security;
revoke all on public.notification_log from anon, authenticated;
