import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { AppState, Linking, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { colors, size } from '@/components/tokens';
import { ko } from '@/copy/ko';
import { listMyWellbeingAlerts, respondWellbeing, type WellbeingAlert } from '@/features/wellbeing/api';

// 사진 탭 맨 위 안부 띠 (F-QEMORX, 개발 7-1). 관리자에게만 보인다 (서버가 관리자 그룹 것만 돌려준다).
//   안부 알림: '엄마가 3일째 새 사진을 안 보셨어요' + 응급 상황 알림이 아니라는 안내 + 전화하기·괜찮아요
//   넛지:     '요즘 보낸 사진이 없어요' + 사진 보내기·닫기 (새 사진이 올라오면 서버가 닫는다)
// 대상자가 다시 활동하거나 다른 관리자가 응답하면 서버에서 닫혀, 다음에 불러올 때 사라진다.
// 화면에 다시 올 때·앱으로 돌아올 때 새로 불러온다. 못 불러오면 띠 없이 사진만 보여준다.

export function WellbeingBanner() {
  const [alerts, setAlerts] = useState<WellbeingAlert[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listMyWellbeingAlerts()
      .then(setAlerts)
      .catch((e) => {
        if (__DEV__) console.warn('[wellbeing load failed]', e);
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

  async function respond(a: WellbeingAlert, response: 'called' | 'ok') {
    setBusy(a.alert_id);
    setError(null);
    try {
      await respondWellbeing(a.alert_id, response);
      setAlerts((list) => list.filter((x) => x.alert_id !== a.alert_id));
    } catch (e) {
      if (__DEV__) console.warn('[wellbeing respond failed]', e);
      setError(ko.wellbeing.failed);
      load();
    } finally {
      setBusy(null);
    }
  }

  async function call(a: WellbeingAlert) {
    if (!a.phone) return;
    try {
      await Linking.openURL(`tel:${a.phone}`);
    } catch {
      setError(ko.wellbeing.callFailed);
      return;
    }
    respond(a, 'called');
  }

  if (alerts.length === 0) return null;

  return (
    <View style={styles.wrap}>
      {alerts.map((a) =>
        a.kind === 'check' ? (
          <View key={a.alert_id} style={styles.card} accessibilityLiveRegion="polite">
            <Text style={styles.group}>{a.group_name}</Text>
            <Text style={styles.title}>{ko.wellbeing.checkTitle(a.target_name, a.days)}</Text>
            <Text style={styles.text}>{ko.wellbeing.checkText}</Text>
            <Text style={styles.note}>{ko.wellbeing.notEmergency}</Text>
            {a.phone ? null : <Text style={styles.note}>{ko.wellbeing.noPhone}</Text>}
            <View style={styles.buttons}>
              {a.phone ? (
                <Button label={ko.wellbeing.call} onPress={() => call(a)} disabled={busy === a.alert_id} style={styles.flex} />
              ) : a.target_member_id ? (
                <Button
                  variant="outline"
                  label={ko.wellbeing.addPhone}
                  onPress={() =>
                    router.push({
                      pathname: '/group/[id]/phone',
                      params: { id: a.group_id, member: a.target_member_id!, name: a.target_name },
                    })
                  }
                  style={styles.flex}
                />
              ) : null}
              <Button
                variant="outline"
                label={ko.wellbeing.ok}
                onPress={() => respond(a, 'ok')}
                loading={busy === a.alert_id}
                style={styles.flex}
              />
            </View>
          </View>
        ) : (
          <View key={a.alert_id} style={styles.card}>
            <Text style={styles.group}>{a.group_name}</Text>
            <Text style={styles.title}>{ko.wellbeing.nudgeTitle}</Text>
            <Text style={styles.text}>{ko.wellbeing.nudgeText(a.target_name)}</Text>
            <View style={styles.buttons}>
              <Button
                label={ko.wellbeing.send}
                onPress={() => router.push({ pathname: '/send', params: { group: a.group_id } })}
                style={styles.flex}
              />
              <Button
                variant="outline"
                label={ko.wellbeing.close}
                onPress={() => respond(a, 'ok')}
                loading={busy === a.alert_id}
                style={styles.flex}
              />
            </View>
          </View>
        ),
      )}
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
  group: { fontSize: 13, color: colors.textSecondary },
  title: { fontSize: size.body, lineHeight: 24, fontWeight: '700', color: colors.text },
  text: { fontSize: size.small, lineHeight: 22, color: colors.text },
  note: { fontSize: 13, lineHeight: 19, color: colors.textSecondary },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 6 },
  flex: { flex: 1 },
  error: { fontSize: size.small, color: colors.error },
});
