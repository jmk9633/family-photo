import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { supabase } from '@/lib/supabase';

import { LoginCancelled } from './errors';

WebBrowser.maybeCompleteAuthSession();

/**
 * 로그인 후 돌아올 주소. Expo Go에서도 앱 스킴(familyphoto://)을 그대로 쓴다.
 * - Supabase는 IP 주소로 된 주소(exp://192.168.x.x:8081/...)를 보안상 항상 거부하고
 *   기본 주소(localhost)로 보내버린다. 그래서 Expo Go 기본 주소는 쓸 수 없다.
 * - iOS의 로그인 창(ASWebAuthenticationSession)은 이 주소로 이동하는 순간을 직접 잡아서 닫히므로,
 *   Expo Go에 familyphoto 스킴이 등록돼 있지 않아도 동작한다.
 * - 개발 빌드·실제 앱에서도 같은 주소라 설정을 바꿀 필요가 없다.
 *   (Android Expo Go에서는 동작하지 않는다. Android는 개발 빌드부터 테스트한다.)
 */
const REDIRECT_TO = 'familyphoto://auth/callback';

/**
 * 카카오·구글 로그인 (브라우저 방식).
 * 1) Supabase가 만든 로그인 주소를 앱 안 브라우저로 연다.
 * 2) 로그인이 끝나면 familyphoto://auth/callback?code=... 로 돌아온다.
 * 3) code를 세션으로 바꾼다.
 */
async function signInWithBrowser(provider: 'kakao' | 'google') {
  const redirectTo = REDIRECT_TO;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') {
    throw new LoginCancelled();
  }

  const { queryParams } = Linking.parse(result.url);
  const code = typeof queryParams?.code === 'string' ? queryParams.code : null;
  if (!code) {
    // 동의 화면에서 '취소'를 누르면 code 대신 error가 돌아온다.
    if (queryParams?.error === 'access_denied') throw new LoginCancelled();
    throw new Error(String(queryParams?.error_description ?? 'no_code'));
  }

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) throw exchangeError;
}

export const signInWithKakao = () => signInWithBrowser('kakao');
export const signInWithGoogle = () => signInWithBrowser('google');
