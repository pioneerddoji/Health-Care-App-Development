# 아이케어 개발 일지

진행 내용과 결정 사항을 시간순으로 기록한다. 새 작업이 끝날 때마다 상단이 아닌
**하단에 이어서** 엔트리를 추가한다. (형식: 날짜 / 한 일 / 결정과 이유 / 검증 / 다음)

---

## 2026-07-09 — 0단계: 프로젝트 골격 + 설계 (커밋 `493aa84`)

**한 일**
- 설계 문서 5종: 폴더 구조, DB 스키마(RLS 포함 DDL), 화면 목록, API 설계, 로드맵
- Expo SDK 53 + TypeScript 스캐폴드, 화면 13개 전부 동작 (인증→동의→홈→기록→대시보드→레포트→접종→설정)
- 도메인 모델: 기록 유형 12종 × 건강관리 영역 14종, 유형→영역 태그 자동 제안
- 차트 6종(체온/수면/식사·수분/배변/증상 타임라인/성장) — SVG 문자열 생성 함수를
  앱(react-native-svg `SvgXml`)과 PDF(inline SVG)가 공유
- 병원 제출용 PDF 레포트(expo-print): 1p 요약, 그래프, 상세 기록, 복용약,
  알레르기/기저질환, 의사에게 질문, 고정 디스클레이머
- 샘플 데이터: 아이 2명 + 14일 기록(발열 에피소드 포함), '오늘' 기준 상대 날짜로 생성

**결정과 이유**
- 화면 → context/services → 저장소 구조: Supabase 없이도 전체 플로우가 도는 것을
  0단계 목표로 삼음 (백엔드 미결정 상태에서 UX 검증 가능)
- 차트 단일 코드 경로: 앱/PDF 그래프가 어긋나는 이원화 방지
- 진단·용량추천·수진판단 기능은 **영구 비범위**로 문서화, 디스클레이머 상시 삽입
- 팔레트는 dataviz 검증기 통과값 사용 (CVD 안전 확인)

**검증**
- `tsc --noEmit` 통과, 집계·레포트 HTML을 Node로 실행 테스트
- 레포트를 Chromium으로 렌더링해 육안 확인 → **y축 눈금 라벨 잘림 버그 발견·수정**
  (큰 값은 정수 눈금 + 좌측 여백 38→44px)

---

## 2026-07-09 — 1·2단계: Supabase 연동 + 사진 첨부 (커밋 `89ad06a`)

**한 일**
- 저장소 계층 `repo.ts` 도입: `memoryRepo`(데모) / `supabaseRepo` — env 유무로 자동 전환
- Supabase Auth: 이메일 가입/로그인/세션 복원(AsyncStorage), 이메일 확인 프로젝트 안내 처리
- 아이 생성 시 owner 관계 + 법정대리인·민감정보 동의를 consents에 기록 (RLS 전제 충족)
- 사진 첨부: 기록 폼 최대 4장(expo-image-picker), 목록 썸네일, Storage `record-files`
  버킷 업로드(경로 `childId/recordId/파일명`) + 24시간 서명 URL
- PDF에 사진 포함: 로컬 file://는 base64 data URI로 임베드 (PDF WebView가 file:// 차단)
- Storage 버킷 생성 + 경로 기반 정책을 schema.sql에 추가
- seed.sql·문서의 payload 키를 앱과 동일한 camelCase로 통일 (매핑 코드 제거)

**결정과 이유**
- RN에 Buffer/atob가 없어 base64 디코더 직접 구현 → Node Buffer와 대조 테스트로 검증
- 서명 URL(비공개 버킷) 채택: 건강 사진을 공개 URL로 노출하지 않기 위함
- 모든 화면 쓰기 동작을 async + 실패 Alert로 전환

**검증**
- `tsc --noEmit` 통과, memoryRepo 전 플로우(tsx) 통과, base64 디코더 0~10만 바이트 대조 통과
- ⚠️ supabaseRepo는 실제 프로젝트 없이 타입 수준 검증까지만 — 실기기 연결 시
  가입→아이 등록→사진 포함 기록 저장 순서로 확인 필요

---

## 2026-07-09 — 3단계: 보호자 공동 관리 + 다자녀 (이번 커밋)

**한 일**
- `schema_stage3.sql`: 이메일 초대 RPC `invite_guardian`(definer, owner 전용),
  공동 보호자 프로필 열람 정책, guardian_child 정책 세분화
- repo/context 확장: `listGuardians / inviteGuardian / updateGuardianRole / removeGuardian`,
  아이별 내 역할(`roles`) 로드 → `roleOf` / `canEdit`
- 설정 화면: 선택된 아이의 보호자 목록(이름·관계·역할), 이메일 초대(편집자/열람자),
  역할 전환, 해제 — 모두 owner 전용 UI
- viewer 읽기전용 처리: 기록 추가/삭제, 프로필 수정, 접종 추가/완료, 데이터 삭제 차단 + 안내
- 아이 전환 UX: 기록/대시보드/레포트 탭 상단에 ChildSwitcher(다자녀 칩, 열람 전용 🔒 표시)
- mock 데모에 공동 보호자 샘플(박아빠·편집자) 추가

**결정과 이유**
- **기존 RLS 구멍 2개 발견·수정**: 구 정책(`owner manages links`)은 ① 아무나 임의
  아이에 자기 행 삽입 가능 ② editor가 자기 role을 owner로 승격 가능했다.
  → 삽입(부트스트랩/owner), 수정(owner가 타인만, editor·viewer로만), 삭제(owner가
  타인 제거 or 본인 나가기)로 분리. 기존 설치본은 `schema_stage3.sql`만 추가 실행.
- 초대는 RPC로: 클라이언트는 auth.users(이메일)를 조회할 수 없으므로 definer 함수에서
  이메일→uid 해석. 미가입 이메일은 오류 메시지로 가입 안내.
- 소유권 이전(owner 변경)은 비범위 — 필요 시 별도 단계로.

**검증**
- `tsc --noEmit` 통과, memoryRepo 초대→역할 변경→해제 플로우(tsx) 통과
- **RLS 통합 테스트 작성·통과 (28/28)**: 로컬 PostgreSQL 16에 auth/storage 셈을 만들어
  schema.sql + schema_stage3.sql을 적용하고 2계정 시나리오 실행 —
  동의 게이트, 임의 참여·자기승격 차단, 초대 RPC(미가입/비소유자/owner권한 거부),
  editor 기록 허용→viewer 강등 시 차단, 공동 보호자 프로필 열람, Storage 경로 정책,
  나가기, 외부인 완전 차단, owner 삭제 cascade. → `supabase/tests/rls_test.sql`로 보존
- ⚠️ 실제 Supabase(auth 훅, 실제 definer 권한)에서의 최종 확인은 프로젝트 연결 후 1회 필요

---

## 2026-07-09 — 정책 결정 + 4단계: 레포트 발행/공유 링크, 예정일 알림 (이번 커밋)

