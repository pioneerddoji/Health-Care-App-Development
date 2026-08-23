# Android 내부 preview 재현성·스토어 진입 증거

> 기준일: 2026-08-23. 이 문서는 Android preview APK를 실제로 생성·배포하거나 스토어에 업로드한 기록이 아니다. P0 통합 Draft PR #9의 불변 head에서 수행한 **비밀 없는 사전검사와 재현 검증**을 보관한다.

## 1. 승인된 기준점

| 항목 | 값 | 확인 방법 |
|---|---|---|
| 기준 Draft PR | [#9](https://github.com/pioneerddoji/Health-Care-App-Development/pull/9), open/draft | GitHub REST API |
| base | `chore/git-development-workflow` @ `24a485870f4d3f4d8469c6da9bf04bc013338828` | GitHub REST API + `git merge-base --is-ancestor` |
| head | `fix/p0-integrate-approved-stacks` @ `4094286315b9495ac77ce12ccab751fe92d0ac35` | GitHub REST API + `git ls-remote` |
| Android evidence branch | `test/p1-android-preview-readiness` | fast-forward only to the above head; arbitrary `main` merge 없음 |

GitHub REST API로 위 head의 현재 check-run 6개를 대조했으며 `Workers Builds`, `e2e-tests`, `gating-tests`, `edge-contracts`, `typecheck`, `rls-test`가 모두 `completed/success`였다. 이 문서의 후속 로컬 검증도 동일 SHA의 clean checkout에서 실행했다.

> **독립 승인 보류:** ratchet의 changes-request 뒤 반영된 현재 head에는 새 ratchet 재검토 승인 evidence가 아직 없다. 별도 재검토 카드가 queue된 상태이므로, 이 문서는 안전한 정적/로컬 증거일 뿐 Android credential·비용·업로드 경계를 여는 승인 근거가 아니다.

## 2. clean checkout 재현 결과

`npm ci`가 lockfile 기반으로 성공했다. 이어서 아래 검증을 실행했다.

| 검증 | 결과 |
|---|---|
| `npx tsc --noEmit` | 통과 |
| `npm run test:e2e` | `PASS 171 / FAIL 0` |
| `npm run test:gating` | `PASS 41 / FAIL 0` |
| `npx expo export --platform web --output-dir dist-web` | 통과; web bundle 876 modules, output `dist-web` |
| `git diff --check` | 통과 |

로컬 runner에는 `deno`와 `psql`이 없고 Docker daemon도 실행 중이 아니므로 Deno Edge contract와 fresh PostgreSQL 16 RLS를 이 환경에서 재실행하지 못했다. 대신 동일 immutable head의 GitHub `edge-contracts`와 `rls-test` check-run 성공을 API로 대조했다. PR #9 handoff의 해당 CI 증거는 Edge contracts `PASS 10 / FAIL 0`, RLS `PASS 172/172, FAIL 0, COMPLETION 1`이며, CI 정의는 `.github/workflows/ci.yml:60-66`과 `:86-99`에서 기대값 `172`·완료 marker를 fail-closed로 확인한다.

## 3. Android preview 사전검사

### 정적 설정

- `app.json`: Android package는 `app.carenote.mvp`이고 여전히 **자리표시**다. `versionCode`는 `1`, 알림·이미지 권한은 선언돼 있다.
- `eas.json`: `preview`는 `distribution: internal`, `channel: preview`, `APP_ENV: preview`, Android `buildType: apk`로 구성되어 있다. production profile과 submit profile은 사용하지 않았다.
- `npx expo config --type public`로 Expo SDK 54 구성과 위 Android package·권한을 해석해 확인했다. 공개 설정에 Supabase 값은 빈 문자열이며 실제 secret은 검사·기록하지 않았다.

### EAS local/non-interactive preflight

`npx eas-cli@latest build --platform android --profile preview --local --non-interactive`를 **build 전 사전검사**로 한 번 실행했다. EAS CLI는 Expo 계정 또는 `EXPO_TOKEN`이 필요하다고 명시하고 종료했다. 계정 로그인, 토큰 설정, credential 생성/복사, 키스토어 접근, 빌드 생성, 업로드는 전혀 수행하지 않았다.

따라서 현재 상태는 “설정과 재현 검증은 통과했으나 credentialless preflight에서 의도대로 중단됨”이다. 실제 APK 산출물은 존재하지 않는다.

## 4. 캡틴 승인 게이트와 출시 차단 조건

아래 항목이 모두 승인·완료될 때까지 production AAB, Play Console 업로드, `eas submit`, EAS credential/secret 생성은 금지한다.

1. 최종 Android package/bundle ID 확정 (`app.carenote.mvp` 자리표시 교체) 및 첫 업로드 불변성 승인.
2. 현재 head에 대한 독립 ratchet 재검토 PASS. 이 선행 승인이 없으면 Android credential·비용·업로드 작업을 시작하지 않는다.
3. Expo/EAS 및 Google Play 계정, 서명·Play App Signing 정책의 계정 소유자 승인. 현재는 EAS 인증 정보가 없다.
4. 실제 운영 Supabase 연결·migration·Edge Function 배포와 `npm run verify:supabase` 전부 PASS. 이 작업에서는 운영 연결·migration을 수행하지 않았다.
5. 개인정보처리방침·이용약관 법률 검토, 외부 계정 삭제 URL 호스팅, Data safety/Health apps/대상 연령 선언 및 스토어 메타데이터 승인.
6. 앱 아이콘·스플래시의 케어노트용 교체 및 Play 중복/상표 확인.
7. OAuth 공급자, RevenueCat·결제, SMS live 전환은 기본 off/hidden 상태를 유지한다. 실제 키·공급자·결제 상품·고객 메시지·DNS는 이 작업 범위가 아니다.
8. 내부 preview APK가 별도 승인 후 생성되면 Android 실기기 체크리스트(권한, 사진, PDF/공유, 알림, 동의 철회, 계정 삭제, 재시작)를 수행하고 결과를 새 증거로 기록한다.

## 5. 롤백·알려진 위험

- 이 증거 작업은 문서만 추가한다. 롤백은 후속 문서 커밋을 되돌리면 되며 P0 통합 head를 변경하지 않는다.
- `npm ci`는 의존성 취약점 24건(중간 11, 높음 13)을 보고했다. 자동 `npm audit fix`는 lockfile을 바꾸므로 이 준비 작업에서 실행하지 않았다.
- 로컬 Node는 v26.5.1이며 CI는 Node 20을 사용한다. 동일 head의 CI 성공을 별도 근거로 보존한다.
- Deno/PostgreSQL 16은 이 runner에서 부재하므로, future head가 바뀌면 remote current-head CI의 `edge-contracts`·`rls-test`를 다시 API 대조해야 한다.

## 6. 금지된 작업 미수행 확인

production build/store upload, EAS/Google credential 생성 또는 복사, bundle ID 확정, OAuth·결제·운영 Supabase 연결/migration, DNS, 고객 메시지/광고, `main` 병합 및 비용 발생 작업을 수행하지 않았다.
