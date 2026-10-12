import * as AppleAuthentication from 'expo-apple-authentication';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { colors, size } from '@/components/tokens';
import { ko } from '@/copy/ko';
import { isAppleSignInAvailable, signInWithApple } from '@/features/auth/apple';
import { LoginCancelled, toKoreanMessage } from '@/features/auth/errors';
import { signInWithGoogle, signInWithKakao } from '@/features/auth/oauth';

type Pending = 'kakao' | 'google' | 'apple' | null;

export default function LoginScreen() {
  const [pending, setPending] = useState<Pending>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    isAppleSignInAvailable().then(setAppleAvailable).catch(() => setAppleAvailable(false));
  }, []);

  // 로그인에 성공하면 세션이 바뀌어 _layout이 홈으로 보낸다. 여기서는 오류만 다룬다.
  async function run(which: Exclude<Pending, null>, fn: () => Promise<void>) {
    if (pending) return;
    setPending(which);
    try {
      await fn();
    } catch (e) {
      if (!(e instanceof LoginCancelled)) Alert.alert(toKoreanMessage(e));
    } finally {
      setPending(null);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.title} accessibilityRole="header">
          {ko.login.title}
        </Text>
        <Text style={styles.subtitle}>{ko.login.subtitle}</Text>
      </View>

      <View style={styles.buttons}>
        <Button
          variant="kakao"
          label={ko.login.kakao}
          loading={pending === 'kakao'}
          disabled={!!pending}
          onPress={() => run('kakao', signInWithKakao)}
          style={styles.kakao}
        />
        <Button
          variant="outline"
          label={ko.login.google}
          loading={pending === 'google'}
          disabled={!!pending}
          onPress={() => run('google', signInWithGoogle)}
        />
        {appleAvailable && (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={size.radius}
            style={styles.apple}
            onPress={() => run('apple', signInWithApple)}
          />
        )}
        <Button
          variant="outline"
          label={ko.login.email}
          disabled={!!pending}
          onPress={() => router.push('/email')}
        />
        <Text style={styles.hint}>{ko.login.hint}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: size.gutter },
  hero: { flex: 1, justifyContent: 'center', gap: 12 },
  title: { fontSize: 34, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 20, lineHeight: 28, color: colors.textSecondary },
  buttons: { gap: 12, paddingBottom: 24 },
  // 카카오를 가장 크게 (CLAUDE.md 화면 규칙)
  kakao: { minHeight: 64 },
  apple: { height: size.buttonHeight, width: '100%' },
  hint: {
    marginTop: 8,
    fontSize: size.small,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
