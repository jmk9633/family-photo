import Constants, { ExecutionEnvironment } from 'expo-constants';
import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';

// 사진 줄이기 (CLAUDE.md '이미지·영상 처리'):
// 긴 변 2048px 이하 JPEG(품질 0.8), 썸네일 긴 변 480px.
// 새 JPEG로 다시 저장하므로 원본의 위치(GPS) 등 메타데이터는 따라오지 않는다 (보안 규칙 9).
// Supabase 이미지 변환 기능은 쓰지 않는다 (비용).
export const PHOTO_MAX = 2048;
export const THUMB_MAX = 480;
const JPEG_QUALITY = 0.8;

export type PreparedPhoto = {
  uri: string;
  width: number;
  height: number;
  thumbUri: string;
};

/** 긴 변이 max보다 크면 비율을 지켜 줄인다. 작으면 그대로 둔다. */
async function fit(source: ImageRef, max: number): Promise<ImageRef> {
  if (Math.max(source.width, source.height) <= max) return source;
  const landscape = source.width >= source.height;
  return ImageManipulator.manipulate(source)
    .resize(landscape ? { width: max, height: null } : { width: null, height: max })
    .renderAsync();
}

/**
 * [임시 · Expo Go 전용] Expo Go에 들어 있는 예전 expo-image-manipulator는 세로로 찍은 아이폰 사진의
 * 방향을 바로잡는 단계에서 ERR_IMAGE_CONTEXT_LOST로 실패한다 (57.0.21에서 고쳐짐, Expo Go는 예전 버전).
 * 그래서 Expo Go에서는 줄이기를 건너뛰고, 사진 고르기가 품질 0.8로 다시 저장한 JPEG를 그대로 쓴다
 * (다시 저장하면서 위치 정보는 빠진다). 썸네일도 같은 파일.
 * → 4단계 개발 빌드에서 진짜 줄이기를 확인하고 이 우회를 지운다.
 */
export const IS_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export async function preparePhoto(
  uri: string,
  pickedSize: { width: number; height: number },
): Promise<PreparedPhoto> {
  if (IS_EXPO_GO) {
    return { uri, width: pickedSize.width, height: pickedSize.height, thumbUri: uri };
  }
  // 먼저 그대로 한 번 불러와서 (사진 회전 정보가 반영된) 실제 가로·세로를 얻는다.
  const original = await ImageManipulator.manipulate(uri).renderAsync();
  const refs: ImageRef[] = [original];
  try {
    const main = await fit(original, PHOTO_MAX);
    refs.push(main);
    const thumb = await fit(main, THUMB_MAX);
    refs.push(thumb);
    const [mainFile, thumbFile] = await Promise.all([
      main.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY }),
      thumb.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY }),
    ]);
    return {
      uri: mainFile.uri,
      width: mainFile.width,
      height: mainFile.height,
      thumbUri: thumbFile.uri,
    };
  } finally {
    // 메모리에 올린 큰 이미지를 바로 놓아 준다 (30장을 연달아 처리하므로).
    for (const ref of new Set(refs)) ref.release();
  }
}
