import { supabase } from '@/lib/supabase';

// 내가 보낸 묶음 지우기 (F-LMXBXX 나간 사람의 사진 삭제 + 사진 상세에서 내 묶음 하나 지우기).
// 저장소 파일을 먼저 지우고 묶음을 지운다. 저장소 삭제 정책이 '그 묶음의 보낸 사람'인지를 묶음 행으로 확인하므로
// 묶음을 먼저 지우면 파일을 지울 수 없다. 묶음을 지우면 media·post_groups·하트·시청 기록은 DB가 함께 지운다.
// 받은 모든 그룹에서 사라진다. 실패하면 오류를 던진다 (그룹 나가기에서는 'deleting'이라 이미 안 보인다).

const BUCKET = 'media';

export async function deleteMyPost(postId: string): Promise<void> {
  const { data: media, error } = await supabase.from('media').select('path, thumb_path').eq('post_id', postId);
  if (error) throw error;
  const paths = (media ?? []).flatMap((m) => [m.path as string, m.thumb_path as string]).filter(Boolean);
  if (paths.length > 0) {
    const { error: e2 } = await supabase.storage.from(BUCKET).remove(paths);
    if (e2) throw e2;
  }
  const { error: e3 } = await supabase.from('posts').delete().eq('id', postId);
  if (e3) throw e3;
}
