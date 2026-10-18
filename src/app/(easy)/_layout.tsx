import { useLastNotificationResponse } from 'expo-notifications';
import { Stack } from 'expo-router';
import { useEffect, useRef } from 'react';

import { easyColors } from '@/components/easy/tokens';
import { useSession } from '@/features/auth/session';
import { openFromNotification, registerPush } from '@/features/push/push';

// 쉬운 화면 모음 (개발 6단계). 탭 바 없음, 화면 깊이 2단계 이하, 모든 화면에 '처음으로' (CLAUDE.md).
//   home(쉬운 화면 홈) → play/[id](한 장씩 보기·다 봤어요) / past(지난 사진) / more(더보기) / connect(다른 가족과도 연결하기) / camera(사진 찍어 보내기·영상 한마디)
export const unstable_settings = { initialRouteName: 'home' };

export default function EasyLayout() {
  const { session } = useSession();
  const userId = session?.user.id;

  // 알림 권한이 있으면 앱을 열 때마다 이 폰의 푸시 토큰을 저장·갱신한다
  useEffect(() => {
    if (userId) registerPush(userId);
  }, [userId]);

  // 알림을 눌러 앱이 열리면 그 묶음을 한 장씩 보기로 연다. 같은 알림은 한 번만.
  const response = useLastNotificationResponse();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    const id = response?.notification.request.identifier;
    if (!response || !id || handled.current === id) return;
    handled.current = id;
    openFromNotification(response, 'easy');
  }, [response]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: easyColors.background } }}>
      <Stack.Screen name="home" />
      <Stack.Screen
        name="play/[id]"
        options={{ animation: 'fade', contentStyle: { backgroundColor: easyColors.dark } }}
      />
      <Stack.Screen name="past" />
      <Stack.Screen name="more" />
      <Stack.Screen name="connect" />
      <Stack.Screen
        name="camera"
        options={{ animation: 'slide_from_bottom', contentStyle: { backgroundColor: easyColors.dark } }}
      />
    </Stack>
  );
}
