import { supabase } from '@/lib/supabase';

// 내가 보낸 묶음 지우기 (F-LMXBXX 나간 사람의 사진 삭제 + 사진 상세·쉬운 화면에서 내 묶음 하나 지우기).
// 1) 먼저 'deleting'으로 바꿔 바로 아무에게도 안 보이게 한다 (실패하면 아무것도 안 바뀐 것이라 오류를 던진다).
// 2) 저장소 파일을 지우고 묶음을 지운다. 저장소 삭제 정책이 '그 묶음의 보낸 사람'인지를 묶음 행으로 확인하므로
//    묶음을 먼저 지우면 파일을 지울 수 없다. 묶음을 지우면 media·post_groups·하트·시청 기록은 DB가 함께 지운다.
//    2)가 중간에 실패해도 이미 안 보이고, 남은 것은 새벽 정리(0012)가 지운다 → 성공으로 본다 (7-4).
// 받은 모든 그룹에서 사라진다.

const BUCKET = 'media';

export async function deleteMyPost(postId: string): Promise<void> {
  const { error } = await supabase.from('posts').update({ status: 'deleting' }).eq('id', postId);
  if (error) throw error;
  try {
    const { data: media, error: e1 } = await supabase.from('media').select('path, thumb_path').eq('post_id', postId);
    if (e1) throw e1;
    const paths = (media ?? []).flatMap((m) => [m.path as string, m.thumb_path as string]).filter(Boolean);
    if (paths.length > 0) {
      const { error: e2 } = await supabase.storage.from(BUCKET).remove(paths);
      if (e2) throw e2;
    }
    const { error: e3 } = await supabase.from('posts').delete().eq('id', postId);
    if (e3) throw e3;
  } catch (e) {
    // 이미 아무에게도 안 보인다. 파일과 묶음은 새벽 정리가 지운다.
    if (__DEV__) console.warn('[deleteMyPost] 남은 것은 새벽 정리가 지움', postId, e);
  }
}

/**
 * 관리자가 남이 보낸 사진을 가족 앨범에서 내린다 (7-4, 0013 take_down_post).
 * 내가 관리자인 그룹에서만 빠지고, 다른 그룹에도 보낸 사진이면 그 그룹에는 남는다.
 * 보낸 사람에게 알리지 않는다. 파일은 새벽 정리가 지운다.
 */
export async function takeDownPost(postId: string): Promise<void> {
  const { error } = await supabase.rpc('take_down_post', { p_post: postId });
  if (error) throw error;
}

/** 이 묶음을 받은 그룹 중 내가 관리자인 그룹이 있는가 (사진 상세의 '가족 앨범에서 내리기' 표시용) */
export async function canTakeDown(userId: string, groupIds: string[]): Promise<boolean> {
  if (!userId || groupIds.length === 0) return false;
  const { count, error } = await supabase
    .from('members')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'active')
    .eq('is_admin', true)
    .in('group_id', groupIds);
  if (error) return false;
  return (count ?? 0) > 0;
}
