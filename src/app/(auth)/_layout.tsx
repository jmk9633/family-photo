import { Stack } from 'expo-router';

import { colors } from '@/components/tokens';

// 로그인 전 화면 모음.
//   start(첫 화면: 숫자로 연결 / 내 계정으로 시작) → easy-code(쉬운 화면 숫자 입력)
//                                                → login → email → email-code
export const unstable_settings = { initialRouteName: 'start' };

export default function AuthLayout() {
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
      <Stack.Screen name="start" options={{ headerShown: false }} />
      <Stack.Screen name="easy-code" options={{ headerShown: false }} />
      <Stack.Screen name="login" />
      <Stack.Screen name="email" />
      <Stack.Screen name="email-code" />
    </Stack>
  );
}