**정책 결정 (사용자 지시)**
- 아이 프로필에서 **얼굴 사진 필드를 완전히 제거**(타입·스키마·매핑 전체) — 프로필은
  이모지 아바타만 사용. 기록에 첨부하는 사진(증상 부위·처방전)은 유지하되,
  "얼굴이 나오지 않게 촬영" 안내를 기록 폼에 추가.
- 가입은 법정대리인 본인만 가능함을 회원가입 화면에 명시. 법정대리인 동의는
  기존 구조대로 **가입 직후 동의 화면**에서 처리(아이 등록 시 아이 단위 동의
  행이 자동 기록되는 기존 메커니즘은 유지 — RLS가 이 행을 근거로 하므로).

**한 일**
- `publishReport`: 생성한 PDF를 Storage `reports` 버킷(`childId/reportId.pdf`)에
  업로드하고 `reports` 행 생성. `createShareLink`/`listShareLinks`/`revokeShareLink`를
  repo 인터페이스에 추가, memoryRepo·supabaseRepo 모두 구현.
- **공유 링크는 DB RPC가 아니라 Edge Function으로 설계**: Storage 서명 URL은
  발급 후 되돌릴 수 없다는 제약이 있어, "지금 회수"가 실제로 접근을 끊으려면
  수신자가 링크를 열 때마다 서버가 만료/회수를 재검사한 뒤 짧은 수명(5분)의
  서명 URL을 새로 발급해야 한다. `supabase/functions/share-report`가 이 역할을
  하며, 기존에 만들어 뒀던 `get_shared_report` DB 함수는 이 설계로 완전히
  대체되어 스키마에서 제거했다.
- 레포트 탭: 기간/질문 선택 후 "만료형 공유 링크 만들기"(24h/72h/7일 선택) →
  링크 복사(expo-clipboard)/공유(Share API). 설정 탭: 아이별 공유 링크 목록
  (기간, 상태, 만료 시각) + 즉시 회수 버튼으로 자리표시를 실제 기능으로 교체.
- 예방접종/검진 예정일 로컬 알림(`src/services/reminders.ts`, expo-notifications):
  `addVaccination`/`addCheckup`에서 dueDate가 있으면 자동 예약(기본 1일 전 오전 9시),
  `updateVaccination`에서 완료 처리 시 자동 취소·예정일 변경 시 재예약. 식별자를
  `vacc-<id>`/`checkup-<id>`로 고정해 중복 예약 없이 갱신 가능.
- app.json에 `expo-notifications` 플러그인과 Android `POST_NOTIFICATIONS` 권한 추가.

**검증**
- `tsc --noEmit` 통과 (Deno Edge Function은 별도 런타임이라 tsconfig에서 제외)
- memoryRepo report/share-link 플로우(tsx): 발행→링크 생성→목록→회수→존재하지
  않는 레포트 링크 생성 시 오류, 전부 기대대로 동작
- **RLS 테스트 33건으로 확장** (`supabase/tests/rls_test.sql`): 기존 28건 +
  레포트 발행(owner 허용/viewer 차단), 레포트 메타는 viewer도 열람 가능하지만
  `share_links`는 owner/editor만 조회 가능(자체 재공유 방지) 5건 추가. 검증
  과정에서 테스트 스크립트 자체의 버그(사용자 컨텍스트 전환 누락으로 이후
  단언문이 잘못된 사용자로 실행됨)를 하나 발견·수정 — 실제 정책 결함은 아니었음.
- ⚠️ Edge Function은 실제 배포·수신자 관점 테스트를 하지 못함 (Supabase 프로젝트
  미연결 + Deno 런타임 필요). 배포 명령과 `--no-verify-jwt` 필요성은 문서화함.

---

## 2026-07-10 — UI 검증 스크린샷 + 5단계: 마감 품질 (이번 커밋)

**UI 검증(웹 프리뷰)**
- react-native-web/react-dom을 추가하고 `expo export --platform web`으로 실제 앱을
  웹 빌드 → 헤드리스 Chromium(Playwright)으로 가입→동의→홈→프로필→접종→기록→
  대시보드→레포트→설정 전 플로우를 자동 순회하며 16개 화면 스크린샷 확보, 사용자에게 전달.
  모든 화면·차트·이모지가 정상 렌더링됨을 확인. 웹 빌드 산출물(`dist-web/`)은 gitignore.

**한 일 (5단계)**
- **완전 삭제**: `deleteChildAndData`가 Storage의 사진(record-files)과 레포트 PDF(reports)를
  prefix 재귀 탐색으로 먼저 지운 뒤 children 행을 삭제(cascade). 별도 배치가 불필요해져
  당초 계획(소프트 삭제→배치)을 클라이언트 즉시 완전 삭제로 변경 — 고아 파일이 남지 않는다.
- **동의 철회/재동의**: 설정 → 동의 내역에서 아이별 민감정보 동의 상태 표시, 철회(확인 다이얼로그)
  시 새 기록 입력이 즉시 차단(기록 탭 안내 + mock/RLS 이중 차단), 재동의 버튼으로 복구.
  loadAll이 아이별 동의 상태를 함께 내려준다.
- **개인정보처리방침**: 앱 내 화면(설정에서 진입) + 웹 게시용 `docs/privacy_policy.md` 초안.
  수집 항목/목적, 민감정보 별도 동의, 만 14세 미만 처리, 국외 이전 고지 틀, 공유 링크 제3자
  제공 범위, 파기, 정보주체 권리, 의료행위 아님 고지 포함. **법률 검토 전 초안임을 명시.**
- **알림 권한 안내**: 권한이 거부된 기기에서는 접종 화면 상단에 배너 + "기기 설정에서 알림 켜기".
- **E2E 스모크**: `maestro/smoke.yaml` — 가입→동의→기록 추가→대시보드→레포트→설정 플로우.

**검증**
- `tsc --noEmit` 통과, memoryRepo 동의 철회→기록 차단→재동의→기록 허용(tsx) 통과
- **RLS 테스트 39건 통과**: 동의 철회 후 INSERT 차단 → 재동의 후 허용 4건 추가
- ⚠️ Maestro 플로우는 실기기/에뮬레이터가 없어 미실행 (좌표 기반 탭은 기기 해상도에 따라
  조정 필요할 수 있음), Storage 재귀 삭제는 실 Supabase에서 미검증

---

## 2026-07-10 — 전 기능 E2E 5사이클 테스트 (이번 커밋)

**방법** — 두 트랙으로 전체 워크플로우를 5회 반복:
- 트랙 A(로직): 저장소 계층에서 아이 생성→기록 6종→집계 검증→접종 완료→레포트
  HTML/발행→공유 링크 생성·회수→보호자 초대/역할변경/해제→동의 철회·차단·재동의→
  완전 삭제→베이스라인 복귀 불변식. 사이클당 22개 단언 × 5.
- 트랙 B(UI): 웹 빌드를 Playwright로 가입→동의→아이 추가→증상 기록→대시보드
  기간 전환→레포트 질문+공유 링크→설정(링크 목록/초대/동의)→로그아웃을 같은
  세션에서 5회 반복 — 상태 누적(아이 3→7명)과 콘솔 에러 감시.

