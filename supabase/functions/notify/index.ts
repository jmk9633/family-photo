// notify — 푸시 알림 보내기 (개발 5단계 후반, 10/17 결정 A: 앱이 요청하고 서버가 다시 확인한다)
//
// 앱이 { type, postId }로 부른다. 부른 사람(JWT)이 정말 그 일을 했는지 DB로 다시 확인하고,
// notification_log(0004)에 먼저 한 줄을 넣어 성공했을 때만 Expo 푸시 서비스로 보낸다.
// 그래서 같은 요청이 여러 번 와도 알림은 한 번이고, 앱이 거짓 요청을 보내도 아무 일도 없다.
//
//   new_post: 내가 보낸 묶음이 완료(ready)됐다 → 받은 그룹의 다른 활성 구성원에게
//   heart   : 내가 그 묶음의 사진에 하트를 눌렀다 → 보낸 사람에게 (사람·묶음당 첫 하트만)
//   seen    : 내가 그 묶음을 오늘 봤다 → 보낸 사람에게 (사람·묶음·날짜당 한 번, 시청 표시를 끈 사람은 안 보냄)
//   joined  : 내가 초대 코드로 그 그룹에 방금(10분 안) 들어왔다 → 그 그룹의 다른 활성 구성원 모두에게
//             ({ type, groupId }, 같은 합류는 한 번 — join_notification_log 0006, 6단계 10/18 결정)
//   admin_changed: 내가 그 그룹을 방금(10분 안) 나가 관리자가 자동으로 넘어갔다 → 새 관리자와 그룹 구성원 모두에게
//             ({ type, groupId }, 이전 한 건당 한 번 — admin_transfer_log 0007, F-LMXBXX)
//
// 이름은 받는 사람이 보는 그룹에서의 이름 (그 묶음을 받은 그룹 중 받는 사람이 먼저 들어간 그룹).
//
// 밤 알림 모으기 (6-3, 0009): 밤 9시~아침 8시(한국 시간)에는 쉬운 화면 사용자에게 가는 알림을 종류와 상관없이
// 보내지 않고 night_queue에 넣는다. 아침 8시에 pg_cron이 send_night_digest()로 한 사람당 하나로 묶어 보낸다.
// 시험할 때는 `npx supabase secrets set NOTIFY_FORCE_NIGHT=1`로 낮에도 밤처럼 모은다 (끝나면 unset).
//
// 배포: npx supabase functions deploy notify  (JWT 확인은 기본값 그대로 켜 둔다)

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';

type Kind = 'new_post' | 'heart' | 'seen';
const KINDS: Kind[] = ['new_post', 'heart', 'seen'];
const JOIN_FRESH_MS = 10 * 60 * 1000;

/** 한국 시간 밤 9시~아침 8시인가 (시험용 NOTIFY_FORCE_NIGHT=1이면 항상 밤) */
function isNightKst(): boolean {
  if (Deno.env.get('NOTIFY_FORCE_NIGHT') === '1') return true;
  const hour = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCHours();
  return hour >= 21 || hour < 8;
}
const NOT_DAILY = '1970-01-01';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// 알림 문구 (10/17 사용자 확인)
const copy = {
  newPost: {
    title: '새 사진이 왔어요',
    body: (name: string, what: string) => `${iga(name)} ${what} 보냈어요`,
    videoMessage: (name: string) => `${iga(name)} 영상 한마디를 보냈어요`,
  },
  heart: { title: '하트를 받았어요', body: (name: string) => `${iga(name)} 보낸 사진을 좋아해요` },
  seen: { title: '가족이 사진을 봤어요', body: (name: string) => `${iga(name)} 보낸 사진을 봤어요` },
  joined: { title: '가족이 들어왔어요', body: (name: string, group: string) => `${iga(name)} ${group}에 들어왔어요` },
  adminMe: { title: '관리자가 되었어요', body: (group: string) => `이제 ${group}의 관리자예요. 가족을 초대하고 설정을 바꿀 수 있어요` },
  adminOthers: { title: '관리자가 바뀌었어요', body: (name: string, group: string) => `이제 ${iga(name)} ${group}의 관리자예요` },
  family: '가족',
};

/** 이름 뒤 '이/가' (앱의 ko.ts와 같은 규칙) */
function iga(name: string): string {
  const t = name.trim();
  const c = t.charCodeAt(t.length - 1);
  const hasFinal = c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0;
  return `${t}${hasFinal ? '이' : '가'}`;
}

/** '사진 3장을' / '영상 1개를' / '사진 2장과 영상 1개를' */
function mediaPhrase(photos: number, videos: number): string {
  if (photos && videos) return `사진 ${photos}장과 영상 ${videos}개를`;
  if (videos) return `영상 ${videos}개를`;
  return `사진 ${photos}장을`;
}

