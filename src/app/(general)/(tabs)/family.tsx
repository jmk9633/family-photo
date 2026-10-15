import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { StartChoices } from '@/components/StartChoices';
import { colors, size } from '@/components/tokens';
import { ko } from '@/copy/ko';
import { useMyGroups } from '@/features/groups/useMyGroups';

// 가족 탭: 내 그룹 목록 → 그룹 화면(구성원·초대). 새 그룹 만들기, 초대 코드로 들어가기.
// (3단계까지의 임시 홈을 옮겨 온 화면. 와이어프레임 Family의 나머지는 해당 기능 단계에서.)

export default function FamilyTab() {
  const { groups, failed, reload } = useMyGroups();

  if (failed) {
    return (
      <SafeAreaView edges={['top']} style={[styles.container, styles.center]}>
        <Text style={styles.note}>{ko.groupErrors.loadFailed}</Text>
        <Button variant="outline" label={ko.common.retry} onPress={reload} />
      </SafeAreaView>
    );
  }
  if (groups === null) {
    return (
      <SafeAreaView edges={['top']} style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.accent} accessibilityLabel={ko.common.loading} />
      </SafeAreaView>
    );
  }
  if (groups.length === 0) {
    return (
      <SafeAreaView edges={['top']} style={styles.container}>
        <StartChoices />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.container}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title} accessibilityRole="header">
          {ko.family.title}
        </Text>
        <View style={styles.list}>
          {groups.map((g) => (
            <Pressable
              key={g.id}
              accessibilityRole="button"
              accessibilityLabel={g.name}
              onPress={() => router.push({ pathname: '/group/[id]', params: { id: g.id } })}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <Text style={styles.groupName} numberOfLines={1}>
                {g.name}
              </Text>
              <Ionicons name="chevron-forward" size={22} color={colors.textSecondary} />
            </Pressable>
          ))}
        </View>
        <View style={styles.actions}>
          <Button variant="outline" label={ko.family.create} onPress={() => router.push('/group-new')} />
          <Button variant="outline" label={ko.family.join} onPress={() => router.push('/join')} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: size.gutter },
  note: { fontSize: size.small, lineHeight: 22, color: colors.textSecondary },
  body: { paddingHorizontal: size.gutter, paddingTop: 12, paddingBottom: 24, gap: 16 },
  title: { fontSize: size.title, lineHeight: 38, fontWeight: '700', color: colors.text },
  list: { borderWidth: 1, borderColor: colors.border, borderRadius: size.radius, overflow: 'hidden' },
  row: {
    minHeight: size.buttonHeight,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  groupName: { fontSize: size.body, fontWeight: '600', color: colors.text, flexShrink: 1 },
  pressed: { opacity: 0.8 },
  actions: { gap: 10 },
});
