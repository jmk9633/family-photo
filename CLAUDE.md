# 가족 사진 공유 앱 (가칭) — AI 작업 규칙

이 파일은 이 저장소에서 일하는 AI 코딩 도구가 매번 지켜야 하는 규칙이다.
Expo 일반 규칙은 `AGENTS.md`도 함께 따른다 (Expo API는 기억으로 쓰지 말고 버전 문서를 확인).
기능 명세는 Manyfast 기능명세서(프로젝트 `1cf2e2a0-796e-4730-83fd-4beb01eeabca`)를 따른다.
명세에 없는 동작이 필요하면 지어내지 말고 먼저 질문한다.

## 서비스 한 줄
가족이 보낸 사진·영상을 부모님이 폰(쉬운 모드)과 TV에서 쉽게 보고,
'봤어요'와 활동 기록으로 자연스럽게 안부를 확인하는 가족 공유 앱.

## 기술 스택 (바꾸지 말 것)
- 모바일: Expo SDK 57 (React Native) + TypeScript(strict) + Expo Router
- 서버: Supabase (서울 리전) — Postgres + RLS, Auth, Storage, Edge Functions, pg_cron
- 푸시: Expo Notifications (Edge Function에서 Expo 푸시 서비스 호출)
- 빌드: EAS Build / Submit
- 로그인: 카카오(이메일 동의 항목 없이, 브라우저 방식), 구글(브라우저 방식), 애플(네이티브),
  이메일(메일로 받은 6자리 코드, 비밀번호 없음),
  Supabase 익명 로그인(가입 없이 숫자 코드로 연결한 쉬운 모드 사용자)
- 메일 발송: 외부 SMTP(Resend). Supabase 기본 메일 서버는 실서비스에 쓰지 않는다.
- 최소 지원 OS: Expo SDK 기본값 그대로 (SDK 57 기준 iOS 16.4+, Android 7+)
- 패키지 설치는 `npx expo install`만 쓴다 (SDK에 맞는 버전 선택).
- 새 라이브러리를 추가하기 전에 이유와 대안을 먼저 설명하고 승인을 받는다.

## 폴더 구조
```
src/app/            Expo Router 화면
  (auth)/           로그인 전 화면 (로그인, 이메일, 코드 입력)
  (general)/        일반 모드 화면
  (easy)/           쉬운 모드 화면 (예정)
src/components/     공통 컴포넌트 (src/components/easy/ = 쉬운 모드 전용)
src/copy/ko.ts      모든 화면 문구
src/lib/            supabase 클라이언트, 이미지 압축, 업로드, 날짜 유틸
src/features/       기능별 로직 (auth, groups, invites, posts, views, wellbeing)
supabase/migrations 마이그레이션 SQL (번호 순서. 실제 DB에 한 번이라도 적용한 파일은 수정 금지)
supabase/functions  Edge Functions
supabase/tests      RLS 테스트 (pgTAP)
```

## 보안 규칙 (절대 어기지 말 것)
1. 모든 public 테이블은 RLS를 켠다. 정책 없이 테이블을 만들지 않는다.
2. 그룹 접근 판단은 DB 함수 `is_group_member`, `can_view_group`, `is_group_admin`, `can_see_post`만 쓴다.
3. DB를 바꿀 때는 새 마이그레이션 파일 + RLS 정책 + `supabase/tests`의 격리 테스트를 한 번에 만든다.
   테스트에는 항상 "다른 그룹 사용자는 읽을 수 없다"를 포함한다.
4. `service_role` 키는 Edge Function과 예약 작업에서만 쓴다. 앱 코드·저장소·로그에 절대 넣지 않는다.
5. 비밀 값은 `.env`에만 두고 `.env`는 커밋하지 않는다. 앱에는 `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`만 둔다.
6. 여러 테이블을 함께 바꾸는 일(초대 만들기·재발급·사용, 그룹 나가기, 그룹 합치기, 안부 요청·응답)은
   `security definer` RPC로만 처리하고, 앱이 테이블을 직접 고치게 하지 않는다.
