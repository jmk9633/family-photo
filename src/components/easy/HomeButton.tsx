import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { ko } from '@/copy/ko';

import { easyColors, easySize } from './tokens';

// 쉬운 모드 모든 화면의 '처음으로' 버튼 (CLAUDE.md 화면 규칙). 누르면 쉬운 화면 홈으로 돌아간다.
// onPress를 주면 그 동작을 대신 한다 (연결 화면처럼 홈이 아직 없는 곳).

type Props = { dark?: boolean; onPress?: () => void };

export function HomeButton({ dark, onPress }: Props) {
  const color = dark ? easyColors.darkText : easyColors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={ko.easy.home.goHome}
      onPress={onPress ?? (() => router.dismissTo('/home'))}
      style={({ pressed }) => [styles.button, { borderColor: color }, pressed && styles.pressed]}
    >
      <Ionicons name="chevron-back" size={24} color={color} />
      <Text style={[styles.label, { color }]}>{ko.easy.home.goHome}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignSelf: 'flex-start',
    minHeight: 56,
    paddingLeft: 12,
    paddingRight: 20,
    borderWidth: 2,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  label: { fontSize: easySize.bodyLarge, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});
