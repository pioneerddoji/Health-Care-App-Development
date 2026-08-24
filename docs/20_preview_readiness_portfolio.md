# P1 Android·iOS preview readiness 포트폴리오

> 기준 시각: 2026-08-24 KST. 이 문서는 Android/iOS preview 후보의 **비밀 없는 재현·정적 계약 증거**를 하나로 연결한다. 실제 빌드·서명·업로드·배포·외부 기기 연결·운영 연동의 성공을 주장하지 않는다.

## 1. 범위와 판정 원칙

- `proven`은 명시된 exact SHA에서 로컬 또는 current-head CI로 재현·대조된 항목만 뜻한다.
- `not proven`은 이 포트폴리오의 정적/Node/웹 검증으로 증명할 수 없는 항목이다.
- `needs-device`는 외부 실기기/에뮬레이터 없이 확인할 수 없어 성공으로 승격하지 않은 항목이다.
- `캡틴 승인 gate`는 명시 승인과 별도 후속 카드가 있어야 열 수 있다.
- 본 문서의 rollback은 이 문서와 DEVLOG 항목만 담은 커밋을 revert하는 것이다. 원본 implementation, EAS/Apple/Google, 운영 Supabase, 고객 데이터에는 영향을 주지 않는다.

## 2. 원격 exact-head 대조 (2026-08-24 KST)

보호된 공용 Git credential helper(`git credential fill` → GitHub API)를 통해 credential을 프로세스 메모리에서만 사용하고 출력·복사·저장하지 않은 채, GitHub REST API와 `git ls-remote`로 원격 refs를 대조했다. 이 인증 경로로 PR #18/#20/#21의 base/head SHA·Draft 상태·review endpoint·head check-runs를 같은 시점에 재조회했다.

