import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { colors, size } from '@/components/tokens';
import { ko } from '@/copy/ko';
import { sendEmailCode, verifyEmailCode } from '@/features/auth/email';
import { toKoreanMessage } from '@/features/auth/errors';

const CODE_LENGTH = 6;
const RESEND_WAIT_SEC = 60;

export default function EmailCodeScreen() {
  const { email = '' } = useLocalSearchParams<{ email: string }>();
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [waitSec, setWaitSec] = useState(RESEND_WAIT_SEC);
  const inputRef = useRef<TextInput>(null);

  // '코드 다시 받기'는 60초 뒤에만 누를 수 있다.
  useEffect(() => {
    if (waitSec <= 0) return;
    const t = setTimeout(() => setWaitSec((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [waitSec]);

  async function verify(value: string) {
    setVerifying(true);
    setMessage(null);
    try {
      // 성공하면 세션이 바뀌어 _layout이 홈으로 보낸다.
      await verifyEmailCode(email, value);
    } catch (e) {
      setMessage({ text: toKoreanMessage(e), isError: true });
      setCode('');
      inputRef.current?.focus();
    } finally {
      setVerifying(false);
    }
  }

  function onChange(text: string) {
    const digits = text.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    if (message?.isError) setMessage(null);
    // 6자리가 다 들어오면 자동으로 확인한다.
    if (digits.length === CODE_LENGTH && !verifying) verify(digits);
  }

  async function resend() {
    setMessage(null);
    try {
      await sendEmailCode(email);
      setWaitSec(RESEND_WAIT_SEC);
      setCode('');
      setMessage({ text: ko.emailCode.resent, isError: false });
    } catch (e) {
      setMessage({ text: toKoreanMessage(e), isError: true });
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.body}>
        <Text style={styles.title} accessibilityRole="header">
          {ko.emailCode.title}
        </Text>
        <Text style={styles.description}>{ko.emailCode.sentTo(email)}</Text>

        {/* 숨은 입력칸 하나 + 보이는 6칸. 칸을 누르면 숫자 키패드가 열린다. */}
        <Pressable
          onPress={() => inputRef.current?.focus()}
          accessible={false}
          style={styles.boxes}
        >
          {Array.from({ length: CODE_LENGTH }).map((_, i) => {
            const isActive = i === code.length && !verifying;
            return (
              <View key={i} style={[styles.box, isActive && styles.boxActive]}>
                <Text style={styles.digit}>{code[i] ?? ''}</Text>
              </View>
            );
          })}
        </Pressable>
        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={onChange}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={CODE_LENGTH}
          autoFocus
          editable={!verifying}
          style={styles.hiddenInput}
          accessibilityLabel={ko.emailCode.title}
        />

        {verifying && <Text style={styles.info}>{ko.emailCode.verifying}</Text>}
        {message && (
          <Text
            style={message.isError ? styles.error : styles.info}
            accessibilityLiveRegion="polite"
          >
            {message.text}
          </Text>
        )}
      </View>

      <View style={styles.footer}>
        <Button
          variant="outline"
          label={waitSec > 0 ? ko.emailCode.resendIn(waitSec) : ko.emailCode.resend}
          disabled={waitSec > 0 || verifying}
          onPress={resend}
        />
        <Button variant="text" label={ko.emailCode.changeEmail} onPress={() => router.back()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: size.gutter },
  body: { flex: 1, gap: 16, paddingTop: 8 },
  title: { fontSize: size.title, fontWeight: '700', color: colors.text },
  description: { fontSize: size.body, lineHeight: 25, color: colors.textSecondary },
  boxes: { flexDirection: 'row', gap: 8, marginTop: 8 },
  box: {
    flex: 1,
    aspectRatio: 0.85,
    maxHeight: 64,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: size.radius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxActive: { borderColor: colors.accent, borderWidth: 2 },
  digit: { fontSize: 26, fontWeight: '600', color: colors.text },
  hiddenInput: { position: 'absolute', opacity: 0, width: 1, height: 1 },
  info: { fontSize: size.small, color: colors.textSecondary },
  error: { fontSize: size.small, color: colors.error },
  footer: { gap: 4, paddingBottom: 16 },
});
