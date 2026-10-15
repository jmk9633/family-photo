import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FeedList } from '@/components/FeedList';
import { colors, size } from '@/components/tokens';
import { ko } from '@/copy/ko';
import { useMyGroups } from '@/features/groups/useMyGroups';
import type { FeedFilter } from '@/features/posts/feed';

// 앨범 카드를 누르면 보이는 묶음 목록 (F-HEETWR: 카드를 누르면 해당 묶음 목록으로).
// params: by = month | sender | tag, value = 'YYYY-MM-01' | 사용자 ID | 태그, title = 머리글

export default function AlbumPostsScreen() {
  const { by, value, title } = useLocalSearchParams<{ by: string; value: string; title?: string }>();
  const { groups } = useMyGroups();

  const filter = useMemo<Omit<FeedFilter, 'groupIds'>>(
    () => (by === 'month' ? { month: value } : by === 'sender' ? { senderId: value } : { tag: value }),
    [by, value],
  );
  const groupIds = useMemo(() => (groups ?? []).map((g) => g.id), [groups]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerTitle: title ?? '' }} />
      {groups ? (
        <FeedList
          groups={groups}
          groupIds={groupIds}
          viewingGroupId={null}
          filter={filter}
          // 월별 카드는 이미 한 달이므로 월 제목이 필요 없다
          monthHeaders={by !== 'month'}
          renderEmpty={() => (
            <View style={styles.empty}>
              <Text style={styles.note}>{ko.album.empty}</Text>
            </View>
          )}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  note: { fontSize: size.small, color: colors.textSecondary },
});
