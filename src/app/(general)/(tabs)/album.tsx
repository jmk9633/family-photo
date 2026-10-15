import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { StartChoices } from '@/components/StartChoices';
import { colors, size } from '@/components/tokens';
import { ko } from '@/copy/ko';
import { useMyGroups } from '@/features/groups/useMyGroups';
import { albumMonths, albumSenders, albumTags, listNameBook, senderName } from '@/features/posts/feed';
import { formatMonth } from '@/features/posts/format';
import { signedSource, signPaths } from '@/lib/signedUrl';

// 앨범 탭 (F-HEETWR, 와이어프레임 Album): 월별 · 보낸 사람 · 태그로 모아 보기.
// 카드 = 대표 사진 + 이름 + '묶음 N개 · M장'. 카드를 누르면 그 묶음 목록(album/[by]).
// 내 모든 그룹의 사진을 모은다 (같은 묶음은 한 번만 — DB 함수가 센다).

type By = 'month' | 'sender' | 'tag';
type Card = { key: string; value: string; title: string; postCount: number; mediaCount: number; cover: string | null };

const MODES: { by: By; label: string }[] = [
  { by: 'month', label: ko.album.byMonth },
  { by: 'sender', label: ko.album.bySender },
  { by: 'tag', label: ko.album.byTag },
];

export default function AlbumTab() {
  const { groups, failed: groupsFailed, reload } = useMyGroups();
  const [by, setBy] = useState<By>('month');
  const [cards, setCards] = useState<Card[] | null>(null);
  const [failed, setFailed] = useState(false);
  const requestId = useRef(0);

  const groupIdsKey = (groups ?? []).map((g) => g.id).join(',');

  const load = useCallback(async () => {
    const groupIds = groupIdsKey.split(',').filter(Boolean);
    const id = ++requestId.current;
    setFailed(false);
    try {
      let next: Card[];
      if (by === 'month') {
        next = (await albumMonths(groupIds)).map((m) => ({
          key: m.month,
          value: m.month,
          title: formatMonth(m.month),
          postCount: m.postCount,
          mediaCount: m.mediaCount,
          cover: m.coverThumb,
        }));
      } else if (by === 'sender') {
        const [rows, book] = await Promise.all([albumSenders(groupIds), listNameBook(groupIds)]);
        next = rows.map((r) => ({
          key: r.senderId,
          value: r.senderId,
          title: senderName(book, r.senderId, [], groupIds, null) ?? ko.feed.unknownSender,
          postCount: r.postCount,
          mediaCount: r.mediaCount,
          cover: r.coverThumb,
        }));
      } else {
        next = (await albumTags(groupIds)).map((t) => ({
          key: t.tag,
          value: t.tag,
          title: `#${t.tag}`,
          postCount: t.postCount,
          mediaCount: t.mediaCount,
          cover: t.coverThumb,
        }));
      }
      await signPaths(next.flatMap((c) => (c.cover ? [c.cover] : [])));
      if (id === requestId.current) setCards(next);
    } catch (e) {
      if (__DEV__) console.warn('[album load failed]', e);
      if (id === requestId.current) setFailed(true);
    }
  }, [by, groupIdsKey]);

  // 화면에 돌아올 때, 보기를 바꿀 때 다시 센다
  useFocusEffect(
    useCallback(() => {
      if (groupIdsKey) load();
    }, [groupIdsKey, load]),
  );

  if (groupsFailed) {
    return (
      <SafeAreaView edges={['top']} style={[styles.container, styles.center]}>
        <Text style={styles.note}>{ko.groupErrors.loadFailed}</Text>
        <Button variant="outline" label={ko.common.retry} onPress={reload} />
      </SafeAreaView>
    );
  }
  if (groups !== null && groups.length === 0) {
    return (
      <SafeAreaView edges={['top']} style={styles.container}>
        <StartChoices />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          {ko.album.title}
        </Text>
        <View style={styles.segment} accessibilityRole="tablist">
          {MODES.map((m) => {
            const active = m.by === by;
            return (
              <Pressable
                key={m.by}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={m.label}
                onPress={() => {
                  if (active) return;
                  setCards(null);
                  setBy(m.by);
                }}
                style={[styles.segmentItem, active && styles.segmentActive]}
              >
                <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{m.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {failed ? (
        <View style={styles.center}>
          <Text style={styles.note}>{ko.groupErrors.loadFailed}</Text>
          <Button variant="outline" label={ko.common.retry} onPress={load} />
        </View>
      ) : cards === null || groups === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} accessibilityLabel={ko.common.loading} />
        </View>
      ) : (
        <FlatList
          data={cards}
          keyExtractor={(c) => c.key}
          numColumns={2}
          columnWrapperStyle={styles.columns}
          contentContainerStyle={cards.length === 0 ? styles.emptyContent : styles.content}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.note}>{by === 'tag' ? ko.album.noTags : ko.album.empty}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.title}, ${ko.album.count(item.postCount, item.mediaCount)}`}
              onPress={() =>
                router.push({ pathname: '/album/[by]', params: { by, value: item.value, title: item.title } })
              }
              style={({ pressed }) => [styles.card, pressed && styles.pressed]}
            >
              <View style={styles.cover}>
                <Image
                  source={signedSource(item.cover)}
                  recyclingKey={item.cover ?? item.key}
                  contentFit="cover"
                  transition={120}
                  style={StyleSheet.absoluteFill}
                />
              </View>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.cardCount}>{ko.album.count(item.postCount, item.mediaCount)}</Text>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: size.gutter },
  note: { fontSize: size.small, lineHeight: 22, color: colors.textSecondary, textAlign: 'center' },
  header: { paddingHorizontal: 16, paddingTop: 4, gap: 12 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text, minHeight: size.touchMin, textAlignVertical: 'center', lineHeight: 48 },
  segment: { flexDirection: 'row', padding: 4, borderRadius: 10, backgroundColor: colors.surface },
  segmentItem: { flex: 1, minHeight: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  segmentActive: { backgroundColor: colors.background },
  segmentLabel: { fontSize: size.small, color: colors.textSecondary },
  segmentLabelActive: { color: colors.text, fontWeight: '700' },
  content: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24, gap: 18 },
  emptyContent: { flexGrow: 1 },
  columns: { gap: 12 },
  card: { flex: 1, gap: 4, maxWidth: '50%' },
  cover: { aspectRatio: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.surface },
  cardTitle: { fontSize: size.body, fontWeight: '700', color: colors.text },
  cardCount: { fontSize: 14, color: colors.textSecondary },
  pressed: { opacity: 0.8 },
});
