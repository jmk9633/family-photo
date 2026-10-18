import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BigButton } from '@/components/easy/BigButton';
import { HomeButton } from '@/components/easy/HomeButton';
import { easyColors, easySize } from '@/components/easy/tokens';
import { ko } from '@/copy/ko';
import { ensureSignedIn } from '@/features/auth/anonymous';
import { useMode } from '@/features/auth/mode';
import { getGroup, redeemInvite } from '@/features/groups/api';

const CODE_LENGTH = 6;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'erase', '0', ''] as const;

// 숫자 6자리로 연결 (F-LGRCFY, 10/18 결정 3, 와이어프레임 '연결 · 숫자 6자리 입력').
// - 시스템 키보드 대신 화면의 큰 숫자판을 쓴다. 6자리를 다 눌러야 '연결하기'가 눌린다.
// - '연결하기'를 누를 때 가입 없는 계정(익명 로그인)을 처음 한 번 만들고, 틀려도 같은 계정을 쓴다.
// - 맞으면 mode가 'easy'로 바뀌어 쉬운 화면 홈이 '연결됐어요'를 먼저 보여준다.
// - 계정이 있는 사람이 실수로 여기 와도 같은 방법으로 합류한다 (초대 태그대로).
export default function EasyCodeScreen() {
  const { refreshMode, setWelcome } = useMode();
  const [digits, setDigits] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function press(key: (typeof KEYS)[number]) {
    if (busy || !key) return;
    setError(null);
    if (key === 'erase') setDigits((d) => d.slice(0, -1));
    else setDigits((d) => (d.length < CODE_LENGTH ? d + key : d));
  }

  async function connect() {
    if (digits.length !== CODE_LENGTH || busy) return;
    setBusy(true);
    setError(null);
    try {
      await ensureSignedIn();
      const result = await redeemInvite(digits);
      if (result.status === 'ok' && result.groupId) {
        const group = await getGroup(result.groupId).catch(() => null);
        setWelcome(group?.name ?? '');
        await refreshMode(); // → 쉬운 화면(또는 계정 사용자면 그 사람의 화면)으로 바뀐다
        return;
      }
      setError(result.status === 'ok' ? ko.easy.code.unknown : ko.easy.code.status[result.status]);
      setDigits('');
    } catch (e) {
      setError(toEasyCodeError(e));
    } finally {
      setBusy(false);
    }
  }

  const filled = digits.length;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} bounces={false}>
      <HomeButton onPress={() => (router.canGoBack() ? router.back() : router.replace('/start'))} />

      <Text style={styles.title} accessibilityRole="header">
        {ko.easy.code.title}
      </Text>

      <View style={styles.boxes} accessible accessibilityLabel={ko.easy.code.boxesLabel(filled, digits)}>
        {Array.from({ length: CODE_LENGTH }, (_, i) => (
          <View
            key={i}
            style={[styles.box, i < filled && styles.boxFilled, i === filled && styles.boxCurrent]}
          >
            <Text style={styles.boxText}>{digits[i] ?? ''}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.error} accessibilityLiveRegion="assertive">
        {busy ? ko.easy.code.connecting : (error ?? '')}
      </Text>

      <View style={styles.pad}>
        {[0, 1, 2, 3].map((row) => (
          <View key={row} style={styles.padRow}>
            {KEYS.slice(row * 3, row * 3 + 3).map((key, i) =>
              key === '' ? (
                <View key={i} style={styles.keySpacer} />
              ) : (
                <Pressable
                  key={i}
                  accessibilityRole="button"
                  accessibilityLabel={key === 'erase' ? ko.easy.code.eraseLabel : key}
                  onPress={() => press(key)}
                  disabled={busy}
                  style={({ pressed }) => [
                    styles.key,
                    key === 'erase' && styles.keyErase,
                    pressed && styles.pressed,
                  ]}
                >
                  {key === 'erase' ? (
                    <>
                      <Ionicons name="backspace-outline" size={24} color={easyColors.text} />
                      <Text style={styles.keyEraseText}>{ko.easy.code.erase}</Text>
                    </>
                  ) : (
                    <Text style={styles.keyText}>{key}</Text>
                  )}
                </Pressable>
              ),
            )}
          </View>
        ))}
      </View>

      <BigButton
        large
        label={ko.easy.code.connect}
        onPress={connect}
        loading={busy}
        disabled={filled !== CODE_LENGTH}
      />
      </ScrollView>
    </SafeAreaView>
  );
}

function toEasyCodeError(e: unknown): string {
  const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : '';
  if (/network request failed|fetch/i.test(msg)) return ko.easy.code.network;
  // 개발 중에는 원인을 바로 볼 수 있게 원문을 함께 보여준다 (예: Supabase 익명 로그인이 꺼져 있음)
  if (__DEV__) {
    const detail = JSON.stringify(e) === '{}' ? msg : JSON.stringify(e);
    console.warn('[easy code error]', detail);
    return `${ko.easy.code.unknown}\n(${detail})`;
  }
  return ko.easy.code.unknown;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: easyColors.background },
  // 작은 폰에서는 숫자판까지 밀어 올려 볼 수 있게 (큰 폰에서는 한 화면에 다 들어간다)
  container: {
    flexGrow: 1,
    paddingHorizontal: easySize.gutter,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 16,
  },
  title: { fontSize: 25, lineHeight: 35, fontWeight: '700', color: easyColors.text },
  boxes: { flexDirection: 'row', gap: 8 },
  box: {
    flex: 1,
    height: 64,
    borderWidth: 2,
    borderColor: '#BDBDBD',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxFilled: { borderColor: easyColors.border },
  boxCurrent: { borderColor: easyColors.accent, borderWidth: 3 },
  boxText: { fontSize: 32, fontWeight: '700', color: easyColors.text },
  error: { minHeight: 52, fontSize: easySize.body, lineHeight: 26, color: easyColors.error, fontWeight: '600' },
  pad: { marginTop: 'auto', gap: 10 },
  padRow: { flexDirection: 'row', gap: 10 },
  key: {
    flex: 1,
    height: 68,
    borderRadius: 14,
    backgroundColor: easyColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keySpacer: { flex: 1, height: 68 },
  keyErase: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: easyColors.background,
    borderWidth: 2,
    borderColor: easyColors.border,
  },
  keyText: { fontSize: 30, fontWeight: '700', color: easyColors.text },
  keyEraseText: { fontSize: easySize.bodyLarge, fontWeight: '700', color: easyColors.text },
  pressed: { opacity: 0.6 },
});
