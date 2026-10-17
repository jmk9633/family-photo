import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

// 푸시 알림 (개발 5단계 후반). 실제 보내기는 서버(Edge Function, B2)가 한다. 앱은
// 1) 알림 권한을 묻고  2) Expo 푸시 토큰을 devices 표에 저장하고  3) 알림을 누르면 그 묶음을 연다.
//
// 권한은 첫 그룹을 만들거나 들어간 직후 안내 화면(/notify)에서 묻는다 (10/16 결정).
// 아이폰은 '허용 안 함'을 한 번 누르면 앱에서 다시 물을 수 없어서, 이유를 먼저 보여주고 묻는다.
// 그 뒤로는 내 정보 탭에서 켜거나 (거절했다면) 아이폰 설정으로 안내한다.

export type PushStatus = 'granted' | 'undetermined' | 'denied';

// 앱이 켜져 있을 때 온 알림도 위에 띄운다 (handler가 없으면 앱이 켜져 있을 때는 안 보인다).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function getPushStatus(): Promise<PushStatus> {
  const p = await Notifications.getPermissionsAsync();
  if (p.granted) return 'granted';
  return p.canAskAgain ? 'undetermined' : 'denied';
}

/** 시스템 권한 창을 띄운다. 허용하면 토큰까지 저장한다. */
export async function requestPush(userId: string): Promise<PushStatus> {
  await ensureAndroidChannel();
  const p = await Notifications.requestPermissionsAsync();
  if (p.granted) await registerPush(userId);
  return p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';
}

/** 권한을 아직 안 물었으면 안내 화면을 띄운다 (그룹을 만들거나 들어간 직후). */
export async function promptPushIfNeeded(): Promise<void> {
  try {
    if ((await getPushStatus()) === 'undetermined') router.push('/notify');
  } catch (e) {
    if (__DEV__) console.warn('[push status failed]', e);
  }
}

// 안드로이드 13 이상은 채널을 먼저 만들어야 권한 창이 뜬다 (Expo 문서)
async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: '가족 사진',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

let currentToken: string | null = null;

/**
 * 권한이 있으면 이 폰의 푸시 토큰을 저장한다 (앱을 열 때마다 불러 last_seen_at을 갱신).
 * 실패해도 앱 사용에는 지장이 없으므로 오류를 던지지 않는다.
 */
export async function registerPush(userId: string): Promise<void> {
  try {
    if ((await getPushStatus()) !== 'granted') return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) {
      if (__DEV__) console.warn('[push] app.json에 extra.eas.projectId가 없어요 (eas init 필요)');
      return;
    }
    await ensureAndroidChannel();
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    currentToken = token;
    // 개발 중 확인용: expo.dev/notifications 테스트 도구에 붙여넣을 토큰
    if (__DEV__) console.log('[push token]', token);

    const now = new Date().toISOString();
    const { data: rows, error } = await supabase
      .from('devices')
      .select('id')
      .eq('user_id', userId)
      .eq('push_token', token)
      .limit(1);
    if (error) throw error;
    if (rows && rows.length > 0) {
      const { error: e2 } = await supabase
        .from('devices')
        .update({ status: 'active', last_seen_at: now })
        .eq('id', rows[0].id);
      if (e2) throw e2;
    } else {
      const { error: e3 } = await supabase.from('devices').insert({
        user_id: userId,
        kind: 'phone',
        platform: Platform.OS === 'android' ? 'android' : 'ios',
        push_token: token,
        last_seen_at: now,
      });
      if (e3) throw e3;
    }
  } catch (e) {
    if (__DEV__) console.warn('[push register failed]', e);
  }
}

/** 로그아웃 전에: 이 폰으로 이 계정의 알림이 더 오지 않게 한다. */
export async function unregisterPush(userId: string): Promise<void> {
  if (!currentToken) return;
  try {
    await supabase
      .from('devices')
      .update({ status: 'revoked', push_token: null })
      .eq('user_id', userId)
      .eq('push_token', currentToken);
  } catch (e) {
    if (__DEV__) console.warn('[push unregister failed]', e);
  }
  currentToken = null;
}

/** 알림을 누르면: 서버가 넣어 둔 postId가 있으면 그 묶음을 크게 연다. */
export function openFromNotification(response: Notifications.NotificationResponse | null | undefined) {
  const postId = response?.notification.request.content.data?.postId;
  if (typeof postId === 'string' && postId) {
    router.push({ pathname: '/post/[id]', params: { id: postId } });
  }
}
