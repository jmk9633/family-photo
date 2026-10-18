import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { CheckRow } from '@/components/CheckRow';
import { colors, size } from '@/components/tokens';
import { ko } from '@/copy/ko';
import { useMode } from '@/features/auth/mode';
import { getGroup, leaveGroup } from '@/features/groups/api';
import { toGroupErrorMessage } from '@/features/groups/format';
import { deleteMyPost } from '@/features/posts/remove';
import { requestAdminNotify } from '@/features/push/notify';

// 그룹 나가기 (F-LMXBXX). 나가기 전에 '올린 사진은 가족 앨범에 남아요'를 보여주고 확인받는다.
// '내가 이 그룹에 올린 사진도 지우기'를 고르면:
//   다른 그룹에도 보낸 묶음은 이 그룹에서만 빠지고, 이 그룹에만 보낸 묶음은 파일과 함께 지운다 (0007).
// 내가 마지막 관리자였으면 가장 먼저 들어온 구성원이 관리자가 되고, 새 관리자와 그룹에 알림이 간다.
// 마지막 한 명이면 그룹은 보관된다.
export default function LeaveGroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { refreshMode } = useMode();
  const [groupName, setGroupName] = useState('');
  const [deleteMine, setDeleteMine] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getGroup(id)
      .then((g) => setGroupName(g?.name ?? ''))
      .catch(() => {});
  }, [id]);

  async function leave() {
    if (leaving) return;
    setLeaving(true);
    setError(null);
    try {
      const { deleting } = await leaveGroup(id, deleteMine);
      requestAdminNotify(id); // 관리자가 넘어갔다면 서버가 새 관리자와 그룹에 알린다
      for (const postId of deleting) {
        // 이미 'deleting'이라 아무에게도 안 보인다. 못 지운 것은 7단계 정리 작업이 지운다.
        await deleteMyPost(postId).catch((e) => {
          if (__DEV__) console.warn('[leave delete post failed]', postId, e);
        });
      }
      await refreshMode();
      router.dismissTo('/family');
    } catch (e) {
      setError(toGroupErrorMessage(e));
      setLeaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ headerTitle: '' }} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title} accessibilityRole="header">
          {ko.leave.title(groupName)}
        </Text>
        <View style={styles.points}>
          <Text style={styles.point}>• {ko.leave.noAccess}</Text>
          <Text style={styles.point}>• {ko.leave.photosStay}</Text>
          <Text style={styles.point}>• {ko.leave.adminNote}</Text>
        </View>
        <CheckRow
          label={ko.leave.deleteMine}
          hint={ko.leave.deleteMineHint}
          checked={deleteMine}
          onToggle={() => setDeleteMine((v) => !v)}
        />
        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </ScrollView>
      <View style={styles.buttons}>
        <Button variant="outline" label={ko.common.cancel} onPress={() => router.back()} disabled={leaving} />
        <Button
          label={deleteMine ? ko.leave.submitDelete : ko.leave.submit}
          onPress={leave}
          loading={leaving}
          style={styles.danger}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: size.gutter },
  body: { gap: 20, paddingTop: 8, paddingBottom: 24 },
  title: { fontSize: size.title, lineHeight: 38, fontWeight: '700', color: colors.text },
  points: { gap: 8 },
  point: { fontSize: size.body, lineHeight: 25, color: colors.text },
  error: { fontSize: size.small, lineHeight: 21, color: colors.error },
  buttons: { gap: 10, paddingBottom: 16 },
  danger: { backgroundColor: colors.error },
});
