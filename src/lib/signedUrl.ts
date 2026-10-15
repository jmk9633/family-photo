import type { ImageSource } from 'expo-image';

import { supabase } from './supabase';

// 비공개 media 버킷의 사진은 서명 URL로만 보여준다 (CLAUDE.md 보안 규칙 7).
//
// 서명 URL은 만들 때마다 주소(token)가 달라진다. 주소를 그대로 캐시 키로 쓰면 같은 사진을
// 매번 다시 받으므로, 화면에는 { uri: 서명 URL, cacheKey: 저장 경로 }로 넘긴다.
// expo-image는 cacheKey로 디스크 캐시를 찾으므로 한 번 받은 사진은 URL이 바뀌어도 다시 받지 않는다.
//
// 유효 시간 1시간. 10분 이내로 남은 주소는 다음에 필요할 때 새로 받는다.

const BUCKET = 'media';
const TTL_SEC = 60 * 60;
const REFRESH_MARGIN_MS = 10 * 60 * 1000;
const BATCH = 100;

const cache = new Map<string, { url: string; expiresAt: number }>();

function isFresh(path: string, now: number): boolean {
  const hit = cache.get(path);
  return !!hit && hit.expiresAt - now > REFRESH_MARGIN_MS;
}

/** 아직 없거나 곧 만료되는 경로만 모아 한 번에 서명한다. */
export async function signPaths(paths: string[]): Promise<void> {
  const now = Date.now();
  const need = [...new Set(paths)].filter((p) => p && !isFresh(p, now));
  for (let i = 0; i < need.length; i += BATCH) {
    const chunk = need.slice(i, i + BATCH);
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(chunk, TTL_SEC);
    if (error) throw error;
    for (const item of data) {
      if (item.path && item.signedUrl && !item.error) {
        cache.set(item.path, { url: item.signedUrl, expiresAt: now + TTL_SEC * 1000 });
      }
    }
  }
}

/** 서명해 둔 경로의 이미지 소스. 아직 서명 전이면 null (화면은 빈 칸을 보여준다). */
export function signedSource(path: string | null | undefined): ImageSource | null {
  if (!path) return null;
  const hit = cache.get(path);
  return hit ? { uri: hit.url, cacheKey: path } : null;
}

/** 서명 URL 문자열 (영상 재생처럼 cacheKey를 못 쓰는 곳). */
export function signedUrl(path: string): string | null {
  return cache.get(path)?.url ?? null;
}

/** 로그아웃할 때 다른 계정에 이전 계정의 주소가 남지 않게 비운다. */
export function clearSignedUrls(): void {
  cache.clear();
}
