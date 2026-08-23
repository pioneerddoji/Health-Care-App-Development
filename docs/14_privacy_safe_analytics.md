# 개인정보 최소수집 이벤트 계약 (P0 초안)

상태: 코드 계약·테스트 double만 구현됨. 외부 분석 SDK, 네트워크 전송, 운영 DB 적용은 하지 않는다.

## 범위와 경계

- 이벤트는 `src/services/analytics.ts`에서 검증한 뒤 `InMemoryAnalyticsSink`에만 적재한다.
- 원본 타임스탬프는 UTC ISO-8601로 저장하고, 보고일만 `kstDay()`로 KST(Asia/Seoul)에 투영한다.
- `event_id`는 같은 sink에서 exactly-once로 처리한다. 수신 순서(`received_at`)는 집계에 사용하지 않고 `occurred_at`과 `event_id`의 안정 정렬만 사용한다.
- 앱의 건강기록/사진/문서/브리핑 데이터나 Supabase 저장소와 연결하지 않는다. 운영 계측을 시작하려면 개인정보 검토와 별도 배포 승인이 필요하다.

## Envelope v1

필수 필드는 `event_name`, `event_version=1`, `event_id`, `occurred_at`, `received_at`, `user_id`, `care_circle_id`, `actor_role`, `platform`, `app_version`, `consent_analytics`, `properties`이다. `subject_id`와 `episode_id`는 해당 단위가 없으면 생략한다.

식별자는 원본 UUID·계정·대상자 ID를 사용하지 않고 `evt_`, `usr_`, `cc_`, `sub_`, `ep_` 접두사 뒤의 pseudonymous 값만 허용한다. 동의가 `false`이면 이벤트 생성 자체가 실패한다.

지원 이벤트와 최소 properties는 코드의 `EVENT_PROPERTIES`가 단일 진실 원천이다. 모든 properties는 평면 scalar(문자열 64자 이하, finite number, boolean)이고 이벤트별 allowlist의 필수 키를 빠짐없이 가져야 한다. 알 수 없는 이름·버전·property·중첩 객체·배열은 fail-closed로 거부한다.

## 절대 수집 금지

다음은 key와 payload 모두에 넣지 않는다.

- 증상 자유 텍스트, 진단명, 약 이름, 사진·문서 원문, 브리핑 원문
- 실명, 이메일, 전화번호, 주소, 상세 생년월일
- 초대 링크 원문, 인증/초대 토큰, 비밀번호
- 병원/의료진 이름

허용하는 값은 기록 유형, 역할, 개수, 시간·기간 band처럼 재식별 위험을 낮춘 범주형 행동 데이터뿐이다. 외부 광고/분석 네트워크로의 전송은 금지한다.

## 결정론적 지표

- **collab activation:** circle 생성 뒤 7일 안에 대상 등록, 구조화 기록, 초대 생성·수락, 생성자와 다른 사용자의 기록 확인을 모두 만족한 고유 circle.
- **WCC:** 보고 주간에 서로 다른 사용자 2명 이상, 유효 `record_created` 3개 이상, `record_acknowledged` 또는 `task_completed` 1개 이상을 만족한 고유 circle.
- **21일 episode:** `episode_started` 기준 21일 안의 `record_created`, 협업, 브리핑 생성, follow-up 배정, `episode_completed`의 고유 episode 수. 취소는 `episode_cancelled`의 `episode_cancelled_reason`으로 별도 보고하며 완료 실패로 합치지 않는다.

`npm run test:analytics` fixture는 중복 event, 늦게 도착한 `received_at`, KST 자정 경계, 허용 목록 우회, activation/WCC/episode 재현을 검사한다.

## 보존·철회·롤백

운영 적재가 승인되는 경우에만, pseudonymous 이벤트를 최대 30일 보존하고 집계 결과만 보존기간 이후 유지한다. 분석 동의 철회·계정/대상자 삭제가 확인되면 새 이벤트를 즉시 중단하고 해당 pseudonymous 이벤트를 삭제 대기열에 넣는다. 이 동작은 현재 구현되지 않았고 운영 승인 전에는 어떤 데이터도 적재하지 않는다.

롤백은 계측 호출을 연결하지 않았으므로 코드 배포 되돌리기와 sink 폐기로 충분하다. `supabase/schema_analytics_draft.sql`은 검토용 초안이며 설치 순서나 운영 migration에 포함되지 않는다.
