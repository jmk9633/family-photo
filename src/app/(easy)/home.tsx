import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BigButton } from '@/components/easy/BigButton';
import { easyColors, easySize } from '@/components/easy/tokens';
import { ko } from '@/copy/ko';
import { useMode } from '@/features/auth/mode';
import { useSession } from '@/features/auth/session';
import { albumMonths, senderName, type FeedPost, type MonthCount } from '@/features/posts/feed';
import { formatDay, titleOf } from '@/features/posts/format';
import { retryOutbox } from '@/features/posts/outbox';
import { loadEasyFeed, type EasyFeed } from '@/features/posts/unseen';
import { getPushStatus, requestPush } from '@/features/push/push';
import { getMyWellbeing } from '@/features/wellbeing/api';
import { signedSource, signPaths } from '@/lib/signedUrl';

// 쉬운 화면 홈 (F-MGGNVR, 와이어프레임 '쉬운 모드 · 홈'). 탭 없는 한 화면.
// - 새 사진(아직 한 장도 안 본, 남이 보낸 묶음)이 있으면 가장 최근 것의 첫 장을 크게,
//   보낸 사람·제목·그 묶음 장 수('새 사진 12장', 10/18 결정 6)와 큰 '보기' 버튼.
// - 없으면 최근 사진을 8초마다 천천히 넘겨 보여준다. 이건 시청으로 세지 않는다 (10/18 결정 7).
// - 아래에 지난 사진 월 카드 2개와 '전체 보기', 오른쪽 위 '더보기'.
// - 숫자로 막 연결됐으면 '연결됐어요' → (알림 권한을 아직 안 물었으면) 알림 안내를 먼저 보여준다.
// 아래에 '사진 찍어 보내기'·'영상 한마디' 큰 버튼 두 개 (6-2). 보내지 못해 보관해 둔 것은 홈을 열 때 다시 보낸다.
// 안부 확인(7-2): 홈이 보이면 관리자의 켜기 요청이 있으면 동의 화면을, 켜진 채 처음이면 안내를 앱을 열 때 한 번 띄운다.

const SLIDE_MS = 8000;

// 안부 동의·안내는 앱을 한 번 열 때 한 번만 띄운다 ('처음으로'로 넘기면 다음에 앱을 열 때 다시)
let wellbeingAsked = false;

async function openWellbeingOnce() {
  if (wellbeingAsked) return;
  wellbeingAsked = true;
  try {
    const rows = await getMyWellbeing();
    const asks = rows.filter((r) => r.requested);
    if (asks.length > 0) {
      router.push({ pathname: '/wellbeing', params: { mode: 'consent', again: asks.some((r) => r.ever_on) ? '1' : '0' } });
    } else if (rows.some((r) => r.intro_needed)) {
      router.push({ pathname: '/wellbeing', params: { mode: 'intro' } });
    }
  } catch (e) {
    wellbeingAsked = false; // 못 불러왔으면 다음에 홈이 보일 때 다시
    if (__DEV__) console.warn('[wellbeing status failed]', e);
  }
}
const SLIDE_COUNT = 5;

