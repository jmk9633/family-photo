import { Redirect } from 'expo-router';

// 카카오·구글 로그인 후 돌아오는 주소(familyphoto://auth/callback).
// 실제 처리는 src/features/auth/oauth.ts에서 끝나므로, 앱이 이 주소로 열려도 첫 화면으로 보낸다.
export default function AuthCallback() {
  return <Redirect href="/" />;
}
