import { Stack } from 'expo-router';

import { colors } from '@/components/tokens';

// 로그인 전 화면 모음 (로그인 → 이메일 → 코드 입력)
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
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="email" />
      <Stack.Screen name="email-code" />
    </Stack>
  );
}
