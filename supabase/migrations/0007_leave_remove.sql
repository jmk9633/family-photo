-- 0007: 그룹 나가기와 내보내기 (F-LMXBXX, 개발 6단계 중 10/18 사용자 요청)
--
--   1) leave_group(그룹, 내 사진도 지울지): 스스로 나간다. 올린 사진은 기본으로 그룹에 남는다.
--      '내 사진도 지우기'를 고르면
--        - 다른 그룹에도 보낸 묶음은 이 그룹 연결만 끊는다 (다른 그룹에는 남는다)
--        - 이 그룹에만 보낸 묶음은 바로 'deleting'으로 바꿔 아무에게도 안 보이게 하고 ID를 돌려준다
--          → 앱이 파일(저장소)과 묶음을 지운다. 앱이 못 지운 것은 7단계 정리 작업이 지운다.
--      마지막 한 명이 나가면 그룹을 보관(archived)한다 (0001과 같음).
--   2) remove_member(구성원): 관리자가 다른 구성원을 내보낸다 (status = 'removed'). 본인은 나가기로.
--      가입 없이 연결한 사람(익명)은 관리자 태그가 있어도 못 한다.
--   3) 관리자가 0명이 되면 가장 먼저 들어온 구성원에게 넘긴다 (0001 ensure_group_admin).
--      넘길 때 admin_transfer_log에 남겨, 앱이 notify(admin_changed)를 부르면 새 관리자와 그룹에 한 번 알린다.
--
-- 0001의 leave_group(uuid)은 원격에 적용돼 있어 파일은 고치지 않고 여기서 지우고 새로 만든다 (앱에서 아직 안 씀).

-- 묶음 상태에 'deleting' 추가 (지우는 중: 아무에게도 안 보인다. 목록은 ready만 읽는다)
alter table public.posts drop constraint posts_status_check;
alter table public.posts add constraint posts_status_check
  check (status in ('uploading', 'ready', 'deleting'));

-- 관리자 자동 이전 기록 (알림 한 번만). 앱은 읽지도 쓰지도 못한다.
create table public.admin_transfer_log (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups(id) on delete cascade,
  member_id   uuid not null references public.members(id) on delete cascade,
  created_at  timestamptz not null default now(),
  notified_at timestamptz
);
alter table public.admin_transfer_log enable row level security;
revoke all on public.admin_transfer_log from anon, authenticated;

-- 관리자가 0명이 되면 가장 먼저 들어온 활성 구성원에게 넘기고 기록한다
create or replace function public.ensure_group_admin()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_next uuid;
begin
  if not exists (
    select 1 from public.members
    where group_id = new.group_id and status = 'active' and is_admin
  ) then
    select id into v_next from public.members
     where group_id = new.group_id and status = 'active'
     order by joined_at limit 1;
    if v_next is not null then
      update public.members set is_admin = true where id = v_next;
      insert into public.admin_transfer_log (group_id, member_id) values (new.group_id, v_next);
    end if;
  end if;
  return null;
end;
$$;

drop function public.leave_group(uuid);

create or replace function public.leave_group(p_group uuid, p_delete_my_posts boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[] := '{}';
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if not public.is_group_member(p_group) then
    raise exception 'not_member';
  end if;

  if p_delete_my_posts then
    -- 다른 그룹에도 보낸 내 묶음: 이 그룹 연결만 끊는다
    delete from public.post_groups pg
     using public.posts p
     where pg.post_id = p.id
       and p.sender_id = v_uid
       and pg.group_id = p_group
       and exists (select 1 from public.post_groups o where o.post_id = p.id and o.group_id <> p_group);
    -- 이 그룹에만 보낸 내 묶음: 바로 안 보이게 하고 앱이 파일과 함께 지운다
    with d as (
      update public.posts p set status = 'deleting'
       where p.sender_id = v_uid
         and exists (select 1 from public.post_groups pg where pg.post_id = p.id and pg.group_id = p_group)
      returning p.id
    )
    select coalesce(array_agg(id), '{}') into v_ids from d;
  end if;

  update public.members set status = 'left', left_at = now()
   where group_id = p_group and user_id = v_uid and status = 'active';

  if not exists (select 1 from public.members where group_id = p_group and status = 'active') then
    update public.groups set status = 'archived' where id = p_group;
  end if;

  return jsonb_build_object('deleting', to_jsonb(v_ids));
end;
$$;

create or replace function public.remove_member(p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_m public.members;
begin
  select * into v_m from public.members where id = p_member for update;
  if not found or v_m.status <> 'active' then
    raise exception 'not_member';
  end if;
  if not public.is_group_admin(v_m.group_id) then
    raise exception 'forbidden';
  end if;
  if public.is_anonymous_user() then
    raise exception 'anonymous_not_allowed';
  end if;
  if v_m.user_id = auth.uid() then
    raise exception 'use_leave';   -- 본인은 '그룹 나가기'로
  end if;
  update public.members set status = 'removed', left_at = now() where id = p_member;
end;
$$;

revoke execute on function public.leave_group(uuid, boolean) from public, anon;
revoke execute on function public.remove_member(uuid) from public, anon;
grant execute on function public.leave_group(uuid, boolean) to authenticated;
grant execute on function public.remove_member(uuid) to authenticated;
