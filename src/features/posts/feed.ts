import { supabase } from '@/lib/supabase';

import { kstMonthRange } from './format';

// 보기(개발 4단계): 묶음 목록 읽기와 앨범 집계.
// - 완료된(ready) 묶음만 보인다. 내가 올리는 중인 묶음은 can_see_post로는 보이지만 목록에서는 뺀다.
// - 같은 묶음을 여러 그룹에 보냈어도 posts 1행이므로 '모든 가족'에서 한 번만 나온다 (F-FRFNRL).
//   post_groups는 내가 볼 수 있는 그룹 행만 딸려 온다 (post_groups_select).
// - 보낸 시각 최신순. 같은 시각이면 id 역순으로 끊어 읽는다 (중복·누락 없이 다음 페이지).

export const PAGE_SIZE = 20;

export type FeedMedia = {
  id: string;
  type: 'photo' | 'video';
  path: string;
  thumbPath: string;
  width: number | null;
  height: number | null;
  durationSec: number | null;
};

export type FeedPost = {
  id: string;
  kind: 'normal' | 'video_message';
  senderId: string;
  title: string | null;
  tags: string[];
  createdAt: string; // DB 원문 그대로 (다음 페이지 기준으로 쓰므로 Date로 바꾸지 않는다)
  groupIds: string[];
  media: FeedMedia[];
};

/** 목록 조건: 그룹은 필수, 나머지는 앨범 카드에서 들어올 때 하나만 */
export type FeedFilter = {
  groupIds: string[];
  month?: string; // 'YYYY-MM-01' (한국 시간 기준 달)
  senderId?: string;
  tag?: string;
};

export type FeedCursor = { createdAt: string; id: string };

type PostRow = {
  id: string;
  kind: 'normal' | 'video_message';
  sender_id: string;
  title: string | null;
  tags: string[] | null;
  created_at: string;
  post_groups: { group_id: string }[];
  media: {
    id: string;
    type: 'photo' | 'video';
    path: string;
    thumb_path: string;
    width: number | null;
    height: number | null;
    duration_sec: number | string | null;
    sort_order: number;
  }[];
};

const POST_COLUMNS =
  'id, kind, sender_id, title, tags, created_at, post_groups!inner(group_id), ' +
  'media(id, type, path, thumb_path, width, height, duration_sec, sort_order)';

function toPost(row: PostRow): FeedPost {
  return {
    id: row.id,
    kind: row.kind ?? 'normal',
    senderId: row.sender_id,
    title: row.title,
    tags: row.tags ?? [],
    createdAt: row.created_at,
    groupIds: row.post_groups.map((g) => g.group_id),
    media: [...row.media]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((m) => ({
        id: m.id,
        type: m.type,
        path: m.path,
        thumbPath: m.thumb_path,
        width: m.width,
        height: m.height,
        // numeric 칸은 문자열로 올 수 있다
        durationSec: m.duration_sec === null ? null : Number(m.duration_sec),
      })),
  };
}

