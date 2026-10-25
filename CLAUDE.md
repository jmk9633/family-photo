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
- 로그인: 카카오(이메일은 선택 동의, 브라우저 방식), 구글(브라우저 방식), 애플(네이티브),
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
  (easy)/           쉬운 모드 화면 (home·play/[id]·past·more·connect·camera·wellbeing)
src/components/     공통 컴포넌트 (src/components/easy/ = 쉬운 모드 전용)
src/copy/ko.ts      모든 화면 문구
src/lib/            supabase 클라이언트, 이미지 압축, 업로드, 날짜 유틸
src/features/       기능별 로직 (auth, groups, invites, posts, views, wellbeing)
supabase/migrations 마이그레이션 SQL (번호 순서. 실제 DB에 한 번이라도 적용한 파일은 수정 금지)
supabase/functions  Edge Functions
supabase/tests      RLS 테스트 (pgTAP)
targets/widget/     iOS 홈 화면 위젯 (SwiftUI, @bacons/apple-targets가 prebuild 때 Xcode 확장으로 만든다)
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
  영상은 `posts/{post_id}/{media_id}.mp4`, 썸네일(대표 프레임)은 사진과 같은 `_thumb.jpg`.
- 업로드 순서: posts(status=uploading) 생성 → 파일 업로드 → media 행 → post_groups → status=ready.
  ready가 아닌 묶음은 다른 사람에게 보이지 않는다.
- '봤어요'는 `post_views`에 (묶음, 사용자, 날짜) 한 줄. 같은 날 여러 번 봐도 한 줄. 날짜는 DB 트리거가 한국 시간 오늘로 정한다 (0003).
  일반 모드는 사진 상세를 열 때 + 타임라인 카드가 절반 이상 1초 보일 때 기록한다. 내가 보낸 묶음은 기록하지 않는다.
- '봤어요'는 보낸 사람(과 본인)만 읽는다, 하트는 같은 그룹 구성원 누구나 읽는다 (10/16 결정, `post_views_select` 0003).
  화면에서는 본인 기록을 빼고 이름·얼굴만 보여준다.
- 하트·시청의 활동 시각(`last_active_at`)은 DB 트리거(`touch_last_active`)가 갱신한다. 앱이 따로 부르지 않는다.
- 표시 이름: 가입 시 카카오·구글 이름이 `profiles.display_name` 기본값. 그룹 만들기·합류 화면에서 미리 채워 고칠 수 있게 하고, 그룹별 이름(`members.display_name`)은 `set_my_display_name`으로 언제든 본인이 바꾼다.
- 그룹 만들기는 `create_group` RPC로만 한다 (`groups`에 직접 insert 금지).
- 그룹 나가기는 `leave_group(그룹, 내 사진도 지울지)`, 내보내기는 `remove_member(구성원)` RPC로만 한다 (0007, F-LMXBXX).
  나간·내보내진 사람이 올린 사진은 기본으로 남는다. '내 사진도 지우기'는 다른 그룹에도 보낸 묶음은 이 그룹에서만 빼고,
  이 그룹에만 보낸 묶음은 `deleting`(아무에게도 안 보임)으로 바꾼 뒤 앱이 `deleteMyPost`(저장소 파일 먼저 → 묶음)로 지운다.
  남은 `deleting` 묶음은 7단계 정리 작업이 지운다. 계정이 있는 관리자가 0명이 되면 계정이 있는 구성원 중 가장 먼저 들어온 사람이 관리자가 되고
  (익명에게는 넘기지 않음, 없으면 관리자 없음 — 0008, 나가기 화면에 `leave_warning` 경고)
  `admin_transfer_log`에 남아, 앱이 `requestAdminNotify(groupId)`를 부르면 새 관리자와 그룹에 한 번 알린다.
- 내가 보낸 묶음은 언제든 지운다(받은 모든 그룹에서 사라짐): 일반 화면은 사진 상세의 휴지통, 쉬운 화면은 내가 보낸 사진을 볼 때 '이 사진 지우기'(한 화면을 통째로 써서 한 번 더 묻기, 7-4).
  `deleteMyPost`는 먼저 'deleting'으로 바꿔 바로 안 보이게 한 뒤 파일 → 묶음을 지우고, 중간에 실패한 나머지는 새벽 정리가 지운다.
