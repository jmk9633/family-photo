import AsyncStorage from '@react-native-async-storage/async-storage';

import { readKey, STORE_KEYS, widgetEndpoint } from './store';

// 안드로이드 위젯이 서버(Edge Function `widget`)에서 가장 최근 사진 한 건을 받아 오는 곳 (8-3).
// iOS 위젯(targets/widget/FamilyPhotoWidget.swift의 Loader)과 같은 규칙:
//   - 위젯 열쇠만 보낸다(앱의 로그인 정보는 쓰지 않음). 고르는 규칙은 서버의 widget_feed(0014)가 정한다.
//   - 사진은 썸네일(긴 변 480px)의 5분짜리 서명 URL로 받아 바로 내려받아 둔다(서명 URL은 다시 쓰지 않음).
//   - 인터넷이 안 되면 마지막으로 받은 사진을 그대로 보여준다. 다른 열쇠(다른 사람)의 저장 사진은 보여주지 않는다.
//   - 이 요청은 '봤어요'도 활동도 아니다 (서버가 아무것도 기록하지 않는다).

export type WidgetState = 'ok' | 'connect' | 'empty' | 'unavailable';

export type Snapshot = {
  state: WidgetState;
  isNew: boolean;
  count: number;
  title: string | null;
  sender: string | null;
  createdAt: string | null;
  /** 썸네일 (data:image/jpeg;base64,...). 위젯이 서명 URL을 다시 부르지 않게 내려받아 둔다 */
  image: string | null;
  imageWidth: number;
  imageHeight: number;
};

const EMPTY: Snapshot = {
  state: 'empty',
  isNew: false,
  count: 0,
  title: null,
  sender: null,
  createdAt: null,
  image: null,
  imageWidth: 0,
  imageHeight: 0,
};

const state = (s: WidgetState): Snapshot => ({ ...EMPTY, state: s });

type FeedResponse = {
  status: string;
  isNew?: boolean;
  count?: number;
  title?: string | null;
  sender?: string | null;
  createdAt?: string | null;
  imageUrl?: string | null;
};

type Cached = { owner: string; snap: Snapshot };

async function loadCache(owner: string): Promise<Snapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEYS.cache);
    if (!raw) return null;
    const c = JSON.parse(raw) as Cached;
    return c.owner === owner ? c.snap : null;
  } catch {
    return null;
  }
}

async function saveCache(owner: string, snap: Snapshot): Promise<void> {
  try {
    await AsyncStorage.setItem(STORE_KEYS.cache, JSON.stringify({ owner, snap } satisfies Cached));
  } catch {
    // 저장을 못 해도 이번에는 그대로 보여준다
  }
}

export async function clearCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORE_KEYS.cache);
  } catch {
    // 무시
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==';
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return out;
}

/**
 * JPEG 가로·세로 (SOF 표시에서 읽는다). 위젯 라이브러리는 사진을 주어진 크기로 늘려 넣기 때문에,
 * 원래 비율을 알아야 찌그러지지 않게 꽉 채울(가운데 자르기) 수 있다.
 */
export function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
      i += marker === 0xff ? 1 : 2;
      continue;
    }
    const len = (b[i + 2] << 8) | b[i + 3];
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = (b[i + 5] << 8) | b[i + 6];
      const width = (b[i + 7] << 8) | b[i + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i += 2 + len;
  }
  return null;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function downloadThumb(url: string): Promise<Pick<Snapshot, 'image' | 'imageWidth' | 'imageHeight'> | null> {
  try {
    const res = await fetchWithTimeout(url, {}, 15000);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const size = jpegSize(bytes);
    if (!size) return null; // 썸네일은 항상 JPEG. 아니면 저장된 사진을 쓴다
    return { image: `data:image/jpeg;base64,${toBase64(bytes)}`, imageWidth: size.width, imageHeight: size.height };
  } catch {
    return null;
  }
}

async function fetchSnapshot(): Promise<Snapshot> {
  const key = await readKey();
  if (!key) {
    // 로그인 전·로그아웃 뒤: 이전 사람의 사진이 남지 않게 지운다
    await clearCache();
    return state('connect');
  }
  const owner = key.slice(0, 16);

  try {
    const res = await fetchWithTimeout(
      widgetEndpoint(),
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) },
      15000,
    );
    if (!res.ok) throw new Error(`widget ${res.status}`);
    const feed = (await res.json()) as FeedResponse;

    if (feed.status === 'ok') {
      const snap: Snapshot = {
        ...EMPTY,
        state: 'ok',
        isNew: !!feed.isNew,
        count: feed.count ?? 0,
        title: feed.title ?? null,
        sender: feed.sender ?? null,
        createdAt: feed.createdAt ?? null,
      };
      const thumb = feed.imageUrl ? await downloadThumb(feed.imageUrl) : null;
      if (thumb) {
        Object.assign(snap, thumb);
      } else {
        // 사진만 못 받았으면 같은 묶음의 저장해 둔 사진을 쓴다
        const cached = await loadCache(owner);
        if (cached?.image && cached.createdAt === snap.createdAt) {
          snap.image = cached.image;
          snap.imageWidth = cached.imageWidth;
          snap.imageHeight = cached.imageHeight;
        }
      }
      await saveCache(owner, snap);
      return snap;
    }
    await clearCache();
    return state(feed.status === 'empty' ? 'empty' : 'connect'); // invalid · no_group → 연결 안내
  } catch {
    // 인터넷이 안 되거나 서버 오류: 마지막으로 받은 사진을 그대로
    return (await loadCache(owner)) ?? state('unavailable');
  }
}

// 큰 위젯·중간 위젯이 같은 때 함께 깨어나도 서버에는 한 번만 묻는다
let inflight: Promise<Snapshot> | null = null;
let last: { at: number; snap: Snapshot } | null = null;
const SHARE_MS = 20 * 1000;

/** 최신 사진을 받는다. 20초 안에 받은 것이 있으면 그것을 쓴다 (fresh면 새로 받음) */
export function loadSnapshot({ fresh = false }: { fresh?: boolean } = {}): Promise<Snapshot> {
  if (!fresh && last && Date.now() - last.at < SHARE_MS) return Promise.resolve(last.snap);
  if (inflight) return inflight;
  inflight = fetchSnapshot()
    .then((snap) => {
      last = { at: Date.now(), snap };
      return snap;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** 서버에 묻지 않고 저장된 것만 (위젯 크기를 바꿨을 때) */
export async function cachedSnapshot(): Promise<Snapshot> {
  const key = await readKey();
  if (!key) return state('connect');
  return (await loadCache(key.slice(0, 16))) ?? (await loadSnapshot());
}

/** 로그아웃 등으로 기억해 둔 결과를 버린다 */
export function forgetSnapshot(): void {
  last = null;
}

/** DB 시각('2026-10-25T01:02:03.123456+00:00')을 Date로. 소수점 아래 자릿수가 달라도 되게 소수점은 뗀다 */
export function parseDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s.replace(/\.\d+/, ''));
  return Number.isNaN(d.getTime()) ? null : d;
}
