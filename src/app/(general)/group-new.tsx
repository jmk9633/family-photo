import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { colors, size } from '@/components/tokens';
import { ko } from '@/copy/ko';
import { useSession } from '@/features/auth/session';
import { createGroup, getMyDefaultName } from '@/features/groups/api';
import { promptPushIfNeeded } from '@/features/push/push';
import { cleanName, GROUP_NAME_MAX, NAME_MAX, toGroupErrorMessage } from '@/features/groups/format';

// 그룹 이름 + 이 그룹에서 보일 내 이름(카카오·구글 이름을 미리 채워 고칠 수 있게).
// 만들면 '첫 사진 미리 보내기'(건너뛸 수 있음) → 초대 화면('나중에' 가능) 순서로 간다 (F-PWMFRH).
export default function GroupNewScreen() {
  const { session } = useSession();
  const [name, setName] = useState('');
  const [myName, setMyName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!session) return;
    getMyDefaultName(session.user.id)
      .then((n) => setMyName((cur) => cur || n))
      .catch(() => {});
  }, [session]);

  const canSubmit = cleanName(name).length > 0 && cleanName(myName).length > 0;

  async function submit() {
    if (!canSubmit || saving) return;
    setSaving(true);
    setError(null);
    try {
      const groupId = await createGroup(cleanName(name), cleanName(myName));
      router.replace({ pathname: '/send', params: { group: groupId, first: '1' } });
      promptPushIfNeeded(); // 첫 그룹이면 알림 안내를 그 위에 띄운다
    } catch (e) {
      setError(toGroupErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.title} accessibilityRole="header">
            {ko.groupNew.title}
          </Text>
          <TextField
            label={ko.groupNew.nameLabel}
            placeholder={ko.groupNew.namePlaceholder}
            value={name}
            onChangeText={setName}
            maxLength={GROUP_NAME_MAX}
            autoFocus
            returnKeyType="next"
          />
          <TextField
            label={ko.groupNew.myNameLabel}
            placeholder={ko.groupNew.myNamePlaceholder}
            hint={ko.groupNew.myNameHint}
            value={myName}
            onChangeText={setMyName}
            maxLength={NAME_MAX}
            returnKeyType="done"
            onSubmitEditing={submit}
          />
          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
        </ScrollView>
        <Button
          label={ko.groupNew.submit}
          onPress={submit}
          loading={saving}
          disabled={!canSubmit}
          style={styles.submit}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: size.gutter },
  body: { gap: 24, paddingTop: 8, paddingBottom: 24 },
  title: { fontSize: size.title, fontWeight: '700', color: colors.text },
  error: { fontSize: size.small, color: colors.error },
  submit: { marginBottom: 16 },
});
