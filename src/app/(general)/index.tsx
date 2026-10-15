import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { colors, size } from '@/components/tokens';
import { ko } from '@/copy/ko';
import { signOut, useSession } from '@/features/auth/session';
import { listMyGroups, type Group } from '@/features/groups/api';

// 임시 홈.
// 그룹이 없으면 '새 그룹 만들기 / 초대 코드로 들어가기'를 크게, 있으면 그룹 목록과 '사진 보내기'를 보여준다.
// 4단계에서 사진 타임라인(하단 가운데 '보내기')으로 바뀐다.
export default function HomeScreen() {
  const { session } = useSession();
  const userId = session?.user.id ?? '';
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    listMyGroups(userId)
      .then(setGroups)
      .catch(() => setFailed(true));
  }, [userId]);

  // 다른 화면에서 돌아올 때마다 새로 불러온다 (그룹을 만들거나 들어간 뒤).
  useFocusEffect(load);

  const signOutButton = (
    <Button
      variant="text"
      label={ko.home.signOut}
      loading={signingOut}
      onPress={async () => {
        setSigningOut(true);
        await signOut();
      }}
    />
  );

  if (failed) {
    return (
      <SafeAreaView style={[styles.container, styles.center]}>
        <Text style={styles.note}>{ko.groupErrors.loadFailed}</Text>
        <Button variant="outline" label={ko.common.retry} onPress={load} />
      </SafeAreaView>
    );
  }

  if (groups === null) {
    return (
      <SafeAreaView style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.accent} accessibilityLabel={ko.common.loading} />
      </SafeAreaView>
    );
  }

  if (groups.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.startBody}>
          <Text style={styles.title} accessibilityRole="header">
            {ko.start.title}
          </Text>
          <BigChoice
            label={ko.start.create}
            hint={ko.start.createHint}
            primary
            onPress={() => router.push('/group-new')}
          />
          <BigChoice
            label={ko.start.join}
            hint={ko.start.joinHint}
            onPress={() => router.push('/join')}
          />
        </View>
        {signOutButton}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.listBody}>
        <Text style={styles.title} accessibilityRole="header">
          {ko.home.title}
        </Text>
        <View style={styles.list}>
          {groups.map((g) => (
            <Pressable
              key={g.id}
              accessibilityRole="button"
              accessibilityLabel={g.name}
              onPress={() => router.push({ pathname: '/group/[id]', params: { id: g.id } })}
              style={({ pressed }) => [styles.groupRow, pressed && styles.pressed]}
            >
              <Text style={styles.groupName}>{g.name}</Text>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.note}>{ko.home.note}</Text>
      </ScrollView>
      <View style={styles.actions}>
        <Button label={ko.home.send} onPress={() => router.push('/send')} />
        <Button variant="outline" label={ko.home.create} onPress={() => router.push('/group-new')} />
        <Button variant="outline" label={ko.home.join} onPress={() => router.push('/join')} />
        {signOutButton}
      </View>
    </SafeAreaView>
  );
}

function BigChoice(props: { label: string; hint: string; primary?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityHint={props.hint}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.choice,
        props.primary && styles.choicePrimary,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.choiceLabel, props.primary && styles.choiceLabelPrimary]}>
        {props.label}
      </Text>
      <Text style={[styles.choiceHint, props.primary && styles.choiceHintPrimary]}>
        {props.hint}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: size.gutter },
  center: { justifyContent: 'center', alignItems: 'center', gap: 16 },
  title: { fontSize: size.title, lineHeight: 38, fontWeight: '700', color: colors.text },
  note: { fontSize: size.small, lineHeight: 22, color: colors.textSecondary },
  pressed: { opacity: 0.8 },

  startBody: { flex: 1, justifyContent: 'center', gap: 16 },
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
  choiceLabelPrimary: { color: '#FFFFFF' },
  choiceHint: { fontSize: size.small, color: colors.textSecondary },
  choiceHintPrimary: { color: 'rgba(255,255,255,0.9)' },

  listBody: { paddingTop: 24, gap: 16 },
  list: { borderWidth: 1, borderColor: colors.border, borderRadius: size.radius },
  groupRow: {
    minHeight: size.buttonHeight,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  groupName: { fontSize: size.body, fontWeight: '600', color: colors.text },
  chevron: { fontSize: 24, color: colors.textSecondary },
  actions: { gap: 10, paddingBottom: 8 },
});
