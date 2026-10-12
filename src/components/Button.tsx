import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { colors, size } from './tokens';

type Variant = 'primary' | 'outline' | 'kakao' | 'text';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
};

export function Button({ label, onPress, variant = 'primary', loading, disabled, style }: Props) {
  const v = variants[variant];
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        v.container,
        isDisabled && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.text.color} />
      ) : (
        <Text style={[styles.label, v.text]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: size.buttonHeight,
    borderRadius: size.radius,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  label: { fontSize: size.body, fontWeight: '600' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
});

const variants = {
  primary: StyleSheet.create({
    container: { backgroundColor: colors.accent },
    text: { color: '#FFFFFF' },
  }),
  outline: StyleSheet.create({
    container: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
    text: { color: colors.text },
  }),
  // 카카오 로그인 디자인 가이드: 노란 배경(#FEE500), 85% 검정 글자. 말풍선 심볼은 공식 파일을 받아 추가 예정.
  kakao: StyleSheet.create({
    container: { backgroundColor: colors.kakao },
    text: { color: colors.kakaoText },
  }),
  text: StyleSheet.create({
    container: { minHeight: size.touchMin, backgroundColor: 'transparent' },
    text: { color: colors.accent },
  }),
};
