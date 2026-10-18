import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Alert,
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

import { VideoSlide } from '@/components/VideoSlide';
import { ko } from '@/copy/ko';
import { useSession } from '@/features/auth/session';
import { useMyGroups } from '@/features/groups/useMyGroups';
import {
  getPost,
  listNameBook,
  senderName,
  type FeedMedia,
  type FeedPost,
  type NameBook,
} from '@/features/posts/feed';
import { formatDay, titleOf } from '@/features/posts/format';
import { addHeart, listHearts, removeHeart, type HeartBook } from '@/features/posts/reactions';
import { deleteMyPost } from '@/features/posts/remove';
import { recordView } from '@/features/posts/views';
import { signedSource, signPaths } from '@/lib/signedUrl';

// 사진 상세 (일반 모드, 결정 D2): 타임라인에서 누른 사진부터 어두운 전체 화면으로 크게 보고,
// 좌우로 밀거나 아래 '이전·다음' 버튼으로 묶음 안을 넘긴다. 아래에 제목·태그·보낸 사람·날짜.
// 원본은 여기서만 불러오고, 받는 동안 썸네일을 먼저 보여준다 (CLAUDE.md 이미지 처리).
// 영상은 시스템 재생 버튼으로 재생하고, 다른 장으로 넘기면 멈춘다 (VideoSlide).
// 하트(5단계, F-CPRPRW): 제목 아래 줄. 다시 누르면 취소, 누르면 'OO에게 보냈어요'를 잠깐 보여준다.
// 그 장에 하트를 누른 다른 사람 이름을 숫자 없이 보여준다 (같은 그룹 구성원 누구나 본다).
// 이 화면을 열면 '봤어요'를 기록한다 (F-BLIYTI, 내가 보낸 묶음은 빼고).
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
  const { session } = useSession();
  const me = session?.user.id ?? '';
  const [post, setPost] = useState<FeedPost | null | undefined>(undefined);
  const [book, setBook] = useState<NameBook>(new Map());
  const [hearts, setHearts] = useState<HeartBook>(new Map());
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // 이름표 (보낸 사람·하트 누른 사람. 그룹마다 이름이 다를 수 있다)
  useEffect(() => {
    if (!post) return;
    listNameBook(post.groupIds)
      .then(setBook)
      .catch(() => setBook(new Map()));
  }, [post]);

  // '봤어요' 기록과 하트 목록
  useEffect(() => {
    if (!post || !me) return;
    if (post.senderId !== me) recordView(post.id, me);
    listHearts(post.media.map((m) => m.id))
      .then(setHearts)
      .catch((e) => {
        if (__DEV__) console.warn('[hearts load failed]', e);
      });
  }, [post, me]);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const myGroupOrder = groups?.map((g) => g.id) ?? [];
  const nameOf = (userId: string) =>
    post ? senderName(book, userId, post.groupIds, myGroupOrder, group ?? null) : null;
  const sender = post ? nameOf(post.senderId) : null;

  const total = post?.media.length ?? 0;
  const at = Math.min(current, Math.max(total - 1, 0));
  const currentMedia = post?.media[at];
  const heartUsers = (currentMedia && hearts.get(currentMedia.id)) || [];
  const hearted = heartUsers.includes(me);
  const heartNames = heartUsers
    .filter((u) => u !== me)
    .map(nameOf)
    .filter((n): n is string => !!n);

  function showToast(message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    AccessibilityInfo.announceForAccessibility(message);
    toastTimer.current = setTimeout(() => setToast(null), 2000);
  }

  function setHeartLocal(mediaId: string, on: boolean) {
    setHearts((prev) => {
      const nextBook = new Map(prev);
      const users = (prev.get(mediaId) ?? []).filter((u) => u !== me);
      nextBook.set(mediaId, on ? [...users, me] : users);
      return nextBook;
    });
  }

  // 먼저 화면에 반영하고, 실패하면 되돌린다. 연달아 눌러도 DB에는 하나만 남는다 (기본 키).
  async function toggleHeart() {
    if (!post || !currentMedia || !me) return;
    const mediaId = currentMedia.id;
    const on = !hearted;
    setHeartLocal(mediaId, on);
    if (on) showToast(post.senderId === me ? ko.detail.heartSentSelf : ko.detail.heartSent(sender ?? ko.feed.unknownSender));
    try {
      if (on) await addHeart(mediaId, post.id, me);
      else await removeHeart(mediaId, me);
    } catch (e) {
      if (__DEV__) console.warn('[heart failed]', e);
      setHeartLocal(mediaId, !on);
      showToast(ko.detail.heartFailed);
    }
  }

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

  // 내가 보낸 묶음 지우기 (F-LMXBXX: 자기 사진은 개별로 언제든 지울 수 있다). 받은 모든 그룹에서 사라진다.
  function confirmDelete() {
    if (!post) return;
    Alert.alert(ko.detail.deleteTitle, ko.detail.deleteText, [
      { text: ko.common.cancel, style: 'cancel' },
      {
        text: ko.detail.deleteConfirm,
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteMyPost(post.id);
            close();
          } catch (e) {
            if (__DEV__) console.warn('[post delete failed]', e);
            showToast(ko.detail.deleteFailed);
          }
        },
      },
    ]);
  }

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
        {post && post.senderId === me ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={ko.detail.delete}
            onPress={confirmDelete}
            hitSlop={8}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Ionicons name="trash-outline" size={26} color="#FFFFFF" />
          </Pressable>
        ) : (
          <View style={styles.iconButton} />
        )}
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
              item.type === 'video' ? (
                <View style={{ width }} accessibilityLabel={ko.detail.videoLabel(i + 1, total)}>
                  <VideoSlide path={item.path} active={i === at} />
                </View>
              ) : (
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
              )
            )}
          />

          <View style={styles.bottom}>
            <View style={styles.info}>
              <Text style={styles.title}>{titleOf(post, sender) ?? formatDay(post.createdAt)}</Text>
              {post.tags.length > 0 ? (
                <Text style={styles.tags}>{post.tags.map((t) => `#${t}`).join('  ')}</Text>
              ) : null}
              <Text style={styles.meta}>
                {[sender ?? ko.feed.unknownSender, formatDay(post.createdAt)].join(' · ')}
              </Text>
            </View>
            <View style={styles.heartRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={ko.detail.heart}
                accessibilityState={{ selected: hearted }}
                onPress={toggleHeart}
                style={({ pressed }) => [styles.heartButton, hearted && styles.heartButtonOn, pressed && styles.pressed]}
              >
                <Ionicons name={hearted ? 'heart' : 'heart-outline'} size={26} color={hearted ? HEART : '#FFFFFF'} />
                <Text style={styles.darkButtonLabel}>{ko.detail.heart}</Text>
              </Pressable>
              {heartNames.length > 0 ? (
                <Text style={styles.heartNames} numberOfLines={2}>
                  {ko.detail.heartNames(heartNames)}
                </Text>
              ) : null}
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
      {toast ? (
        <View pointerEvents="none" style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
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

const HEART = '#FF5A6E';

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
  heartRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heartButton: {
    minHeight: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
  },
  heartButtonOn: { borderColor: HEART },
  heartNames: { flex: 1, color: '#E8E8E8', fontSize: 15, lineHeight: 21 },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: '42%',
    backgroundColor: 'rgba(40,40,40,0.92)',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  toastText: { color: '#FFFFFF', fontSize: 17, fontWeight: '600' },
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