- 남이 보낸 묶음은 그 묶음을 받은 그룹의 관리자만 '가족 앨범에서 내리기'(`take_down_post`, 0013). 내가 관리자인 그룹에서만 빠지고,
  관리자가 아닌 다른 그룹에도 보낸 묶음이면 그 그룹에는 남는다. 더 남는 그룹이 없으면 'deleting' → 새벽 정리가 파일까지. 보낸 사람에게 알리지 않는다.
- 내보내기는 `remove_member(구성원, 사진도 지울지)` (0013). 앱은 [사진은 남기기]를 기본으로 묻는다. 지우면 그 사람이 이 그룹에만 보낸 묶음은 'deleting',
  다른 그룹에도 보낸 묶음은 이 그룹에서만 뺀다 (`leave_group`의 '내 사진도 지우기'와 같은 방식).
- 가입 없이 쓰는 사람(익명)은 관리자 태그가 있어도 내보내기·내리기를 못 한다.
- 활동(앱 실행·시청·반응·보내기) 때마다 `profiles.last_active_at`을 갱신한다. 위젯 노출은 활동이 아니다.
- 숫자 집계(본 사람 수, 하트 수)는 화면에 표시하지 않는다. 이름·얼굴만 보여준다.
- 목록은 `ready` 묶음만, 같은 묶음은 '모든 가족'에서 한 번만 (posts 1행 + 내가 볼 수 있는 post_groups만 딸려 옴).
- 앨범 카드·월 제목의 묶음 수는 앱이 세지 않고 `album_months` / `album_senders` / `album_tags` (0002, security invoker)로 센다.
- 보낸 사람 이름: 특정 그룹을 보면 그 그룹의 이름, '모든 가족'이면 그 묶음을 받은 그룹 중 내가 먼저 들어간 그룹의 이름.