function kstToday(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** service role(비밀) 키: 새 방식(SUPABASE_SECRET_KEYS)이 있으면 그것, 없으면 예전 키 */
function secretKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    try {
      const parsed = JSON.parse(keys) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch {
      // 아래 예전 키로
    }
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!legacy) throw new Error('no service key');
  return legacy;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method' });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1) 부른 사람
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !userData.user) return json(401, { error: 'auth' });
  const me = userData.user.id;

  let input: { type?: string; postId?: string; groupId?: string };
  try {
    input = await req.json();
  } catch {
    return json(400, { error: 'body' });
  }
  if (input.type === 'joined') return await handleJoined(admin, me, input.groupId ?? '');
  if (input.type === 'admin_changed') return await handleAdminChanged(admin, me, input.groupId ?? '');
  const kind = input.type as Kind;
  const postId = input.postId ?? '';
  if (!KINDS.includes(kind) || !/^[0-9a-f-]{36}$/i.test(postId)) return json(400, { error: 'input' });

  // 2) 묶음 (완료된 것만)
  const { data: post } = await admin
    .from('posts')
    .select('id, kind, sender_id, status, post_groups(group_id), media(type)')
    .eq('id', postId)
    .maybeSingle();
  if (!post || post.status !== 'ready') return json(200, { sent: 0, reason: 'post' });
  const groupIds: string[] = (post.post_groups ?? []).map((g: { group_id: string }) => g.group_id);

  // 3) 그 일을 정말 했는지 + 받을 사람
  let recipients: string[] = [];
  let onDate = NOT_DAILY;

  if (kind === 'new_post') {
    if (post.sender_id !== me) return json(200, { sent: 0, reason: 'not_sender' });
    const { data: members } = await admin
      .from('members')
      .select('user_id')
      .in('group_id', groupIds)
      .eq('status', 'active');
    recipients = [...new Set((members ?? []).map((m: { user_id: string }) => m.user_id))].filter((u) => u !== me);
  } else {
    if (post.sender_id === me) return json(200, { sent: 0, reason: 'own_post' });
    if (kind === 'heart') {
      const { count } = await admin
        .from('reactions')
        .select('media_id, media!inner(post_id)', { count: 'exact', head: true })
        .eq('user_id', me)
        .eq('media.post_id', postId);
      if (!count) return json(200, { sent: 0, reason: 'no_heart' });
    } else {
      onDate = kstToday();
      const { count } = await admin
        .from('post_views')
        .select('post_id', { count: 'exact', head: true })
        .eq('post_id', postId)
        .eq('user_id', me)
        .eq('viewed_on', onDate);
      if (!count) return json(200, { sent: 0, reason: 'no_view' });
      const { data: profile } = await admin.from('profiles').select('show_seen').eq('id', me).maybeSingle();
      if (!profile?.show_seen) return json(200, { sent: 0, reason: 'seen_hidden' });
    }
    // 보낸 사람이 아직 받은 그룹 중 하나에 있어야 받는다
    const { count: senderIn } = await admin
      .from('members')
      .select('id', { count: 'exact', head: true })
      .in('group_id', groupIds)
      .eq('user_id', post.sender_id)
      .eq('status', 'active');
    recipients = senderIn ? [post.sender_id] : [];
  }
  if (recipients.length === 0) return json(200, { sent: 0, reason: 'no_recipient' });

  // 4) 한 번만: 기록을 먼저 넣는다 (이미 있으면 보낸 알림)
  const { error: logError } = await admin
    .from('notification_log')
    .insert({ kind, post_id: postId, actor_id: me, on_date: onDate });
  if (logError) {
    if (logError.code === '23505') return json(200, { sent: 0, reason: 'already' });
    throw logError;
  }

  try {
    const sent = await deliver(admin, kind, post, groupIds, me, recipients);
    return json(200, { sent });
  } catch (e) {
    // 보내지 못했으면 기록을 지워 다음 요청 때 다시 보낼 수 있게 한다
    await admin.from('notification_log').delete().match({ kind, post_id: postId, actor_id: me, on_date: onDate });
    console.error('[notify] deliver failed', e);
    return json(502, { error: 'deliver' });
  }
});

type PostRow = { id: string; kind?: string; sender_id: string; media: { type: string }[] | null };

