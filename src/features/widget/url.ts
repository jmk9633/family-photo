// 홈 화면 위젯을 눌러 들어온 주소인가 (위젯의 widgetURL = familyphoto://widget, 8-1).
// 화면 이동 쪽에서는 '/widget'으로 올 수도 있다. 앱 스킴이 바뀌면 targets/widget/FamilyPhotoWidget.swift의 openURL도 함께 바꾼다.
export function isWidgetUrl(url: string | null | undefined): boolean {
  return !!url && /^(familyphoto:\/\/|\/)?widget\/?(\?.*)?$/.test(url);
}
