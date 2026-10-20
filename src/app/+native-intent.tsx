// 앱 밖에서 들어온 주소(딥링크)를 화면 이동 전에 고친다 (Expo Router native intent).
//
// 카카오·구글 로그인 뒤 돌아오는 주소(familyphoto://auth/callback?code=...)는
// src/features/auth/oauth.ts의 openAuthSessionAsync가 받아서 처리한다.
// 아이폰은 로그인 창이 이 주소를 직접 잡아서 앱 화면 이동이 일어나지 않지만,
// 안드로이드는 같은 주소가 화면 이동에도 전달된다. 그러면 로그인이 끝나기 전에
// auth/callback 화면으로 갔다가 로그인 전 화면이 사라지면서 빈 화면이 남는다 (10/20 안드로이드 카카오 로그인).
// 그래서 앱이 이미 켜져 있을 때 들어온 이 주소는 화면 이동을 하지 않는다(null).
// 앱이 꺼져 있다가 이 주소로 열리면 첫 화면으로 보낸다.
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  if (path.includes('auth/callback')) return initial ? '/' : null;
  return path;
}