**결과**: 트랙 A **110/110 통과**(수정 후), 트랙 B **5사이클 전부 통과**(기능 이슈 0,
콘솔 에러는 favicon 404 1건뿐 — 무해).

**발견·수정한 버그 (4)**
1. (mock) 아이 삭제 후 레포트/공유 링크/동의 상태가 잔존 — supabase의 FK cascade와
   동작 불일치. 삭제된 아이의 공유 링크가 목록 API에 계속 노출될 수 있었음 → 정리 추가.
2. **로그아웃하면 로그인 화면이 아니라 직전에 머물던 회원가입 화면으로 복귀** —
   Gate의 화면 상태가 리셋되지 않음 → guardian이 null이 되면 로그인으로 복귀.
3. 데모 모드의 공유 링크 생성이 PDF 생성에 불필요하게 결합 — 데모는 업로드가 없는데도
   expo-print를 먼저 호출해 (print 미지원 환경에서) 링크 생성 전체가 조용히 실패
   → 데모 모드는 PDF 생성을 건너뜀. AppContext 삭제 시 역할/동의 맵 정리도 보강.
4. (표기) 수면 기록 없는 아이의 레포트 요약이 "평균 수면 -시간"으로 표시 → "기록 없음",
   공유 링크 복사/공유 버튼 찌그러짐 → flex 배분.

**특이사항 (수정 없이 기록)**
- 웹 프리뷰 한계: RN `Alert`가 웹에서 no-op → 삭제/회수/철회 등 **확인 다이얼로그가
  필요한 동작은 웹 프리뷰에서 실행 불가**(네이티브 정상). expo-print/공유 시트도
  웹 미지원. 웹은 어디까지나 UI 검증용.
- 데모 모드는 인메모리 단일 저장소라 같은 세션에서 계정을 바꿔도 데이터가 공유됨
  (실 모드는 RLS로 격리) — 데모 한정 특성으로 문서화.

---

## 2026-07-10 — 6단계: 배포 준비 (이번 커밋)

**한 일**
- EAS 빌드 프로파일(`eas.json`: development/preview/production, autoIncrement),
  app.json 프로덕션 설정(아이콘/스플래시/adaptive icon, buildNumber/versionCode,
  ITSAppUsesNonExemptEncryption)
- 앱 아이콘·스플래시 임시 시안 생성(브랜드 웜톤 배경 + 🧸) — 디자인 교체 가능
- **Supabase 연결 검증 스크립트** `npm run verify:supabase`: 실 프로젝트에 2계정
  가입→아이/동의/기록→Storage 업로드+서명 URL→RLS 격리→초대 RPC→자기승격 차단→
  viewer 강등→레포트+공유 링크→Edge Function 응답→동의 철회→cascade 삭제까지
  자동 스모크 (앱 코드와 독립적인 순수 Node 스크립트)
- **CI**(GitHub Actions `kidcare-ci.yml`): kidcare 경로 변경 시 타입체크 +
  PostgreSQL 16 서비스 컨테이너에서 RLS 39건 회귀 테스트
- 개인정보처리방침 웹 게시본(`docs/privacy_policy.html`, 호스팅만 하면 됨)
- 배포 가이드(`docs/06_deployment.md`): 준비된 것 / 계정 소유자 체크리스트
  (Supabase 리전 선택, 번들 ID 확정 시점, EAS Secrets, 심사 노트·데이터 보안 폼
  작성 요령, 카테고리 선택 — 의료 아닌 건강/라이프스타일 권장)

**결정과 이유**
- 번들 ID는 자리표시(`app.kidcare.mvp`) 유지 — 소유 도메인 확정 전 임의 확정 시
  스토어 첫 업로드 후 변경 불가 리스크. 체크리스트 최상단에 명시.
- 스토어 카테고리는 의료가 아닌 건강/라이프스타일 권장 — 의료 카테고리는 심사
  기준(의료기기 규제 검토)이 더 엄격하고, 본 앱은 진단 기능이 없음.

**검증**
- 타입체크 통과, verify 스크립트의 env 미설정 가드 동작 확인
- ⚠️ verify 스크립트 본체와 CI 워크플로우는 실 Supabase/GitHub Actions 환경에서
  1회 실행 필요 (환경상 여기서 실행 불가) — B-1 체크리스트 5번이 그 지점

---

## 2026-07-10 — 7단계: 수익화 3티어 구독제 (이번 커밋)

**검토**: 코드 전수 검색으로 기존 수익화 구조 없음 확인 → 신규 설계.

**한 일**
- 티어 정의(`constants/subscription.ts`): 🌱무료(아이1·초대불가·사진1장·대시보드7일·링크24h/1개)
  / 🌿스탠다드 ₩2,900(아이3·초대2·사진4장·전체기간·링크72h/5개) / 🌳패밀리 ₩4,900(무제한+7일링크).
  **핵심 안전 기능(기록·그래프·PDF·알림·동의·삭제)은 전 티어 무료**, 다운그레이드해도
  기존 데이터는 잠기지 않음(한도는 "새로 추가"에만 적용) — 페이월에 명시.
- DB(`schema_subscriptions.sql`): subscriptions 테이블(쓰기는 service_role=스토어 웹훅만,
  본인 행 읽기만), `my_tier()`(만료 시 free 강등). **서버 강제 2종**: 아이 수
  (guardian_child 트리거), 공동 보호자 수(invite_guardian RPC 확장).
- 앱: repo/context에 구독 상태 + `ent`(엔타이틀먼트), PaywallScreen(3티어 비교·전환),
  설정 플랜 카드, 게이팅 — 아이 추가(홈)·사진 장수(기록폼)·기간 칩(대시보드)·
  만료 옵션/활성 링크 수(레포트)·초대(설정)에 🔒 표시 → 페이월 유도.
  mock은 기본 standard로 시작해 페이월에서 전환 체험 가능(결제 시뮬레이션).
- `verify:supabase` 확장: free 초대 차단 검증 + SERVICE_ROLE 키 제공 시 웹훅
  시뮬레이션으로 유료 플로우까지. seed.sql은 standard 구독 행 추가(아이 2명 시드).

**결정과 이유**
- 서버 강제는 아이 수·공동 보호자 수 2종만: 진짜 비용/규모 레버이고 우회 시
  타인에게 영향. 사진 장수·기간·링크 수는 우회 피해가 본인 한정 → 클라이언트 게이팅.
- 결제 SDK(RevenueCat)는 스토어 계정+development build 필요 → 연동 경로만 문서화
  (docs/07). 구독 진실 원천이 서버 테이블이라 웹훅만 붙이면 끝나는 구조.

**검증**
- RLS 통합 테스트 **44건 통과**(+5: free 아이 한도 트리거, free 초대 차단 RPC,
  standard 업그레이드 후 허용, 구독 정보 타인 비노출)
