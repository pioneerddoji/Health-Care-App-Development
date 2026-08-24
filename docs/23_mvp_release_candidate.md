# MVP release candidate — stacked PR 정리와 검증 기록

> 기준 시각: 2026-08-24 KST. 이 문서는 `carenote-launch/t_5df1b201-mvp-stacked-pr-release-candidate` canonical integration branch의 출시 후보 판단 기록입니다. `main` 병합, 공개 배포, 운영 Supabase/Edge 연결, 스토어 빌드·업로드는 수행하지 않았습니다.

## 1. 통합 결정

canonical branch는 `main`의 `bd23179`에서 시작하여 PR #20의 exact head `fa2cf745a`를 non-fast-forward merge했습니다. merge commit은 `5b31368f8f90b86eb8b2d215dea2163fdf27d361`입니다.

이 선택은 PR #1~#20의 의존 DAG가 하나의 implementation chain임을 확인한 결과입니다. 특히 PR #9가 보안·동의·공유·구독·인증·care handoff의 분기들을 통합하고, #10~#20이 privacy event, authority/deletion 보강, five-minute loop, native static preflight와 accessibility/resume 보강을 그 위에 쌓습니다. 중간 PR만 선택적으로 cherry-pick하면 서버 schema·repo/context·UI 계약이 분리되어 MVP 보안 P0를 훼손할 위험이 더 큽니다.

PR #21~#26은 `main`에서 별도로 출발한 preview/오프라인 device-QA 증거 파이프라인입니다. 실기기 확인을 대체하지 않으며 출시 차단을 직접 해소하지 않으므로 canonical runtime stack에서는 제외하고 후속 후보로 남겼습니다. PR #27은 #26의 환경 경계 보강이며 같은 이유로 제외합니다.

## 2. PR dependency DAG와 결정표

`→`는 PR base 의존입니다. 각 PR의 GitHub Actions exact-head check는 조회 시점에 아래 표의 상태였습니다.

| PR | base → head | 결정 | 근거 / exact-head CI |
| --- | --- | --- | --- |
| #1 | `main → claude/repo-progress-review-mvaiat` | 포함 | CareNote 앱·release baseline. Workers, deploy, RLS, typecheck, build 성공. |
| #2 | `#1 → chore/git-development-workflow` | 포함 | quality gate parent; typecheck/RLS/E2E/gating 성공. |
| #3 | `#2 → fix/p0-rls-data-integrity` | 포함 | P0 RLS·recipient atomicity; 전 check 성공. |
| #4 | `#2 → feat/p0-auth-lifecycle-ux` | 포함 | 가입·복구·탈퇴 lifecycle; edge 포함 전 check 성공. |
| #5 | `#3 → fix/p0-consent-account-deletion-backend` | 포함 | 동의 증빙·계정 삭제 backend; 전 check 성공. |
| #6 | `#5 → fix/p0-secure-share-links` | 포함 | 공유 링크 consent/revocation·retention; edge-share 포함 성공. |
| #7 | `#4 → feat/p0-care-handoff-loop` | 포함 | 공동 확인·60초 진료 briefing loop; 전 check 성공. |
| #8 | `#6 → feat/p0-entitlement-ledger` | 포함 | subscription entitlement ledger; 전 check 성공. |
| #9 | `#2 → fix/p0-integrate-approved-stacks` | 포함 | #3/#4/#6/#7/#8 security·auth·care stack 통합; edge 포함 전 check 성공. |
| #10 | `#9 → test/p1-android-preview-readiness` | 포함 | Android preview static evidence parent; 전 check 성공. |
| #11 | `#10 → feat/p0-privacy-safe-event-contract` | 포함 | P0 privacy event boundary; analytics 포함 성공. |
| #12 | `#11 → fix/p1-dependency-security-baseline` | 포함 | #13의 required parent/security baseline; 전 check 성공. |
| #13 | `#12 → fix/p0-trust-control-gaps` | 포함 | guardian authority·delete trust P0; 전 check 성공. |
| #14 | `#13 → feat/p0-five-minute-wow-internal` | 포함 | consent revoke 뒤 handoff fail-closed; 전 check 성공. |
| #15 | `#14 → fix/p0-internal-trust-control-gate` | 포함 | sensitive consent mutation confirmation; 전 check 성공. |
| #16 | `#15 → feat/p0-five-minute-wow-flow` | 포함 | 핵심 user funnel contract; 전 check 성공. |
| #17 | `#16 → docs/p1-internal-beta-readiness-evidence` | 포함 | native proof와 needs-device를 분리하는 release guard; 전 check 성공. |
| #18 | `#17 → docs/p1-internal-beta-native-gap-matrix` | 포함 | native runtime static preflight와 false-green 차단; native-preflight 포함 성공. |
| #19 | `#18 → fix/p1-native-accessibility-state-contract` | 포함 | picker focus/accessibility runtime contract 보강; 전 check 성공. |
| #20 | `#19 → test/p1-ios-preview-readiness` | 포함 | iOS static preview readiness; native-preflight 포함 전 check 성공. |
| #21 | `main → docs/p1-preview-readiness-portfolio` | 제외·후속 | 문서만 변경; Workers 실패, typecheck/RLS 성공. |
| #22 | `main → docs/p1-preview-gate-decision-packet` | 제외·후속 | 문서만 변경; Workers 실패, typecheck/RLS 성공. |
| #23 | `#22 → test/p1-device-qa-evidence-intake` | 제외·후속 | offline device evidence tooling; 실기기 block를 해소하지 않음. Workers 실패, typecheck/RLS 성공. |
| #24 | `#23 → ci/p1-device-qa-evidence-gate` | 제외·후속 | CI evidence gate; device evidence static validation 성공, Workers 실패. |
| #25 | `#24 → test/p1-device-qa-evidence-schema-provenance` | 제외·후속 | provenance tooling; device evidence static validation 성공, Workers 실패. |
| #26 | `#25 → test/p1-device-qa-evidence-provenance-cli` | 제외·후속 | deterministic provenance CLI; device evidence static validation 성공, Workers 실패. |

