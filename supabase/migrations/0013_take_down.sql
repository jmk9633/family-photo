-- 0013: 관리자가 사진 내리기 · 내보낼 때 그 사람 사진도 지우기 (개발 7-4, F-LMXBXX, 10/25 결정)
--
--   1) take_down_post(묶음): 관리자가 남이 보낸 사진을 '가족 앨범에서 내린다'.
--      - 내가 관리자인 그룹에서만 뺀다. 내가 관리자가 아닌 다른 그룹에도 보낸 묶음이면 그 그룹에는 남는다.
--      - 더 남는 그룹이 없으면 묶음을 'deleting'(아무에게도 안 보임)으로 바꾸고, 파일은 새벽 정리(0012)가 지운다.
--        (관리자 폰은 남의 파일을 직접 지울 수 없다 — 저장소 삭제는 보낸 사람만)
--      - 보낸 사람에게 알리지 않는다.
--   2) remove_member(구성원, 사진도 지울지): 0007의 remove_member(uuid)를 바꾼다.
--      p_delete_posts = true면 그 사람이 이 그룹에 보낸 묶음을 leave_group '내 사진도 지우기'와 같은 방식으로 처리한다:
--      다른 그룹에도 보낸 묶음은 이 그룹에서만 빼고, 이 그룹에만 보낸 묶음은 'deleting' → 새벽 정리가 파일과 함께 지운다.
--      기본값은 false(사진은 남김, 앱도 [남기기]를 기본으로 보여준다).
--   가입 없이 쓰는 사람(익명)은 관리자 태그가 있어도 둘 다 못 한다 (쉬운 화면에는 관리자 메뉴가 없다).
--
--   본인이 보낸 사진 지우기는 지금처럼 앱의 deleteMyPost(본인 = 보낸 사람)로 한다. 쉬운 화면에도 버튼을 더한다(7-4 앱).

-- ============================================================
-- 1. 관리자가 사진 내리기
-- ============================================================
create or replace function public.take_down_post(p_post uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_groups uuid[];
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if public.is_anonymous_user() then
    raise exception 'anonymous_not_allowed';
  end if;
  perform 1 from public.posts where id = p_post and status = 'ready' for update;
  if not found then
    raise exception 'not_found';
  end if;

  select coalesce(array_agg(pg.group_id), '{}') into v_groups
    from public.post_groups pg
   where pg.post_id = p_post and public.is_group_admin(pg.group_id);
  if cardinality(v_groups) = 0 then
    raise exception 'forbidden';
  end if;

  if exists (select 1 from public.post_groups pg
              where pg.post_id = p_post and pg.group_id <> all(v_groups)) then
    -- 내가 관리자가 아닌 그룹에도 보낸 묶음: 내 그룹에서만 뺀다
    delete from public.post_groups where post_id = p_post and group_id = any(v_groups);
    return jsonb_build_object('removed', 'groups');
  end if;

  update public.posts set status = 'deleting' where id = p_post;
  return jsonb_build_object('removed', 'post');
end;
$$;

-- ============================================================
-- 2. 내보내기 (사진도 지울지)
-- ============================================================
drop function public.remove_member(uuid);

create or replace function public.remove_member(p_member uuid, p_delete_posts boolean default false)
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

  if coalesce(p_delete_posts, false) then
    -- 다른 그룹에도 보낸 묶음: 이 그룹 연결만 끊는다
    delete from public.post_groups pg
     using public.posts p
     where pg.post_id = p.id
       and p.sender_id = v_m.user_id
       and pg.group_id = v_m.group_id
       and exists (select 1 from public.post_groups o where o.post_id = p.id and o.group_id <> v_m.group_id);
    -- 이 그룹에만 보낸 묶음: 바로 안 보이게 하고 새벽 정리가 파일과 함께 지운다
    update public.posts p set status = 'deleting'
     where p.sender_id = v_m.user_id
       and exists (select 1 from public.post_groups pg where pg.post_id = p.id and pg.group_id = v_m.group_id);
  end if;

  update public.members set status = 'removed', left_at = now() where id = p_member;
end;
$$;

revoke execute on function public.take_down_post(uuid)              from public, anon;
revoke execute on function public.remove_member(uuid, boolean)      from public, anon;
grant  execute on function public.take_down_post(uuid)              to authenticated;
grant  execute on function public.remove_member(uuid, boolean)      to authenticated;
