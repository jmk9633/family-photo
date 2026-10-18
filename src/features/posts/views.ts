import { requestNotify } from '@/features/push/notify';
import { supabase } from '@/lib/supabase';

// '봤어요' (F-BLIYTI, 개발 5단계).
// - 묶음에서 한 장이라도 보면 그 묶음을 본 것 (묶음, 사람, 날짜) 한 줄. 날짜는 서버가 한국 시간 오늘로 정한다 (0003).
// - 일반 모드에서는 사진 상세를 열 때, 타임라인에서 카드가 절반 이상 1초 보일 때 기록한다 (10/16 결정).
// - 보는 쪽: 내가 보낸 묶음의 기록만 DB가 돌려준다 (post_views_select, 0003). 시청 표시를 끈 사람은 빠진다.
// - 활동 시각(last_active_at)은 DB 트리거가 갱신한다. 시청 표시를 꺼도 기록은 남는다.

// 같은 날 같은 묶음은 한 번만 보낸다 (타임라인을 오르내릴 때마다 요청하지 않게).
const recorded = new Set<string>();

function kstToday(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 묶음을 봤다고 기록한다. 실패해도 보기에는 영향이 없으므로 오류를 밖으로 던지지 않는다. */
export async function recordView(postId: string, userId: string): Promise<void> {
  const key = `${userId}:${postId}:${kstToday()}`;
  if (recorded.has(key)) return;
  recorded.add(key);
  const { error } = await supabase.from('post_views').insert({ post_id: postId, user_id: userId, device_kind: 'phone' });
  if (error && error.code !== '23505') {
    recorded.delete(key); // 다음에 다시 시도
    if (__DEV__) console.warn('[view record failed]', error);
    return;
  }
  // 오늘 처음 본 기록이면 보낸 사람에게 '봤어요' 알림 (시청 표시를 껐으면 서버가 보내지 않는다)
  if (!error) requestNotify('seen', postId);
}

/** 묶음 ID → 본 사람 ID (처음 본 순, 한 사람은 한 번). 내가 보낸 묶음만 결과가 있다. */
export async function listViewers(postIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (postIds.length === 0) return out;
  const { data, error } = await supabase
    .from('post_views')
    .select('post_id, user_id, viewed_on')
    .in('post_id', postIds)
    .order('viewed_on', { ascending: true });
  if (error) throw error;
  for (const v of data ?? []) {
    const users = out.get(v.post_id) ?? [];
    if (!users.includes(v.user_id)) users.push(v.user_id);
    out.set(v.post_id, users);
  }
  return out;
}

/** 내 '봤어요'를 가족에게 보여줄지 (profiles.show_seen, 기본 켜짐) */
export async function getShowSeen(userId: string): Promise<boolean> {
  const { data, error } = await supabase.from('profiles').select('show_seen').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data?.show_seen ?? true;
}

export async function setShowSeen(userId: string, on: boolean): Promise<void> {
  const { error } = await supabase.from('profiles').update({ show_seen: on }).eq('id', userId);
  if (error) throw error;
}
