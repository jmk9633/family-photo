import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BigButton } from '@/components/easy/BigButton';
import { HomeButton } from '@/components/easy/HomeButton';
import { easyColors, easySize } from '@/components/easy/tokens';
import { ko } from '@/copy/ko';
import { useSession } from '@/features/auth/session';
import { listMyGroups } from '@/features/groups/api';
import {
  albumMonths,
  albumSenders,
  listFeed,
  listNameBook,
  senderName,
  type FeedCursor,
  type FeedPost,
  type NameBook,
} from '@/features/posts/feed';
import { dayOfMonth, monthKey } from '@/features/posts/format';
import { signedSource, signPaths } from '@/lib/signedUrl';

// 쉬운 화면 지난 사진 (F-JQQCZR, 와이어프레임 '쉬운 모드 · 지난 사진').
// 월 제목 아래 큰 카드 2열(제목·날짜·보낸 사람·장 수), 위에 '모두'와 보낸 사람 버튼. 태그 필터는 없다.
// 여러 그룹 사진은 한 목록에 날짜순으로 합친다. 카드를 누르면 한 장씩 보기.
// 홈의 월 카드로 들어오면 그 달만 보여주고 '모든 달 보기'로 넓힌다.

type Row = { key: string; items: FeedPost[] };
type Section = { month: string; data: Row[] };

