import Ionicons from '@expo/vector-icons/Ionicons';
import { useEvent, useEventListener } from 'expo';
import { Image } from 'expo-image';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BigButton } from '@/components/easy/BigButton';
import { HomeButton } from '@/components/easy/HomeButton';
import { easyColors, easySize } from '@/components/easy/tokens';
import { ko } from '@/copy/ko';
import { useSession } from '@/features/auth/session';
import { listMyGroups } from '@/features/groups/api';
import { getPost, listNameBook, senderName, type FeedMedia, type FeedPost, type NameBook } from '@/features/posts/feed';
import { formatDay, titleOf } from '@/features/posts/format';
import { addHeart, listHearts, removeHeart, type HeartBook } from '@/features/posts/reactions';
import { loadEasyFeed } from '@/features/posts/unseen';
import { recordView } from '@/features/posts/views';
import { signedSource, signedUrl, signPaths } from '@/lib/signedUrl';

// 한 장씩 보기 (F-BIXKFC, 와이어프레임 '쉬운 모드 · 한 장씩 보기'·'다 봤어요').
// - 어두운 화면에 한 장을 크게, 위에 '처음으로'와 '3 / 12'. 아래에 태그·제목·보낸 사람·날짜.
// - 이전·좋아요·다음 큰 버튼으로 직접 넘긴다. 밀어서 넘기기는 넣지 않는다 (숨은 제스처 금지).
// - '쭉 보기'를 누르면 사진은 8초, 영상은 끝까지 본 뒤 넘긴다. 같은 자리 버튼이 '멈추기'로 바뀐다.
//   쭉 보기 중에는 화면이 꺼지지 않게 한다.
// - 마지막 장 다음은 '다 봤어요'. 아직 안 본 새 묶음이 더 있으면 그 묶음과 '다음 사진 보기' (10/18 결정 6).
// - 첫 장이 보이면 '봤어요'를 기록한다 (내가 보낸 묶음은 빼고, 10/18 결정 7).
// - 좋아요 = 하트 (F-CPRPRW). 다시 누르면 취소, 누르면 'OO에게 보냈어요'를 2초 보여준다.

const AUTO_MS = 8000;
const KEEP_AWAKE_TAG = 'easy-play';

