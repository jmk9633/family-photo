// 쉬운 모드 크기·색 기준 (CLAUDE.md 화면 규칙). 쉬운 모드 화면은 이 값보다 작게 만들지 않는다.
// 본문 18px 이상, 제목 24px, 주요 버튼 높이 64px 이상, 터치 영역 48px 이상, 강조색 1개.
// 색은 와이어프레임(쉬운 모드 화면들)과 같다.
export const easyColors = {
  background: '#FFFFFF',
  text: '#1A1A1A',
  textSecondary: '#4A4A4A',
  border: '#1A1A1A',
  line: '#D9D9D9',
  surface: '#F2F2F2',
  placeholder: '#E6E6E6',
  accent: '#C2410C', // 강조색은 이것 하나
  error: '#B42318',
  // 한 장씩 보기·다 봤어요 (어두운 화면)
  dark: '#111111',
  darkSurface: '#3A3A3A',
  darkText: '#FFFFFF',
  darkTextSecondary: '#D9D9D9',
} as const;

export const easySize = {
  body: 18,
  bodyLarge: 20,
  title: 24,
  display: 30,
  buttonHeight: 64,
  buttonLarge: 76,
  touchMin: 48,
  radius: 16,
  gutter: 16,
} as const;
