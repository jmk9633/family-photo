import { File } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { requestNotify } from '@/features/push/notify';
import { uuidv4 } from '@/lib/id';
import { preparePhoto } from '@/lib/image';
import { prepareVideo } from '@/lib/video';

import {
  attachGroups,
  createPost,
  insertMedia,
  markReady,
  mediaPath,
  thumbPath,
  touchActive,
  uploadFile,
  type MediaRow,
} from './api';
import { classifyPrepare, classifyRemote, isPermanent, SendError } from './sendErrors';

// 묶음 보내기 순서와 자동 재시도.
// 실패하면 SendJob을 그대로 들고 있다가 '다시 보내기'로 이어서 보낸다
// (이미 만든 묶음·이미 올라간 파일은 다시 만들거나 올리지 않는다. 이미 줄인 영상도 다시 줄이지 않는다).

export const MAX_PER_POST = 30; // DB 트리거 too_many_media와 같은 값
export const TITLE_MAX = 60; // posts.title check와 같은 값

export type PickedMedia = {
  type: 'photo' | 'video';
  uri: string;
  width: number;
  height: number;
  takenAt: string | null;
  durationSec: number | null; // 영상만
};

/** 줄여서 올릴 준비가 된 파일 (다시 보낼 때 재사용) */
type Prepared = { uri: string; thumbUri: string; width: number; height: number; durationSec: number | null };

export type SendJob = {
  userId: string;
  items: PickedMedia[];
  title: string | null;
  tags: string[];
  groupIds: string[];
  // 진행 상태 (다시 보낼 때 이어서)
  postId: string;
  postCreated: boolean;
  mediaIds: string[];
  prepared: (Prepared | null)[];
  uploaded: (MediaRow | null)[];
};

/** done = 올라간 장 수, compressing = 지금 줄이고 있는 영상의 진행(0~1), 없으면 null */
export type SendProgress = { done: number; compressing: number | null };

export function newSendJob(
  input: Omit<SendJob, 'postId' | 'postCreated' | 'mediaIds' | 'prepared' | 'uploaded'>,
): SendJob {
  return {
    ...input,
    postId: uuidv4(),
    postCreated: false,
    mediaIds: input.items.map(() => uuidv4()),
    prepared: input.items.map(() => null),
    uploaded: input.items.map(() => null),
  };
}

const RETRY_DELAYS_MS = [1000, 3000, 8000]; // 처음 실패 뒤 3번 더 시도

/**
 * 서버와 주고받는 일을 자동으로 다시 시도한다. 다시 해도 같은 실패(권한, 파일 한도)는 바로 멈춘다.
 * 끝까지 실패하면 원인을 담은 SendError를 던진다. itemIndex = 그 일이 어느 장의 일인지.
 */
async function withRetry<T>(fn: () => Promise<T>, itemIndex: number | null = null): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (__DEV__) console.warn('[send retry]', attempt + 1, describeError(e));
      if (isPermanent(classifyRemote(e))) break;
      if (attempt < RETRY_DELAYS_MS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
      }
    }
  }
  const kind = classifyRemote(lastError);
  // 파일 한도는 그 장의 문제, 권한은 묶음 전체의 문제
  throw new SendError(kind, kind === 'too_large' ? itemIndex : null, lastError);
}

const stillThere = (p: Prepared | null): p is Prepared =>
  !!p && new File(p.uri).exists && new File(p.thumbUri).exists;

/**
 * 사진은 줄이고, 영상은 압축·위치 검사·대표 프레임을 만든다.
 * 줄이기는 다시 시도해도 같은 결과라 재시도하지 않는다 (파일 문제는 다시 해도 안 된다).
 */
async function prepare(item: PickedMedia, onCompress: (ratio: number) => void): Promise<Prepared> {
  if (item.type === 'video') {
    const v = await prepareVideo(item.uri, onCompress);
    return { uri: v.uri, thumbUri: v.thumbUri, width: v.width, height: v.height, durationSec: v.durationSec };
  }
  const p = await preparePhoto(item.uri);
  return { uri: p.uri, thumbUri: p.thumbUri, width: p.width, height: p.height, durationSec: null };
}

/**
 * 보내기 실행. 끝까지 실패하면 SendError를 던진다.
 * 보내는 동안에는 화면이 꺼지지 않게 한다 (긴 영상을 줄이다 화면이 꺼지면 실패하므로).
 */
export async function runSendJob(job: SendJob, onProgress: (p: SendProgress) => void): Promise<void> {
  const keepAwakeTag = `send-${job.postId}`;
  await activateKeepAwakeAsync(keepAwakeTag).catch(() => {}); // 못 켜도 보내기는 한다
  try {
    await runSteps(job, onProgress);
  } finally {
    deactivateKeepAwake(keepAwakeTag).catch(() => {});
  }
}

/** 실패한 장을 빼고 이어서 보낼 수 있게 한다 (이미 올라간 장은 그대로). 남은 장 수를 돌려준다. */
export function dropItem(job: SendJob, index: number): number {
  if (job.uploaded[index]) return job.items.length; // 이미 올라간 장은 빼지 않는다
  job.items.splice(index, 1);
  job.mediaIds.splice(index, 1);
  job.prepared.splice(index, 1);
  job.uploaded.splice(index, 1);
  return job.items.length;
}

async function runSteps(job: SendJob, onProgress: (p: SendProgress) => void): Promise<void> {
  if (!job.postCreated) {
    await withRetry(() => createPost(job.postId, job.userId, job.title, job.tags));
    job.postCreated = true;
  }
  const postId = job.postId;

  const doneCount = () => job.uploaded.filter(Boolean).length;
  onProgress({ done: doneCount(), compressing: null });

  for (let i = 0; i < job.items.length; i++) {
    if (job.uploaded[i]) continue;
    const item = job.items[i];
    const mediaId = job.mediaIds[i];

    let prepared = job.prepared[i];
    if (!stillThere(prepared)) {
      if (item.type === 'video') onProgress({ done: doneCount(), compressing: 0 });
      try {
        prepared = await prepare(item, (ratio) => onProgress({ done: doneCount(), compressing: ratio }));
      } catch (e) {
        if (__DEV__) console.warn('[send prepare failed]', i, describeError(e));
        throw new SendError(classifyPrepare(e), i, e);
      }
      job.prepared[i] = prepared;
      onProgress({ done: doneCount(), compressing: null });
    }
    const ready = prepared;

    const path = mediaPath(postId, mediaId, item.type);
    const thumb = thumbPath(postId, mediaId);
    await withRetry(() => uploadFile(path, ready.uri, item.type === 'video' ? 'video/mp4' : 'image/jpeg'), i);
    await withRetry(() => uploadFile(thumb, ready.thumbUri, 'image/jpeg'), i);
    job.uploaded[i] = {
      id: mediaId,
      post_id: postId,
      type: item.type,
      path,
      thumb_path: thumb,
      width: ready.width,
      height: ready.height,
      duration_sec: ready.durationSec,
      taken_at: item.takenAt,
      sort_order: i,
    };
    onProgress({ done: doneCount(), compressing: null });
  }

  const rows = job.uploaded.filter((r): r is MediaRow => r !== null);
  await withRetry(() => insertMedia(rows));
  await withRetry(() => attachGroups(postId, job.groupIds));
  await withRetry(() => markReady(postId));
  requestNotify('new_post', postId); // 받은 그룹 가족에게 '새 사진이 왔어요'
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
  if (e instanceof SendError) {
    return `${e.name}(${e.kind}, item=${e.itemIndex}) ← ${describeError(e.cause)}`;
  }
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
