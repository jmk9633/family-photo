-- 0012: 새벽 정리 작업 (개발 7-3, 10/25 결정)
--
-- 매일 03:30 KST(18:30 UTC)에 pg_cron이 start_cleanup()을 부른다.
--   1) DB만으로 끝나는 정리는 여기서 바로 한다 (0001 cleanup_old_records):
--      90일 지난 초대 기록(그 뒤에야 같은 숫자를 다시 발급할 수 있다), 하루 지난 숫자 입력 시도 기록.
--      지난 정리 기록(cleanup_runs)은 30일 뒤 지운다.
--   2) 저장소 파일과 계정은 SQL로 지울 수 없어 Edge Function `cleanup`을 pg_net으로 부른다.
--      함수는 아래 함수들로 대상을 받아 지운다:
--      - 24시간 넘게 '올리는 중'(uploading)인 묶음 → 'deleting'으로 바꾼 뒤 파일 폴더째 삭제 → 묶음 삭제
--        (파일만 올라가고 media 행이 없는 경우가 있어 목록이 아니라 posts/{묶음}/ 폴더를 통째로 지운다)
--      - 'deleting' 묶음 (그룹 나가기 '내 사진도 지우기'에서 앱이 못 지운 것) → 같은 방식
--      - 묶음 기록 없이 남은 파일 폴더 (24시간 지난 것) → 파일 삭제
--      - 한 번도 가족에 연결되지 못한 채 7일 지난 익명 계정 → 계정 삭제
--        (내보내지거나 나간 익명 사용자는 지우지 않는다: 계정을 지우면 보낸 사진도 함께 지워지므로. 10/25 결정 2)
--
-- 함수 호출 보호: Edge Function은 JWT 확인을 끄고(config.toml) 대신 일회용 표를 확인한다.
-- start_cleanup()이 cleanup_runs에 새 표(token)를 만들어 본문에 넣어 보내고,
-- 함수는 service role로 claim_cleanup(token)을 불러 '10분 안에 만들어졌고 아직 안 쓴 표'일 때만 일한다.
-- 표는 DB 안에서만 만들어지므로 밖에서 함수를 불러도 아무 일도 하지 않는다. 따로 비밀값을 넣을 필요가 없다.
--
-- 지우는 중인 묶음은 다시 보이게 할 수 없다 (트리거 posts_deleting_final):
-- 정리하는 사이에 앱의 다시 보내기가 '완료'로 바꾸면 파일 없는 묶음이 생기기 때문.
-- 쉬운 화면 '나중에 다시 보낼게요'는 이 경우 실패로 남았다가 다음번에 같은 ID로 새로 올라가 저절로 복구된다.

-- ============================================================
-- 1. 지우는 중인 묶음은 되돌릴 수 없다 (앱·사용자 요청). 서버 작업(auth.uid() 없음)은 예외
-- ============================================================
create or replace function public.guard_post_deleting()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'deleting' and new.status <> 'deleting' and auth.uid() is not null then
    raise exception 'post_deleting';
  end if;
  return new;
end;
$$;
create trigger posts_deleting_final
  before update of status on public.posts
  for each row execute function public.guard_post_deleting();

-- ============================================================
-- 2. 정리 기록과 일회용 표 (앱은 읽지도 쓰지도 못한다)
-- ============================================================
create table public.cleanup_runs (
  id           uuid primary key default gen_random_uuid(),
  token        uuid not null unique default gen_random_uuid(),
  started_at   timestamptz not null default now(),
  claimed_at   timestamptz,
  finished_at  timestamptz,
  result       jsonb
);
alter table public.cleanup_runs enable row level security;
revoke all on public.cleanup_runs from anon, authenticated;

-- ============================================================
-- 3. 정리 대상 고르기 (service role = Edge Function 전용)
-- ============================================================

