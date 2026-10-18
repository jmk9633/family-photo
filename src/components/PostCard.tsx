import { StyleSheet, Text, View } from 'react-native';

import { ko } from '@/copy/ko';
import type { FeedPost } from '@/features/posts/feed';
import { formatDay, titleOf } from '@/features/posts/format';

import { Avatar } from './Avatar';
import { PostGrid } from './PostGrid';
import { colors, size } from './tokens';

// 타임라인의 묶음 하나 (와이어프레임 Home): 보낸 사람 · 날짜 · 받은 그룹 / 제목 · 태그 / 사진 격자.
// 내가 보낸 묶음이면 아래에 본 사람 얼굴을 겹쳐 보여주고 '봤어요' (F-BLIYTI). 숫자·시각은 보여주지 않는다.

type Props = {
  post: FeedPost;
  sender: string | null;
  groupNames: string[] | null; // '모든 가족' 보기에서만 받은 그룹을 함께 보여준다
  seenBy: string[] | null; // 내가 보낸 묶음을 본 사람 이름 (나 제외). 없으면 줄을 그리지 않는다
  onOpen: (index: number) => void;
};

// 얼굴은 이만큼만 겹쳐 그린다. 숫자('+3')는 보여주지 않는 규칙이라 넘치는 사람은 이름 읽기에만 들어간다.
const SEEN_FACES_MAX = 5;

export function PostCard({ post, sender, groupNames, seenBy, onOpen }: Props) {
  const name = sender ?? ko.feed.unknownSender;
  const title = titleOf(post, sender);
  const meta = [formatDay(post.createdAt), groupNames?.length ? groupNames.join(', ') : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.card}>
      <View style={styles.head} accessible accessibilityLabel={`${name}, ${meta}`}>
        <Avatar name={name} size={28} />
        <Text style={styles.sender} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      {title || post.tags.length > 0 ? (
        <View style={styles.titleRow}>
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {post.tags.map((t) => (
            <Text key={t} style={styles.tag}>
              #{t}
            </Text>
          ))}
        </View>
      ) : null}
      <PostGrid media={post.media} onOpen={onOpen} />
      {seenBy && seenBy.length > 0 ? (
        <View style={styles.seenRow} accessible accessibilityLabel={ko.feed.seenLabel(seenBy)}>
          <View style={styles.faces}>
            {seenBy.slice(0, SEEN_FACES_MAX).map((n, i) => (
              <View key={`${n}-${i}`} style={[styles.face, i > 0 && styles.faceOverlap, { zIndex: SEEN_FACES_MAX - i }]}>
                <Avatar name={n} size={26} />
              </View>
            ))}
          </View>
          <Text style={styles.seenText}>{ko.feed.seen}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 8,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sender: { fontSize: size.small, fontWeight: '700', color: colors.text, flexShrink: 0, maxWidth: '40%' },
  meta: { fontSize: 14, color: colors.textSecondary, flexShrink: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  title: { fontSize: size.body, color: colors.text, marginRight: 2 },
  seenRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 },
  faces: { flexDirection: 'row' },
  face: { borderRadius: 15, borderWidth: 2, borderColor: colors.background },
  faceOverlap: { marginLeft: -8 },
  seenText: { fontSize: size.small, color: colors.textSecondary },
  tag: {
    fontSize: 13,
    color: colors.text,
    backgroundColor: colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden',
  },
});