export default function EasyHome() {
  const { session } = useSession();
  const me = session?.user.id ?? '';
  const { welcome, setWelcome, isAnonymous, refreshMode } = useMode();
  const [step, setStep] = useState<'welcome' | 'notify' | 'home'>(welcome !== null ? 'welcome' : 'home');
  // 더보기에서 다른 가족과도 연결하고 돌아오면 '연결됐어요'를 다시 보여준다
  useEffect(() => {
    if (welcome !== null) setStep('welcome');
  }, [welcome]);

  const [feed, setFeed] = useState<EasyFeed | null>(null);
  const [months, setMonths] = useState<MonthCount[]>([]);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!me) return;
    setFailed(false);
    try {
      const f = await loadEasyFeed(me);
      // 가입 없이 연결한 사람이 모든 그룹에서 내보내지면 처음 화면(숫자 입력)으로 돌아간다
      if (isAnonymous && f.groups.length === 0) {
        await refreshMode();
        return;
      }
      const groupIds = f.groups.map((g) => g.id);
      const [m] = await Promise.all([
        albumMonths(groupIds).catch(() => [] as MonthCount[]),
        // 큰 사진은 원본, 작은 카드는 썸네일 (CLAUDE.md 이미지 처리)
        signPaths([
          ...f.posts.slice(0, SLIDE_COUNT).flatMap((p) => firstPaths(p)),
          ...(f.newPosts[0] ? firstPaths(f.newPosts[0]) : []),
        ]),
      ]);
      await signPaths(m.slice(0, 2).map((x) => x.coverThumb ?? '').filter(Boolean));
      setFeed(f);
      setMonths(m);
    } catch (e) {
      if (__DEV__) console.warn('[easy home load failed]', e);
      setFailed(true);
    }
  }, [me, isAnonymous, refreshMode]);

  // 연결됐어요·알림 안내가 끝나 홈이 보일 때.
  // 앱을 뒤로 보냈다가 다시 열면 한 번 더 확인한다 (요청은 푸시 없이 이렇게만 알린다, 결정 3)
  // 홈이 보이는 동안에만 (사진을 보는 중에는 띄우지 않는다)
  useFocusEffect(
    useCallback(() => {
      if (step !== 'home' || !me) return;
      openWellbeingOnce();
      const sub = AppState.addEventListener('change', (s) => {
        if (s === 'active') {
          wellbeingAsked = false;
          openWellbeingOnce();
        }
      });
      return () => sub.remove();
    }, [step, me]),
  );

  useFocusEffect(
    useCallback(() => {
      load();
      // 보내지 못해 보관해 둔 사진·영상 한마디가 있으면 다시 보낸다 (6-2)
      retryOutbox(me)
        .then((n) => {
          if (n > 0) load();
        })
        .catch(() => {});
    }, [load, me]),
  );

  // 아래로 당기면 새로 읽는다 (화면에 돌아올 때도 새로 읽으므로 이것만이 유일한 방법은 아니다)
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (step === 'welcome') {
    return (
      <Welcome
        groupName={welcome ?? ''}
        onDone={async () => {
          setWelcome(null);
          const status = await getPushStatus().catch(() => 'granted' as const);
          setStep(status === 'undetermined' ? 'notify' : 'home');
        }}
      />
    );
  }
  if (step === 'notify') {
    return (
      <NotifyAsk
        onAllow={async () => {
          if (me) await requestPush(me).catch(() => {});
          setStep('home');
        }}
        onLater={() => setStep('home')}
      />
    );
  }

  const myGroupOrder = feed?.groups.map((g) => g.id) ?? [];
  const nameOf = (p: FeedPost) =>
    (feed && senderName(feed.book, p.senderId, p.groupIds, myGroupOrder, null)) || ko.feed.unknownSender;
  const fresh = feed?.newPosts[0];

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          {ko.easy.home.title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={ko.easy.home.more}
          onPress={() => router.push('/more')}
          style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
        >
          <Text style={styles.moreText}>{ko.easy.home.more}</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={easyColors.text} />}
      >
        {failed && !feed ? (
          <View style={styles.message}>
            <Text style={styles.messageText}>{ko.easy.home.offline}</Text>
            <BigButton variant="outline" label={ko.easy.home.retry} onPress={load} />
          </View>
        ) : !feed ? (
          <View style={styles.message}>
            <ActivityIndicator size="large" color={easyColors.text} />
            <Text style={styles.messageText}>{ko.easy.home.loading}</Text>
          </View>
        ) : feed.posts.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>{ko.easy.home.empty}</Text>
          </View>
        ) : fresh ? (
          <NewPostCard post={fresh} sender={nameOf(fresh)} />
        ) : (
          <QuietSlides posts={feed.posts.slice(0, SLIDE_COUNT)} nameOf={nameOf} />
        )}

        {feed && months.length > 0 ? (
          <>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>{ko.easy.home.past}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={ko.easy.home.pastAll}
                onPress={() => router.push('/past')}
                style={({ pressed }) => [styles.allButton, pressed && styles.pressed]}
              >
                <Text style={styles.allText}>{ko.easy.home.pastAll}</Text>
                <Ionicons name="chevron-forward" size={22} color={easyColors.text} />
              </Pressable>
            </View>
            <View style={styles.monthGrid}>
              {months.slice(0, 2).map((m) => {
                const label = ko.easy.home.month(Number(m.month.slice(5, 7)));
                return (
                  <Pressable
                    key={m.month}
                    accessibilityRole="button"
                    accessibilityLabel={`${label}, ${ko.easy.home.count(m.postCount, m.mediaCount)}`}
                    onPress={() => router.push({ pathname: '/past', params: { month: m.month } })}
                    style={({ pressed }) => [styles.monthCard, pressed && styles.pressed]}
                  >
                    <Image
                      source={signedSource(m.coverThumb)}
                      style={styles.monthThumb}
                      contentFit="cover"
                      accessibilityIgnoresInvertColors
                    />
                    <Text style={styles.monthLabel}>{label}</Text>
                    <Text style={styles.monthCount}>{ko.easy.home.count(m.postCount, m.mediaCount)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}
      </ScrollView>

      {/* 사진 찍어 보내기·영상 한마디 (6-2, 와이어프레임 홈 하단) */}
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <BigButton
          variant="outline"
          icon="camera-outline"
          label={ko.easy.camera.takePhoto}
          onPress={() => router.push({ pathname: '/camera', params: { kind: 'photo' } })}
          style={styles.footerButton}
        />
        <BigButton
          variant="outline"
          icon="videocam-outline"
          label={ko.easy.camera.videoMessage}
          onPress={() => router.push({ pathname: '/camera', params: { kind: 'video' } })}
          style={styles.footerButton}
        />
      </SafeAreaView>
    </SafeAreaView>
  );
}

/** 묶음 첫 장의 원본과 썸네일 경로 */
function firstPaths(p: FeedPost): string[] {
  const m = p.media[0];
  return m ? [m.thumbPath, m.type === 'photo' ? m.path : m.thumbPath] : [];
}

/** 큰 사진 소스: 사진은 원본(받는 동안 썸네일), 영상은 대표 프레임 */
function bigSource(p: FeedPost) {
  const m = p.media[0];
  if (!m) return { source: null, placeholder: null };
  return {
    source: signedSource(m.type === 'photo' ? m.path : m.thumbPath),
    placeholder: signedSource(m.thumbPath),
  };
}

function NewPostCard({ post, sender }: { post: FeedPost; sender: string }) {
  const { source, placeholder } = bigSource(post);
  const open = () => router.push({ pathname: '/play/[id]', params: { id: post.id } });
  const sub = [titleOf(post, sender), formatDay(post.createdAt)].filter(Boolean).join(' · ');
  return (
    <View style={styles.newCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={ko.easy.home.viewLabel(sender, post.media.length)}
        onPress={open}
        style={styles.heroWrap}
      >
        <Image
          source={source}
          placeholder={placeholder}
          style={styles.hero}
          contentFit="cover"
          transition={200}
          accessibilityIgnoresInvertColors
        />
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{ko.easy.home.newBadge(post.media.length)}</Text>
        </View>
      </Pressable>
      <View style={styles.senderRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{sender.slice(0, 1)}</Text>
        </View>
        <View style={styles.senderText}>
          <Text style={styles.senderName}>{ko.easy.home.sentBy(sender)}</Text>
          {sub ? <Text style={styles.senderSub}>{sub}</Text> : null}
        </View>
      </View>
      <BigButton icon="play" large label={ko.easy.home.view} onPress={open} />
    </View>
  );
}

function QuietSlides({ posts, nameOf }: { posts: FeedPost[]; nameOf: (p: FeedPost) => string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (posts.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % posts.length), SLIDE_MS);
    return () => clearInterval(t);
  }, [posts.length]);
  const post = posts[Math.min(i, posts.length - 1)];
  if (!post) return null;
  const { source, placeholder } = bigSource(post);
  const caption = [formatDay(post.createdAt), ko.easy.home.sentByShort(nameOf(post))].join(' · ');
  const title = titleOf(post, nameOf(post));
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={ko.easy.home.recentLabel(title ?? '', caption)}
        onPress={() => router.push({ pathname: '/play/[id]', params: { id: post.id } })}
        style={styles.quiet}
      >
        <Image
          source={source}
          placeholder={placeholder}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={600}
          accessibilityIgnoresInvertColors
        />
        <View style={styles.recentTag}>
          <Text style={styles.recentTagText}>{ko.easy.home.recent}</Text>
        </View>
        <View style={styles.caption}>
          {title ? <Text style={styles.captionTitle}>{title}</Text> : null}
          <Text style={styles.captionSub}>{caption}</Text>
          {posts.length > 1 ? (
            <View style={styles.dots}>
              {posts.map((p, k) => (
                <View key={p.id} style={[styles.dot, k <= i && styles.dotOn]} />
              ))}
            </View>
          ) : null}
        </View>
      </Pressable>
      <Text style={styles.quietHint}>{ko.easy.home.quietHint}</Text>
    </>
  );
}

function Welcome({ groupName, onDone }: { groupName: string; onDone: () => void }) {
  return (
    <SafeAreaView style={styles.full}>
      <View style={styles.check}>
        <Ionicons name="checkmark" size={56} color="#FFFFFF" />
      </View>
      <Text style={styles.fullTitle} accessibilityRole="header">
        {ko.easy.welcome.title(groupName)}
      </Text>
      <Text style={styles.fullText}>{ko.easy.welcome.text}</Text>
      <BigButton large label={ko.easy.welcome.go} onPress={onDone} style={styles.fullButton} />
    </SafeAreaView>
  );
}

function NotifyAsk({ onAllow, onLater }: { onAllow: () => void; onLater: () => void }) {
  return (
    <SafeAreaView style={styles.full}>
      <View style={styles.check}>
        <Ionicons name="notifications" size={48} color="#FFFFFF" />
      </View>
      <Text style={styles.fullTitle} accessibilityRole="header">
        {ko.easy.notifyAsk.title}
      </Text>
      <Text style={styles.fullText}>{ko.easy.notifyAsk.text}</Text>
      <View style={styles.fullButtons}>
        <BigButton large label={ko.easy.notifyAsk.allow} onPress={onAllow} />
        <BigButton variant="gray" label={ko.easy.notifyAsk.later} onPress={onLater} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: easyColors.background },
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: easySize.gutter,
    paddingTop: 12,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
    backgroundColor: easyColors.background,
  },
  footerButton: { flex: 1, paddingHorizontal: 8 },
  header: {
    paddingHorizontal: easySize.gutter,
    paddingTop: 8,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: easySize.title, fontWeight: '700', color: easyColors.text },
  moreButton: {
    minHeight: easySize.touchMin,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: easyColors.surface,
    justifyContent: 'center',
  },
  moreText: { fontSize: easySize.body, fontWeight: '600', color: easyColors.text },
  pressed: { opacity: 0.7 },
  body: { paddingHorizontal: easySize.gutter, paddingBottom: 32, gap: 14 },

  message: { paddingVertical: 64, alignItems: 'stretch', gap: 20 },
  messageText: { fontSize: easySize.bodyLarge, lineHeight: 30, color: easyColors.text, textAlign: 'center' },
  emptyCard: {
    height: 300,
    borderRadius: 20,
    backgroundColor: easyColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyText: { fontSize: easySize.bodyLarge, lineHeight: 30, color: easyColors.text, textAlign: 'center' },

  newCard: { gap: 12, borderWidth: 2, borderColor: easyColors.border, borderRadius: 20, padding: 12 },
  heroWrap: { height: 260, borderRadius: 14, overflow: 'hidden', backgroundColor: easyColors.placeholder },
  hero: { flex: 1 },
  badge: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: easyColors.accent,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  badgeText: { fontSize: easySize.body, fontWeight: '700', color: '#FFFFFF' },
  senderRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: easyColors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 20, fontWeight: '700', color: '#FFFFFF' },
  senderText: { flex: 1, gap: 2 },
  senderName: { fontSize: 21, fontWeight: '700', color: easyColors.text },
  senderSub: { fontSize: easySize.body, color: easyColors.textSecondary },

  quiet: { height: 420, borderRadius: 20, overflow: 'hidden', backgroundColor: easyColors.placeholder },
  recentTag: {
    position: 'absolute',
    top: 14,
    left: 14,
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  recentTagText: { fontSize: easySize.body, fontWeight: '700', color: '#FFFFFF' },
  caption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  captionTitle: { fontSize: 21, fontWeight: '700', color: '#FFFFFF' },
  captionSub: { fontSize: easySize.body, color: '#FFFFFF' },
  dots: { flexDirection: 'row', gap: 6, marginTop: 6 },
  dot: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotOn: { backgroundColor: '#FFFFFF' },
  quietHint: { fontSize: easySize.body, lineHeight: 26, color: easyColors.textSecondary, textAlign: 'center' },

  sectionRow: { marginTop: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: 21, fontWeight: '700', color: easyColors.text },
  allButton: { minHeight: easySize.touchMin, flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: 8 },
  allText: { fontSize: easySize.body, color: easyColors.text },
  monthGrid: { flexDirection: 'row', gap: 10 },
  monthCard: { flex: 1, gap: 4 },
  monthThumb: { height: 120, borderRadius: 14, backgroundColor: easyColors.placeholder },
  monthLabel: { fontSize: 19, fontWeight: '700', color: easyColors.text },
  monthCount: { fontSize: easySize.body, color: easyColors.textSecondary },

  full: { flex: 1, backgroundColor: easyColors.background, paddingHorizontal: 20, paddingTop: 72, paddingBottom: 24, gap: 20 },
  check: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: easyColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullTitle: { fontSize: easySize.display, lineHeight: 40, fontWeight: '700', color: easyColors.text },
  fullText: { fontSize: easySize.bodyLarge, lineHeight: 31, color: easyColors.textSecondary },
  fullButton: { marginTop: 'auto' },
  fullButtons: { marginTop: 'auto', gap: 12 },
});