## 정해진 값 (바꾸려면 먼저 질문)
| 항목 | 값 | 어디서 강제 |
|---|---|---|
| 그룹 최대 인원 | 활성 구성원 50명 | `redeem_invite` → `group_full` |
| 초대 코드 | 서버가 만든 6자리, 1회용, 발급일+5일 날짜의 자정(KST)까지 | `create_invite`, `invite_expiry` |
| 초대 재발급 | 그 초대 한 건만 취소 후 새 코드. 취소 코드 입력 시 `revoked` → "새 코드로 바뀌었어요" | `reissue_invite` |
| 코드 입력 제한 | 10분에 5번 | `redeem_invite` → `too_many_attempts` |
| 한 묶음 | 사진·영상 합쳐 30장 | `media` 트리거 `too_many_media` |
| 영상·영상 한마디 | 최대 1분 | 앱: 고르기 버튼 아래 안내 + 고른 뒤 길이 검사로 빼고 알림, DB: `media.duration_sec` 검사 |
| 서명 URL | 유효 1시간, 10분 남으면 새로 받음. 화면에는 `cacheKey = 저장 경로`로 넘김 | `src/lib/signedUrl.ts` |
| 새벽 정리 작업 | 매일 03:30 KST. 결과는 `cleanup_runs.result` | pg_cron `cleanup-daily` 18:30 UTC → `start_cleanup()` → pg_net → Edge Function `cleanup` (0012) |
| 끝나지 않은 업로드 | 24시간 넘은 '올리는 중'은 'deleting'으로 바꾼 뒤 `posts/{묶음}/` 폴더째 파일 삭제 → 묶음 삭제 | `cleanup_take_posts` → `cleanup`, `cleanup_finish_posts` (0012) |
| 지우는 중(deleting) 묶음 | 앱이 못 지운 것은 새벽 정리가 같은 방식으로 지움. 'deleting'은 앱이 다시 'ready'로 못 바꿈 | 트리거 `posts_deleting_final` → `post_deleting` (0012) |
| 주인 없는 파일 | 묶음 기록 없이 24시간 지난 `posts/{id}/` 폴더는 새벽 정리가 지움 | `cleanup_orphan_folders` (0012) |
| 연결 못 한 익명 계정 | 한 번도 가족에 연결되지 못한 채 7일 지나면 계정 삭제. 나갔거나 내보내진 익명은 지우지 않음(계정을 지우면 보낸 사진도 지워지므로). 지워진 폰에서 다시 숫자를 넣으면 새 익명 계정으로 바로 연결 | `cleanup_anonymous_targets` → `cleanup`, 앱 `ensureSignedIn` (0012, 10/25 결정) |
| 오래된 기록 | 90일 지난 초대 기록(그 전에는 같은 숫자를 다시 발급하지 않음), 하루 지난 숫자 시도 기록, 30일 지난 정리 기록 | `start_cleanup` → `cleanup_old_records` (0001·0012) |
| 쉬운 모드 자동 넘김 | 폰은 '쭉 보기'를 눌렀을 때만, 8초. TV는 자동 8초 | 앱 |
| '봤어요' | 묶음에서 한 장이라도 보면 기록 | 앱 → `post_views` |
| 하트 알림 | 묶음별로 모아 한 번 | Edge Function |
| 밤 알림 | 쉬운 모드 사용자에게 21시~8시(KST) 가는 알림은 종류와 상관없이 모아서 8시에 한 번. 한 가지 소식이면 그 내용, 여러 가지면 '새 사진과 가족 소식이 있어요. 눌러서 보세요'(새 사진 없으면 '가족 소식이 있어요…'). 이미 본 새 사진은 뺀다 | notify → `night_queue`, pg_cron 23:00 UTC → `send_night_digest()`(pg_net으로 Expo) (0009) |
| 안부 기간 | 2·3·5·7일 (기본 3일) | `groups.wellbeing_days` 검사 |
| 안부 판단 | 매일 10:00 KST, 알림은 관리자만(대상자 본인 제외). 같은 무활동 구간에 한 번, '괜찮아요' 뒤 기간 안에는 다시 안 만듦. 대상자가 활동하면 닫힘, 새 묶음이 오면 넛지 닫힘 | pg_cron `wellbeing-daily` 01:00 UTC → `wellbeing_daily()` = `run_wellbeing_check` + `send_wellbeing_pushes`(pg_net으로 Expo) (0010) |
| 구성원 전화번호 | 관리자가 넣고 관리자만 봄(선택). 숫자만 저장, 안부 '전화하기'에 씀 | `member_phones` RLS, `set_member_phone` → `invalid_phone` (0010) |
| 안부 다시 켜기 | 관리자는 요청만, 본인이 '좋아요'를 눌러야 켜짐. 본인이 끈 곳만 본인이 바로 다시 켬(관리자가 끈 곳·처음 켜기는 요청 + 동의). '아니요' 뒤 7일 동안 다시 요청 못 함 | `request_wellbeing` → `recently_declined`, `set_my_wellbeing` → `request_required`, 트리거 `consent_required` (0011) |
| 안부 켜고 끄기 (7-2) | 쉬운 화면은 더보기 맨 위 '내 안부 확인' 스위치 하나로 모든 가족 함께, 일반 화면은 그룹 화면 '내 안부 확인'에서 그룹마다. 본인이 끄면 그 그룹 관리자에게 '엄마가 안부 확인을 껐어요'(가족별 한 번), 관리자가 끄면 대상자에게 알리지 않음. 켜기 요청은 푸시 없이 다음에 앱을 열 때 동의 화면(쉬운 화면)·사진 탭 띠(일반 화면). 켜진 채 처음 연결되면 안내 한 번. 꺼지면 열린 안부 알림이 바로 닫힘. 모든 변경은 `wellbeing_changes`에 기록(관리자·본인만 봄) | `my_wellbeing`, `set_my_wellbeing_all`, `answer_wellbeing_requests`, `wellbeing_seen_intro`, `stop_wellbeing`, notify `wellbeing_off` → `claim_wellbeing_off_notices` (0011) |
| 주간 모음 제안 | 일요일 20:00 로컬 알림, 최대 10장 | 앱 |
| 사진 보존 | 기간 제한 없음 | — |
| 나간 사람의 사진 삭제 | 본인이 요청하면 즉시. 내보낼 때 관리자가 [사진도 지우기]를 고르면 함께 (기본은 남기기) | `posts_delete_self` 정책, `remove_member(…, true)` (0013) |
| 사진 지우기·내리기 권한 | 내 사진은 나만 지움(일반·쉬운 화면 모두), 남의 사진은 받은 그룹의 관리자만 내림(알림 없음) | `deleteMyPost`, `take_down_post` (0013) |
| 홈 화면 위젯 (8-1) | iOS 큰·중간 크기. 가장 최근 새 묶음의 첫 장 + '새 사진 N장'(그 묶음 장 수, 쉬운 홈과 같은 숫자) + 제목 + 'OO이 보냄 · 오늘'. 새 사진 없으면 남이 보낸 최근(없으면 내 것), 배지 숨김. 모든 가족 합쳐서. 위젯이 30분쯤마다 스스로 물어봄(실패 시 15분), 앱을 열 때·나갈 때·'봤어요' 기록 뒤 바로 다시 그림. 앱을 다시 열면 쉬운 홈·사진 탭도 새로 읽음(위젯을 눌러 들어와도 최신). 누르면 모드에 맞는 앱 홈. 위젯 노출은 '봤어요'·활동 아님 | `widget_feed`(0014) → Edge Function `widget` → `targets/widget`, 앱 `features/widget` |
| 위젯 바로 바꾸기 (8-2) | iOS 26 이상: 새 묶음이 완료되면 받은 가족(보낸 사람 제외)의 위젯에 '다시 그려' 신호(WidgetKit 푸시). 알림 허용·밤 시간과 상관없음, 화면에 아무것도 안 뜸. 그보다 오래된 폰은 30분 확인 그대로. 신호는 '봤어요'·활동 아님 | notify(new_post) → `_shared/widgetPush.ts` → APNs 직접, `widget_push_targets`·`set_widget_push_token`·`clear_widget_push_token` (0015) |
| 위젯 열쇠 | 폰마다 하나, 서버에는 SHA-256만, 한 사람 최근 5개까지. 로그아웃하면 서버·폰에서 지움, 계정 삭제 시 함께 삭제. 익명(쉬운 화면)도 만듦. 사진은 썸네일 5분짜리 서명 URL로만 | `create_widget_key`·`revoke_widget_key`·`widget_keys` RLS (0014) |
| 앱 스킴 | `familyphoto` (가칭, 서비스명 확정 시 변경. 위젯의 `familyphoto://widget`도 함께) | `app.json` + Supabase Redirect URLs + `targets/widget` openURL + `features/widget/url.ts` |
| iOS 앱 ID (번들 ID) | `com.jmk9633.familyphoto` (가칭, 서비스명 확정 시 변경). 위젯은 `com.jmk9633.familyphoto.widget`, App Group `group.com.jmk9633.familyphoto` | `app.json` `ios.bundleIdentifier`·`ios.entitlements`, `targets/widget/expo-target.config.js` |
| 안드로이드 앱 ID (패키지 이름) | `com.jmk9633.familyphoto` (iOS와 같게, 가칭. 플레이 스토어에 올린 뒤에는 못 바꿈) | `app.json` `android.package` |

