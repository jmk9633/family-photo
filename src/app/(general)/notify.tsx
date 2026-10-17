import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { colors, size } from '@/components/tokens';
import { ko } from '@/copy/ko';
import { useSession } from '@/features/auth/session';
import { requestPush } from '@/features/push/push';

// 알림 권한 안내 (10/16 결정): 첫 그룹을 만들거나 들어간 직후, 시스템 권한 창을 띄우기 전에
// 무엇을 알려주는지 먼저 보여준다. '나중에'를 누르면 시스템 창을 띄우지 않으므로 내 정보 탭에서 다시 켤 수 있다.

export default function NotifyScreen() {
  const { session } = useSession();
  const [asking, setAsking] = useState(false);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.body}>
        <Ionicons name="notifications-outline" size={56} color={colors.accent} accessibilityElementsHidden />
        <Text style={styles.title} accessibilityRole="header">
          {ko.notify.title}
        </Text>
        <Text style={styles.text}>{ko.notify.text}</Text>
      </View>
      <View style={styles.actions}>
        <Button
          label={ko.notify.allow}
          loading={asking}
          onPress={async () => {
            if (!session) return;
            setAsking(true);
            try {
              await requestPush(session.user.id);
            } catch (e) {
              if (__DEV__) console.warn('[push request failed]', e);
            }
            close();
          }}
        />
        <Button variant="text" label={ko.common.later} onPress={close} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: size.gutter },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  title: { fontSize: size.title, lineHeight: 38, fontWeight: '700', color: colors.text, textAlign: 'center' },
  text: { fontSize: size.body, lineHeight: 26, color: colors.textSecondary, textAlign: 'center' },
  actions: { gap: 8, paddingBottom: 16 },
});
