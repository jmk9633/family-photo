-- 0008: 관리자는 계정이 있는 사람에게만 넘긴다 (10/18 결정 A, F-LMXBXX 보완)
--
-- 가입 없이 연결한 사람(익명)은 초대·내보내기를 못 하고 쉬운 화면에는 관리자 메뉴도 없어서,
-- 관리자가 되어도 그룹을 관리할 수 없다. 그래서
--   1) 계정이 있는 활성 관리자가 0명이 되면, 계정이 있는 활성 구성원 중 가장 먼저 들어온 사람에게 넘긴다.
--      계정이 있는 사람이 아무도 없으면 넘기지 않는다 (관리자 없음. 사진 보기·보내기는 그대로).
--   2) leave_warning(그룹): 내가 나가면 관리할 사람이 없어지는지 미리 알려준다 (나가기 확인 화면의 경고).
-- 계정 여부는 auth.users.is_anonymous로 본다.

create or replace function public.is_account_user(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from auth.users u where u.id = uid and not coalesce(u.is_anonymous, false));
$$;
revoke execute on function public.is_account_user(uuid) from public, anon, authenticated;

create or replace function public.ensure_group_admin()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_next uuid;
begin
  if not exists (
    select 1 from public.members
    where group_id = new.group_id and status = 'active' and is_admin and public.is_account_user(user_id)
  ) then
    select id into v_next from public.members
     where group_id = new.group_id and status = 'active' and public.is_account_user(user_id)
     order by joined_at limit 1;
    if v_next is not null then
      update public.members set is_admin = true where id = v_next;
      insert into public.admin_transfer_log (group_id, member_id) values (new.group_id, v_next);
    end if;
  end if;
  return null;
end;
$$;

-- 내가 나가면: 계정이 있는 다른 사람이 아무도 없어 관리할 사람이 없어지는가 (남는 사람이 있을 때만 참)
create or replace function public.leave_warning(p_group uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if not public.is_group_member(p_group) then
    raise exception 'not_member';
  end if;
  return jsonb_build_object(
    'no_manager',
    exists (select 1 from public.members where group_id = p_group and status = 'active' and user_id <> v_uid)
    and not exists (
      select 1 from public.members
      where group_id = p_group and status = 'active' and user_id <> v_uid and public.is_account_user(user_id)
    )
  );
end;
$$;
revoke execute on function public.leave_warning(uuid) from public, anon;
grant execute on function public.leave_warning(uuid) to authenticated;