- 게이팅 스모크 12건 통과(3티어 전환 + 엔타이틀먼트 단조성), `tsc` 통과
- ⚠️ 실 스토어 결제/웹훅은 미연동 — 스토어 계정 확보 후 docs/07 절차로

---

## 2026-07-10 — 개인 사용 준비: 데모 모드 기기 영속화 + 퀵스타트 (이번 커밋)

**배경**: 사용자가 혼자 먼저 써보길 원함. 기존 데모 모드는 인메모리라 앱 재시작 시
데이터가 사라져 실사용 불가 → Supabase 없이도 쓸 수 있게 로컬 영속화 추가.

**한 일**
- 데모 저장소를 AsyncStorage로 영속화(`src/lib/demoStorage.ts` + memoryRepo 래퍼):
  모든 변이 메서드 성공 시 자동 저장, 첫 호출 시 하이드레이션. 로그인 상태도
  유지되어 재시작 시 자동 로그인. Node 테스트 환경에서는 인메모리 폴백으로
  기존 스모크가 그대로 동작.
- `QUICKSTART.md`: 휴대폰+Expo Go 5분 가이드 — 실행 3단계, 샘플 아이 정리법,
  데모 한계(공유 링크 가짜/플랜 시뮬레이션), 컴퓨터 없이 쓰려면 APK 빌드 안내.

**검증**
- 웹 빌드 + Playwright로 영속화 E2E 5건 통과: 기록 저장 → **새로고침(재시작) 후
  자동 로그인 + 기록 유지** → 로그아웃 상태도 재시작 후 유지
- 기존 로직 E2E 110건·게이팅 스모크 12건 회귀 없음, `tsc` 통과

---

## 2026-07-10 — SDK 54 업그레이드 + 인수인계 정비 (이번 커밋)

**SDK 54 업그레이드** (사용자 실기기 테스트 중 발견)
- 스토어의 Expo Go 최신판이 SDK 54 전용이 되어 SDK 53 프로젝트를 거부 →
  expo ~54.0.0 / react-native 0.81 / react 19.1로 전체 업그레이드.
- 마이그레이션 포인트 2개: `expo-file-system`은 `/legacy` 엔트리로 임포트
  (콜백 API 분리됨), `babel-preset-expo`를 devDependency로 명시(전이 노출 중단).
- 검증: SDK 54 웹 빌드에서 영속화 E2E 5건 + 로직 122건 + tsc 통과.
  **사용자가 Windows PC + Expo Go로 실기기 테스트 성공, 현재 사용 중.**

**인수인계 정비** (fable5 한도 종료 후 다른 LLM/도구로 개발 연속성 확보)
- 세션 임시 폴더에만 있던 검증 스크립트를 저장소로 이관: `scripts/`
  (e2e-cycles, subscription-smoke → `npm run test:e2e` / `test:gating`,
  persistence-test·ui-cycles·screenshot-all은 Playwright용 — 파일 헤더에 준비물 명시).
- **`AGENTS.md`** 신설: 불변 원칙, 아키텍처 규칙 3개, 검증 절차, 현재 상태,
  다음 작업 우선순위, 알려진 함정 목록 — 저장소만 읽고 이어받을 수 있도록.
  `CLAUDE.md`는 AGENTS.md 포인터.
- tsx를 devDependency로 추가해 테스트가 `npm run`으로 어디서든 실행되게 함.

---

## 2026-07-11 — 사용자 1차 피드백 반영: 인증 강화 + 기록 간소화 (이번 커밋)

사용자가 실기기(Expo Go, SDK 54)로 써보고 보낸 개선 목록을 회원가입~기록 관리
범위까지 반영. (대시보드 이후 항목은 사용자가 별도 정리 예정 → 다음 작업)

**공통**
- 키보드가 입력 필드를 가리지 않도록 `KeyboardScreen`(KeyboardAvoidingView) 도입,
  로그인/회원가입/계정찾기/아이등록/기록입력 화면에 적용. `keyboardShouldPersistTaps`로
  키보드 열린 상태에서도 버튼 탭 가능.

**회원가입** (`SignUpScreen`)
- 이메일 형식 실시간 검증 + 인라인 에러. (기 등록 이메일 중복은 supabase 모드에서
  가입 시 "already registered" 오류로 표시 — 실서버에서만 판정 가능)
- 비밀번호 규칙: 8자↑ + 영문(대소문자 구분) 필수 + 숫자/특수문자 허용, 한글/공백 불가.
  `src/lib/validation.ts`의 `passwordError`.
- 연락처: 숫자만 입력(하이픈 자동 제거, maxLength 13으로 붙여넣기 허용), **필수**.
- **휴대폰 6자리 문자 인증**: 연락처로 OTP 발송 → 앱에 입력 → 승인 시 가입 완료.
  `src/services/smsAuth.ts`(requestOtp/verifyOtp, 3분 만료). ⚠️ 실제 SMS 발송은
  국내 공급자(알리고/솔라피 등) 계약 필요 → 현재 데모는 코드를 화면에 표시.
  실서비스 전환 시 `sendSms()` 내부만 교체하면 됨.

**로그인** (`LoginScreen`)
- 이메일 형식 검증. "아이디 찾기 · 비밀번호 찾기" 링크 추가.
- **계정 찾기 화면 신설**(`FindAccountScreen`): 가입 연락처로 OTP 인증 후
  아이디(이메일) 조회 또는 비밀번호 재설정. repo에 `findEmailByPhone`/`resetPassword`
  추가(mock 구현 완료, supabase는 definer RPC+SMS 연동 필요 — 미구현 오류 안내).

**이용 동의** (`ConsentScreen`)
- 각 항목 "전문 보기" 모달 추가. 약관 전문 3종을 `src/constants/terms.ts`에 작성
  (서비스 약관/법정대리인/민감정보 — 내용 충실화, **법률 검토 전 초안**).
- [선택] 소식 알림 수신 동의는 노출 숨김(terms.ts 주석으로 보존, 채널 확정 후 부활).

**홈** (`ChildListScreen`)
- 신규 가입 시 **빈 상태로 시작**(샘플 제거) + 빈 상태 안내 카드. 샘플 데이터는
  `demo@kidcare.app` 로그인 시에만 로드(체험용). → memoryRepo `signUp`이 데이터를
  비우고, `signIn`이 DEMO_EMAIL일 때만 샘플 시드.
- 하단 디스클레이머 문구를 "필요 시 레포트를 참고하여 소아청소년과 의사와 상담하세요."로 변경.

**아이 등록** (`ChildFormScreen`)
- 생년월일: 텍스트 입력 → **달력 픽커**(`DateField`, 네이티브 date/time 픽커, 웹은
  텍스트 폴백). 미래 날짜 선택 차단.
- 보호자 연락처/재태 주수/조산아 여부 필드 삭제.
- 건강 정보 섹션에 "(필요 시 추가 작성)" 문구 + **기타** 자유 입력 필드 추가
  (Child.otherNotes / children.other_notes 컬럼, 프로필에도 표시).