## 이미지·영상 처리 (앱에서)
- 사진: 긴 변 2048px 이하 JPEG(품질 0.8), 썸네일 긴 변 480px.
- 영상 위치 정보: 압축 라이브러리 수정본 + 올리기 직전 `assertNoLocation`(moov 안 ©xyz·loci·quicktime.location 검사)으로 이중으로 막는다.
- 영상: 시스템 사진 고르기 화면은 길이로 거를 수 없다(PHPickerFilter에 길이 필터 없음). 그래서 고르기 버튼 아래에
  '영상은 1분까지 보낼 수 있어요'를 항상 보여주고, 1분 넘는 영상은 고른 뒤 빼고 'N개는 빠졌어요'로 알린다 (10/15 결정).
  압축: 긴 변 1280px(720p), 목표 3Mbps (원본이 더 가벼우면 원본의 95%). 압축 후 대표 프레임 썸네일(긴 변 480px)을 함께 올린다.
  영상 압축은 네이티브 모듈(예: react-native-compressor)이 필요하므로 4단계부터는 Expo Go가 아니라 개발 빌드로 테스트한다.
- Supabase 이미지 변환 기능은 쓰지 않는다 (비용).
- 목록·위젯·타임라인은 항상 썸네일, 원본은 크게 볼 때만 불러온다.

