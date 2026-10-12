import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { colors, size } from '@/components/tokens';
import { ko } from '@/copy/ko';
import { isValidEmail, sendEmailCode } from '@/features/auth/email';
import { toKoreanMessage } from '@/features/auth/errors';

export default function EmailScreen() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit() {
    if (!isValidEmail(email)) {
      setError(ko.email.invalid);
      return;
    }
    setError(null);
    setSending(true);
    try {
      await sendEmailCode(email);
      router.push({ pathname: '/email-code', params: { email: email.trim().toLowerCase() } });
    } catch (e) {
      setError(toKoreanMessage(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.body}>
          <Text style={styles.title} accessibilityRole="header">
            {ko.email.title}
          </Text>
          <Text style={styles.description}>{ko.email.description}</Text>
          <TextInput
            value={email}
            onChangeText={(t) => {
              setEmail(t);
              if (error) setError(null);
            }}
            placeholder={ko.email.placeholder}
            placeholderTextColor={colors.textSecondary}
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            returnKeyType="send"
            onSubmitEditing={submit}
            style={[styles.input, error && styles.inputError]}
            accessibilityLabel={ko.email.placeholder}
          />
          {error && (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          )}
        </View>
        <Button
          label={ko.email.submit}
          onPress={submit}
          loading={sending}
          disabled={email.trim().length === 0}
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
    minHeight: size.buttonHeight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: size.radius,
    paddingHorizontal: 16,
    fontSize: 18,
    color: colors.text,
  },
  inputError: { borderColor: colors.error },
  error: { fontSize: size.small, color: colors.error },
  submit: { marginBottom: 16 },
});
