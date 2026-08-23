# P1 iOS internal preview 재현성·스토어 진입 전 증거

> 기준일: 2026-08-24 KST. 이 문서는 iOS preview 후보를 실제로 빌드, 서명, 업로드, 배포하거나 외부 기기와 연결한 기록이 아닙니다. credential·비용·외부 연결 없이 수행한 clean checkout 재현과 정적 설정 검사를 보관하며, `needs-device` 항목을 성공으로 승격하지 않습니다.

## 1. 승인 기준점과 추적성

| 항목 | 값 | 대조 방법 |
| --- | --- | --- |
| upstream Draft PR | [#19](https://github.com/pioneerddoji/Health-Care-App-Development/pull/19), open/draft | public GitHub REST API |
| PR #19 base | `docs/p1-internal-beta-native-gap-matrix` @ `13ed953e95ffaff281c40e52d6b2acea590cbedb` | REST API |
| 승인된 implementation exact head | `fix/p1-native-accessibility-state-contract` @ `ee9a88fde5c190e38dbceb8ef23b74b8fa1e1ba0` | REST API + `git ls-remote` |
| evidence branch | `test/p1-ios-preview-readiness` | clean worktree에서 위 SHA로 fast-forward only |

격리된 작업 profile의 보호된 GitHub credential helper로 refs를 조회했으며 credential/token은 출력·복사·문서화하지 않았습니다. public API로 PR base/head 및 `ee9a88f` check-run을 대조했습니다. PR의 GitHub review API 응답은 author identity 때문에 formal `COMMENTED`만 보이며, 선행 same-card ratchet review의 독립 승인 verdict는 board handoff로 분리 보관합니다. 이는 GitHub formal approval로 바꾸어 주장하지 않습니다.

exact head `ee9a88f`의 current Actions check는 `Workers Builds`, `edge-contracts`, `typecheck`, `native-runtime-preflight`, `e2e-tests`, `gating-tests`, `rls-test`, `analytics-contracts`가 모두 `completed/success`였습니다. fresh PostgreSQL 16 completion marker는 선행 승인 handoff의 `RLS_SUITE_COMPLETE expected=181`, `RLS_ASSERTIONS FAIL=0 COMPLETION=1`을 인용한 원격 CI 근거입니다. 이 runner에서 local PG16을 실행한 결과로 바꾸어 주장하지 않습니다.

## 2. clean checkout 재현 결과

upstream exact head는 fast-forward 직후 clean 상태였고, 이 evidence branch에서 lockfile 기반 `npm ci` 후 아래 명령을 재실행했습니다. 문서·정적 preflight 추가는 앱 runtime source나 lockfile을 바꾸지 않습니다.

| 명령 | 결과 |
| --- | --- |
| `npm ci` | 성공; 기존 advisory **24건**(moderate 11, high 13), pending `esbuild` install script 1건을 보고했으며 자동 수정·승인은 하지 않음 |
| `npm run typecheck` | 통과 |
| `npm run test:analytics` | **PASS 37 / FAIL 0** |
| `npm run test:five-minute-wow` | **PASS 41 / FAIL 0** |
| `npm run test:e2e` | **PASS 189 / FAIL 0** |
| `npm run test:gating` | **PASS 41 / FAIL 0** |
| `npm run test:app-resume-lifecycle` | **PASS 14 / FAIL 0** |
| `npm run test:native-preflight` | **PASS 13 / FAIL 0** |
| `npm run test:accessibility` | **PASS 11 / FAIL 0** |
| `npm run test:ios-preview-readiness` | **PASS 8 / FAIL 0**, expected blocked gates **6** |
| Deno contracts/check | share-report/billing-webhook/delete-account contracts **PASS 11 / FAIL 0**; 세 entrypoint `deno check` 통과 |
| `npx expo export --platform web --output-dir dist-web` | 통과; web bundle **833 modules** |
| `git diff --check` | 통과 |

Node/웹 검증은 native iOS runtime, Apple signing, TestFlight upload, App Store Connect acceptance, VoiceOver 발화나 OS picker focus trap을 증명하지 않습니다.

## 3. credentialless iOS preview 정적 preflight

`scripts/ios-preview-readiness.mts`는 source와 committed `app.json`/`eas.json`만 읽습니다. network, Expo/EAS CLI, keychain, Apple 계정, device, env secret을 사용하지 않습니다.

- `app.json`은 유효한 `carenote` scheme, iOS `supportsTablet: false`, build number, 사진 접근 설명과 non-exempt encryption declaration을 가집니다.
- `eas.json`의 `preview`는 `distribution: internal`, `channel: preview`, `APP_ENV: preview`만 선언합니다. iOS signing/build를 실행하지 않습니다.
- committed Expo extra의 Supabase 값은 빈 문자열입니다. 실제 Supabase 값이나 Apple/RevenueCat credential은 검사·기록하지 않습니다.
- Supabase mode의 paywall은 `hidden`이 기본이고, OAuth 버튼도 환경 플래그 없이는 off입니다. 따라서 실제 OAuth/결제 설정 전 구매 또는 provider connection을 정상으로 가정하지 않습니다.
- `app.carenote.mvp` bundle identifier와 `TODO_APP_STORE_CONNECT_APP_ID`는 expected blocked gate로 검사합니다. 이 값들을 바꾸거나 `eas init`, `eas login`, `eas build`, `eas submit`을 실행하지 않습니다.

EAS local/non-interactive build도 실행하지 않습니다. 해당 경로는 Expo/Apple authentication, signing credential 또는 build backend 연결을 요구할 수 있으며, 이 카드의 credential·외부 연결 금지 경계를 넘습니다. 정적 preflight가 통과했다는 사실은 “빌드가 가능하다”가 아니라 “명시한 blocker가 계속 열리지 않았다”는 뜻입니다.

## 4. 캡틴 승인 게이트와 rollback

다음 항목은 모두 별도 명시 승인·후속 카드가 필요합니다.

1. `app.carenote.mvp`를 실제 iOS bundle identifier로 확정하고, Apple Developer team·signing·provisioning 및 App Store Connect app을 계정 소유자가 승인.
2. iOS preview/TestFlight 또는 any EAS build/upload, `eas init/login`, credential/secret 생성·복사, 외부 device/emulator 연결.
3. 운영 Supabase project/region, migration, Edge Function deployment, 실제 `verify:supabase`; OAuth provider/redirect allow-list 및 Apple Sign In requirement.
4. RevenueCat/App Store 상품·iOS public SDK key·webhook 및 실결제. 현 상태는 hidden/off이며 live 전환 금지.
5. 법률 검토된 privacy policy/terms, 외부 account-deletion URL, App Privacy/Health & Fitness·Contact Info·Identifiers disclosure, store metadata/아이콘/스크린샷/심사 노트.
6. VoiceOver 실제 발화·탐색, OS picker focus trap, native focus delivery, permission/PDF/share/notification/deep-link lifecycle은 `needs-device`로 유지.

이 작업의 rollback은 `scripts/ios-preview-readiness.mts`, 이 문서와 DEVLOG entry를 포함한 단일 문서·preflight commit을 revert하는 것입니다. upstream PR #19 implementation, signing, store/Apple/Supabase state, production data를 바꾸지 않습니다.

## 5. 금지된 작업 미수행 확인

실기기/에뮬레이터 연결, EAS/store build·upload, signing/Apple login, bundle ID 확정, OAuth·billing·운영 Supabase 연결 또는 migration/data access, DNS/secrets/cost 증가, 고객 메시지/광고/가격/브랜딩 결정, production deployment 및 `main` 병합을 수행하지 않았습니다.