## 화면 규칙
- 모든 문구는 한국어. 문구는 `src/copy/ko.ts`에 모아 둔다.
  예외: 홈 화면 위젯은 앱의 JS를 읽을 수 없어 `targets/widget/FamilyPhotoWidget.swift`의 `Copy`에 모은다 (8-1).
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
npx expo start                      # 개발 서버 (아이폰의 '가족 사진' 개발 빌드 앱에서 연결)
npx expo install <패키지>            # 패키지 추가
npx tsc --noEmit                    # 타입 검사
npx expo run:ios --device           # 개발 빌드를 아이폰에 설치 (네이티브 라이브러리 추가 시, 무료 계정은 7일마다)
npx supabase db push --linked       # 마이그레이션을 원격 DB에 적용 (CLI가 곧 기본값을 로컬로 바꾼다고 경고해서 --linked를 붙인다)
npx supabase test db                # RLS 테스트 (Docker 필요. 없으면 Claude가 클라우드에서 검증)
eas build --profile preview         # 기기 테스트용 빌드
```

## 개발 단계
1. 세팅과 로그인 (완료)
2. 그룹 만들기·초대 (완료)
3. 보내기 — 사진 (완료)
4. 보기 + 영상 보내기 (완료)
5. 반응(하트)·'봤어요' + 애플 로그인 우회 제거 + 푸시 알림 (완료)
6. 쉬운 모드 연결 (완료)
7. 안부 확인 (MVP, 완료 10/25: 7-1 알림·응답 / 7-2 켜고 끄기·동의 / 7-3 새벽 정리 작업 / 7-4 사진 지우기·관리자 내리기·내보낼 때 사진)
8. 홈 화면 위젯 (iOS부터. 8-1 iOS 위젯 완료 10/25 / 8-2 새 사진이 오면 위젯 바로 바꾸기(iOS 26 위젯 전용 신호) 완료 10/26 / 안드로이드는 따로 정함)
9. TV 앱 (삼성 Tizen부터)

## 알려진 제약
- 애플 로그인은 Expo Go에서 동작하지 않는다 (isAvailableAsync가 false). 개발 빌드로 확인한다.
  애플 개발자 유료 등록 완료(10/16, 개인 "moon ki Joung Developer Team"). 무료 계정용 우회(app.config.ts, APPLE_SIGN_IN=off)는 10/16에 지웠다.
  Supabase Auth → Apple의 Client IDs에 번들 ID `com.jmk9633.familyphoto`를 넣어야 로그인된다.
- 푸시: 앱은 `features/push/push.ts`로 권한·토큰(devices 표)만 다루고, 보내기는 Edge Function이 Expo 푸시 서비스로 한다.
  Expo 프로젝트 ID는 `app.json`의 `extra.eas.projectId` (`npx eas-cli@latest init`). 애플 푸시 키는 Expo 계정에 등록한다.
  권한은 첫 그룹을 만들거나 들어간 직후 안내 화면(`/notify`)에서 묻는다. 거절하면 내 정보 탭에서 아이폰 설정으로 보낸다.
  알림 출발은 앱이 기록을 마친 뒤 `requestNotify(type, postId)` → Edge Function `notify` (10/17 결정 A).
  함수가 부른 사람이 정말 그 일을 했는지 DB로 다시 확인하고, `notification_log`(0004)에 먼저 넣어 같은 알림은 한 번만 보낸다.
  new_post=받은 그룹 구성원에게, heart=그 사람의 그 묶음 첫 하트만, seen=그날 처음 볼 때만(시청 표시를 끈 사람 제외).
  admin_changed=그룹을 나가 관리자가 자동으로 넘어갔을 때 → 새 관리자('관리자가 되었어요')와 그룹('관리자가 바뀌었어요')에게 (0007).
  joined=초대 코드로 방금(10분 안) 들어온 사람 → 그 그룹 다른 구성원 모두에게 '가족이 들어왔어요'(`requestJoinNotify(groupId)`, 한 번만은 `join_notification_log` 0006).
  wellbeing_off=내 안부 확인을 방금(10분 안) 스스로 껐을 때 → 그 그룹 관리자에게 '안부 확인이 꺼졌어요 / 엄마가 안부 확인을 껐어요'(`requestWellbeingOffNotify()`, 끈 그룹마다 한 번은 `wellbeing_changes.notified_at` 0011).
  배포: `npx supabase functions deploy notify`. 함수는 앱 tsc에서 빼 두었다(tsconfig exclude, Deno로 검사).
- 새벽 정리 함수 `cleanup`(0012, 7-3)은 pg_cron → pg_net으로 불리므로 JWT 확인을 끈다(`config.toml` `[functions.cleanup] verify_jwt = false`).
  대신 `start_cleanup()`이 `cleanup_runs`에 만든 일회용 표를 `claim_cleanup`(10분 안, 한 번)으로 확인한다. 비밀값 설정은 필요 없다.
  함수 주소(프로젝트 ref)는 `start_cleanup()` 안에 적혀 있다. 배포: `npx supabase functions deploy cleanup --use-api --no-verify-jwt`.
  저장소 파일은 SQL로 지울 수 없어(지워도 실제 파일이 남음) 함수가 Storage API로 지운다.
- 카카오·구글 로그인 복귀 주소는 `familyphoto://auth/callback` 고정 (Supabase가 IP 주소 복귀를 거부하므로 Expo Go 기본 주소를 쓰지 않는다).
  Android Expo Go에서는 이 방식이 동작하지 않으므로 Android는 개발 빌드부터 테스트한다.
  안드로이드는 이 복귀 주소가 Expo Router 화면 이동에도 전달되어 로그인 직후 빈 화면이 생겼다. `src/app/+native-intent.tsx`가 auth/callback 주소의 화면 이동을 막는다 (10/20).
  브라우저 방식이라 카카오 콘솔 안드로이드 플랫폼(키 해시)·구글 Android OAuth 클라이언트(SHA-1) 등록은 필요 없다. 네이티브 SDK로 바꿀 때만 등록한다.
