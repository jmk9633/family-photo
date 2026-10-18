import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, useCameraPermissions, useMicrophonePermissions, type CameraType } from 'expo-camera';
import { Image } from 'expo-image';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BigButton } from '@/components/easy/BigButton';
import { HomeButton } from '@/components/easy/HomeButton';
import { easyColors, easySize } from '@/components/easy/tokens';
import { ko } from '@/copy/ko';
import { useSession } from '@/features/auth/session';
import { listMyGroups } from '@/features/groups/api';
import { saveToOutbox } from '@/features/posts/outbox';
import { newSendJob, runSendJob, type PickedMedia } from '@/features/posts/send';
import { isPermanent, SendError } from '@/features/posts/sendErrors';

// 쉬운 화면 사진 찍어 보내기(kind=photo, F-BBQGEJ)와 영상 한마디(kind=video, F-TFIFCO). 6-2 결정 1~8.
//   찍기(사진은 뒤 카메라, 영상은 앞 카메라 + '녹화 시작'을 눌러야 시작, 남은 시간 큰 숫자, 1분이면 저절로 멈춤)
//   → 확인(사진 크게 / 영상 바로 재생, '다시 찍기'·'보내기') → 보내는 중 → 보냈어요(3초 뒤 처음으로)
// 받는 그룹은 속한 모든 가족. 자동 재시도(3번)까지 실패하면 폰에 보관하고 '나중에 다시 보낼게요'.
// 마이크를 허용하지 않으면 소리 없이 찍는다고 알려 주고 설정으로 보낸다.

const MAX_SEC = 60;
const SENT_AUTO_HOME_MS = 3000;
const KEEP_AWAKE_TAG = 'easy-camera';

type Phase = 'camera' | 'recording' | 'review' | 'sending' | 'sent' | 'saved' | 'failed';

