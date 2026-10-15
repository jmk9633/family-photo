import type { ConfigContext, ExpoConfig } from 'expo/config';
import { withEntitlementsPlist, type ConfigPlugin } from 'expo/config-plugins';

// app.json을 그대로 읽고, 아래 한 가지만 빌드 환경에 따라 바꾼다.
//
// [임시 우회 · CLAUDE.md '임시 우회' 표] 무료 애플 계정(Personal Team)은 애플 로그인 기능을 서명하지 못한다.
// Xcode 원문 (10/15): "Personal development teams ... do not support the Sign In with Apple capability."
// 그래서 .env에 APPLE_SIGN_IN=off 가 있는 맥에서만 애플 로그인 기능(entitlement)을 빼고 빌드하고,
// 로그인 화면에서도 애플 버튼을 숨긴다. .env는 커밋하지 않으므로 EAS·출시 빌드는 항상 켜진 상태다.
// → 애플 개발자 유료 등록 후 .env에서 그 줄을 지우고, 이 파일과 extra.appleSignIn 확인 코드를 지운다.
//
// expo-apple-authentication은 설치돼 있기만 하면 Expo가 플러그인을 자동으로 적용해 기능을 넣는다
// (@expo/prebuild-config withVersionedExpoSDKPlugins). 그래서 plugins 목록에서 빼는 것으로는 안 되고,
// 만들어진 entitlements에서 그 항목을 지운다.
const withoutAppleSignIn: ConfigPlugin = (config) =>
  withEntitlementsPlist(config, (c) => {
    delete c.modResults['com.apple.developer.applesignin'];
    return c;
  });

export default ({ config }: ConfigContext): ExpoConfig => {
  const appleSignIn = process.env.APPLE_SIGN_IN !== 'off';
  const result: ExpoConfig = {
    ...config,
    name: config.name ?? '가족 사진',
    slug: config.slug ?? 'family-photo',
    ios: { ...config.ios, usesAppleSignIn: appleSignIn },
    extra: { ...config.extra, appleSignIn },
  };
  return appleSignIn ? result : withoutAppleSignIn(result);
};
