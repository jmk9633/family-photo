import { Redirect } from 'expo-router';

// 가운데 '보내기' 버튼 자리. 버튼은 탭을 바꾸지 않고 /send를 연다 ((tabs)/_layout.tsx).
// 주소로 직접 들어온 경우에만 여기를 지나므로 보내기 화면으로 넘긴다.
export default function ComposeTab() {
  return <Redirect href="/send" />;
}
