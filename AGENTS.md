# 아이케어(kidcare) — AI 에이전트/개발자 인수인계 문서

> 이 문서는 어떤 LLM·코딩 도구·개발자든 **이 저장소만 읽고** 개발을 이어받을 수 있도록
> 작성되었다. 처음 15분: 이 문서 → `docs/DEVLOG.md`(시간순 개발 일지) → `docs/05_mvp_roadmap.md`.

## 1. 프로젝트 한 줄 요약
한국 보호자용 0–18세 아이 건강 기록 앱 (React Native + Expo SDK 54 + TypeScript + Supabase).
일자별 기록 → 건강관리 영역 분류 → 그래프 → **병원 제출용 PDF 레포트** + 만료형 공유 링크.
3티어 구독제(무료/스탠다드/패밀리) 포함. 개발 브랜치: `claude/fable5-dev-feasibility-993n3x`.

## 2. 절대 불변 원칙 (위반 금지 — 사용자와 합의된 제품 철학)
1. **의료행위 금지**: 진단명 추정, 약 용량 계산·추천, "병원 안 가도 됨" 판단 기능을
   만들지 않는다. AI 보조를 붙여도 자연어 정리·태그 추천·요약까지만.
2. **디스클레이머 고정**: 대시보드·레포트의 "보호자 관찰 기록이며 의학적 소견 아님" 고지 유지.
3. **아이 얼굴 사진 미수집**: 프로필은 이모지 아바타만. 기록 사진은 얼굴 회피 안내 유지.
4. **가입은 법정대리인 본인만** + 가입 시 민감정보 별도 동의. 아이 등록마다 아이 단위
   동의 행(consents) 기록 — RLS가 이를 근거로 기록 INSERT를 차단한다.
5. **구독 게이팅 원칙**: 핵심 안전 기능(기록·그래프·PDF·알림·동의·삭제)은 전 티어 무료.
   다운그레이드해도 기존 데이터는 잠기지 않는다(한도는 "새로 추가"에만).
6. 사용자와는 **한국어**로 소통한다.

## 3. 아키텍처 지도 (가장 중요한 규칙 3개)
```
화면(src/screens) → AppContext(src/context) → Repo 인터페이스(src/services/repo.ts)
                                                ├─ memoryRepo.ts  (데모: AsyncStorage 영속)
                                                └─ supabaseRepo.ts (실서버: RLS/Storage)
```
1. **화면은 Repo 구현을 모른다**. 새 기능 = repo.ts 인터페이스 + 두 구현 + context 노출 순서로.
   env(`EXPO_PUBLIC_SUPABASE_URL/ANON_KEY`) 유무로 자동 전환된다 (`src/lib/supabase.ts`).
2. **차트는 단일 코드 경로**: `src/components/charts/svg.ts`(순수 SVG 문자열 생성)를
   앱(SvgXml)과 PDF(`src/services/reportHtml.ts`의 inline SVG)가 공유한다. 차트 수정은 svg.ts에서.
3. **보안 한도는 서버가 진실**: 동의 게이트·아이 수·공동 보호자 수는 RLS/트리거/RPC가 강제.
   mock은 같은 규칙을 미러링한다(두 구현의 동작 일치가 깨지면 버그 — 과거 실제로 발견·수정됨).

핵심 도메인: 기록 12종 × 건강관리 영역 14종(`src/constants/`), payload는 camelCase JSONB
(`docs/02_db_schema.md`의 규약 표 참조). 구독 한도는 `src/constants/subscription.ts` 한 파일.

## 4. 명령어 / 검증 절차 (수정 후 반드시)
```bash
npm install                 # 최초 1회
npx tsc --noEmit            # ① 타입체크 — 항상
npm run test:e2e            # ② 저장소 계층 E2E 113건 (5사이클 전체 워크플로우 + 설정)
npm run test:gating         # ③ 구독 게이팅 + 모드 플래그 31건
# ④ DB/RLS 변경 시: PostgreSQL 16에서 (auth/storage 셈 포함, 48건)
cd supabase/tests && psql -U postgres -d <새DB> -v ON_ERROR_STOP=1 -f rls_test.sql
# ⑤ UI 변경 시(선택): 웹 빌드 + Playwright — scripts/ 의 각 파일 헤더 참조
npx expo export --platform web --output-dir dist-web
node scripts/persistence-test.mjs   # 영속화 5건
node scripts/ui-cycles.mjs          # UI 5사이클
node scripts/screenshot-all.mjs     # 전 화면 23컷 캡처(사용자 공유용)
npm start                   # Expo Go 실행 (사용자 테스트용)
```
CI(`.github/workflows/kidcare-ci.yml`)가 push/PR마다 ①+④를 자동 실행한다.
데모 시드 규칙: 샘플 데이터(`src/data/sample.ts`)는 '오늘' 기준 상대 날짜로 생성되어
언제 실행해도 그래프가 채워진다 — 절대 날짜로 바꾸지 말 것.

