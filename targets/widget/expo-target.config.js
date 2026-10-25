// 홈 화면 위젯 (개발 8-1, F-NGOJFO). @bacons/apple-targets가 prebuild 때 이 폴더를 Xcode의 위젯 확장으로 만든다.
// 이 폴더를 바꾸면 `npx expo prebuild --platform ios --clean` 뒤 다시 빌드해야 한다.
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'widget',
  name: 'FamilyPhotoWidget',
  displayName: '가족 사진',
  // 앱 번들 ID 뒤에 붙는다 → com.jmk9633.familyphoto.widget
  bundleIdentifier: '.widget',
  // 앱과 같은 최소 OS (Expo SDK 57 기본값). 오래된 아이폰을 쓰는 부모님도 쓸 수 있게
  deploymentTarget: '16.4',
  frameworks: ['SwiftUI', 'WidgetKit'],
  colors: {
    $accent: '#C2410C', // 쉬운 화면 강조색 (src/components/easy/tokens.ts)
    $widgetBackground: '#FFFFFF',
  },
  // 앱과 위젯이 함께 쓰는 공용 칸 (위젯 열쇠·서버 주소)
  entitlements: {
    'com.apple.security.application-groups': config.ios.entitlements['com.apple.security.application-groups'],
    // 8-2: iOS 26 '다시 그려' 신호(WidgetKit 푸시)를 받으려면 위젯에도 푸시 권한이 있어야 한다.
    // 출시용으로 내보낼 때 Xcode가 production으로 바꾼다 (앱의 expo-notifications 설정과 같은 방식)
    'aps-environment': 'development',
  },
});
