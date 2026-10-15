import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ko } from '@/copy/ko';

import { colors, size } from './tokens';

/** 그룹이 하나도 없을 때: '새 그룹 만들기 / 초대 코드로 들어가기'를 크게 */
export function StartChoices() {
  return (
    <View style={styles.body}>
      <Text style={styles.title} accessibilityRole="header">
        {ko.start.title}
      </Text>
      <BigChoice
        label={ko.start.create}
        hint={ko.start.createHint}
        primary
        onPress={() => router.push('/group-new')}
      />
      <BigChoice label={ko.start.join} hint={ko.start.joinHint} onPress={() => router.push('/join')} />
    </View>
  );
}

function BigChoice(props: { label: string; hint: string; primary?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityHint={props.hint}
      onPress={props.onPress}
      style={({ pressed }) => [styles.choice, props.primary && styles.choicePrimary, pressed && styles.pressed]}
    >
      <Text style={[styles.choiceLabel, props.primary && styles.onAccent]}>{props.label}</Text>
      <Text style={[styles.choiceHint, props.primary && styles.onAccentSoft]}>{props.hint}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, justifyContent: 'center', gap: 16, paddingHorizontal: size.gutter },
  title: { fontSize: size.title, lineHeight: 38, fontWeight: '700', color: colors.text },
  choice: {
    paddingVertical: 20,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  choicePrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  choiceLabel: { fontSize: 20, fontWeight: '700', color: colors.text },
  choiceHint: { fontSize: size.small, color: colors.textSecondary },
  onAccent: { color: '#FFFFFF' },
  onAccentSoft: { color: 'rgba(255,255,255,0.9)' },
  pressed: { opacity: 0.8 },
});