## 3. Cloudflare Workers 실패 해석

PR #21~#26은 `main`에서 시작해 docs/evidence tooling만 추가한 별도 stack이며, canonical runtime stack의 `wrangler.jsonc`, package/build configuration을 포함하지 않습니다. 각 Workers check의 공개 GitHub output은 Cloudflare production Build ID와 Script 링크만 제공하고 실패 로그는 제공하지 않았습니다. 따라서 공개 evidence로 확정 가능한 원인은 “Cloudflare가 이 docs-only, runtime-config 부재 branch에도 production build를 시도했다”까지이며, Cloudflare dashboard 권한·로그 없이 상세 원인을 단정하지 않습니다.

이 실패는 (a) #21~#26이 runtime integration 후보가 아니고, (b) #1~#20 exact heads에서는 Workers check가 성공했으며, (c) canonical branch는 #20의 runtime configuration을 포함한다는 이유로 release gate 근거에서 제외했습니다. Cloudflare production 재시도·설정 변경·배포는 승인 범위 밖입니다.

## 4. canonical local validation

lockfile 기반 `npm ci` 후 merge exact head에서 다음을 재실행했습니다.

| 검증 | 결과 |
| --- | --- |
| `npm run typecheck` | 통과 |
| `npm run test:e2e` | PASS 189 / FAIL 0 |
| `npm run test:gating` | PASS 41 / FAIL 0 |
| `npm run test:five-minute-wow` | PASS 41 / FAIL 0 |
| `npm run test:analytics` | PASS 37 / FAIL 0 |
| `npm run test:native-preflight` | PASS 13 / FAIL 0 |
| `npm run test:app-resume-lifecycle` | PASS 14 / FAIL 0 |
| `npm run test:accessibility` | PASS 11 / FAIL 0 |
| `npm run test:ios-preview-readiness` | PASS 8 / BLOCKED_GATES 6 / FAIL 0 |
| `npx expo export --platform web --output-dir dist-web` | 833 modules로 성공 |
| `git diff --check` | 통과 |

RLS PostgreSQL 16과 Deno Edge contract는 이 runner에 `psql`·`deno`가 없고 Docker daemon도 연결 불가하여 local 재실행하지 못했습니다. PR #20 exact-head Actions에서는 RLS, edge-contracts, typecheck, E2E, gating, analytics, native preflight가 모두 success였고, RLS suite expected count는 CI workflow상 181입니다. canonical remote exact-head CI가 이 문서 commit 뒤에 별도로 실행되어야 최종 checkpoint가 됩니다.

## 5. E2E 결정론 범위와 잔여 gap

결정론 테스트가 다루는 핵심 루프는 가입/프로필 lifecycle → 관리 대상자·동의 → 보호자 권한/공동 확인 → 기록·그래프 → 진료 briefing/care handoff → 레포트/공유 링크 계약 → 동의 철회 및 account deletion fail-closed입니다. 테스트는 demo/memory와 contracts를 대상으로 하므로 다음을 대신 증명하지 않습니다.

- 운영 Supabase migration/RLS/Storage와 `share-report`, `delete-account`, billing Edge Function의 실제 deploy 및 수신자 관점 회수
- Android/iOS 실기기 permission, 알림, picker/VoiceOver/TalkBack focus, PDF/share sheet, OAuth redirect/deep link, 앱 resume
- 실제 bundle ID·Apple/Google signing·EAS/TestFlight/Play build/upload
- SMS/OAuth/RevenueCat 상품·webhook, 법률 검토 policy/terms·external deletion URL

위 항목은 staging/실기기에서만 확인 가능한 residual gap이며, 별도 승인 없이 실행하지 않습니다. `ios-preview-readiness`의 6 blocked gate는 의도된 fail-closed 결과입니다.

## 6. rollback 및 다음 게이트

이 canonical stack의 rollback은 remote checkpoint merge commit을 revert하거나, `main`을 건드리지 않고 이 branch를 폐기하는 것입니다. production data, migration, deployment, secret, store state를 되돌릴 대상은 이번 작업에서 만들지 않았습니다.

다음 단계는 independent Ratchet review에서 canonical remote exact SHA, local/Actions checks, scope 표와 residual gaps를 대조하는 것입니다. 그 승인 뒤에도 staging/실기기 및 운영 계정 작업은 캡틴의 별도 승인 게이트로 유지됩니다.
