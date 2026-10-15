import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { useSession } from '@/features/auth/session';

import { listMyGroups, type Group } from './api';

/** 내 그룹 목록 (먼저 들어간 순). 화면에 돌아올 때마다 새로 읽는다 (그룹을 만들거나 들어간 뒤). */
export function useMyGroups() {
  const { session } = useSession();
  const userId = session?.user.id ?? '';
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(() => {
    setFailed(false);
    listMyGroups(userId)
      .then(setGroups)
      .catch(() => setFailed(true));
  }, [userId]);

  useFocusEffect(reload);

  return { groups, failed, reload };
}
