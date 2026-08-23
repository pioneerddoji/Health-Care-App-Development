# P1 내부 베타 후보 exact-head 증거 매니페스트

> 기준일: 2026-08-24 KST. 이 문서는 내부 제품·엔지니어링 검증의 재현 가능한 증거만 보관한다. 실제 사용자, 외부 코호트, 사례비, 고객 접촉, 광고, 원격 telemetry는 사용하거나 생성하지 않았다.

## 1. 승인 기준점과 추적성

| 항목 | 대조 결과 |
| --- | --- |
| 기준 PR | [Draft PR #16](https://github.com/pioneerddoji/Health-Care-App-Development/pull/16), open/draft |
| PR #16 base | `fix/p0-internal-trust-control-gate` @ `abf431d798d579226847d48364ecb73062a132ff` |
| PR #16 approved implementation exact head | `feat/p0-five-minute-wow-flow` @ `0c7661d4ff97a8d1de1602d6be21c4af90f7776e` |
| PR #17 documentation exact head | [Draft PR #17](https://github.com/pioneerddoji/Health-Care-App-Development/pull/17), `docs/p1-internal-beta-readiness-evidence` @ `fe94a9b28f207992c1df54a6b42bad5baad84e1e` |
| PR #15 | [Draft PR #15](https://github.com/pioneerddoji/Health-Care-App-Development/pull/15), base `feat/p0-five-minute-wow-internal` @ `af58913c56a22d6e42db89ad6f8b7cdea2f1c9cc`, head `fix/p0-internal-trust-control-gate` @ `abf431d798d579226847d48364ecb73062a132ff` |
| 독립 current-head verdict | [PR #16 review](https://github.com/pioneerddoji/Health-Care-App-Development/pull/16#pullrequestreview-5003272133): `0c7661d4ff97a8d1de1602d6be21c4af90f7776e`에 대한 APPROVE 판단. PR author와 인증된 GitHub identity가 같아 GitHub formal approve는 거부되어 COMMENT review로 남았다. |

공용 GitHub credential helper는 임시 격리 `HOME`과 보호된 `GH_CONFIG_DIR`에서만 사용했다. credential/token을 출력·복사·문서화하지 않았고, API는 PR base/head, review, check-run 조회에만 사용했다. 별도로 `git ls-remote`는 PR #15/#16 refs와 원격 branch SHA가 위 값과 일치함을 확인했고, `git merge-base --is-ancestor`로 PR #15 head가 PR #16 head의 조상임을 확인했다.

## 2. 승인 SHA의 clean checkout 재현

이 evidence branch는 clean worktree에서 exact head `0c7661d4ff97a8d1de1602d6be21c4af90f7776e`로 fast-forward한 뒤 `npm ci`를 실행했다. 다음 결과는 그 SHA에서의 실제 로컬 실행 결과다.

| 명령 | 결과 |
| --- | --- |
| `npm ci` | 성공. audit advisory **24건**(moderate 11, high 13), `esbuild` allow-scripts pending 1건을 보고했으며 자동 수정·승인은 하지 않았다. |
| `npm run typecheck` | 통과 |
| `npm run test:analytics` | **PASS 37 / FAIL 0** |
| `npm run test:five-minute-wow` | **PASS 41 / FAIL 0** |
| `npm run test:e2e` | **PASS 189 / FAIL 0** |
| `npm run test:gating` | **PASS 41 / FAIL 0** |
| `npx --yes deno test --allow-env --allow-net` (share-report, billing-webhook, delete-account contracts) | **PASS 10 / FAIL 0** |
| `npx --yes deno check` (세 Edge Function entrypoint) | 모두 통과 |
| `npx expo export --platform web --output-dir dist-web` | 통과, web bundle **850 modules** |
| `git diff --check` | 통과 |

WOW fixture는 synthetic clock만 쓰는 내부 결정론 contract다. 건강 원문·진단·약 정보는 fixture state에 넣지 않고, analytics 또는 network SDK를 호출하지 않는다. `confirmOtherGuardian`의 취소·만료·중복·부분 응답·다른 circle·offline·rejected promise 및 forged resume snapshot은 모두 성공 표시 없이 fail-closed로 남는지 위 41개 assertion으로 확인한다.

## 3. 원격 current-head CI와 fresh PostgreSQL 16 증거

GitHub API로 두 SHA의 check-run을 분리해 대조했다.

1. **승인된 구현 SHA** `0c7661d4ff97a8d1de1602d6be21c4af90f7776e`의 여섯 required job은 모두 `completed/success`였고, workflow run은 [32663538256](https://github.com/pioneerddoji/Health-Care-App-Development/actions/runs/32663538256)이다.
   - `typecheck`, `e2e-tests`, `gating-tests`, `analytics-contracts`, `edge-contracts`, `rls-test`
   - `rls-test`의 [job 97253234652](https://github.com/pioneerddoji/Health-Care-App-Development/actions/runs/32663538256/job/97253234652)은 fresh PostgreSQL **16.15** service container에서 다음 completion marker를 실제로 출력했다.

```text
RLS_SUITE_COMPLETE expected=181
RLS_ASSERTIONS PASS=181/181 FAIL=0 COMPLETION=1
```

2. **이 매니페스트 문서의 exact current head** `fe94a9b28f207992c1df54a6b42bad5baad84e1e` (PR #17)의 여섯 required job과 Workers build는 모두 `completed/success`였고, workflow run은 [32664079278](https://github.com/pioneerddoji/Health-Care-App-Development/actions/runs/32664079278)이다.
   - `typecheck`, `e2e-tests`, `gating-tests`, `analytics-contracts`, `edge-contracts`, `rls-test`, `Workers Builds`
   - fresh PostgreSQL 16 `rls-test` exact-head job은 [97254656303](https://github.com/pioneerddoji/Health-Care-App-Development/actions/runs/32664079278/job/97254656303)이다.

이 runner에는 `psql`이 설치되어 있지 않고 Docker daemon도 연결되지 않아 로컬 fresh PG16 fixture를 재실행할 수 없었다. 따라서 위 두 항목은 로컬 실행을 가장하지 않는 GitHub 원격 CI 근거이며, 구현 검증과 문서 current-head 검증을 서로 대체하지 않는다. 이후 어느 head라도 바뀌면 이 매니페스트를 승계하지 말고 새 SHA에서 해당 check-run과 fresh-PG job을 다시 대조해야 한다.

## 4. false-green 방지와 알려진 위험

- CI RLS job은 `set -Eeuo pipefail`, `psql -v ON_ERROR_STOP=1`, 예상 PASS 수, FAIL 수, 마지막 completion marker를 모두 검사한다. 단순히 로그에 `FAIL`이 없는 상태는 통과 근거가 아니다.
- 로컬 tests/웹 export는 Node 환경에서 실행했고, fresh PG16은 원격 CI 근거로 분리했다. 원격 CI 성공도 실제 운영 Supabase migration 또는 실사용자 데이터 검증을 뜻하지 않는다.
- `npm ci`의 24 advisory 및 pending `esbuild` script는 기존 dependency risk다. 이 카드에서는 `npm audit fix`, `--force`, lockfile 변경, dependency upgrade를 수행하지 않았다. 별도 SDK migration 승인 카드에서 재평가해야 한다.
- Expo web export는 UI bundle 검증일 뿐 native picker, permissions, PDF, notification, Android 실기기 동작을 증명하지 않는다.

## 5. 캡틴 승인 게이트 (실행 금지)

아래는 후보 증거와 별개인 명시적 승인 항목이다. 이 문서는 어느 항목도 실행하거나 결정하지 않는다.

1. **P0-04 외부 코호트/보상:** 참여자 모집, 실사용자 접촉, 사례비·비용, 외부 연구/테스트는 별도 승인 없이는 금지한다.
2. **P0-05 가격·소비자보호 문구:** 가격, 할인, 환불, 소비자보호·스토어 문구의 확정 또는 노출은 별도 법률/사업 승인 없이는 금지한다.
3. **P0-06 이름 테스트/사례비:** 이름·브랜드 테스트, 고객 메시지, 광고, 사례비 집행은 별도 승인 없이는 금지한다.
4. 운영 Supabase migration/data access, OAuth·결제·SMS live 전환, DNS/secrets/credential 생성·복사, EAS/Play build·upload, production/store 배포, `main` 병합은 이 카드 범위 밖이며 별도 승인 카드에서만 수행한다.

## 6. 롤백과 다음 handoff

이 카드의 산출물은 문서뿐이다. 롤백은 이 evidence 문서와 DEVLOG entry를 포함한 단일 문서 커밋을 되돌리는 것으로 충분하며, PR #16 implementation SHA와 운영 환경을 바꾸지 않는다.

다음 단계는 이 문서 branch의 작은 commit, remote SHA, Draft PR, current-head CI를 확보한 뒤 구현자와 분리된 독립 current-head review를 정확히 1건 실행하는 것이다. review가 REQUEST_CHANGES이면 기존 PR/worktree/commit을 보존하고, 재현 및 단일 canonical repair/re-review handoff만 남긴다.
