import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { CheckRow } from '@/components/CheckRow';
import { colors, size } from '@/components/tokens';
import { ko } from '@/copy/ko';
import { signOut, useSession } from '@/features/auth/session';
import { getShowSeen, setShowSeen } from '@/features/posts/views';
import { getPushStatus, requestPush, unregisterPush, type PushStatus } from '@/features/push/push';

// 내 정보 탭.
// - 내 '봤어요'를 가족에게 보여줄지 (F-BLIYTI, 기본 켜짐). 꺼도 안부 확인용 활동 기록은 남는다.
// - 알림: 켜져 있으면 안내만, 아직 안 물었으면 '알림 받기', 거절했으면 아이폰 설정으로 보낸다
//   (앱에서 다시 물을 수 없다). 설정에서 돌아오면 다시 확인한다.
// - 로그아웃 (그 전에 이 폰의 푸시 토큰을 끊는다)
// 쉬운 화면 전환·계정(6단계) 같은 설정이 해당 단계에서 여기에 생긴다.

export default function MeTab() {
  const { session } = useSession();
  const me = session?.user.id ?? '';
  const [signingOut, setSigningOut] = useState(false);
  const [showSeen, setShowSeenState] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const [push, setPush] = useState<PushStatus | null>(null);

  useFocusEffect(
    useCallback(() => {
      getPushStatus()
        .then(setPush)
        .catch(() => setPush(null));
    }, []),
  );

  useEffect(() => {
    if (!me) return;
    getShowSeen(me)
      .then(setShowSeenState)
      .catch((e) => {
        if (__DEV__) console.warn('[show_seen load failed]', e);
        setShowSeenState(true); // 기본값으로 보여주고, 바꿀 때 실패하면 알린다
      });
  }, [me]);

  async function toggleShowSeen() {
    if (showSeen === null || !me) return;
    const on = !showSeen;
    setShowSeenState(on);
    setFailed(false);
    try {
      await setShowSeen(me, on);
    } catch (e) {
      if (__DEV__) console.warn('[show_seen save failed]', e);
      setShowSeenState(!on);
      setFailed(true);
    }
  }

  return (
    <SafeAreaView edges={['top']} style={styles.container}>
      <View style={styles.body}>
        <Text style={styles.title} accessibilityRole="header">
          {ko.me.title}
        </Text>
        {push ? (
          <View style={styles.section}>
            <Text style={styles.label}>{ko.me.pushLabel}</Text>
            <Text style={styles.hint}>{push === 'granted' ? ko.me.pushOn : ko.me.pushOff}</Text>
            {push === 'undetermined' ? (
              <Button
                variant="outline"
                label={ko.me.pushTurnOn}
                onPress={async () => {
                  if (me) setPush(await requestPush(me));
                }}
              />
            ) : push === 'denied' ? (
              <Button variant="outline" label={ko.me.pushOpenSettings} onPress={() => Linking.openSettings()} />
            ) : null}
          </View>
        ) : null}
        {showSeen !== null ? (
          <View style={styles.section}>
            <CheckRow label={ko.me.showSeen} hint={ko.me.showSeenHint} checked={showSeen} onToggle={toggleShowSeen} />
            {failed ? (
              <Text style={styles.error} accessibilityLiveRegion="polite">
                {ko.me.showSeenFailed}
              </Text>
            ) : null}
          </View>
        ) : null}
        <Button
          variant="outline"
          label={ko.me.signOut}
          loading={signingOut}
          onPress={async () => {
            setSigningOut(true);
            if (me) await unregisterPush(me);
            await signOut();
          }}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  body: { paddingHorizontal: size.gutter, paddingTop: 12, gap: 16 },
  title: { fontSize: size.title, lineHeight: 38, fontWeight: '700', color: colors.text },
  section: { gap: 6 },
  label: { fontSize: size.body, fontWeight: '600', color: colors.text },
  hint: { fontSize: size.small, lineHeight: 22, color: colors.textSecondary },
  error: { fontSize: size.small, color: colors.error },
});
