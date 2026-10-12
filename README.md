# 가족 사진 (가칭)

가족이 보낸 사진·영상을 부모님이 폰과 TV에서 쉽게 보는 가족 공유 앱.
AI 작업 규칙은 [CLAUDE.md](./CLAUDE.md)에 있다.

## 처음 실행하기 (맥 + 아이폰)

준비물: 맥에 Node.js 20 이상, 아이폰에 App Store의 **Expo Go** 앱.

```bash
# 1. 코드 받기 (처음 한 번)
git clone https://github.com/jmk9633/family-photo.git
cd family-photo

# 2. 패키지 설치 (처음 한 번, 그리고 package.json이 바뀔 때마다)
npm install

# 3. 비밀 값 파일 만들기 (처음 한 번)
cp .env.example .env
open -e .env        # 텍스트 편집기로 열어 Supabase 주소와 키를 붙여 넣고 저장

# 4. 실행
npx expo start
```

터미널에 QR 코드가 뜨면 아이폰 **카메라 앱**으로 찍고, 뜨는 알림을 눌러 Expo Go로 연다.
맥과 아이폰이 **같은 와이파이**에 있어야 한다.

코드를 새로 받을 때는 `git pull` 후 `npm install`, 그리고 `npx expo start`.

## 지금 단계

1단계: 세팅과 로그인 (카카오·구글·애플·이메일 6자리 코드, 앱을 다시 열어도 로그인 유지).
