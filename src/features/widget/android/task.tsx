'use no memo';
// 위젯은 화면 없이 JSX를 위젯 설계도로 바꿔 그린다. React Compiler가 바꾼 함수(useMemoCache 훅)는 거기서 'Invalid Hook Call'로 실패해서
// 이 파일은 컴파일러를 끈다 (react-native-android-widget 안내, 10/28 가상 폰에서 실제로 겪음).
import { requestWidgetUpdate, type WidgetTaskHandlerProps } from 'react-native-android-widget';

import { cachedSnapshot, loadSnapshot, type Snapshot } from './feed';
import { FamilyPhotoWidget, WIDGET_NAMES } from './FamilyPhotoWidget';

// 안드로이드 위젯이 깨어날 때 할 일 (8-3).
// 안드로이드가 위젯을 놓았을 때(ADDED)·30분마다(UPDATE, app.json updatePeriodMillis)·크기를 바꿨을 때(RESIZED)
// 앱이 꺼져 있어도 앱의 JS를 화면 없이 잠깐 켜서 이 함수를 부른다(react-native-android-widget).
// 누르기는 OPEN_URI라서 여기까지 오지 않고 바로 앱이 열린다.

export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  const { widgetInfo, widgetAction, renderWidget } = props;
  let snap: Snapshot;
  switch (widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
      snap = await loadSnapshot();
      break;
    case 'WIDGET_RESIZED':
      // 크기만 바뀌었으면 서버에 다시 묻지 않는다
      snap = await cachedSnapshot();
      break;
    default:
      return; // WIDGET_DELETED · WIDGET_CLICK: 할 일 없음
  }
  renderWidget(
    <FamilyPhotoWidget name={widgetInfo.widgetName} snap={snap} width={widgetInfo.width} height={widgetInfo.height} />,
  );
}

/** 홈 화면에 있는 모든 가족 사진 위젯을 지금 다시 그린다 (서버에서 새로 받아서). 위젯이 없으면 아무것도 안 한다 */
export async function redrawAll({ fresh = true }: { fresh?: boolean } = {}): Promise<void> {
  let snap: Snapshot | null = null;
  const get = async () => (snap ??= await loadSnapshot({ fresh }));
  for (const name of Object.values(WIDGET_NAMES)) {
    await requestWidgetUpdate({
      widgetName: name,
      renderWidget: async (info) => (
        <FamilyPhotoWidget name={name} snap={await get()} width={info.width} height={info.height} />
      ),
    });
  }
}
