import { supabase } from '@/lib/supabase';

// 알림 출발 요청 (10/17 결정 A): 보내기·하트·시청이 DB에 기록된 뒤 앱이 Edge Function `notify`를 부른다.
// 누구에게 무엇을 보낼지, 이미 보냈는지는 서버가 DB로 다시 확인한다 (supabase/functions/notify).
// 알림이 실패해도 사용자의 동작(보내기·하트·보기)은 이미 끝났으므로 오류를 밖으로 던지지 않는다.

export type NotifyKind = 'new_post' | 'heart' | 'seen';

export function requestNotify(type: NotifyKind, postId: string): void {
  supabase.functions
    .invoke('notify', { body: { type, postId } })
    .then(({ data, error }) => {
      if (__DEV__) {
        if (error) console.warn('[notify failed]', type, error);
        else console.log('[notify]', type, data);
      }
    })
    .catch((e) => {
      if (__DEV__) console.warn('[notify failed]', type, e);
    });
}
