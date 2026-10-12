// 앱의 모든 문구는 이 파일에 모은다.
export const ko = {
  common: {
    loading: '불러오는 중이에요',
  },
  login: {
    title: '가족 사진',
    subtitle: '가족이 보낸 사진을\n한곳에서 크게 봐요',
    kakao: '카카오 로그인',
    google: 'Google로 계속하기',
    email: '이메일로 계속하기',
    hint: '처음 가입한 방법으로 로그인해 주세요',
  },
  email: {
    title: '이메일로 계속하기',
    description: '이메일로 6자리 로그인 코드를 보내드려요.\n비밀번호는 없어요.',
    placeholder: '이메일 주소',
    submit: '코드 받기',
    invalid: '이메일 주소를 다시 확인해 주세요',
  },
  emailCode: {
    title: '코드를 입력해 주세요',
    sentTo: (email: string) => `${email}(으)로 보낸\n6자리 숫자를 입력해 주세요`,
    verifying: '확인하는 중이에요',
    resend: '코드 다시 받기',
    resendIn: (sec: number) => `${sec}초 뒤에 다시 받을 수 있어요`,
    resent: '새 코드를 보냈어요',
    changeEmail: '다른 이메일 쓰기',
  },
  home: {
    title: '로그인됐어요',
    method: (provider: string) => `로그인 방법: ${provider}`,
    note: '1단계 확인용 임시 화면이에요.\n앱을 완전히 껐다 켜도 이 화면이 나오면 성공이에요.',
    signOut: '로그아웃',
  },
  providers: {
    kakao: '카카오',
    google: '구글',
    apple: '애플',
    email: '이메일 코드',
  } as Record<string, string>,
  errors: {
    network: '인터넷 연결을 확인해 주세요',
    wrongCode: '코드가 맞지 않거나 시간이 지났어요. 다시 확인하거나 새 코드를 받아 주세요',
    tooMany: '요청이 너무 많아요. 잠시 후 다시 해 주세요',
    loginFailed: '로그인하지 못했어요. 다시 시도해 주세요',
  },
};
