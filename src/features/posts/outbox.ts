import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';

import { newSendJob, runSendJob, type PickedMedia, type PostKind } from './send';

// 쉬운 화면 '나중에 다시 보낼게요' (F-BBQGEJ·F-TFIFCO, 6-2 결정 5).
// 자동 재시도(3번)까지 실패한 사진·영상 한마디는 찍은 파일을 앱 문서 폴더에 옮겨 두고 목록에 남긴다.
// 쉬운 화면 홈을 열 때마다 다시 보낸다. 같은 묶음 ID로 다시 보내므로 이미 올라간 것은 다시 만들지 않는다.
// 이 폰에만 남는다 (앱을 지우면 함께 지워진다).

type OutboxEntry = {
  postId: string;
  mediaId: string;
  kind: PostKind;
  item: PickedMedia; // uri는 문서 폴더의 사본
  groupIds: string[];
  savedAt: string;
};

const key = (userId: string) => `easyOutbox:${userId}`;
const folder = () => new Directory(Paths.document, 'outbox');

async function load(userId: string): Promise<OutboxEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(key(userId));
    return raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
  } catch {
    return [];
  }
}

async function save(userId: string, list: OutboxEntry[]): Promise<void> {
  await AsyncStorage.setItem(key(userId), JSON.stringify(list));
}

/** 보내지 못한 한 장을 폰에 보관한다 (임시 폴더의 파일은 지워질 수 있어 문서 폴더로 복사). */
export async function saveToOutbox(
  userId: string,
  entry: { postId: string; mediaId: string; kind: PostKind; item: PickedMedia; groupIds: string[] },
): Promise<void> {
  const dir = folder();
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const ext = entry.item.type === 'video' ? 'mp4' : 'jpg';
  const dest = new File(dir, `${entry.postId}.${ext}`);
  if (!dest.exists) new File(entry.item.uri).copy(dest);
  const list = await load(userId);
  if (!list.some((e) => e.postId === entry.postId)) {
    list.push({ ...entry, item: { ...entry.item, uri: dest.uri }, savedAt: new Date().toISOString() });
    await save(userId, list);
  }
}

let running = false;

/** 보관해 둔 것을 다시 보낸다. 보낸 수를 돌려준다. 동시에 두 번 돌지 않는다. */
export async function retryOutbox(userId: string): Promise<number> {
  if (running || !userId) return 0;
  running = true;
  let sent = 0;
  try {
    const list = await load(userId);
    if (list.length === 0) return 0;
    const left: OutboxEntry[] = [];
    for (const e of list) {
      const file = new File(e.item.uri);
      if (!file.exists) continue; // 파일이 없어졌으면 보낼 수 없다
      const job = newSendJob({ userId, items: [e.item], title: null, tags: [], groupIds: e.groupIds, kind: e.kind });
      job.postId = e.postId;
      job.mediaIds = [e.mediaId];
      try {
        await runSendJob(job, () => {});
        sent++;
        try {
          file.delete();
        } catch {
          // 지우지 못해도 다음에 목록에 없으니 다시 보내지 않는다
        }
      } catch (err) {
        if (__DEV__) console.warn('[outbox retry failed]', e.postId, err);
        left.push(e);
      }
    }
    await save(userId, left);
    return sent;
  } finally {
    running = false;
  }
}
