# 2. DB 스키마 (Supabase PostgreSQL)

실행 가능한 전체 DDL은 `supabase/schema.sql`, 샘플 시드는 `supabase/seed.sql` 참조.

## ERD 개요

```
auth.users ─1:1─ profiles(보호자)
profiles ─N:M─ children        (guardian_child: role = owner/editor/viewer)
children ─1:N─ daily_records   (일자별 기록, 유형별 payload JSONB)
children ─1:N─ growth_measurements (키/체중 → BMI)
children ─1:N─ medications     (복용약)
children ─1:N─ vaccinations    (예방접종)
children ─1:N─ checkups        (건강검진)
children ─1:N─ consents        (법정대리인/민감정보 동의)
children ─1:N─ reports         (발행된 PDF 메타)
reports  ─1:N─ share_links     (만료형 공유 링크)
daily_records ─1:N─ record_files (사진/파일, Supabase Storage 경로)
```

## 테이블 요약

| 테이블 | 핵심 컬럼 | 비고 |
|---|---|---|
| `profiles` | id(=auth.users.id), name, phone, relationship | 보호자 |
| `children` | name, nickname, birth_date, sex, birth_weight_g, birth_height_cm, gestational_weeks, is_preterm, blood_type, allergies[], chronic_conditions[], surgeries jsonb, primary_doctor, primary_hospital | 알레르기/기저질환 포함. **아이 얼굴 사진은 저장하지 않는다**(식별 정보 최소화 — 프로필은 이모지 아바타만 사용) |
| `guardian_child` | guardian_id, child_id, role, invited_by | 다자녀·공동관리의 축 |
| `consents` | child_id, guardian_id, type(guardian_legal/sensitive_health/share), granted_at, revoked_at | 만14세 미만 법정대리인 동의 + 민감정보 별도 동의 |
| `daily_records` | child_id, record_date, record_time, type, categories[], payload jsonb, memo, author_id | 유형별 세부값은 payload |
| `record_files` | record_id, storage_path, mime_type | Storage 버킷 `record-files` |
| `growth_measurements` | child_id, measured_on, height_cm, weight_kg, head_cm, bmi(생성 컬럼) | 성장 그래프 원천 |
| `medications` | child_id, name, dose_text, schedule_text, start/end_date, prescriber, is_active | **용량은 자유 텍스트** — 앱이 계산·추천하지 않음 |
| `vaccinations` | child_id, vaccine_name, dose_no, due_date, done_date, hospital, adverse_reaction | 수동 입력 |
| `checkups` | child_id, checkup_name, due_date, done_date, hospital, result_summary | 영유아검진 등 |
| `reports` | child_id, period_start, period_end, questions_for_doctor, storage_path | PDF 산출물 |
| `share_links` | report_id, token, expires_at, revoked_at | 만료·회수 가능 |

## `daily_records.type` (12종) 과 payload 규약

| type | payload 예시 |
|---|---|
| `condition` 컨디션 | `{"level": 1~5, "mood": "보통"}` |
| `behavior` 행동 | `{"note": "낮에 유난히 보챔"}` |
| `meal` 식사 | `{"mealType":"아침/점심/저녁/간식/수유", "amount":"전량/절반/거의안먹음", "items":["죽"], "waterMl":120}` |
| `sleep` 수면 | `{"sleepStart":"21:10","sleepEnd":"07:20","nightWakings":2,"quality":1~5}` |
| `excretion` 배변/배뇨 | `{"kind":"소변/대변","count":1,"stoolForm":"보통/묽음/딱딱","color":"노란색"}` |
| `activity` 운동/놀이 | `{"activity":"실외 놀이터","durationMin":40,"intensity":"보통"}` |
| `symptom` 증상 | `{"symptom":"발열","temperatureC":38.2,"bodyPart":"","severity":1~5}` |
| `medication_dose` 약 복용 | `{"medicationName":"해열제(처방)","givenAt":"14:00","doseText":"처방 용량"}` |
| `incident` 사고/안전 | `{"what":"침대에서 낙상","severity":"경미","action":"냉찜질"}` |
| `media_use` 미디어 | `{"durationMin":30,"content":"동요 영상"}` |
| `school` 학교/기관 | `{"attended":true,"note":"어린이집 정상 등원"}` |
| `note` 기타 메모 | `{"note":"..."}` |

payload 키는 앱 코드와 동일한 **camelCase**로 저장한다(JSONB이므로 스키마 제약 없음).
`categories`는 건강관리 영역 14종 슬러그 배열(`docs/03` 참조). 기록 유형에서 기본값을 자동 매핑하되 보호자가 수정 가능.

