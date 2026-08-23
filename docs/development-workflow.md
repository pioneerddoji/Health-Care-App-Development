# CareNote 개발 버전관리·PR 품질 게이트

이 문서는 CareNote 저장소에서 사람이든 에이전트든 같은 방식으로 안전하게 작업하기 위한 운영 기준이다. `main`과 기존 PR의 상태를 보존하며, 저장소 설정 변경·`main` 병합은 캡틴의 승인 없이는 하지 않는다.

## 1. 작업 시작: 브랜치와 worktree

1. 시작 전에 원격 기준점을 확인한다.
   ```bash
   git fetch origin --prune
   git status --short
   git rev-parse origin/main
   ```
   작업 디렉터리가 깨끗하지 않거나 `origin/main`을 기준으로 하지 않는 경우에는 원인을 확인한 뒤 진행한다. 다른 작업자의 변경을 임의로 되돌리거나 덮어쓰지 않는다.
2. 에이전트/작업 하나당 전용 worktree 하나와 전용 브랜치 하나를 사용한다. 같은 파일을 동시에 크게 바꿔야 하면 먼저 담당을 분리하거나 순서를 정한다.
   ```bash
   git worktree add ../<task-id> -b feat/<short-description> origin/main
   ```
   기존 worktree에서는 해당 브랜치만 작업한다. 작업 완료 전 다른 worktree의 변경을 가져오지 않는다.
3. 브랜치 이름은 목적을 드러내는 소문자 kebab-case를 쓴다.
   - `feat/<description>`: 사용자 기능
   - `fix/<description>`: 결함 수정
   - `chore/<description>`: 운영·도구·문서·유지보수
   - `docs/<description>`: 문서만 변경
   - `ci/<description>`: CI/CD 변경
   - `refactor/<description>`: 동작 변경 없는 구조 개선

## 2. 작은 원자 커밋과 체크포인트 push

- 한 커밋은 하나의 검토 가능한 의도만 담는다. 기능 구현, 테스트, 문서, 포맷 대정리는 가능한 한 분리한다.
- 커밋 직전에 변경 범위를 확인하고 관련 검증을 통과시킨다.
  ```bash
  git diff --check
  git status --short
  git diff --cached --check
  ```
- Conventional Commit을 사용한다. 예: `docs(workflow): add PR quality gates`. 본문에는 **왜** 변경했는지와 수행한 검증을 짧게 적는다.
- 의미 있는 중간 상태(독립적으로 빌드/테스트 가능, 또는 안전한 문서·테스트 단위)마다 커밋하고 즉시 원격에 push한다. 큰 작업을 끝까지 로컬에만 쌓아 두지 않는다.
  ```bash
  git push -u origin HEAD       # 첫 push
  git push                      # 이후 체크포인트
  ```
- push 전후 SHA를 기록한다. PR 설명에는 최종 HEAD SHA와 실행한 명령의 결과를 남긴다. 실패한 검증은 숨기지 말고 PR의 차단 항목으로 적는다.

## 3. 장기 작업은 Draft PR로 보호

작업이 한 세션을 넘기거나 여러 체크포인트가 예상되면 첫 검증 가능한 커밋 뒤 Draft PR을 만든다. Draft PR은 백업·진척 공개·조기 피드백 수단이며 병합 대상이 아니다.

- 제목은 커밋 의도와 같은 접두사를 사용한다.
- `.github/pull_request_template.md`의 모든 섹션을 채운다.
- 구현자는 자신의 PR을 승인하거나 병합하지 않는다. 준비되면 Draft를 Ready로 전환하고 별도 리뷰어를 요청한다.
- CI가 아직 끝나지 않았거나 필수 항목이 실패하면 Ready 전환·병합을 하지 않는다.

`gh`가 가능하면 `gh pr create --draft`를 사용한다. 사용할 수 없으면 인증된 GitHub REST API 또는 웹 UI로 같은 내용을 생성한다. 토큰·쿠키·인증 헤더는 터미널 출력, 커밋, PR 본문, 이슈에 절대 남기지 않는다.

## 4. 이 저장소의 검증 게이트

변경 범위에 맞는 검증을 로컬에서 먼저 실행한다. TypeScript 변경은 최소한 아래 세 명령을 모두 실행한다.

```bash
npm run typecheck
npm run test:e2e
npm run test:gating
```

DB/RLS 변경은 아래도 실행한다.

