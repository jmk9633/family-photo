import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { CheckRow } from '@/components/CheckRow';
import { TextField } from '@/components/TextField';
import { colors, size } from '@/components/tokens';
import { ko } from '@/copy/ko';
import { createInvite, getGroup, type InviteTags, type IssuedInvite } from '@/features/groups/api';
import {
  cleanName,
  formatInviteDeadline,
  NAME_MAX,
  toGroupErrorMessage,
} from '@/features/groups/format';

const NO_TAGS: InviteTags = { isAdmin: false, easyMode: false, wellbeing: false };

// 초대 만들기: 표시 이름 + 할 일(태그) → 6자리 코드 → 문자·메신저로 보내기.
// 2단계는 코드 방식만. 링크·만나서 QR·TV 먼저 연결은 6·9단계에서 추가한다.
// first=1: 그룹을 막 만든 직후 (오른쪽 위 '나중에'로 건너뛸 수 있다)
export default function InviteNewScreen() {
  const { id, first } = useLocalSearchParams<{ id: string; first?: string }>();
  const isFirst = first === '1';
  const [groupName, setGroupName] = useState('');
  const [name, setName] = useState('');
  const [tags, setTags] = useState<InviteTags>(NO_TAGS);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [issued, setIssued] = useState<(IssuedInvite & { name: string }) | null>(null);

  useEffect(() => {
    getGroup(id)
      .then((g) => setGroupName(g?.name ?? ''))
      .catch(() => {});
  }, [id]);

  function goToGroup() {
    if (isFirst) router.replace({ pathname: '/group/[id]', params: { id } });
    else router.back();
  }

  async function submit() {
    const clean = cleanName(name);
    if (!clean || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await createInvite(id, clean, tags);
      setIssued({ ...result, name: clean });
    } catch (e) {
      setError(toGroupErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function share() {
    if (!issued) return;
    const deadline = formatInviteDeadline(issued.expires_at);
    await Share.share({ message: ko.invite.shareMessage(groupName, issued.code, deadline) });
  }

  function another() {
    setIssued(null);
    setName('');
    setTags(NO_TAGS);
  }

  const header = (
    <Stack.Screen
      options={{
        headerRight: () =>
          isFirst ? <Button variant="text" label={ko.common.later} onPress={goToGroup} /> : null,
      }}
    />
  );

  if (issued) {
    const deadline = formatInviteDeadline(issued.expires_at);
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        {header}
        <View style={styles.resultBody}>
          <Text style={styles.title} accessibilityRole="header">
            {ko.invite.codeTitle(issued.name)}
          </Text>
          <Text
            style={styles.code}
            accessibilityLabel={issued.code.split('').join(' ')}
            selectable
          >
            {issued.code}
          </Text>
          <Text style={styles.description}>{ko.invite.codeHint(deadline)}</Text>
        </View>
        <View style={styles.actions}>
          <Button label={ko.invite.share} onPress={share} />
          <Button variant="outline" label={ko.invite.another} onPress={another} />
          <Button variant="text" label={ko.invite.toGroup} onPress={goToGroup} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {header}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.title} accessibilityRole="header">
            {ko.inviteNew.title}
          </Text>
          <Text style={styles.description}>{ko.inviteNew.description}</Text>
          <TextField
            label={ko.inviteNew.nameLabel}
            placeholder={ko.inviteNew.namePlaceholder}
            value={name}
            onChangeText={setName}
            maxLength={NAME_MAX}
            returnKeyType="done"
          />
          <View style={styles.tags}>
            <Text style={styles.tagsLabel}>{ko.inviteNew.tagsLabel}</Text>
            <CheckRow
              label={ko.inviteNew.tags.easy.label}
              hint={ko.inviteNew.tags.easy.hint}
              checked={tags.easyMode}
              onToggle={() => setTags((t) => ({ ...t, easyMode: !t.easyMode }))}
            />
            <CheckRow
              label={ko.inviteNew.tags.wellbeing.label}
              hint={ko.inviteNew.tags.wellbeing.hint}
              checked={tags.wellbeing}
              onToggle={() => setTags((t) => ({ ...t, wellbeing: !t.wellbeing }))}
            />
            <CheckRow
              label={ko.inviteNew.tags.admin.label}
              hint={ko.inviteNew.tags.admin.hint}
              checked={tags.isAdmin}
              onToggle={() => setTags((t) => ({ ...t, isAdmin: !t.isAdmin }))}
            />
          </View>
          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
        </ScrollView>
        <Button
          label={ko.inviteNew.submit}
          onPress={submit}
          loading={saving}
          disabled={cleanName(name).length === 0}
          style={styles.submit}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: size.gutter },
  body: { gap: 20, paddingTop: 8, paddingBottom: 24 },
  title: { fontSize: size.title, fontWeight: '700', color: colors.text },
  description: { fontSize: size.body, lineHeight: 25, color: colors.textSecondary },
  tags: { gap: 10 },
  tagsLabel: { fontSize: size.small, fontWeight: '600', color: colors.text },
  error: { fontSize: size.small, color: colors.error },
  submit: { marginBottom: 16 },

  resultBody: { flex: 1, justifyContent: 'center', gap: 20 },
  code: {
    fontSize: 48,
    fontWeight: '700',
    letterSpacing: 10,
    color: colors.text,
    textAlign: 'center',
    paddingVertical: 20,
    backgroundColor: colors.surface,
    borderRadius: 16,
    fontVariant: ['tabular-nums'],
  },
  actions: { gap: 10, paddingBottom: 8 },
});
