-- 0001_init.sql
-- 가족 사진 공유 앱 (가칭) — 초기 스키마
-- 원칙: 모든 테이블 RLS, 그룹 접근 판단은 helper 함수로 통일, 여러 테이블 변경은 RPC로만.
-- 앱이 직접 고칠 수 있는 칸은 7장에서 칸 단위로 제한한다.

create extension if not exists pgcrypto;

-- ============================================================
-- 1. 테이블
-- ============================================================

-- 사람 1명 (카카오·구글·애플·이메일 계정과 익명 사용자 공통)
create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  display_name    text not null default '',            -- 새 그룹·초대에서 기본으로 채울 내 이름 (가입 시 소셜 이름)
  easy_mode       boolean not null default false,      -- 앱을 쉬운 모드로 열지
  show_seen       boolean not null default true,       -- 내 '봤어요'를 다른 사람에게 보여줄지
  weekly_suggest  boolean not null default true,       -- 주간 모음 제안 알림
  last_active_at  timestamptz,                         -- 앱 실행·시청·반응·보내기 때 갱신
  created_at      timestamptz not null default now()
);

-- 사진을 주고받는 단위
create table public.groups (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(name) between 1 and 40),
  status          text not null default 'active' check (status in ('active', 'archived')),
  wellbeing_days  int  not null default 3 check (wellbeing_days in (2, 3, 5, 7)),  -- 안부 기간 선택지
  created_by      uuid not null references public.profiles(id),
  created_at      timestamptz not null default now()
);

