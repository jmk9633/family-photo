import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { TextField } from '@/components/TextField';
import { colors, size } from '@/components/tokens';
import { ko } from '@/copy/ko';
import { useSession } from '@/features/auth/session';
import {
  getGroup,
  listMembers,
  listOpenInvites,
  reissueInvite,
  removeMember,
  setMyDisplayName,
  type Group,
  type Invite,
  type Member,
} from '@/features/groups/api';
import {
  cleanName,
  formatInviteDeadline,
  isExpired,
  NAME_MAX,
  toGroupErrorMessage,
} from '@/features/groups/format';
import { requestWellbeingOffNotify } from '@/features/push/notify';
import {
  formatPhone,
  getMyWellbeing,
  listMemberPhones,
  nextRequestDay,
  requestWellbeing,
  setMyWellbeing,
  setWellbeingDays,
  stopWellbeing,
  WELLBEING_DAYS,
  type MyWellbeing,
} from '@/features/wellbeing/api';

// 그룹 화면: 구성원과 태그, 내 이름 바꾸기, 관리자의 초대하기·보낸 초대 목록,
// 관리자가 구성원을 누르면 전화번호(7-1, 안부 알림 '전화하기'용)·내보내기(F-LMXBXX), 맨 아래 그룹 나가기 (6단계).
// 전화번호는 관리자에게만 보인다 (member_phones, 0010). 연결된 기기·합치기는 각 단계에서 추가한다.
// 안부 확인 켜고 끄기 (7-2, F-MNBFHT):
//   관리자 — '안부 확인' 칸에서 기간 2·3·5·7일, 구성원을 누르면 '안부 확인 끄기' 또는 '켜 달라고 요청하기'
//            (요청 중·거절 뒤 다시 요청할 수 있는 날은 구성원 이름 아래에)
//   본인   — 안부 확인이 있었던 그룹이면 '내 안부 확인' 칸: 켜짐이면 끄기(관리자에게 알림), 본인이 껐으면 다시 켜기,
//            관리자가 요청했으면 좋아요·아니요 (결정 5)
export default function GroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useSession();
  const myId = session?.user.id;

  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [phones, setPhones] = useState<Record<string, string>>({});
  const [myWb, setMyWb] = useState<MyWellbeing | null>(null);
  const [wbBusy, setWbBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [reissuing, setReissuing] = useState<string | null>(null);

  const me = members.find((m) => m.user_id === myId);
  const isAdmin = !!me?.is_admin;

  const load = useCallback(() => {
    setFailed(false);
    Promise.all([
      getGroup(id),
      listMembers(id),
      listOpenInvites(id),
      listMemberPhones(id).catch(() => ({})),
      getMyWellbeing().catch(() => [] as MyWellbeing[]),
    ])
      .then(([g, m, inv, ph, wb]) => {
        setGroup(g);
        setMembers(m);
        setInvites(inv);
        setPhones(ph);
        setMyWb(wb.find((w) => w.group_id === id) ?? null);
        setLoaded(true);
      })
      .catch(() => setFailed(true));
  }, [id]);

  useFocusEffect(load);

  async function saveName() {
    const clean = cleanName(nameDraft);
    if (!clean) return;
    setSavingName(true);
    setNameError(null);
    try {
      await setMyDisplayName(id, clean);
      setEditing(false);
      load();
    } catch (e) {
      setNameError(toGroupErrorMessage(e));
    } finally {
      setSavingName(false);
    }
  }

  async function reissue(invite: Invite) {
    setReissuing(invite.id);
    setNotice(null);
    try {
      await reissueInvite(invite.id);
      setNotice(ko.group.reissued(invite.display_name));
    } catch (e) {
      setNotice(toGroupErrorMessage(e));
    } finally {
      setReissuing(null);
      load();
    }
  }

  function openPhone(m: Member) {
    router.push({
      pathname: '/group/[id]/phone',
      params: { id, member: m.id, name: m.display_name || ko.feed.unknownSender },
    });
  }

  // 관리자가 구성원을 누르면: 나 → 전화번호, 다른 사람 → 전화번호·내보내기 고르기
  function memberActions(m: Member) {
    if (m.user_id === myId) {
      openPhone(m);
      return;
    }
    const wbAction = m.wellbeing_check
      ? { text: ko.wellbeingAdmin.stop, onPress: () => confirmStopWellbeing(m) }
      : !m.wellbeing_requested_at && !nextRequestDay(m.wellbeing_declined_at)
        ? { text: ko.wellbeingAdmin.request, onPress: () => confirmRequestWellbeing(m) }
        : null;
    Alert.alert(m.display_name || ko.feed.unknownSender, undefined, [
      { text: ko.group.phoneAction, onPress: () => openPhone(m) },
      ...(wbAction ? [wbAction] : []),
      { text: ko.group.removeConfirm, style: 'destructive' as const, onPress: () => confirmRemove(m) },
      { text: ko.common.cancel, style: 'cancel' as const },
    ]);
  }

  function confirmStopWellbeing(m: Member) {
    const name = m.display_name || ko.feed.unknownSender;
    Alert.alert(ko.wellbeingAdmin.stopTitle(name), ko.wellbeingAdmin.stopText, [
      { text: ko.common.cancel, style: 'cancel' },
      {
        text: ko.wellbeingAdmin.stop,
        style: 'destructive',
        onPress: () => runNotice(() => stopWellbeing(m.id), ko.wellbeingAdmin.stopped(name)),
      },
    ]);
  }

  function confirmRequestWellbeing(m: Member) {
    const name = m.display_name || ko.feed.unknownSender;
    Alert.alert(ko.wellbeingAdmin.requestTitle(name), ko.wellbeingAdmin.requestText, [
      { text: ko.common.cancel, style: 'cancel' },
      {
        text: ko.wellbeingAdmin.requestConfirm,
        onPress: () => runNotice(() => requestWellbeing(m.id), ko.wellbeingAdmin.requested(name)),
      },
    ]);
  }

  async function runNotice(job: () => Promise<void>, done: string) {
    setNotice(null);
    try {
      await job();
      setNotice(done);
    } catch (e) {
      setNotice(toGroupErrorMessage(e));
    } finally {
      load();
    }
  }

  async function changeDays(days: number) {
    if (!group || group.wellbeing_days === days) return;
    const before = group.wellbeing_days;
    setGroup({ ...group, wellbeing_days: days });
    setNotice(null);
    try {
      await setWellbeingDays(id, days);
      setNotice(ko.wellbeingAdmin.daysSaved(days));
    } catch (e) {
      setGroup({ ...group, wellbeing_days: before });
      setNotice(toGroupErrorMessage(e));
    }
  }

  // 내 안부 확인 (본인): 끄기는 확인 후 관리자에게 알림, 다시 켜기·요청에 답하기는 바로
  async function changeMyWellbeing(on: boolean, askFirst: boolean) {
    if (askFirst) {
      Alert.alert(ko.myWellbeing.offConfirmTitle, ko.myWellbeing.offConfirmText, [
        { text: ko.myWellbeing.keep, style: 'cancel' },
        { text: ko.myWellbeing.turnOff, style: 'destructive', onPress: () => changeMyWellbeing(false, false) },
      ]);
      return;
    }
    const wasOn = !!myWb?.is_on;
    setWbBusy(true);
    setNotice(null);
    try {
      await setMyWellbeing(id, on);
      if (wasOn && !on) requestWellbeingOffNotify();
    } catch (e) {
      setNotice(toGroupErrorMessage(e));
    } finally {
      setWbBusy(false);
      load();
    }
  }

  function confirmRemove(m: Member) {
    const name = m.display_name || ko.feed.unknownSender;
    Alert.alert(ko.group.removeTitle(name), ko.group.removeText, [
      { text: ko.common.cancel, style: 'cancel' },
      {
        text: ko.group.removeConfirm,
        style: 'destructive',
        onPress: async () => {
          setNotice(null);
          try {
            await removeMember(m.id);
            setNotice(ko.group.removed(name));
          } catch (e) {
            setNotice(toGroupErrorMessage(e));
          } finally {
            load();
          }
        },
      },
    ]);
  }

  async function share(invite: Invite) {
    const deadline = formatInviteDeadline(invite.expires_at);
    await Share.share({
      message: ko.invite.shareMessage(group?.name ?? '', invite.code, deadline),
    });
  }

  const header = (
    <Stack.Screen
      options={{
        headerTitle: group?.name ?? '',
        headerRight: () =>
          isAdmin ? (
            <Button
              variant="text"
              label={ko.group.invite}
              onPress={() => router.push({ pathname: '/group/[id]/invite', params: { id } })}
            />
          ) : null,
      }}
    />
  );

  if (failed) {
    return (
      <SafeAreaView style={[styles.container, styles.center]} edges={['bottom']}>
        {header}
        <Text style={styles.muted}>{ko.groupErrors.loadFailed}</Text>
        <Button variant="outline" label={ko.common.retry} onPress={load} />
      </SafeAreaView>
    );
  }

  if (!loaded) {
    return (
      <SafeAreaView style={[styles.container, styles.center]} edges={['bottom']}>
        {header}
        <ActivityIndicator color={colors.accent} accessibilityLabel={ko.common.loading} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {header}
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {isAdmin && members.length === 1 ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>{ko.group.inviteBanner}</Text>
            <Button
              label={ko.group.invite}
              onPress={() => router.push({ pathname: '/group/[id]/invite', params: { id } })}
            />
          </View>
        ) : null}

        <Button
          label={ko.group.send}
          onPress={() => router.push({ pathname: '/send', params: { group: id } })}
        />

        {notice ? (
          <Text style={styles.notice} accessibilityLiveRegion="polite">
            {notice}
          </Text>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{ko.group.members(members.length)}</Text>
          <View style={styles.card}>
            {members.map((m, i) => {
              const isMe = m.user_id === myId;
              const label = m.display_name || ko.feed.unknownSender;
              const phone = phones[m.id];
              return (
                <Pressable
                  key={m.id}
                  disabled={!isAdmin}
                  accessibilityRole={isAdmin ? 'button' : undefined}
                  accessibilityLabel={
                    isAdmin ? (isMe ? ko.group.memberLabelSelf(label) : ko.group.memberLabelAdmin(label)) : undefined
                  }
                  onPress={() => memberActions(m)}
                  style={({ pressed }) => [styles.row, i > 0 && styles.rowDivider, pressed && styles.pressed]}
                >
                  <View style={styles.memberTop}>
                    <Text style={styles.memberName}>
                      {m.display_name || '—'}
                      {m.user_id === myId ? <Text style={styles.muted}> {ko.group.me}</Text> : null}
                    </Text>
                    {isAdmin ? <Text style={styles.more}>⋯</Text> : null}
                  </View>
                  {phone ? <Text style={styles.muted}>{formatPhone(phone)}</Text> : null}
                  {isAdmin && !m.wellbeing_check ? <WellbeingStatus member={m} /> : null}
                  <View style={styles.tagRow}>
                    {m.is_admin ? <Tag label={ko.group.tags.admin} strong /> : null}
                    {m.easy_mode ? <Tag label={ko.group.tags.easy} /> : null}
                    {m.wellbeing_check ? <Tag label={ko.group.tags.wellbeing} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        {myWb ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{ko.myWellbeing.title}</Text>
            <View style={[styles.card, styles.row]}>
              <View style={styles.memberTop}>
                <Text style={styles.memberName}>{ko.myWellbeing.title}</Text>
                <Text style={[styles.muted, myWb.is_on && styles.onText]}>
                  {myWb.is_on ? ko.myWellbeing.on : ko.myWellbeing.off}
                </Text>
              </View>
              {myWb.requested ? (
                <>
                  <Text style={styles.body16}>{ko.myWellbeing.generalConsentTitle(group?.name ?? '', myWb.ever_on)}</Text>
                  <Text style={styles.muted}>{ko.myWellbeing.generalConsentText}</Text>
                  <View style={styles.inlineButtons}>
                    <Button variant="outline" label={ko.myWellbeing.no} disabled={wbBusy} onPress={() => changeMyWellbeing(false, false)} style={styles.flex} />
                    <Button label={ko.myWellbeing.yes} loading={wbBusy} onPress={() => changeMyWellbeing(true, false)} style={styles.flex} />
                  </View>
                </>
              ) : myWb.is_on ? (
                <>
                  <Text style={styles.muted}>{ko.myWellbeing.generalHintOn(myWb.days)}</Text>
                  <Button variant="outline" label={ko.myWellbeing.turnOff} loading={wbBusy} onPress={() => changeMyWellbeing(false, true)} />
                </>
              ) : myWb.can_turn_on ? (
                <>
                  <Text style={styles.muted}>{ko.myWellbeing.hintOff}</Text>
                  <Button variant="outline" label={ko.myWellbeing.turnOn} loading={wbBusy} onPress={() => changeMyWellbeing(true, false)} />
                </>
              ) : (
                <Text style={styles.muted}>{ko.myWellbeing.adminOff}</Text>
              )}
            </View>
          </View>
        ) : null}

        {isAdmin && group?.wellbeing_days ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{ko.wellbeingAdmin.section}</Text>
            <View style={[styles.card, styles.row]}>
              <Text style={styles.memberName}>{ko.wellbeingAdmin.daysLabel}</Text>
              <View style={styles.chips} accessibilityRole="radiogroup">
                {WELLBEING_DAYS.map((d) => {
                  const on = group.wellbeing_days === d;
                  return (
                    <Pressable
                      key={d}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      onPress={() => changeDays(d)}
                      style={({ pressed }) => [styles.chip, on && styles.chipOn, pressed && styles.pressed]}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{ko.wellbeingAdmin.days(d)}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.muted}>{ko.wellbeingAdmin.daysHint}</Text>
            </View>
          </View>
        ) : null}

        {editing ? (
          <View style={styles.section}>
            <TextField
              label={ko.group.myNameTitle}
              value={nameDraft}
              onChangeText={(t) => {
                setNameDraft(t);
                if (nameError) setNameError(null);
              }}
              maxLength={NAME_MAX}
              error={nameError}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={saveName}
            />
            <View style={styles.inlineButtons}>
              <Button
                variant="outline"
                label={ko.common.cancel}
                onPress={() => setEditing(false)}
                style={styles.flex}
              />
              <Button
                label={ko.common.save}
                onPress={saveName}
                loading={savingName}
                disabled={cleanName(nameDraft).length === 0}
                style={styles.flex}
              />
            </View>
          </View>
        ) : me ? (
          <Button
            variant="outline"
            label={ko.group.myName}
            onPress={() => {
              setNameDraft(me.display_name);
              setEditing(true);
            }}
          />
        ) : null}

        {isAdmin && invites.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{ko.group.invites}</Text>
            <Text style={styles.muted}>{ko.group.invitesHint}</Text>
            <View style={styles.card}>
              {invites.map((inv, i) => {
                const expired = isExpired(inv.expires_at);
                return (
                  <View key={inv.id} style={[styles.row, i > 0 && styles.rowDivider]}>
                    <Text style={styles.memberName}>{inv.display_name}</Text>
                    <Text style={styles.muted}>
                      {expired
                        ? ko.group.expired
                        : `${inv.code} · ${formatInviteDeadline(inv.expires_at)}`}
                    </Text>
                    <View style={styles.inlineButtons}>
                      {!expired ? (
                        <Button
                          variant="outline"
                          label={ko.group.shareAgain}
                          onPress={() => share(inv)}
                          style={styles.flex}
                        />
                      ) : null}
                      <Button
                        variant="outline"
                        label={ko.group.reissue}
                        loading={reissuing === inv.id}
                        onPress={() => reissue(inv)}
                        style={styles.flex}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {me ? (
          <Button
            variant="text"
            label={ko.group.leave}
            onPress={() => router.push({ pathname: '/group/[id]/leave', params: { id } })}
            style={styles.leave}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/** 관리자에게만: 꺼진 구성원의 요청 중·거절 상태 */
function WellbeingStatus({ member }: { member: Member }) {
  if (member.wellbeing_requested_at) return <Text style={styles.muted}>{ko.wellbeingAdmin.pending}</Text>;
  const next = nextRequestDay(member.wellbeing_declined_at);
  if (next) return <Text style={styles.muted}>{ko.wellbeingAdmin.declined(next.month, next.day)}</Text>;
  return null;
}

function Tag({ label, strong }: { label: string; strong?: boolean }) {
  return (
    <View style={[styles.tag, strong && styles.tagStrong]}>
      <Text style={[styles.tagText, strong && styles.tagTextStrong]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: size.gutter },
  center: { justifyContent: 'center', alignItems: 'center', gap: 16 },
  body: { gap: 24, paddingTop: 8, paddingBottom: 32 },
  muted: { fontSize: size.small, lineHeight: 21, color: colors.textSecondary, fontWeight: '400' },
  notice: {
    fontSize: size.small,
    lineHeight: 21,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: size.radius,
    padding: 14,
  },

  banner: { gap: 12, padding: 16, borderRadius: 16, backgroundColor: colors.surface },
  bannerText: { fontSize: size.body, fontWeight: '600', color: colors.text },

  section: { gap: 10 },
  sectionTitle: { fontSize: size.small, fontWeight: '700', color: colors.textSecondary },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: size.radius },
  row: { paddingVertical: 14, paddingHorizontal: 16, gap: 8 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  memberName: { flex: 1, fontSize: size.body, fontWeight: '700', color: colors.text },
  memberTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  more: { fontSize: 22, color: colors.textSecondary, paddingHorizontal: 4 },
  pressed: { opacity: 0.6 },
  leave: { marginTop: 8 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: colors.surface },
  tagStrong: { backgroundColor: colors.text },
  tagText: { fontSize: 13, color: colors.text },
  tagTextStrong: { color: '#FFFFFF' },
  inlineButtons: { flexDirection: 'row', gap: 10 },
  body16: { fontSize: size.body, lineHeight: 24, fontWeight: '600', color: colors.text },
  onText: { color: colors.accent, fontWeight: '700' },
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    flex: 1,
    minHeight: 48,
    borderRadius: size.radius,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { fontSize: size.body, fontWeight: '600', color: colors.text },
  chipTextOn: { color: '#FFFFFF' },
});
