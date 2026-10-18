import { router } from 'expo-router';

import { CodeEntry } from '@/components/easy/CodeEntry';
import { useMode } from '@/features/auth/mode';

// 다른 가족과도 연결하기 (쉬운 화면 더보기, 10/18 결정). 지금 계정 그대로 다른 그룹에도 들어간다.
// 사진은 홈에서 모든 가족 것이 날짜순으로 합쳐져 보인다 (그룹을 골라 보지 않는다).
// 들어가면 홈으로 돌아가 'OO에 연결됐어요'를 먼저 보여준다.
export default function EasyConnect() {
  const { setWelcome } = useMode();
  return (
    <CodeEntry
      onBack={() => router.dismissTo('/home')}
      onConnected={(groupName) => {
        setWelcome(groupName);
        router.dismissTo('/home');
      }}
    />
  );
}
