-- 0003: 하트·'봤어요' (개발 5단계, F-CPRPRW 하트, F-BLIYTI '봤어요')
--
-- 테이블(reactions, post_views)은 0001에 이미 있다. 여기서는 세 가지만 바꾼다.
--
-- 1) '봤어요'는 보낸 사람에게만 보인다 (10/16 결정: 봤어요=보낸 사람, 하트=모든 구성원)
--    0001의 post_views_select는 같은 그룹 누구나 읽을 수 있었다 → 본인 기록 + 내가 보낸 묶음의 기록으로 좁힌다.
--    시청 표시를 끈 사람(profiles.show_seen = false)의 기록은 보낸 사람에게도 보이지 않는다 (seen_visible).
--    하트(reactions_select)는 그대로 같은 그룹 구성원 누구나 본다.
--
-- 2) 시청 날짜는 서버가 정한다 (한국 시간 오늘). 앱이 다른 날짜를 넣어도 오늘로 바꾼다.
--    같은 날 여러 번 보면 기본 키(묶음, 사람, 날짜)가 겹쳐 23505 → 앱은 성공으로 처리한다.
--
-- 3) 하트를 누르거나 사진을 보면 활동 시각(profiles.last_active_at)을 갱신한다 (안부 확인용).
--    시청 표시를 꺼도 이 기록은 남는다 (F-BLIYTI 규칙). 앱이 따로 부르지 않아도 되게 트리거로 둔다
--    — 6단계 쉬운 모드, 9단계 TV도 같은 테이블에 넣기만 하면 된다.

-- 1) '봤어요' 읽기
drop policy post_views_select on public.post_views;
create policy post_views_select on public.post_views for select to authenticated
  using (
    user_id = auth.uid()
    or (
      public.seen_visible(user_id)
      and exists (select 1 from public.posts p where p.id = post_id and p.sender_id = auth.uid())
    )
  );

-- 2) 시청 날짜는 오늘 (한국 시간)
create or replace function public.post_views_today()
returns trigger language plpgsql set search_path = public as $$
begin
  new.viewed_on := (now() at time zone 'Asia/Seoul')::date;
  return new;
end;
$$;
create trigger post_views_today
  before insert on public.post_views
  for each row execute function public.post_views_today();

-- 3) 활동 시각 갱신 (본인 행만. 테이블 정책이 user_id = auth.uid()만 넣게 하므로 남의 활동을 바꿀 수 없다)
create or replace function public.touch_last_active()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set last_active_at = now() where id = new.user_id;
  return new;
end;
$$;
revoke all on function public.touch_last_active() from public, anon, authenticated;

create trigger reactions_touch_active
  after insert on public.reactions
  for each row execute function public.touch_last_active();
create trigger post_views_touch_active
  after insert on public.post_views
  for each row execute function public.touch_last_active();
