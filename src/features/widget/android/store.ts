import AsyncStorage from '@react-native-async-storage/async-storage';

// 안드로이드 홈 화면 위젯이 쓰는 저장 칸 (8-3).
// 안드로이드 위젯은 앱 안에서 도는 JS(react-native-android-widget)가 그리므로, iOS의 공용 칸(App Group) 대신
// 이 앱만 읽을 수 있는 AsyncStorage에 위젯 열쇠와 마지막으로 받은 사진을 둔다.

export const STORE_KEYS = {
  key: 'widget:key', // 위젯 열쇠 원문 (서버에는 SHA-256만 있다)
  keyId: 'widget:keyId', // 서버의 열쇠 행 ID (아직 있는지 확인용)
  user: 'widget:user', // 열쇠 주인
  cache: 'widget:cache', // 마지막으로 받은 사진과 글 (인터넷이 안 될 때)
  pushToken: 'widget:pushToken', // 새 사진 신호를 받을 이 폰의 Expo 푸시 주소 (8-3-2, 알림 권한과 상관없이 받음)
} as const;

/** Edge Function `widget` 주소 (iOS 위젯과 같은 곳) */
export function widgetEndpoint(): string {
  return `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/widget`;
}

export async function readPushToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(STORE_KEYS.pushToken);
  } catch {
    return null;
  }
}

export async function readKey(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(STORE_KEYS.key);
  } catch {
    return null;
  }
}
