-- 전연령 확대 — schema.sql → schema_stage3.sql → schema_subscriptions.sql →
-- schema_settings.sql 다음에 실행한다. (docs/08 확장 순서 ①③)
--
-- 배경: 등록 대상자를 아이에서 가족 전체(성인 포함)로 확대한다. 테이블·컬럼의
-- `children`/`child_id` 명칭은 유지한다 — 일괄 개명은 FK·정책·Storage 경로까지
-- 번지는 마이그레이션이라 비용 대비 실익이 없다(docs/08 규칙 1: 개명은 백로그).
-- 의미만 "관리 대상자(care recipient)"로 확장한다.
--
-- ⚠️ 불변: 건강정보 기록의 RLS 게이트는 여전히 `sensitive_health` 동의 하나다.
-- 대상자 유형이 늘어도 이 게이트를 우회하는 경로를 만들지 않는다.

-- ── 대상자 유형 ──────────────────────────────────────────────
-- 기존 행은 전부 아이였으므로 default 'child'가 그대로 정답이다.
alter table children
  add column if not exists recipient_type text not null default 'child'
    check (recipient_type in ('child', 'adult'));

-- 성인 대상자가 계정 소유자 본인인지 — 동의 경로를 가른다
-- (본인 = 본인 동의로 충분 / 타인 = 위임 동의 확인 필요)
alter table children
  add column if not exists is_self boolean not null default false;

-- ── 동의 유형 확장 ───────────────────────────────────────────
-- 성인 대상자를 대신 기록할 때의 위임 동의(adult_delegated)를 추가한다.
alter table consents drop constraint if exists consents_type_check;
alter table consents add constraint consents_type_check
  check (type in ('guardian_legal', 'sensitive_health', 'adult_delegated', 'share'));

-- 참고: has_sensitive_consent()는 변경하지 않는다. 아이든 성인이든
-- sensitive_health 동의가 유효해야만 기록이 들어간다(기존 정책 그대로).