7. 사진 저장소 `media` 버킷은 비공개다. 이미지는 서명 URL로만 보여준다.
8. 사진 속 사람의 이름·생일·나이, 얼굴 인식 데이터는 저장하지 않는다.
9. 업로드 전에 사진의 위치(GPS) 메타데이터를 지운다.

## 데이터 규칙
- 사람 = `profiles` 한 행 (계정·익명 공통). 그룹 관계와 역할 태그는 `members`.
- 역할 태그: `is_admin`, `easy_mode`, `wellbeing_check`. 관계 이름(부모님, 자녀)을 코드나 DB에 쓰지 않는다.
- 묶음 = `posts` (한 번 보낸 사진 묶음). 여러 그룹에 보내도 `posts` 1행 + `post_groups` 여러 행.
- 저장 경로: `posts/{post_id}/{media_id}.jpg`, 썸네일 `posts/{post_id}/{media_id}_thumb.jpg`.
- 업로드 순서: posts(status=uploading) 생성 → 파일 업로드 → media 행 → post_groups → status=ready.
  ready가 아닌 묶음은 다른 사람에게 보이지 않는다.
- '봤어요'는 `post_views`에 (묶음, 사용자, 날짜) 한 줄. 같은 날 여러 번 봐도 한 줄.
- 활동(앱 실행·시청·반응·보내기) 때마다 `profiles.last_active_at`을 갱신한다. 위젯 노출은 활동이 아니다.
- 숫자 집계(본 사람 수, 하트 수)는 화면에 표시하지 않는다. 이름·얼굴만 보여준다.

## 정해진 값 (바꾸려면 먼저 질문)
| 항목 | 값 | 어디서 강제 |
|---|---|---|
| 그룹 최대 인원 | 활성 구성원 50명 | `redeem_invite` → `group_full` |
| 초대 코드 | 서버가 만든 6자리, 1회용, 발급일+5일 날짜의 자정(KST)까지 | `create_invite`, `invite_expiry` |
| 초대 재발급 | 그 초대 한 건만 취소 후 새 코드. 취소 코드 입력 시 `revoked` → "새 코드로 바뀌었어요" | `reissue_invite` |
| 코드 입력 제한 | 10분에 5번 | `redeem_invite` → `too_many_attempts` |
| 한 묶음 | 사진·영상 합쳐 30장 | `media` 트리거 `too_many_media` |
| 영상·영상 한마디 | 최대 1분 | 앱에서 고르기 제한 + `media.duration_sec` 검사 |
| 끝나지 않은 업로드 | 24시간 뒤 묶음과 파일 삭제 | Edge Function (예약) |
| 쉬운 모드 자동 넘김 | 폰은 '쭉 보기'를 눌렀을 때만, 8초. TV는 자동 8초 | 앱 |
| '봤어요' | 묶음에서 한 장이라도 보면 기록 | 앱 → `post_views` |
| 하트 알림 | 묶음별로 모아 한 번 | Edge Function |
| 밤 알림 | 쉬운 모드 사용자에게 21시~8시 새 묶음 알림은 모아서 8시에 한 번 | Edge Function |
| 안부 기간 | 2·3·5·7일 (기본 3일) | `groups.wellbeing_days` 검사 |
| 안부 판단 | 매일 10:00 KST, 알림은 관리자만 | `run_wellbeing_check` (pg_cron) |
| 안부 다시 켜기 | 관리자는 요청만, 본인이 '좋아요'를 눌러야 켜짐 | `request_wellbeing`, 트리거 `consent_required` |
| 주간 모음 제안 | 일요일 20:00 로컬 알림, 최대 10장 | 앱 |
| 사진 보존 | 기간 제한 없음 | — |
| 나간 사람의 사진 삭제 | 본인이 요청하면 즉시 | `posts_delete_self` 정책 |
| 앱 스킴 | `familyphoto` (가칭, 서비스명 확정 시 변경) | `app.json` + Supabase Redirect URLs |

