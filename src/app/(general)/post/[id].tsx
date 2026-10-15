import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { ko } from '@/copy/ko';
import { useMyGroups } from '@/features/groups/useMyGroups';
import { getPost, listNameBook, senderName, type FeedMedia, type FeedPost } from '@/features/posts/feed';
import { formatDay } from '@/features/posts/format';
import { signedSource, signPaths } from '@/lib/signedUrl';

// 사진 상세 (일반 모드, 결정 D2): 타임라인에서 누른 사진부터 어두운 전체 화면으로 크게 보고,
// 좌우로 밀거나 아래 '이전·다음' 버튼으로 묶음 안을 넘긴다. 아래에 제목·태그·보낸 사람·날짜.
// 원본은 여기서만 불러오고, 받는 동안 썸네일을 먼저 보여준다 (CLAUDE.md 이미지 처리).
// 하트(5단계)는 이 화면 아래 버튼 줄에 붙는다.
//
// params: id = 묶음, index = 처음 보여줄 장(0부터), group = 보고 있던 그룹(보낸 사람 이름 기준)

// 전체 화면 모달 안에서는 바깥(앱 루트)의 SafeAreaProvider가 안전 영역을 0으로 알려 줘서,
// 닫기·'3 / 12'가 상태 표시줄 밑에, 이전·다음이 홈 막대 위에 깔려 눌리지 않았다 (10/15 아이폰에서 확인).
// Expo 문서 권장대로 모달 화면의 루트에 SafeAreaProvider를 따로 둔다.
export default function PostDetailScreen() {
  return (
    <SafeAreaProvider>
      <PostDetail />
    </SafeAreaProvider>
  );
}

function PostDetail() {
  const { id, index, group } = useLocalSearchParams<{ id: string; index?: string; group?: string }>();
  const { width } = useWindowDimensions();
  const { groups } = useMyGroups();
  const [post, setPost] = useState<FeedPost | null | undefined>(undefined);
  const [sender, setSender] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [current, setCurrent] = useState(() => Math.max(0, Number(index ?? 0) || 0));
  const listRef = useRef<FlatList<FeedMedia>>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const p = await getPost(id);
      if (p) await signPaths(p.media.flatMap((m) => [m.thumbPath, m.path]));
      setPost(p);
    } catch (e) {
      if (__DEV__) console.warn('[post load failed]', e);
      setFailed(true);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // 보낸 사람 이름 (그룹마다 다를 수 있어 내 그룹 순서가 필요)
  useEffect(() => {
    if (!post || !groups) return;
    listNameBook(post.groupIds)
      .then((book) => setSender(senderName(book, post.senderId, post.groupIds, groups.map((g) => g.id), group ?? null)))
      .catch(() => setSender(null));
  }, [post, groups, group]);

  const total = post?.media.length ?? 0;
  const at = Math.min(current, Math.max(total - 1, 0));

  function go(to: number) {
    if (to < 0 || to >= total) return;
    listRef.current?.scrollToIndex({ index: to, animated: true });
    setCurrent(to);
  }

  function onScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== current) setCurrent(i);
  }

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.top}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={ko.detail.close}
          onPress={close}
          hitSlop={8}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <Ionicons name="close" size={30} color="#FFFFFF" />
        </Pressable>
        {total > 0 ? (
          <Text style={styles.position} accessibilityLiveRegion="polite">
            {ko.detail.position(at + 1, total)}
          </Text>
        ) : null}
        <View style={styles.iconButton} />
      </View>

      {failed ? (
        <View style={styles.center}>
          <Text style={styles.message}>{ko.detail.loadFailed}</Text>
          <DarkButton label={ko.common.retry} onPress={load} />
        </View>
      ) : post === undefined ? (
        <View style={styles.center}>
          <ActivityIndicator color="#FFFFFF" accessibilityLabel={ko.common.loading} />
        </View>
      ) : post === null || total === 0 ? (
        <View style={styles.center}>
          <Text style={styles.message}>{ko.detail.gone}</Text>
          <DarkButton label={ko.detail.close} onPress={close} />
        </View>
      ) : (
        <>
          <FlatList
            ref={listRef}
            style={styles.pager}
            data={post.media}
            keyExtractor={(m) => m.id}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={at}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            onMomentumScrollEnd={onScrollEnd}
            renderItem={({ item, index: i }) => (
              <View style={{ width }} accessible accessibilityLabel={ko.detail.photoLabel(i + 1, total)}>
                <Image
                  source={signedSource(item.path)}
                  placeholder={signedSource(item.thumbPath)}
                  placeholderContentFit="contain"
                  contentFit="contain"
                  transition={150}
                  style={styles.photo}
                />
              </View>
            )}
          />

          <View style={styles.bottom}>
            <View style={styles.info}>
              <Text style={styles.title}>{post.title ?? formatDay(post.createdAt)}</Text>
              {post.tags.length > 0 ? (
                <Text style={styles.tags}>{post.tags.map((t) => `#${t}`).join('  ')}</Text>
              ) : null}
              <Text style={styles.meta}>
                {[sender ?? ko.feed.unknownSender, formatDay(post.createdAt)].join(' · ')}
              </Text>
            </View>
            {total > 1 ? (
              <View style={styles.nav}>
                <DarkButton label={ko.detail.prev} icon="chevron-back" disabled={at === 0} onPress={() => go(at - 1)} />
                <DarkButton
                  label={ko.detail.next}
                  icon="chevron-forward"
                  iconAfter
                  disabled={at === total - 1}
                  onPress={() => go(at + 1)}
                />
              </View>
            ) : null}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

function DarkButton(props: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  iconAfter?: boolean;
}) {
  const icon = props.icon ? <Ionicons name={props.icon} size={22} color="#FFFFFF" /> : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: !!props.disabled }}
      disabled={props.disabled}
      onPress={props.onPress}
      style={({ pressed }) => [styles.darkButton, props.disabled && styles.disabled, pressed && styles.pressed]}
    >
      {!props.iconAfter && icon}
      <Text style={styles.darkButtonLabel}>{props.label}</Text>
      {props.iconAfter && icon}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  position: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 24 },
  message: { color: '#FFFFFF', fontSize: 17, textAlign: 'center', lineHeight: 24 },
  pager: { flex: 1 },
  photo: { flex: 1 },
  bottom: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, gap: 14 },
  info: { gap: 4 },
  title: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  tags: { color: '#E8E8E8', fontSize: 15 },
  meta: { color: '#C8C8C8', fontSize: 15 },
  nav: { flexDirection: 'row', gap: 10 },
  darkButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 16,
  },
  darkButtonLabel: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.7 },
});
