import { supabase } from '@/lib/supabase';

// 가입 없이 쓰는 쉬운 화면 사용자 (Supabase 익명 로그인, 10/18 결정 3).
// 숫자 6자리를 다 누르고 '연결하기'를 누를 때 처음 한 번만 만든다. 이미 로그인돼 있으면 그대로 쓴다
// (틀린 숫자를 다시 눌러도 같은 계정 → 서버의 '10분에 5번' 제한이 그대로 걸린다).
// 연결되지 못한 익명 계정은 7단계 정리 작업이 지운다.
export async function ensureSignedIn(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return;
  const { error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
}
