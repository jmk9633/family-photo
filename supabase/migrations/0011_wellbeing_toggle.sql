-- 0011: 안부 확인 켜고 끄기 (개발 7-2, F-MNBFHT, 10/24 결정 "추천대로")
--
-- 0001에 이미 있는 것: members.wellbeing_check·wellbeing_requested_at, set_my_wellbeing(본인 켜기/끄기),
--   request_wellbeing(관리자 요청), 트리거 consent_required(본인 아니면 켜기 막음), 관리자의 members 수정 권한.
-- 여기서 더하는 것:
--   1) 변경 기록 wellbeing_changes (명세 dataSpec: 변경자·시각·값 + 어떻게 바뀌었는지)
--   2) 처음 안내를 본 시각(wellbeing_intro_at), '아니요'를 누른 시각(wellbeing_declined_at)
--   3) 본인 규칙 (결정 2): 본인이 끈 곳만 본인이 다시 켠다. 관리자가 끈 곳·처음 켜는 곳은 요청 + '좋아요'로만.
--   4) 쉬운 화면용 한꺼번에 (결정 1): set_my_wellbeing_all, answer_wellbeing_requests
--   5) 다시 요청은 '아니요' 뒤 7일부터 (결정 4) → recently_declined
--   6) 관리자 끄기 stop_wellbeing. 꺼지면 열린 안부 알림을 바로 닫는다.
--   7) 끔 알림: 본인이 끈 기록을 notify 함수가 한 번만 가져가게 claim_wellbeing_off_notices (service role 전용)
--      관리자에게 '엄마가 안부 확인을 껐어요'. 관리자가 끈 경우 대상자에게는 알리지 않는다 (결정 6).
--   8) 내 상태 my_wellbeing() (쉬운 화면 더보기·동의 화면·안내, 일반 화면 그룹 화면·사진 탭 띠)
-- 요청이 와도 대상자에게 푸시는 보내지 않는다. 다음에 앱을 열면 동의 화면이 뜬다 (결정 3).

-- ============================================================
-- 1. members 칸 (앱이 직접 고칠 수 없다: 0001의 칸 단위 수정 권한에 넣지 않음)
-- ============================================================
alter table public.members
  add column wellbeing_intro_at    timestamptz,   -- '며칠 안 보시면 가족에게 알려요' 안내를 본 시각
  add column wellbeing_declined_at timestamptz;   -- 켜기 요청에 '아니요'를 누른 시각 (7일 동안 다시 요청 못 함)

-- ============================================================
-- 2. 변경 기록
-- ============================================================
create table public.wellbeing_changes (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null references public.members(id) on delete cascade,
  group_id     uuid not null references public.groups(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,  -- 대상자
  value        boolean not null,
  -- invite=초대로 들어오며 켜짐, self=본인, admin=관리자, consent=요청에 '좋아요', server=서버 작업
  how          text not null check (how in ('invite', 'self', 'admin', 'consent', 'server')),
  changed_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default clock_timestamp(),  -- 한 트랜잭션 안에서도 순서가 생기게
  notified_at  timestamptz                                       -- 끔 알림을 보낸 시각 (how = self, value = false)
);
create index wellbeing_changes_member_idx on public.wellbeing_changes(member_id, created_at desc);
alter table public.wellbeing_changes enable row level security;
revoke all on public.wellbeing_changes from anon, authenticated;
grant select on public.wellbeing_changes to authenticated;

-- 그 그룹 관리자와 대상자 본인만 본다
create policy wellbeing_changes_select on public.wellbeing_changes for select to authenticated
  using (public.is_group_admin(group_id) or user_id = auth.uid());

-- 지금 켜져 있는 사람은 '초대로 켜짐'으로 한 줄씩 남겨 둔다 (기록이 있어야 '다시 켜기' 문구와 더보기 칸을 정할 수 있다)
insert into public.wellbeing_changes (member_id, group_id, user_id, value, how, created_at)
select id, group_id, user_id, true, 'invite', joined_at
  from public.members where wellbeing_check;

-- 태그가 바뀔 때마다 기록하고, 꺼지면 그 사람의 열린 안부 알림을 닫는다.
-- 어떻게 바뀌었는지는 RPC가 app.wellbeing_how로 알려 주고, 없으면 부른 사람으로 정한다.
create or replace function public.log_wellbeing_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_how text;
begin
  if tg_op = 'INSERT' then
    if not new.wellbeing_check then return null; end if;
    v_how := 'invite';
  elsif old.status <> 'active' and new.status = 'active' then
    -- 나갔다가 초대로 다시 들어옴 (redeem_invite)
    if not new.wellbeing_check and not old.wellbeing_check then return null; end if;
    v_how := 'invite';
  else
    if new.wellbeing_check = old.wellbeing_check then return null; end if;
    v_how := coalesce(nullif(current_setting('app.wellbeing_how', true), ''),
                      case when auth.uid() is null then 'server'
                           when auth.uid() = new.user_id then 'self'
                           else 'admin' end);
  end if;

  insert into public.wellbeing_changes (member_id, group_id, user_id, value, how, changed_by)
  values (new.id, new.group_id, new.user_id, new.wellbeing_check, v_how, auth.uid());

  if not new.wellbeing_check then
    update public.wellbeing_alerts set closed_at = now()
     where group_id = new.group_id and target_user_id = new.user_id and closed_at is null;
  end if;
  return null;
end;
$$;
revoke all on function public.log_wellbeing_change() from public, anon, authenticated;
create trigger members_log_wellbeing
  after insert or update of wellbeing_check, status on public.members
  for each row execute function public.log_wellbeing_change();

-- 마지막 변경이 '본인이 끔'인가 (그러면 본인이 다시 켤 수 있다)
create or replace function public.wellbeing_self_off(p_member uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select not c.value and c.how = 'self'
      from public.wellbeing_changes c
     where c.member_id = p_member
     order by c.created_at desc, c.id
     limit 1), false);
