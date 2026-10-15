import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { colors, size } from '@/components/tokens';
import { ko } from '@/copy/ko';
import { signOut } from '@/features/auth/session';

// 내 정보 탭. 지금은 로그아웃만 있다.
// '봤어요' 표시 끄기(5단계), 쉬운 화면 전환·계정(6단계) 같은 설정이 해당 단계에서 여기에 생긴다.

export default function MeTab() {
  const [signingOut, setSigningOut] = useState(false);
  return (
    <SafeAreaView edges={['top']} style={styles.container}>
      <View style={styles.body}>
        <Text style={styles.title} accessibilityRole="header">
          {ko.me.title}
        </Text>
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
});
