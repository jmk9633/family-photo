import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BigButton } from '@/components/easy/BigButton';
import { HomeButton } from '@/components/easy/HomeButton';
import { easyColors, easySize } from '@/components/easy/tokens';
import { ko } from '@/copy/ko';
import { useMode } from '@/features/auth/mode';
import { signOut, useSession } from '@/features/auth/session';
import { getShowSeen, setShowSeen } from '@/features/posts/views';
import { requestWellbeingOffNotify } from '@/features/push/notify';
import { getPushStatus, requestPush, unregisterPush, type PushStatus } from '@/features/push/push';
import { getMyWellbeing, setMyWellbeingAll, type MyWellbeing } from '@/features/wellbeing/api';
import { supabase } from '@/lib/supabase';

// 쉬운 화면 더보기 (와이어프레임 '쉬운 모드 · 더보기', 10/18 결정 12 — 6단계에서는 일부만).
//   내 안부 확인(7-2, 안부 확인이 한 번이라도 있었던 사람만) · 알림 · 내가 본 사진을 가족에게 알리기
//   · 다른 가족과도 연결하기 · 일반 화면으로 바꾸기(계정이 있는 사람만)
// TV 연결은 9단계, 보낼 가족 정하기·관리자 메뉴는 MVP 이후에 더한다.
//
// 내 안부 확인 (F-MNBFHT, 7-2 결정 1·2): 가족이 여럿이어도 스위치 하나.
//   켜짐 → 누르면 카드 안에서 '끄면 가족에게 껐다고 알려요' + 끄기·그대로 두기 → 켜진 모든 가족에서 끄고 관리자에게 알림
//   꺼짐(본인이 끔) → 누르면 바로 다시 켬 / 꺼짐(관리자가 끔) → 스위치 없음, 관리자가 요청하면 동의 화면으로

