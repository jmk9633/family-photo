import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, size } from './tokens';

type Props = {
  label: string;
  hint: string;
  checked: boolean;
  onToggle: () => void;
};

/** 체크 표시 + 이름 + 한 줄 설명. 줄 전체를 눌러 켜고 끈다. */
export function CheckRow({ label, hint, checked, onToggle }: Props) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onToggle}
      style={({ pressed }) => [styles.row, checked && styles.rowChecked, pressed && styles.pressed]}
    >
      <View style={[styles.box, checked && styles.boxChecked]}>
        {checked ? <Text style={styles.mark}>✓</Text> : null}
      </View>
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: size.buttonHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: size.radius,
  },
  rowChecked: { borderColor: colors.accent },
  pressed: { opacity: 0.8 },
  box: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: { backgroundColor: colors.accent, borderColor: colors.accent },
  mark: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', lineHeight: 18 },
  text: { flex: 1, gap: 2 },
  label: { fontSize: size.body, fontWeight: '600', color: colors.text },
  hint: { fontSize: size.small, lineHeight: 20, color: colors.textSecondary },
});