export async function listFeed(
  filter: FeedFilter,
  cursor: FeedCursor | null,
): Promise<{ posts: FeedPost[]; next: FeedCursor | null }> {
  if (filter.groupIds.length === 0) return { posts: [], next: null };

  let q = supabase
    .from('posts')
    .select(POST_COLUMNS)
    .in('post_groups.group_id', filter.groupIds)
    .eq('status', 'ready');

  if (filter.month) {
    const { start, end } = kstMonthRange(filter.month);
    q = q.gte('created_at', start).lt('created_at', end);
  }
  if (filter.senderId) q = q.eq('sender_id', filter.senderId);
  if (filter.tag) q = q.contains('tags', [filter.tag]);
  if (cursor) {
    // 시각 문자열에 ':'·'+'가 있어 큰따옴표로 감싼다 (PostgREST or 문법)
    q = q.or(
      `created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await q
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PAGE_SIZE);
  if (error) throw error;

  const posts = ((data ?? []) as unknown as PostRow[]).map(toPost);
  const last = posts[posts.length - 1];
  return {
    posts,
    next: posts.length === PAGE_SIZE && last ? { createdAt: last.createdAt, id: last.id } : null,
  };
}

/** 묶음 하나 (사진 상세). 없거나 볼 수 없으면 null. */
export async function getPost(postId: string): Promise<FeedPost | null> {
  const { data, error } = await supabase
    .from('posts')
    .select(POST_COLUMNS)
    .eq('id', postId)
    .eq('status', 'ready')
    .maybeSingle();
  if (error) throw error;
  return data ? toPost(data as unknown as PostRow) : null;
}

/**
 * 그룹별 구성원 이름 (보낸 사람 표시). 나간 사람도 포함한다 — 나간 뒤에도 그 사람이 보낸 묶음은 남으므로.
 * 결과: 그룹 ID → (사용자 ID → 그 그룹에서의 이름)
 */
export type NameBook = Map<string, Map<string, string>>;

export async function listNameBook(groupIds: string[]): Promise<NameBook> {
  const book: NameBook = new Map();
  if (groupIds.length === 0) return book;
  const { data, error } = await supabase
    .from('members')
    .select('group_id, user_id, display_name')
    .in('group_id', groupIds);
  if (error) throw error;
  for (const m of data ?? []) {
    if (!m.display_name) continue;
    let names = book.get(m.group_id);
    if (!names) book.set(m.group_id, (names = new Map()));
    names.set(m.user_id, m.display_name);
  }
  return book;
}

/**
 * 보낸 사람 이름 (결정 D3):
 * 특정 그룹을 보고 있으면 그 그룹에서의 이름,
 * '모든 가족'이면 그 묶음을 받은 그룹 중 내 그룹 순서(먼저 들어간 그룹)로 첫 그룹에서의 이름.
 */
export function senderName(
  book: NameBook,
  senderId: string,
  postGroupIds: string[],
  myGroupOrder: string[],
  viewingGroupId: string | null,
): string | null {
  if (viewingGroupId) {
    const name = book.get(viewingGroupId)?.get(senderId);
    if (name) return name;
  }
  const ordered = myGroupOrder.filter((g) => postGroupIds.includes(g));
  for (const g of [...ordered, ...myGroupOrder]) {
    const name = book.get(g)?.get(senderId);
    if (name) return name;
  }
  return null;
}

// ── 앨범 집계 (0002_album_counts.sql) ─────────────────────────────

export type MonthCount = { month: string; postCount: number; mediaCount: number; coverThumb: string | null };
export type SenderCount = { senderId: string; postCount: number; mediaCount: number; coverThumb: string | null };
export type TagCount = { tag: string; postCount: number; mediaCount: number; coverThumb: string | null };

export async function albumMonths(groupIds: string[]): Promise<MonthCount[]> {
  if (groupIds.length === 0) return [];
  const { data, error } = await supabase.rpc('album_months', { p_groups: groupIds });
  if (error) throw error;
  return ((data ?? []) as { month: string; post_count: number; media_count: number; cover_thumb: string | null }[])
    .map((r) => ({ month: r.month, postCount: r.post_count, mediaCount: r.media_count, coverThumb: r.cover_thumb }));
}

export async function albumSenders(groupIds: string[]): Promise<SenderCount[]> {
  if (groupIds.length === 0) return [];
  const { data, error } = await supabase.rpc('album_senders', { p_groups: groupIds });
  if (error) throw error;
  return ((data ?? []) as { sender_id: string; post_count: number; media_count: number; cover_thumb: string | null }[])
    .map((r) => ({ senderId: r.sender_id, postCount: r.post_count, mediaCount: r.media_count, coverThumb: r.cover_thumb }));
}

export async function albumTags(groupIds: string[]): Promise<TagCount[]> {
  if (groupIds.length === 0) return [];
  const { data, error } = await supabase.rpc('album_tags', { p_groups: groupIds });
  if (error) throw error;
  return ((data ?? []) as { tag: string; post_count: number; media_count: number; cover_thumb: string | null }[])
    .map((r) => ({ tag: r.tag, postCount: r.post_count, mediaCount: r.media_count, coverThumb: r.cover_thumb }));
}
