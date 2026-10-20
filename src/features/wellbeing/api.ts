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
