import { Stack } from 'expo-router';

import { colors } from '@/components/tokens';

// 일반 모드 화면 모음 (2단계: 홈, 그룹 만들기, 초대, 코드로 들어가기, 그룹)
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
      <Stack.Screen name="index" options={{ headerShown: false }} />
    </Stack>
  );
}