- Supabase 카카오는 이메일 동의항목을 항상 요청한다. 카카오 앱은 비즈 앱(개인 개발자)으로 전환하고 이메일은 '선택 동의'로 둔다.

- 4단계부터 앱 테스트는 개발 빌드(아이폰에 설치한 '가족 사진' 앱 + `npx expo start`)로 한다. Expo Go에 들어 있는 예전 expo-image-manipulator는
  아이폰 세로 사진에서 `ERR_IMAGE_CONTEXT_LOST`로 실패하므로, Expo Go에서는 사진 보내기가 동작하지 않는다 (우회 코드는 10/15에 지움).
- 아이폰 개발 빌드는 유료 팀("moon ki Joung Developer Team")으로 서명한다 (10/16부터, 7일 만료 없음). 네이티브 라이브러리를 추가했을 때 `npx expo run:ios --device`로 다시 빌드.
  처음 빌드 때 키체인 창이 여러 번 뜨면 `security set-key-partition-list -S apple-tool:,apple:,codesign: -s ~/Library/Keychains/login.keychain-db`.

- 읽기 정책이 `can_see_post` 같은 security definer 함수인 테이블은 `.insert().select()`(RETURNING)와 `upsert`(on conflict)를 쓰지 않는다.
  같은 문장 안에서는 함수가 방금 넣은 행을 못 봐서 RLS 오류(42501)가 난다. ID는 앱에서 만들어 넣고 결과를 돌려받지 않는다
  (2단계 그룹 만들기, 3단계 묶음 만들기에서 실제로 겪음).