## RLS(행 수준 보안) 정책 요약
- 모든 아이 데이터 테이블: `guardian_child`에 (본인, 해당 child) 행이 있어야 SELECT.
- INSERT/UPDATE/DELETE: role이 `owner` 또는 `editor`인 경우만. `viewer`는 읽기 전용.
- `consents`: 본인이 당사자인 행만 기록 가능. **`sensitive_health` 동의가 유효(granted & not revoked)하지 않으면 `daily_records`/`growth_measurements` INSERT를 차단**하는 정책 포함.
- `share_links`: 비로그인 수신자의 실제 접근은 Edge Function이 담당 (아래 "4단계 추가" 참조) — RLS는 앱 내(owner/editor) 관리 화면만 보호한다.
- 삭제권: `owner`만 아이 및 하위 데이터 일괄 삭제 가능 (`on delete cascade`).

### 3단계 추가 (`schema_stage3.sql`)
- `guardian_child` 정책 세분화: 삽입은 (아이 생성 직후 본인 owner 부트스트랩) 또는
  (owner의 추가)만, 수정은 owner가 타인 행을 `editor/viewer`로만(자기승격 차단),
  삭제는 owner의 타인 제거 또는 editor/viewer 본인 나가기.
- `profiles`: 같은 아이를 공동 관리하는 보호자끼리 이름/관계 열람 허용(`is_co_guardian`).
- `invite_guardian(cid, email, role)` RPC(definer): owner 검증 → auth.users에서
  이메일→uid 해석 → guardian_child upsert. 미가입 이메일은 오류로 가입 안내.

### P0 무결성 강화 (`schema_security.sql`)
- 적용 순서는 `schema.sql` → stage3 → subscriptions → settings → recipients → security다.
  기존 데이터는 수정하지 않으며, 새 대상자 생성만 `create_recipient(jsonb)` 단일
  `SECURITY DEFINER` 트랜잭션으로 제한한다.
- 이 RPC는 대상자·최초 owner·만 나이 기준 필수 동의(법정대리/본인/성인 위임 +
  `sensitive_health`)를 함께 생성하고, 구독 한도 실패 시 전체를 롤백한다.
- `guardian_child`의 직접 INSERT/UPDATE를 폐기하고 `invite_guardian`/
  `set_guardian_role` RPC로 초대·역할 변경을 강제한다. owner 승격·자기 초대는 불가다.
- `daily_records.author_id`, `reports.created_by`는 INSERT 시 `auth.uid()`와 일치해야
  하며 이후 수정도 trigger가 거부한다. 적용·검증·비상 롤백은
  `docs/11_rls_data_integrity.md`를 단일 기준으로 따른다.

### P0 동의 증빙·계정 탈퇴 (`schema_consent_deletion.sql`)
- `consent_documents`와 recipient/account evidence 테이블은 문서 버전·항목 snapshot·시각·주체를 서버에서 append-only로 보관한다. raw `consents` 쓰기는 RPC로 대체한다.
- `request_account_deletion(dry_run)`은 최근 재인증 custom JWT claim을 검증하고 멱등 job만 생성한다. Storage·공유 토큰·Auth 파기는 `delete-account` Edge Function이 정해진 순서로 수행한다.
- 적용·재인증 claim·공동 데이터 소유권·partial retry·롤백 기준은 `docs/12_consent_account_deletion.md`를 단일 기준으로 따른다.

### 4단계 추가 — 레포트 발행 · 만료형 공유 링크
- `reports`: owner/editor만 발행(`select` 자체는 viewer도 가능해 앱 내 열람은 허용).
  PDF는 Storage `reports` 버킷 `child_id/report_id.pdf` 경로에 업로드.
- `share_links`: 원문 token을 저장하지 않고 SHA-256 hash만 저장한다. 발행은
  `create_secure_share_link(report_id, ttl)` RPC만 가능하며, owner/editor·대상 아이의
  유효 민감정보 동의를 서버에서 재확인한다. viewer는 목록·발행·회수 모두 불가하고,
  회수는 `revoke_secure_share_link(link_id)` RPC만 가능하다.
- **비로그인 수신자용 실제 접근 경로는 DB 함수가 아니라 Edge Function**
  (`supabase/functions/share-report`)이다. 이유: Storage 서명 URL은 한 번 발급하면
  회수할 수 없으므로, "지금 회수" 버튼이 실제로 접근을 끊으려면 매 요청마다
  서버에서 `expires_at`/`revoked_at`/대상 아이 삭제를 원자적으로 재검사한 뒤
  **그때그때 짧은 수명(5분)의 서명 URL을 새로 발급**해야 한다. Edge Function은
  token hash만 전달하고, 동시 replay를 행 잠금+1초 rate limit으로 차단한다. 결과는
  존재 여부를 구별하지 않는 404로 최소화하며 원문 token·IP·User-Agent는 보존하지
  않는다. `share_link_access_audit`에는 link id·결과·시각만 최소 기록한다.
  배포: `supabase functions deploy share-report --no-verify-jwt`
  (수신자는 로그인 세션이 없으므로 JWT 검증을 꺼야 한다).
- 공유 URL 형태: `{SUPABASE_URL}/functions/v1/share-report?token=<발행 응답의 일회성 원문 token>`
  (목록에서 token을 다시 조회하거나 재구성할 수 없다).
