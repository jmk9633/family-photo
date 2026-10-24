// cleanup — 새벽 정리 작업 (개발 7-3, 0012, 10/25 결정)
//
// 매일 03:30 KST에 pg_cron이 start_cleanup()을 부르고, 그 안에서 pg_net으로 이 함수를 { token }과 함께 부른다.
// 로그인 확인(JWT)은 꺼 두고(config.toml), 대신 claim_cleanup(token)으로 DB가 방금 만든 일회용 표인지 확인한다.
// 표가 맞지 않으면 아무것도 하지 않는다. 그래서 밖에서 이 주소를 불러도 아무 일도 없다.
//
// 하는 일 (대상 고르기는 모두 DB 함수, 여기서는 저장소 파일·계정처럼 SQL로 못 지우는 것만 지운다):
//   1) 지울 묶음 = 24시간 넘은 '올리는 중' + 'deleting' (cleanup_take_posts가 올리는 중을 deleting으로 바꿔서 준다)
//      → posts/{묶음}/ 폴더의 파일을 모두 지운 뒤 → cleanup_finish_posts로 묶음 삭제
//      (파일만 올라가고 media 행이 없는 경우가 있어 media 목록이 아니라 폴더를 통째로 지운다.
//       파일을 못 지운 묶음은 그대로 두고 다음 날 다시 한다)
//   2) 묶음 기록 없이 남은 파일 폴더(24시간 지난 것) → 파일 삭제
//   3) 한 번도 가족에 연결되지 못한 채 7일 지난 익명 계정 → 계정 삭제 (profiles 등은 DB가 함께 지운다)
//   4) 결과를 cleanup_runs.result에 남긴다 (Supabase Table Editor에서 볼 수 있다)
//
// 배포: npx supabase functions deploy cleanup --use-api --no-verify-jwt

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.3';

const BUCKET = 'media';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Result = {
  posts: number;
  postFiles: number;
  postFailed: string[];
  orphanFolders: number;
  orphanFiles: number;
  orphanFailed: string[];
  anonymous: number;
  anonymousFailed: string[];
  error?: string;
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** service role(비밀) 키: 새 방식(SUPABASE_SECRET_KEYS)이 있으면 그것, 없으면 예전 키 (notify와 같음) */
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

/** posts/{id}/ 폴더의 파일을 모두 지우고 지운 수를 돌려준다. 실패하면 오류를 던진다. */
async function removeFolder(admin: SupabaseClient, id: string): Promise<number> {
  const prefix = `posts/${id}`;
  let removed = 0;
  // 한 묶음은 최대 30장 × 2(원본·썸네일)라 보통 한 번에 끝난다. 혹시 더 있으면 빌 때까지 반복
  for (let round = 0; round < 10; round++) {
    const { data, error } = await admin.storage.from(BUCKET).list(prefix, { limit: 1000 });
    if (error) throw error;
    const paths = (data ?? []).filter((f) => f.id !== null).map((f) => `${prefix}/${f.name}`);
    if (paths.length === 0) return removed;
    const { error: e2 } = await admin.storage.from(BUCKET).remove(paths);
    if (e2) throw e2;
    removed += paths.length;
  }
  return removed;
}

async function run(admin: SupabaseClient, token: string): Promise<Result> {
  const result: Result = {
    posts: 0,
    postFiles: 0,
    postFailed: [],
    orphanFolders: 0,
    orphanFiles: 0,
    orphanFailed: [],
    anonymous: 0,
    anonymousFailed: [],
  };
  try {
    // 1) 지울 묶음
    const { data: posts, error } = await admin.rpc('cleanup_take_posts');
    if (error) throw error;
    const done: string[] = [];
    for (const row of (posts ?? []) as { post_id: string }[]) {
      try {
        result.postFiles += await removeFolder(admin, row.post_id);
        done.push(row.post_id);
      } catch (e) {
        console.warn('[cleanup post]', row.post_id, e);
        result.postFailed.push(row.post_id);
      }
    }
    if (done.length > 0) {
      const { data: n, error: e2 } = await admin.rpc('cleanup_finish_posts', { p_ids: done });
      if (e2) throw e2;
      result.posts = (n as number) ?? 0;
    }

    // 2) 주인 없는 파일 폴더
    const { data: folders, error: e3 } = await admin.rpc('cleanup_orphan_folders');
    if (e3) throw e3;
    for (const row of (folders ?? []) as { folder: string }[]) {
      if (!UUID.test(row.folder ?? '')) continue; // 우리가 만든 경로가 아니면 건드리지 않는다
      try {
        result.orphanFiles += await removeFolder(admin, row.folder);
        result.orphanFolders++;
      } catch (e) {
        console.warn('[cleanup orphan]', row.folder, e);
        result.orphanFailed.push(row.folder);
      }
    }

    // 3) 연결 못 한 익명 계정
    const { data: users, error: e4 } = await admin.rpc('cleanup_anonymous_targets');
    if (e4) throw e4;
    for (const row of (users ?? []) as { user_id: string }[]) {
      const { error: e5 } = await admin.auth.admin.deleteUser(row.user_id);
      if (e5) {
        console.warn('[cleanup anonymous]', row.user_id, e5);
        result.anonymousFailed.push(row.user_id);
      } else {
        result.anonymous++;
      }
    }
  } catch (e) {
    console.error('[cleanup]', e);
    result.error = e instanceof Error ? e.message : String(e);
  }
  await admin.rpc('finish_cleanup', { p_token: token, p_result: result });
  console.log('[cleanup done]', JSON.stringify(result));
  return result;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method' });

  let token = '';
  try {
    token = String(((await req.json()) as { token?: string }).token ?? '');
  } catch {
    return json(400, { error: 'body' });
  }
  if (!UUID.test(token)) return json(400, { error: 'token' });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // DB가 방금 만든 일회용 표인지 (한 번만, 10분 안)
  const { data: ok, error } = await admin.rpc('claim_cleanup', { p_token: token });
  if (error) return json(500, { error: 'claim' });
  if (ok !== true) return json(403, { error: 'token' });

  // 부른 쪽(pg_net)을 오래 기다리게 하지 않도록 바로 답하고 정리는 뒤에서 계속한다
  const work = run(admin, token);
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (runtime) {
    runtime.waitUntil(work);
    return json(202, { started: true });
  }
  return json(200, await work);
});
