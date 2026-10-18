import { supabase } from '@/lib/supabase';

// 그룹·구성원·초대 데이터 읽기와 RPC 호출.
// 여러 표를 함께 바꾸는 일은 DB 함수(RPC)로만 한다 (CLAUDE.md 보안 규칙 6).

export type Group = { id: string; name: string };

export type Member = {
  id: string;
  user_id: string;
  display_name: string;
  is_admin: boolean;
  easy_mode: boolean;
  wellbeing_check: boolean;
  joined_at: string;
};

export type Invite = {
  id: string;
  code: string;
  display_name: string;
  preset_is_admin: boolean;
  preset_easy_mode: boolean;
  preset_wellbeing_check: boolean;
  expires_at: string;
};

export type InviteTags = { isAdmin: boolean; easyMode: boolean; wellbeing: boolean };

export type IssuedInvite = { invite_id: string; code: string; expires_at: string };

export type RedeemStatus =
  | 'ok'
  | 'invalid'
  | 'expired'
  | 'revoked'
  | 'used'
  | 'group_full'
  | 'too_many_attempts';

/** 내가 활성 구성원인 그룹 (오래된 순) */
export async function listMyGroups(userId: string): Promise<Group[]> {
  const { data, error } = await supabase
    .from('members')
    .select('joined_at, groups!inner(id, name, status)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .eq('groups.status', 'active')
    .order('joined_at');
  if (error) throw error;
  return (data ?? []).map((row) => {
    const g = row.groups as unknown as Group;
    return { id: g.id, name: g.name };
  });
}

/** 새 그룹·초대에서 기본으로 채울 내 이름 (카카오·구글 이름) */
export async function getMyDefaultName(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data?.display_name ?? '';
}

export async function getGroup(groupId: string): Promise<Group | null> {
  const { data, error } = await supabase
    .from('groups')
    .select('id, name')
    .eq('id', groupId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listMembers(groupId: string): Promise<Member[]> {
  const { data, error } = await supabase
    .from('members')
    .select('id, user_id, display_name, is_admin, easy_mode, wellbeing_check, joined_at')
    .eq('group_id', groupId)
    .eq('status', 'active')
    .order('joined_at');
  if (error) throw error;
  return data ?? [];
}

/** 아직 쓰지 않았고 바뀌지 않은 초대 (관리자만 보인다. 기한 지난 것도 '새 코드 받기'를 위해 포함) */
export async function listOpenInvites(groupId: string): Promise<Invite[]> {
  const { data, error } = await supabase
    .from('invites')
    .select('id, code, display_name, preset_is_admin, preset_easy_mode, preset_wellbeing_check, expires_at')
    .eq('group_id', groupId)
    .is('used_at', null)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createGroup(name: string, myName: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_group', {
    p_name: name,
    p_display_name: myName,
  });
  if (error) throw error;
  return data as string;
}

export async function setMyDisplayName(groupId: string, name: string): Promise<void> {
  const { error } = await supabase.rpc('set_my_display_name', {
    p_group: groupId,
    p_display_name: name,
  });
  if (error) throw error;
}

export async function createInvite(
  groupId: string,
  displayName: string,
  tags: InviteTags,
): Promise<IssuedInvite> {
  const { data, error } = await supabase.rpc('create_invite', {
    p_group: groupId,
    p_display_name: displayName,
    p_is_admin: tags.isAdmin,
    p_easy_mode: tags.easyMode,
    p_wellbeing: tags.wellbeing,
  });
  if (error) throw error;
  return (data as IssuedInvite[])[0];
}

export async function reissueInvite(inviteId: string): Promise<IssuedInvite> {
  const { data, error } = await supabase.rpc('reissue_invite', { p_invite: inviteId });
  if (error) throw error;
  return (data as IssuedInvite[])[0];
}

/**
 * 그룹 나가기 (0007). deleteMine이면 다른 그룹에도 보낸 내 묶음은 이 그룹에서만 빠지고,
 * 이 그룹에만 보낸 내 묶음은 'deleting'이 되어 ID가 돌아온다 → 앱이 파일과 함께 지운다.
 */
export async function leaveGroup(groupId: string, deleteMine: boolean): Promise<{ deleting: string[] }> {
  const { data, error } = await supabase.rpc('leave_group', { p_group: groupId, p_delete_my_posts: deleteMine });
  if (error) throw error;
  return { deleting: ((data as { deleting?: string[] } | null)?.deleting ?? []) };
}

/** 관리자가 다른 구성원을 내보낸다 (0007). 올린 사진은 남는다. */
export async function removeMember(memberId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_member', { p_member: memberId });
  if (error) throw error;
}

export async function redeemInvite(
  code: string,
): Promise<{ status: RedeemStatus; groupId?: string }> {
  const { data, error } = await supabase.rpc('redeem_invite', { p_code: code });
  if (error) throw error;
  const result = data as { status: RedeemStatus; group_id?: string };
  return { status: result.status, groupId: result.group_id };
}
