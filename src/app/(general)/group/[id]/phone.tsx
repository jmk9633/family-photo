import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { colors, size } from '@/components/tokens';
import { ko } from '@/copy/ko';
import { toGroupErrorMessage } from '@/features/groups/format';
import { formatPhone, listMemberPhones, setMemberPhone } from '@/features/wellbeing/api';

// 구성원 전화번호 (관리자만, 개발 7-1 결정 1-A). 안부 알림의 '전화하기'에 쓴다. 선택 사항.
// 그룹 화면에서 구성원을 누르거나, 안부 띠의 '전화번호 넣기'로 온다.
export default function MemberPhoneScreen() {
  const { id, member, name } = useLocalSearchParams<{ id: string; member: string; name?: string }>();
  const [draft, setDraft] = useState('');
  const [had, setHad] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listMemberPhones(id)
      .then((phones) => {
        const p = phones[member];
        if (p) {
          setDraft(formatPhone(p));
          setHad(true);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [id, member]);

  async function save(value: string) {
    setSaving(true);
    setError(null);
    try {
      await setMemberPhone(member, value);
      router.back();
    } catch (e) {
      setError(toGroupErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const who = name || ko.feed.unknownSender;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ headerTitle: ko.memberPhone.title(who) }} />
      {!loaded ? (
        <ActivityIndicator color={colors.accent} accessibilityLabel={ko.common.loading} style={styles.loading} />
      ) : (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <TextField
            label={ko.memberPhone.label}
            hint={ko.memberPhone.hint}
            error={error}
            value={draft}
            onChangeText={(t) => {
              setDraft(t);
              if (error) setError(null);
            }}
            placeholder={ko.memberPhone.placeholder}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            maxLength={16}
            autoFocus={!had}
            returnKeyType="done"
            onSubmitEditing={() => save(draft)}
          />
          <View style={styles.buttons}>
            <Button
              label={ko.common.save}
              onPress={() => save(draft)}
              loading={saving}
              disabled={draft.replace(/[^0-9]/g, '').length === 0}
            />
            {had ? <Button variant="text" label={ko.memberPhone.remove} onPress={() => save('')} /> : null}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: size.gutter },
  loading: { marginTop: 40 },
  body: { gap: 20, paddingTop: 8, paddingBottom: 32 },
  buttons: { gap: 8 },
});
