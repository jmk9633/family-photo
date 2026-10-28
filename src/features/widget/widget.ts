import { ExtensionStorage } from '@bacons/apple-targets';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

// 홈 화면 위젯 — iOS (개발 8-1, F-NGOJFO, 0014). 안드로이드는 widget.android.ts (8-3, 같은 함수 이름·같은 규칙).
//
// 위젯은 앱과 따로 도는 프로그램이라 앱의 로그인 정보를 쓰지 않는다. 앱이 서버에서 '위젯 열쇠'를 받아
// 앱과 위젯만 보는 공용 칸(App Group)에 넣어 두면, 위젯이 그 열쇠로 Edge Function `widget`에 최근 사진을 물어본다.
//   - 열쇠는 이 폰의 이 사람 것 하나. 다른 사람으로 로그인하면 새로 만들고, 로그아웃하면 서버와 폰에서 지운다.
//   - 앱을 열 때·다시 화면에 올 때 열쇠가 서버에 아직 있는지 확인하고 위젯을 다시 그리게 한다.
//   - 사진을 보면('봤어요'가 새로 기록되면) 위젯을 다시 그려 다음 새 묶음으로 넘어가게 한다.
//   - 위젯이 사진을 보여주는 것은 '봤어요'도 활동도 아니다 (서버가 기록하지 않는다).

const APP_GROUP = 'group.com.jmk9633.familyphoto'; // app.json ios.entitlements와 같아야 한다
const K = {
  key: 'widgetKey', // 열쇠 원문 (위젯이 서버에 보낸다)
  keyId: 'widgetKeyId', // 서버의 열쇠 행 ID (아직 있는지 확인용)
  user: 'widgetUser', // 열쇠 주인
  endpoint: 'widgetEndpoint', // Edge Function 주소
} as const;

const enabled = Platform.OS === 'ios';
const storage = enabled ? new ExtensionStorage(APP_GROUP) : null;

function endpoint(): string {
  return `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/widget`;
}

async function keyExists(id: string): Promise<boolean> {
  const { data, error } = await supabase.from('widget_keys').select('id').eq('id', id).maybeSingle();
  if (error) throw error;
  return !!data;
}

let syncing: Promise<void> | null = null;

/** 위젯 열쇠를 맞추고(없거나 다른 사람 것이거나 서버에서 지워졌으면 새로) 위젯을 다시 그리게 한다. */
export function syncWidget(userId: string): Promise<void> {
  if (!storage) return Promise.resolve();
  // 앱을 열자마자 여러 곳에서 불러도 열쇠는 하나만 만든다
  syncing ??= (async () => {
    try {
      const id = storage.get(K.keyId);
      const fresh = storage.get(K.user) === userId && !!storage.get(K.key) && !!id && (await keyExists(id));
      if (!fresh) {
        const { data, error } = await supabase.rpc('create_widget_key');
        if (error) throw error;
        const made = data as { id: string; key: string };
        storage.set(K.key, made.key);
        storage.set(K.keyId, made.id);
        storage.set(K.user, userId);
      }
      storage.set(K.endpoint, endpoint());
      ExtensionStorage.reloadWidget();
    } catch (e) {
      // 인터넷이 안 되면 다음에 앱을 열 때 다시 한다. 위젯은 저장해 둔 사진을 그대로 보여준다
      if (__DEV__) console.warn('[widget sync failed]', e);
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

/** 위젯을 지금 다시 그리게 한다 ('봤어요' 기록 뒤 등). 앱이 화면에 있을 때 부르면 하루 횟수 제한에 들지 않는다. */
export function refreshWidget(): void {
  if (!storage) return;
  ExtensionStorage.reloadWidget();
}

/**
 * 로그아웃할 때: 서버의 열쇠를 지우고(revoke=true, 로그인 정보가 남아 있을 때만 가능) 폰의 열쇠를 지운다.
 * 위젯은 '가족과 연결해 주세요'로 바뀌고 저장해 둔 사진도 지운다.
 */
export async function clearWidget({ revoke }: { revoke: boolean }): Promise<void> {
  if (!storage) return;
  const key = storage.get(K.key);
  if (revoke && key) {
    const { error } = await supabase.rpc('revoke_widget_key', { p_key: key });
    if (error && __DEV__) console.warn('[widget revoke failed]', error);
  }
  storage.remove(K.key);
  storage.remove(K.keyId);
  storage.remove(K.user);
  ExtensionStorage.reloadWidget();
}
