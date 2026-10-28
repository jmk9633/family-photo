import { registerWidgetTaskHandler } from 'react-native-android-widget';

import { registerWidgetPushTask } from './android/push';
import { widgetTaskHandler } from './android/task';

// 안드로이드 홈 화면 위젯의 할 일 등록 (8-3). 앱의 시작 파일(index.ts)에서 한 번 부른다.
// 앱이 꺼져 있어도 위젯이 깨어나면 안드로이드가 앱의 JS를 화면 없이 켜서 이 할 일을 부른다.
registerWidgetTaskHandler(widgetTaskHandler);
// 새 사진 신호(8-3-2)를 받으면 위젯을 다시 그리는 할 일 (android/push.ts가 불러올 때 정해진다)
registerWidgetPushTask();
