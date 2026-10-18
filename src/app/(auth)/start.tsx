import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BigButton } from '@/components/easy/BigButton';
import { easyColors, easySize } from '@/components/easy/tokens';
import { ko } from '@/copy/ko';

// 앱 첫 화면 (F-LGRCFY, 10/18 결정 2, 와이어프레임 '연결 · 앱 첫 화면').
// 부모님이 가장 먼저 보는 화면이라 쉬운 모드 크기로 만든다. 큰 버튼 두 개만:
//   '가족이 알려준 숫자가 있어요'(맨 위, 크게) → 숫자 6자리 입력 / '내 계정으로 시작하기' → 로그인
// QR로 연결은 TV 연결(9단계) 때 함께 만든다.
export default function StartScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.title} accessibilityRole="header">
          {ko.easy.start.title}
        </Text>
        <Text style={styles.subtitle}>{ko.easy.start.subtitle}</Text>
      </View>
      <View style={styles.buttons}>
        <BigButton large icon="keypad-outline" label={ko.easy.start.code} onPress={() => router.push('/easy-code')} />
        <Text style={styles.hint}>{ko.easy.start.codeHint}</Text>
        <BigButton variant="outline" label={ko.easy.start.account} onPress={() => router.push('/login')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: easyColors.background, paddingHorizontal: 20 },
  hero: { flex: 1, justifyContent: 'center', gap: 12 },
  title: { fontSize: easySize.display, lineHeight: 40, fontWeight: '700', color: easyColors.text },
  subtitle: { fontSize: easySize.bodyLarge, lineHeight: 30, color: easyColors.textSecondary },
  buttons: { gap: 12, paddingBottom: 24 },
  hint: { fontSize: easySize.body, lineHeight: 26, color: easyColors.textSecondary, textAlign: 'center' },
});
