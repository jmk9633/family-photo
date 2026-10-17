import * as AppleAuthentication from 'expo-apple-authentication';

import { supabase } from '@/lib/supabase';

import { LoginCancelled } from './errors';

/**
 * 애플 로그인 (iOS 네이티브).
 * 애플이 준 identityToken으로 Supabase에 로그인한다.
 * 애플 이름은 첫 로그인 때만 오지만, 표시 이름은 2단계에서 따로 받으므로 여기서 저장하지 않는다.
 */
export async function signInWithApple() {
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') throw new LoginCancelled();
    throw e;
  }

  if (!credential.identityToken) throw new Error('no_identity_token');

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
  });
  if (error) throw error;
}

/** 애플 로그인 버튼을 보여 줄지 (iOS 13 이상 기기에서만 true) */
export async function isAppleSignInAvailable() {
  return AppleAuthentication.isAvailableAsync();
}
