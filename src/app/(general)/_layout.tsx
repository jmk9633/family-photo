import { Stack } from 'expo-router';

// 일반 모드 화면 모음. 지금은 1단계 확인용 임시 홈 하나뿐이다.
export default function GeneralLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
