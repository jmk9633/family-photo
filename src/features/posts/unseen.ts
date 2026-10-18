import { listMyGroups, type Group } from '@/features/groups/api';
import { supabase } from '@/lib/supabase';

import { listFeed, listNameBook, type FeedPost, type NameBook } from './feed';

// 쉬운 화면의 '새 사진' (F-MGGNVR): 이 사람이 아직 한 장도 보지 않은, 다른 사람이 보낸 묶음.
// 본 기록(post_views)은 본인 것은 읽을 수 있다 (0003 post_views_select).

export async function listViewedPostIds(userId: string, postIds: string[]): Promise<Set<string>> {
  if (postIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from('post_views')
    .select('post_id')
    .eq('user_id', userId)
    .in('post_id', postIds);
  if (error) throw error;
  return new Set((data ?? []).map((v) => v.post_id as string));
}

export type EasyFeed = {
  groups: Group[];
  posts: FeedPost[]; // 최근 묶음 (최신순, 한 쪽)
  newPosts: FeedPost[]; // 그중 아직 안 본 남의 묶음 (최신순)
  book: NameBook;
};

/** 쉬운 화면 홈·'다 봤어요'에 필요한 것을 한 번에 읽는다. */
export async function loadEasyFeed(userId: string): Promise<EasyFeed> {
  const groups = await listMyGroups(userId);
  const groupIds = groups.map((g) => g.id);
  const [{ posts }, book] = await Promise.all([listFeed({ groupIds }, null), listNameBook(groupIds)]);
  const viewed = await listViewedPostIds(
    userId,
    posts.map((p) => p.id),
  );
  const newPosts = posts.filter((p) => p.senderId !== userId && !viewed.has(p.id));
  return { groups, posts, newPosts, book };
}