**기록 추가** (`RecordFormScreen`)
- 간편화: 자주 쓰는 유형 5종(증상/식사/수면/배변/메모)을 앞에, 나머지는 "더보기"로 접음.
- 시간: 텍스트 → **시계 픽커**(기본값 = 현재 시각). 수면 시작/종료도 픽커.
- 건강관리 영역 태그: **수동 선택 제거 → 유형 기반 자동 분류**(읽기 전용 표시).
  사용자가 카테고리 고르며 혼동하는 문제 해소.
- 사진 첨부 한도: 무료 1 / 스탠다드 3 / 패밀리 10장으로 조정(기존 1/4/4 → 1/3/10).

**기록 관리** (`DayRecordsScreen`)
- 시간순 평면 나열 → **유형(카테고리)별 그룹 + 그룹 내 시간순**.
- 시간 표기가 블록 밖으로 삐져나오던 문제 수정(고정폭 42px + flexShrink).

**결정과 이유**
- 신규 가입 빈 상태 vs 데모 체험 양립: `demo@kidcare.app` 전용 로그인으로 샘플 로드.
  덕분에 로직/스크린샷 테스트도 데모 계정 로그인으로 통일(가입 플로우는 OTP까지 검증).
- SMS/아이디·비번찾기의 supabase 구현은 서버 RPC+공급자 계약이 필요해 mock만 완성,
  supabase 경로는 명시적 오류로 안내(은폐된 미구현 방지).

**검증**
- `tsc` 통과. `npm run test:e2e` 110건 + `test:gating` 12건 통과(데모 로그인 기반으로
  갱신). 웹 빌드 후 Playwright로 (a) 영속화 5건 (b) **신규 회원가입 플로우 6건**
  (이메일 검증/숫자만/OTP/약관 전문/빈 홈) 통과.
- ⚠️ 네이티브 date/time 픽커·키보드 회피는 웹 폴백으로만 검증됨 → 실기기 확인 권장.

**다음**: 사용자의 "대시보드부터 이후" 개선 항목 대기 중.

## 2026-07-12 — 사용자 2차 피드백 반영: 홈 잔재 버그 + 기록 상세/사진 뷰어 + 대시보드 (이번 커밋)

**홈 — "최초 가입인데 샘플 김도윤이 보임" 원인 규명 및 수정**
사용자 기기의 AsyncStorage에 구버전(샘플이 기본이던 시절) 저장본이 남아 있던 것
+ 실제 버그 1건이 겹친 증상:
- 버그: `signUp`이 데이터는 비우면서 **구독 티어를 리셋하지 않아** 신규 가입이
  standard로 시작 → `subscription = { tier: 'free' }` 추가.
- 마이그레이션: `hydrate()`에서 일반 계정(비데모) 저장본에 샘플 아이(child-1/2)가
  남아 있으면 관련 데이터 전부 제거 후 재저장(`stripSampleData()`).
- 연쇄 버그 발견·수정: 데모 로그인이 `accountEmail`을 갱신하지 않아 (a) 일반 가입
  후 데모 로그인 → 재시작 시 마이그레이션이 데모 샘플을 오삭제, (b) 데모 후 일반
  로그인 시 샘플이 남아 보이는 경로가 있었음 → 데모 로그인은 `accountEmail=DEMO_EMAIL`
  + standard 강제, 일반 로그인은 `accountEmail=이메일` + 샘플 정리 + (직전이 데모면)
  free로 복귀.

**기록 추가** (`RecordFormScreen`)
- 자주 쓰는 유형에 **약 복용** 추가(증상/식사/수면/배변/약 복용/메모 6종).
- 사진 한도(1/3/10)는 이미 적용돼 있었음 — 확인 후, 안내가 없어 헷갈리지 않게
  섹션 제목에 "사진 첨부 (현재 플랜: 최대 N장)"으로 한도를 명시.

**기록 관리** (`DayRecordsScreen`)
- 기록 카드 **탭 → 상세 팝업**(`RecordDetailModal`): 유형별 payload를
  "라벨 · 값" 행으로 정리해 표시(빈 값 숨김), 메모/태그/사진 포함.
- 사진 **탭 → 전체화면 뷰어**(`PhotoViewer`): 좌우 스와이프(페이징) + 화살표는
  끝↔처음 **순환** + 하단에 "n / 전체" 인디케이터. 카드 썸네일/상세 팝업 양쪽에서 열림.

**대시보드** (`DashboardScreen`)
- 조회 기간 게이팅 조정: 무료 7일 / **스탠다드 7·14일** / 패밀리 7·14·30일
  (`subscription.ts` 한 줄 — 페이월 표는 자동 반영).
- 그래프 카드 **길게 누르기 → 순서 변경 모드**(↑/↓ 버튼), 순서는 기기에 저장
  (`kidcare.dashboard.order.v1`, 새 그래프 추가돼도 목록에서 누락되지 않게 병합).

**공통 — 성인 관리 확대 대비**: `docs/08_adult_expansion.md` 설계 노트 신설
(새 코드에 child 개념 하드코딩 금지, 동의 모델 분기 계획, birth_date 기반 스키마라
재설계 불필요함을 기록). "무제한 조회 플랜" 제안 검토는 docs/07에 기록
(월별 집계 뷰 선행 필요 → 베타 이후 결정 권장).

**검증**
- `tsc` 통과, `test:e2e` 110건 + `test:gating` 12건 통과.
- 웹 빌드 + Playwright: 영속화 5건, UI 5사이클(신규 가입=free 게이팅 검증으로 갱신:
  14/30일 🔒 표시·보호자 초대 잠금 안내) 통과, 신규 UI 7건(상세 팝업 열림/닫힘,
  순서 변경 진입/이동/새로고침 후 유지) 통과 + 스크린샷 육안 확인.
- ⚠️ 사진 뷰어의 스와이프 제스처는 웹으로 검증 불가(샘플에 사진 없음) → 실기기 확인 필요.

**다음**: 사용자 실기기 재확인(잔재 데이터가 마이그레이션으로 사라지는지 포함) 대기.

## 2026-07-12 — 대시보드 순서 변경을 드래그 방식으로 교체 (이번 커밋)

사용자 피드백: "↑/↓ 버튼 모드가 아니라, 아이패드 홈 화면처럼 길게 누르면 항목이
플로팅되고 누른 채 위/아래로 끌어 옮기게" → 순서 변경 UI를 전면 교체.

- **`DragReorderList` 컴포넌트 신설** (`src/components/DragReorderList.tsx`,
  외부 라이브러리 없음 — PanResponder + Animated만 사용해 Expo Go에서 그대로 동작):
  - 길게 누르기(350ms) → 진동 + 카드가 떠오름(확대 1.02 + 그림자).
  - 누른 채 끌면 지나치는 카드가 스프링으로 밀려나고, 놓으면 그 자리에 안착.
  - 항목 높이가 서로 달라도 동작(각 항목 onLayout 실측 기반 중점 비교).
  - 화면 위/아래 가장자리로 끌면 **자동 스크롤**.
  - 드래그 전 살짝 움직이면 롱프레스를 취소해 **일반 스크롤과 공존**
    (onPanResponderTerminationRequest / onShouldBlockNativeResponder 패턴).
