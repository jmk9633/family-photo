import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { ModeProvider, useMode } from '@/features/auth/mode';
import { SessionProvider } from '@/features/auth/session';

SplashScreen.preventAutoHideAsync();

// 첫 화면 고르기 (6단계): 로그인 전·숫자로 연결 중 → (auth), 쉬운 화면 → (easy), 그 밖 → (general)
function RootNavigator() {
  const { mode } = useMode();

  // 로그인 정보와 화면 모드를 다 읽은 뒤에 첫 화면을 보여준다 (다른 화면이 잠깐 깜빡이지 않게).
  useEffect(() => {
    if (mode !== 'loading') SplashScreen.hideAsync();
  }, [mode]);

  if (mode === 'loading') return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={mode === 'general'}>
        <Stack.Screen name="(general)" />
      </Stack.Protected>
      <Stack.Protected guard={mode === 'easy'}>
        <Stack.Screen name="(easy)" />
      </Stack.Protected>
      <Stack.Protected guard={mode === 'signedOut' || mode === 'connecting'}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <ModeProvider>
        <StatusBar style="dark" />
        <RootNavigator />
      </ModeProvider>
    </SessionProvider>
  );
}
