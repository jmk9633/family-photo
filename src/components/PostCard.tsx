import { StyleSheet, Text, View } from 'react-native';

import { ko } from '@/copy/ko';
import type { FeedPost } from '@/features/posts/feed';
import { formatDay } from '@/features/posts/format';

import { Avatar } from './Avatar';
import { PostGrid } from './PostGrid';
import { colors, size } from './tokens';

// 타임라인의 묶음 하나 (와이어프레임 Home): 보낸 사람 · 날짜 · 받은 그룹 / 제목 · 태그 / 사진 격자.
// '봤어요'와 하트 줄은 5단계에서 이 아래에 붙는다.

type Props = {
  post: FeedPost;
  sender: string | null;
  groupNames: string[] | null; // '모든 가족' 보기에서만 받은 그룹을 함께 보여준다
  onOpen: (index: number) => void;
};

export function PostCard({ post, sender, groupNames, onOpen }: Props) {
  const name = sender ?? ko.feed.unknownSender;
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
      {post.title || post.tags.length > 0 ? (
        <View style={styles.titleRow}>
          {post.title ? <Text style={styles.title}>{post.title}</Text> : null}
          {post.tags.map((t) => (
            <Text key={t} style={styles.tag}>
              #{t}
            </Text>
          ))}
        </View>
      ) : null}
      <PostGrid media={post.media} onOpen={onOpen} />
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