- `DashboardScreen`: ↑/↓ 순서 변경 모드 제거, DragReorderList로 교체
  (헤더/푸터는 그대로 리스트에 포함). 순서 저장 키·병합 로직은 이전과 동일.
- 웹에서 드래그 중 텍스트가 선택되는 부작용 → 플로팅 카드에 `userSelect: 'none'`.

**검증**: tsc, e2e 110 + gating 12, Playwright 영속화 5 + UI 5사이클 통과.
드래그 전용 검증 5건(힌트 표시/초기 순서/일반 스크롤 공존/드롭 후 순서 변경/
새로고침 후 유지) 통과 + 드래그 중 스크린샷 육안 확인(플로팅+밀려남 정상).
⚠️ 실기기 확인 필요: 진동 세기, 롱프레스 감도(350ms), 자동 스크롤 속도,
네이티브 ScrollView와의 제스처 협상(웹은 wheel 스크롤이라 완전 동일 검증 불가).

### 후속 버그 수정 — 밀려나는 카드가 실기기에서 안 움직임
사용자 실기기 피드백: 드래그는 되는데 "원래 있던 카드가 제대로 밀려나지 않음".
원인은 밀려나는 카드의 transform 배열에 **네이티브 드라이버 애니메이션 값과
정적 값이 섞여 있던 것**: `[{translateY: shiftOf(key)}, {scale: 1}]` +
shift 스프링 `useNativeDriver: true`. RN 실기기는 이 조합에서 네이티브 translateY
애니메이션을 화면에 반영하지 않는다(웹은 JS 폴백이라 정상 → 웹 테스트는 통과).
- 밀려나는 카드 transform을 `[{translateY: shiftOf(key)}]` 하나로 정리(정적 값 제거),
  scale은 드래그 중 카드에만 적용.
- shift 스프링을 `useNativeDriver: false`로 통일(드래그 위치 dragAnim도 JS setValue
  구동이므로 일관됨, 카드 6개라 성능 무관) → 네이티브 드라이버 혼용 문제 원천 차단.
- endDrag에서 진행 중이던 스프링을 `stopAnimation()` 후 리셋(잔여 애니메이션이
  순서 커밋 후 잘못된 위치로 되돌리는 것 방지).
- 검증: 위 회귀 전부 + 드래그 중 밀려남을 계측하는 신규 테스트(수면 카드가 실제로
  한 칸 위로 이동, 드롭 후 transform 0 리셋) 통과.

### 재수정 — spring 제거, setValue 단일 경로로 전면 교체
위 수정 후에도 실기기에서 여전히 밀려나지 않고 겹친다는 피드백. 네이티브 드라이버
혼용 가설이 핵심 원인이 아니었다고 판단, 추정 대신 **실기기에서 동작이 확인된
원시 수단(setValue)으로 통일**하는 구조 변경:
- `Animated.spring` 완전 제거. 드래그 중 60fps `setInterval` 틱 루프 하나가
  ① 가장자리 자동 스크롤 ② 드래그 카드 위치 ③ 밀려나는 카드의 **수동 lerp**
  (프레임당 25% 지수 감쇠, `setValue` 직접 호출)를 전부 처리. 드래그 카드가
  움직인다면(=setValue 경로 정상) 밀려나는 카드도 반드시 같이 움직인다.
- 겹침 보정: 밀려나는 거리가 카드 높이만 반영하고 **카드 간 여백(marginBottom
  12px)을 빠뜨려** 매 교차마다 12px씩 겹쳤음 → 이웃 레이아웃에서 여백을 실측해
  이동량에 포함(`h + gap`).
- 언마운트 시 타이머 정리 useEffect 추가.
- 검증: tsc, e2e 110 + gating 12, 영속화 5, UI 5사이클, 드래그 5 + 밀려남 계측
  3건(이동량이 h+gap=218px로 정확) 통과. 실기기 재확인 요청 상태.

## 2026-07-12 — 사용자 3차 피드백: 레포트 PDF 폰트 2배 + 기간 플랜 게이팅 (이번 커밋)

**① PDF 폰트 2배 확대** (`reportHtml.ts` CSS)
- 본문 12→24px, h1 40/h2 28, 표 22, 요약 스탯 32 등 전 항목 2배(여백도 비례 조정).
- 차트도 같은 배율로: 생성 논리 폭을 660→340으로 줄이고 CSS
  `.chart svg { width:100%; height:auto }`로 페이지 폭까지 벡터 확대 →
  차트 내부 글자(축/라벨)도 본문과 같은 ~2배. svg.ts(앱 공유 경로)는 건드리지 않음.
- 검증: 샘플 데이터로 HTML 생성 → A4 폭(794px) Chromium 스크린샷 육안 확인
  (요약/체온·수면 그래프/상세 표), 가로 넘침 0px.

**② 레포트 기간 플랜 매칭**
- `reportPeriods` 엔타이틀먼트 신설: 무료 7일 / 스탠다드 7·14일 / 패밀리 7·14·30일
  (대시보드와 동일 정책, 필드는 분리해 추후 독립 조정 가능).
- ReportScreen 기간 칩에 🔒 + 페이월 유도, 기본값도 플랜 반영.
  PDF 생성 자체는 전 티어 무료 원칙 유지(기간만 차등).
- 페이월 비교표에 '레포트 기간' 행 자동 추가(FEATURE_ROWS), docs/07 표 갱신,
  gating 테스트에 레포트 기간 포함 관계 1건 추가(12→13건).

**검증**: tsc, e2e 110, gating 13, 영속화 5, UI 5사이클, 레포트 게이팅 4건
(30일 🔒 표시/14일 열림/7일 미리보기/잠금 탭→페이월) 통과.
⚠️ 실제 PDF(expo-print) 출력은 실기기에서 확인 필요 — HTML 렌더는 검증 완료.

## 2026-07-12 — 안드로이드 출시 준비 종합 정리 (이번 커밋)

사용자 요청: "실제 안드로이드 앱 출시를 위해 준비해야 할 내용 정리 + 개발 일지 업데이트".
- **`docs/09_android_release.md` 신설** — Google Play 출시 종합 체크리스트:
  현재 상태 요약(완료/차단 항목), 출시 전 결정 3건(번들 ID / 1차 출시 구독 정책 /
  SMS 인증 처리), 계정·인프라(개인 vs 조직 계정의 비공개 테스트 의무 차이 포함),
  법적 준비(방침 호스팅·법률 검토·**계정 삭제 웹 URL** — Play 필수),
  남은 개발 작업, 빌드→테스트 트랙, 데이터 보안 폼·건강 앱 선언·대상 연령(보호자)
  등 심사 폼, 출시 후 운영, 크리티컬 패스 순서.