export default function EasyPast() {
  const { month: monthParam } = useLocalSearchParams<{ month?: string }>();
  const { session } = useSession();
  const me = session?.user.id ?? '';

  const [groupIds, setGroupIds] = useState<string[] | null>(null);
  const [book, setBook] = useState<NameBook>(new Map());
  const [senders, setSenders] = useState<string[]>([]);
  const [monthCounts, setMonthCounts] = useState<Map<string, number>>(new Map());
  const [sender, setSender] = useState<string | null>(null);
  const [month, setMonth] = useState<string | null>(monthParam ?? null);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [cursor, setCursor] = useState<FeedCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // 그룹·이름표·보낸 사람 목록·월별 묶음 수
  useEffect(() => {
    if (!me) return;
    (async () => {
      try {
        const groups = await listMyGroups(me);
        const ids = groups.map((g) => g.id);
        const [b, s, m] = await Promise.all([listNameBook(ids), albumSenders(ids), albumMonths(ids)]);
        setBook(b);
        setSenders(s.map((x) => x.senderId));
        setMonthCounts(new Map(m.map((x) => [x.month, x.postCount])));
        setGroupIds(ids);
      } catch (e) {
        if (__DEV__) console.warn('[easy past load failed]', e);
        setFailed(true);
        setLoading(false);
      }
    })();
  }, [me]);

  const loadPage = useCallback(
    async (from: FeedCursor | null) => {
      if (!groupIds) return;
      setLoading(true);
      setFailed(false);
      try {
        const page = await listFeed(
          { groupIds, senderId: sender ?? undefined, month: month ?? undefined },
          from,
        );
        await signPaths(page.posts.map((p) => p.media[0]?.thumbPath ?? '').filter(Boolean));
        setPosts((prev) => (from ? [...prev, ...page.posts] : page.posts));
        setCursor(page.next);
      } catch (e) {
        if (__DEV__) console.warn('[easy past page failed]', e);
        setFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [groupIds, sender, month],
  );

  useEffect(() => {
    setPosts([]);
    setCursor(null);
    loadPage(null);
  }, [loadPage]);

  const groupOrder = groupIds ?? [];
  const nameOf = useCallback(
    (userId: string, postGroups: string[]) =>
      senderName(book, userId, postGroups, groupOrder, null) ?? ko.feed.unknownSender,
    [book, groupOrder],
  );

  const sections = useMemo<Section[]>(() => {
    const byMonth = new Map<string, FeedPost[]>();
    for (const p of posts) {
      const k = monthKey(p.createdAt);
      byMonth.set(k, [...(byMonth.get(k) ?? []), p]);
    }
    return [...byMonth.entries()].map(([m, list]) => {
      const rows: Row[] = [];
      for (let i = 0; i < list.length; i += 2) rows.push({ key: list[i].id, items: list.slice(i, i + 2) });
      return { month: m, data: rows };
    });
  }, [posts]);

  const monthLabel = (key: string) => ko.easy.home.month(Number(key.slice(5, 7)));

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.header}>
        <HomeButton />
        <Text style={styles.title} accessibilityRole="header">
          {ko.easy.past.title}
        </Text>
      </View>

      <ScrollView horizontal contentContainerStyle={styles.chips} style={styles.chipBar} showsHorizontalScrollIndicator={false}>
        <Chip label={ko.easy.past.all} on={sender === null} onPress={() => setSender(null)} />
        {senders.map((s) => (
          <Chip key={s} label={nameOf(s, [])} on={sender === s} onPress={() => setSender(s)} />
        ))}
      </ScrollView>

      {month ? (
        <View style={styles.monthOnly}>
          <Text style={styles.monthOnlyText}>{ko.easy.past.monthOnly(monthLabel(month))}</Text>
          <BigButton variant="outline" label={ko.easy.past.allMonths} onPress={() => setMonth(null)} style={styles.monthOnlyButton} />
        </View>
      ) : null}

      <SectionList
        sections={sections}
        keyExtractor={(row) => row.key}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await loadPage(null);
              setRefreshing(false);
            }}
            tintColor={easyColors.text}
          />
        }
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (cursor && !loading) loadPage(cursor);
        }}
        renderSectionHeader={({ section }) => (
          <View style={styles.monthHead}>
            <Text style={styles.monthTitle} accessibilityRole="header">
              {monthLabel(section.month)}
            </Text>
            {sender === null && monthCounts.get(section.month) ? (
              <Text style={styles.monthCount}>{ko.feed.monthCount(monthCounts.get(section.month) ?? 0)}</Text>
            ) : null}
          </View>
        )}
        renderItem={({ item }) => (
          <View style={styles.row}>
            {item.items.map((p) => {
              const name = nameOf(p.senderId, p.groupIds);
              const sub = ko.easy.past.card(dayOfMonth(p.createdAt), name, p.media.length);
              const title = p.title ?? ko.easy.past.untitled;
              return (
                <Pressable
                  key={p.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${title}, ${sub}`}
                  onPress={() => router.push({ pathname: '/play/[id]', params: { id: p.id } })}
                  style={({ pressed }) => [styles.card, pressed && styles.pressed]}
                >
                  <Image
                    source={signedSource(p.media[0]?.thumbPath)}
                    style={styles.thumb}
                    contentFit="cover"
                    accessibilityIgnoresInvertColors
                  />
                  <Text style={styles.cardTitle} numberOfLines={2}>
                    {title}
                  </Text>
                  <Text style={styles.cardSub}>{sub}</Text>
                </Pressable>
              );
            })}
            {item.items.length === 1 ? <View style={styles.card} /> : null}
          </View>
        )}
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.message}>
              <Text style={styles.messageText}>{failed ? ko.easy.home.offline : ko.easy.past.empty}</Text>
              {failed ? <BigButton variant="outline" label={ko.easy.home.retry} onPress={() => loadPage(null)} /> : null}
            </View>
          )
        }
        ListFooterComponent={loading ? <ActivityIndicator size="large" color={easyColors.text} style={styles.spinner} /> : null}
      />
    </SafeAreaView>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.pressed]}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: easyColors.background },
  header: { paddingHorizontal: easySize.gutter, paddingTop: 8, flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: easySize.title, fontWeight: '700', color: easyColors.text },
  chipBar: { flexGrow: 0 },
  chips: { paddingHorizontal: easySize.gutter, paddingVertical: 12, gap: 8 },
  chip: {
    minHeight: easySize.touchMin,
    paddingHorizontal: 20,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: easyColors.border,
    justifyContent: 'center',
    backgroundColor: easyColors.background,
  },
  chipOn: { backgroundColor: easyColors.text },
  chipText: { fontSize: easySize.body, fontWeight: '600', color: easyColors.text },
  chipTextOn: { color: '#FFFFFF', fontWeight: '700' },
  monthOnly: { paddingHorizontal: easySize.gutter, gap: 8, paddingBottom: 4 },
  monthOnlyText: { fontSize: easySize.body, color: easyColors.textSecondary },
  monthOnlyButton: { minHeight: easySize.touchMin + 8 },
  list: { paddingHorizontal: easySize.gutter, paddingBottom: 32, gap: 12 },
  monthHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 12, marginBottom: 4 },
  monthTitle: { fontSize: easySize.title, fontWeight: '700', color: easyColors.text },
  monthCount: { fontSize: easySize.body, color: easyColors.textSecondary },
  row: { flexDirection: 'row', gap: 12 },
  card: { flex: 1, gap: 4 },
  thumb: { height: 140, borderRadius: 16, backgroundColor: easyColors.placeholder },
  cardTitle: { fontSize: 19, fontWeight: '700', color: easyColors.text },
  cardSub: { fontSize: easySize.body, color: easyColors.textSecondary },
  pressed: { opacity: 0.7 },
  message: { paddingVertical: 48, gap: 20 },
  messageText: { fontSize: easySize.bodyLarge, lineHeight: 30, color: easyColors.text, textAlign: 'center' },
  spinner: { marginVertical: 24 },
});
