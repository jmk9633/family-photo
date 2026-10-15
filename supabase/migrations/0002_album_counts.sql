-- 0002: 앨범·타임라인 집계 (개발 4단계, F-FRFNRL 월 제목의 묶음 수, F-HEETWR 앨범 카드)
--
-- 앨범 카드는 '묶음 N개 · M장'과 대표 사진을 보여준다. 타임라인은 묶음을 나눠 불러오므로
-- 앱이 받은 묶음만 세면 월 제목의 숫자가 틀린다 → DB에서 센다.
--
-- 세 함수 모두 security invoker: 부른 사람의 RLS(posts_select, post_groups_select, media_select)가
-- 그대로 적용된다. 남의 그룹 ID를 넘겨도 post_groups 행이 보이지 않아 아무것도 세지 않는다.
-- 새 테이블·정책은 없다.
--
-- 공통 규칙
--   - 완료된(ready) 묶음만. 내가 올리는 중인 묶음은 세지 않는다.
--   - 같은 묶음을 여러 그룹에 보냈어도 한 번만 센다 (distinct).
--   - 월은 한국 시간 기준.
--   - 대표 사진 = 그 칸에서 가장 최근 묶음의 첫 장 썸네일.

create or replace function public.album_months(p_groups uuid[])
returns table (month date, post_count int, media_count int, cover_thumb text)
language sql stable security invoker set search_path = public as $$
  with vis as (
    select distinct p.id, p.created_at
    from public.posts p
    join public.post_groups pg on pg.post_id = p.id
    where p.status = 'ready' and pg.group_id = any(p_groups)
  ),
  per_post as (
    select v.id, v.created_at,
      date_trunc('month', v.created_at at time zone 'Asia/Seoul')::date as month,
      (select count(*) from public.media m where m.post_id = v.id) as n,
      (select m.thumb_path from public.media m where m.post_id = v.id
        order by m.sort_order limit 1) as thumb
    from vis v
  )
  select pp.month, count(*)::int, coalesce(sum(pp.n), 0)::int,
    (array_agg(pp.thumb order by pp.created_at desc) filter (where pp.thumb is not null))[1]
  from per_post pp
  group by pp.month
  order by pp.month desc;
$$;

-- 보낸 사람별: 최근에 보낸 사람이 먼저. 이름은 그룹마다 달라서 앱이 members에서 찾는다.
create or replace function public.album_senders(p_groups uuid[])
returns table (sender_id uuid, post_count int, media_count int, cover_thumb text, latest_at timestamptz)
language sql stable security invoker set search_path = public as $$
  with vis as (
    select distinct p.id, p.sender_id, p.created_at
    from public.posts p
    join public.post_groups pg on pg.post_id = p.id
    where p.status = 'ready' and pg.group_id = any(p_groups)
  ),
  per_post as (
    select v.id, v.sender_id, v.created_at,
      (select count(*) from public.media m where m.post_id = v.id) as n,
      (select m.thumb_path from public.media m where m.post_id = v.id
        order by m.sort_order limit 1) as thumb
    from vis v
  )
  select pp.sender_id, count(*)::int, coalesce(sum(pp.n), 0)::int,
    (array_agg(pp.thumb order by pp.created_at desc) filter (where pp.thumb is not null))[1],
    max(pp.created_at)
  from per_post pp
  group by pp.sender_id
  order by max(pp.created_at) desc;
$$;

-- 태그별: 많이 쓴 태그가 먼저 (F-HEETWR 규칙), 같으면 최근에 쓴 태그가 먼저.
create or replace function public.album_tags(p_groups uuid[])
returns table (tag text, post_count int, media_count int, cover_thumb text, latest_at timestamptz)
language sql stable security invoker set search_path = public as $$
  with vis as (
    select distinct p.id, p.tags, p.created_at
    from public.posts p
    join public.post_groups pg on pg.post_id = p.id
    where p.status = 'ready' and pg.group_id = any(p_groups)
  ),
  per_post as (
    select v.id, v.created_at, t.tag,
      (select count(*) from public.media m where m.post_id = v.id) as n,
      (select m.thumb_path from public.media m where m.post_id = v.id
        order by m.sort_order limit 1) as thumb
    from vis v
    cross join lateral unnest(v.tags) as t(tag)
  )
  select pp.tag, count(*)::int, coalesce(sum(pp.n), 0)::int,
    (array_agg(pp.thumb order by pp.created_at desc) filter (where pp.thumb is not null))[1],
    max(pp.created_at)
  from per_post pp
  group by pp.tag
  order by count(*) desc, max(pp.created_at) desc;
$$;

revoke all on function public.album_months(uuid[]) from public, anon;
revoke all on function public.album_senders(uuid[]) from public, anon;
revoke all on function public.album_tags(uuid[]) from public, anon;
grant execute on function public.album_months(uuid[]) to authenticated;
grant execute on function public.album_senders(uuid[]) to authenticated;
grant execute on function public.album_tags(uuid[]) to authenticated;
