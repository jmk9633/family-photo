import { isAuthApiError, isAuthRetryableFetchError } from '@supabase/supabase-js';

import { ko } from '@/copy/ko';

/** 로그인 중 생긴 오류를 사용자에게 보여줄 한국어 문구로 바꾼다. */
export function toKoreanMessage(error: unknown): string {
  if (isAuthRetryableFetchError(error)) return ko.errors.network;
  if (error instanceof Error && /network request failed/i.test(error.message)) {
    return ko.errors.network;
  }
  if (isAuthApiError(error)) {
    switch (error.code) {
      case 'otp_expired':
        return ko.errors.wrongCode;
      case 'over_email_send_rate_limit':
      case 'over_request_rate_limit':
        return ko.errors.tooMany;
    }
  }
  return ko.errors.loginFailed;
}

/** 사용자가 로그인 창을 닫은 경우. 오류로 보여주지 않는다. */
export class LoginCancelled extends Error {
  constructor() {
    super('login_cancelled');
  }
}
