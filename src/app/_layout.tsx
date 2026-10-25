import * as Linking from 'expo-linking';
import { router, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { ModeProvider, useMode, type AppMode } from '@/features/auth/mode';
import { SessionProvider } from '@/features/auth/session';
import { isWidgetUrl } from '@/features/widget/url';

SplashScreen.preventAutoHideAsync();

// 앱이 켜져 있을 때 홈 화면 위젯을 누르면 모드에 맞는 앱 홈으로 (8-1, F-NGOJFO '누르면 앱 홈으로 이동').
// 앱이 꺼져 있다가 위젯으로 열리면 +native-intent.tsx가 첫 화면('/')으로 보내므로 여기서는 켜져 있을 때만.
function useWidgetOpen(mode: AppMode) {
  useEffect(() => {
    if (mode !== 'easy' && mode !== 'general') return;
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (!isWidgetUrl(url)) return;
      if (mode === 'easy') router.dismissTo('/home');
      else router.dismissTo('/');
    });
    return () => sub.remove();
  }, [mode]);
}

// 첫 화면 고르기 (6단계): 로그인 전·숫자로 연결 중 → (auth), 쉬운 화면 → (easy), 그 밖 → (general)
function RootNavigator() {
  const { mode } = useMode();
  useWidgetOpen(mode);

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
