import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ko } from '@/copy/ko';
import type { FeedMedia } from '@/features/posts/feed';
import { formatDuration } from '@/features/posts/format';
import { signedSource } from '@/lib/signedUrl';

import { colors } from './tokens';

// 묶음 사진 격자 (F-FRFNRL 표시 규칙): 최대 6칸, 넘치면 6번째 칸에 '+N', 영상은 길이 표시.
// 1장 = 한 칸 크게, 2·4장 = 2열, 그 밖 = 3열.
export const GRID_MAX = 6;
const GAP = 3;

export function gridCells(count: number) {
  const shown = Math.min(count, GRID_MAX);
  const columns = count === 1 ? 1 : count === 2 || count === 4 ? 2 : 3;
  const more = count > GRID_MAX ? count - (GRID_MAX - 1) : 0;
  return { shown, columns, more };
}

type Props = { media: FeedMedia[]; onOpen: (index: number) => void };

export function PostGrid({ media, onOpen }: Props) {
  const { shown, columns, more } = gridCells(media.length);
  const cells = media.slice(0, shown);
  const rows: FeedMedia[][] = [];
  for (let i = 0; i < cells.length; i += columns) rows.push(cells.slice(i, i + columns));

  const single = media.length === 1 ? media[0] : null;
  // 한 장일 때는 사진 비율을 살리되 너무 길거나 납작하지 않게
  const singleRatio = single?.width && single?.height ? Math.min(Math.max(single.width / single.height, 0.8), 1.6) : 4 / 3;

  return (
    <View style={styles.grid}>
      {rows.map((row, r) => (
        <View key={r} style={styles.row}>
          {row.map((m, c) => {
            const index = r * columns + c;
            const isMore = more > 0 && index === GRID_MAX - 1;
            return (
              <Pressable
                key={m.id}
                accessibilityRole="imagebutton"
                accessibilityLabel={
                  isMore
                    ? ko.feed.moreLabel(more)
                    : m.type === 'video'
                      ? ko.feed.videoLabel(index + 1, formatDuration(m.durationSec))
                      : ko.feed.photoLabel(index + 1)
                }
                onPress={() => onOpen(index)}
                style={({ pressed }) => [
                  styles.cell,
                  { aspectRatio: single ? singleRatio : 1 },
                  pressed && styles.pressed,
                ]}
              >
                <Image
                  source={signedSource(m.thumbPath)}
                  recyclingKey={m.thumbPath}
                  contentFit="cover"
                  transition={120}
                  style={StyleSheet.absoluteFill}
                />
                {m.type === 'video' && !isMore ? (
                  <Text style={styles.duration}>{formatDuration(m.durationSec)}</Text>
                ) : null}
                {isMore ? (
                  <View style={styles.moreCover}>
                    <Text style={styles.moreText}>{ko.feed.more(more)}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
          {/* 마지막 줄이 덜 찼을 때 칸 크기를 맞춘다 */}
          {Array.from({ length: columns - row.length }, (_, i) => (
            <View key={`pad-${i}`} style={styles.pad} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { gap: GAP, borderRadius: 8, overflow: 'hidden' },
  row: { flexDirection: 'row', gap: GAP },
  cell: { flex: 1, backgroundColor: colors.surface, overflow: 'hidden' },
  pad: { flex: 1 },
  pressed: { opacity: 0.85 },
  duration: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.62)',
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  moreCover: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreText: { color: '#FFFFFF', fontSize: 20, fontWeight: '700' },
});
