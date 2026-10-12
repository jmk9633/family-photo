// 일반 모드 기본 크기·색. 쉬운 모드는 src/components/easy/tokens.ts에 따로 둔다 (CLAUDE.md 화면 규칙).
export const colors = {
  background: '#FFFFFF',
  text: '#191919',
  textSecondary: '#5F6368',
  border: '#DADCE0',
  surface: '#F4F5F7',
  accent: '#2F6FEB',
  error: '#C5221F',
  kakao: '#FEE500',
  kakaoText: 'rgba(0, 0, 0, 0.85)',
} as const;

export const size = {
  body: 17,
  small: 15,
  title: 28,
  buttonHeight: 56,
  touchMin: 48,
  radius: 12,
  gutter: 24,
} as const;
