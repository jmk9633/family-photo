-- 0014 홈 화면 위젯 (개발 8-1, F-NGOJFO, 10/25 결정)
--
-- 위젯은 앱과 따로 도는 작은 프로그램이라 앱의 로그인 정보를 쓰지 않는다.
-- 대신 폰마다 '위젯 열쇠'를 하나 만들어 앱과 위젯만 보는 공용 칸(App Group)에 둔다.
--   - 열쇠로 할 수 있는 일은 하나뿐: 내 가족의 가장 최근 사진 요약 한 건 읽기 (Edge Function `widget`이 widget_feed를 부른다)
--   - DB에는 열쇠 원문이 아니라 SHA-256 값만 둔다. 로그아웃하면 앱이 지우고, 계정이 지워지면 함께 지워진다.
--   - 가입 없이 쓰는 쉬운 화면 사용자(익명)도 만들 수 있다.
--
-- 위젯이 보여주는 것 (쉬운 화면 홈 F-MGGNVR과 같은 규칙):
--   - '새 사진' = 내가 아직 한 장도 안 본, 다른 사람이 보낸 완료(ready) 묶음. 그중 가장 최근 것의 첫 장과 그 묶음의 장 수
--   - 새 사진이 없으면 다른 사람이 보낸 가장 최근 묶음, 그것도 없으면 내가 보낸 가장 최근 묶음 (장 수는 숨김)
--   - 속한 모든 가족(활성 구성원인 그룹)을 합쳐서 본다. 가족을 고르는 설정은 없다
--
-- 위젯이 사진을 읽는 것은 '봤어요'(post_views)도 활동(profiles.last_active_at)도 아니다 (F-NGOJFO·F-BLIYTI·F-QHORLL 규칙).
-- 그래서 widget_feed는 post_views·profiles를 바꾸지 않는다 (widget.test.sql에서 확인).

create table public.widget_keys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  key_hash      text not null unique,          -- 열쇠 원문의 SHA-256 (16진수). 원문은 저장하지 않는다
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz                    -- 위젯이 마지막으로 읽은 때 (오래 안 쓴 열쇠 정리용)
);
create index widget_keys_user on public.widget_keys (user_id, created_at desc);

alter table public.widget_keys enable row level security;
-- 앱은 내 열쇠가 있는지만 볼 수 있다 (열쇠 값은 못 본다). 만들기·지우기는 아래 RPC로만.
create policy widget_keys_select_self on public.widget_keys for select to authenticated
  using (user_id = auth.uid());
revoke all on public.widget_keys from anon, authenticated;
grant select (id, user_id, created_at, last_used_at) on public.widget_keys to authenticated;

-- 한 사람이 가질 수 있는 열쇠 수 (폰을 바꾸거나 앱을 다시 깔면 새 열쇠가 생긴다)
create or replace function public.widget_key_limit() returns int language sql immutable as $$ select 5 $$;

-- 열쇠 만들기: {id, key}를 돌려준다. 원문(key, 64자리 16진수)은 이때 한 번만 나온다.
-- 앱은 id로 내 열쇠가 아직 있는지 확인한다 (5개 제한으로 밀려났으면 새로 만든다). 오래된 열쇠는 최근 5개만 남기고 지운다.
create or replace function public.create_widget_key()
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := auth.uid();
  v_key  text;
  v_id   uuid;
begin
  if v_user is null then
    raise exception 'not_signed_in';
  end if;
  if not exists (select 1 from public.profiles where id = v_user) then
    raise exception 'not_signed_in';
  end if;
  v_key := encode(gen_random_bytes(32), 'hex');
  -- 실제 시각(clock_timestamp)으로 넣어야 한 번에 여러 개를 만들어도 '가장 오래된 것'이 정해진다
  insert into public.widget_keys (user_id, key_hash, created_at)
  values (v_user, encode(digest(v_key, 'sha256'), 'hex'), clock_timestamp())
  returning id into v_id;
  delete from public.widget_keys k
  where k.user_id = v_user
    and k.id not in (
      select id from public.widget_keys
      where user_id = v_user
      order by created_at desc, id desc
      limit public.widget_key_limit()
    );
  return jsonb_build_object('id', v_id, 'key', v_key);
end;
$$;

