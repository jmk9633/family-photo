import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { ko } from '@/copy/ko';
import type { Group } from '@/features/groups/api';
import {
  albumMonths,
  listFeed,
  listNameBook,
  senderName,
  type FeedCursor,
  type FeedFilter,
  type FeedPost,
  type NameBook,
} from '@/features/posts/feed';
import { formatMonth, monthKey } from '@/features/posts/format';
import { signPaths } from '@/lib/signedUrl';

import { Button } from './Button';
import { GRID_MAX } from './PostGrid';
import { PostCard } from './PostCard';
import { colors, size } from './tokens';

// 묶음 목록 (사진 탭 타임라인과 앨범 카드의 묶음 목록이 함께 쓴다).
// 월 제목 아래에 묶음을 최신순으로 (F-FRFNRL). 20개씩 이어서 불러온다.
// 화면에 돌아올 때마다 첫 페이지를 다시 읽는다 (보내기에서 돌아왔을 때 새 묶음이 바로 보이게).

type Props = {
  groups: Group[]; // 내 그룹 전체 (먼저 들어간 순) — 이름·받은 그룹 표시용
  groupIds: string[]; // 이 목록에 보여줄 그룹
  viewingGroupId: string | null; // 특정 그룹을 보고 있으면 그 ID ('모든 가족'이면 null)
  filter?: Omit<FeedFilter, 'groupIds'>;
  monthHeaders: boolean; // 월 제목과 그 달의 묶음 수
  header?: ReactElement;
  renderEmpty: () => ReactElement;
};

type Row = { kind: 'month'; key: string; month: string } | { kind: 'post'; key: string; post: FeedPost };

/** a가 b보다 아래(오래된 쪽)인가 — 목록 순서(보낸 시각 ↓, id ↓)와 같은 기준 */
function isOlder(a: FeedPost, b: FeedPost): boolean {
  return isOlderCursor({ createdAt: a.createdAt, id: a.id }, { createdAt: b.createdAt, id: b.id });
}
function isOlderCursor(a: FeedCursor, b: FeedCursor): boolean {
  const ta = Date.parse(a.createdAt);
  const tb = Date.parse(b.createdAt);
  if (ta !== tb) return ta < tb;
  // 밀리초까지 같으면 원문(마이크로초 포함)과 id로 가른다
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt;
  return a.id < b.id;
}

/** 한 묶음에서 목록에 보이는 썸네일 경로 */
const visibleThumbs = (p: FeedPost) => p.media.slice(0, GRID_MAX).map((m) => m.thumbPath);

