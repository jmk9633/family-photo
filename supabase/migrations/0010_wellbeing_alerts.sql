-- 0010: 안부 알림 보내기와 응답 (개발 7-1, F-QHORLL·F-QEMORX, 10/20 결정 "추천대로")
--
-- 0001에 이미 있는 것: groups.wellbeing_days, members.wellbeing_check, wellbeing_alerts,
--   run_wellbeing_check()(매일 판단 → check/nudge 기록), respond_wellbeing()(전화하기·괜찮아요).
-- 여기서 더하는 것:
--   1) 구성원 전화번호 (관리자가 넣고 관리자만 본다, 선택 사항) — '전화하기'에 쓴다. (결정 1-A)
--   2) 안부 알림 푸시: 판단 뒤 관리자에게 pg_net으로 Expo 푸시를 바로 보낸다 (0009와 같은 방식, 결정 2-A).
--        안부 알림 '엄마가 3일째 새 사진을 안 보셨어요' / '안부 전화 드려볼까요? 응급 상황 알림은 아니에요'
--        넛지     '요즘 보낸 사진이 없어요' / '엄마에게 새 사진을 보내 드려 볼까요?'
--      이름은 그 그룹에서 대상자의 이름. 대상자 본인이 관리자여도 본인에게는 보내지 않는다.
--   3) 자동으로 닫기: 대상자가 다시 활동하면 그 사람의 열린 알림을 닫는다(명세 '무활동 구간 종료').
--      그룹에 새 묶음이 올라오면 그 그룹의 넛지를 닫는다. 안부 확인이 꺼졌거나 나간 사람의 알림은 판단 때 닫는다.
--   4) 사진 탭 위 안부 띠에 쓸 my_wellbeing_alerts() (관리자 본인 그룹의 열린 알림 + 전화번호).
--   5) pg_cron 'wellbeing-daily' 매일 01:00 UTC = 10:00 KST.
-- '위험', '이상 징후' 같은 표현은 쓰지 않는다 (CLAUDE.md 화면 규칙).

-- ============================================================
-- 1. 구성원 전화번호
-- ============================================================
create table public.member_phones (
  member_id   uuid primary key references public.members(id) on delete cascade,
  group_id    uuid not null references public.groups(id) on delete cascade,
  phone       text not null check (phone ~ '^[0-9]{9,11}$'),   -- 숫자만 (010xxxxxxxx, 02xxxxxxx 등)
  updated_by  uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);
alter table public.member_phones enable row level security;
revoke all on public.member_phones from anon, authenticated;
grant select on public.member_phones to authenticated;

-- 관리자만 본다 (같은 그룹 다른 구성원·다른 그룹 사용자는 못 본다)
create policy member_phones_select_admin on public.member_phones for select to authenticated
  using (public.is_group_admin(group_id));

