// widget — 홈 화면 위젯이 가장 최근 사진 한 건을 받아 가는 곳 (개발 8-1, F-NGOJFO, 0014)
//
// 위젯은 앱의 로그인 정보를 쓰지 않는다. 앱이 만들어 공용 칸(App Group)에 둔 '위젯 열쇠'를 { key }로 보낸다.
// 그래서 로그인 확인(JWT)은 끄고(config.toml), 열쇠 확인과 사진 고르기는 DB 함수 widget_feed가 한다.
//   - 열쇠로 받을 수 있는 것은 내 가족의 가장 최근 묶음 요약 한 건과 그 첫 장 썸네일의 5분짜리 서명 URL뿐이다.
//   - 저장소(media 버킷)는 비공개 그대로다. 썸네일은 올릴 때 이미 위치 정보를 지운 파일이다.
//   - 위젯이 읽는 것은 '봤어요'도 활동도 아니다. 이 함수는 기록을 남기지 않는다 (widget_feed도 마찬가지).
//
// 응답: { status: 'ok' | 'invalid' | 'no_group' | 'empty', isNew, count, title, sender, createdAt, imageUrl }
//   title  : 보낸 사람이 붙인 제목, 영상 한마디면 'OO의 영상 한마디' (앱의 format.titleOf와 같다). 없으면 null
//   sender : 'OO이 보냄' (앱의 ko.easy.home.sentByShort와 같다)
//   날짜('오늘'·'어제'·'10월 24일')는 위젯이 그릴 때 정한다 (그리는 시각이 받는 시각과 다를 수 있어서)
//
// 8-2 (0015): iOS 26 위젯은 애플에서 받은 '다시 그려' 신호 주소를 { pushToken, pushEnv }로 함께 보낸다.
//   8-3-2 (0016): 안드로이드 위젯은 Expo 푸시 주소를 { pushToken, pushEnv: 'expo' }로 보낸다.
//   매번 함께 보내므로 로그인을 바꿔 열쇠가 바뀌어도 다음 확인 때 새 열쇠로 옮겨진다. 저장은 set_widget_push_token.
//
// 배포: npx supabase functions deploy widget --use-api --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2.117.3';

const BUCKET = 'media';
const SIGNED_URL_SEC = 5 * 60;
const KEY = /^[0-9a-f]{64}$/;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** service role(비밀) 키: 새 방식(SUPABASE_SECRET_KEYS)이 있으면 그것, 없으면 예전 키 (notify·cleanup과 같음) */
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

/** 이름 뒤 '이/가' (src/copy/ko.ts의 iga와 같다): 받침이 있으면 '이' */
function iga(name: string): string {
  const t = name.trim();
  const c = t.charCodeAt(t.length - 1);
  const hasFinal = c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0;
  return `${name}${hasFinal ? '이' : '가'}`;
}

type Feed = {
  status: 'ok' | 'invalid' | 'no_group' | 'empty';
  is_new?: boolean;
  count?: number;
  kind?: 'normal' | 'video_message';
  title?: string | null;
  sender_name?: string | null;
  created_at?: string;
  thumb_path?: string;
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { status: 'invalid' });

  let key = '';
  let pushToken = '';
  let pushEnv = '';
  try {
    const body = (await req.json()) as { key?: unknown; pushToken?: unknown; pushEnv?: unknown };
    if (typeof body.key === 'string') key = body.key;
    if (typeof body.pushEnv === 'string') pushEnv = body.pushEnv;
    // 애플 주소(16진수)는 소문자로 맞춘다. 안드로이드 Expo 주소('ExponentPushToken[...]')는 대소문자를 바꾸면 안 된다
    if (typeof body.pushToken === 'string') pushToken = pushEnv === 'expo' ? body.pushToken : body.pushToken.toLowerCase();
  } catch {
    // 아래에서 invalid
  }
  if (!KEY.test(key)) return json(200, { status: 'invalid' });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (pushToken) {
    const saved = await admin.rpc('set_widget_push_token', { p_key: key, p_token: pushToken, p_env: pushEnv });
    if (saved.error) console.error('[widget] push token save failed', saved.error.message);
  }

  const { data, error } = await admin.rpc('widget_feed', { p_key: key });
  if (error) {
    console.error('[widget] feed failed', error.message);
    return json(500, { status: 'error' });
  }
  const feed = data as Feed;
  if (feed.status !== 'ok') return json(200, { status: feed.status });

  const name = feed.sender_name || '가족';
  const title = feed.kind === 'video_message' ? `${name}의 영상 한마디` : (feed.title ?? null);

  let imageUrl: string | null = null;
  if (feed.thumb_path) {
    const signed = await admin.storage.from(BUCKET).createSignedUrl(feed.thumb_path, SIGNED_URL_SEC);
    if (signed.error) console.error('[widget] sign failed', signed.error.message);
    else imageUrl = signed.data.signedUrl;
  }

  return json(200, {
    status: 'ok',
    isNew: !!feed.is_new,
    count: feed.count ?? 0,
    title,
    sender: `${iga(name)} 보냄`,
    createdAt: feed.created_at,
    imageUrl,
  });
});
