import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

import { supabase } from '@/lib/supabase';

import { clearCache, forgetSnapshot } from './android/feed';
import { STORE_KEYS } from './android/store';
import { redrawAll } from './android/task';

// 홈 화면 위젯 — 안드로이드 (개발 8-3, F-NGOJFO, 0014). iOS는 widget.ts (같은 함수 이름·같은 규칙).
//
// 위젯은 앱의 로그인 정보를 쓰지 않는다. 앱이 서버에서 '위젯 열쇠'를 받아 이 앱만 읽는 저장 칸(AsyncStorage)에 두면,
// 위젯이 그 열쇠로 Edge Function `widget`에 최근 사진을 물어본다 (iOS와 같은 서버·같은 열쇠 규칙).
//   - 열쇠는 이 폰의 이 사람 것 하나. 다른 사람으로 로그인하면 새로 만들고, 로그아웃하면 서버와 폰에서 지운다.
//   - 앱을 열 때·다시 화면에 올 때·나갈 때·'봤어요'가 새로 기록될 때 위젯을 다시 그린다.
//   - 위젯이 사진을 보여주는 것은 '봤어요'도 활동도 아니다 (서버가 기록하지 않는다).
//   - 8-3-2: 새 사진 신호를 받을 이 폰의 Expo 푸시 주소를 알림 권한과 상관없이 받아 둔다(안드로이드는 권한 없이도 주소가 나온다).
//     알림 주소 표(devices)에는 넣지 않는다 — 그러면 알림을 끈 폰에도 사진 알림이 가게 된다. 위젯이 서버에 물을 때 함께 보낸다.
// 위젯이 홈 화면에 없으면 다시 그리기는 아무것도 하지 않는다 (서버에도 묻지 않음).

async function get(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

async function keyExists(id: string): Promise<boolean> {
  const { data, error } = await supabase.from('widget_keys').select('id').eq('id', id).maybeSingle();
  if (error) throw error;
  return !!data;
}

function redraw(): void {
  redrawAll().catch((e) => {
    if (__DEV__) console.warn('[widget redraw failed]', e);
  });
}

/** 새 사진 신호를 받을 이 폰의 Expo 푸시 주소를 받아 둔다 (알림 권한 필요 없음). 실패하면 30분 확인만 한다 */
async function savePushToken(): Promise<void> {
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    if (token && token !== (await get(STORE_KEYS.pushToken))) await AsyncStorage.setItem(STORE_KEYS.pushToken, token);
  } catch (e) {
    if (__DEV__) console.warn('[widget push token failed]', e);
  }
}

let syncing: Promise<void> | null = null;

/** 위젯 열쇠를 맞추고(없거나 다른 사람 것이거나 서버에서 지워졌으면 새로) 위젯을 다시 그린다. */
export function syncWidget(userId: string): Promise<void> {
  // 앱을 열자마자 여러 곳에서 불러도 열쇠는 하나만 만든다
  syncing ??= (async () => {
    try {
      const [key, id, user] = await Promise.all([get(STORE_KEYS.key), get(STORE_KEYS.keyId), get(STORE_KEYS.user)]);
      const fresh = user === userId && !!key && !!id && (await keyExists(id));
      if (!fresh) {
        const { data, error } = await supabase.rpc('create_widget_key');
        if (error) throw error;
        const made = data as { id: string; key: string };
        await AsyncStorage.multiSet([
          [STORE_KEYS.key, made.key],
          [STORE_KEYS.keyId, made.id],
          [STORE_KEYS.user, userId],
        ]);
        await clearCache(); // 이전 열쇠로 받아 둔 사진은 버린다
      }
      await savePushToken();
      redraw();
    } catch (e) {
      // 인터넷이 안 되면 다음에 앱을 열 때 다시 한다. 위젯은 저장해 둔 사진을 그대로 보여준다
      if (__DEV__) console.warn('[widget sync failed]', e);
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

/** 위젯을 지금 다시 그린다 ('봤어요' 기록 뒤, 앱을 나갈 때). */
export function refreshWidget(): void {
  redraw();
}

/**
 * 로그아웃할 때: 서버의 열쇠를 지우고(revoke=true, 로그인 정보가 남아 있을 때만 가능) 폰의 열쇠를 지운다.
 * 위젯은 '가족과 연결해 주세요'로 바뀌고 저장해 둔 사진도 지운다.
 */
export async function clearWidget({ revoke }: { revoke: boolean }): Promise<void> {
  const key = await get(STORE_KEYS.key);
  if (revoke && key) {
    const { error } = await supabase.rpc('revoke_widget_key', { p_key: key });
    if (error && __DEV__) console.warn('[widget revoke failed]', error);
  }
  try {
    await AsyncStorage.multiRemove([STORE_KEYS.key, STORE_KEYS.keyId, STORE_KEYS.user]);
  } catch {
    // 무시
  }
  await clearCache();
  forgetSnapshot();
  redraw();
}
