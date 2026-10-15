import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { colors, size } from './tokens';

type Props = Omit<TextInputProps, 'style'> & {
  label: string;
  hint?: string;
  error?: string | null;
};

/** 이름표 + 입력칸 + 안내/오류 문구 */
export function TextField({ label, hint, error, ...input }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textSecondary}
        accessibilityLabel={label}
        accessibilityHint={hint}
        {...input}
        style={[styles.input, error ? styles.inputError : null]}
      />
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  label: { fontSize: size.small, fontWeight: '600', color: colors.text },
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
  hint: { fontSize: size.small, lineHeight: 21, color: colors.textSecondary },
  error: { fontSize: size.small, lineHeight: 21, color: colors.error },
});
