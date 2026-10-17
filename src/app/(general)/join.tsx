import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { colors, size } from '@/components/tokens';
import { ko } from '@/copy/ko';
import { redeemInvite } from '@/features/groups/api';
import { toGroupErrorMessage } from '@/features/groups/format';
import { promptPushIfNeeded } from '@/features/push/push';

const CODE_LENGTH = 6;

// 초대 코드로 그룹에 들어가기. 이름·할 일은 초대할 때 정한 대로 적용된다 (이름은 나중에 바꿀 수 있다).
// 이미 그 그룹 구성원이면 서버가 초대를 쓰지 않고 바로 ok를 돌려준다.
export default function JoinScreen() {
  const [code, setCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  async function submit(value: string) {
    if (value.length !== CODE_LENGTH || checking) return;
    setChecking(true);
    setError(null);
    try {
      const result = await redeemInvite(value);
      if (result.status === 'ok' && result.groupId) {
        router.replace({ pathname: '/group/[id]', params: { id: result.groupId } });
        promptPushIfNeeded(); // 첫 그룹이면 알림 안내를 그 위에 띄운다
        return;
      }
      setError(result.status === 'ok' ? ko.groupErrors.unknown : ko.join.status[result.status]);
      setCode('');
      inputRef.current?.focus();
    } catch (e) {
      setError(toGroupErrorMessage(e));
    } finally {
      setChecking(false);
    }
  }

  function onChange(text: string) {
    const digits = text.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    if (error) setError(null);
    // 6자리가 다 들어오면 자동으로 확인한다.
    if (digits.length === CODE_LENGTH) submit(digits);
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.body}>
          <Text style={styles.title} accessibilityRole="header">
            {ko.join.title}
          </Text>
          <Text style={styles.description}>{ko.join.description}</Text>
          <TextInput
            ref={inputRef}
            value={code}
            onChangeText={onChange}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            maxLength={CODE_LENGTH}
            autoFocus
            editable={!checking}
            accessibilityLabel={ko.join.title}
            style={[styles.input, error ? styles.inputError : null]}
          />
          {checking ? <Text style={styles.description}>{ko.join.checking}</Text> : null}
          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
        </View>
        <Button
          label={ko.common.done}
          onPress={() => submit(code)}
          loading={checking}
          disabled={code.length !== CODE_LENGTH}
          style={styles.submit}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: size.gutter },
  body: { flex: 1, gap: 16, paddingTop: 8 },
  title: { fontSize: size.title, fontWeight: '700', color: colors.text },
  description: { fontSize: size.body, lineHeight: 25, color: colors.textSecondary },
  input: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: size.radius,
    paddingHorizontal: 16,
    fontSize: 36,
    fontWeight: '700',
    letterSpacing: 12,
    textAlign: 'center',
    color: colors.text,
  },
  inputError: { borderColor: colors.error },
  error: { fontSize: size.small, lineHeight: 21, color: colors.error },
  submit: { marginBottom: 16 },
});
