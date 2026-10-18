import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { touchActive } from '@/features/posts/api';
import { supabase } from '@/lib/supabase';

import { useSession } from './session';

// 앱을 어느 화면 모음으로 열지 (개발 6단계, 10/18 결정 3·4).
//   signedOut : 로그인 전 → (auth) 첫 화면
//   connecting: 숫자를 누르다 익명 계정은 생겼지만 아직 어느 그룹에도 못 들어감 → (auth)에 그대로 둔다
//               (틀려도 같은 익명 계정을 계속 써서 '10분에 5번' 제한이 걸리게)
//   easy      : 쉬운 화면 (profiles.easy_mode, 익명 사용자는 그룹에 들어가면 늘 쉬운 화면)
//   general   : 일반 모드
//
// 판단은 서버(profiles·members)로 하고, 인터넷이 안 되면 이 폰에 마지막으로 저장한 값으로 연다.
// 화면을 바꾸는 중에 숫자 입력 화면이 사라지지 않게, 새 판단이 나올 때까지 이전 값을 유지한다.

export type AppMode = 'loading' | 'signedOut' | 'connecting' | 'easy' | 'general';

type ModeState = {
  mode: AppMode;
  isAnonymous: boolean;
  /** 서버에 다시 물어 모드를 맞춘다 (그룹에 들어간 뒤, 화면 바꾸기 뒤) */
  refreshMode: () => Promise<void>;
  /** 숫자로 막 연결된 그룹 이름 → 쉬운 화면 홈이 '연결됐어요'를 먼저 보여준다 */
  welcome: string | null;
  setWelcome: (groupName: string | null) => void;
};

const ModeContext = createContext<ModeState>({
  mode: 'loading',
  isAnonymous: false,
  refreshMode: async () => {},
  welcome: null,
  setWelcome: () => {},
});

const storageKey = (userId: string) => `appMode:${userId}`;

async function resolveMode(userId: string, isAnonymous: boolean): Promise<AppMode> {
  if (isAnonymous) {
    const { count, error } = await supabase
      .from('members')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'active');
    if (error) throw error;
    return (count ?? 0) > 0 ? 'easy' : 'connecting';
  }
  const { data, error } = await supabase.from('profiles').select('easy_mode').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data?.easy_mode ? 'easy' : 'general';
}

// 앱을 열 때·다시 화면에 올 때 활동 시각을 남긴다 (안부 확인용). 10분에 한 번만.
const ACTIVE_THROTTLE_MS = 10 * 60 * 1000;

export function ModeProvider({ children }: { children: ReactNode }) {
  const { session, isLoading } = useSession();
  const userId = session?.user.id ?? null;
  const isAnonymous = !!session?.user.is_anonymous;
  const [state, setState] = useState<{ userId: string | null; mode: AppMode }>({ userId: null, mode: 'loading' });
  const [welcome, setWelcome] = useState<string | null>(null);
  const lastActive = useRef(0);

  // 화면에서 부를 때 오래된 세션을 쓰지 않도록 매번 지금 세션을 다시 읽는다
  // 여러 번 겹쳐 불러도 마지막에 부른 결과만 쓴다 (먼저 보낸 요청이 늦게 와서 덮어쓰지 않게)
  const seq = useRef(0);
  const refreshMode = useCallback(async () => {
    const my = ++seq.current;
    const apply = (next: { userId: string | null; mode: AppMode }) => {
      if (my === seq.current) setState(next);
    };
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) {
      apply({ userId: null, mode: 'signedOut' });
      return;
    }
    try {
      const mode = await resolveMode(user.id, !!user.is_anonymous);
      apply({ userId: user.id, mode });
      AsyncStorage.setItem(storageKey(user.id), mode).catch(() => {});
    } catch (e) {
      if (__DEV__) console.warn('[mode resolve failed]', e);
      const saved = (await AsyncStorage.getItem(storageKey(user.id)).catch(() => null)) as AppMode | null;
      apply({ userId: user.id, mode: saved ?? (user.is_anonymous ? 'connecting' : 'general') });
    }
  }, []);

  useEffect(() => {
    if (!isLoading) refreshMode();
  }, [isLoading, userId, refreshMode]);

  // 로그아웃은 바로 반영한다. 다른 사람으로 바뀌는 중이면 판단이 나올 때까지:
  // 로그인 전 화면에서 왔으면 그 화면을 유지하고(숫자 입력 중), 아니면 잠깐 비운다.
  let mode: AppMode;
  if (isLoading) mode = 'loading';
  else if (!userId) mode = 'signedOut';
  else if (state.userId === userId) mode = state.mode;
  else mode = state.mode === 'signedOut' || state.mode === 'connecting' ? state.mode : 'loading';

  const active = (mode === 'easy' || mode === 'general') && userId ? userId : null;
  useEffect(() => {
    if (!active) return;
    const touch = () => {
      const now = Date.now();
      if (now - lastActive.current < ACTIVE_THROTTLE_MS) return;
      lastActive.current = now;
      touchActive(active).catch(() => {});
    };
    touch();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') touch();
    });
    return () => sub.remove();
  }, [active]);

  return (
    <ModeContext.Provider value={{ mode, isAnonymous, refreshMode, welcome, setWelcome }}>
      {children}
    </ModeContext.Provider>
  );
}

export const useMode = () => useContext(ModeContext);