export default function EasyCamera() {
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  const isVideo = kind === 'video';
  const { session } = useSession();
  const me = session?.user.id ?? '';

  const [camPerm, requestCam] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();
  const cameraRef = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [facing, setFacing] = useState<CameraType>(isVideo ? 'front' : 'back');
  const [phase, setPhase] = useState<Phase>('camera');
  const [captured, setCaptured] = useState<PickedMedia | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef(0);

  // 권한: 처음이면 바로 묻는다 (거절했으면 아래에서 설정으로 안내)
  useEffect(() => {
    if (camPerm && !camPerm.granted && camPerm.canAskAgain) requestCam();
  }, [camPerm, requestCam]);
  useEffect(() => {
    if (isVideo && camPerm?.granted && micPerm && !micPerm.granted && micPerm.canAskAgain) requestMic();
  }, [isVideo, camPerm, micPerm, requestMic]);

  // 찍고 보내는 동안 화면이 꺼지지 않게
  useEffect(() => {
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
      cameraRef.current?.stopRecording();
    };
  }, []);

  // 녹화 중 남은 시간
  useEffect(() => {
    if (phase !== 'recording') return;
    const t = setInterval(() => setElapsed((Date.now() - startedAt.current) / 1000), 250);
    return () => clearInterval(t);
  }, [phase]);

  // 보냈어요 → 3초 뒤 처음으로
  useEffect(() => {
    if (phase !== 'sent' && phase !== 'saved') return;
    const t = setTimeout(() => router.dismissTo('/home'), SENT_AUTO_HOME_MS);
    return () => clearTimeout(t);
  }, [phase]);

  const micOff = isVideo && !!micPerm && !micPerm.granted;

  async function takePhoto() {
    if (!cameraRef.current || !ready) return;
    setError(null);
    try {
      const pic = await cameraRef.current.takePictureAsync({ quality: 1 });
      setCaptured({
        type: 'photo',
        uri: pic.uri,
        width: pic.width,
        height: pic.height,
        takenAt: new Date().toISOString(),
        durationSec: null,
      });
      setPhase('review');
    } catch (e) {
      if (__DEV__) console.warn('[take photo failed]', e);
      setError(ko.easy.camera.captureFailed);
    }
  }

  async function startRecording() {
    if (!cameraRef.current || !ready) return;
    setError(null);
    startedAt.current = Date.now();
    setElapsed(0);
    setPhase('recording');
    try {
      const result = await cameraRef.current.recordAsync({ maxDuration: MAX_SEC });
      const sec = Math.min(MAX_SEC, Math.max(1, Math.round((Date.now() - startedAt.current) / 100) / 10));
      if (!result?.uri) throw new Error('no_video');
      setCaptured({
        type: 'video',
        uri: result.uri,
        width: 0,
        height: 0,
        takenAt: new Date(startedAt.current).toISOString(),
        durationSec: sec,
      });
      setPhase('review');
    } catch (e) {
      if (__DEV__) console.warn('[record failed]', e);
      setError(ko.easy.camera.captureFailed);
      setPhase('camera');
    }
  }

  async function send() {
    if (!captured || !me) return;
    setPhase('sending');
    let job: ReturnType<typeof newSendJob> | null = null;
    try {
      const groups = await listMyGroups(me);
      if (groups.length === 0) throw new SendError('forbidden', null, new Error('no_groups'));
      job = newSendJob({
        userId: me,
        items: [captured],
        title: null,
        tags: [],
        groupIds: groups.map((g) => g.id),
        kind: isVideo ? 'video_message' : 'normal',
      });
      await runSendJob(job, () => {});
      setPhase('sent');
    } catch (e) {
      if (__DEV__) console.warn('[easy send failed]', e);
      const permanent = e instanceof SendError && isPermanent(e.kind);
      if (!permanent && job) {
        // 인터넷 문제 등: 폰에 보관해 두고 앱을 열 때 다시 보낸다
        try {
          await saveToOutbox(me, {
            postId: job.postId,
            mediaId: job.mediaIds[0],
            kind: isVideo ? 'video_message' : 'normal',
            item: captured,
            groupIds: job.groupIds,
          });
          setPhase('saved');
          return;
        } catch (err) {
          if (__DEV__) console.warn('[outbox save failed]', err);
        }
      }
      setPhase('failed');
    }
  }

  function retake() {
    setCaptured(null);
    setError(null);
    setPhase('camera');
  }

  // ── 보냈어요 / 나중에 보낼게요 / 보내지 못했어요 ─────────────
  if (phase === 'sent' || phase === 'saved' || phase === 'failed') {
    const c = ko.easy.camera;
    return (
      <SafeAreaView style={styles.light}>
        <StatusBar style="dark" />
        <View style={[styles.check, phase !== 'sent' && styles.checkMuted]}>
          <Ionicons name={phase === 'sent' ? 'checkmark' : phase === 'saved' ? 'time-outline' : 'alert'} size={52} color="#FFFFFF" />
        </View>
        <Text style={styles.lightTitle} accessibilityRole="header" accessibilityLiveRegion="polite">
          {phase === 'sent' ? c.sent : phase === 'saved' ? c.saved : c.failed}
        </Text>
        <Text style={styles.lightText}>
          {phase === 'sent' ? c.sentText : phase === 'saved' ? c.savedText : c.failedText}
        </Text>
        <View style={styles.lightButtons}>
          {phase === 'failed' ? <BigButton variant="outline" label={c.retake} onPress={retake} /> : null}
          <BigButton large label={ko.easy.home.goHome} onPress={() => router.dismissTo('/home')} />
        </View>
      </SafeAreaView>
    );
  }

  // ── 카메라 권한 ─────────────────────────────────────────────
  if (!camPerm) {
    return (
      <SafeAreaView style={styles.dark}>
        <ActivityIndicator size="large" color={easyColors.darkText} style={styles.flex} />
      </SafeAreaView>
    );
  }
  if (!camPerm.granted) {
    return (
      <SafeAreaView style={styles.dark}>
        <StatusBar style="light" />
        <HomeButton dark />
        <View style={styles.center}>
          <Text style={styles.centerText}>{ko.easy.camera.cameraNeeded}</Text>
          {camPerm.canAskAgain ? (
            <BigButton label={ko.easy.camera.allowCamera} onPress={requestCam} />
          ) : (
            <BigButton label={ko.easy.camera.openSettings} onPress={() => Linking.openSettings()} />
          )}
        </View>
      </SafeAreaView>
    );
  }

  // ── 확인 ────────────────────────────────────────────────────
  if ((phase === 'review' || phase === 'sending') && captured) {
    return (
      <SafeAreaView style={styles.dark}>
        <StatusBar style="light" />
        <HomeButton dark />
        <View style={styles.stage}>
          {captured.type === 'video' ? (
            <ReviewVideo uri={captured.uri} />
          ) : (
            <Image source={{ uri: captured.uri }} style={styles.flex} contentFit="contain" />
          )}
        </View>
        {phase === 'sending' ? (
          <View style={styles.sending} accessibilityLiveRegion="polite">
            <ActivityIndicator size="large" color={easyColors.darkText} />
            <Text style={styles.reviewTitle}>{ko.easy.camera.sending}</Text>
          </View>
        ) : (
          <>
            <Text style={styles.reviewTitle}>{ko.easy.camera.confirm}</Text>
            <Text style={styles.reviewHint}>{ko.easy.camera.toAll}</Text>
            <View style={styles.row}>
              <BigButton variant="dark" large label={ko.easy.camera.retake} onPress={retake} style={styles.flex} />
              <BigButton large icon="send" label={ko.easy.camera.send} onPress={send} style={styles.flex} />
            </View>
          </>
        )}
      </SafeAreaView>
    );
  }

  // ── 찍기 / 녹화 중 ──────────────────────────────────────────
  const recording = phase === 'recording';
  const remaining = Math.max(0, MAX_SEC - Math.floor(elapsed));
  return (
    <SafeAreaView style={styles.dark}>
      <StatusBar style="light" />
      <View style={styles.top}>
        {recording ? (
          <View style={styles.recBadge}>
            <View style={styles.recDot} />
            <Text style={styles.recText}>{ko.easy.camera.recording}</Text>
          </View>
        ) : (
          <HomeButton dark />
        )}
        {!recording ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={ko.easy.camera.flipLabel}
            onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
            style={({ pressed }) => [styles.flip, pressed && styles.pressed]}
          >
            <Ionicons name="camera-reverse-outline" size={26} color="#FFFFFF" />
            <Text style={styles.flipText}>{ko.easy.camera.flip}</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.stage}>
        <CameraView
          ref={cameraRef}
          style={styles.flex}
          facing={facing}
          mode={isVideo ? 'video' : 'picture'}
          mute={micOff}
          onCameraReady={() => setReady(true)}
        />
        {recording ? (
          <View style={styles.countdown} pointerEvents="none" accessibilityLiveRegion="polite">
            <Text style={styles.countdownNumber} accessibilityLabel={ko.easy.camera.remainingLabel(remaining)}>
              {remaining}
            </Text>
            <Text style={styles.countdownText}>{ko.easy.camera.remaining}</Text>
          </View>
        ) : null}
      </View>

      {micOff ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{ko.easy.camera.micOff}</Text>
          <BigButton variant="dark" label={ko.easy.camera.openMicSettings} onPress={() => Linking.openSettings()} />
        </View>
      ) : (
        <Text style={styles.hint}>
          {error ?? (isVideo ? (recording ? ko.easy.camera.autoStop : ko.easy.camera.videoHint) : ko.easy.camera.photoHint)}
        </Text>
      )}

      {isVideo ? (
        recording ? (
          <BigButton
            variant="dark"
            large
            icon="stop"
            label={ko.easy.camera.stop}
            onPress={() => cameraRef.current?.stopRecording()}
          />
        ) : (
          <BigButton large icon="videocam" label={ko.easy.camera.record} onPress={startRecording} disabled={!ready} />
        )
      ) : (
        <BigButton large icon="camera" label={ko.easy.camera.shoot} onPress={takePhoto} disabled={!ready} />
      )}
    </SafeAreaView>
  );
}

function ReviewVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer({ uri }, (p) => {
    p.loop = true;
    p.play();
  });
  return <VideoView player={player} style={styles.flex} contentFit="contain" nativeControls />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dark: {
    flex: 1,
    backgroundColor: easyColors.dark,
    paddingHorizontal: easySize.gutter,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 14,
  },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  flip: {
    minHeight: 56,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: easyColors.darkText,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  flipText: { fontSize: 19, fontWeight: '700', color: easyColors.darkText },
  pressed: { opacity: 0.7 },
  recBadge: {
    minHeight: 56,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: easyColors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#FFFFFF' },
  recText: { fontSize: 19, fontWeight: '700', color: '#FFFFFF' },
  stage: { flex: 1, borderRadius: 16, overflow: 'hidden', backgroundColor: easyColors.darkSurface },
  countdown: { position: 'absolute', top: 16, left: 0, right: 0, alignItems: 'center' },
  countdownNumber: {
    fontSize: 64,
    fontWeight: '700',
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 8,
  },
  countdownText: {
    fontSize: easySize.body,
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 6,
  },
  hint: { minHeight: 26, fontSize: easySize.body, lineHeight: 26, color: easyColors.darkTextSecondary, textAlign: 'center' },
  notice: { gap: 10 },
  noticeText: { fontSize: easySize.body, lineHeight: 26, color: easyColors.darkText, textAlign: 'center' },
  center: { flex: 1, justifyContent: 'center', gap: 20 },
  centerText: { fontSize: easySize.bodyLarge, lineHeight: 30, color: easyColors.darkText, textAlign: 'center' },
  reviewTitle: { fontSize: 21, fontWeight: '700', color: easyColors.darkText, textAlign: 'center' },
  reviewHint: { fontSize: easySize.body, color: easyColors.darkTextSecondary, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 10 },
  sending: { alignItems: 'center', gap: 12, paddingVertical: 20 },
  light: {
    flex: 1,
    backgroundColor: easyColors.background,
    paddingHorizontal: 20,
    paddingTop: 72,
    paddingBottom: 24,
    gap: 20,
  },
  check: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: easyColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMuted: { backgroundColor: easyColors.textSecondary },
  lightTitle: { fontSize: easySize.display, lineHeight: 40, fontWeight: '700', color: easyColors.text },
  lightText: { fontSize: easySize.bodyLarge, lineHeight: 31, color: easyColors.textSecondary },
  lightButtons: { marginTop: 'auto', gap: 12 },
});
