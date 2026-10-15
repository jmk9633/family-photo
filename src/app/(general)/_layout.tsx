import { Stack } from 'expo-router';

import { colors } from '@/components/tokens';

// 일반 모드 화면 모음: 하단 탭(사진·앨범·보내기·가족·내 정보) 위에 나머지 화면이 쌓인다.
export const unstable_settings = { initialRouteName: '(tabs)' };

export default function GeneralLayout() {
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
    </Stack>
  );
}
