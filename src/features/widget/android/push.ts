import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { redrawAll } from './task';

// 새 사진이 오면 안드로이드 위젯을 바로 바꾸기 (개발 8-3-2, F-NGOJFO, 0016).
//
// 새 묶음이 완료되면 서버(notify → _shared/widgetPush.ts)가 받은 가족의 폰에 화면에 안 뜨는 '조용한 신호'
// (Expo 푸시 → 구글 FCM 데이터 메시지, { kind: 'widget' })를 보낸다. 앱이 꺼져 있어도 안드로이드가 앱의 JS를
// 화면 없이 켜서 이 할 일을 부르고, 할 일은 위젯만 서버에서 새로 받아 다시 그린다.
//   - 알림이 아니라서 알림 권한·밤 시간과 상관없이 온다(알림을 끈 엄마 폰도). 화면에는 아무것도 뜨지 않는다.
//   - 우선순위 '보통'(10/26 결정): 화면이 꺼진 채 오래 놓인 폰(절전)은 켤 때 바뀐다.
//   - 설정에서 앱을 '강제 중지'하면 다시 열 때까지 오지 않는다(안드로이드 제한).
//   - 위젯이 홈 화면에 없으면 다시 그리기는 아무것도 하지 않는다(서버에도 묻지 않음).
//   - 이 신호와 위젯 다시 그리기는 '봤어요'도 활동도 아니다.
// 할 일은 앱이 처음 읽는 파일(index.ts → register.android.ts)에서 정해야 앱이 꺼져 있을 때도 불린다(Expo 문서).

export const WIDGET_PUSH_TASK = 'family-photo-widget-push';

/** 받은 신호가 위젯용인가. Expo는 data를 dataString·body(JSON 글자) 또는 그대로 넘기므로 모두 본다 */
export function isWidgetSignal(payload: unknown): boolean {
  const seen = new Set<unknown>();
  const check = (v: unknown, depth: number): boolean => {
    if (depth > 4 || v == null || seen.has(v)) return false;
    if (typeof v === 'string') {
      if (!v.includes('widget')) return false;
      try {
        return check(JSON.parse(v), depth + 1);
      } catch {
        return false;
      }
    }
    if (typeof v !== 'object') return false;
    seen.add(v);
    const o = v as Record<string, unknown>;
    if (o.kind === 'widget') return true;
    return ['data', 'dataString', 'body', 'notification'].some((k) => check(o[k], depth + 1));
  };
  return check(payload, 0);
}

TaskManager.defineTask<Notifications.NotificationTaskPayload>(WIDGET_PUSH_TASK, async ({ data, error }) => {
  if (error || !data || 'actionIdentifier' in data) return Notifications.BackgroundNotificationTaskResult.NoData;
  if (!isWidgetSignal(data)) return Notifications.BackgroundNotificationTaskResult.NoData;
  try {
    await redrawAll({ fresh: true });
    return Notifications.BackgroundNotificationTaskResult.NewData;
  } catch (e) {
    if (__DEV__) console.warn('[widget push task failed]', e);
    return Notifications.BackgroundNotificationTaskResult.Failed;
  }
});

/** 신호가 오면 위 할 일을 부르게 등록한다 (앱을 열 때마다 불러도 된다) */
export function registerWidgetPushTask(): void {
  Notifications.registerTaskAsync(WIDGET_PUSH_TASK).catch((e) => {
    if (__DEV__) console.warn('[widget push task register failed]', e);
  });
}
