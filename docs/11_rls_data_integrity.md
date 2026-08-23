# P0 공동관리 RLS·대상자 생성 데이터 무결성 마이그레이션

## 목적

`guardian_child`를 직접 조작해 권한을 올리거나, 대상자 생성 중 일부 단계만 성공해
고아 `children`/동의 누락 행이 생기는 경로를 제거한다. 기록·레포트의 작성자 감사
필드도 현재 로그인한 보호자(`auth.uid()`)로 고정한다.

이 문서는 `supabase/schema_security.sql`의 배포·롤백 기준이다. 운영 DB 적용은
이 작업의 범위가 아니며, 반드시 스테이징에서 RLS 테스트를 통과시킨 뒤 별도 승인으로
진행한다.

## 적용 순서

새 환경:

```sql
\i supabase/schema.sql
\i supabase/schema_stage3.sql
\i supabase/schema_subscriptions.sql
\i supabase/schema_settings.sql
\i supabase/schema_recipients.sql
\i supabase/schema_security.sql
```

기존 환경은 앞선 다섯 스키마가 이미 적용되어 있는지 확인한 뒤
`schema_security.sql`만 적용한다. 이 파일은 정책·함수·트리거를 `drop ... if exists` /
`create or replace`로 전환하며 기존 대상자, 보호자 관계, 동의, 기록, 레포트 데이터는
변경하거나 삭제하지 않는다.

앱 배포 순서는 DB 마이그레이션을 먼저 적용하고, 그 다음
`src/services/supabaseRepo.ts`를 포함한 앱을 배포한다. 구버전 앱의 대상자 생성과 역할
변경은 마이그레이션 뒤 즉시 RLS 오류가 되므로 앱과 DB를 서로 다른 장시간 릴리스로
분리하지 않는다.

## 새 서버 경계

- `create_recipient(recipient jsonb)`는 대상자, caller의 최초 `owner`, 만 나이 기준
  필수 동의를 하나의 `SECURITY DEFINER` 트랜잭션으로 생성한다.
  - 19세 미만: `guardian_legal` + `sensitive_health`
  - 성인 본인: `sensitive_health`
  - 성인 타인: `adult_delegated` + `sensitive_health`
- 같은 보호자의 동시 생성은 advisory transaction lock으로 직렬화하고 구독 한도를
  확인한다. 한도·유효성 실패는 전체 트랜잭션을 롤백하므로 고아 대상자가 남지 않는다.
- 동일 `id` 재호출은 해당 caller가 이미 owner인 완성된 대상자에만 멱등 성공으로
  처리한다. 일반 앱은 `id`를 보내지 않고 DB UUID를 사용한다.
- `invite_guardian`과 `set_guardian_role`만 공동 보호자 초대·역할 변경을 수행한다.
  재초대는 한도를 다시 소비하지 않으며, owner·본인·owner 역할 승격은 거부한다.
- RPC는 `authenticated`에만 `EXECUTE`를 부여하고 `public` 기본 권한을 제거한다.
  모든 definer 함수는 `search_path = public`으로 고정하고 매 요청 `auth.uid()`를
  검증한다.
- `daily_records.author_id`와 `reports.created_by`는 INSERT 시 `auth.uid()`와 일치해야
  한다. 이후 UPDATE trigger는 작성자 변경을 거부한다.

## 검증

로컬 PostgreSQL 16에서 다음을 실행한다.

```bash
cd supabase/tests
psql -U postgres -d <fresh_db> -v ON_ERROR_STOP=1 -f rls_test.sql
```

`rls_test.sql`은 기존 RLS 시나리오를 유지하면서 직접 대상자 생성, 직접 관계 삽입,
직접 역할 변경, 한도 실패 뒤 고아 행, 비소유자 초대, 기록/레포트 작성자 위조를
차단하는 공격 회귀 테스트를 추가한다.

앱 검증:

```bash
npm run typecheck
npm run test:e2e
npm run test:gating
npm run build:web
```

## 롤백 (비상 복구 전용)

롤백은 새 RPC 기반 앱을 먼저 중단하거나 이전 앱 버전을 다시 배포한 뒤 실행한다.
아래는 이전 직접 쓰기 정책을 복원하므로 **임시 호환 목적 외에는 사용하지 않는다**.
특히 이전 guardian-child 정책은 알려진 직접 INSERT/권한상승 취약점을 재도입한다.

```sql
-- audit protection and RPC removal
drop trigger if exists daily_records_protect_audit_columns on daily_records;
drop trigger if exists reports_protect_creator on reports;
drop function if exists protect_audit_columns();
drop function if exists protect_report_creator();
drop function if exists create_recipient(jsonb);
drop function if exists set_guardian_role(uuid, uuid, text);

-- invite_guardian은 이전 앱과 동일한 시그니처를 유지하므로, 강화된 구현을 그대로 둔다.
-- (schema_subscriptions.sql 전체를 재실행하면 create table이 충돌하므로 실행하지 않는다.)

-- restore preceding direct creation/role policies (known weaker behavior)
create policy "insert child" on children for insert with check (true);
create policy "bootstrap or owner insert" on guardian_child for insert
  with check (
    (guardian_id = auth.uid() and role = 'owner' and not child_has_guardians(child_id))
    or my_role(child_id) = 'owner'
  );
create policy "owner updates roles" on guardian_child for update
  using (my_role(child_id) = 'owner' and guardian_id <> auth.uid())
  with check (role in ('editor','viewer'));

drop policy if exists "write records as current guardian" on daily_records;
drop policy if exists "edit records without author rewrite" on daily_records;
create policy "write records" on daily_records for insert
  with check (my_role(child_id) in ('owner','editor') and has_sensitive_consent(child_id));
create policy "edit records" on daily_records for update
  using (my_role(child_id) in ('owner','editor'));

drop policy if exists "read reports" on reports;
drop policy if exists "publish reports as current guardian" on reports;
drop policy if exists "edit reports without creator rewrite" on reports;
drop policy if exists "delete reports" on reports;
create policy "reports rw" on reports for all using (my_role(child_id) is not null)
  with check (my_role(child_id) in ('owner','editor'));
```

롤백 후에는 이전 앱의 대상자 생성·역할 변경을 실기기에서 확인하고, 취약한 직접 쓰기
기간을 최소화하기 위해 원인 수정 버전을 재배포한다.

## 알려진 제약

- 이 마이그레이션은 Supabase 운영 프로젝트에 적용하지 않는다. 실제 Supabase의
  auth/storage 권한, Edge Function, 네트워크 재시도는 스테이징 프로젝트에서 별도로
  확인해야 한다.
- 성인 대상자 본인의 동의는 현재 보호자의 확인 기록(`adult_delegated`)이다. 독립적인
  성인 본인 인증/철회 요청 창구는 기존 백로그이며 이 마이그레이션이 대체하지 않는다.
- 소유권 이전은 비범위다. owner 행은 이 RPC들로 만들거나 변경할 수 없다.
