import { supabase } from '@/lib/supabase';

// 그룹·구성원·초대 데이터 읽기와 RPC 호출.
// 여러 표를 함께 바꾸는 일은 DB 함수(RPC)로만 한다 (CLAUDE.md 보안 규칙 6).

export type Group = { id: string; name: string; wellbeing_days?: number };

export type Member = {
  id: string;
  user_id: string;
  display_name: string;
  is_admin: boolean;
  easy_mode: boolean;
  wellbeing_check: boolean;
  /** 관리자가 안부 확인을 켜 달라고 요청한 시각 (본인 답을 기다리는 중) */
  wellbeing_requested_at: string | null;
  /** 본인이 '아니요'를 누른 시각 (7일 동안 다시 요청 못 함, 0011) */
  wellbeing_declined_at: string | null;
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
    .select('id, name, wellbeing_days')
    .eq('id', groupId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listMembers(groupId: string): Promise<Member[]> {
  const { data, error } = await supabase
    .from('members')
    .select('id, user_id, display_name, is_admin, easy_mode, wellbeing_check, wellbeing_requested_at, wellbeing_declined_at, joined_at')
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

/** 내가 나가면 남는 사람이 모두 가입 없이 들어온 사람이라 관리할 사람이 없어지는지 (0008) */
export async function getLeaveWarning(groupId: string): Promise<{ noManager: boolean }> {
  const { data, error } = await supabase.rpc('leave_warning', { p_group: groupId });
  if (error) throw error;
  return { noManager: !!(data as { no_manager?: boolean } | null)?.no_manager };
}

/**
 * 관리자가 다른 구성원을 내보낸다 (0007·0013). 기본은 올린 사진을 남긴다.
 * deletePosts면 그 사람이 이 그룹에만 보낸 사진은 지우고(새벽 정리가 파일까지), 다른 가족에도 보낸 사진은 이 그룹에서만 뺀다.
 */
export async function removeMember(memberId: string, deletePosts = false): Promise<void> {
  const { error } = await supabase.rpc('remove_member', { p_member: memberId, p_delete_posts: deletePosts });
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