async function deliver(
  admin: SupabaseClient,
  kind: Kind,
  post: PostRow,
  groupIds: string[],
  actor: string,
  recipients: string[],
): Promise<number> {
  // 받는 사람마다: 그 묶음을 받은 그룹 중 먼저 들어간 그룹에서의 '한 사람'의 이름
  const { data: rows } = await admin
    .from('members')
    .select('group_id, user_id, display_name, joined_at')
    .in('group_id', groupIds)
    .in('user_id', [...recipients, actor]);
  const members = (rows ?? []) as { group_id: string; user_id: string; display_name: string; joined_at: string }[];
  const nameFor = (recipient: string) => {
    const order = members
      .filter((m) => m.user_id === recipient)
      .sort((a, b) => a.joined_at.localeCompare(b.joined_at))
      .map((m) => m.group_id);
    for (const g of order) {
      const n = members.find((m) => m.group_id === g && m.user_id === actor)?.display_name;
      if (n) return n;
    }
    return members.find((m) => m.user_id === actor && m.display_name)?.display_name ?? copy.family;
  };

  const photos = (post.media ?? []).filter((m) => m.type === 'photo').length;
  const videos = (post.media ?? []).filter((m) => m.type === 'video').length;
  const text = (recipient: string) => {
    const name = nameFor(recipient);
    if (kind === 'new_post') {
      if (post.kind === 'video_message') return { title: copy.newPost.title, body: copy.newPost.videoMessage(name) };
      return { title: copy.newPost.title, body: copy.newPost.body(name, mediaPhrase(photos, videos)) };
    }
    if (kind === 'heart') return { title: copy.heart.title, body: copy.heart.body(name) };
    return { title: copy.seen.title, body: copy.seen.body(name) };
  };

  return await pushTo(admin, recipients, text, { postId: post.id, kind }, nameFor);
}

/** 받는 사람들의 활성 기기로 보낸다. 보낸 수를 돌려준다. */
async function pushTo(
  admin: SupabaseClient,
  recipients: string[],
  text: (recipient: string) => { title: string; body: string },
  data: Record<string, string>,
  actorName?: (recipient: string) => string,
): Promise<number> {
  // 밤이면 쉬운 화면 사용자 몫은 아침 알림으로 모은다
  if (isNightKst() && recipients.length > 0) {
    const { data: easy } = await admin.from('profiles').select('id').in('id', recipients).eq('easy_mode', true);
    const easyIds = new Set(((easy ?? []) as { id: string }[]).map((p) => p.id));
    if (easyIds.size > 0) {
      const rows = [...easyIds].map((r) => ({
        user_id: r,
        kind: data.kind,
        post_id: data.postId ?? null,
        group_id: data.groupId ?? null,
        actor_name: actorName ? actorName(r) : null,
        ...text(r),
      }));
      const { error } = await admin.from('night_queue').insert(rows);
      if (error) throw error;
      recipients = recipients.filter((r) => !easyIds.has(r));
      if (recipients.length === 0) return 0;
    }
  }
  // 기기: 활성 + 토큰 있음. 같은 토큰이 여러 계정에 남아 있으면 가장 최근에 쓴 계정에게만 보낸다
  const { data: deviceRows } = await admin
    .from('devices')
    .select('id, user_id, push_token, last_seen_at')
    .not('push_token', 'is', null)
    .eq('status', 'active')
    .in('user_id', recipients);
  const owners = await latestOwners(admin, (deviceRows ?? []).map((d: { push_token: string }) => d.push_token));
  const devices = ((deviceRows ?? []) as { id: string; user_id: string; push_token: string }[]).filter(
    (d) => owners.get(d.push_token) === d.user_id,
  );
  if (devices.length === 0) return 0;

  const messages = devices.map((d) => ({
    to: d.push_token,
    sound: 'default',
    ...text(d.user_id),
    data,
  }));

  let sent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) throw new Error(`expo push ${res.status}: ${await res.text()}`);
    const { data: tickets } = (await res.json()) as {
      data: { status: 'ok' | 'error'; details?: { error?: string } }[];
    };
    for (let j = 0; j < tickets.length; j++) {
      if (tickets[j].status === 'ok') sent++;
      else if (tickets[j].details?.error === 'DeviceNotRegistered') {
        // 앱을 지웠거나 토큰이 바뀐 폰: 다시 보내지 않게 끊는다
        await admin.from('devices').update({ status: 'revoked', push_token: null }).eq('push_token', chunk[j].to);
      } else console.warn('[notify] ticket error', tickets[j]);
    }
  }
  return sent;
}