## 5. 현재 상태 (2026-07-10 기준, 로드맵 0~7단계 완료)
- 기능: 가입/동의, 아이 CRUD, 기록 12종+사진, 그래프 6종, 캘린더, PDF 레포트,
  만료형 공유 링크(Edge Function), 보호자 공동관리(owner/editor/viewer), 접종/검진+로컬 알림,
  동의 철회, 완전 삭제(Storage 포함), 3티어 구독+페이월, 개인정보처리방침.
- 데모 모드는 AsyncStorage 영속(재시작 시 자동 로그인) — 사용자가 현재 이 모드로
  **Windows PC + Expo Go(SDK 54)** 에서 개인 테스트 중.
- 사용자별 설정은 `user_settings`(JSONB 1컬럼) + repo `saveSettings`(병합 저장) —
  새 개인 설정은 `UserSettings` 타입에 필드만 추가(스키마 변경 불필요).
  supabase 세션은 SecureStore 키 기반 암호화 저장(`src/lib/secureSessionStorage.ts`,
  웹은 AsyncStorage 폴백).
- 배포 준비물 완비: `eas.json`, 아이콘/스플래시, `docs/06_deployment.md` 체크리스트,
  `npm run verify:supabase`(실 프로젝트 연결 검증 스크립트).

## 6. 다음 작업 (우선순위순)
1. **안드로이드 출시 준비**: `docs/09_android_release.md`가 단일 기준 문서.
   구독 정책(무료 출시+얼리버드)과 SMS(off 기본값=이메일 확인만)는 결정·구현 완료.
   남은 사용자 결정: **번들 ID** — 확정 즉시 app.json 반영.
2. 사용자 피드백 반영(1~3차 완료, 계속 도착 예정): 항목별 수정→검증(§4)→푸시 사이클로.
3. Supabase 운영 프로젝트 연결 검증: 사용자가 프로젝트 생성 후
   `npm run verify:supabase` 실행 — 실패 항목 대응. Edge Function 배포·수신자 테스트.
4. 배포: APK 내부 배포(eas build --profile preview) → 소수 베타 → 스토어.
5. 백로그: `docs/DEVLOG.md` 하단 목록 (성장 백분위, 기록 수정, AI 보조 등).

## 7. 알려진 제약 / 함정 (시간 절약 포인트)
- **Supabase 경로는 실환경 미검증** (로컬 PostgreSQL 셈으로 RLS 44건 검증 완료).
  실제 프로젝트에서 첫 확인 시 `verify_connection.mjs`부터.
- Edge Function(`supabase/functions/share-report`)은 미배포 상태. `--no-verify-jwt` 필수.
- **웹 프리뷰 한계**: RN `Alert`가 웹에서 no-op → 확인 다이얼로그류(삭제/회수/철회)는
  웹에서 실행 불가(네이티브 정상). expo-print도 웹 미지원. 웹은 UI 검증 전용.
- SDK 54에서 `expo-file-system`은 **`expo-file-system/legacy`** 로 임포트해야 한다
  (기존 콜백 API 사용 중). 신규 코드도 동일하게.
- RN에는 Buffer/atob 없음 → base64 디코더 자체 구현이 supabaseRepo.ts에 있음(검증됨).
- Storage 서명 URL은 발급 후 회수 불가 → 공유 링크가 Edge Function 경유인 이유
  (매 접속마다 만료/회수 재검사 후 5분짜리 URL 발급). 이 구조를 우회하지 말 것.
