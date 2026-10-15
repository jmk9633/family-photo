import { VideoLocationError } from '@/lib/videoLocation';

// 보내기 실패를 원인별로 나눈다 (개발 4-7). 화면은 종류에 맞는 문구와,
// 다시 해도 결과가 같은 실패에는 '다시 보내기' 대신 '이 영상(사진) 빼고 보내기'를 보여준다.

export type SendErrorKind =
  | 'network' // 인터넷 끊김·서버 응답 없음 → 다시 보내기
  | 'media_unreadable' // 사진·영상 줄이기 실패 (손상, 지원 안 하는 형식) → 그 장 빼기
  | 'media_location' // 영상 위치 정보 검사에 걸림 → 그 장 빼기
  | 'too_large' // 저장소 파일 한도 초과 → 그 장 빼기
  | 'forbidden' // 그룹에서 나갔거나 내보내짐 → 가족 목록 확인
  | 'unknown'; // 그 밖 → 다시 보내기

export class SendError extends Error {
  constructor(
    readonly kind: SendErrorKind,
    /** 문제가 된 장 (0부터). 묶음 전체 문제면 null */
    readonly itemIndex: number | null,
    readonly cause?: unknown,
  ) {
    super(`send_${kind}`);
    this.name = 'SendError';
  }
}

/** 같은 일을 다시 해도 결과가 같은가 (자동 재시도·'다시 보내기'를 하지 않는다) */
export const isPermanent = (kind: SendErrorKind) => kind !== 'network' && kind !== 'unknown';

type ErrorLike = { name?: string; message?: string; code?: string; status?: number; statusCode?: string };

/** 서버(Supabase DB·Storage)와 주고받다 난 오류 */
export function classifyRemote(error: unknown): SendErrorKind {
  const e = (error ?? {}) as ErrorLike;
  const message = e.message ?? '';
  const status = e.status ?? Number(e.statusCode);
  if (/network request failed|failed to fetch|network error|timed out|the internet connection/i.test(message)) {
    return 'network';
  }
  if (status === 413 || e.code === 'EntityTooLarge' || /maximum allowed size|payload too large/i.test(message)) {
    return 'too_large';
  }
  // DB RLS(42501), Storage 정책 거부(403) = 이제 그 그룹 구성원이 아니다
  if (e.code === '42501' || status === 403 || /row-level security/i.test(message)) return 'forbidden';
  if (typeof status === 'number' && status >= 500) return 'network'; // 서버가 잠깐 응답하지 못함
  return 'unknown';
}

/** 폰에서 사진·영상을 줄이다 난 오류 */
export function classifyPrepare(error: unknown): SendErrorKind {
  return error instanceof VideoLocationError ? 'media_location' : 'media_unreadable';
}