-- 관리자가 구성원 전화번호를 넣거나 지운다 (빈 값이면 지움). 하이픈·띄어쓰기는 빼고 숫자만 저장한다.
create or replace function public.set_member_phone(p_member uuid, p_phone text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_group uuid;
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  select group_id into v_group from public.members where id = p_member and status = 'active';
  if v_group is null or not public.is_group_admin(v_group) then
    raise exception 'forbidden';
  end if;
  if v_phone = '' then
    delete from public.member_phones where member_id = p_member;
    return;
  end if;
  if v_phone !~ '^0[0-9]{8,10}$' then
    raise exception 'invalid_phone';
  end if;
  insert into public.member_phones (member_id, group_id, phone, updated_by, updated_at)
  values (p_member, v_group, v_phone, auth.uid(), now())
  on conflict (member_id) do update
    set phone = excluded.phone, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end;
$$;
revoke execute on function public.set_member_phone(uuid, text) from public, anon;
grant  execute on function public.set_member_phone(uuid, text) to authenticated;

-- ============================================================
-- 2. 문구에 쓰는 값
-- ============================================================
-- 마지막 활동(없으면 합류 시각)부터 며칠째인지 (설정 기간보다 작게 쓰지 않는다)
create or replace function public.wellbeing_inactive_days(p_group uuid, p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  select greatest(
           g.wellbeing_days,
           floor(extract(epoch from (now() - coalesce(p.last_active_at, m.joined_at))) / 86400)::int)
    from public.members m
    join public.groups g   on g.id = m.group_id
    join public.profiles p on p.id = m.user_id
   where m.group_id = p_group and m.user_id = p_user;
$$;
revoke execute on function public.wellbeing_inactive_days(uuid, uuid) from public, anon, authenticated;

-- 그 그룹에서 대상자의 이름 (없으면 '가족')
create or replace function public.member_name(p_group uuid, p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim((select display_name from public.members
                                 where group_id = p_group and user_id = p_user)), ''), '가족');
$$;
revoke execute on function public.member_name(uuid, uuid) from public, anon, authenticated;

-- ============================================================
-- 3. 판단: 꺼졌거나 나간 사람의 열린 알림을 닫는다 (0001 판단에 앞부분만 더함)
-- ============================================================
create or replace function public.run_wellbeing_check()
returns void language plpgsql security definer set search_path = public as $$
declare
  r      record;
  v_last timestamptz;
  v_new  boolean;
begin
  update public.wellbeing_alerts a set closed_at = now()
   where a.closed_at is null
     and not exists (
       select 1 from public.members m
        where m.group_id = a.group_id and m.user_id = a.target_user_id
          and m.status = 'active' and m.wellbeing_check);

  for r in
    select m.group_id, m.user_id, m.joined_at, g.wellbeing_days, p.last_active_at
    from public.members m
    join public.groups g   on g.id = m.group_id
    join public.profiles p on p.id = m.user_id
    where m.status = 'active' and m.wellbeing_check and g.status = 'active'
  loop
    v_last := coalesce(r.last_active_at, r.joined_at);

    if v_last > now() - make_interval(days => r.wellbeing_days) then
      update public.wellbeing_alerts set closed_at = now()
       where group_id = r.group_id and target_user_id = r.user_id and closed_at is null;
      continue;
    end if;

    -- 이미 열려 있거나, 닫힌 지('괜찮아요' 등) 기간이 지나지 않았으면 새로 만들지 않는다
    if exists (
      select 1 from public.wellbeing_alerts a
      where a.group_id = r.group_id and a.target_user_id = r.user_id
        and (a.closed_at is null or a.closed_at > now() - make_interval(days => r.wellbeing_days))
    ) then
      continue;
    end if;

    select exists (
      select 1 from public.post_groups pg
      join public.posts po on po.id = pg.post_id
      where pg.group_id = r.group_id and po.status = 'ready'
        and po.sender_id <> r.user_id and po.created_at > v_last
    ) into v_new;

    insert into public.wellbeing_alerts (group_id, target_user_id, kind)
    values (r.group_id, r.user_id, case when v_new then 'check' else 'nudge' end)
    on conflict do nothing;
  end loop;
end;
$$;
revoke execute on function public.run_wellbeing_check() from public, anon, authenticated;

-- ============================================================
-- 4. 푸시: 아직 안 보낸 열린 알림 → 그 그룹 관리자(대상자 제외)
-- ============================================================
-- 보낼 내용 (한 알림 × 받는 관리자 한 줄). 보내지는 않는다 → 테스트할 수 있게 나눠 둔다.
create or replace function public.wellbeing_push_messages()
returns table (alert_id uuid, user_id uuid, title text, body text, data jsonb)
language sql stable security definer set search_path = public as $$
  select a.id, m.user_id,
         case a.kind
           when 'check' then public.ko_iga(public.member_name(a.group_id, a.target_user_id))
                              || ' ' || public.wellbeing_inactive_days(a.group_id, a.target_user_id)
                              || '일째 새 사진을 안 보셨어요'
           else '요즘 보낸 사진이 없어요'
         end,
         case a.kind
           when 'check' then '안부 전화 드려볼까요? 응급 상황 알림은 아니에요'
           else public.member_name(a.group_id, a.target_user_id) || '에게 새 사진을 보내 드려 볼까요?'
         end,
         jsonb_build_object('kind', 'wellbeing', 'alertKind', a.kind,
                            'alertId', a.id, 'groupId', a.group_id)
    from public.wellbeing_alerts a
    join public.members m
      on m.group_id = a.group_id and m.status = 'active' and m.is_admin
     and m.user_id <> a.target_user_id
   where a.closed_at is null and a.pushed_at is null;
$$;
revoke execute on function public.wellbeing_push_messages() from public, anon, authenticated;

-- 보내고 pushed_at을 남긴다. 같은 토큰이 여러 계정에 있으면 가장 최근에 쓴 계정에만 (0009와 같음).
create or replace function public.send_wellbeing_pushes()
returns int language plpgsql security definer set search_path = public, extensions as $$
declare
  v_msgs jsonb;
  v_ids  uuid[];
begin
  select array_agg(id) into v_ids
    from public.wellbeing_alerts where closed_at is null and pushed_at is null;
  if v_ids is null then
    return 0;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'to', d.push_token, 'sound', 'default', 'title', w.title, 'body', w.body, 'data', w.data)), '[]'::jsonb)
    into v_msgs
    from public.wellbeing_push_messages() w
    join (
      select distinct on (push_token) push_token, user_id
        from public.devices
       where status = 'active' and push_token is not null
       order by push_token, last_seen_at desc nulls last
    ) d on d.user_id = w.user_id
   where w.alert_id = any(v_ids);

  if jsonb_array_length(v_msgs) > 0 then
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      body := v_msgs,
      headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb
    );
  end if;

  update public.wellbeing_alerts set pushed_at = now() where id = any(v_ids);
  return jsonb_array_length(v_msgs);
