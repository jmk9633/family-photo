import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { FeedList } from '@/components/FeedList';
import { GroupPicker } from '@/components/GroupPicker';
import { StartChoices } from '@/components/StartChoices';
import { MyWellbeingBanner } from '@/components/MyWellbeingBanner';
import { WellbeingBanner } from '@/components/WellbeingBanner';
import { colors, size } from '@/components/tokens';
import { ko } from '@/copy/ko';
import { useMyGroups } from '@/features/groups/useMyGroups';

// 사진 탭: 월별 사진 타임라인 (F-FRFNRL, 와이어프레임 Home).
// 위: '모든 가족 ▾' 그룹 선택, 그 아래 안부 띠(관리자만, 7-1)와 내 안부 확인 띠(대상자 본인, 7-2). 주간 모음 카드·알림 종은 해당 기능 단계에서 붙인다.

export default function PhotosTab() {
  const { groups, failed, reload } = useMyGroups();
  const [picked, setPicked] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // 고른 그룹에서 나갔으면 '모든 가족'으로 돌아간다
  const selected = picked && groups?.some((g) => g.id === picked) ? picked : null;
  const groupIds = useMemo(
    () => (selected ? [selected] : (groups ?? []).map((g) => g.id)),
    [selected, groups],
  );

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
  // 아직 그룹이 없으면 (전제 조건: 그룹 하나 이상) 그룹 만들기·들어가기부터
  if (groups.length === 0) {
    return (
      <SafeAreaView edges={['top']} style={styles.container}>
        <StartChoices />
      </SafeAreaView>
    );
  }

  const title = selected ? (groups.find((g) => g.id === selected)?.name ?? ko.feed.allGroups) : ko.feed.allGroups;

  return (
    <SafeAreaView edges={['top']} style={styles.container}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={ko.feed.groupButton(title)}
          onPress={() => setPickerOpen(true)}
          style={({ pressed }) => [styles.groupButton, pressed && styles.pressed]}
        >
          <Text style={styles.groupTitle} numberOfLines={1}>
            {title}
          </Text>
          <Ionicons name="chevron-down" size={20} color={colors.text} />
        </Pressable>
      </View>

      <WellbeingBanner />
      <MyWellbeingBanner />

      <FeedList
        groups={groups}
        groupIds={groupIds}
        viewingGroupId={selected}
        monthHeaders
        renderEmpty={() => (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{ko.feed.emptyTitle}</Text>
            <Text style={styles.note}>{ko.feed.emptyText}</Text>
            <Button
              label={ko.feed.emptySend}
              onPress={() => router.push({ pathname: '/send', params: selected ? { group: selected } : {} })}
            />
          </View>
        )}
      />

      <GroupPicker
        visible={pickerOpen}
        groups={groups}
        selected={selected}
        onSelect={(id) => {
          setPicked(id);
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: size.gutter },
  note: { fontSize: size.small, lineHeight: 22, color: colors.textSecondary, textAlign: 'center' },
  header: { paddingHorizontal: 16, paddingTop: 4, flexDirection: 'row', alignItems: 'center' },
  groupButton: {
    minHeight: size.touchMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '85%',
  },
  groupTitle: { fontSize: 22, fontWeight: '700', color: colors.text, flexShrink: 1 },
  pressed: { opacity: 0.7 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'stretch', gap: 12, paddingHorizontal: 8 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: colors.text, textAlign: 'center' },
});