-- 열쇠 지우기 (로그아웃할 때). 내 열쇠만 지워진다.
create or replace function public.revoke_widget_key(p_key text)
returns void language sql security definer set search_path = public, extensions as $$
  delete from public.widget_keys
  where user_id = auth.uid()
    and key_hash = encode(digest(coalesce(p_key, ''), 'sha256'), 'hex');
$$;

-- 위젯에 보여줄 묶음 한 건 (Edge Function `widget` 전용, service role).
-- 돌려주는 값:
--   {status:'invalid'}  열쇠가 없거나 지워짐 → 위젯은 '가족과 연결해 주세요'
--   {status:'no_group'} 연결된 가족이 없음 → '가족과 연결해 주세요'
--   {status:'empty'}    가족에 사진이 아직 없음 → '가족이 사진을 보내면 여기에 보여요'
--   {status:'ok', post_id, is_new, count, kind, title, sender_name, created_at, thumb_path, media_type}
create or replace function public.widget_feed(p_key text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user   uuid;
  v_groups uuid[];
  v_post   uuid;
  v_new    boolean := false;
  r        record;
  v_media  record;
  v_count  int;
  v_name   text;
begin
  if p_key is null or p_key !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid');
  end if;

  update public.widget_keys set last_used_at = now()
  where key_hash = encode(digest(p_key, 'sha256'), 'hex')
  returning user_id into v_user;
  if v_user is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  select array_agg(m.group_id) into v_groups
  from public.members m
  where m.user_id = v_user and m.status = 'active';
  if v_groups is null then
    return jsonb_build_object('status', 'no_group');
  end if;

  -- 1) 새 사진: 다른 사람이 보낸, 아직 한 장도 안 본 묶음 중 가장 최근
  select p.id into v_post
  from public.posts p
  where p.status = 'ready' and p.sender_id <> v_user
    and exists (select 1 from public.post_groups pg where pg.post_id = p.id and pg.group_id = any (v_groups))
    and exists (select 1 from public.media md where md.post_id = p.id)
    and not exists (select 1 from public.post_views v where v.post_id = p.id and v.user_id = v_user)
  order by p.created_at desc, p.id desc
  limit 1;
  v_new := v_post is not null;

  -- 2) 없으면 다른 사람이 보낸 가장 최근 묶음, 3) 그것도 없으면 내가 보낸 것까지
  if v_post is null then
    select p.id into v_post
    from public.posts p
    where p.status = 'ready'
      and exists (select 1 from public.post_groups pg where pg.post_id = p.id and pg.group_id = any (v_groups))
      and exists (select 1 from public.media md where md.post_id = p.id)
    order by (p.sender_id = v_user), p.created_at desc, p.id desc
    limit 1;
  end if;
  if v_post is null then
    return jsonb_build_object('status', 'empty');
  end if;

  select p.id, p.kind, p.title, p.sender_id, p.created_at into r from public.posts p where p.id = v_post;
  select md.thumb_path, md.type into v_media
  from public.media md where md.post_id = v_post
  order by md.sort_order, md.created_at, md.id limit 1;
  select count(*) into v_count from public.media md where md.post_id = v_post;

  -- 보낸 사람 이름: 그 묶음을 받은 내 가족 중 내가 먼저 들어간 가족에서의 이름 (앱의 senderName과 같은 규칙)
  select s.display_name into v_name
  from public.members me
  join public.post_groups pg on pg.group_id = me.group_id and pg.post_id = v_post
  join public.members s on s.group_id = me.group_id and s.user_id = r.sender_id
  where me.user_id = v_user and me.status = 'active' and s.display_name <> ''
  order by me.joined_at, me.group_id
  limit 1;

  return jsonb_build_object(
    'status', 'ok',
    'post_id', r.id,
    'is_new', v_new,
    'count', v_count,
    'kind', r.kind,
    'title', r.title,
    'sender_name', v_name,
    'created_at', r.created_at,
    'thumb_path', v_media.thumb_path,
    'media_type', v_media.type
  );
end;
$$;

revoke execute on function public.widget_key_limit()        from public, anon;
revoke execute on function public.create_widget_key()       from public, anon;
revoke execute on function public.revoke_widget_key(text)   from public, anon;
revoke execute on function public.widget_feed(text)         from public, anon, authenticated;
grant  execute on function public.create_widget_key()       to authenticated;
grant  execute on function public.revoke_widget_key(text)   to authenticated;
grant  execute on function public.widget_feed(text)         to service_role;