```bash
cd supabase/tests
psql -U postgres -d <검증용-DB> -v ON_ERROR_STOP=1 -f rls_test.sql
```

UI 변경은 필요 시 웹 내보내기와 UI 회귀 스크립트를 추가한다.

```bash
npx expo export --platform web --output-dir dist-web
node scripts/persistence-test.mjs
node scripts/ui-cycles.mjs
```

### GitHub CI 필수 상태

현재 `.github/workflows/ci.yml`은 pull request와 `main` push에서 아래 상태를 제공한다.

- `typecheck`: `npm ci` 후 `npm run typecheck`
- `repository-tests`: `npm ci` 후 `npm run test:e2e`, `npm run test:gating`
- `rls-test`: PostgreSQL 16에서 `supabase/tests/rls_test.sql`

권장 branch protection(캡틴 또는 저장소 관리자만 설정):

1. `main` 직접 push 금지 및 PR 요구
2. 위 세 상태가 성공해야 병합 가능
3. 최신 `main`을 반영한 뒤에만 병합 가능
4. 최소 1명의 별도 리뷰어 승인 요구(구현자 자기 승인 금지)
5. 승인 후 새 push가 있으면 기존 승인 무효화
6. force push·branch deletion 제한, 관리자 우회도 필요한 경우에만 허용

이 문서는 권고만 한다. 저장소 settings 변경이나 `main` 병합은 캡틴 승인 없이는 수행하지 않는다.

## 5. PR 증거와 역할 분리

PR 본문에는 다음을 증거로 남긴다.

- 문제/변경 범위와 비범위
- 관련 커밋 및 최종 HEAD SHA
- 실행한 검증 명령과 결과(통과 수, 실패·미실행 사유 포함)
- UI·DB·보안 영향 및 롤백 방법
- 후속 작업이나 운영자 결정이 필요한 항목

구현자와 리뷰어는 분리한다. 구현자는 범위·테스트·위험을 정직하게 제출하고, 리뷰어는 요구사항 충족, 회귀, 보안·개인정보 노출, 테스트 타당성을 독립적으로 확인한다. 리뷰어가 재작업을 요청하면 구현자는 새 원자 커밋과 push로 대응하고 검증 증거를 갱신한다.

## 6. rebase, 충돌, rollback

- PR이 오래되었거나 병합 직전이면 `origin/main`을 fetch한 뒤 자신의 브랜치에서 rebase한다. 공유 브랜치의 이력 재작성은 리뷰어와 합의한 경우에만 한다.
  ```bash
  git fetch origin --prune
  git rebase origin/main
  ```
- 충돌은 충돌 파일·양쪽 의도를 확인하고 해결한다. 해결 뒤 `git diff --check`와 관련 테스트를 다시 실행한다. `--force-with-lease`가 꼭 필요한 개인 작업 브랜치 외에는 force push를 하지 않는다. 일반 `--force`는 금지한다.
- 잘못된 병합/배포는 공유 이력을 되돌리는 reset 대신 새 `revert` 커밋과 PR로 롤백한다. 긴급 복구도 최소 테스트와 리뷰 증거를 남긴다.

## 7. secrets·민감정보 금지

- `.env`, API 키, 토큰, 비밀번호, Supabase service-role key, 사용자/아이 건강정보 원문·스크린샷을 커밋하거나 PR/CI 로그에 올리지 않는다.
- 예제는 placeholder와 최소 권한의 테스트 데이터만 사용한다. `EXPO_PUBLIC_*` 값도 공개 가능한 값인지 확인한다.
- push 전 `git diff --cached`로 의도하지 않은 파일을 확인한다. 비밀값이 이미 노출되었다면 즉시 커밋을 추가하는 대신 해당 키를 폐기·교체하고 저장소 관리자에게 알린다.

## 8. 작업 종료 체크리스트

- [ ] `origin/main` SHA와 내 브랜치 HEAD SHA를 확인했다.
- [ ] worktree 상태가 의도한 변경만 포함한다.
- [ ] 원자 커밋과 검증 가능한 체크포인트를 원격에 push했다.
- [ ] PR 템플릿의 증거·위험·롤백 항목을 채웠다.
- [ ] 필수 CI 상태가 성공했거나 실패/대기 사유를 명시했다.
- [ ] 별도 리뷰어에게 리뷰를 요청했다.
- [ ] `main` 병합과 저장소 settings 변경은 캡틴 승인 전에는 수행하지 않았다.
