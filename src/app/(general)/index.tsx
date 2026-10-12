import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { colors, size } from '@/components/tokens';
import { ko } from '@/copy/ko';
import { signOut, useSession } from '@/features/auth/session';

// 1단계 확인용 임시 홈. 2단계에서 그룹 만들기·사진 타임라인으로 바뀐다.
export default function HomeScreen() {
  const { session } = useSession();
  const [signingOut, setSigningOut] = useState(false);

  const provider = String(session?.user.app_metadata.provider ?? '');
  const providerLabel = ko.providers[provider] ?? provider;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.body}>
        <Text style={styles.title} accessibilityRole="header">
          {ko.home.title}
        </Text>
        <Text style={styles.method}>{ko.home.method(providerLabel)}</Text>
        <Text style={styles.note}>{ko.home.note}</Text>
      </View>
      <Button
        variant="outline"
        label={ko.home.signOut}
        loading={signingOut}
        onPress={async () => {
          setSigningOut(true);
          await signOut();
        }}
        style={styles.signOut}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: size.gutter },
  body: { flex: 1, justifyContent: 'center', gap: 12 },
  title: { fontSize: size.title, fontWeight: '700', color: colors.text },
  method: { fontSize: 20, color: colors.text },
  note: { fontSize: size.body, lineHeight: 25, color: colors.textSecondary },
  signOut: { marginBottom: 16 },
});
