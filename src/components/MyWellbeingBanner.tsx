import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { colors, size } from '@/components/tokens';
import { ko } from '@/copy/ko';
import { getMyWellbeing, seenWellbeingIntro, setMyWellbeing, type MyWellbeing } from '@/features/wellbeing/api';

// 사진 탭 맨 위 '내 안부 확인' 띠 (개발 7-2, F-MNBFHT). 일반 화면을 쓰는 안부 확인 대상자 본인에게만 보인다 (결정 5).
//   켜기 요청: 그룹마다 'OO에서 안부 확인을 (다시) 켜려고 해요' + 아니요·좋아요 (요청이 와도 푸시는 없다, 결정 3)
//   처음 안내: 안부 확인이 켜졌는데 아직 안내를 안 봤으면 한 번 + '알겠어요'
// 끄기·다시 켜기는 가족 탭 → 그룹 화면 '내 안부 확인'에서 한다. 관리자용 안부 띠(WellbeingBanner)와 따로다.

export function MyWellbeingBanner() {
  const [rows, setRows] = useState<MyWellbeing[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getMyWellbeing()
      .then(setRows)
      .catch((e) => {
        if (__DEV__) console.warn('[my wellbeing load failed]', e);
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      const sub = AppState.addEventListener('change', (s) => {
        if (s === 'active') load();
      });
      return () => sub.remove();
    }, [load]),
  );

  async function answer(row: MyWellbeing, yes: boolean) {
    setBusy(row.group_id);
    setError(null);
    try {
      await setMyWellbeing(row.group_id, yes);
    } catch (e) {
      if (__DEV__) console.warn('[my wellbeing answer failed]', e);
      setError(ko.myWellbeing.failed);
    } finally {
      setBusy(null);
      load();
    }
  }

  async function seenIntro() {
    setRows((list) => list.map((r) => ({ ...r, intro_needed: false })));
    seenWellbeingIntro().catch(() => load());
  }

  const asks = rows.filter((r) => r.requested);
  const intro = rows.filter((r) => r.intro_needed);
  if (asks.length === 0 && intro.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {asks.map((r) => (
        <View key={r.group_id} style={styles.card} accessibilityLiveRegion="polite">
          <Text style={styles.title}>{ko.myWellbeing.generalConsentTitle(r.group_name, r.ever_on)}</Text>
          <Text style={styles.text}>{ko.myWellbeing.generalConsentText}</Text>
          <Text style={styles.note}>{ko.myWellbeing.notEmergency}</Text>
          <View style={styles.buttons}>
            <Button
              variant="outline"
              label={ko.myWellbeing.no}
              disabled={busy === r.group_id}
              onPress={() => answer(r, false)}
              style={styles.flex}
            />
            <Button
              label={ko.myWellbeing.yes}
              loading={busy === r.group_id}
              onPress={() => answer(r, true)}
              style={styles.flex}
            />
          </View>
        </View>
      ))}
      {asks.length === 0 && intro.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.title}>{ko.myWellbeing.introTitle}</Text>
          <Text style={styles.text}>{ko.myWellbeing.generalIntroText(intro.map((r) => r.group_name).join(', '))}</Text>
          <Text style={styles.note}>{ko.myWellbeing.notEmergency}</Text>
          <View style={styles.buttons}>
            <Button label={ko.myWellbeing.introOk} onPress={seenIntro} style={styles.flex} />
          </View>
        </View>
      ) : null}
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 8, gap: 10 },
  card: { gap: 6, padding: 16, borderRadius: 16, backgroundColor: colors.surface },
  title: { fontSize: size.body, lineHeight: 24, fontWeight: '700', color: colors.text },
  text: { fontSize: size.small, lineHeight: 22, color: colors.text },
  note: { fontSize: 13, lineHeight: 19, color: colors.textSecondary },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 6 },
  flex: { flex: 1 },
  error: { fontSize: size.small, color: colors.error },
});