export function FeedList({ groups, groupIds, viewingGroupId, filter, monthHeaders, header, renderEmpty }: Props) {
  const [posts, setPosts] = useState<FeedPost[] | null>(null);
  const [next, setNext] = useState<FeedCursor | null>(null);
  const [names, setNames] = useState<NameBook>(new Map());
  const [monthCounts, setMonthCounts] = useState<Map<string, number>>(new Map());
  const [failed, setFailed] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // 그룹을 바꾸는 사이에 늦게 온 응답은 버린다
  const requestId = useRef(0);

  // 조건을 문자열 하나로 만들어 둔다. 부모가 같은 내용의 배열을 새로 만들어 넘겨도 다시 불러오지 않는다.
  const key = JSON.stringify({ groupIds, ...filter } satisfies FeedFilter);
  const allGroupIds = groups.map((g) => g.id).join(',');

  const loadFirst = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent') => {
      const id = ++requestId.current;
      if (mode === 'initial') {
        setPosts(null);
        setFailed(false);
      }
      if (mode === 'refresh') setRefreshing(true);
      try {
        const fullFilter = JSON.parse(key) as FeedFilter;
        const [page, book, months] = await Promise.all([
          listFeed(fullFilter, null),
          listNameBook(allGroupIds.split(',').filter(Boolean)),
          monthHeaders ? albumMonths(fullFilter.groupIds) : Promise.resolve([]),
        ]);
        await signPaths(page.posts.flatMap(visibleThumbs));
        if (id !== requestId.current) return;
        if (mode === 'silent') {
          // 화면에 돌아왔을 때(사진 상세를 닫았을 때 등): 새 첫 페이지로 바꾸되, 더 아래까지 불러 둔
          // 묶음은 그대로 둔다. 그래야 보던 자리가 사라지지 않는다.
          const last = page.posts[page.posts.length - 1];
          setPosts((prev) => {
            if (!prev || !last || !page.next) return page.posts;
            const older = prev.filter((p) => isOlder(p, last));
            return older.length > 0 ? [...page.posts, ...older] : page.posts;
          });
          setNext((prevNext) => (page.next && prevNext && isOlderCursor(prevNext, page.next) ? prevNext : page.next));
        } else {
          setPosts(page.posts);
          setNext(page.next);
        }
        setNames(book);
        setMonthCounts(new Map(months.map((m) => [m.month, m.postCount])));
        setFailed(false);
        setMoreFailed(false);
      } catch (e) {
        if (__DEV__) console.warn('[feed load failed]', e);
        // 이미 목록이 있으면 그대로 두고 (조용한 새로고침 실패), 처음이면 오류 화면
        if (id === requestId.current && mode !== 'silent') setFailed(true);
      } finally {
        if (id === requestId.current) setRefreshing(false);
      }
    },
    [key, allGroupIds, monthHeaders],
  );

  const loadedKey = useRef<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      const first = loadedKey.current !== key;
      loadedKey.current = key;
      loadFirst(first ? 'initial' : 'silent');
    }, [key, loadFirst]),
  );

  const loadMore = useCallback(async () => {
    if (!next || loadingMore || posts === null) return;
    const id = requestId.current;
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      const page = await listFeed(JSON.parse(key) as FeedFilter, next);
      await signPaths(page.posts.flatMap(visibleThumbs));
      if (id !== requestId.current) return;
      setPosts((prev) => [...(prev ?? []), ...page.posts.filter((p) => !prev?.some((q) => q.id === p.id))]);
      setNext(page.next);
    } catch (e) {
      if (__DEV__) console.warn('[feed more failed]', e);
      if (id === requestId.current) setMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }, [next, loadingMore, posts, key]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let lastMonth: string | null = null;
    for (const p of posts ?? []) {
      const m = monthKey(p.createdAt);
      if (monthHeaders && m !== lastMonth) {
        out.push({ kind: 'month', key: `m-${m}`, month: m });
        lastMonth = m;
      }
      out.push({ kind: 'post', key: p.id, post: p });
    }
    return out;
  }, [posts, monthHeaders]);

  const groupOrder = useMemo(() => groups.map((g) => g.id), [groups]);
  const groupName = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);

  if (failed) {
    return (
      <View style={styles.center}>
        {header}
        <Text style={styles.note}>{ko.groupErrors.loadFailed}</Text>
        <Button variant="outline" label={ko.common.retry} onPress={() => loadFirst('initial')} />
      </View>
    );
  }
  if (posts === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} accessibilityLabel={ko.common.loading} />
      </View>
    );
  }

  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => r.key}
      contentContainerStyle={rows.length === 0 ? styles.emptyContent : styles.content}
      ListHeaderComponent={header}
      ListEmptyComponent={renderEmpty}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => loadFirst('refresh')} tintColor={colors.accent} />
      }
      onEndReached={loadMore}
      onEndReachedThreshold={0.6}
      ListFooterComponent={
        loadingMore ? (
          <ActivityIndicator style={styles.footer} color={colors.accent} />
        ) : moreFailed ? (
          <View style={styles.footer}>
            <Text style={styles.note}>{ko.feed.loadMoreFailed}</Text>
            <Button variant="text" label={ko.common.retry} onPress={loadMore} />
          </View>
        ) : null
      }
      renderItem={({ item }) => {
        if (item.kind === 'month') {
          const count = monthCounts.get(item.month);
          return (
            <View style={styles.month} accessibilityRole="header">
              <Text style={styles.monthTitle}>{formatMonth(item.month)}</Text>
              {count ? <Text style={styles.monthCount}>{ko.feed.monthCount(count)}</Text> : null}
            </View>
          );
        }
        const p = item.post;
        return (
          <PostCard
            post={p}
            sender={senderName(names, p.senderId, p.groupIds, groupOrder, viewingGroupId)}
            groupNames={
              viewingGroupId
                ? null
                : groupOrder.filter((g) => p.groupIds.includes(g)).map((g) => groupName.get(g) ?? '')
            }
            onOpen={(index) =>
              router.push({
                pathname: '/post/[id]',
                params: { id: p.id, index: String(index), ...(viewingGroupId ? { group: viewingGroupId } : {}) },
              })
            }
          />
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 24 },
  emptyContent: { flexGrow: 1, paddingHorizontal: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: size.gutter },
  note: { fontSize: size.small, lineHeight: 22, color: colors.textSecondary, textAlign: 'center' },
  month: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingTop: 18 },
  monthTitle: { fontSize: 19, fontWeight: '700', color: colors.text },
  monthCount: { fontSize: 14, color: colors.textSecondary },
  footer: { paddingVertical: 20, alignItems: 'center', gap: 4 },
});
