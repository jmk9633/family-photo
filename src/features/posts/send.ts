import { uuidv4 } from '@/lib/id';
import { preparePhoto } from '@/lib/image';

import {
  attachGroups,
  createPost,
  insertMedia,
  markReady,
  mediaPath,
  thumbPath,
  touchActive,
  uploadJpeg,
  type MediaRow,
} from './api';

// 묶음 보내기 순서와 자동 재시도.
// 실패하면 SendJob을 그대로 들고 있다가 '다시 보내기'로 이어서 보낸다
// (이미 만든 묶음·이미 올라간 사진은 다시 만들거나 올리지 않는다).

export const MAX_PER_POST = 30; // DB 트리거 too_many_media와 같은 값
export const TITLE_MAX = 60; // posts.title check와 같은 값

export type PickedPhoto = {
  uri: string;
  width: number;
  height: number;
  takenAt: string | null;
};

export type SendJob = {
  userId: string;
  photos: PickedPhoto[];
  title: string | null;
  tags: string[];
  groupIds: string[];
  // 진행 상태 (다시 보낼 때 이어서)
  postId: string;
  postCreated: boolean;
  mediaIds: string[];
  uploaded: (MediaRow | null)[];
};

export function newSendJob(
  input: Omit<SendJob, 'postId' | 'postCreated' | 'mediaIds' | 'uploaded'>,
): SendJob {
  return {
    ...input,
    postId: uuidv4(),
    postCreated: false,
    mediaIds: input.photos.map(() => uuidv4()),
    uploaded: input.photos.map(() => null),
  };
}

const RETRY_DELAYS_MS = [1000, 3000, 8000]; // 처음 실패 뒤 3번 더 시도

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (__DEV__) console.warn('[send retry]', attempt + 1, describeError(e));
      if (attempt < RETRY_DELAYS_MS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      }
    }
  }
  throw lastError;
}

/** 보내기 실행. onProgress(올라간 장 수). 끝까지 실패하면 오류를 던진다. */
export async function runSendJob(job: SendJob, onProgress: (done: number) => void): Promise<void> {
  if (!job.postCreated) {
    await withRetry(() => createPost(job.postId, job.userId, job.title, job.tags));
    job.postCreated = true;
  }
  const postId = job.postId;

  const doneCount = () => job.uploaded.filter(Boolean).length;
  onProgress(doneCount());

  for (let i = 0; i < job.photos.length; i++) {
    if (job.uploaded[i]) continue;
    const photo = job.photos[i];
    const mediaId = job.mediaIds[i];
    const prepared = await preparePhoto(photo.uri, photo);
    const path = mediaPath(postId, mediaId);
    const thumb = thumbPath(postId, mediaId);
    await withRetry(() => uploadJpeg(path, prepared.uri));
    await withRetry(() => uploadJpeg(thumb, prepared.thumbUri));
    job.uploaded[i] = {
      id: mediaId,
      post_id: postId,
      type: 'photo',
      path,
      thumb_path: thumb,
      width: prepared.width,
      height: prepared.height,
      taken_at: photo.takenAt,
      sort_order: i,
    };
    onProgress(doneCount());
  }

  const rows = job.uploaded.filter((r): r is MediaRow => r !== null);
  await withRetry(() => insertMedia(rows));
  await withRetry(() => attachGroups(postId, job.groupIds));
  await withRetry(() => markReady(postId));
  touchActive(job.userId).catch(() => {});
}

/**
 * 촬영 시각: 사진 정보의 DateTimeOriginal('2026:10:15 13:05:00')만 읽는다.
 * 시간대(OffsetTimeOriginal)가 있으면 쓰고, 없으면 폰 시간대로 본다.
 * 위치(GPS) 값은 읽지도 저장하지도 않는다.
 */
export function takenAtFromExif(exif: Record<string, unknown> | null | undefined): string | null {
  const raw = exif?.DateTimeOriginal ?? exif?.DateTime;
  if (typeof raw !== 'string') return null;
  const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const offset = exif?.OffsetTimeOriginal;
  const date =
    typeof offset === 'string' && /^[+-]\d{2}:\d{2}$/.test(offset)
      ? new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`)
      : new Date(+y, +mo - 1, +d, +h, +mi, +s);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** 개발 중 오류 원인 보기용. Error는 JSON.stringify하면 {}가 되므로 이름·메시지를 따로 꺼낸다. */
export function describeError(e: unknown): string {
  if (e instanceof Error) {
    const extra = JSON.stringify(e);
    return `${e.name}: ${e.message}${extra && extra !== '{}' ? ` ${extra}` : ''}`;
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
