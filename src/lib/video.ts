import { createVideoThumbnail, getVideoMetaData, Video } from 'react-native-compressor';

import { prepareThumb } from './image';
import { assertNoLocation } from './videoLocation';

// 영상 줄이기 (CLAUDE.md '이미지·영상 처리', 결정 D5):
// 긴 변 1280px(720p) H.264, 목표 비트레이트 3Mbps → 1분에 약 23MB (+음성 128kbps).
// 원본이 이미 그보다 가벼우면 원본 비트레이트의 95%로 (일부러 키우지 않는다).
// 압축한 파일에서 대표 프레임을 뽑아 사진과 같은 썸네일(긴 변 480px)을 만든다.
// 올리기 전에 위치 정보가 없는지 검사한다 (videoLocation.ts).

export const VIDEO_MAX_SEC = 60; // DB media.duration_sec 검사(≤61, 반올림 여유)와 같은 기준
export const VIDEO_LONG_SIDE = 1280;
const TARGET_BITRATE = 3_000_000;
const MIN_BITRATE = 500_000;

/** 고를 때 쓰는 길이 검사. 사진 앱이 '1:00'으로 보여주는 영상(60.4초 등)은 통과시킨다. */
export const isVideoTooLong = (durationSec: number | null) =>
  durationSec !== null && Math.round(durationSec) > VIDEO_MAX_SEC;

export type PreparedVideo = {
  uri: string;
  width: number;
  height: number;
  durationSec: number;
  thumbUri: string;
};

const asFileUri = (p: string) => (p.startsWith('file://') ? p : `file://${p}`);

export async function prepareVideo(uri: string, onProgress: (ratio: number) => void): Promise<PreparedVideo> {
  const meta = await getVideoMetaData(uri);
  const durationSec = Math.round(meta.duration * 10) / 10;
  if (isVideoTooLong(durationSec)) throw new Error('video_too_long');

  const sourceBitrate = meta.duration > 0 ? (meta.size * 8) / meta.duration : TARGET_BITRATE;
  const bitrate = Math.max(MIN_BITRATE, Math.min(TARGET_BITRATE, Math.floor(sourceBitrate * 0.95)));

  const output = asFileUri(
    await Video.compress(
      uri,
      {
        compressionMethod: 'manual',
        maxSize: VIDEO_LONG_SIDE,
        bitrate,
        minimumFileSizeForCompress: 0, // 작은 영상도 항상 다시 쓴다 (원본 메타데이터가 그대로 가지 않게)
        progressDivider: 5,
      },
      onProgress,
    ),
  );

  assertNoLocation(output);

  // 대표 프레임 (회전이 반영된 방향) → 썸네일. 가로·세로 비율도 여기서 얻는다.
  const frame = await createVideoThumbnail(output);
  const thumb = await prepareThumb(asFileUri(frame.path));
  const longSide = Math.min(VIDEO_LONG_SIDE, Math.max(meta.width, meta.height));
  const landscape = thumb.width >= thumb.height;
  const ratio = landscape ? thumb.height / thumb.width : thumb.width / thumb.height;
  const short = Math.round(longSide * ratio);

  return {
    uri: output,
    width: landscape ? longSide : short,
    height: landscape ? short : longSide,
    durationSec,
    thumbUri: thumb.uri,
  };
}
