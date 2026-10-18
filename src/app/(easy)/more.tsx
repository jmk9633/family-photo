import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BigButton } from '@/components/easy/BigButton';
import { HomeButton } from '@/components/easy/HomeButton';
import { easyColors, easySize } from '@/components/easy/tokens';
import { ko } from '@/copy/ko';
import { useMode } from '@/features/auth/mode';
import { useSession } from '@/features/auth/session';
import { getShowSeen, setShowSeen } from '@/features/posts/views';
import { getPushStatus, requestPush, type PushStatus } from '@/features/push/push';
import { supabase } from '@/lib/supabase';

// 쉬운 화면 더보기 (와이어프레임 '쉬운 모드 · 더보기', 10/18 결정 12 — 6단계에서는 일부만).
//   알림 · 내가 본 사진을 가족에게 알리기 · 일반 화면으로 바꾸기(계정이 있는 사람만)
// 안부 확인은 7단계, TV 연결은 9단계, 보낼 가족 정하기·관리자 메뉴는 MVP 이후에 더한다.

export default function EasyMore() {
  const { session } = useSession();
  const me = session?.user.id ?? '';
  const { isAnonymous, refreshMode } = useMode();
  const [push, setPush] = useState<PushStatus | null>(null);
  const [showSeen, setShowSeenState] = useState<boolean | null>(null);
  const [seenFailed, setSeenFailed] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [switchFailed, setSwitchFailed] = useState(false);

  // 설정 앱에서 알림을 켜고 돌아오면 다시 확인한다
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
      .catch(() => setShowSeenState(true));
  }, [me]);

  async function toggleSeen() {
    if (showSeen === null || !me) return;
    const on = !showSeen;
    setShowSeenState(on);
    setSeenFailed(false);
    try {
      await setShowSeen(me, on);
    } catch {
      setShowSeenState(!on);
      setSeenFailed(true);
    }
  }

  async function toGeneral() {
    if (!me || switching) return;
    setSwitching(true);
    setSwitchFailed(false);
    const { error } = await supabase.from('profiles').update({ easy_mode: false }).eq('id', me);
    if (error) {
      if (__DEV__) console.warn('[to general failed]', error);
      setSwitchFailed(true);
      setSwitching(false);
      return;
    }
    await refreshMode(); // → 일반 모드 화면으로 바뀐다
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.header}>
          <HomeButton />
          <Text style={styles.title} accessibilityRole="header">
            {ko.easy.more.title}
          </Text>
        </View>

        {push ? (
          <View style={styles.card}>
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>{ko.easy.more.push}</Text>
              <Text style={styles.cardHint}>{push === 'granted' ? ko.easy.more.pushOn : ko.easy.more.pushOff}</Text>
            </View>
            {push === 'undetermined' ? (
              <BigButton
                label={ko.easy.more.pushTurnOn}
                onPress={async () => {
                  if (me) setPush(await requestPush(me));
                }}
              />
            ) : push === 'denied' ? (
              <BigButton variant="outline" label={ko.easy.more.pushSettings} onPress={() => Linking.openSettings()} />
            ) : null}
          </View>
        ) : null}

        {showSeen !== null ? (
          <View style={styles.card}>
            <View style={styles.toggleRow}>
              <View style={styles.cardText}>
                <Text style={styles.cardTitle}>{ko.easy.more.showSeen}</Text>
                <Text style={styles.cardHint}>{ko.easy.more.showSeenHint}</Text>
              </View>
              <Pressable
                accessibilityRole="switch"
                accessibilityLabel={ko.easy.more.showSeen}
                accessibilityState={{ checked: showSeen }}
                onPress={toggleSeen}
                style={({ pressed }) => [styles.pill, showSeen ? styles.pillOn : styles.pillOff, pressed && styles.pressed]}
              >
                <Text style={[styles.pillText, !showSeen && styles.pillTextOff]}>
                  {showSeen ? ko.easy.more.on : ko.easy.more.off}
                </Text>
              </Pressable>
            </View>
            {seenFailed ? (
              <Text style={styles.error} accessibilityLiveRegion="polite">
                {ko.easy.more.saveFailed}
              </Text>
            ) : null}
          </View>
        ) : null}

        {!isAnonymous ? (
          <View style={styles.bottom}>
            <BigButton variant="gray" label={ko.easy.more.toGeneral} loading={switching} onPress={toGeneral} />
            {switchFailed ? (
              <Text style={styles.error} accessibilityLiveRegion="polite">
                {ko.easy.more.saveFailed}
              </Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: easyColors.background },
  body: { flexGrow: 1, paddingHorizontal: easySize.gutter, paddingTop: 8, paddingBottom: 24, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 26, fontWeight: '700', color: easyColors.text },
  card: { borderWidth: 2, borderColor: easyColors.border, borderRadius: 16, padding: 16, gap: 14 },
  cardText: { flex: 1, gap: 4 },
  cardTitle: { fontSize: 21, fontWeight: '700', color: easyColors.text },
  cardHint: { fontSize: easySize.body, lineHeight: 26, color: easyColors.textSecondary },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pill: { minHeight: 52, minWidth: 84, paddingHorizontal: 18, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  pillOn: { backgroundColor: easyColors.accent },
  pillOff: { backgroundColor: easyColors.background, borderWidth: 2, borderColor: easyColors.border },
  pillText: { fontSize: 19, fontWeight: '700', color: '#FFFFFF' },
  pillTextOff: { color: easyColors.text },
  pressed: { opacity: 0.7 },
  error: { fontSize: easySize.body, color: easyColors.error },
  bottom: { marginTop: 'auto', gap: 8 },
});
