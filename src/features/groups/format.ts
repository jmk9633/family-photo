import { ko } from '@/copy/ko';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 초대 만료를 '10월 14일까지'처럼 날짜로 보여준다 (남은 시간으로 쓰지 않는다).
 * DB의 만료 시각은 마지막 날 다음 날 0시(KST)이므로 1밀리초 앞의 날짜를 쓴다.
 */
export function formatInviteDeadline(expiresAt: string): string {
  const kst = new Date(new Date(expiresAt).getTime() - 1 + KST_OFFSET_MS);
  return ko.invite.until(kst.getUTCMonth() + 1, kst.getUTCDate());
}

export function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() <= Date.now();
}

/** 표시 이름 규칙 (DB의 clean_display_name과 같게): 앞뒤 공백 제거 후 1~20자 */
export const NAME_MAX = 20;
export const GROUP_NAME_MAX = 40;
export const cleanName = (s: string) => s.trim();

/** DB 함수가 던진 오류를 사용자 문구로 바꾼다. */
export function toGroupErrorMessage(error: unknown): string {
  const msg =
    error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  if (/network request failed|fetch/i.test(msg)) return ko.errors.network;
  if (msg.includes('invalid_display_name')) return ko.groupErrors.invalidName;
  if (msg.includes('invalid_group_name')) return ko.groupErrors.invalidGroupName;
  if (msg.includes('forbidden')) return ko.groupErrors.forbidden;
  if (msg.includes('already_used')) return ko.groupErrors.alreadyUsed;
  if (msg.includes('already_revoked')) return ko.groupErrors.alreadyRevoked;
  if (msg.includes('not_member')) return ko.groupErrors.notMember;
  if (msg.includes('use_leave')) return ko.groupErrors.useLeave;
  if (msg.includes('invalid_phone')) return ko.groupErrors.invalidPhone;
  // 개발 중에는 원인을 바로 볼 수 있게 오류 원문을 터미널과 화면에 함께 보여준다.
  if (__DEV__) {
    const detail = JSON.stringify(error);
    console.warn('[group error]', detail);
    return `${ko.groupErrors.unknown}\n(${detail})`;
  }
  return ko.groupErrors.unknown;
}
