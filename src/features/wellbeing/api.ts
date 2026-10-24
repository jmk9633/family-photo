import { supabase } from '@/lib/supabase';

// 안부 알림 (개발 7-1, F-QHORLL·F-QEMORX). 판단과 푸시는 서버 예약 작업(매일 10시, 0010)이 한다.
// 앱은 관리자에게 열린 알림을 띠로 보여주고, '전화하기'·'괜찮아요'를 RPC로 남기고, 구성원 전화번호를 넣는다.

export type WellbeingAlert = {
  alert_id: string;
  group_id: string;
  group_name: string;
  kind: 'check' | 'nudge';
  target_name: string;
  target_member_id: string | null;
  days: number;
  phone: string | null;
  started_at: string;
};

/** 내가 관리자인 그룹의 열린 안부 알림 (대상이 나인 것은 빠져 있다) */
export async function listMyWellbeingAlerts(): Promise<WellbeingAlert[]> {
  const { data, error } = await supabase.rpc('my_wellbeing_alerts');
  if (error) throw error;
  return (data ?? []) as WellbeingAlert[];
}

/** 'called' 전화하기 · 'ok' 괜찮아요(넛지는 닫기). 다른 관리자의 띠도 함께 닫힌다. */
export async function respondWellbeing(alertId: string, response: 'called' | 'ok'): Promise<void> {
  const { error } = await supabase.rpc('respond_wellbeing', { p_alert: alertId, p_response: response });
  if (error) throw error;
}

/** 그룹 구성원 전화번호 (관리자만 보인다. 넣지 않은 사람은 없다) */
export async function listMemberPhones(groupId: string): Promise<Record<string, string>> {
  const { data, error } = await supabase.from('member_phones').select('member_id, phone').eq('group_id', groupId);
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r) => [r.member_id as string, r.phone as string]));
}

/** 관리자가 구성원 전화번호를 넣거나(숫자만 저장) 빈 값으로 지운다 */
export async function setMemberPhone(memberId: string, phone: string): Promise<void> {
  const { error } = await supabase.rpc('set_member_phone', { p_member: memberId, p_phone: phone });
  if (error) throw error;
}

/** 01012345678 → 010-1234-5678 (보여주기용) */
export function formatPhone(p: string): string {
  if (/^02\d{7,8}$/.test(p)) return p.replace(/^(02)(\d{3,4})(\d{4})$/, '$1-$2-$3');
  return p.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');
}

// ── 안부 확인 켜고 끄기 (개발 7-2, F-MNBFHT, 0011) ─────────────────────────
// 본인: 끄기는 언제든, 다시 켜기는 본인이 껐던 가족만. 관리자가 끈 곳·처음 켜는 곳은 관리자 요청 + 본인 '좋아요'.
// 쉬운 화면은 가족을 고르지 않고 한꺼번에(…All), 일반 화면은 그룹 화면에서 그룹마다.

export type MyWellbeing = {
  group_id: string;
  group_name: string;
  member_id: string;
  is_on: boolean;
  /** 관리자가 켜 달라고 요청해 둠 → 동의 화면 */
  requested: boolean;
  /** 본인이 껐던 곳이라 본인이 바로 다시 켤 수 있음 */
  can_turn_on: boolean;
  /** 예전에 켜진 적이 있음 → '다시 켜려고 해요' */
  ever_on: boolean;
  /** 켜져 있는데 처음 안내를 아직 안 봄 */
  intro_needed: boolean;
  days: number;
};

/** 안부 확인이 한 번이라도 있었던 내 가족들 (없으면 빈 목록 → 화면에 칸을 안 보인다) */
export async function getMyWellbeing(): Promise<MyWellbeing[]> {
  const { data, error } = await supabase.rpc('my_wellbeing');
  if (error) throw error;
  return (data ?? []) as MyWellbeing[];
}

/** 쉬운 화면 스위치: 끄면 켜진 모든 가족에서, 켜면 본인이 껐던 가족에서만. 바뀐 수 */
export async function setMyWellbeingAll(on: boolean): Promise<number> {
  const { data, error } = await supabase.rpc('set_my_wellbeing_all', { p_on: on });
  if (error) throw error;
  return (data ?? 0) as number;
}

/** 일반 화면 그룹 화면: 이 그룹에서 내 안부 확인 끄기·다시 켜기·요청에 답하기 */
export async function setMyWellbeing(groupId: string, on: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_my_wellbeing', { p_group: groupId, p_on: on });
  if (error) throw error;
}

/** 쉬운 화면 동의 화면: 와 있는 켜기 요청 모두에 '좋아요'(true)·'아니요'(false) */
export async function answerWellbeingRequests(yes: boolean): Promise<number> {
  const { data, error } = await supabase.rpc('answer_wellbeing_requests', { p_yes: yes });
  if (error) throw error;
  return (data ?? 0) as number;
}

/** 처음 안내를 봤다 */
export async function seenWellbeingIntro(): Promise<void> {
  const { error } = await supabase.rpc('wellbeing_seen_intro');
  if (error) throw error;
}

/** 관리자: 구성원의 안부 확인 끄기 (대상자에게 알리지 않는다) */
export async function stopWellbeing(memberId: string): Promise<void> {
  const { error } = await supabase.rpc('stop_wellbeing', { p_member: memberId });
  if (error) throw error;
}

/** 관리자: 켜 달라고 요청 ('아니요' 뒤 7일 동안은 recently_declined) */
export async function requestWellbeing(memberId: string): Promise<void> {
  const { error } = await supabase.rpc('request_wellbeing', { p_member: memberId });
  if (error) throw error;
}

/** 관리자: 안부 기간 2·3·5·7일 */
export const WELLBEING_DAYS = [2, 3, 5, 7] as const;
export async function setWellbeingDays(groupId: string, days: number): Promise<void> {
  const { error } = await supabase.from('groups').update({ wellbeing_days: days }).eq('id', groupId);
  if (error) throw error;
}

const REASK_MS = 7 * 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** '아니요' 뒤 다시 요청할 수 있는 날 (한국 시간 월·일). 이미 지났으면 null */
export function nextRequestDay(declinedAt: string | null): { month: number; day: number } | null {
  if (!declinedAt) return null;
  const at = new Date(declinedAt).getTime() + REASK_MS;
  if (at <= Date.now()) return null;
  const kst = new Date(at + KST_OFFSET_MS);
  return { month: kst.getUTCMonth() + 1, day: kst.getUTCDate() };
}