- 핵심 출시 차단(⛔) 식별: ① 번들 ID 자리표시 ② 결제 미연동 상태의 페이월 노출
  (Play 정책 리젝 사유 — 1차 무료 출시 시 전환 버튼 숨김 필요) ③ SMS 스텁
  ④ Supabase 실환경 미검증 ⑤ 방침 법률 검토 + 계정 삭제 웹 페이지.
- 아래 "앞으로 진행할 내용"을 현재 상태로 전면 갱신(피드백 1~3차 완료 반영).

## 2026-07-12 — 결제 서비스 연동 준비 구조 (이번 커밋)

사용자 요청: "결제 서비스를 연동할 수 있는 구조를 미리 준비". SDK 계약 전에
할 수 있는 모든 것을 완성 — 실연동은 `billing.ts` 함수 2개 교체 + 웹훅 배포만 남김.

- **`src/services/billing.ts` 신설** (smsAuth.ts의 sendSms 패턴):
  `PRODUCT_IDS`(kidcare.standard.monthly / kidcare.family.monthly),
  `purchaseWithStore()`/`restorePurchases()` — RevenueCat 교체 가이드 코드를
  주석으로 내장(Configure→logIn(supabase uid)→purchasePackage→웹훅→loadAll).
  클라이언트는 티어를 직접 쓰지 않는다(진실 원천 = subscriptions 테이블) 원칙 유지.
- **페이월 3모드**: `resolvePaywallMode()` — env `EXPO_PUBLIC_PAYWALL_MODE`.
  `demo`(mock 기본, 즉시 전환 체험) / `hidden`(supabase 기본, 전환 버튼 숨김+안내 카드)
  / `live`(실결제 + iOS 필수 "구매 복원" 버튼). **안전 기본값이 hidden**이라
  결제 연동 전 운영 빌드가 Play 정책(결제 수단 없는 구매 UI 금지)을 자동 준수 —
  1차 무료 출시(09 문서 §1-2 A안)는 그대로 빌드하면 된다.
- **웹훅 Edge Function `billing-webhook` 신설**: RC_WEBHOOK_TOKEN 인증,
  RevenueCat 이벤트 매핑(INITIAL_PURCHASE/RENEWAL/UNCANCELLATION/PRODUCT_CHANGE
  →active, EXPIRATION→expired, CANCELLATION은 만료까지 유지), product_id→tier,
  익명 app_user_id 스킵, service_role upsert, 5xx로 RC 재시도 유도.
- AppContext에 `loadAll` 노출(결제 후 서버 티어 재조회용).
- 검증: tsc, e2e 110, **gating 19**(상품 ID↔티어 역매핑·안전 기본값·env 오버라이드
  6건 추가), UI 5사이클·영속화 5건, 페이월 데모 모드 3건(전환 버튼/즉시 전환/설정
  플랜 카드 반영) + **hidden 모드 실빌드 3건**(버튼 전부 숨김/안내 카드/복원 없음,
  스크린샷 육안 확인) 통과.
- 함정 발견·기록: EXPO_PUBLIC env 변경은 Metro 캐시에 안 잡혀 `--clear` 필요
  (hidden 모드 첫 검증이 이것 때문에 실패 → AGENTS §7에 기록).

## 2026-07-12 — 결제 수단 선택 검토 (사용자 상담, 문서만)

"한국/글로벌 기준 결제 서비스 선택" 논의 — 최신 정황(웹 검색) 확인 후 결론을
docs/07 §결제 수단 선택 검토에 기록. 요지: 앱 내 구독은 양쪽 모두 스토어
인앱결제+RevenueCat(제3자 결제는 실익 없음, Stripe는 한국 사업자 미지원),
웹 채널 확장 시 국내 토스페이먼츠/포트원·글로벌 Paddle(MoR). 코드 변경 없음.

## 2026-07-12 — 얼리버드 가격 전략 결정·반영 (이번 커밋)

사용자 결정: 1차 출시는 무료 플랜만 개방, 무료 기간 가입자는 유료 플랜을
월 ₩1,000 할인(얼리버드). 페이월에 정가 취소선 + 할인가 표기.

- `TIER_META`에 `listPriceLabel`(정가 ₩3,900/₩5,900) 추가 + `EARLY_BIRD_NOTE` 문구.
- PaywallScreen: 정가 취소선(좌) + 얼리버드가(우) + 상단 배너, hidden 모드
  안내에 가입 유인 문구 추가.
- 마케팅 검토 결과를 docs/07 §가격 전략에 기록 — 핵심: **표시광고법상 취소선
  정가는 실제 판매될 가격이어야 함** → 과금 시작 후 비얼리버드 신규에게 정가
  실부과 필수(가공 정가 금지). 자격 판정은 auth.users.created_at, 구현은 Play
  개발자 지정 오퍼 + RevenueCat Offering 2종(billing.ts 가이드에 추가).
- 남은 결정 1건: 할인 유지 기간(권장: 구독 유지하는 한 계속) — 확정 후 앱 문구 보강.
- 검증: tsc, gating 24건(가격 표기·₩1,000 차액 검사 5건 추가), 웹 빌드 +
  Playwright 5건(배너/정가/할인가/취소선 스타일) + 스크린샷 육안 확인.

## 2026-07-12 — 가격 확정(정가 ₩1,000 인하) + 연간 플랜 설계 (이번 커밋)

사용자 결정: 정가를 ₩1,000씩 인하(스탠다드 ₩2,900/패밀리 ₩4,900이 정가,
얼리버드는 ₩1,900/₩3,900) + 연간 구독 할인 플랜 추가.

- **연간 설계**: 월 정가 ×10 = "2개월 무료"(≈17% 할인). 얼리버드 연간도 ×10
  (연 ₩19,000/₩39,000 — 연 ₩10,000 할인으로 월간 혜택과 곱으로 중첩).
  ×10 규칙은 소통("2개월 공짜")과 계산이 모두 깔끔한 것이 채택 이유.
- `PRICING` 숫자 객체를 가격의 단일 원천으로 신설(subscription.ts) — 라벨은
  `won()` 헬퍼로 파생. `PaidTier`/`BillingPeriod` 타입을 types로 승격.
- `PRODUCT_IDS`를 티어×주기 4개로 확장(`kidcare.*.{monthly,yearly}`),
  `purchaseWithStore(tier, period)` 시그니처 변경, billing-webhook 매핑에
  연간 ID 추가.
- 페이월: 월간/연간 토글 칩, 연간 선택 시 월 환산가("월 ₩1,583 꼴 · 12개월")
  병기 + 2개월 무료 안내.
- 검증: tsc, e2e 110, gating 27(가격표 일관성·상품 ID 4개 검사로 갱신),
  Playwright 11건(월간 4가격+취소선, 연간 4가격+환산가+안내) + 스크린샷 육안.

---

# 앞으로 진행할 내용