-- 일회용 표 확인: 10분 안에 만들어졌고 아직 안 쓴 표면 쓰고 true
create or replace function public.claim_cleanup(p_token uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.cleanup_runs set claimed_at = now()
   where token = p_token and claimed_at is null and started_at > now() - interval '10 minutes';
  return found;
end;
$$;

-- 지울 묶음: 24시간 넘은 '올리는 중'을 먼저 'deleting'으로 바꾸고, 'deleting' 묶음을 모두 돌려준다 (한 번에 500개)
create or replace function public.cleanup_take_posts()
returns table (post_id uuid) language plpgsql security definer set search_path = public as $$
begin
  update public.posts set status = 'deleting'
   where status = 'uploading' and created_at < now() - interval '24 hours';
  return query
    select p.id from public.posts p where p.status = 'deleting'
     order by p.created_at limit 500;
end;
$$;

-- 묶음 기록 없이 남은 파일 폴더 (posts/{id}/ 의 id). 방금 올라가는 중인 것과 겹치지 않게 24시간 지난 파일만
create or replace function public.cleanup_orphan_folders()
returns table (folder text) language sql stable security definer set search_path = public as $$
  select distinct (storage.foldername(o.name))[2]
    from storage.objects o
   where o.bucket_id = 'media'
     and (storage.foldername(o.name))[1] = 'posts'
     and o.created_at < now() - interval '24 hours'
     and not exists (
       select 1 from public.posts p where p.id::text = (storage.foldername(o.name))[2])
   limit 500;
$$;

-- 파일을 지운 묶음 삭제 (media·post_groups·하트·시청·알림 기록은 DB가 함께 지운다). 'deleting'만 지운다
create or replace function public.cleanup_finish_posts(p_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  delete from public.posts where id = any(coalesce(p_ids, '{}')) and status = 'deleting';
  get diagnostics v = row_count;
  return v;
end;
$$;

-- 한 번도 가족에 연결되지 못한 채 7일 지난 익명 계정 (한 번에 500개)
--   - members 행이 하나라도 있으면(지금 구성원이든 나갔든 내보내졌든) 제외
--   - 보낸 묶음이 있으면 제외 (그 묶음은 '올리는 중' 정리가 먼저 지운다)
--   - TV로 연결된 계정 제외 (9단계 TV 앱도 익명 로그인을 쓴다)
create or replace function public.cleanup_anonymous_targets()
returns table (user_id uuid) language sql stable security definer set search_path = public as $$
  select u.id
    from auth.users u
   where u.is_anonymous
     and u.created_at < now() - interval '7 days'
     and not exists (select 1 from public.members m where m.user_id = u.id)
     and not exists (select 1 from public.posts p where p.sender_id = u.id)
     and not exists (
       select 1 from public.devices d
         join public.device_groups dg on dg.device_id = d.id
        where d.user_id = u.id)
   order by u.created_at
   limit 500;
$$;

-- 정리 결과 남기기
create or replace function public.finish_cleanup(p_token uuid, p_result jsonb)
returns void language sql security definer set search_path = public as $$
  update public.cleanup_runs set finished_at = now(), result = p_result where token = p_token;
$$;

-- ============================================================
-- 4. 시작 (pg_cron 전용): DB 정리 + Edge Function 부르기
-- ============================================================
create or replace function public.start_cleanup()
returns uuid language plpgsql security definer set search_path = public as $$
declare v_token uuid;
begin
  perform public.cleanup_old_records();
  delete from public.cleanup_runs where started_at < now() - interval '30 days';

  insert into public.cleanup_runs default values returning token into v_token;
  if exists (select 1 from pg_extension where extname = 'pg_net') then
    perform net.http_post(
      url := 'https://ppkixylstjmerxixoodq.supabase.co/functions/v1/cleanup',
      body := jsonb_build_object('token', v_token),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 60000
    );
  end if;
  return v_token;
end;
$$;

-- ============================================================
-- 5. 실행 권한: 앱(anon·authenticated)은 아무것도 못 부른다
-- ============================================================
revoke execute on function public.guard_post_deleting()            from public, anon, authenticated;
revoke execute on function public.claim_cleanup(uuid)              from public, anon, authenticated;
revoke execute on function public.cleanup_take_posts()             from public, anon, authenticated;
revoke execute on function public.cleanup_orphan_folders()         from public, anon, authenticated;
revoke execute on function public.cleanup_finish_posts(uuid[])     from public, anon, authenticated;
revoke execute on function public.cleanup_anonymous_targets()      from public, anon, authenticated;
revoke execute on function public.finish_cleanup(uuid, jsonb)      from public, anon, authenticated;
revoke execute on function public.start_cleanup()                  from public, anon, authenticated, service_role;
grant  execute on function public.claim_cleanup(uuid)              to service_role;
grant  execute on function public.cleanup_take_posts()             to service_role;
grant  execute on function public.cleanup_orphan_folders()         to service_role;
grant  execute on function public.cleanup_finish_posts(uuid[])     to service_role;
grant  execute on function public.cleanup_anonymous_targets()      to service_role;
grant  execute on function public.finish_cleanup(uuid, jsonb)      to service_role;

-- ============================================================
-- 6. 예약 작업: 매일 03:30 KST (18:30 UTC)
-- ============================================================
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('cleanup-daily', '30 18 * * *', 'select public.start_cleanup()');
  end if;
end;
$$;
