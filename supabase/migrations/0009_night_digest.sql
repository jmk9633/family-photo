-- 0009: 쉬운 화면 사용자의 밤 알림 모으기 (개발 6-3, 10/18 결정)
--
-- 쉬운 화면 사용자(profiles.easy_mode)에게 가는 알림은 종류와 상관없이 밤 9시~아침 8시(한국 시간)에는
-- 바로 보내지 않고 night_queue에 모았다가, 매일 아침 8시에 한 사람당 알림 하나로 보낸다.
-- (넣는 쪽: Edge Function notify의 pushTo. 일반 모드 사용자는 밤에도 바로 받는다.)
--
-- 아침 알림 문구 (10/18 사용자 결정 A):
--   한 가지 소식만:
--     새 사진(한 건)      '밤사이 새 사진이 왔어요' / 그 알림 내용 그대로 ('지은이 사진 3장을 보냈어요')
--     새 사진(여러 건)    '밤사이 새 사진이 왔어요' / '지은, 민수가 사진을 보냈어요' (3명부터 '지은, 민수 등 가족이')
--     하트·봤어요         '밤사이 가족 소식이 있어요' / '가족이 내 사진을 보고 좋아해요'(하트 있음) · '가족이 내 사진을 봤어요'
--     들어옴·관리자(한 건) '밤사이 가족 소식이 있어요' / 그 알림 내용 그대로
--   여러 가지:
--     새 사진 포함 '밤사이 새 사진이 왔어요' / '새 사진과 가족 소식이 있어요. 눌러서 보세요'
--     새 사진 없음 '밤사이 가족 소식이 있어요' / '가족 소식이 있어요. 눌러서 보세요'
--   새벽에 이미 본 새 사진, 지워진 묶음은 뺀다. 남는 소식이 없으면 보내지 않는다.
--   하트·봤어요는 숫자를 쓰지 않는다 (사진 장수는 낮 알림처럼 쓴다).
--
-- 보내기는 pg_cron(매일 23:00 UTC = 08:00 KST)이 send_night_digest()를 부르고,
-- 그 안에서 pg_net으로 Expo 푸시 서비스에 바로 보낸다 (비밀 키가 필요 없다).