export default function EasyPlay() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useSession();
  const me = session?.user.id ?? '';

  const [post, setPost] = useState<FeedPost | null | undefined>(undefined);
  const [book, setBook] = useState<NameBook>(new Map());
  const [groupOrder, setGroupOrder] = useState<string[]>([]);
  const [hearts, setHearts] = useState<HeartBook>(new Map());
  const [failed, setFailed] = useState(false);
  const [at, setAt] = useState(0); // total이면 '다 봤어요'
  const [auto, setAuto] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const p = await getPost(id);
      if (p) {
        await signPaths(p.media.flatMap((m) => [m.thumbPath, m.path]));
        const [b, groups, h] = await Promise.all([
          listNameBook(p.groupIds).catch(() => new Map() as NameBook),
          me ? listMyGroups(me).catch(() => []) : Promise.resolve([]),
          listHearts(p.media.map((m) => m.id)).catch(() => new Map() as HeartBook),
        ]);
        setBook(b);
        setGroupOrder(groups.map((g) => g.id));
        setHearts(h);
      }
      setPost(p);
    } catch (e) {
      if (__DEV__) console.warn('[easy play load failed]', e);
      setFailed(true);
    }
  }, [id, me]);

  useEffect(() => {
    load();
  }, [load]);

  // 첫 장이 보이면 '봤어요'
  useEffect(() => {
    if (post && me && post.senderId !== me) recordView(post.id, me);
  }, [post, me]);

  const total = post?.media.length ?? 0;
  const done = !!post && at >= total;
  const media = post && !done ? post.media[at] : undefined;

  const next = useCallback(() => setAt((i) => Math.min(i + 1, total)), [total]);
  const prev = () => setAt((i) => Math.max(i - 1, 0));

  // 다 보면 쭉 보기를 끈다
  useEffect(() => {
    if (done) setAuto(false);
  }, [done]);

  // 쭉 보기: 사진은 8초 뒤 다음 장 (영상은 끝나면 EasyVideo가 onEnd를 부른다)
  useEffect(() => {
    if (!auto || !media || media.type !== 'photo') return;
    const t = setTimeout(next, AUTO_MS);
    return () => clearTimeout(t);
  }, [auto, media, next]);

  useEffect(() => {
    if (auto) activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    else deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [auto]);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const sender = post ? senderName(book, post.senderId, post.groupIds, groupOrder, null) ?? ko.feed.unknownSender : '';
  const hearted = !!media && (hearts.get(media.id) ?? []).includes(me);

  function showToast(message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    AccessibilityInfo.announceForAccessibility(message);
    toastTimer.current = setTimeout(() => setToast(null), 2000);
  }

  function setHeartLocal(mediaId: string, on: boolean) {
    setHearts((prevBook) => {
      const nextBook = new Map(prevBook);
      const users = (prevBook.get(mediaId) ?? []).filter((u) => u !== me);
      nextBook.set(mediaId, on ? [...users, me] : users);
      return nextBook;
    });
  }

  async function toggleHeart() {
    if (!post || !media || !me) return;
    const mediaId = media.id;
    const on = !hearted;
    setHeartLocal(mediaId, on);
    if (on) showToast(post.senderId === me ? ko.easy.play.likeSelf : ko.easy.play.likeSent(sender));
    try {
      if (on) await addHeart(mediaId, post.id, me);
      else await removeHeart(mediaId, me);
    } catch (e) {
      if (__DEV__) console.warn('[heart failed]', e);
      setHeartLocal(mediaId, !on);
      showToast(ko.easy.play.likeFailed);
    }
  }

  if (failed || post === null || post === undefined) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <HomeButton dark />
        <View style={styles.center}>
          {post === undefined && !failed ? (
            <ActivityIndicator size="large" color={easyColors.darkText} />
          ) : (
            <>
              <Text style={styles.centerText}>{failed ? ko.easy.home.offline : ko.easy.play.gone}</Text>
              {failed ? <BigButton variant="dark" label={ko.easy.home.retry} onPress={load} /> : null}
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  if (done) return <Done post={post} me={me} sender={sender} />;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.top}>
        <HomeButton dark />
        <Text style={styles.position} accessibilityLabel={ko.easy.play.positionLabel(at + 1, total)}>
          {ko.easy.play.position(at + 1, total)}
        </Text>
      </View>

      <View style={styles.stage}>
        {media?.type === 'video' ? (
          <EasyVideo key={media.id} media={media} auto={auto} onEnd={() => auto && next()} onSkip={next} />
        ) : media ? (
          <Image
            key={media.id}
            source={signedSource(media.path)}
            placeholder={signedSource(media.thumbPath)}
            style={styles.photo}
            contentFit="contain"
            transition={200}
            accessibilityLabel={ko.easy.play.photoLabel(at + 1, total)}
          />
        ) : null}
        {toast ? (
          <View style={styles.toast} pointerEvents="none">
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.info}>
        {post.tags.length > 0 ? (
          <View style={styles.tags}>
            {post.tags.map((t) => (
              <Text key={t} style={styles.tag}>
                #{t}
              </Text>
            ))}
          </View>
        ) : null}
        {titleOf(post, sender) ? <Text style={styles.postTitle}>{titleOf(post, sender)}</Text> : null}
        <Text style={styles.meta}>{ko.easy.play.sentBy(sender, formatDay(post.createdAt))}</Text>
      </View>

      <BigButton
        variant="dark"
        icon={auto ? 'pause' : 'play'}
        label={auto ? ko.easy.play.stop : ko.easy.play.auto}
        accessibilityLabel={auto ? ko.easy.play.stop : ko.easy.play.autoLabel}
        onPress={() => setAuto((a) => !a)}
      />

      <View style={styles.controls}>
        <ControlButton icon="chevron-back" label={ko.easy.play.prev} onPress={prev} disabled={at === 0} />
        <ControlButton
          icon={hearted ? 'heart' : 'heart-outline'}
          label={ko.easy.play.like}
          onPress={toggleHeart}
          accent
          selected={hearted}
        />
        <ControlButton icon="chevron-forward" label={ko.easy.play.next} onPress={next} />
      </View>
    </SafeAreaView>
  );
}

function ControlButton({
  icon,
  label,
  onPress,
  disabled,
  accent,
  selected,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  accent?: boolean;
  selected?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.control,
        accent && styles.controlAccent,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name={icon} size={30} color="#FFFFFF" />
      <Text style={styles.controlText}>{label}</Text>
    </Pressable>
  );
}

function EasyVideo({
  media,
  auto,
  onEnd,
  onSkip,
}: {
  media: FeedMedia;
  auto: boolean;
  onEnd: () => void;
  onSkip: () => void;
}) {
  const url = signedUrl(media.path);
  const player = useVideoPlayer(url ? { uri: url } : null, (p) => {
    p.loop = false;
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  useEventListener(player, 'playToEnd', onEnd);

  // 쭉 보기 중이면 바로 재생한다 (직접 넘길 때는 재생 버튼을 눌러 본다)
  useEffect(() => {
    if (auto) player.play();
  }, [auto, player]);

  if (!url || status === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.centerText}>{ko.easy.play.videoFailed}</Text>
        <BigButton variant="dark" label={ko.easy.play.skip} onPress={onSkip} />
      </View>
    );
  }
  return <VideoView player={player} style={styles.photo} contentFit="contain" nativeControls />;
}

/** 다 봤어요: 아직 안 본 새 묶음이 더 있으면 '다음 사진 보기' */
function Done({ post, me, sender }: { post: FeedPost; me: string; sender: string }) {
  const [nextPost, setNextPost] = useState<{ post: FeedPost; sender: string } | null | undefined>(undefined);

  useEffect(() => {
    if (!me) return;
    loadEasyFeed(me)
      .then(async (f) => {
        const p = f.newPosts.find((x) => x.id !== post.id);
        if (!p) return setNextPost(null);
        if (p.media[0]) await signPaths([p.media[0].thumbPath]);
        const order = f.groups.map((g) => g.id);
        setNextPost({ post: p, sender: senderName(f.book, p.senderId, p.groupIds, order, null) ?? ko.feed.unknownSender });
      })
      .catch(() => setNextPost(null));
  }, [me, post.id]);

  const summary = ko.easy.play.doneSummary(titleOf(post, sender) ?? formatDay(post.createdAt), post.media.length);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <HomeButton dark />
      <View style={styles.doneHead}>
        <Text style={styles.doneTitle} accessibilityRole="header">
          {ko.easy.play.done}
        </Text>
        <Text style={styles.doneSub}>{summary}</Text>
      </View>
      {nextPost ? (
        <View style={styles.nextCard}>
          <Text style={styles.nextLabel}>{ko.easy.play.moreNew}</Text>
          <View style={styles.nextRow}>
            <Image
              source={signedSource(nextPost.post.media[0]?.thumbPath)}
              style={styles.nextThumb}
              contentFit="cover"
              accessibilityIgnoresInvertColors
            />
            <View style={styles.nextText}>
              {titleOf(nextPost.post, nextPost.sender) ? (
                <Text style={styles.nextTitle}>{titleOf(nextPost.post, nextPost.sender)}</Text>
              ) : null}
              <Text style={styles.nextSub}>
                {ko.easy.play.nextSub(nextPost.sender, nextPost.post.media.length)}
              </Text>
            </View>
          </View>
          <BigButton
            large
            icon="play"
            label={ko.easy.play.nextPost}
            onPress={() => router.replace({ pathname: '/play/[id]', params: { id: nextPost.post.id } })}
          />
        </View>
      ) : nextPost === null ? (
        <BigButton large label={ko.easy.home.goHome} onPress={() => router.dismissTo('/home')} style={styles.doneHome} />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: easyColors.dark,
    paddingHorizontal: easySize.gutter,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 14,
  },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  position: { fontSize: 22, fontWeight: '700', color: easyColors.darkText },
  stage: { flex: 1, borderRadius: 16, overflow: 'hidden', backgroundColor: easyColors.darkSurface },
  photo: { flex: 1 },
  center: { flex: 1, alignItems: 'stretch', justifyContent: 'center', gap: 20, padding: 16 },
  centerText: { fontSize: easySize.bodyLarge, lineHeight: 30, color: easyColors.darkText, textAlign: 'center' },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(0,0,0,0.8)',
  },
  toastText: { fontSize: easySize.bodyLarge, fontWeight: '700', color: '#FFFFFF', textAlign: 'center' },
  info: { gap: 6 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: {
    fontSize: 17,
    fontWeight: '600',
    color: easyColors.darkText,
    borderWidth: 1.5,
    borderColor: easyColors.darkText,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  postTitle: { fontSize: easySize.title, lineHeight: 32, fontWeight: '700', color: easyColors.darkText },
  meta: { fontSize: easySize.body, color: easyColors.darkTextSecondary },
  controls: { flexDirection: 'row', gap: 10 },
  control: {
    flex: 1,
    height: 80,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: easyColors.darkText,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  controlAccent: { backgroundColor: easyColors.accent, borderColor: easyColors.accent },
  controlText: { fontSize: easySize.bodyLarge, fontWeight: '700', color: '#FFFFFF' },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.7 },
  doneHead: { marginTop: 56, gap: 10 },
  doneTitle: { fontSize: 32, fontWeight: '700', color: easyColors.darkText },
  doneSub: { fontSize: easySize.bodyLarge, color: easyColors.darkTextSecondary },
  doneHome: { marginTop: 'auto' },
  nextCard: {
    marginTop: 'auto',
    gap: 12,
    borderWidth: 2,
    borderColor: easyColors.darkText,
    borderRadius: 20,
    padding: 14,
  },
  nextLabel: { fontSize: easySize.bodyLarge, fontWeight: '700', color: easyColors.darkText },
  nextRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  nextThumb: { width: 88, height: 88, borderRadius: 12, backgroundColor: easyColors.darkSurface },
  nextText: { flex: 1, gap: 4 },
  nextTitle: { fontSize: easySize.bodyLarge, fontWeight: '700', color: easyColors.darkText },
  nextSub: { fontSize: easySize.body, color: easyColors.darkTextSecondary },
});
