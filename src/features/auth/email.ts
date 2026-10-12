import { supabase } from '@/lib/supabase';

/** 이메일로 6자리 로그인 코드를 보낸다. 처음이면 가입, 이미 있으면 로그인. */
export async function sendEmailCode(email: string) {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { shouldCreateUser: true },
  });
  if (error) throw error;
}

/** 받은 6자리 코드로 로그인한다. */
export async function verifyEmailCode(email: string, token: string) {
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token,
    type: 'email',
  });
  if (error) throw error;
}

export function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