| 플랫폼 | Draft PR | base (remote SHA) | head (remote SHA) | Draft | review endpoint 결과 | current-head Actions |
|---|---|---|---|---|---|---|
| Android | [#18](https://github.com/pioneerddoji/Health-Care-App-Development/pull/18) | `docs/p1-internal-beta-readiness-evidence` (`53de38f355514e581548993cff232be9d312316d`) | `docs/p1-internal-beta-native-gap-matrix` (`13ed953e95ffaff281c40e52d6b2acea590cbedb`) | open/draft | formal approval 아님: API가 반환한 `COMMENTED` review 4건 ([1](https://github.com/pioneerddoji/Health-Care-App-Development/pull/18#pullrequestreview-5003346305), [2](https://github.com/pioneerddoji/Health-Care-App-Development/pull/18#pullrequestreview-5003369821), [3](https://github.com/pioneerddoji/Health-Care-App-Development/pull/18#pullrequestreview-5003413545), [4](https://github.com/pioneerddoji/Health-Care-App-Development/pull/18#pullrequestreview-5003467439)) | [8/8 completed/success](https://github.com/pioneerddoji/Health-Care-App-Development/actions/runs/32670021170): Workers Builds, e2e, edge-contracts, analytics, typecheck, rls, native preflight, gating |
| iOS | [#20](https://github.com/pioneerddoji/Health-Care-App-Development/pull/20) | `fix/p1-native-accessibility-state-contract` (`ee9a88fde5c190e38dbceb8ef23b74b8fa1e1ba0`) | `test/p1-ios-preview-readiness` (`fa2cf745aaf79ab66746d2d83d6a38b4c58f79a0`) | open/draft | API returned **no formal PR review** at query time. Upstream execution-lens ratchet is separately recorded as Kanban parent `t_de8740e2` APPROVE; it must not be represented as a GitHub approval. | [8/8 completed/success](https://github.com/pioneerddoji/Health-Care-App-Development/actions/runs/32673930804): Workers Builds, e2e, native preflight, typecheck, rls, analytics, edge-contracts, gating |

The Android and iOS SHA values are distinct. No cross-PR status is substituted for an exact head.

## 3. 포트폴리오 Draft PR current-head 상태

이 문서의 최초 [Draft PR #21](https://github.com/pioneerddoji/Health-Care-App-Development/pull/21) head `60bb5966e79dad6e402e516d8bc0bcf0c34668c2`는 base `main` (`bd23179fd09af1c53522b3b4bf1fb6e08fbfac19`)과 API·ref로 일치했고, Draft/open이며 formal GitHub PR review는 없었다. 해당 최초 head의 check-runs는 `typecheck` 및 `rls-test`가 completed/success였고, `Workers Builds: health-care-app-development`는 completed/**failure**였다. 따라서 PR #21은 green으로 취급하지 않으며, 이 실패를 build·upload·production 성공 또는 실패의 근거로 해석하지 않는다. 문서가 자기 자신의 후속 커밋 SHA를 정적으로 current라고 주장하지 않도록, 수정 후 exact remote head·current-head checks·review URL은 protected-helper API/ref 재대조 결과를 포함한 Kanban handoff에 고정한다.

## 4. iOS exact-head clean reproduction

A disposable archive extracted directly from immutable `fa2cf745aaf79ab66746d2d83d6a38b4c58f79a0` was clean-installed with `npm ci`; it was not the portfolio branch. `npm ci` succeeded and reported existing advisories (24: moderate 11, high 13) plus one pending `esbuild` install script. No audit fix or script approval was performed.

| Command / source | result |
|---|---|
| `npm run typecheck` | pass |
| `npm run test:analytics` | PASS 37 / FAIL 0 |
| `npm run test:five-minute-wow` | PASS 41 / FAIL 0 |
| `npm run test:e2e` | PASS 189 / FAIL 0 |
| `npm run test:gating` | PASS 41 / FAIL 0 |
| `npm run test:app-resume-lifecycle` | PASS 14 / FAIL 0 |
| `npm run test:native-preflight` | PASS 13 / FAIL 0 |
| `npm run test:accessibility` | PASS 11 / FAIL 0 |
| `npm run test:ios-preview-readiness` | PASS 8 / FAIL 0; expected blocked gates 6 |
| Deno contracts | PASS 10 / FAIL 0 (share 6 + billing 3 + delete-account 1) |
| Deno check | `share-report`, `billing-webhook`, `delete-account` entrypoints pass |
| `npx expo export --platform web --output-dir dist-web` | pass; local bundle reported 896 modules |
| exact-head `git diff --check` | pass |
| PostgreSQL 16 | local run not performed; iOS exact-head [remote `rls-test` success](https://github.com/pioneerddoji/Health-Care-App-Development/actions/runs/32673930804/job/97278878052) is the source of truth. CI contract expects 181 assertions and one completion marker. |

## 5. Android·iOS preview readiness matrix

| area | Android evidence — PR #18 exact head | iOS evidence — PR #20 exact head | not proven / needs-device | 캡틴 승인 gate | rollback |
|---|---|---|---|---|---|
| source, Draft, CI | exact base/head, Draft, review URLs and 8/8 current-head Actions are in §2 | exact base/head, Draft and 8/8 current-head Actions are in §2; no formal PR review at query time | no merge/release decision | separate ratchet review must approve this portfolio card | revert portfolio docs commit only |
| static preview config | documented Android package placeholder, internal APK preview profile and static preflight in [PR #18 exact-head source](https://github.com/pioneerddoji/Health-Care-App-Development/blob/docs/p1-internal-beta-native-gap-matrix/docs/13_android_preview_readiness.md) | `ios-preview-readiness` verifies scheme, `supportsTablet`, internal preview profile and intentional blocked placeholders | a static pass is not a native build | final Android package and iOS bundle ID are separate decisions | revert docs only; do not alter IDs |
| regression/contracts | Android source evidence: typecheck, E2E 174/0, gating 41/0, Deno 10/0; its fresh PG16 claim is remote CI only | §3 reproduces typecheck, analytics, WOW, E2E, gating, app-resume, native preflight, accessibility, iOS readiness, Deno 10/0, web export and diff check | Node/web cannot prove native runtime | follow-up card before changing implementation | revert docs only |
| build, upload, signing | **not performed** | **not performed** | APK/IPA output, signing, TestFlight/Play/App Store Connect acceptance | account owner approval for EAS/Google/Apple, signing, build/upload | no build artifact exists to roll back |
| device runtime/accessibility | **needs-device** | **needs-device**: VoiceOver speech/navigation, OS picker focus trap, native focus, permissions, PDF/share/notification/deep-link lifecycle | actual physical-device behavior | approved device test card and real device evidence | no device state changed |
| OAuth, billing, Supabase | **not performed**; hidden/off policy remains static | **not performed**; six iOS preflight blockers explicitly preserve provider/billing/production gates | OAuth redirect, payment, production RLS/data/migration are not validated | provider, RevenueCat/store, production Supabase and legal approvals | no external configuration changed |

## 6. Next decision sequence

1. Keep both candidate PRs Draft and retain their exact heads until review settles.
2. A reviewer must evaluate this portfolio card independently of the implementation author. An APPROVE or one canonical REQUEST_CHANGES is required; neither existing Android comments nor the absent iOS formal PR review is relabeled as approval.
3. Only after explicit Captain approval, create separately scoped work for identity/signing, approved preview build/upload, real-device test, production Supabase, OAuth/billing, and store/legal metadata. None is authorized by this portfolio.

## 7. Prohibited work confirmation

This task did not perform EAS/store build or upload; Google/Apple login; signing or secret operations; bundle/package ID finalization; external device/emulator connection; OAuth/billing/production Supabase/migration/data access; DNS/cost increase; customer-facing content or price/brand decisions; deployment; or a `main` merge.
