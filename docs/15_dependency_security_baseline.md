# 의존성 취약점 기준선과 최소 안전 조치

- 기준일: 2026-08-24 KST
- 기준 커밋: `a33fe765e1c02e6e80970b8d5c5e8f7936bb2054`
  (`origin/feat/p0-privacy-safe-event-contract`, Draft PR #11 current head)
- 대상: `package-lock.json`으로 재현한 Expo SDK 54 / React Native 0.81.4 설치 그래프
- 범위 밖: production/store 배포, 운영 migration, OAuth·결제, secret·registry 설정,
  외부 SDK·telemetry 추가, main 병합

이 문서는 `npm audit` 결과를 앱 런타임 취약점으로 과장하지 않고, 현재 SDK 호환 범위에서
비파괴적으로 고칠 수 있는 것과 별도 SDK 업그레이드가 필요한 것을 분리한다. audit JSON은
CI/artifact 수집 시 비밀값을 포함하지 않으며, 이 문서에도 토큰·환경변수·개인정보를 기록하지
않는다.

## 재현 가능한 기준선

다음 명령을 깨끗한 worktree에서 실행했다.

```bash
npm ci --ignore-scripts
npm audit --json
npm audit --omit=dev --json
npm audit fix --package-lock-only --dry-run --json
```

결과는 전체와 `--omit=dev` 모두 **24건(High 13, Moderate 11, Critical 0)** 이다.
`--omit=dev`가 동일한 이유는 Expo의 CLI/build graph가 root `expo`의 production dependency
아래에 있기 때문이며, 이것만으로 Node 개발 도구가 모바일 앱 번들에 포함된다는 뜻은 아니다.

`npm audit fix --package-lock-only --dry-run`은 `added: 0`, `removed: 0`, `changed: 0`을
반환했다. `--force`가 제안하는 해법은 Expo SDK 57 및 SDK-동기화 패키지의 major upgrade이며,
현재 SDK 54 / React Native 0.81.4 조합에는 적용하지 않는다.

## 경로·영향 분류

| 분류 | audit 항목 | lockfile 경로/실행 경계 | 실제 도달성 및 현재 완화 |
| --- | --- | --- | --- |
| SDK 57 필요 (High) | `expo` (direct), `@expo/cli`, `@expo/metro`, `@expo/metro-config`, `metro`, `metro-config`, `metro-transform-worker`, `image-size`, `postcss` | root `expo@~54.0.0` → Expo CLI/Metro build chain | 개발 서버·web export·native prebuild가 처리하는 소스/자산/설정 입력 경계다. 앱 코드가 이 패키지를 직접 import하지 않는다. 신뢰된 저장소·CI 입력만 사용하고 SDK 57 migration에서 Expo 호환 매트릭스와 함께 재평가한다. |
| SDK 57 필요 (Moderate) | `expo-auth-session` (direct), `expo-constants` (direct), `expo-notifications` (direct), `@expo/config`, `@expo/config-plugins`, `expo-asset`, `expo-linking`, `uuid`, `xcode` | Expo SDK 패키지 및 CLI/config plugin chain | auth-session/constants/notifications는 앱에서 사용하지만 audit의 취약 경로는 Expo config/CLI 쪽 전이다. `xcode`/`uuid`는 prebuild tooling 경로다. 런타임 이용자 입력이 해당 Node 도구 API에 전달되는 경로는 소스 검색에서 확인되지 않았다. |
| non-breaking fix 표시이나 현 그래프에서 자동 적용 불가 | `brace-expansion`, `js-yaml`, `nanoid`, `tar`, `undici`, `@expo/prebuild-config` | Expo/React Native/React Navigation의 전이 dependency | `npm audit fix --dry-run`이 lockfile 변경을 만들지 않는다. `npm explain`으로 root가 이 패키지들을 직접 의존하지 않음을 확인했다. arbitrary `overrides`는 Expo/RN 지원 그래프를 깨거나 지원 밖 조합을 만들 수 있어 사용하지 않는다. |

알려진 advisory 중 입력 전제가 특히 중요한 항목은 다음과 같다.

- `brace-expansion`: 확장 길이/중간 배열을 유발하는 glob 패턴 DoS
  (GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895).
- `image-size`: 악성 ICNS/JXL/HEIF 입력 파서 무한 루프 DoS
  (GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq).
- `js-yaml`: `!!omap` 또는 source map 해석의 CPU/파일 공개 경계
  (GHSA-5p4m-2wfm-xmqj).
- `postcss`: 공격자 제어 source mapping URL을 처리하는 build-time 파일 공개 경계
  (GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849).
- `nanoid`: 호출자가 0/음수 크기를 넘기는 custom generator 무한 루프 경계
  (GHSA-28wg-ghj8-5hjv, GHSA-2v37-7h3g-55p8).
- `tar`: CLI가 선택 필터와 장경로 tar를 처리하는 stack-overflow DoS 경계
  (GHSA-r292-9mhp-454m).
- `undici`: retry interceptor, Blob type, cookie/domain을 직접 사용하는 Node HTTP client
  경계(GHSA-8xcm-r25x-g524, GHSA-m8rv-5g2x-5cg5, GHSA-v3r7-h72x-cjcm).

이 앱의 `src/`와 `scripts/`에는 위 전이 패키지의 직접 import/require가 없다. 이는
"취약점이 없다"가 아니라, 현재 확인한 앱 코드 경로에서 advisory별 악성 입력 precondition을
직접 제공하지 않는다는 한정된 도달성 판정이다. 모바일/native bundle과 Expo 도구가 새 버전에서
어떤 내부 코드를 포함하는지는 SDK migration 검증 시 다시 확인해야 한다.

## 적용한 최소 변경과 검증

호환 범위 안의 `npm update expo --package-lock-only`도 한 번 검사했다. SDK 54.0.35에서
54.0.37로의 patch 후보가 존재했지만, npm의 현재 peer 해석은 **7,718줄** lockfile diff와
SDK 57 peer 항목을 함께 만들고 audit을 24건에서 23건으로만 바꿨다. 이는 "작은 lockfile
수정" 기준을 충족하지 않고 지원 graph를 넓히므로 즉시 되돌렸다.

따라서 이 카드의 최종 dependency 변경은 **없다**. `package.json`과 `package-lock.json`은
기준 커밋과 동일하게 유지한다. install script, registry, external SDK, network telemetry,
secret은 추가·변경하지 않았다.

## 다음 안전 업그레이드 조건

1. Expo가 지원하는 다음 SDK migration을 별도 branch/card에서 수행한다. `expo`,
   Expo module, React Native, React/React Native Web을 Expo의 해당 SDK 매트릭스대로 함께
   올리고 임의 override를 쓰지 않는다.
2. migration branch에서 clean `npm ci`, `npm audit --json`, `npm audit --omit=dev --json`을
   다시 수집해 이 기준선과 package/path별로 비교한다.
3. analytics contract, typecheck, E2E, gating, Edge Deno contracts/check, fresh PG16 RLS
   fail-closed marker, Expo web export, `git diff --check`를 모두 통과시키고 native device
   smoke까지 통과하기 전에는 SDK major를 배포하지 않는다.
4. 그 전에는 lockfile을 기준으로 설치하고, CI/개발 환경에서 신뢰되지 않은 저장소·archive·CSS
   source-map·glob 입력을 Expo CLI/Metro/prebuild 도구에 전달하지 않는다. Dependabot류 자동
   major/force PR도 위 검증 카드로만 승격한다.
5. **재검토 기한은 2026-09-23 KST 또는 store submission 전 중 더 이른 시점**이다. 그때까지
   별도 SDK migration 검증이 승인되지 않으면 이 기준선·완화 조건을 release checklist에서
   다시 확인하고, `npm audit` 결과를 갱신한다.