end;
$$;
revoke execute on function public.send_wellbeing_pushes() from public, anon, authenticated;

-- 매일 10시: 판단 → 보내기
create or replace function public.wellbeing_daily()
returns int language plpgsql security definer set search_path = public as $$
begin
  perform public.run_wellbeing_check();
  return public.send_wellbeing_pushes();
end;
$$;
revoke execute on function public.wellbeing_daily() from public, anon, authenticated;

-- ============================================================
-- 5. 자동으로 닫기
-- ============================================================
-- 대상자가 다시 활동하면 (앱 열기·시청·하트·보내기 → profiles.last_active_at) 그 사람의 열린 알림을 닫는다
create or replace function public.close_wellbeing_on_active()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.last_active_at is not null
     and (old.last_active_at is null or new.last_active_at > old.last_active_at) then
    update public.wellbeing_alerts set closed_at = now()
     where target_user_id = new.id and closed_at is null and started_at < new.last_active_at;
  end if;
  return null;
end;
$$;
revoke all on function public.close_wellbeing_on_active() from public, anon, authenticated;
create trigger profiles_close_wellbeing
  after update of last_active_at on public.profiles
  for each row execute function public.close_wellbeing_on_active();

-- 그룹에 새 묶음이 올라오면 그 그룹의 넛지('요즘 보낸 사진이 없어요')를 닫는다
create or replace function public.close_nudge_on_post()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'ready' and old.status is distinct from 'ready' then
    update public.wellbeing_alerts a set closed_at = now()
     where a.kind = 'nudge' and a.closed_at is null
       and a.group_id in (select pg.group_id from public.post_groups pg where pg.post_id = new.id);
  end if;
  return null;
end;
$$;
revoke all on function public.close_nudge_on_post() from public, anon, authenticated;
create trigger posts_close_nudge
  after update of status on public.posts
  for each row execute function public.close_nudge_on_post();

-- ============================================================
-- 6. 사진 탭 위 안부 띠
-- ============================================================
-- 내가 관리자인 그룹의 열린 알림 (대상이 나인 것은 빼고). 전화번호는 넣어 둔 경우만.
create or replace function public.my_wellbeing_alerts()
returns table (alert_id uuid, group_id uuid, group_name text, kind text,
               target_name text, target_member_id uuid, days int, phone text, started_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.group_id, g.name, a.kind,
         public.member_name(a.group_id, a.target_user_id), t.id,
         public.wellbeing_inactive_days(a.group_id, a.target_user_id),
         ph.phone, a.started_at
    from public.wellbeing_alerts a
    join public.groups g on g.id = a.group_id
    join public.members me
      on me.group_id = a.group_id and me.user_id = auth.uid()
     and me.status = 'active' and me.is_admin
    left join public.members t
      on t.group_id = a.group_id and t.user_id = a.target_user_id and t.status = 'active'
    left join public.member_phones ph on ph.member_id = t.id
   where a.closed_at is null and a.target_user_id <> auth.uid()
   order by a.started_at desc;
$$;
revoke execute on function public.my_wellbeing_alerts() from public, anon;
grant  execute on function public.my_wellbeing_alerts() to authenticated;

-- ============================================================
-- 7. 예약 작업: 매일 10:00 KST (01:00 UTC)
-- ============================================================
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('wellbeing-daily', '0 1 * * *', 'select public.wellbeing_daily()');
  end if;
end;
$$;