/** 합류 알림: 방금 그 그룹에 들어온 사람만 부를 수 있고, 같은 합류는 한 번만 보낸다 */
async function handleJoined(admin: SupabaseClient, me: string, groupId: string): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(groupId)) return json(400, { error: 'input' });
  const { data: member } = await admin
    .from('members')
    .select('id, display_name, joined_at, status')
    .eq('group_id', groupId)
    .eq('user_id', me)
    .maybeSingle();
  if (!member || member.status !== 'active') return json(200, { sent: 0, reason: 'not_member' });
  // 이미 있던 구성원이 같은 코드를 또 넣으면(서버가 바로 ok) 알리지 않는다
  if (Date.now() - new Date(member.joined_at).getTime() > JOIN_FRESH_MS) {
    return json(200, { sent: 0, reason: 'not_fresh' });
  }
  const { data: group } = await admin.from('groups').select('name, status').eq('id', groupId).maybeSingle();
  if (!group || group.status !== 'active') return json(200, { sent: 0, reason: 'group' });
  const { data: others } = await admin
    .from('members')
    .select('user_id')
    .eq('group_id', groupId)
    .eq('status', 'active')
    .neq('user_id', me);
  const recipients = (others ?? []).map((m: { user_id: string }) => m.user_id);
  if (recipients.length === 0) return json(200, { sent: 0, reason: 'no_recipient' });

  const { error: logError } = await admin
    .from('join_notification_log')
    .insert({ member_id: member.id, joined_at: member.joined_at });
  if (logError) {
    if (logError.code === '23505') return json(200, { sent: 0, reason: 'already' });
    throw logError;
  }
  const name = member.display_name || copy.family;
  try {
    const sent = await pushTo(
      admin,
      recipients,
      () => ({ title: copy.joined.title, body: copy.joined.body(name, group.name) }),
      { groupId, kind: 'joined' },
      () => name,
    );
    return json(200, { sent });
  } catch (e) {
    await admin.from('join_notification_log').delete().match({ member_id: member.id, joined_at: member.joined_at });
    console.error('[notify] joined deliver failed', e);
    return json(502, { error: 'deliver' });
  }
}

/** 관리자 자동 이전 알림: 그 그룹을 방금 나간 사람(또는 지금 구성원)만 부를 수 있고, 이전 한 건당 한 번 */
async function handleAdminChanged(admin: SupabaseClient, me: string, groupId: string): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(groupId)) return json(400, { error: 'input' });
  const since = new Date(Date.now() - JOIN_FRESH_MS).toISOString();
  const { data: mine } = await admin
    .from('members')
    .select('status, left_at')
    .eq('group_id', groupId)
    .eq('user_id', me)
    .maybeSingle();
  const allowed = !!mine && (mine.status === 'active' || (!!mine.left_at && mine.left_at >= since));
  if (!allowed) return json(200, { sent: 0, reason: 'not_member' });

  // 아직 안 알린 최근 이전 기록을 '알림'으로 표시하면서 가져온다 (동시에 불러도 한 번만)
  const { data: logs } = await admin
    .from('admin_transfer_log')
    .update({ notified_at: new Date().toISOString() })
    .eq('group_id', groupId)
    .is('notified_at', null)
    .gte('created_at', since)
    .select('id, member_id');
  if (!logs || logs.length === 0) return json(200, { sent: 0, reason: 'none' });

  const { data: group } = await admin.from('groups').select('name').eq('id', groupId).maybeSingle();
  const { data: active } = await admin
    .from('members')
    .select('id, user_id, display_name')
    .eq('group_id', groupId)
    .eq('status', 'active');
  const members = (active ?? []) as { id: string; user_id: string; display_name: string }[];
  let sent = 0;
  for (const log of logs as { id: string; member_id: string }[]) {
    const newAdmin = members.find((m) => m.id === log.member_id);
    if (!newAdmin) continue;
    const name = newAdmin.display_name || copy.family;
    const groupName = group?.name ?? '';
    try {
      sent += await pushTo(
        admin,
        members.map((m) => m.user_id),
        (r) =>
          r === newAdmin.user_id
            ? { title: copy.adminMe.title, body: copy.adminMe.body(groupName) }
            : { title: copy.adminOthers.title, body: copy.adminOthers.body(name, groupName) },
        { groupId, kind: 'admin_changed' },
        () => name,
      );
    } catch (e) {
      await admin.from('admin_transfer_log').update({ notified_at: null }).eq('id', log.id);
      console.error('[notify] admin_changed deliver failed', e);
      return json(502, { error: 'deliver' });
    }
  }
  return json(200, { sent });
}

/** 토큰 → 그 토큰을 가장 최근에 쓴 계정 */
async function latestOwners(admin: SupabaseClient, tokens: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (tokens.length === 0) return out;
  const { data } = await admin
    .from('devices')
    .select('user_id, push_token, last_seen_at')
    .in('push_token', [...new Set(tokens)])
    .eq('status', 'active')
    .order('last_seen_at', { ascending: false, nullsFirst: false });
  for (const d of (data ?? []) as { user_id: string; push_token: string }[]) {
    if (!out.has(d.push_token)) out.set(d.push_token, d.user_id);
  }
  return out;
}
