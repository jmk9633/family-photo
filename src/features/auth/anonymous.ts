import type { AuthError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

// 가입 없이 쓰는 쉬운 화면 사용자 (Supabase 익명 로그인, 10/18 결정 3).
// 숫자 6자리를 다 누르고 '연결하기'를 누를 때 처음 한 번만 만든다. 이미 로그인돼 있으면 그대로 쓴다
// (틀린 숫자를 다시 눌러도 같은 계정 → 서버의 '10분에 5번' 제한이 그대로 걸린다).
// 연결되지 못한 채 7일 지난 익명 계정은 새벽 정리 작업이 지운다 (7-3, 0012).
// 지워진 계정이 이 폰에 남아 있으면 조용히 새 익명 계정을 만들어 그대로 연결한다 (10/25 결정 3).
// 화면은 바뀌지 않는다: 로그아웃(signedOut)과 연결 중(connecting)은 같은 (auth) 화면 모음이다.
export async function ensureSignedIn(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    // 계정이 있는 사람은 지워지지 않으므로 서버에 묻지 않는다
    if (!data.session.user.is_anonymous) return;
    const { error } = await supabase.auth.getUser();
    if (!error) return;
    // 인터넷이 안 되는 등 다른 오류면 그대로 두고, 연결하기에서 평소처럼 오류를 보여준다
    if (!isGoneUser(error)) return;
    await supabase.auth.signOut({ scope: 'local' });
  }
  const { error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
}

/** 서버에 이 계정이 더 이상 없다 (새벽 정리 작업이 지움) */
function isGoneUser(error: AuthError): boolean {
  return (
    error.code === 'user_not_found' ||
    error.code === 'session_not_found' ||
    error.code === 'refresh_token_not_found' ||
    error.status === 403 ||
    error.status === 404
  );
}
