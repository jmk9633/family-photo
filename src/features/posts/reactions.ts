import { requestNotify } from '@/features/push/notify';
import { supabase } from '@/lib/supabase';

// 하트 (F-CPRPRW, 개발 5단계). 사진·영상 한 장마다 한 사람이 하트 하나.
// - 같은 그룹 구성원 누구나 누가 눌렀는지 본다 (10/16 결정). 숫자는 보여주지 않고 이름만.
// - reactions의 읽기 정책이 security definer 함수(can_see_post)라서 insert에 select·upsert를 붙이지 않는다
//   (CLAUDE.md 알려진 제약). 이미 눌러 둔 하트를 또 넣으면 23505 → 성공으로 처리한다.
// - 활동 시각(last_active_at)은 DB 트리거가 갱신한다 (0003).

/** 사진(미디어) ID → 하트를 누른 사람 ID (먼저 누른 순) */
export type HeartBook = Map<string, string[]>;

export async function listHearts(mediaIds: string[]): Promise<HeartBook> {
  const book: HeartBook = new Map();
  if (mediaIds.length === 0) return book;
  const { data, error } = await supabase
    .from('reactions')
    .select('media_id, user_id')
    .in('media_id', mediaIds)
    .order('created_at', { ascending: true });
  if (error) throw error;
  for (const r of data ?? []) {
    const users = book.get(r.media_id) ?? [];
    users.push(r.user_id);
    book.set(r.media_id, users);
  }
  return book;
}

/** 하트를 남기고, 보낸 사람에게 알림을 요청한다 (그 묶음의 첫 하트인지는 서버가 판단) */
export async function addHeart(mediaId: string, postId: string, userId: string): Promise<void> {
  const { error } = await supabase.from('reactions').insert({ media_id: mediaId, user_id: userId });
  if (error && error.code !== '23505') throw error;
  requestNotify('heart', postId);
}

export async function removeHeart(mediaId: string, userId: string): Promise<void> {
  const { error } = await supabase.from('reactions').delete().eq('media_id', mediaId).eq('user_id', userId);
  if (error) throw error;
}
