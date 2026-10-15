import { File } from 'expo-file-system';

// 올리기 직전 영상 파일에 위치(GPS) 정보가 남아 있는지 검사한다 (CLAUDE.md 보안 규칙 9).
//
// 압축 라이브러리(react-native-compressor)는 원래 원본의 위치를 새 파일에 옮겨 쓴다.
// patches/react-native-compressor+*.patch로 막았지만, 라이브러리를 올려 수정본이 안 먹거나
// 압축이 건너뛰어져 원본이 그대로 오는 경우까지 여기서 한 번 더 막는다.
//
// MP4 위치 정보는 moov 상자 안에만 있다: ©xyz(QuickTime·안드로이드), loci(3GPP),
// com.apple.quicktime.location.*(아이폰 mdta 키). 파일 전체가 아니라 moov만 읽는다.

const SIGNATURES: Uint8Array[] = [
  new Uint8Array([0xa9, 0x78, 0x79, 0x7a]), // ©xyz
  ascii('loci'),
  ascii('com.apple.quicktime.location'),
];
const MOOV_MAX_BYTES = 32 * 1024 * 1024;

function ascii(s: string): Uint8Array {
  return new Uint8Array([...s].map((c) => c.charCodeAt(0)));
}

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  const first = needle[0];
  const last = haystack.length - needle.length;
  outer: for (let i = 0; i <= last; i++) {
    if (haystack[i] !== first) continue;
    for (let j = 1; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const type4 = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

export class VideoLocationError extends Error {
  constructor(reason: 'has_location' | 'unreadable') {
    super(`video_location_${reason}`);
    this.name = 'VideoLocationError';
  }
}

/** 위치 정보가 있거나 파일 구조를 읽을 수 없으면 VideoLocationError를 던진다 (안전한 쪽으로 실패). */
export function assertNoLocation(uri: string): void {
  const file = new File(uri);
  const size = file.size ?? 0;
  const handle = file.open();
  try {
    let pos = 0;
    while (pos + 8 <= size) {
      handle.offset = pos;
      const head = handle.readBytes(Math.min(16, size - pos));
      let boxSize = u32(head, 0);
      const type = type4(head, 4);
      let headerSize = 8;
      if (boxSize === 1) {
        if (head.length < 16) throw new VideoLocationError('unreadable');
        // 64비트 크기 (2^53 넘는 파일은 없으므로 Number로 충분)
        boxSize = u32(head, 8) * 2 ** 32 + u32(head, 12);
        headerSize = 16;
      } else if (boxSize === 0) {
        boxSize = size - pos; // 파일 끝까지
      }
      if (boxSize < headerSize) throw new VideoLocationError('unreadable');

      if (type === 'moov') {
        const bodySize = boxSize - headerSize;
        if (bodySize > MOOV_MAX_BYTES) throw new VideoLocationError('unreadable');
        handle.offset = pos + headerSize;
        const moov = handle.readBytes(bodySize);
        if (SIGNATURES.some((sig) => contains(moov, sig))) throw new VideoLocationError('has_location');
        return;
      }
      pos += boxSize;
    }
    throw new VideoLocationError('unreadable'); // moov가 없다 = MP4가 아니거나 깨진 파일
  } finally {
    handle.close();
  }
}