## 이미지·영상 처리 (앱에서)
- 사진: 긴 변 2048px 이하 JPEG(품질 0.8), 썸네일 긴 변 480px.
- 영상: 1분을 넘으면 고를 수 없게 하고, 압축 후 대표 프레임 썸네일을 함께 올린다.
  영상 압축은 네이티브 모듈(예: react-native-compressor)이 필요하므로 4단계부터는 Expo Go가 아니라 개발 빌드로 테스트한다.
- Supabase 이미지 변환 기능은 쓰지 않는다 (비용).
- 목록·위젯·타임라인은 항상 썸네일, 원본은 크게 볼 때만 불러온다.

## 화면 규칙
- 모든 문구는 한국어. 문구는 `src/copy/ko.ts`에 모아 둔다.
- 일반 모드 크기·색은 `src/components/tokens.ts`. 버튼 높이 56, 터치 영역 48 이상.
- 쉬운 모드 크기 기준은 `src/components/easy/tokens.ts`에 고정한다:
  본문 18px 이상, 제목 24px, 주요 버튼 높이 64px 이상, 터치 영역 48px 이상, 강조색 1개.
  쉬운 모드 화면에서 이 값보다 작게 만들지 않는다.
- 쉬운 모드는 탭 바 없음, 화면 깊이 2단계 이하, 모든 화면에 '처음으로' 버튼.
- 숨은 제스처(길게 누르기, 스와이프 전용 기능)를 쉬운 모드의 유일한 경로로 만들지 않는다.
- 안부 알림 문구에 '위험', '이상 징후'를 쓰지 않는다. 응급 서비스가 아니라는 안내를 함께 둔다.
- 로그인 화면은 카카오 버튼을 맨 위에 크게, 구글·애플·이메일을 그 아래에 둔다. '처음 가입한 방법으로 로그인해 주세요' 안내를 둔다.
- 초대 만료는 항상 날짜로 보여준다 ("10월 14일까지"). 남은 시간("3일 2시간")으로 쓰지 않는다.

## 작업 방식
- 한 번에 기능 하나만 만든다. 요청에 Manyfast 기능 ID가 있으면 그 명세를 먼저 읽는다.
- 작업 전에 바꿀 파일 목록과 계획을 짧게 말하고, 끝나면 폰에서 확인할 방법을 알려준다.
- 기존 동작을 바꾸는 수정은 이유를 먼저 설명한다.
- 오류가 나면 바로 고치기 전에 오류 메시지, 재현 순서, 원인 추정을 먼저 정리한다.
- 끝내기 전에 `npx tsc --noEmit`을 통과시킨다.
- 커밋 메시지는 한국어 한 줄 + 관련 기능 ID.

## 자주 쓰는 명령
```
npx expo start                      # 개발 서버 (아이폰 Expo Go로 QR 스캔)
npx expo install <패키지>            # 패키지 추가
npx tsc --noEmit                    # 타입 검사
npx expo run:ios                    # 개발 빌드 (위젯·네이티브 모듈 필요 시)
supabase db push                    # 마이그레이션을 원격 DB에 적용 (2단계부터)
supabase test db                    # RLS 테스트
eas build --profile preview         # 기기 테스트용 빌드
```

## 개발 단계
1. 세팅과 로그인 ← 지금
2. 그룹 만들기·초대 (이때 `supabase/` 마이그레이션 적용)
3~7. 보내기, 보기, 반응·'봤어요', 쉬운 모드 연결, 안부 확인 (MVP)
8. 홈 화면 위젯 (iOS부터)
9. TV 앱 (삼성 Tizen부터)

## 지금 하지 않는 것 (MVP 범위 밖)
- 설치 후 자동 연결(디퍼드 딥링크) — 숫자 코드가 주 경로
- 네이버 로그인, 휴대폰 번호 로그인 (2차)
- 안부 플랜 결제 (MVP는 안부 기능 무료)
- 자동 영상 모음, '1년 전 오늘', 얼굴 인식, 지도