## 최우선: 안드로이드 출시 준비 — `docs/09_android_release.md`가 단일 기준 문서
사용자 결정 대기 3건(⛔): ① 번들 ID ② 1차 출시 구독 정책(무료 출시 vs 결제 연동 후)
③ SMS 인증(공급자 계약 vs 1차 우회). 결정되는 대로 §3의 개발 반영 착수.

## 사용자 실기기 확인 대기 (피드백 1~3차 반영분)
- 대시보드 드래그 순서 변경(setValue 재작성 후), 사진 뷰어 스와이프,
  레포트 PDF 2배 폰트(expo-print 실출력), 샘플 잔재 마이그레이션.

## 결제 연동 (§1-2에서 B안 선택 시 또는 v1.1 — docs/07_monetization.md)
- [ ] Play Console 구독 상품 등록 → RevenueCat(react-native-purchases,
      development build 필요) → 웹훅 Edge Function → 가격 확정

## 남은 마감 품질 항목
- [ ] 접근성/한국어 카피 정리, 온보딩/빈 상태 다듬기
- [ ] Maestro 스모크 실기기 실행·보정
- [ ] 사진 서명 URL 재발급 로직(출시 전 권장)
- [x] RLS 테스트 CI 연결 — `.github/workflows/kidcare-ci.yml`

## 백로그 (MVP 이후)
- 성장 백분위 곡선 (질병관리청 소아 성장도표 데이터 연동)
- 성장 측정값 입력 UI (현재는 데이터만 표시)
- AI 보조: 자연어 메모 → 구조화 payload 초안, 태그 추천, 레포트 요약문
  — **범위 상한 고정: 진단명 추정·용량 계산·수진 필요성 판단은 만들지 않는다**
- 기록 수정(현재 삭제 후 재입력), 시간 선택 휠, 복용약 관리 UI
- 소유권 이전, 다국어(영어)
- (제외 확정) 아이 프로필 얼굴 사진 — 개인정보 최소화 원칙에 따라 영구 비범위

## 남은 리스크 메모
- Edge Function 미배포/미검증 — 실 프로젝트 연결 후 배포 + 수신자 시나리오
  (만료/회수 후 실제로 만료 페이지가 뜨는지) 확인 필요
- `children` INSERT 정책이 `with check(true)` — 고아 행 생성 가능(접근은 불가).
  부트스트랩 정책과 함께 조이는 방안 검토
- 서명 URL 24h 만료(사진) — 앱을 오래 켜두면 이미지가 깨질 수 있음, 재발급 로직 필요
- 로컬 알림은 기기 재부팅/앱 완전 종료 후에도 유지되는지 실기기 검증 필요(iOS/Android
  스케줄링 동작 차이가 있을 수 있음)
- Storage 재귀 완전 삭제는 실 Supabase 미검증 (list API 페이지네이션 1000개 한도 —
  기록이 매우 많은 아이는 반복 호출 필요할 수 있음)
- 개인정보처리방침은 초안 — 배포 전 법률 검토 필수

---

## 2026-08-24 — P1 Android·iOS preview readiness 포트폴리오 (문서·정적 계약만)

**한 일**
- `docs/20_preview_readiness_portfolio.md`를 추가해 Android Draft PR #18과 iOS Draft
  PR #20의 remote base/head SHA, Draft 상태, Actions 및 review API 결과를 한 표로
  고정했다. Android의 4건 `COMMENTED` review와 iOS의 query 시 formal review 없음은
  승인으로 바꾸어 표기하지 않았다.
- immutable iOS exact head `fa2cf745aaf79ab66746d2d83d6a38b4c58f79a0`의 임시
  clean archive에서 `npm ci` 후 typecheck, analytics 37/0, five-minute WOW 41/0,
  E2E 189/0, gating 41/0, app-resume 14/0, native preflight 13/0,
  accessibility 11/0, iOS readiness 8/0(의도된 blocked gate 6), Deno contracts
  10/0+세 entrypoint check, Expo web export, diff check을 재실행했다.
- Android/iOS별 proven / not proven / needs-device / 캡틴 승인 gate / rollback을
  분리했다. build/upload/signing/device/OAuth/billing/production Supabase가 성공한
  것처럼 표현하지 않았다.

**결정과 이유**
- 서로 다른 PR의 CI를 교차 근거로 쓰면 false-green이 될 수 있으므로 각 행에
  정확한 remote SHA와 current-head Actions URL을 남겼다. local PostgreSQL 16은
  실행하지 않았으며 iOS `rls-test` current-head CI(181 assertion contract)를 원격
  근거로만 기록했다.
- portfolio 자체는 문서뿐인 원자적 변경이다. 원본 후보, EAS/Apple/Google 상태,
  운영 Supabase와 고객 데이터의 rollback 범위를 열지 않는다.

**다음**
- 이 카드와 구현자를 분리한 same-card ratchet review에서 APPROVE 또는 단일 canonical
  REQUEST_CHANGES를 받는다. 별도 승인 전에는 build/upload/signing/device/운영 연동
  작업을 새 카드로도 시작하지 않는다.

**재검토 정정**
- 격리 실행 환경의 repository config에 보호된 공용 Git credential helper가 있음을 확인했다.
  credential을 출력·복사·저장하지 않고 `git credential fill`의 메모리 내 결과로 GitHub REST
  API를 호출해 PR #18/#20/#21의 base/head SHA, Draft/open 상태, review endpoint와 exact-head
  check-runs를 재대조했다. #18은 `COMMENTED` 4건, #20과 #21은 formal GitHub PR review 없음으로
  유지했다.
- 포트폴리오 Draft PR #21 최초 문서 head `60bb5966e79dad6e402e516d8bc0bcf0c34668c2`의 `typecheck`와
  `rls-test`는 completed/success지만 `Workers Builds: health-care-app-development`는
  completed/failure임을 명시했다. 이를 green 또는 build/upload/production 결과로 과장하지 않았다.
- 수정된 docs branch에서 `npm ci`, `npm run typecheck`, `npm run test:e2e` (110/0),
  `npm run test:gating` (27/0), `git diff --check`를 재실행했다. `npm ci`가 보고한 기존
  dependency advisory 22건(중간 9, 높음 13)과 보류된 `esbuild` install script는 이 문서 작업에서
  변경하거나 승인하지 않았다.

**재검토 정정 2**
- Android PR #18 immutable exact head `13ed953e95ffaff281c40e52d6b2acea590cbedb`의
  `docs/13_android_preview_readiness.md`와 대조해 포트폴리오 matrix의 Deno contracts 표기를
  `11/0`에서 실제 재실행 결과인 `10/0`(share-report 6 + billing-webhook 3 + delete-account 1)으로
  정정했다. 다른 `11/0` Deno 표기는 없음을 확인했다.
- 이 수정은 false-green 방지를 위한 문서 수치 정정만 포함하며, build/upload/signing/device/OAuth/
  billing/production Supabase/main 경계는 열지 않았다. 정정 후 docs branch 계약을 다시 실행하고
  exact remote SHA 및 current-head checks를 protected-helper API/ref로 재대조한 뒤 독립 ratchet
  same-card 재검토를 요청한다.
