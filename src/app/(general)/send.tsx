import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { CheckRow } from '@/components/CheckRow';
import { TextField } from '@/components/TextField';
import { colors, size } from '@/components/tokens';
import { ko } from '@/copy/ko';
import { useSession } from '@/features/auth/session';
import { listGroupChoices, listRecentTags, type GroupChoice } from '@/features/posts/api';
import {
  MAX_PER_POST,
  describeError,
  newSendJob,
  runSendJob,
  takenAtFromExif,
  TITLE_MAX,
  type PickedMedia,
  type SendJob,
} from '@/features/posts/send';
import { formatDuration } from '@/features/posts/format';
import { isVideoTooLong } from '@/lib/video';

// 묶음으로 보내기 (F-AXZNWA) — 와이어프레임 'Send' 화면.
// 사진 고르기 → 태그(선택) → 보낼 그룹(기본: 전부) → 한 줄 제목(선택) → 'N개 그룹에 보내기'.
// 영상: 시스템 사진 고르기는 길이로 거를 수 없어서, 고르기 버튼 아래에 '1분까지'를 늘 보여주고
// 1분 넘는 영상은 고른 뒤 빼고 알린다 (10/15 결정). 압축·위치 검사는 lib/video.ts.
//
// params
//   group: 이 그룹만 골라 둔 채로 연다 (그룹 화면, 그룹 만들기 직후)
//   first=1: 그룹을 막 만든 직후 '첫 사진 미리 보내기' (F-PWMFRH). 건너뛰면 초대 화면으로.

const TAG_MAX = 20;
const GRID_COLUMNS = 4;
const GRID_GAP = 4;

type Picked = PickedMedia & { key: string };
type Phase = 'compose' | 'sending' | 'failed' | 'done';

