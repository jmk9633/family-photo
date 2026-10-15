import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ko } from '@/copy/ko';
import { signedUrl } from '@/lib/signedUrl';

// 사진 상세에서 영상 한 장. 시스템 재생 버튼(nativeControls)을 쓰고, 다른 장으로 넘기면 멈춘다.
// 서명 URL로 받아 재생한다 (비공개 버킷).

type Props = { path: string; active: boolean };

export function VideoSlide({ path, active }: Props) {
  const url = signedUrl(path);
  const player = useVideoPlayer(url ? { uri: url } : null, (p) => {
    p.loop = false;
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status });

  useEffect(() => {
    if (!active) player.pause();
  }, [active, player]);

  if (!url || status === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>{ko.detail.videoFailed}</Text>
      </View>
    );
  }
  return <VideoView player={player} style={styles.video} contentFit="contain" nativeControls />;
}

const styles = StyleSheet.create({
  video: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  message: { color: '#FFFFFF', fontSize: 17, textAlign: 'center' },
});