export default function EasyMore() {
  const { session } = useSession();
  const me = session?.user.id ?? '';
  const { isAnonymous, refreshMode } = useMode();
  const [push, setPush] = useState<PushStatus | null>(null);
  const [showSeen, setShowSeenState] = useState<boolean | null>(null);
  const [seenFailed, setSeenFailed] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [switchFailed, setSwitchFailed] = useState(false);
  const [wellbeing, setWellbeing] = useState<MyWellbeing[] | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [wbBusy, setWbBusy] = useState(false);
  const [wbFailed, setWbFailed] = useState(false);

  const loadWellbeing = useCallback(() => {
    getMyWellbeing()
      .then(setWellbeing)
      .catch(() => setWellbeing(null));
  }, []);
  useFocusEffect(loadWellbeing);

  const wbOn = !!wellbeing?.some((w) => w.is_on);
  const wbCanOn = !wbOn && !!wellbeing?.some((w) => w.can_turn_on);
  const wbRequested = wellbeing?.filter((w) => w.requested) ?? [];

  async function changeWellbeing(on: boolean) {
    if (wbBusy) return;
    setWbBusy(true);
    setWbFailed(false);
    try {
      const changed = await setMyWellbeingAll(on);
      if (!on && changed > 0) requestWellbeingOffNotify();
      setConfirmOff(false);
      loadWellbeing();
    } catch (e) {
      if (__DEV__) console.warn('[wellbeing change failed]', e);
      setWbFailed(true);
    } finally {
      setWbBusy(false);
    }
  }

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

        {wellbeing && wellbeing.length > 0 ? (
          <View style={styles.card}>
            <View style={styles.toggleRow}>
              <View style={styles.cardText}>
                <Text style={styles.cardTitle}>{ko.myWellbeing.title}</Text>
                <Text style={styles.cardHint}>
                  {wbOn ? ko.myWellbeing.hintOn : wbCanOn ? ko.myWellbeing.hintCanOn : ko.myWellbeing.hintOff}
                </Text>
              </View>
              {wbOn || wbCanOn ? (
                <Pressable
                  accessibilityRole="switch"
                  accessibilityLabel={ko.myWellbeing.title}
                  accessibilityState={{ checked: wbOn, busy: wbBusy }}
                  onPress={() => (wbOn ? setConfirmOff(true) : changeWellbeing(true))}
                  disabled={wbBusy || confirmOff}
                  style={({ pressed }) => [styles.pill, wbOn ? styles.pillOn : styles.pillOff, pressed && styles.pressed]}
                >
                  <Text style={[styles.pillText, !wbOn && styles.pillTextOff]}>
                    {wbOn ? ko.myWellbeing.on : ko.myWellbeing.off}
                  </Text>
                </Pressable>
              ) : (
                <Text style={styles.stateText}>{ko.myWellbeing.off}</Text>
              )}
            </View>
            {confirmOff ? (
              <View style={styles.confirm}>
                <Text style={styles.cardHint} accessibilityLiveRegion="polite">
                  {ko.myWellbeing.offConfirm}
                </Text>
                <BigButton label={ko.myWellbeing.turnOff} loading={wbBusy} onPress={() => changeWellbeing(false)} />
                <BigButton variant="gray" label={ko.myWellbeing.keep} disabled={wbBusy} onPress={() => setConfirmOff(false)} />
              </View>
            ) : null}
            {wbRequested.length > 0 ? (
              <View style={styles.confirm}>
                <Text style={styles.cardHint}>{ko.myWellbeing.requestHint}</Text>
                <BigButton
                  variant="outline"
                  label={ko.myWellbeing.seeRequest}
                  onPress={() =>
                    router.push({
                      pathname: '/wellbeing',
                      params: { mode: 'consent', again: wbRequested.some((w) => w.ever_on) ? '1' : '0' },
                    })
                  }
                />
              </View>
            ) : null}
            {wbFailed ? (
              <Text style={styles.error} accessibilityLiveRegion="polite">
                {ko.myWellbeing.failed}
              </Text>
            ) : null}
          </View>
        ) : null}

        {push ? (
          <View style={styles.card}>
            <View style={styles.toggleRow}>
              <View style={styles.cardText}>
                <Text style={styles.cardTitle}>{ko.easy.more.push}</Text>
                <Text style={styles.cardHint}>
                  {push === 'granted' ? ko.easy.more.pushOn : push === 'denied' ? ko.easy.more.pushDenied : ko.easy.more.pushOff}
                </Text>
              </View>
              {/* 아이폰은 앱에서 알림을 끌 수 없다: 켜져 있거나 거절했으면 설정으로, 아직 안 물었으면 바로 묻는다 */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${ko.easy.more.push} ${push === 'granted' ? ko.easy.more.on : ko.easy.more.off}`}
                accessibilityHint={push === 'undetermined' ? ko.easy.more.pushTurnOn : ko.easy.more.pushSettings}
                onPress={async () => {
                  if (push === 'undetermined') {
                    if (me) setPush(await requestPush(me));
                  } else {
                    Linking.openSettings();
                  }
                }}
                style={({ pressed }) => [styles.pill, push === 'granted' ? styles.pillOn : styles.pillOff, pressed && styles.pressed]}
              >
                <Text style={[styles.pillText, push !== 'granted' && styles.pillTextOff]}>
                  {push === 'granted' ? ko.easy.more.on : ko.easy.more.off}
                </Text>
              </Pressable>
            </View>
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

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={ko.easy.more.connectMore}
          accessibilityHint={ko.easy.more.connectMoreHint}
          onPress={() => router.push('/connect')}
          style={({ pressed }) => [styles.card, styles.linkCard, pressed && styles.pressed]}
        >
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>{ko.easy.more.connectMore}</Text>
            <Text style={styles.cardHint}>{ko.easy.more.connectMoreHint}</Text>
          </View>
          <Ionicons name="chevron-forward" size={26} color={easyColors.text} />
        </Pressable>

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

        {/* 개발용: 가입 없이 연결한 사람은 앱에서 나갈 방법이 없어 테스트할 때만 보여준다 (출시 빌드에는 안 나옴) */}
        {__DEV__ ? (
          <BigButton
            variant="outline"
            label={ko.easy.more.devSignOut}
            onPress={async () => {
              if (me) await unregisterPush(me);
              await signOut();
            }}
            style={isAnonymous ? styles.devBottom : undefined}
          />
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
  linkCard: { flexDirection: 'row', alignItems: 'center' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pill: { minHeight: 52, minWidth: 84, paddingHorizontal: 18, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  pillOn: { backgroundColor: easyColors.accent },
  pillOff: { backgroundColor: easyColors.background, borderWidth: 2, borderColor: easyColors.border },
  pillText: { fontSize: 19, fontWeight: '700', color: '#FFFFFF' },
  pillTextOff: { color: easyColors.text },
  stateText: { fontSize: 19, fontWeight: '700', color: easyColors.textSecondary, paddingHorizontal: 8 },
  confirm: { gap: 10 },
  pressed: { opacity: 0.7 },
  error: { fontSize: easySize.body, color: easyColors.error },
  bottom: { marginTop: 'auto', gap: 8 },
  devBottom: { marginTop: 'auto' },
});