export default function SendScreen() {
  const { group, first } = useLocalSearchParams<{ group?: string; first?: string }>();
  const isFirst = first === '1';
  const { session } = useSession();
  const userId = session?.user.id ?? '';

  const [photos, setPhotos] = useState<Picked[]>([]);
  const [pickError, setPickError] = useState<string | null>(null);
  const [pickNotice, setPickNotice] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [gridWidth, setGridWidth] = useState(0);
  const cellSize = gridWidth > 0 ? Math.floor((gridWidth - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS) : 0;
  const cellBox = { width: cellSize, height: cellSize };
  const [groups, setGroups] = useState<GroupChoice[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [suggested, setSuggested] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [addingTag, setAddingTag] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [title, setTitle] = useState('');

  const [phase, setPhase] = useState<Phase>('compose');
  const [done, setDone] = useState(0);
  const [compressing, setCompressing] = useState<number | null>(null);
  const [devDetail, setDevDetail] = useState<string | null>(null);
  const job = useRef<SendJob | null>(null);

  function loadGroups() {
    setLoadFailed(false);
    listGroupChoices(userId)
      .then((list) => {
        setGroups(list);
        const preset = group && list.some((g) => g.id === group) ? [group] : list.map((g) => g.id);
        setSelectedGroups(preset);
        listRecentTags(list.map((g) => g.id))
          .then(setSuggested)
          .catch(() => {}); // 추천은 없어도 보내기는 된다
      })
      .catch(() => setLoadFailed(true));
  }

  useEffect(loadGroups, [userId, group]);

  async function pick() {
    setPickError(null);
    setPickNotice(null);
    const room = MAX_PER_POST - photos.length;
    if (room <= 0) return;
    // 고르기 창이 닫힌 뒤 파일을 받는 동안(iCloud에만 있는 영상은 내려받기까지) '불러오는 중'을 보여준다
    setPicking(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: true,
        selectionLimit: room,
        orderedSelection: true,
        exif: true, // 촬영 시각만 읽는다 (takenAtFromExif). 위치 값은 쓰지 않는다.
        // 'current' + quality 1: 원본 파일을 그대로 복사해서 받는다 (가장 빠름).
        // 'compatible'로 두면 iOS가 고르는 순간 HEVC 영상을 H.264로, HEIC 사진을 JPEG로 바꿔서
        // 영상 하나에 수십 초씩 걸렸다 (10/15 아이폰에서 확인). 어차피 사진은 lib/image.ts가 JPEG 2048px로,
        // 영상은 lib/video.ts가 H.264 720p로 다시 만들므로 고를 때 바꿀 필요가 없다.
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
        quality: 1,
      });
      if (result.canceled) return;
      const durationOf = (ms: number | null | undefined) => (typeof ms === 'number' ? ms / 1000 : null);
      const tooLong = result.assets.filter((a) => a.type === 'video' && isVideoTooLong(durationOf(a.duration)));
      if (tooLong.length > 0) setPickNotice(ko.send.videoTooLong(tooLong.length));
      setPhotos((cur) => {
        const seen = new Set(cur.map((p) => p.key));
        const added: Picked[] = [];
        for (const a of result.assets) {
          if (tooLong.includes(a)) continue;
          const key = a.assetId ?? a.uri;
          if (seen.has(key)) continue;
          seen.add(key);
          const isVideo = a.type === 'video';
          added.push({
            key,
            type: isVideo ? 'video' : 'photo',
            uri: a.uri,
            width: a.width,
            height: a.height,
            takenAt: isVideo ? null : takenAtFromExif(a.exif),
            durationSec: isVideo ? durationOf(a.duration) : null,
          });
        }
        return [...cur, ...added].slice(0, MAX_PER_POST);
      });
    } catch {
      setPickError(ko.send.pickFailed);
    } finally {
      setPicking(false);
    }
  }

  function toggleTag(tag: string) {
    setTags((cur) => (cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag]));
  }

  function addTag() {
    const tag = tagDraft.trim().replace(/^#+/, '').trim().slice(0, TAG_MAX);
    if (tag) {
      setTags((cur) => (cur.includes(tag) ? cur : [...cur, tag]));
      setSuggested((cur) => (cur.includes(tag) ? cur : [tag, ...cur]));
    }
    setTagDraft('');
    setAddingTag(false);
  }

  function toggleGroup(id: string) {
    setSelectedGroups((cur) => (cur.includes(id) ? cur.filter((g) => g !== id) : [...cur, id]));
  }

  async function send() {
    if (!job.current) {
      job.current = newSendJob({
        userId,
        items: photos.map(({ type, uri, width, height, takenAt, durationSec }) => ({
          type,
          uri,
          width,
          height,
          takenAt,
          durationSec,
        })),
        title: title.trim() || null,
        tags,
        groupIds: selectedGroups,
      });
    }
    setPhase('sending');
    setDevDetail(null);
    try {
      await runSendJob(job.current, (p) => {
        setDone(p.done);
        setCompressing(p.compressing);
      });
      setPhase('done');
    } catch (e) {
      // 개발 중에는 원인을 터미널과 화면에 함께 보여준다 (출시 빌드에서는 안 보임).
      if (__DEV__) {
        const detail = describeError(e);
        console.warn('[send failed]', detail);
        setDevDetail(detail);
      }
      setPhase('failed');
    }
  }

  function goToInvite() {
    if (group) router.replace({ pathname: '/group/[id]/invite', params: { id: group, first: '1' } });
    else router.back();
  }

  const canSend = photos.length > 0 && selectedGroups.length > 0;
  const sentGroupNames = (groups ?? [])
    .filter((g) => job.current?.groupIds.includes(g.id))
    .map((g) => g.name)
    .join(', ');

  const busy = phase === 'sending';
  const header = (
    <Stack.Screen
      options={{
        headerTitle: isFirst ? '' : ko.send.title,
        gestureEnabled: !busy && !isFirst,
        headerBackVisible: !busy && !isFirst,
        headerRight: () =>
          isFirst && phase === 'compose' ? (
            <Button variant="text" label={ko.send.skip} onPress={goToInvite} />
          ) : null,
      }}
    />
  );

  // ── 보내는 중 · 실패 · 완료 ────────────────────────────────
  if (phase !== 'compose') {
    const total = job.current?.items.length ?? photos.length;
    return (
      <SafeAreaView style={[styles.container, styles.center]} edges={['bottom']}>
        {header}
        {phase === 'sending' ? (
          <View style={styles.status} accessibilityLiveRegion="polite">
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={styles.statusTitle}>
              {compressing !== null ? ko.send.compressing : ko.send.sending}
            </Text>
            <Text style={styles.statusText}>
              {compressing !== null
                ? ko.send.compressingProgress(Math.round(compressing * 100))
                : ko.send.progress(done, total)}
            </Text>
            <View style={styles.bar}>
              <View style={[styles.barFill, { width: `${(done / Math.max(total, 1)) * 100}%` }]} />
            </View>
            <Text style={styles.muted}>{ko.send.keepOpen}</Text>
          </View>
        ) : phase === 'failed' ? (
          <View style={styles.status} accessibilityLiveRegion="assertive">
            <Text style={styles.statusTitle}>{ko.send.failed}</Text>
            <Text style={[styles.statusText, styles.centerText]}>{ko.send.failedHint}</Text>
            <Text style={styles.muted}>{ko.send.progress(done, total)}</Text>
            {devDetail ? <Text style={styles.devDetail}>{devDetail}</Text> : null}
            <Button label={ko.send.retry} onPress={send} style={styles.wide} />
            <Button
              variant="text"
              label={ko.common.later}
              onPress={isFirst ? goToInvite : () => router.back()}
            />
          </View>
        ) : (
          <View style={styles.status} accessibilityLiveRegion="polite">
            <View style={styles.doneMark}>
              <Text style={styles.doneMarkText}>✓</Text>
            </View>
            <Text style={styles.statusTitle}>{ko.send.done}</Text>
            <Text style={[styles.statusText, styles.centerText]}>
              {ko.send.doneTo(sentGroupNames)}
            </Text>
            <Button
              label={isFirst ? ko.send.next : ko.send.ok}
              onPress={isFirst ? goToInvite : () => router.back()}
              style={styles.wide}
            />
          </View>
        )}
      </SafeAreaView>
    );
  }

  if (loadFailed) {
    return (
      <SafeAreaView style={[styles.container, styles.center]} edges={['bottom']}>
        {header}
        <Text style={styles.muted}>{ko.groupErrors.loadFailed}</Text>
        <Button variant="outline" label={ko.common.retry} onPress={loadGroups} />
      </SafeAreaView>
    );
  }

  if (groups === null) {
    return (
      <SafeAreaView style={[styles.container, styles.center]} edges={['bottom']}>
        {header}
        <ActivityIndicator color={colors.accent} accessibilityLabel={ko.common.loading} />
      </SafeAreaView>
    );
  }

  // ── 고르기·입력 ──────────────────────────────────────────
  const full = photos.length >= MAX_PER_POST;
  const suggestions = [...new Set([...tags, ...suggested])];

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {header}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {isFirst ? (
            <View style={styles.firstIntro}>
              <Text style={styles.title} accessibilityRole="header">
                {ko.send.firstTitle}
              </Text>
              <Text style={styles.statusText}>{ko.send.firstDescription}</Text>
            </View>
          ) : null}

          {/* 사진 */}
          <View style={styles.section}>
            {photos.length === 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={picking ? ko.send.picking : ko.send.pick}
                accessibilityState={{ busy: picking }}
                disabled={picking}
                onPress={pick}
                style={({ pressed }) => [styles.pickBig, pressed && styles.pressed]}
              >
                {picking ? (
                  <ActivityIndicator color={colors.accent} />
                ) : (
                  <Text style={styles.pickPlus}>+</Text>
                )}
                <Text style={styles.pickLabel}>{picking ? ko.send.picking : ko.send.pick}</Text>
              </Pressable>
            ) : (
              <>
                <View style={styles.grid} onLayout={(e) => setGridWidth(e.nativeEvent.layout.width)}>
                  {photos.map((p, i) => (
                    <View key={p.key} style={[styles.cell, cellBox]}>
                      {p.type === 'video' ? (
                        <View style={[styles.thumb, styles.videoThumb]}>
                          <Ionicons name="videocam" size={28} color="#FFFFFF" />
                          <Text style={styles.videoLength}>{formatDuration(p.durationSec)}</Text>
                        </View>
                      ) : (
                        <Image source={{ uri: p.uri }} style={styles.thumb} contentFit="cover" />
                      )}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={p.type === 'video' ? ko.send.removeVideo(i + 1) : ko.send.remove(i + 1)}
                        hitSlop={10}
                        onPress={() => setPhotos((cur) => cur.filter((x) => x.key !== p.key))}
                        style={styles.removeButton}
                      >
                        <Text style={styles.removeText}>✕</Text>
                      </Pressable>
                    </View>
                  ))}
                  {!full ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={picking ? ko.send.picking : ko.send.pickMore}
                      accessibilityState={{ busy: picking }}
                      disabled={picking}
                      onPress={pick}
                      style={({ pressed }) => [styles.cell, cellBox, styles.addCell, pressed && styles.pressed]}
                    >
                      {picking ? (
                        <ActivityIndicator color={colors.accent} />
                      ) : (
                        <Text style={styles.addPlus}>+</Text>
                      )}
                      <Text style={styles.addLabel}>{picking ? ko.send.picking : ko.send.pickMore}</Text>
                    </Pressable>
                  ) : null}
                </View>
                <Text style={styles.muted} accessibilityLiveRegion="polite">
                  {full ? ko.send.limit : ko.send.count(photos.length)}
                </Text>
              </>
            )}
            <Text style={styles.muted}>{ko.send.videoHint}</Text>
            {pickNotice ? (
              <Text style={styles.notice} accessibilityLiveRegion="polite">
                {pickNotice}
              </Text>
            ) : null}
            {pickError ? <Text style={styles.error}>{pickError}</Text> : null}
          </View>

          {/* 태그 */}
          <View style={styles.section}>
            <Text style={styles.label}>
              {ko.send.tagsLabel} <Text style={styles.optional}>{ko.send.optional}</Text>
            </Text>
            <View style={styles.chips}>
              {suggestions.map((t) => {
                const on = tags.includes(t);
                return (
                  <Pressable
                    key={t}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={t}
                    hitSlop={4}
                    onPress={() => toggleTag(t)}
                    style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.pressed]}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>#{t}</Text>
                  </Pressable>
                );
              })}
              {!addingTag ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={ko.send.newTagLabel}
                  hitSlop={4}
                  onPress={() => setAddingTag(true)}
                  style={({ pressed }) => [styles.chip, styles.chipNew, pressed && styles.pressed]}
                >
                  <Text style={styles.chipText}>{ko.send.newTag}</Text>
                </Pressable>
              ) : null}
            </View>
            {addingTag ? (
              <View style={styles.tagInput}>
                <View style={styles.flex}>
                  <TextField
                    label={ko.send.newTagLabel}
                    placeholder={ko.send.newTagPlaceholder}
                    value={tagDraft}
                    onChangeText={setTagDraft}
                    maxLength={TAG_MAX + 1}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={addTag}
                  />
                </View>
                <Button variant="outline" label={ko.send.addTag} onPress={addTag} style={styles.addTagButton} />
              </View>
            ) : (
              <Text style={styles.hint}>{ko.send.tagsHint}</Text>
            )}
          </View>

          {/* 보낼 그룹 */}
          <View style={styles.section}>
            <Text style={styles.label}>{ko.send.groupsLabel}</Text>
            {groups.map((g) => (
              <CheckRow
                key={g.id}
                label={g.name}
                hint={g.others.length > 0 ? g.others.join(', ') : ko.send.onlyMe}
                checked={selectedGroups.includes(g.id)}
                onToggle={() => toggleGroup(g.id)}
              />
            ))}
          </View>

          {/* 한 줄 제목 */}
          <TextField
            label={`${ko.send.titleLabel} ${ko.send.optional}`}
            placeholder={ko.send.titlePlaceholder}
            hint={ko.send.titleHint}
            value={title}
            onChangeText={setTitle}
            maxLength={TITLE_MAX}
            returnKeyType="done"
          />
        </ScrollView>

        <View style={styles.footer}>
          {photos.length > 0 && selectedGroups.length === 0 ? (
            <Text style={styles.footerHint}>{ko.send.chooseGroup}</Text>
          ) : null}
          <Button
            label={ko.send.submit(selectedGroups.length)}
            onPress={send}
            disabled={!canSend}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: size.gutter },
  center: { justifyContent: 'center', alignItems: 'center', gap: 16 },
  centerText: { textAlign: 'center' },
  body: { gap: 28, paddingTop: 8, paddingBottom: 24 },
  pressed: { opacity: 0.8 },
  title: { fontSize: size.title, lineHeight: 38, fontWeight: '700', color: colors.text },
  label: { fontSize: size.small, fontWeight: '700', color: colors.text },
  optional: { fontWeight: '400', color: colors.textSecondary },
  muted: { fontSize: size.small, lineHeight: 21, color: colors.textSecondary },
  hint: { fontSize: 13, lineHeight: 19, color: colors.textSecondary },
  error: { fontSize: size.small, color: colors.error },
  notice: { fontSize: size.small, lineHeight: 21, color: colors.text, fontWeight: '600' },
  section: { gap: 10 },
  firstIntro: { gap: 8 },

  pickBig: {
    height: 160,
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  pickPlus: { fontSize: 36, lineHeight: 40, color: colors.text },
  pickLabel: { fontSize: size.body, fontWeight: '700', color: colors.text },

  // 칸 크기는 onLayout으로 잰 폭에서 정확히 계산한다. '24%' + aspectRatio로 두면 줄이 바뀐 칸
  // ('더 고르기'가 혼자 둘째 줄로 갈 때) 높이가 늘림(stretch)에 밀려 찌그러졌다 (10/15 확인).
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP, alignItems: 'flex-start' },
  cell: { borderRadius: 8, overflow: 'hidden' },
  thumb: { width: '100%', height: '100%', backgroundColor: colors.surface },
  // 영상은 고르기 화면에서 미리보기 그림을 만들지 않는다 (만들려면 영상을 한 번 더 읽어야 해서). 아이콘과 길이만.
  videoThumb: { backgroundColor: '#3C4043', alignItems: 'center', justifyContent: 'center', gap: 4 },
  videoLength: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  removeButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  addCell: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPlus: { fontSize: 24, lineHeight: 28, color: colors.text },
  addLabel: { fontSize: 13, color: colors.text },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.text, borderColor: colors.text },
  chipNew: { borderStyle: 'dashed', borderColor: colors.textSecondary },
  chipText: { fontSize: size.small, color: colors.text },
  chipTextOn: { color: '#FFFFFF', fontWeight: '700' },
  tagInput: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  addTagButton: { paddingHorizontal: 20 },

  footer: { gap: 8, paddingTop: 8, paddingBottom: 16 },
  footerHint: { fontSize: size.small, color: colors.textSecondary, textAlign: 'center' },

  status: { alignItems: 'center', gap: 14, width: '100%' },
  statusTitle: { fontSize: 24, fontWeight: '700', color: colors.text },
  statusText: { fontSize: size.body, lineHeight: 25, color: colors.text },
  bar: { width: '100%', height: 8, borderRadius: 4, backgroundColor: colors.surface, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: colors.accent },
  wide: { alignSelf: 'stretch' },
  devDetail: { fontSize: 12, lineHeight: 17, color: colors.error, alignSelf: 'stretch' },
  doneMark: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneMarkText: { color: '#FFFFFF', fontSize: 36, fontWeight: '700' },
});
