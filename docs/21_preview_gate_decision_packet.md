# P1 Android·iOS preview 승인 게이트 결정 패킷과 오프라인 실기기 QA

> 기준: 2026-08-24 KST · 판정 대상은 **preview 후보**이며 production/store 승인 문서가 아니다.
> 이 패킷은 캡틴이 다음 단계의 작업 카드를 승인 또는 보류할 때 쓰는 단일 체크포인트다.
> 어떤 체크도 EAS build/upload, Apple·Google 로그인, 서명, 외부 기기/에뮬레이터 연결,
> 운영 Supabase·OAuth·결제 연결, package/bundle ID 확정, main 병합을 허가하지 않는다.

## 1. 현재 기준점과 증거의 출처

### 1-1. 원격 대조 기준

아래 값은 선행 승인 카드 `t_e7800705`의 2026-08-24 KST protected shared Git
credential helper 대조 handoff를 기준으로 한다. helper는 `git credential fill` 결과를
프로세스 메모리에서만 GitHub REST API 요청에 사용하며 credential/token을 출력·복사·저장하지
않는다. 이 패킷은 그 원격 API/ref 대조를 재현했다고 주장하지 않고 source evidence로 링크한다.

| 후보 | Draft PR | exact remote base | exact remote head | review verdict | current-head CI |
|---|---|---|---|---|---|
| Android | [#18](https://github.com/pioneerddoji/Health-Care-App-Development/pull/18) | `53de38f355514e581548993cff232be9d312316d` | `13ed953e95ffaff281c40e52d6b2acea590cbedb` | GitHub formal approval 아님: `COMMENTED` 4건 | [8/8 success](https://github.com/pioneerddoji/Health-Care-App-Development/actions/runs/32670021170) |
| iOS | [#20](https://github.com/pioneerddoji/Health-Care-App-Development/pull/20) | `ee9a88fde5c190e38dbceb8ef23b74b8fa1e1ba0` | `fa2cf745aaf79ab66746d2d83d6a38b4c58f79a0` | GitHub formal review 없음; Kanban ratchet handoff와 분리 | [8/8 success](https://github.com/pioneerddoji/Health-Care-App-Development/actions/runs/32673930804) |
| 포트폴리오 | [#21](https://github.com/pioneerddoji/Health-Care-App-Development/pull/21) | `bd23179fd09af1c53522b3b4bf1fb6e08fbfac19` | `dc61278b54935ee9f62e6a2d8adc21520001e77f` | `t_e7800705` contract-lens APPROVE | typecheck·rls-test success, Workers Builds failure — **non-green** |

- exact ref source: [`docs/20_preview_readiness_portfolio.md` at `dc61278`](https://github.com/pioneerddoji/Health-Care-App-Development/blob/dc61278b54935ee9f62e6a2d8adc21520001e77f/docs/20_preview_readiness_portfolio.md).
- platform source: [Android #18 exact head](https://github.com/pioneerddoji/Health-Care-App-Development/blob/13ed953e95ffaff281c40e52d6b2acea590cbedb/docs/13_android_preview_readiness.md), [iOS #20 exact head](https://github.com/pioneerddoji/Health-Care-App-Development/blob/fa2cf745aaf79ab66746d2d83d6a38b4c58f79a0/docs/19_ios_preview_readiness.md).
- #21 Workers Builds failure는 preview build/upload 또는 production 실패의 증거가 아니다. #21을 green이라고 부르거나 다른 PR의 CI로 대체하면 안 된다.

### 1-2. 재현 증거와 미재현 항목의 분리

| 범주 | Android #18 exact-head source | iOS #20 exact-head source | 이 패킷의 판정 |
|---|---|---|---|
| clean install·typecheck | `npm ci`, typecheck pass | `npm ci`, typecheck pass | proven source evidence |
| analytics·five-minute WOW | source/CI evidence | analytics 37/0, WOW 41/0 | source evidence; 현재 문서 branch에서 재실행하지 않음 |
| E2E·gating·app-resume | E2E 174/0, gating 41/0, app-resume contracts | E2E 189/0, gating 41/0, app-resume 14/0 | source evidence |
| native-preflight·accessibility·iOS readiness | Android native preflight source | native preflight 13/0, accessibility 11/0, iOS readiness 8/0 + expected blockers 6 | 정적 계약만 proven |
| Deno contracts/check | 10/0 (share 6, billing 3, delete-account 1) | 10/0 및 세 entrypoint check | source evidence |
| Expo web export·diff check | source pass | export pass, diff check pass | source evidence |
| fresh PostgreSQL 16 | current-head CI marker/assertion만 | current-head CI: expected assertions 181, completion marker | 로컬 PG16 재실행 아님 |
| native build/runtime·store | 미수행 | 미수행 | **not proven / needs-device** |

이 문서의 branch는 포트폴리오 exact head가 아니라 docs-only base에서 분기했다. 따라서 위
advanced commands의 결과를 이 branch의 current-head 결과로 재표기하지 않는다. 이 문서 자체의
검증은 §7에 별도 기록한다.

## 2. 캡틴용 결론 카드

**현재 권고: production/store 보류, preview 준비 작업만 조건부 승인 가능.**

승인 시에도 허용되는 것은 아래 승인 단위별로 분리된 *새 후속 카드의 작성/검토*뿐이다. 실제
계정 로그인·credential·build/upload·외부 기기 연결은 해당 카드가 다시 명시 승인되기 전까지
금지한다.

| 승인 단위 | 현재 상태 | 승인에 필요한 최소 증거 | 즉시 중단/보류 조건 | rollback |
|---|---|---|---|---|
| Android preview 준비 | 정적 config와 contracts만 proven | #18 exact head와 current CI를 재대조, Android QA 담당자·대상 기기·build owner 지정 | #18 head/CI 변경, package placeholder 미해결, 담당 계정 소유자 부재 | docs/후속 카드만 revert·close; APK 없음 |
| iOS preview 준비 | 정적 config와 contracts만 proven | #20 exact head와 current CI 재대조, Apple account owner·TestFlight 책임자·대상 기기 지정 | #20 head/CI 변경, bundle placeholder/Store Connect blocker, Apple owner 부재 | docs/후속 카드만 revert·close; IPA/TestFlight 없음 |
| package/bundle ID | Android/iOS 모두 자리표시이며 미결정 | 소유 도메인, Android package와 iOS bundle ID, 계정 소유자 서면 결정 | 첫 upload 전 최종값·소유권이 불명확함 | 결정 문서 revert 가능; upload 뒤에는 ID 변경 불가 |
| signing·계정 소유 | not proven | Google Play/Apple Developer/Expo 책임자와 recovery·2FA·비용 소유 확인 | 공유 계정, 개인 token 공유, 비용 승인 없음 | credential을 만들거나 복사하지 않았으므로 되돌릴 외부 상태 없음 |
| 비용 | not approved | 예상 EAS/Apple/Google/테스트 비용과 지불 주체의 명시 승인 | 비용 상한·지불 주체 미정 | 구매/빌드/submit을 시작하지 않음 |
| privacy·store metadata | 초안·미검증 | 법률 검토, 외부 삭제 URL, Data safety/App Privacy/Health declaration, 보호자 대상 카피 | 건강정보 수집/삭제/대상연령 설명 불일치 | 문서 초안만 revert; 스토어 제출 없음 |
| OAuth·billing | hidden/off 정적 상태 | provider redirect allow-list, Apple requirement, RevenueCat/store product, webhook·법무 승인 | live key/상품/환불·가격 결정 미비 | off/hidden 유지; 실 provider/결제 변경 없음 |
| 운영 Supabase | not proven | Seoul region 등 운영 결정, migration/Edge Function 계획, isolated verification owner | 실 data/secret 또는 migration 승인 없음 | 운영 연결/데이터 변경 없음 |

**캡틴 결재 문구 템플릿**

- `APPROVE — Android preview preparation card only; no build/upload/device/account action.`
- `APPROVE — iOS preview preparation card only; no build/upload/device/account action.`
- `HOLD — <미결정 승인 단위>; package/bundle ID, account owner, privacy, production Supabase, OAuth/billing 중 하나라도 해결 전 다음 단계 금지.`
- `ABORT — SHA/CI 또는 보안·개인정보 경계가 바뀜. 후보 PR을 Draft로 보존하고 새 exact-head 증거가 생길 때까지 재개하지 않음.`

## 3. 오프라인 실기기 QA 실행 전제

이 절은 **실제 기기 연결이나 build를 실행하는 절차가 아니라**, 별도 승인 후 QA 담당자가
오프라인으로 수행할 시험 명세다.

### 3-1. 실행 허가 전 체크

- [ ] 캡틴이 플랫폼별 preview build/upload 및 기기 연결을 별도 승인했다.
- [ ] 시험 build의 exact SHA, build ID, platform/version, tester, KST 시각을 QA 기록에 적었다.
- [ ] Google/Apple/Expo 계정, signing, 기기 잠금화면 알림 노출 위험을 담당 소유자가 확인했다.
- [ ] 운영 Supabase/OAuth/billing이 **연결되지 않았음** 또는 별도 승인된 isolated test backend임을 확인했다.
- [ ] demo/test 계정만 사용하고 실제 아동 이름·생년월일·사진·전화번호·의료 기록은 입력하지 않는다.
- [ ] test child는 `테스트 아이`, 날짜는 비식별 상대 날짜, 메모는 `QA-삭제예정`만 사용한다. 사진은 얼굴·문서·연락처가 없는 단색 테스트 이미지로 제한한다.
- [ ] 화면 녹화/스크린샷은 알림 내용, 이메일, token, URL query, QR, 계정 식별자, 사진 metadata를 가린 뒤 증거 저장소에 올린다.

### 3-2. 공통 증거 규칙

각 케이스마다 QA 표에 `case ID / platform·OS / exact SHA·build / 실행자 / KST / 결과 /
evidence path / defect ID`를 남긴다. PASS는 expected result가 모두 충족되고 민감정보/secret
비노출까지 확인했을 때만 쓴다. 화면 캡처는 최소 범위로 하고, raw log·share URL·auth redirect
URL·credential을 ticket/채팅에 붙이지 않는다.

| case | 사전조건·테스트 데이터 | 절차 | expected result | fail / abort 기준 | 증거 |
|---|---|---|---|---|---|
| A11Y-01 TalkBack/VoiceOver | 플랫폼 screen reader 활성화, demo/test 계정 | 로그인→동의→아이 목록→기록 폼→Date/Time picker→오류 상태를 순서대로 탐색 | 제어 이름·역할·상태가 읽히고, 모달 열림/닫힘 뒤 논리적 focus가 원래 trigger 또는 오류로 복귀 | unlabeled control, focus 소실/무한 순환, 삭제·동의 철회 같은 파괴 동작을 screen reader로 오인 실행 | 민감정보 없는 화면 녹화 + 탐색 순서 메모 |
| A11Y-02 picker focus trap | `테스트 아이`, 임의 과거 날짜 | picker 열기→선택 없이 cancel/back→재열기→값 선택→닫기 | 열림 중 modal 내부에 focus가 있고 back/cancel 후 trigger로, validation error면 오류 안내로 회귀; 중복 열림 없음 | focus가 배경으로 새거나 UI가 조작 불능, 취소가 값 변경 | 전/후 캡처·OS/기기 정보 |
| PERM-01 권한 | 카메라/사진/알림 권한을 각각 not granted로 재설정 가능 | 사진 첨부와 알림 예약을 각각 시도, deny 후 재시도 | 필요한 시점에만 권한 요청; deny 시 기능이 안전하게 안내되고 앱이 중단되지 않음 | 권한 없이 사진/알림 성공 주장, 반복 팝업 loop, 기존 기록 손실 | 시스템 prompt는 개인정보 없이 부분 캡처, 앱 상태 캡처 |
| PDF-01 PDF/share | 비식별 기록 1건 이상, test-only recipient 없음 | PDF 생성→문자 크기/고지 확인→공유 시트 열기→취소 | PDF에 보호자 관찰 기록·의학적 소견 아님 고지가 보이고 공유 취소 뒤 앱 데이터가 유지 | 실제 수신자·공개 링크로 전송, PDF/공유 오류가 앱 크래시·기록 삭제 유발 | 로컬 PDF 첫 페이지의 비식별 캡처; recipient/URL 제외 |
| NTF-01 notification/deep-link | test reminder, 테스트 기기만 | 가까운 미래 시각 알림 생성→수신→탭→앱 복귀 | 알림이 해당 테스트 일정으로 열리고 stale/중복 navigation 없이 정상 화면; 알림 내용에 민감 상세가 과도하게 노출되지 않음 | 실제 사용자 알림 예약, deep-link가 다른 아이/계정으로 열림, 크래시 | 잠금화면 민감 내용 가린 캡처 + destination 화면 |
| LIFE-01 app resume | 화면 진입 뒤 background/foreground 전환 가능 | 기록/접종/설정 화면에서 background→resume; 권한 화면 복귀도 시험 | stale 작업이 최신 상태를 덮어쓰지 않고, 화면/데이터/focus가 일관되며 재시도는 명시적 동작만 수행 | 새로고침으로 입력 손실, 다른 계정 데이터 노출, foreground race로 crash | 전후 화면, 재현 단계, device log의 비밀 제거 요약 |

### 3-3. 실패 분류와 중단선

- **즉시 abort:** health data/계정 정보/secret 노출, 다른 사용자 데이터 접근, 파괴 동작의
  오발동, OAuth·결제·운영 Supabase로 의도치 않게 연결, signing/account credential 노출.
  Build/기기 테스트를 멈추고 artifact 접근을 제한한 뒤 security/privacy 담당자에게 별도 보고한다.
- **release-blocking FAIL:** screen reader 탐색 불가, picker trap/focus 복귀 실패, permission
  loop/crash, PDF/share/notification/deep-link/resume가 데이터 손실 또는 crash를 유발.
  candidate는 Draft로 유지하고 defect와 exact build를 기록한다.
- **non-blocking observation:** 카피·간격처럼 기능/보안/접근성을 해치지 않는 항목. 단,
  production/store 결재 근거로 격상하지 않고 별도 backlog 카드로 분리한다.

## 4. 허용되지 않는 증거의 해석

다음은 모두 preview 또는 production 성공 근거가 아니다: web export, Node/contract test,
credentialless static preflight, #21의 Docs CI, 다른 SHA의 green CI, screenshots만 있는 수동 테스트,
미승인 개인 기기의 구두 보고. native build, signing, upload, store acceptance, OAuth redirect,
실결제, production RLS/data migration은 해당 exact artifact·계정 소유 승인·새 카드의 독립 증거가
있을 때만 proven으로 승격할 수 있다.

## 5. 다음 단계 순서

1. 이 문서 PR의 independent same-card ratchet review를 받고 APPROVE 또는 canonical
   REQUEST_CHANGES 하나를 확정한다.
2. 캡틴이 §2의 플랫폼별 preparation-only 결재 또는 HOLD를 남긴다.
3. APPROVE가 있어도 identity/signing, preview build/upload, offline device QA, production
   Supabase, OAuth/billing, privacy/store metadata를 각각 별도 카드로 만들고 해당 카드마다
   stop/rollback 기준을 다시 확인한다.
4. 모든 플랫폼 artifact와 offline QA가 proven이 된 뒤에도 production/store gate는 별도 결재다.

## 6. 이 문서 작업의 rollback과 범위 확인

이 카드가 만든 것은 `docs/21_preview_gate_decision_packet.md`와 DEVLOG 항목뿐이다.
Rollback은 이 docs-only commit을 revert하는 것이며 Android/iOS implementation, candidate Draft PR,
EAS/Apple/Google, signing, store, device, OAuth/billing, production Supabase, customer data와 main은
바꾸지 않는다.

## 7. 문서 branch 자체 검증 기록

이 branch에서는 현재 체크아웃의 lockfile로 `npm ci`, `npm run typecheck`, `npm run test:e2e`,
`npm run test:gating`, `git diff --check`를 실행한다. 이는 `kidcare` base의 문서 무결성/기존
회귀 확인일 뿐 §1의 Android/iOS exact-head advanced evidence를 대체하지 않는다. 실행 결과와
문서 branch exact SHA/current-head CI는 Draft PR 생성 뒤 DEVLOG에 추가한다.
