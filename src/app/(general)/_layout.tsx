import { useLastNotificationResponse } from 'expo-notifications';
import { Stack } from 'expo-router';
import { useEffect, useRef } from 'react';

import { colors } from '@/components/tokens';
import { useSession } from '@/features/auth/session';
import { openFromNotification, registerPush } from '@/features/push/push';

// 일반 모드 화면 모음: 하단 탭(사진·앨범·보내기·가족·내 정보) 위에 나머지 화면이 쌓인다.
export const unstable_settings = { initialRouteName: '(tabs)' };

export default function GeneralLayout() {
  const { session } = useSession();
  const userId = session?.user.id;

  // 알림 권한이 있으면 앱을 열 때마다 이 폰의 푸시 토큰을 저장·갱신한다
  useEffect(() => {
    if (userId) registerPush(userId);
  }, [userId]);

  // 알림을 눌러 앱이 열리면(꺼져 있다가 열린 경우 포함) 그 묶음을 연다. 같은 알림은 한 번만.
  const response = useLastNotificationResponse();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    const id = response?.notification.request.identifier;
    if (!response || !id || handled.current === id) return;
    handled.current = id;
    openFromNotification(response);
  }, [response]);

  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerTitle: '',
        headerBackButtonDisplayMode: 'minimal',
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      {/* 사진 크게 보기: 어두운 전체 화면 */}
      <Stack.Screen
        name="post/[id]"
        options={{
          headerShown: false,
          presentation: 'fullScreenModal',
          animation: 'fade',
          contentStyle: { backgroundColor: '#000000' },
        }}
      />
      {/* 알림 권한 안내: 아래에서 올라오는 화면 */}
      <Stack.Screen name="notify" options={{ headerShown: false, presentation: 'modal' }} />
    </Stack>
  );
}