- 홈 화면 위젯 (8-1, 10/25 결정): `@bacons/apple-targets`(승인 10/25 — expo-widgets는 위젯이 스스로 서버에 물어볼 수 없어 제외)가
  `targets/widget`을 prebuild 때 Xcode 위젯 확장으로 만든다. `app.json`에 `ios.appleTeamId`(2LSRUZU8A8)·App Group이 있어야 한다.
  애플 개발자 사이트에 App Group `group.com.jmk9633.familyphoto`를 등록하고 앱 ID에 연결해 둔다(사용자, 10/25).
  `targets/widget`(Swift)이나 `app.json`을 바꾸면 `npx expo prebuild --platform ios --clean` → `npx expo run:ios --device`로 다시 빌드한다.
  앱 쪽 JS(`features/widget`)만 바꾸면 다시 빌드할 필요 없다. 위젯 색 자산(`targets/*/Assets.xcassets`)은 prebuild가 만들므로 커밋하지 않는다.
  위젯 함수 `widget`은 로그인 정보가 없으므로 JWT 확인을 끈다(`config.toml` `[functions.widget] verify_jwt = false`). 대신 위젯 열쇠를 확인한다.
  배포: `npx supabase functions deploy widget --use-api --no-verify-jwt`.
  애플이 위젯 갱신 횟수를 제한해서(애플 개발자 포럼 안내: 하루 약 72번) 새 사진이 위젯에 뜨기까지 30분 넘게 걸릴 수 있다 (알림을 받아 앱을 열면 바로 바뀐다).
  위젯 확장은 Swift 5 모드, 최소 iOS 16.4 (iOS 17부터 바뀐 배경·여백은 `widgetBackground`·`widgetPadding`으로 나눠 처리).
  개발 빌드에서는 앱이 꺼진 채 위젯을 누르면 '개발 서버 고르기' 화면이 먼저 뜬다(expo-dev-launcher가 링크로 켜지면 자동 연결을 건너뜀). 서버를 누르면 홈으로 간다. 출시 빌드에는 이 화면이 없다 (10/25 확인).
  8-2 (10/25 결정 C): Expo 푸시 서비스는 위젯 신호를 못 보내서 notify가 애플(APNs)에 직접 보낸다. Supabase 비밀값
  `APNS_KEY_ID`·`APNS_TEAM_ID`(2LSRUZU8A8)·`APNS_PRIVATE_KEY_B64`(AuthKey_XXXX.p8를 base64 한 줄로)가 없으면 보내지 않는다.
  신호 주소는 위젯의 `FamilyPhotoPushHandler`(iOS 26)가 공용 칸에 두고 위젯이 `widget` 함수에 물어볼 때마다 함께 보낸다(열쇠가 바뀌어도 따라감).
  개발 빌드(Debug)는 sandbox, 출시 빌드는 production 주소. topic은 `com.jmk9633.familyphoto.push-type.widgets`(다르면 `APNS_WIDGET_TOPIC`).
  위젯 확장에 `aps-environment`가 있어야 한다(`expo-target.config.js`). 배포: notify는 `npx supabase functions deploy notify --use-api`(`_shared` 포함).
  notify 로그에 `[widget push] 보낼 위젯 N개`·`보냄 N개`가 찍힌다. 'APNs 비밀값이 없어 보내지 않음'이면 `npx supabase secrets list`로 APNS_ 세 개 확인(10/26 실제로 빠져 있었음).
  위젯·App Group·푸시 권한처럼 서명 권한이 바뀐 뒤 첫 아이폰 빌드는 `npx expo run:ios --device`가 프로파일을 새로 못 받아 실패한다('No profiles for …widget', 'does not support the App Groups capability').
  → 한 번만 `xcodebuild -workspace ios/app.xcworkspace -scheme app -configuration Debug -destination 'id=<기기 ID>' -allowProvisioningUpdates build` 뒤 다시 `run:ios --device` (10/26). 시뮬레이터는 서명이 필요 없어 이 문제가 안 보인다.
  빌드 로그를 남길 때 `| tee`를 붙이면 expo가 기기를 물어보지 못해 멈춘다 → `npx expo run:ios --device "기기 이름" 2>&1 | tee ios-build.log`처럼 기기를 적는다.