- 사진 서명 URL 24h 만료 — 재발급 로직은 백로그.
- `maestro/smoke.yaml`은 실기기 미실행 상태(좌표 탭은 기기별 보정 필요할 수 있음).
- 개인정보처리방침(`docs/privacy_policy.*`)·이용약관(`src/constants/terms.ts`)은 **법률 검토 전 초안**.
- 번들 ID `app.kidcare.mvp`는 자리표시 — 스토어 첫 업로드 전 확정 필수(이후 변경 불가).
- **SMS 문자 인증 미연동**: `src/services/smsAuth.ts`의 `sendSms()`는 데모 스텁(코드를
  화면에 표시). **모드 플래그 `EXPO_PUBLIC_SMS_MODE`(demo/off/live)** — 미지정 시
  mock=demo, supabase=off(문자 인증 건너뜀, 이메일 확인만 = 1차 출시 기본값).
  'live' 전환 시 발송뿐 아니라 **OTP 생성·검증도 서버(Edge Function)로 이전 필수**
  (현재 구현은 앱 내 검증이라 데모 전용 — 우회 가능/레이트리밋 없음).
  아이디 찾기(`findEmailByPhone`)는 supabase 구현이 definer RPC + SMS 연동 필요 →
  mock만 완성. off 모드의 비밀번호 재설정은 `requestPasswordResetEmail`(재설정 메일)
  로 대체 — 단 링크 도착지(Site URL/redirect) 설정은 운영 프로젝트에서 필요.
- **데모 로그인 규칙**: `demo@kidcare.app`로 로그인하면 샘플 데이터(아이2+14일)가 로드되고
  티어는 standard로 강제됨. 일반 가입/로그인은 빈 상태 + **free 티어**로 시작하며,
  저장본에 샘플 잔재가 있으면 `stripSampleData()`가 정리한다(memoryRepo).
  로직/스크린샷 테스트는 이 데모 계정 로그인을 전제로 함.
- 네이티브 date/time 픽커(`DateField`)·키보드 회피(`KeyboardScreen`)는 웹에서 폴백으로만
  동작 → 실기기 확인 필요. 웹 프리뷰로는 픽커 UX를 검증할 수 없음.
- **결제 미연동**: `src/services/billing.ts`의 `purchaseWithStore()`/`restorePurchases()`가
  교체 지점(가이드 주석 포함). 페이월은 `EXPO_PUBLIC_PAYWALL_MODE`(demo/hidden/live)로
  분기 — env 미지정 시 실서버 빌드는 **hidden**(Play 정책 안전 기본값).
  웹훅은 `supabase/functions/billing-webhook`(미배포). 절차: docs/07 §실연동.
- **EXPO_PUBLIC_* env 변경은 Metro 캐시에 반영 안 됨** — 값 바꿔 빌드할 때
  `npx expo export --clear` 필수 (실제로 이것 때문에 검증 1회 실패했음).

## 8. 문서 찾아가기
| 문서 | 내용 |
|---|---|
| `docs/DEVLOG.md` | **시간순 개발 일지** — 모든 결정·이유·검증 기록 (이어받기 필독) |
| `docs/01~04` | 폴더 구조 / DB 스키마·payload 규약 / 화면 목록 / API 설계 |
| `docs/05_mvp_roadmap.md` | 단계별 완료 현황 |
| `docs/06_deployment.md` | 배포 가이드 + 계정 소유자 체크리스트 |
| `docs/07_monetization.md` | 구독 설계 + 결제 연동 경로 |
| `docs/08_adult_expansion.md` | 성인 관리 확대 대비 설계 규칙 (새 코드에 child 하드코딩 금지 등) |
| `docs/09_android_release.md` | **안드로이드 출시 종합 체크리스트** (결정 사항·차단 항목·심사 폼) |
| `QUICKSTART.md` | 사용자용 5분 실행 가이드 (Expo Go) |
| `supabase/` | schema.sql → schema_stage3.sql → schema_subscriptions.sql → schema_settings.sql (실행 순서), tests/, functions/ |

## 9. 작업 규칙 (지금까지의 관례 유지)
- 커밋: 의미 단위로, 본문에 "왜"를 씀. 개발 브랜치에 푸시 (main 직push 금지).
- 작업 완료마다 `docs/DEVLOG.md` 하단에 엔트리 추가 (한 일 / 결정과 이유 / 검증 / 남은 것).
- 검증 없이 "완료" 선언 금지 — §4 절차를 돌리고 결과(통과 수치)를 일지에 남긴다.
- UI 변경 시 스크린샷(scripts/screenshot-all.mjs)으로 사용자에게 확인받는 흐름 권장.
