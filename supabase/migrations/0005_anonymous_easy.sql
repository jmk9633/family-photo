-- 0005: 가입 없이 연결한 사용자(Supabase 익명 로그인) — 개발 6단계 쉬운 모드 연결 (10/18)
--
-- 쉬운 화면 사용자는 앱 첫 화면에서 숫자 6자리를 누르고 '연결하기'를 누를 때 익명 계정을 만들고
-- redeem_invite로 합류한다. 틀려도 같은 익명 계정을 계속 쓰므로 '10분에 5번' 제한이 그대로 걸린다.
--
--   1) is_anonymous_user(): 지금 부른 사람이 익명 로그인인지 (JWT의 is_anonymous)
--   2) create_group·create_invite: 익명 사용자는 못 부른다 → 'anonymous_not_allowed'
--      (reissue_invite는 안에서 create_invite를 부르므로 함께 막힌다)
--   3) redeem_invite: 익명 사용자가 합류하면 초대 태그와 상관없이 profiles.easy_mode = true
--   4) 익명 사용자는 easy_mode를 끌 수 없다 ('일반 화면으로 바꾸기'는 계정이 있는 사람만) → 'anonymous_easy_only'
--
-- 함수 본문은 0001과 같고 위의 검사만 더했다 (0001은 원격에 적용돼 수정 금지).

create or replace function public.is_anonymous_user()
returns boolean language sql stable set search_path = public as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;
grant execute on function public.is_anonymous_user() to authenticated;

create or replace function public.create_group(p_name text, p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_me   text := public.clean_display_name(p_display_name);
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if public.is_anonymous_user() then
    raise exception 'anonymous_not_allowed';   -- 가입 없이 연결한 사람은 그룹·초대를 만들지 못한다
  end if;
  if char_length(v_name) not between 1 and 40 then
    raise exception 'invalid_group_name';
  end if;

  insert into public.groups (name, created_by) values (v_name, v_uid) returning id into v_id;
  insert into public.members (group_id, user_id, display_name, is_admin)
  values (v_id, v_uid, v_me, true);
  update public.profiles set display_name = v_me where id = v_uid and display_name = '';
  return v_id;
end;
$$;

create or replace function public.create_invite(
  p_group uuid, p_display_name text,
  p_is_admin boolean default false, p_easy_mode boolean default false, p_wellbeing boolean default false)
returns table (invite_id uuid, code text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_id   uuid;
  v_name text;
  v_exp  timestamptz := public.invite_expiry();
begin
  if not public.is_group_admin(p_group) then
    raise exception 'forbidden';
  end if;
  if public.is_anonymous_user() then
    raise exception 'anonymous_not_allowed';   -- 가입 없이 연결한 사람은 그룹·초대를 만들지 못한다
  end if;
  v_name := public.clean_display_name(p_display_name);
  for i in 1..20 loop
    -- gen_random_uuid()는 암호학적 난수라 코드 추측이 어렵다 (bigint로 바꿔 abs 범위 오류 방지)
    v_code := lpad((abs(('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::int::bigint) % 1000000)::text, 6, '0');
    begin
      insert into public.invites (group_id, code, display_name, preset_is_admin, preset_easy_mode,
                                  preset_wellbeing_check, created_by, expires_at)
      values (p_group, v_code, v_name, p_is_admin, p_easy_mode, p_wellbeing, auth.uid(), v_exp)
      returning id into v_id;
      return query select v_id, v_code, v_exp;
      return;
    exception when unique_violation then
      -- 이미 기록에 있는 번호면 다시 뽑는다
    end;
  end loop;
  raise exception 'code_generation_failed';
end;
$$;

create or replace function public.redeem_invite(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_inv    public.invites;
  v_recent int;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- 같은 사람이 동시에 여러 번 보내 제한을 넘는 것 방지
  perform pg_advisory_xact_lock(hashtext('redeem:' || v_uid::text));
  select count(*) into v_recent from public.invite_attempts
  where user_id = v_uid and attempted_at > now() - interval '10 minutes';
  if v_recent >= 5 then
    return jsonb_build_object('status', 'too_many_attempts');
  end if;
  insert into public.invite_attempts (user_id) values (v_uid);

  select * into v_inv from public.invites where code = btrim(coalesce(p_code, '')) for update;
  if not found or not exists (select 1 from public.groups g where g.id = v_inv.group_id and g.status = 'active') then
    return jsonb_build_object('status', 'invalid');
  end if;
  if exists (select 1 from public.members m
             where m.group_id = v_inv.group_id and m.user_id = v_uid and m.status = 'active') then
    return jsonb_build_object('status', 'ok', 'group_id', v_inv.group_id);
  end if;
  if v_inv.revoked_at is not null then
    return jsonb_build_object('status', 'revoked');
  end if;
  if v_inv.used_at is not null then
    return jsonb_build_object('status', 'used');
  end if;
  if v_inv.expires_at <= now() then
    return jsonb_build_object('status', 'expired');
  end if;
  if (select count(*) from public.members m
      where m.group_id = v_inv.group_id and m.status = 'active') >= 50 then
    return jsonb_build_object('status', 'group_full');
  end if;

  -- 나갔던 사람이 다시 초대받은 경우 이 초대의 이름·태그로 새로 시작한다
  insert into public.members (group_id, user_id, display_name, is_admin, easy_mode, wellbeing_check)
  values (v_inv.group_id, v_uid, v_inv.display_name,
          v_inv.preset_is_admin, v_inv.preset_easy_mode, v_inv.preset_wellbeing_check)
  on conflict (group_id, user_id) do update
    set status = 'active', left_at = null, joined_at = now(),
        display_name = excluded.display_name,
        is_admin = excluded.is_admin,
        easy_mode = excluded.easy_mode,
        wellbeing_check = excluded.wellbeing_check,
        wellbeing_requested_at = null;

  update public.invites set used_by = v_uid, used_at = now() where id = v_inv.id;

  -- 가입 없이 연결한 사람은 초대 태그와 상관없이 늘 쉬운 화면으로 연다 (10/18 결정 4)
  if v_inv.preset_easy_mode or public.is_anonymous_user() then
    update public.profiles set easy_mode = true where id = v_uid;
  end if;

  return jsonb_build_object('status', 'ok', 'group_id', v_inv.group_id);
end;
$$;

-- 익명 사용자는 쉬운 화면을 끌 수 없다
create or replace function public.guard_anonymous_easy_mode()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.easy_mode and not new.easy_mode and public.is_anonymous_user() then
    raise exception 'anonymous_easy_only';
  end if;
  return new;
end;
$$;
create trigger profiles_anonymous_easy_mode
  before update of easy_mode on public.profiles
  for each row execute function public.guard_anonymous_easy_mode();