- 쉬운 모드 연결 (6단계, 10/18 결정):
  - 앱 첫 화면 `(auth)/start` = '가족이 알려준 숫자가 있어요' + '내 계정으로 시작하기' 두 버튼. QR 연결은 9단계(TV)와 함께.
  - 숫자 6자리를 다 누르고 '연결하기'를 누를 때 Supabase 익명 로그인을 처음 한 번 만들고 `redeem_invite`를 부른다.
    틀려도 같은 익명 계정을 계속 쓴다(10분 5번 제한 유지). 연결 못 한 익명 계정은 7단계 정리 작업이 지운다.
  - 어느 화면 모음을 열지는 `features/auth/mode.tsx`가 정한다: 로그인 전·연결 중 → (auth), `profiles.easy_mode` → (easy), 그 밖 → (general).
    인터넷이 안 되면 이 폰에 저장한 마지막 값으로 연다. 앱을 열 때·다시 올 때 `last_active_at`을 갱신한다(10분에 한 번).
  - 익명 사용자: 그룹·초대를 만들 수 없고(`anonymous_not_allowed`), 합류하면 늘 쉬운 화면, 쉬운 화면을 끌 수 없다(`anonymous_easy_only`) — 0005.
  - Supabase 대시보드 Authentication에서 익명 로그인(Allow anonymous sign-ins)을 켜야 한다.
  - '새 사진' = 내가 아직 한 장도 안 본 남의 묶음. 홈 배지는 그 묶음 장 수. 홈의 자동 넘김은 시청이 아니다. 한 장씩 보기는 첫 장이 보일 때 '봤어요'.
  - 쉬운 화면 사진 찍어 보내기의 받는 그룹은 MVP에서 항상 속한 모든 그룹(저장 칸 없음). 영상 한마디 제목은 저장하지 않고 화면에서 'OO의 영상 한마디'.
  - 쉬운 화면은 화면의 큰 버튼만 쓰고 밀어서 넘기기는 넣지 않는다.
  - 사진 찍어 보내기·영상 한마디(6-2): `(easy)/camera?kind=photo|video`, expo-camera. 사진 1장(뒤 카메라), 영상은 앞 카메라 + '녹화 시작'을 눌러야 시작, 1분 자동 멈춤.
    받는 그룹은 속한 모든 그룹. 영상 한마디는 `posts.kind = 'video_message'`, 화면 제목은 `format.titleOf`가 'OO의 영상 한마디'로 만든다.
    자동 재시도까지 실패하면 `features/posts/outbox.ts`가 파일을 문서 폴더에 옮겨 두고 쉬운 홈을 열 때 다시 보낸다(같은 묶음 ID).
    맥 시뮬레이터에는 카메라가 없어 아이폰으로만 시험한다.
  - 숫자를 또 받으면 쉬운 화면 더보기 '다른 가족과도 연결하기'(`(easy)/connect`, 숫자판은 `components/easy/CodeEntry`)로 지금 계정 그대로 그 그룹에도 들어간다.
    여러 가족 사진은 쉬운 화면에서 고르지 않고 날짜순으로 합쳐 보여준다 (가족별로 보려면 계정 + 일반 화면).

## 라이브러리 수정본 (patch-package)
`patches/`의 수정본은 `npm install` 때 `postinstall`로 자동 적용된다. 라이브러리 버전을 올리면 수정본도 다시 만들고 아래 확인을 다시 한다.

| 라이브러리 | 무엇을 바꾸나 | 왜 | 확인 |
|---|---|---|---|
| react-native-compressor 2.0.3 | iOS: 압축 영상에 원본 메타데이터 중 촬영 날짜만 옮김. 안드로이드: 원본 위치를 새 파일에 쓰지 않음 | 원래는 위치(GPS)를 포함한 원본 메타데이터를 그대로 옮기고 끄는 옵션이 없음 (보안 규칙 9) | 아이폰으로 위치 켜고 찍은 영상을 보내 성공하는지. 수정본이 빠지면 `lib/videoLocation.ts` 검사가 올리기 전에 막고 보내기가 실패한다 |

원작자에게 위치 빼기 옵션을 제안(PR)해서 받아들여지면 수정본을 지우고 그 옵션을 쓴다.

## 임시 우회 (앱 완성 전에 반드시 없앤다)
사용자 지시: 임시 우회로 대충 넘기지 않는다. 아래 목록은 해당 단계에서 근본 해결하고, 해결하면 이 목록에서 지운다.
출시 빌드에 하나라도 남아 있으면 안 된다.

| 무엇 | 왜 | 언제·어떻게 없애나 | 끝났는지 확인 |
|---|---|---|---|
| (지금 없음 — 3단계 시험 '올리는 중' 묶음은 7-3 새벽 정리로 없어진 것을 10/25 사용자 확인) | | | |

## 지금 하지 않는 것 (MVP 범위 밖)
- 설치 후 자동 연결(디퍼드 딥링크) — 숫자 코드가 주 경로
- 네이버 로그인, 휴대폰 번호 로그인 (2차)
- 안부 플랜 결제 (MVP는 안부 기능 무료)
- 자동 영상 모음, '1년 전 오늘', 얼굴 인식, 지도
