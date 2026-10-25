// 위젯 바로 바꾸기 신호 (개발 8-2, F-NGOJFO, 0015)
//
// iOS 26부터 애플이 제공하는 'WidgetKit 푸시'로, 새 묶음이 완료되면 받은 가족의 위젯에 "다시 그려" 신호를 보낸다.
// 알림이 아니라서 화면에 아무것도 뜨지 않고, 위젯이 서버(Edge Function `widget`)에서 최신 사진을 다시 받아 간다.
// Expo 푸시 서비스는 이 종류를 지원하지 않아 애플(APNs)에 직접 보낸다.
//
// 필요한 비밀값 (npx supabase secrets set ...):
//   APNS_KEY_ID          애플 개발자 사이트 Keys에서 만든 APNs 키의 Key ID (10자리)
//   APNS_TEAM_ID         팀 ID (2LSRUZU8A8)
//   APNS_PRIVATE_KEY_B64 그 키 파일(AuthKey_XXXX.p8) 내용을 base64로 한 줄로 만든 것
//   APNS_WIDGET_TOPIC    (선택) 기본 'com.jmk9633.familyphoto.push-type.widgets'
// 비밀값이 없으면 아무것도 보내지 않는다 (위젯은 30분 확인으로 바뀐다).
//
// 신호는 '봤어요'·활동이 아니다. 여기서는 신호 주소 목록을 읽고, 없는 주소를 지우는 것 말고는 DB를 바꾸지 않는다.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';

const HOSTS = {
  sandbox: 'https://api.sandbox.push.apple.com',
  production: 'https://api.push.apple.com',
} as const;
const DEFAULT_TOPIC = 'com.jmk9633.familyphoto.push-type.widgets';
// 애플 안내: 서명 토큰은 20분~60분 사이에 새로 만든다
const TOKEN_TTL_MS = 50 * 60 * 1000;

let cached: { jwt: string; at: number } | null = null;

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** .p8 파일 내용(PEM)에서 키 부분만 꺼낸다 */
export function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(/-----BEGIN [A-Z ]+-----/, '')
    .replace(/-----END [A-Z ]+-----/, '')
    .replace(/\s+/g, '');
  return b64ToBytes(body);
}

/** APNs 서명 토큰 (ES256 JWT). 비밀값이 없으면 null */
export async function providerToken(now = Date.now()): Promise<string | null> {
  const keyId = Deno.env.get('APNS_KEY_ID');
  const teamId = Deno.env.get('APNS_TEAM_ID');
  const keyB64 = Deno.env.get('APNS_PRIVATE_KEY_B64');
  if (!keyId || !teamId || !keyB64) return null;
  if (cached && now - cached.at < TOKEN_TTL_MS) return cached.jwt;

  const pem = new TextDecoder().decode(b64ToBytes(keyB64.trim()));
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(pem),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ alg: 'ES256', kid: keyId })));
  const claims = b64url(enc.encode(JSON.stringify({ iss: teamId, iat: Math.floor(now / 1000) })));
  // WebCrypto의 ECDSA 서명은 JWT가 요구하는 r||s(64바이트) 모양 그대로다
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`)),
  );
  const jwt = `${header}.${claims}.${b64url(sig)}`;
  cached = { jwt, at: now };
  return jwt;
}

type Target = { push_token: string; push_env: 'sandbox' | 'production' };

/** 이 묶음을 받은 가족의 위젯에 신호를 보낸다. 보낸 수를 돌려준다. 실패해도 오류를 던지지 않는다. */
export async function sendWidgetPushes(admin: SupabaseClient, postId: string): Promise<number> {
  try {
    const jwt = await providerToken();
    if (!jwt) {
      console.warn('[widget push] APNs 비밀값이 없어 보내지 않음');
      return 0;
    }
    const { data, error } = await admin.rpc('widget_push_targets', { p_post: postId });
    if (error) throw error;
    const targets = (data ?? []) as Target[];
    // 시험·문제 찾기용: 몇 개의 위젯에 보내는지 (신호 주소 자체는 남기지 않는다)
    console.log(`[widget push] 보낼 위젯 ${targets.length}개`);
    if (targets.length === 0) return 0;

    const topic = Deno.env.get('APNS_WIDGET_TOPIC') || DEFAULT_TOPIC;
    const body = JSON.stringify({ aps: { 'content-changed': true } });
    const results = await Promise.all(
      targets.map(async (t) => {
        try {
          const res = await fetch(`${HOSTS[t.push_env]}/3/device/${t.push_token}`, {
            method: 'POST',
            headers: {
              authorization: `bearer ${jwt}`,
              'apns-push-type': 'widgets',
              'apns-topic': topic,
              'content-type': 'application/json',
            },
            body,
          });
          if (res.ok) return 1;
          const reason = ((await res.json().catch(() => ({}))) as { reason?: string }).reason ?? '';
          // 앱을 지웠거나 위젯을 뺀 폰: 주소를 지운다
          if (res.status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered') {
            await admin.rpc('clear_widget_push_token', { p_token: t.push_token });
          }
          console.error('[widget push] APNs', res.status, reason, t.push_env);
          return 0;
        } catch (e) {
          console.error('[widget push] send failed', String(e));
          return 0;
        }
      }),
    );
    const sent = results.reduce<number>((a, b) => a + b, 0);
    console.log(`[widget push] 보냄 ${sent}개`);
    return sent;
  } catch (e) {
    console.error('[widget push] failed', String(e));
    return 0;
  }
}
