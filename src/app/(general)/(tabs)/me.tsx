import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { CheckRow } from '@/components/CheckRow';
import { colors, size } from '@/components/tokens';
import { ko } from '@/copy/ko';
import { signOut, useSession } from '@/features/auth/session';
import { getShowSeen, setShowSeen } from '@/features/posts/views';

// 내 정보 탭.
// - 내 '봤어요'를 가족에게 보여줄지 (F-BLIYTI, 기본 켜짐). 꺼도 안부 확인용 활동 기록은 남는다.
// - 로그아웃
// 쉬운 화면 전환·계정(6단계) 같은 설정이 해당 단계에서 여기에 생긴다.

export default function MeTab() {
  const { session } = useSession();
  const me = session?.user.id ?? '';
  const [signingOut, setSigningOut] = useState(false);
  const [showSeen, setShowSeenState] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);

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
  error: { fontSize: size.small, color: colors.error },
});