create table public.night_queue (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,  -- 받는 사람
  kind        text not null check (kind in ('new_post', 'heart', 'seen', 'joined', 'admin_changed')),
  post_id     uuid references public.posts(id) on delete cascade,
  group_id    uuid references public.groups(id) on delete cascade,
  actor_name  text,          -- 받는 사람이 보는 이름 (새 사진 여러 건을 묶을 때)
  title       text not null, -- 바로 보냈다면 갔을 알림 (한 건일 때 그대로 쓴다)
  body        text not null,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index night_queue_unsent_idx on public.night_queue(user_id) where sent_at is null;
alter table public.night_queue enable row level security;
revoke all on public.night_queue from anon, authenticated;

-- 이름 뒤 '이/가' (앱 ko.ts·notify와 같은 규칙)
create or replace function public.ko_iga(p_name text)
returns text language sql immutable as $$
  select case
    when btrim(p_name) = '' then p_name
    when ascii(right(btrim(p_name), 1)) between 44032 and 55203
         and (ascii(right(btrim(p_name), 1)) - 44032) % 28 <> 0 then btrim(p_name) || '이'
    else btrim(p_name) || '가'
  end;
$$;

-- 지금 보낼 아침 알림 (한 사람당 한 줄). 보내지는 않는다 → 테스트할 수 있게 나눠 둔다.
create or replace function public.night_digest_messages()
returns table (user_id uuid, title text, body text, item_ids uuid[])
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_kinds text[];
  v_live  record;
  v_names text[];
  v_title text;
  v_body  text;
begin
  for r in
    select q.user_id as uid, array_agg(q.id) as ids
      from public.night_queue q
     where q.sent_at is null
     group by q.user_id
  loop
    -- 아직 의미 있는 소식만: 새 사진은 완료됐고 아직 안 본 것만
    create temp table if not exists _live (id uuid, kind text, post_id uuid, actor_name text, title text, body text, created_at timestamptz) on commit drop;
    truncate _live;
    insert into _live
    select q.id, q.kind, q.post_id, q.actor_name, q.title, q.body, q.created_at
      from public.night_queue q
     where q.id = any(r.ids)
       and (
         q.kind <> 'new_post'
         or exists (
           select 1 from public.posts p
            where p.id = q.post_id and p.status = 'ready'
              and not exists (select 1 from public.post_views v where v.post_id = p.id and v.user_id = r.uid)
         )
       );

    user_id := r.uid;
    item_ids := r.ids;   -- 빠진 것까지 모두 '보냄'으로 표시한다
    select array_agg(distinct l.kind) into v_kinds from _live l;

    if v_kinds is null then
      title := null; body := null;
      return next;
      continue;
    end if;

    if v_kinds = array['new_post'] then
      v_title := '밤사이 새 사진이 왔어요';
      if (select count(*) from _live) = 1 then
        select l.body into v_body from _live l;
      else
        select array_agg(n order by first_at) into v_names
          from (select coalesce(nullif(l.actor_name, ''), '가족') as n, min(l.created_at) as first_at
                  from _live l group by 1) s;
        if array_length(v_names, 1) = 1 then
          v_body := public.ko_iga(v_names[1]) || ' 사진을 보냈어요';
        elsif array_length(v_names, 1) = 2 then
          v_body := public.ko_iga(v_names[1] || ', ' || v_names[2]) || ' 사진을 보냈어요';
        else
          v_body := v_names[1] || ', ' || v_names[2] || ' 등 가족이 사진을 보냈어요';
        end if;
      end if;
    elsif v_kinds <@ array['heart', 'seen'] then
      v_title := '밤사이 가족 소식이 있어요';
      v_body := case when 'heart' = any(v_kinds) and 'seen' = any(v_kinds) then '가족이 내 사진을 보고 좋아해요'
                     when 'heart' = any(v_kinds) then '가족이 내 사진을 좋아해요'
                     else '가족이 내 사진을 봤어요' end;
    elsif array_length(v_kinds, 1) = 1 and (select count(*) from _live) = 1 then
      -- 들어옴·관리자 바뀜 한 건
      v_title := '밤사이 가족 소식이 있어요';
      select l.body into v_body from _live l;
    elsif v_kinds = array['joined'] then
      v_title := '밤사이 가족 소식이 있어요';
      v_body := '가족이 새로 들어왔어요';
    elsif 'new_post' = any(v_kinds) then
      v_title := '밤사이 새 사진이 왔어요';
      v_body := '새 사진과 가족 소식이 있어요. 눌러서 보세요';
    else
      v_title := '밤사이 가족 소식이 있어요';
      v_body := '가족 소식이 있어요. 눌러서 보세요';
    end if;

    title := v_title; body := v_body;
    return next;
  end loop;
end;
$$;
revoke execute on function public.night_digest_messages() from public, anon, authenticated;

-- 아침 8시: 모은 알림을 한 사람당 하나로 보낸다. 같은 토큰이 여러 계정에 있으면 가장 최근에 쓴 계정에만.
create or replace function public.send_night_digest()
returns int language plpgsql security definer set search_path = public, extensions as $$
declare
  m record;
  v_msgs jsonb;
  v_sent int := 0;
begin
  for m in select * from public.night_digest_messages() loop
    if m.title is not null then
      select coalesce(jsonb_agg(jsonb_build_object(
               'to', d.push_token, 'sound', 'default', 'title', m.title, 'body', m.body,
               'data', jsonb_build_object('kind', 'night_digest'))), '[]'::jsonb)
        into v_msgs
        from (
          select distinct on (push_token) push_token, user_id
            from public.devices
           where status = 'active' and push_token is not null
           order by push_token, last_seen_at desc nulls last
        ) d
       where d.user_id = m.user_id;
      if jsonb_array_length(v_msgs) > 0 then
        perform net.http_post(
          url := 'https://exp.host/--/api/v2/push/send',
          body := v_msgs,
          headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb
        );
        v_sent := v_sent + 1;
      end if;
    end if;
    update public.night_queue set sent_at = now() where id = any(m.item_ids);
  end loop;
  -- 보낸 지 7일 지난 기록은 지운다
  delete from public.night_queue where sent_at < now() - interval '7 days';
  return v_sent;
end;
$$;
revoke execute on function public.send_night_digest() from public, anon, authenticated;

-- 예약 작업: Supabase에서는 pg_cron·pg_net을 켜고 매일 08:00 KST에 돌린다.
-- (로컬 테스트 DB처럼 확장이 없는 곳에서는 건너뛴다)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('night-digest', '0 23 * * *', 'select public.send_night_digest()');
  end if;
end;
$$;
