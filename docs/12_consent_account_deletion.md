# P0 서버 동의 증빙·완전 탈퇴 계약

## 범위와 운영 금지

이 문서는 `supabase/schema_consent_deletion.sql` 및
`supabase/functions/delete-account`의 서버 계약입니다. 이 변경은 **운영 migration,
실사용자 삭제, 비밀키 설정, main 병합을 수행하지 않습니다.** 먼저 fresh PostgreSQL 16과
스테이징 Supabase에서 검증하고 캡틴 승인 후에만 적용합니다.

새 환경 적용 순서:

```sql
\i supabase/schema.sql
\i supabase/schema_stage3.sql
\i supabase/schema_subscriptions.sql
\i supabase/schema_settings.sql
\i supabase/schema_recipients.sql
\i supabase/schema_security.sql
\i supabase/schema_consent_deletion.sql
```

기존 환경은 이전 여섯 스키마 적용을 확인한 뒤 마지막 파일만 적용합니다. 기존
`consents` 중 서버에 존재하는 문서 버전은 `granted_at`을 유지해 증빙으로 한 번 이관합니다.
문서 버전을 확인할 수 없는 과거 행은 증빙을 만들어내지 않으므로 운영자가 별도 검토합니다.

## 동의 증빙 계약

- `consent_documents`는 문서 scope/type/version과 당시 항목 배열의 원본입니다. 같은
  문서를 수정하지 말고 새 version을 INSERT합니다.
- `recipient_consent_evidence`와 `account_consent_evidence`는 계정이 존재하는 동안 문서
  버전, 항목 snapshot, 수락 시각, 주체 역할을 보관하는 append-only 테이블입니다. 클라이언트
  직접 INSERT/UPDATE는 RLS로 불가하며, 완전 탈퇴 때만 계정 데이터와 함께 cascade 파기합니다.
- 대상자 동의는 다음 authenticated RPC만 사용합니다.
  - `record_recipient_consent(cid, consent_type, document_version, subject_role)`
  - `revoke_recipient_consent(cid, consent_type)`
- 계정 약관 동의는 `record_account_consent(consent_type, document_version, 'self')`만
  사용합니다.
- `consents` 직접 INSERT/UPDATE 정책은 제거됩니다. 클라이언트 UI/저장소 호출 변경은
  별도 UI 작업에서 이 RPC 계약으로 동시에 배포해야 합니다.
- 대상자 생성 RPC가 삽입하는 필수 동의도 trigger가 증빙으로 캡처합니다. 주체는 만 나이와
  `is_self` 기준으로 guardian/self/delegated_adult 중 하나로 서버가 계산합니다.

## 재인증 claim

탈퇴 요청은 Supabase의 인증된 access token 외에 다음 custom access-token claim을 요구합니다.

```json
{
  "sub": "현재 auth.uid()와 같은 UUID",
  "reauthenticated_at": "RFC3339 timestamp, 서버 현재 시각 기준 10분 이내"
}
```

이 claim은 비밀번호 재입력 또는 OAuth provider 재인증이 성공한 경우에만 Auth custom access
-token hook이 발행해야 합니다. 단순 세션 갱신, 클라이언트 metadata, 사용자 입력에서 만들면
안 됩니다. SQL RPC는 `sub` 일치, 미래 1분 이내, 10분 TTL을 모두 검사합니다.

## `delete-account` Edge Function

배포 명령(스테이징에서만 먼저):

```bash
supabase functions deploy delete-account --project-ref <staging-ref>
```

이 함수는 `--no-verify-jwt`를 붙이지 않습니다. 호출은 인증된 사용자의 POST이며 body는 다음뿐입니다.

```json
{ "dry_run": true }
```

- `dry_run: true`: 재인증을 검사하고 삭제 순서와 파일/대상자 수만 반환합니다. DB job과 삭제는
  만들지 않습니다.
- 기본값/false: `request_account_deletion(false)`가 멱등 job을 만들거나 기존 활성 job을 반환합니다.
- job 단계는 `revoke_share_tokens → delete_storage → delete_relational_data → delete_auth`입니다.
  공유 token을 먼저 회수해 새 signed URL 발행을 즉시 중단하고, Storage를 제거한 뒤 Auth를 마지막에
  삭제합니다.
- owner인 대상자는 전체 대상자 데이터와 Storage를 삭제합니다. editor/viewer로 공동 관리하던
  대상자는 유지하지만 해당 계정이 작성한 records/reports와 파일은 삭제합니다. 이 규칙은 공동
  데이터의 소유권을 보존하는 동시에 `author_id`/`created_by` FK가 Auth 삭제를 막지 않게 합니다.
- job은 30분 lease로 원자적으로 claim되어 동시 실행/완료 뒤 상태 되돌림을 막습니다. 실패하면
  job은 `partial` 및 일반화된 오류 코드로 남아 같은 재인증 사용자가 재시도할 수 있습니다.
- 요청/처리/partial 상태에서는 새 record/report/share/Storage 쓰기를 RLS가 차단해 Edge
  Function의 snapshot과 경합하지 못하게 합니다.
  감사 행에는 이메일, UUID, 토큰, Storage path, 건강정보를 넣지 않습니다. 성공 후 `user_id`는
  NULL로 소거합니다.

필수 Edge secrets는 Supabase가 제공하는 `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`입니다. service role key를 앱 번들, git, 테스트 출력에 넣지 않습니다.

## 검증과 롤백

```bash
cd supabase/tests
psql -U postgres -d <fresh_pg16_db> -v ON_ERROR_STOP=1 -f rls_test.sql
# PASS 83/83, FAIL 0, RLS_SUITE_COMPLETE expected=83

npm run typecheck
npm run test:e2e
npm run test:gating
npm run build:web
```

스테이징에서는 A(owner)와 B(editor/viewer) 계정으로 dry-run, 실제 삭제용 격리 테스트 계정,
Storage/공유 링크 회수 순서, OAuth/이메일 재인증 claim, partial job 재시도를 확인합니다.

롤백은 Edge Function 트래픽을 먼저 중단하고 새 RPC를 호출하는 앱을 되돌린 뒤에만 검토합니다.
`recipient_consent_evidence`/`account_consent_evidence`는 증빙이므로 삭제하지 않습니다. raw
`consents` 쓰기 정책을 임시 복구하는 것은 증빙 우회를 재도입하므로 보안 책임자 승인 없이는 금지합니다.
