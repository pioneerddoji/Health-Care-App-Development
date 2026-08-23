# P0 권한·삭제·내보내기 신뢰 게이트 감사

기준: Draft PR #12 승인 head `efdfbfe3370134e54ba9efe396ffb4f3d74dc625` 위의 `fix/p0-trust-control-gaps` 변경. 이 문서는 내부 제품·엔지니어링 대조표이며, 운영 migration·실사용자 삭제·외부 보안 검토·참여자 테스트·비용 집행은 범위 밖이다.

| 통제 목표 | UI / 클라이언트 | 서버 계약 | 고정 검증 | 결론 |
| --- | --- | --- | --- | --- |
| 공동 관리 공유 범위 사전 확인 | 초대 직전 범위 확인: 건강 기록·사진·레포트·전달 상태와 editor/viewer 차이를 표시한다. | `invite_guardian`은 owner만, 가입된 계정만, editor/viewer만 허용한다. | `rls_test.sql`: 비소유자·미가입·owner 초대 차단. | 충족 |
| owner/member 권한 및 stale authorization | UI는 owner만 관리 동작을 노출한다. | RLS와 `invite_guardian`/`set_guardian_role`이 직접 삽입·자기승격을 막는다. | viewer 강등 뒤 쓰기 차단, 외부인 격리, author/creator 위조 차단. | 충족 |
| 초대 해제 | owner 확인 후 해제한다. | `guardian_child` 삭제 정책이 owner의 타인 제거 또는 비-owner의 자기 나가기만 허용한다. | owner 제거/self-leave 뒤 발행자의 공유 링크 소비 차단. | 충족 |
| 단일 owner와 소유권 이전 | editor에게만, 영향(현재 owner는 editor·새 owner만 관리/삭제 가능)을 확인한 뒤 이전한다. | `transfer_guardian_ownership`은 owner→기존 editor만 허용하고 advisory lock 아래 두 역할을 원자 전환한다. | editor 호출 차단, 이전/되돌림 모두 owner 정확히 1명 검증. | 이번 변경으로 해소 |
| 내보내기 scope/authorization/expiry | 레포트 기간을 화면에 표시하고 활성 링크만 생성한다. | hash-only bearer token, 고정 24/72/168h TTL, issuer 현재 권한·동의·대상자 삭제를 소비 시 재검사한다. | token 변조/만료/회수/삭제/동의 철회/replay는 404 또는 RPC null로 fail-closed. | 충족 |
| 회수 뒤 재사용 | 설정에서 확인 후 회수한다. | `revoke_secure_share_link`; guardian 관계 삭제·동의 철회·계정 삭제가 발행 링크를 회수한다. | owner 제거, self-leave, 계정 삭제, 동의 철회 회귀. | 충족 |
| 다른 care circle 유출 | 선택된 대상자 기준으로만 guardian/link 목록을 읽는다. | RLS가 `my_role(child_id)`를 요구하고 links/reports가 대상자 관계를 join한다. | 외부인 C 완전 차단, viewer link metadata 비공개. | 충족 |
| 대상자 삭제 | owner 전용 경고 후 서버 작업 성공 시에만 Context 캐시를 지운다. | Storage prefix 삭제 후 `children` cascade; owner RLS를 재확인한다. | E2E 5 cycle cascade/baseline 복귀, RLS owner-only 삭제. | 충족 |
| 계정 삭제 dry-run/re-auth/partial/retry | 확인 문구 + 이메일 비밀번호/연결 소셜 재인증 + 오류 접근성 포커스. 완료 응답 전에는 성공 표시/세션 삭제를 하지 않는다. | `request_account_deletion(true)`은 job 없이 계획만 반환; 10분 reauth claim, idempotent lease job, partial 상태와 재시도를 강제한다. | stale/타 계정 claim 차단, dry-run no-job, partial/processing은 세션 유지. | 충족 (dry-run은 스테이징 운영 절차에서 호출) |

## 공격 회귀의 fail-closed 원칙

- UI의 owner/editor 표시나 메모리 상태는 권한 원천이 아니다. 서버 RPC/RLS가 매 mutation과 공유 token 소비 시점에 다시 판단한다.
- 링크는 발급 응답에서만 원문을 반환한다. DB에는 SHA-256 hash만 저장하며, 만료·회수·동의철회·발행자 관계 제거는 같은 최소 실패 응답으로 합친다.
- 계정 삭제와 child 삭제는 파일/관계형 데이터/Auth 단계가 부분 실패할 수 있다고 모델링한다. `completed` 서버 계약 전에는 클라이언트가 세션·캐시를 지우거나 성공을 표시하지 않는다.

## 운영 전 게이트 (실행 금지)

1. fresh PostgreSQL 16에서 `supabase/tests/rls_test.sql`의 `expected=181` completion marker와 FAIL 0을 재현한다.
2. 격리된 스테이징 계정으로 Edge Function dry-run 및 실제 partial/retry를 검증한다.
3. 운영 Supabase migration, production/store 배포, 실제 OAuth·결제, 비밀키/DNS/비용 변경, main 병합은 별도 승인 카드에서만 수행한다.
