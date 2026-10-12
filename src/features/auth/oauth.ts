import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { supabase } from '@/lib/supabase';

import { LoginCancelled } from './errors';

WebBrowser.maybeCompleteAuthSession();

/**
 * 카카오·구글 로그인 (브라우저 방식).
 * 1) Supabase가 만든 로그인 주소를 앱 안 브라우저로 연다.
 * 2) 로그인이 끝나면 familyphoto://auth/callback?code=... (Expo Go에서는 exp://...)로 돌아온다.
 * 3) code를 세션으로 바꾼다.
 */
async function signInWithBrowser(provider: 'kakao' | 'google') {
  const redirectTo = Linking.createURL('auth/callback');

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
