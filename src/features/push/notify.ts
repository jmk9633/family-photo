import { supabase } from '@/lib/supabase';

// 알림 출발 요청 (10/17 결정 A): 보내기·하트·시청이 DB에 기록된 뒤 앱이 Edge Function `notify`를 부른다.
// 누구에게 무엇을 보낼지, 이미 보냈는지는 서버가 DB로 다시 확인한다 (supabase/functions/notify).
// 알림이 실패해도 사용자의 동작(보내기·하트·보기)은 이미 끝났으므로 오류를 밖으로 던지지 않는다.

export type NotifyKind = 'new_post' | 'heart' | 'seen';

export function requestNotify(type: NotifyKind, postId: string): void {
  invoke(type, { type, postId });
}

/** 초대 코드로 그룹에 들어간 뒤: 그 그룹 구성원에게 '가족이 들어왔어요' (방금 들어왔는지는 서버가 확인) */
export function requestJoinNotify(groupId: string): void {
  invoke('joined', { type: 'joined', groupId });
}

/** 그룹을 나간 뒤: 관리자가 자동으로 넘어갔다면 새 관리자와 그룹에 알린다 (넘어갔는지는 서버가 확인) */
export function requestAdminNotify(groupId: string): void {
  invoke('admin_changed', { type: 'admin_changed', groupId });
}

function invoke(type: string, body: Record<string, string>): void {
  supabase.functions
    .invoke('notify', { body })
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
