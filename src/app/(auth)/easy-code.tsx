import { router } from 'expo-router';

import { CodeEntry } from '@/components/easy/CodeEntry';
import { useMode } from '@/features/auth/mode';

// 처음 연결: 숫자 6자리 (F-LGRCFY). 들어가면 mode가 'easy'로 바뀌어 쉬운 화면 홈이 '연결됐어요'를 먼저 보여준다.
// 계정이 있는 사람이 여기로 와도 같은 방법으로 합류한다 (초대 태그대로).
export default function EasyCodeScreen() {
  const { refreshMode, setWelcome } = useMode();
  return (
    <CodeEntry
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/start'))}
      onConnected={async (groupName) => {
        setWelcome(groupName);
        await refreshMode(); // → 쉬운 화면(또는 계정 사용자면 그 사람의 화면)으로 바뀐다
      }}
    />
  );
}
