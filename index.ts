// 앱의 시작 파일. Expo Router를 시작하고, 안드로이드 홈 화면 위젯의 할 일을 등록한다 (8-3).
// 위젯 할 일은 앱 화면 없이도 불려야 해서 화면 코드(src/app)가 아니라 여기서 등록한다.
import 'expo-router/entry';

import './src/features/widget/register';
