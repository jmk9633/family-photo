import { ko } from '@/copy/ko';

// 날짜는 한국 시간 기준으로 보여준다 (월 묶음도 DB의 album_months와 같은 기준).
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstParts(iso: string) {
  const d = new Date(new Date(iso).getTime() + KST_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

/** 묶음이 속한 달의 키 'YYYY-MM-01' (album_months의 month와 같은 모양) */
export function monthKey(iso: string): string {
  const { y, m } = kstParts(iso);
  return `${y}-${String(m).padStart(2, '0')}-01`;
}

/** 'YYYY-MM-01' → '2026년 10월' */
export function formatMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return ko.date.month(y, m);
}

/** 그 달의 시작·끝 (한국 시간 1일 0시, ISO 문자열) */
export function kstMonthRange(key: string): { start: string; end: string } {
  const [y, m] = key.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1) - KST_OFFSET_MS);
  const end = new Date(Date.UTC(y, m, 1) - KST_OFFSET_MS);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** '10월 8일' (올해) / '2025년 10월 8일' (다른 해) */
export function formatDay(iso: string): string {
  const p = kstParts(iso);
  const now = kstParts(new Date().toISOString());
  return p.y === now.y ? ko.date.day(p.m, p.d) : ko.date.dayWithYear(p.y, p.m, p.d);
}

/**
 * 묶음 제목: 영상 한마디는 저장한 제목 대신 'OO의 영상 한마디' (6단계 결정 10), 그 밖에는 보낸 사람이 붙인 제목.
 * 이름은 화면마다 쓰는 보낸 사람 이름 규칙(senderName)을 그대로 받는다.
 */
export function titleOf(post: { kind?: string; title: string | null }, sender: string | null): string | null {
  if (post.kind === 'video_message') return ko.feed.videoMessage(sender ?? ko.feed.unknownSender);
  return post.title;
}

/** 그 달의 며칠인지 (한국 시간) */
export function dayOfMonth(iso: string): number {
  return kstParts(iso).d;
}

/** 영상 길이 '0:14', '1:00' */
export function formatDuration(sec: number | null): string {
  const s = Math.max(0, Math.round(sec ?? 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
