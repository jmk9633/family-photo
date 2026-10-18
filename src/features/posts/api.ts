import { File } from 'expo-file-system';

import { supabase } from '@/lib/supabase';

// 묶음(posts)·사진(media)·받는 그룹(post_groups) 쓰기와 태그 추천 읽기.
// 올리는 순서는 CLAUDE.md 데이터 규칙: posts(uploading) → 파일 → media → post_groups → ready.
// ready가 아닌 묶음은 보낸 사람 말고는 아무도 볼 수 없다 (can_see_post).

const BUCKET = 'media';

export type GroupChoice = { id: string; name: string; others: string[] };

export type MediaRow = {
  id: string;
  post_id: string;
  type: 'photo' | 'video';
  path: string;
  thumb_path: string;
  width: number;
  height: number;
  duration_sec: number | null;
  taken_at: string | null;
  sort_order: number;
};

export const mediaPath = (postId: string, mediaId: string, type: 'photo' | 'video' = 'photo') =>
  `posts/${postId}/${mediaId}.${type === 'video' ? 'mp4' : 'jpg'}`;
export const thumbPath = (postId: string, mediaId: string) => `posts/${postId}/${mediaId}_thumb.jpg`;

/** 보낼 그룹 고르기: 내 그룹 + 나를 뺀 구성원 이름 (그룹 아래 작은 글씨) */
export async function listGroupChoices(userId: string): Promise<GroupChoice[]> {
  const { data, error } = await supabase
    .from('members')
    .select('joined_at, groups!inner(id, name, status)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .eq('groups.status', 'active')
    .order('joined_at');
  if (error) throw error;
  const groups = (data ?? []).map((row) => row.groups as unknown as { id: string; name: string });
  if (groups.length === 0) return [];

  const { data: members, error: mErr } = await supabase
    .from('members')
    .select('group_id, user_id, display_name')
    .in('group_id', groups.map((g) => g.id))
    .eq('status', 'active')
    .order('joined_at');
  if (mErr) throw mErr;

  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    others: (members ?? [])
      .filter((m) => m.group_id === g.id && m.user_id !== userId && m.display_name)
      .map((m) => m.display_name as string),
  }));
}

/**
 * 그룹에서 쓰던 태그 추천 (F-AXZNWA 규칙: 그룹에서 쓰던 태그를 먼저).
 * 고른 그룹들의 최근 묶음 100개에서 많이 쓴 순, 같으면 최근에 쓴 순.
 */
export async function listRecentTags(groupIds: string[]): Promise<string[]> {
  if (groupIds.length === 0) return [];
  const { data, error } = await supabase
    .from('posts')
    .select('tags, created_at, post_groups!inner(group_id)')
    .in('post_groups.group_id', groupIds)
    .eq('status', 'ready')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;

  const score = new Map<string, { count: number; order: number }>();
  (data ?? []).forEach((row, i) => {
    for (const tag of (row.tags as string[] | null) ?? []) {
      const cur = score.get(tag);
      if (cur) cur.count += 1;
      else score.set(tag, { count: 1, order: i });
    }
  });
  return [...score.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[1].order - b[1].order)
    .map(([tag]) => tag);
}

/**
 * 1. 묶음 만들기 (status = uploading)
 * ID는 앱에서 만들고 그냥 insert만 한다. RETURNING(.select())이나 upsert(on conflict)를 쓰면
 * 읽기 정책 can_see_post가 같은 문장 안에서 방금 넣은 행을 못 봐서 RLS 오류(42501)가 난다
 * (2단계 그룹 만들기와 같은 원인. 로컬 Postgres로 재현 확인).
 * 다시 시도할 때 이미 들어간 행(23505)이면 성공으로 본다.
 */
export async function createPost(
  postId: string,
  userId: string,
  title: string | null,
  tags: string[],
  kind: 'normal' | 'video_message' = 'normal',
): Promise<void> {
  const { error } = await supabase
    .from('posts')
    .insert({ id: postId, sender_id: userId, kind, title, tags, status: 'uploading' });
  if (error && !isDuplicate(error)) throw error;
}

/** 2. 파일 올리기. 다시 보낼 때 이미 올라간 파일이면 성공으로 본다. */
export async function uploadFile(
  path: string,
  localUri: string,
  contentType: 'image/jpeg' | 'video/mp4',
): Promise<void> {
  const body = await new File(localUri).arrayBuffer();
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, body, { contentType, upsert: false });
  if (error && !isAlreadyExists(error)) throw error;
}

function isAlreadyExists(error: unknown): boolean {
  const e = error as { statusCode?: string | number; message?: string };
  return String(e.statusCode) === '409' || /already exists|duplicate/i.test(e.message ?? '');
}

/** 3. media 행 (한 번에 넣으므로 전부 들어가거나 하나도 안 들어간다). 다시 보낼 때 이미 있으면 성공. */
export async function insertMedia(rows: MediaRow[]): Promise<void> {
  const { error } = await supabase.from('media').insert(rows);
  if (error && !isDuplicate(error)) throw error;
}

/** 4. 받는 그룹 */
export async function attachGroups(postId: string, groupIds: string[]): Promise<void> {
  const { error } = await supabase
    .from('post_groups')
    .insert(groupIds.map((group_id) => ({ post_id: postId, group_id })));
  if (error && !isDuplicate(error)) throw error;
}

/** 같은 키가 이미 있음 = 지난번 시도에서 들어갔는데 응답만 못 받은 경우 */
function isDuplicate(error: { code?: string }): boolean {
  return error.code === '23505';
}

/** 5. 완료 — 이때부터 받는 그룹 구성원에게 보인다. */
export async function markReady(postId: string): Promise<void> {
  const { error } = await supabase.from('posts').update({ status: 'ready' }).eq('id', postId);
  if (error) throw error;
}

/** 보내기는 활동이다 (안부 확인용 last_active_at). 실패해도 보내기는 성공으로 둔다. */
export async function touchActive(userId: string): Promise<void> {
  await supabase
    .from('profiles')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', userId);
}
