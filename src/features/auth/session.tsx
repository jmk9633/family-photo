import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { clearSignedUrls } from '@/lib/signedUrl';
import { supabase } from '@/lib/supabase';

type SessionState = {
  session: Session | null;
  /** 저장된 로그인 정보를 아직 읽는 중이면 true */
  isLoading: boolean;
};

const SessionContext = createContext<SessionState>({ session: null, isLoading: true });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ session: null, isLoading: true });

  useEffect(() => {
    // 앱을 열 때 폰에 저장된 로그인 정보를 불러온다.
    supabase.auth.getSession().then(({ data }) => {
      setState({ session: data.session, isLoading: false });
    });

    // 로그인·로그아웃·토큰 갱신 때마다 상태를 맞춘다.
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // 로그아웃하면 이전 계정으로 받은 사진 주소를 버린다
      if (event === 'SIGNED_OUT') clearSignedUrls();
      setState({ session, isLoading: false });
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);

export async function signOut() {
  await supabase.auth.signOut();
}
