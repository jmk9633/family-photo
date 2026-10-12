import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '.env 파일에 EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY가 없어요. README의 "처음 실행하기"를 확인해 주세요.',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // 로그인 정보를 폰에 저장해 앱을 다시 열어도 로그인이 유지되게 한다.
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // 카카오·구글 브라우저 로그인은 돌아온 주소의 code를 세션으로 바꾸는 PKCE 방식을 쓴다.
    flowType: 'pkce',
  },
});

// 앱이 화면에 있을 때만 로그인 토큰을 자동으로 갱신한다 (Supabase 권장 방식).
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
