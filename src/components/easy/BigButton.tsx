import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { easyColors, easySize } from './tokens';

// 쉬운 모드 큰 버튼. 높이 64 이상(large는 76), 글자 20 이상.
//   primary: 강조색 바탕 / outline: 흰 바탕 검은 테두리 / gray: 옅은 회색 / dark: 어두운 화면용 흰 테두리

type Variant = 'primary' | 'outline' | 'gray' | 'dark';
type IconName = keyof typeof Ionicons.glyphMap;

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  icon?: IconName;
  large?: boolean;
  loading?: boolean;
  disabled?: boolean;
  /** 읽기 프로그램용 설명 (글자와 다를 때만) */
  accessibilityLabel?: string;
  selected?: boolean;
  style?: ViewStyle;
};

export function BigButton({
  label,
  onPress,
  variant = 'primary',
  icon,
  large,
  loading,
  disabled,
  accessibilityLabel,
  selected,
  style,
}: Props) {
  const v = variants[variant];
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading, selected }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        large && styles.large,
        v.container,
        isDisabled && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.text.color} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={large ? 28 : 26} color={v.text.color} /> : null}
          <Text style={[styles.label, large && styles.labelLarge, v.text]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: easySize.buttonHeight,
    borderRadius: easySize.radius,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  large: { minHeight: easySize.buttonLarge, borderRadius: 18 },
  label: { fontSize: easySize.bodyLarge, fontWeight: '700' },
  labelLarge: { fontSize: 23 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.8 },
});

const variants = {
  primary: StyleSheet.create({
    container: { backgroundColor: easyColors.accent },
    text: { color: '#FFFFFF' },
  }),
  outline: StyleSheet.create({
    container: { backgroundColor: easyColors.background, borderWidth: 2, borderColor: easyColors.border },
    text: { color: easyColors.text },
  }),
  gray: StyleSheet.create({
    container: { backgroundColor: easyColors.surface },
    text: { color: easyColors.text },
  }),
  dark: StyleSheet.create({
    container: { backgroundColor: 'transparent', borderWidth: 2, borderColor: easyColors.darkText },
    text: { color: easyColors.darkText },
  }),
};
