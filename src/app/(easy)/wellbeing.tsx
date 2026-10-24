import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BigButton } from '@/components/easy/BigButton';
import { HomeButton } from '@/components/easy/HomeButton';
import { easyColors, easySize } from '@/components/easy/tokens';
import { ko } from '@/copy/ko';
import { answerWellbeingRequests, seenWellbeingIntro } from '@/features/wellbeing/api';

// 쉬운 화면 안부 확인 (개발 7-2, F-MNBFHT). 홈이 앱을 열 때 한 번 띄운다.
//   mode=consent: 관리자가 켜 달라고 요청함 → '가족이 안부 확인을 (다시) 켜려고 해요' + 좋아요·아니요.
//                 와 있는 요청 모두에 한꺼번에 답한다 (쉬운 화면은 가족을 고르지 않는다, 결정 1).
//                 '처음으로'를 누르면 답하지 않은 채 돌아가고, 다음에 앱을 열 때 다시 뜬다.
//   mode=intro:   안부 확인이 켜진 채 처음 연결됨 → '며칠 안 보시면 가족에게 알려요' 한 번.
//                 화면이 보이면 본 것으로 남긴다.
// 요청이 와도 푸시는 보내지 않는다 (결정 3). '위험'·'이상 징후' 같은 말은 쓰지 않는다.

export default function EasyWellbeing() {
  const { mode, again } = useLocalSearchParams<{ mode?: string; again?: string }>();
  const consent = mode === 'consent';
  const [busy, setBusy] = useState<'yes' | 'no' | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!consent) seenWellbeingIntro().catch(() => {});
  }, [consent]);

  async function answer(yes: boolean) {
    if (busy) return;
    setBusy(yes ? 'yes' : 'no');
    setFailed(false);
    try {
      await answerWellbeingRequests(yes);
      router.dismissTo('/home');
    } catch (e) {
      if (__DEV__) console.warn('[wellbeing answer failed]', e);
      setFailed(true);
      setBusy(null);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.body}>
        <HomeButton />
        <View style={styles.center}>
          <View style={styles.icon}>
            <Ionicons name="heart" size={48} color="#FFFFFF" />
          </View>
          <Text style={styles.title} accessibilityRole="header">
            {consent ? ko.myWellbeing.consentTitle(again === '1') : ko.myWellbeing.introTitle}
          </Text>
          <Text style={styles.text}>{consent ? ko.myWellbeing.consentText : ko.myWellbeing.introText}</Text>
          <Text style={styles.note}>{ko.myWellbeing.notEmergency}</Text>
        </View>
        <View style={styles.buttons}>
          {consent ? (
            <>
              <BigButton label={ko.myWellbeing.yes} large loading={busy === 'yes'} disabled={!!busy} onPress={() => answer(true)} />
              <BigButton variant="outline" label={ko.myWellbeing.no} loading={busy === 'no'} disabled={!!busy} onPress={() => answer(false)} />
              {failed ? (
                <Text style={styles.error} accessibilityLiveRegion="polite">
                  {ko.myWellbeing.failed}
                </Text>
              ) : null}
            </>
          ) : (
            <BigButton label={ko.myWellbeing.introOk} large onPress={() => router.dismissTo('/home')} />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: easyColors.background },
  body: { flexGrow: 1, paddingHorizontal: easySize.gutter, paddingTop: 8, paddingBottom: 24, gap: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  icon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: easyColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: easySize.display, lineHeight: 40, fontWeight: '700', color: easyColors.text, textAlign: 'center' },
  text: { fontSize: easySize.bodyLarge, lineHeight: 30, color: easyColors.text, textAlign: 'center' },
  note: { fontSize: easySize.body, lineHeight: 26, color: easyColors.textSecondary, textAlign: 'center' },
  buttons: { gap: 12 },
  error: { fontSize: easySize.body, color: easyColors.error, textAlign: 'center' },
});