$$;
revoke execute on function public.wellbeing_self_off(uuid) from public, anon, authenticated;

-- ============================================================
-- 3. 본인 켜기·끄기 (0001을 다시 정의: 켜는 조건을 더함)
-- ============================================================
-- p_on = true : 요청이 와 있으면 '좋아요'(consent), 아니면 본인이 껐던 곳만 다시 켬. 그 밖에는 request_required.
-- p_on = false: 켜져 있으면 끔(self). 요청이 와 있으면 '아니요'(declined_at 남김).
create or replace function public.set_my_wellbeing(p_group uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
declare m public.members;
begin
  select * into m from public.members
   where group_id = p_group and user_id = auth.uid() and status = 'active'
   for update;
  if not found then
    raise exception 'not_member';
  end if;

  if p_on and not m.wellbeing_check then
    if m.wellbeing_requested_at is not null then
      perform set_config('app.wellbeing_how', 'consent', true);
    elsif not public.wellbeing_self_off(m.id) then
      raise exception 'request_required';
    end if;
  end if;

  update public.members
     set wellbeing_check = p_on,
         wellbeing_requested_at = null,
         -- 켜면 안내도 본 것으로 (동의 화면·다시 켜기에서 이미 설명을 봤다)
         wellbeing_intro_at = case when p_on then coalesce(m.wellbeing_intro_at, now()) else m.wellbeing_intro_at end,
         wellbeing_declined_at = case when not p_on and m.wellbeing_requested_at is not null
                                      then now() else m.wellbeing_declined_at end
   where id = m.id;

  perform set_config('app.wellbeing_how', '', true);
end;
$$;

-- 쉬운 화면 '내 안부 확인' 스위치 하나 (결정 1). 끄면 켜진 모든 가족에서, 켜면 본인이 껐던 가족에서만. 바뀐 수를 돌려준다.
create or replace function public.set_my_wellbeing_all(p_on boolean)
returns int language plpgsql security definer set search_path = public as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select m.id, m.group_id from public.members m
      join public.groups g on g.id = m.group_id and g.status = 'active'
     where m.user_id = auth.uid() and m.status = 'active'
       and m.wellbeing_check is distinct from p_on
       and (not p_on or public.wellbeing_self_off(m.id))
  loop
    perform public.set_my_wellbeing(r.group_id, p_on);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- 쉬운 화면 동의 화면: 와 있는 켜기 요청 모두에 '좋아요'(true) 또는 '아니요'(false). 답한 수를 돌려준다.
create or replace function public.answer_wellbeing_requests(p_yes boolean)
returns int language plpgsql security definer set search_path = public as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select m.group_id from public.members m
     where m.user_id = auth.uid() and m.status = 'active' and m.wellbeing_requested_at is not null
  loop
    perform public.set_my_wellbeing(r.group_id, p_yes);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- 처음 안내를 봤다 (켜진 내 모든 가족)
create or replace function public.wellbeing_seen_intro()
returns void language sql security definer set search_path = public as $$
  update public.members set wellbeing_intro_at = now()
   where user_id = auth.uid() and status = 'active' and wellbeing_check and wellbeing_intro_at is null;
$$;

-- ============================================================
-- 4. 관리자: 켜기 요청(7일 제한) · 끄기
-- ============================================================
create or replace function public.request_wellbeing(p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m public.members;
begin
  select * into m from public.members where id = p_member and status = 'active';
  if not found or not public.is_group_admin(m.group_id) then
    raise exception 'forbidden';
  end if;
  if m.wellbeing_declined_at > now() - interval '7 days' then
    raise exception 'recently_declined';
  end if;
  update public.members set wellbeing_requested_at = now()
   where id = p_member and not wellbeing_check;
end;
$$;

create or replace function public.stop_wellbeing(p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_group uuid;
begin
  select group_id into v_group from public.members where id = p_member and status = 'active';
  if v_group is null or not public.is_group_admin(v_group) then
    raise exception 'forbidden';
  end if;
  perform set_config('app.wellbeing_how', 'admin', true);
  update public.members set wellbeing_check = false, wellbeing_requested_at = null where id = p_member;
  perform set_config('app.wellbeing_how', '', true);
end;
$$;

-- ============================================================
-- 5. 내 상태
-- ============================================================
-- 안부 확인이 한 번이라도 있었던(켜짐·요청·기록) 내 가족만. 한 번도 없으면 빈 목록 → 화면에 칸을 안 보인다.
create or replace function public.my_wellbeing()
returns table (group_id uuid, group_name text, member_id uuid, is_on boolean, requested boolean,
               can_turn_on boolean, ever_on boolean, intro_needed boolean, days int)
language sql stable security definer set search_path = public as $$
  select m.group_id, g.name, m.id, m.wellbeing_check,
         m.wellbeing_requested_at is not null,
         not m.wellbeing_check and public.wellbeing_self_off(m.id),
         exists (select 1 from public.wellbeing_changes c where c.member_id = m.id and c.value),
         m.wellbeing_check and m.wellbeing_intro_at is null,
         g.wellbeing_days
    from public.members m
    join public.groups g on g.id = m.group_id and g.status = 'active'
   where m.user_id = auth.uid() and m.status = 'active'
     and (m.wellbeing_check or m.wellbeing_requested_at is not null
          or exists (select 1 from public.wellbeing_changes c where c.member_id = m.id))
   order by m.joined_at;
$$;

-- ============================================================
-- 6. 끔 알림 (notify 함수가 service role로 부른다)
-- ============================================================
-- 그 사람이 방금(10분 안) 스스로 끈 기록 중 아직 안 알린 것을 '알림'으로 표시하며 가족별로 하나씩 돌려준다.
-- 보내기에 실패하면 notify가 notified_at을 다시 비운다.
create or replace function public.claim_wellbeing_off_notices(p_user uuid)
returns table (change_ids uuid[], group_id uuid, group_name text, target_name text, admin_ids uuid[])
language sql security definer set search_path = public as $$
  with claimed as (
    update public.wellbeing_changes c set notified_at = now()
     where c.user_id = p_user and c.how = 'self' and not c.value
       and c.notified_at is null and c.created_at > now() - interval '10 minutes'
    returning c.id, c.group_id
  )
  select array_agg(cl.id), cl.group_id, g.name, public.member_name(cl.group_id, p_user),
         array(select a.user_id from public.members a
                where a.group_id = cl.group_id and a.status = 'active' and a.is_admin and a.user_id <> p_user)
    from claimed cl
    join public.groups g on g.id = cl.group_id
   group by cl.group_id, g.name;
$$;

-- 쉬운 화면을 쓰는 관리자에게 밤에 가는 끔 알림도 아침 알림으로 모을 수 있게 종류를 더한다 (0009)
alter table public.night_queue drop constraint if exists night_queue_kind_check;
alter table public.night_queue add constraint night_queue_kind_check
  check (kind in ('new_post', 'heart', 'seen', 'joined', 'admin_changed', 'wellbeing_off'));

-- ============================================================
-- 7. 함수 실행 권한
-- ============================================================
revoke execute on function public.set_my_wellbeing_all(boolean)       from public, anon;
revoke execute on function public.answer_wellbeing_requests(boolean)  from public, anon;
revoke execute on function public.wellbeing_seen_intro()              from public, anon;
revoke execute on function public.stop_wellbeing(uuid)                from public, anon;
revoke execute on function public.my_wellbeing()                      from public, anon;
revoke execute on function public.claim_wellbeing_off_notices(uuid)   from public, anon, authenticated;
grant  execute on function public.set_my_wellbeing_all(boolean)       to authenticated;
grant  execute on function public.answer_wellbeing_requests(boolean)  to authenticated;
grant  execute on function public.wellbeing_seen_intro()              to authenticated;
grant  execute on function public.stop_wellbeing(uuid)                to authenticated;
grant  execute on function public.my_wellbeing()                      to authenticated;
grant  execute on function public.claim_wellbeing_off_notices(uuid)   to service_role;