-- 사람 × 그룹 + 역할 태그
create table public.members (
  id               uuid primary key default gen_random_uuid(),
  group_id         uuid not null references public.groups(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  display_name     text not null default '',          -- 이 그룹에서 보이는 이름 (그룹마다 다를 수 있음)
  is_admin         boolean not null default false,
  easy_mode        boolean not null default false,
  wellbeing_check  boolean not null default false,
  wellbeing_requested_at timestamptz,               -- 관리자가 안부 확인 다시 켜기를 요청한 시각 (본인 동의 대기)
  status           text not null default 'active' check (status in ('active', 'left', 'removed')),
  joined_at        timestamptz not null default now(),
  left_at          timestamptz,
  unique (group_id, user_id)
);
create index members_user_idx on public.members(user_id) where status = 'active';

-- 초대 1건 (6자리 숫자 코드)
create table public.invites (
  id                      uuid primary key default gen_random_uuid(),
  group_id                uuid not null references public.groups(id) on delete cascade,
  code                    text not null check (code ~ '^[0-9]{6}$'),
  display_name            text not null default '',
  preset_is_admin         boolean not null default false,
  preset_easy_mode        boolean not null default false,
  preset_wellbeing_check  boolean not null default false,
  created_by              uuid not null references public.profiles(id),
  expires_at              timestamptz not null,
  used_by                 uuid references public.profiles(id),
  used_at                 timestamptz,
  revoked_at              timestamptz,                      -- 재발급으로 취소된 시각
  replaced_by             uuid references public.invites(id), -- 재발급된 새 초대
  created_at              timestamptz not null default now()
);
-- 코드 번호는 사용·만료·취소와 관계없이 기록이 남아 있는 동안 다시 발급하지 않는다.
-- (옛 문자에 남은 번호가 다른 그룹에 발급되는 사고 방지. 90일 지난 기록은 정리 작업이 지운다)
create unique index invites_code_idx on public.invites(code);
create index invites_group_idx on public.invites(group_id) where used_at is null and revoked_at is null;

-- 코드 입력 시도 기록 (대입 공격 제한용, RPC만 접근)
create table public.invite_attempts (
  user_id       uuid not null,
  attempted_at  timestamptz not null default now()
);
create index invite_attempts_idx on public.invite_attempts(user_id, attempted_at);

-- 한 번 보낸 사진 묶음
create table public.posts (
  id          uuid primary key default gen_random_uuid(),
  sender_id   uuid not null references public.profiles(id) on delete cascade,
  kind        text not null default 'normal' check (kind in ('normal', 'video_message')),
  title       text check (char_length(title) <= 60),
  tags        text[] not null default '{}',
  status      text not null default 'uploading' check (status in ('uploading', 'ready')),
  created_at  timestamptz not null default now()
);
create index posts_created_idx on public.posts(created_at desc) where status = 'ready';

-- 묶음 × 받는 그룹
create table public.post_groups (
  post_id   uuid not null references public.posts(id) on delete cascade,
  group_id  uuid not null references public.groups(id) on delete cascade,
  primary key (post_id, group_id)
);
create index post_groups_group_idx on public.post_groups(group_id);

-- 묶음 안의 사진·영상
create table public.media (
  id            uuid primary key default gen_random_uuid(),
  post_id       uuid not null references public.posts(id) on delete cascade,
  type          text not null check (type in ('photo', 'video')),
  path          text not null,          -- posts/{post_id}/{media_id}.jpg
  thumb_path    text not null,          -- posts/{post_id}/{media_id}_thumb.jpg
  width         int,
  height        int,
  duration_sec  numeric check (duration_sec is null or duration_sec <= 61),  -- 영상 최대 1분 (+반올림 여유 1초)
  taken_at      timestamptz,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);
create index media_post_idx on public.media(post_id, sort_order);

-- 하트
create table public.reactions (
  media_id    uuid not null references public.media(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (media_id, user_id)
);

-- '봤어요' (묶음 × 사람 × 날짜)
create table public.post_views (
  post_id      uuid not null references public.posts(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  viewed_on    date not null default ((now() at time zone 'Asia/Seoul')::date),
  device_kind  text not null default 'phone' check (device_kind in ('phone', 'tv')),
  primary key (post_id, user_id, viewed_on)
);

-- 폰·TV 기기 (푸시 토큰, TV 연결)
-- TV 앱은 익명 로그인으로 자기 user_id를 가진다.
create table public.devices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  kind          text not null check (kind in ('phone', 'tv')),
  platform      text not null check (platform in ('ios', 'android', 'tizen', 'webos')),
  name          text,
  push_token    text,
  status        text not null default 'active' check (status in ('active', 'revoked')),
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now()
);

-- TV × 연결 그룹 (TV 하나가 여러 그룹에 연결)
create table public.device_groups (
  device_id  uuid not null references public.devices(id) on delete cascade,
  group_id   uuid not null references public.groups(id) on delete cascade,
  primary key (device_id, group_id)
);

-- 안부 알림·넛지 기록
create table public.wellbeing_alerts (
  id              uuid primary key default gen_random_uuid(),
  group_id        uuid not null references public.groups(id) on delete cascade,
  target_user_id  uuid not null references public.profiles(id) on delete cascade,
  kind            text not null check (kind in ('check', 'nudge')),  -- check=안부 알림, nudge=보내기 넛지
  started_at      timestamptz not null default now(),
  response        text check (response in ('called', 'ok')),
  responded_by    uuid references public.profiles(id),
  responded_at    timestamptz,
  pushed_at       timestamptz,                                     -- Edge Function이 푸시를 보낸 시각
  closed_at       timestamptz
);
create unique index wellbeing_one_open_idx
  on public.wellbeing_alerts(group_id, target_user_id, kind) where closed_at is null;

-- 그룹 합치기 요청
create table public.merge_requests (
  id             uuid primary key default gen_random_uuid(),
  from_group_id  uuid not null references public.groups(id) on delete cascade,
  to_group_id    uuid not null references public.groups(id) on delete cascade,
  requested_by   uuid not null references public.profiles(id),
  status         text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at     timestamptz not null default now(),
  decided_at     timestamptz,
  check (from_group_id <> to_group_id)
);

-- ============================================================
-- 2. 접근 판단 helper (security definer: RLS 재귀를 피하려고 정의자 권한으로 조회)
-- ============================================================

-- 활성 구성원인가 (쓰기 권한의 기준)
create or replace function public.is_group_member(gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members m
    where m.group_id = gid and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

-- 볼 수 있는가 (구성원 + 연결된 TV)
create or replace function public.can_view_group(gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_group_member(gid) or exists (
    select 1 from public.device_groups dg
    join public.devices d on d.id = dg.device_id
    where dg.group_id = gid and d.user_id = auth.uid()
      and d.kind = 'tv' and d.status = 'active'
  );
$$;

create or replace function public.is_group_admin(gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members m
    where m.group_id = gid and m.user_id = auth.uid()
      and m.status = 'active' and m.is_admin
  );
$$;

-- 묶음을 볼 수 있는가: 내가 보냈거나, 완료된 묶음이 내가 볼 수 있는 그룹에 있거나
create or replace function public.can_see_post(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.posts p
    where p.id = pid
      and (
        p.sender_id = auth.uid()
        or (p.status = 'ready' and exists (
              select 1 from public.post_groups pg
              where pg.post_id = p.id and public.can_view_group(pg.group_id)))
      )
  );
$$;

-- 같은 그룹의 활성 구성원인가 (다른 사람 프로필 보기)
create or replace function public.shares_group_with(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select uid = auth.uid() or exists (
    select 1 from public.members a
    join public.members b on b.group_id = a.group_id
    where a.user_id = auth.uid() and a.status = 'active'
      and b.user_id = uid and b.status = 'active'
  );
$$;

-- 그 사람의 '봤어요'를 보여줘도 되는가
create or replace function public.seen_visible(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select uid = auth.uid() or coalesce((select p.show_seen from public.profiles p where p.id = uid), false);
$$;

-- 표시 이름 다듬기: 앞뒤 공백 제거, 1~20자가 아니면 오류
create or replace function public.clean_display_name(p_name text)
returns text language plpgsql immutable as $$
declare v text := btrim(coalesce(p_name, ''));
begin
  if char_length(v) not between 1 and 20 then
    raise exception 'invalid_display_name';
  end if;
  return v;
end;
$$;

-- ============================================================
-- 3. 트리거
-- ============================================================

-- 가입(익명 포함) 시 profiles 생성. 카카오·구글 가입이면 그 이름을 기본 표시 이름으로 넣는다.
-- (이메일·익명 가입은 이름이 없어 빈칸 → 그룹 만들기·합류 화면에서 입력받는다)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_name text;
begin
  v_name := btrim(coalesce(
    nullif(btrim(v_meta->>'name'), ''),
    nullif(btrim(v_meta->>'full_name'), ''),
    nullif(btrim(v_meta->>'nickname'), ''),
    nullif(btrim(v_meta->>'preferred_username'), ''),
    ''));
  insert into public.profiles (id, display_name)
  values (new.id, left(v_name, 20))
  on conflict do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- 관리자가 0명이 되면 가장 먼저 합류한 활성 구성원에게 이전
create or replace function public.ensure_group_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.members
    where group_id = new.group_id and status = 'active' and is_admin
  ) then
    update public.members set is_admin = true
    where id = (
      select id from public.members
      where group_id = new.group_id and status = 'active'
      order by joined_at limit 1
    );
  end if;
  return null;
end;
$$;
create trigger members_admin_guard
  after update of status, is_admin on public.members
  for each row execute function public.ensure_group_admin();

-- 안부 확인은 본인만 다시 켤 수 있다 (관리자는 request_wellbeing으로 요청만 한다)
-- auth.uid()가 없는 서버 작업(service role)은 예외
create or replace function public.guard_wellbeing_consent()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.wellbeing_check and not old.wellbeing_check
     and auth.uid() is not null and new.user_id <> auth.uid() then
    raise exception 'consent_required';
  end if;
  return new;
end;
$$;
create trigger members_wellbeing_consent
  before update of wellbeing_check on public.members
  for each row execute function public.guard_wellbeing_consent();

-- 한 묶음은 사진·영상 합쳐 최대 30장
create or replace function public.limit_media_per_post()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.posts where id = new.post_id for update;  -- 동시에 올릴 때 개수 경합 방지
  if (select count(*) from public.media where post_id = new.post_id) >= 30 then
    raise exception 'too_many_media';
  end if;
  return new;
end;
$$;
create trigger media_limit_per_post
  before insert on public.media
  for each row execute function public.limit_media_per_post();

-- ============================================================
-- 4. RLS
-- ============================================================

alter table public.profiles         enable row level security;
alter table public.groups           enable row level security;
alter table public.members          enable row level security;
alter table public.invites          enable row level security;
alter table public.invite_attempts  enable row level security;  -- 정책 없음: RPC만 접근
alter table public.posts            enable row level security;
alter table public.post_groups      enable row level security;
alter table public.media            enable row level security;
alter table public.reactions        enable row level security;
alter table public.post_views       enable row level security;
alter table public.devices          enable row level security;
alter table public.device_groups    enable row level security;
alter table public.wellbeing_alerts enable row level security;
alter table public.merge_requests   enable row level security;

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (public.shares_group_with(id));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- groups: 만들기는 create_group RPC로만 (그룹 + 관리자 구성원을 한 번에)
create policy groups_select on public.groups for select to authenticated
  using (public.can_view_group(id));
create policy groups_update_admin on public.groups for update to authenticated
  using (public.is_group_admin(id)) with check (public.is_group_admin(id));

-- members: 보기는 구성원, 변경은 관리자 (이름·태그 칸만, 7장).
-- 본인 이름 바꾸기·나가기·안부 켜고 끄기는 RPC.
create policy members_select on public.members for select to authenticated
  using (public.can_view_group(group_id));
create policy members_update_admin on public.members for update to authenticated
  using (public.is_group_admin(group_id)) with check (public.is_group_admin(group_id));

-- invites: 관리자만 보기. 만들기·재발급은 서버가 코드를 정하는 RPC로만 (create_invite, reissue_invite)
create policy invites_select_admin on public.invites for select to authenticated
  using (public.is_group_admin(group_id));

-- posts
create policy posts_select on public.posts for select to authenticated
  using (public.can_see_post(id));
create policy posts_insert_self on public.posts for insert to authenticated
  with check (sender_id = auth.uid());
create policy posts_update_self on public.posts for update to authenticated
  using (sender_id = auth.uid()) with check (sender_id = auth.uid());
create policy posts_delete_self on public.posts for delete to authenticated
  using (sender_id = auth.uid());

-- post_groups: 내 묶음을 내가 속한 그룹에만 보낼 수 있다
create policy post_groups_select on public.post_groups for select to authenticated
  using (public.can_view_group(group_id));
create policy post_groups_insert on public.post_groups for insert to authenticated
  with check (
    public.is_group_member(group_id)
    and exists (select 1 from public.posts p where p.id = post_id and p.sender_id = auth.uid())
  );

-- media
create policy media_select on public.media for select to authenticated
  using (public.can_see_post(post_id));
create policy media_insert on public.media for insert to authenticated
  with check (exists (select 1 from public.posts p where p.id = post_id and p.sender_id = auth.uid()));
create policy media_delete on public.media for delete to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and p.sender_id = auth.uid()));

-- reactions
create policy reactions_select on public.reactions for select to authenticated
  using (exists (select 1 from public.media m where m.id = media_id and public.can_see_post(m.post_id)));
create policy reactions_insert_self on public.reactions for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.media m where m.id = media_id and public.can_see_post(m.post_id))
  );
create policy reactions_delete_self on public.reactions for delete to authenticated
  using (user_id = auth.uid());

-- post_views: 기록은 본인만, 보기는 그 사람이 '봤어요'를 켠 경우만
create policy post_views_select on public.post_views for select to authenticated
  using (public.can_see_post(post_id) and public.seen_visible(user_id));
create policy post_views_insert_self on public.post_views for insert to authenticated
  with check (user_id = auth.uid() and public.can_see_post(post_id));

-- devices: 본인 기기만 (관리자의 기기 목록·해제는 RPC로 추가 예정)
create policy devices_select_self on public.devices for select to authenticated
  using (user_id = auth.uid());
create policy devices_insert_self on public.devices for insert to authenticated
  with check (user_id = auth.uid());
create policy devices_update_self on public.devices for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- device_groups: 그 그룹을 볼 수 있으면 보기 (연결은 TV 연결 RPC로 추가 예정)
create policy device_groups_select on public.device_groups for select to authenticated
  using (public.can_view_group(group_id));

-- wellbeing_alerts: 관리자만 보기 (생성은 예약 작업, 응답은 RPC)
create policy wellbeing_select_admin on public.wellbeing_alerts for select to authenticated
  using (public.is_group_admin(group_id));

-- merge_requests
create policy merge_select_admin on public.merge_requests for select to authenticated
  using (public.is_group_admin(from_group_id) or public.is_group_admin(to_group_id));
create policy merge_insert_admin on public.merge_requests for insert to authenticated
  with check (public.is_group_admin(from_group_id) and requested_by = auth.uid());

-- ============================================================
-- 5. RPC (여러 테이블을 함께 바꾸는 동작)
-- ============================================================

-- 그룹 만들기. 만든 사람은 관리자 구성원이 되고, 그 그룹에서 보일 이름을 함께 받는다.
-- 내 기본 이름(profiles.display_name)이 비어 있으면 이 이름으로 채운다.
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

-- 이 그룹에서 보이는 내 이름 바꾸기 (언제든 본인이)
create or replace function public.set_my_display_name(p_group uuid, p_display_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_me text := public.clean_display_name(p_display_name);
begin
  update public.members set display_name = v_me
   where group_id = p_group and user_id = auth.uid() and status = 'active';
  if not found then
    raise exception 'not_member';
  end if;
end;
$$;

-- 초대 만료 시각: 발급일 + 5일 날짜가 끝나는 자정 (한국 시간)
-- 예) 10월 9일 발급 → 10월 14일 23:59:59까지 (= 10월 15일 00:00 KST)
create or replace function public.invite_expiry(p_from timestamptz default now())
returns timestamptz language sql stable as $$
  select (((p_from at time zone 'Asia/Seoul')::date + 6)::timestamp) at time zone 'Asia/Seoul';
$$;

-- 초대 만들기 (관리자). 코드 번호는 서버가 무작위로 정한다.
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

-- 초대 재발급 (관리자). 기존 코드는 즉시 취소하고 같은 이름·태그로 새 코드를 만든다.
-- 이 초대 한 건에만 적용되고, 같은 그룹의 다른 초대는 그대로 둔다.
create or replace function public.reissue_invite(p_invite uuid)
returns table (invite_id uuid, code text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_old public.invites;
  v_new record;
begin
  select * into v_old from public.invites i where i.id = p_invite for update;
  if not found or not public.is_group_admin(v_old.group_id) then
    raise exception 'forbidden';
  end if;
  if v_old.used_at is not null then
    raise exception 'already_used';
  end if;
  if v_old.revoked_at is not null then
    raise exception 'already_revoked';   -- 이미 새 코드로 바뀐 초대 (최신 초대에서 다시 받기)
  end if;

  select * into v_new from public.create_invite(
    v_old.group_id, v_old.display_name,
    v_old.preset_is_admin, v_old.preset_easy_mode, v_old.preset_wellbeing_check);

  update public.invites set revoked_at = now(), replaced_by = v_new.invite_id
   where id = v_old.id;

  return query select v_new.invite_id, v_new.code, v_new.expires_at;
end;
$$;

-- 초대 코드로 합류. 결과는 {status, group_id}
--   ok | invalid | expired | revoked(새 코드로 바뀜) | used | group_full | too_many_attempts
-- 이미 그 그룹의 활성 구성원이면 초대를 쓰지 않고 바로 ok (그룹으로 이동).
-- 10분에 5번까지만 시도할 수 있다. 예외를 던지면 시도 기록도 롤백되므로 실패도 정상 반환한다.
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

  if v_inv.preset_easy_mode then
    update public.profiles set easy_mode = true where id = v_uid;
  end if;

  return jsonb_build_object('status', 'ok', 'group_id', v_inv.group_id);
end;
$$;

-- 그룹 나가기 (올린 사진은 남는다). 마지막 한 명이 나가면 그룹을 보관 상태로 바꾼다.
create or replace function public.leave_group(p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.members set status = 'left', left_at = now()
  where group_id = p_group and user_id = auth.uid() and status = 'active';

  if not exists (select 1 from public.members where group_id = p_group and status = 'active') then
    update public.groups set status = 'archived' where id = p_group;
  end if;
end;
$$;

-- 내 안부 확인 켜고 끄기 (본인은 언제든 끌 수 있다)
-- 관리자의 다시 켜기 요청에 대한 '좋아요'는 p_on = true, '아니요'는 p_on = false. 둘 다 요청을 지운다.
create or replace function public.set_my_wellbeing(p_group uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.members set wellbeing_check = p_on, wellbeing_requested_at = null
  where group_id = p_group and user_id = auth.uid() and status = 'active';
end;
$$;

-- 관리자가 꺼진 안부 확인을 다시 켜 달라고 요청 (대상자 앱에 동의 화면이 뜬다)
create or replace function public.request_wellbeing(p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_group uuid;
begin
  select group_id into v_group from public.members where id = p_member and status = 'active';
  if v_group is null or not public.is_group_admin(v_group) then
    raise exception 'forbidden';
  end if;
  update public.members set wellbeing_requested_at = now()
   where id = p_member and not wellbeing_check;
end;
$$;

-- 안부 알림 응답 ('called' 전화하기, 'ok' 괜찮아요)
create or replace function public.respond_wellbeing(p_alert uuid, p_response text)
returns void language plpgsql security definer set search_path = public as $$
declare v_group uuid;
begin
  if p_response not in ('called', 'ok') then
    raise exception 'invalid_response';
  end if;
  select group_id into v_group from public.wellbeing_alerts where id = p_alert;
  if v_group is null or not public.is_group_admin(v_group) then
    raise exception 'forbidden';
  end if;
  update public.wellbeing_alerts
     set response = p_response, responded_by = auth.uid(),
         responded_at = now(), closed_at = now()
   where id = p_alert and closed_at is null;
end;
$$;

-- ============================================================
-- 6. 예약 작업: 안부 판단 (하루 한 번, service role / pg_cron 전용)
-- ============================================================
-- 활동 = profiles.last_active_at (없으면 합류 시각)
-- 기간 안에 활동이 있으면 열린 알림을 닫는다.
-- 기간 동안 활동이 없고 그 사이 다른 사람이 보낸 묶음이 있으면 'check', 없으면 'nudge'.
-- '괜찮아요' 등으로 닫힌 지 기간이 지나지 않았으면 새로 만들지 않는다.
create or replace function public.run_wellbeing_check()
returns void language plpgsql security definer set search_path = public as $$
declare
  r      record;
  v_last timestamptz;
  v_new  boolean;
begin
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

    if exists (
      select 1 from public.wellbeing_alerts a
      where a.group_id = r.group_id and a.target_user_id = r.user_id
        and a.closed_at > now() - make_interval(days => r.wellbeing_days)
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

-- 오래된 기록 정리: 90일 지난 초대(번호 재사용 허용), 하루 지난 코드 입력 시도
-- 업로드가 끝나지 않은 묶음(24시간)은 저장소 파일도 지워야 하므로 Edge Function에서 처리한다.
create or replace function public.cleanup_old_records()
returns void language sql security definer set search_path = public as $$
  delete from public.invites where created_at < now() - interval '90 days';
  delete from public.invite_attempts where attempted_at < now() - interval '1 day';
$$;

-- pg_cron을 켠 뒤 대시보드나 별도 마이그레이션에서 등록 (시각은 UTC)
-- select cron.schedule('wellbeing-daily', '0 1 * * *', $$select public.run_wellbeing_check()$$);  -- 매일 KST 10:00
-- select cron.schedule('cleanup-daily',   '30 18 * * *', $$select public.cleanup_old_records()$$); -- 매일 KST 03:30

-- ============================================================
-- 7. 앱이 직접 고칠 수 있는 칸 제한
-- ============================================================
-- Supabase는 기본으로 모든 칸 수정 권한을 주므로, 표 단위 수정 권한을 걷고 필요한 칸만 다시 준다.
-- (예: 관리자가 구성원의 group_id를 바꿔 다른 그룹으로 옮기는 일, 보낸 시각을 바꾸는 일을 막는다)
revoke update on public.profiles from anon, authenticated;
grant  update (display_name, easy_mode, show_seen, weekly_suggest, last_active_at) on public.profiles to authenticated;

revoke update on public.groups from anon, authenticated;
grant  update (name, wellbeing_days) on public.groups to authenticated;

-- 관리자가 바꾸는 것: 표시 이름, 태그. 내보내기·다시 들이기는 다음 마이그레이션의 RPC로.
revoke update on public.members from anon, authenticated;
grant  update (display_name, is_admin, easy_mode, wellbeing_check) on public.members to authenticated;

revoke update on public.posts from anon, authenticated;
grant  update (title, tags, status) on public.posts to authenticated;

revoke update on public.devices from anon, authenticated;
grant  update (name, push_token, status, last_seen_at) on public.devices to authenticated;

-- ============================================================
-- 8. 함수 실행 권한
-- ============================================================
revoke execute on function public.create_group(text, text)       from public, anon;
revoke execute on function public.set_my_display_name(uuid, text) from public, anon;
revoke execute on function public.create_invite(uuid, text, boolean, boolean, boolean) from public, anon;
revoke execute on function public.reissue_invite(uuid)           from public, anon;
revoke execute on function public.redeem_invite(text)            from public, anon;
revoke execute on function public.leave_group(uuid)              from public, anon;
revoke execute on function public.set_my_wellbeing(uuid, boolean) from public, anon;
revoke execute on function public.request_wellbeing(uuid)        from public, anon;
revoke execute on function public.respond_wellbeing(uuid, text)  from public, anon;
revoke execute on function public.run_wellbeing_check()          from public, anon, authenticated;
revoke execute on function public.cleanup_old_records()          from public, anon, authenticated;
grant  execute on function public.create_group(text, text)       to authenticated;
grant  execute on function public.set_my_display_name(uuid, text) to authenticated;
grant  execute on function public.create_invite(uuid, text, boolean, boolean, boolean) to authenticated;
grant  execute on function public.reissue_invite(uuid)           to authenticated;
grant  execute on function public.redeem_invite(text)            to authenticated;
grant  execute on function public.leave_group(uuid)              to authenticated;
grant  execute on function public.set_my_wellbeing(uuid, boolean) to authenticated;
grant  execute on function public.request_wellbeing(uuid)        to authenticated;
grant  execute on function public.respond_wellbeing(uuid, text)  to authenticated;

-- ============================================================
-- 9. 사진 저장소 (비공개 버킷, 경로: posts/{post_id}/{파일})
-- ============================================================
insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

create policy media_objects_read on storage.objects for select to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'posts'
    and public.can_see_post(((storage.foldername(name))[2])::uuid)
  );

create policy media_objects_upload on storage.objects for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'posts'
    and exists (
      select 1 from public.posts p
      where p.id = ((storage.foldername(name))[2])::uuid and p.sender_id = auth.uid()
    )
  );

create policy media_objects_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = 'posts'
    and exists (
      select 1 from public.posts p
      where p.id = ((storage.foldername(name))[2])::uuid and p.sender_id = auth.uid()
    )
  );

-- 아직 없는 것 (다음 마이그레이션): 구성원 내보내기 RPC, TV 연결 RPC, 관리자 기기 목록·해제 RPC,
-- 그룹 합치기 수락 RPC, 합류 알림(푸시)
-- 나간 사람의 사진 삭제는 posts_delete_self 정책으로 이미 가능하다 (보낸 사람 = 본인이면 즉시 삭제)
