import { StyleSheet, Text, View } from 'react-native';

import { colors } from './tokens';

/** 이름 첫 글자 동그라미 (사진 프로필은 아직 없다). 읽기 프로그램에는 옆의 이름이 읽히므로 숨긴다. */
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initial = [...name.trim()][0] ?? '?';
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <Text style={[styles.text, { fontSize: Math.round(size * 0.42) }]}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  text: { color: '#FFFFFF', fontWeight: '700' },
});
