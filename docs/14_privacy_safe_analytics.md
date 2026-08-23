# 개인정보 최소수집 이벤트 계약 (P0 초안)

상태: 코드 계약·테스트 double만 구현됨. 외부 분석 SDK, 네트워크 전송, 운영 DB 적용은 하지 않는다.

## 범위와 경계

- 이벤트는 `src/services/analytics.ts`에서 검증한 뒤 `InMemoryAnalyticsSink`에만 적재한다.
- 원본 타임스탬프는 UTC ISO-8601로 저장하고, 보고일만 `kstDay()`로 KST(Asia/Seoul)에 투영한다.
- `event_id`는 같은 sink에서 exactly-once로 처리한다. 수신 순서(`received_at`)는 집계에 사용하지 않고 `occurred_at`과 `event_id`의 안정 정렬만 사용한다.
- 앱의 건강기록/사진/문서/브리핑 데이터나 Supabase 저장소와 연결하지 않는다. 운영 계측을 시작하려면 개인정보 검토와 별도 배포 승인이 필요하다.

## Envelope v1

필수 필드는 `event_name`, `event_version=1`, `event_id`, `occurred_at`, `received_at`, `user_id`, `care_circle_id`, `actor_role`, `platform`, `app_version`, `consent_analytics`, `properties`이다. `subject_id`와 `episode_id`는 해당 단위가 없으면 생략한다.

식별자는 원본 UUID·계정·대상자 ID를 사용하지 않고 ID 발급 경계가 만든 UUIDv4 형식의 opaque 값에 `evt_`, `usr_`, `cc_`, `sub_`, `ep_` 접두사만 붙인 값만 허용한다. 따라서 상세 DOB·전화번호·건강 원문·token을 접두사만 붙여 pseudonym처럼 위장할 수 없다. 동의는 runtime에서 정확히 `true`여야 하며, `truthy` 값은 이벤트 생성과 sink 직접 입력 모두에서 거부한다.

지원 이벤트와 최소 properties는 코드의 `EVENT_PROPERTIES`가 단일 진실 원천이다. 각 property는 코드의 `PROPERTY_SCHEMAS`에 정의한 작은 enum 또는 제한된 정수 범위만 허용하며, 이벤트별 allowlist의 필수 키를 빠짐없이 가져야 한다. 알 수 없는 이름·버전·property·중첩 객체·배열·자유 문자열은 fail-closed로 거부한다.

## 절대 수집 금지

다음은 key와 payload 모두에 넣지 않는다.

- 증상 자유 텍스트, 진단명, 약 이름, 사진·문서 원문, 브리핑 원문
- 실명, 이메일, 전화번호, 주소, 상세 생년월일
- 초대 링크 원문, 인증/초대 토큰, 비밀번호
- 병원/의료진 이름

허용하는 값은 기록 유형, 역할, 개수, 시간·기간 band처럼 재식별 위험을 낮춘 범주형 행동 데이터뿐이다. 외부 광고/분석 네트워크로의 전송은 금지한다.

## 결정론적 지표

- **collab activation:** circle 생성 뒤 7일 안에 대상 등록, 구조화 기록, 초대 생성·수락, 생성자와 다른 사용자의 기록 확인을 모두 만족한 고유 circle.
- **WCC:** KST 월요일 00:00을 UTC ISO-8601 `weekStart`로 전달한 반열린 구간 `[weekStart, weekStart + 7일)`에서 서로 다른 사용자 2명 이상, 유효 `record_created` 3개 이상, `record_acknowledged` 또는 `task_completed` 1개 이상을 만족한 고유 circle. 경계 시각은 다음 주에만 속해 주간 이중 집계를 막는다.
- **21일 episode:** `episode_started` 기준의 닫힌 구간 `[시작, 시작 + 21일]` 안의 `record_created`, 협업, 브리핑 생성, follow-up 배정, `episode_completed`의 고유 episode 수. 시작 전 이벤트는 포함하지 않는다. 취소는 `episode_cancelled`의 `episode_cancelled_reason`으로 별도 보고하며 완료 실패로 합치지 않는다.

public aggregate 입력도 `event_id`로 먼저 중복 제거하므로 sink 밖에서 합계를 재계산해도 한 이벤트가 두 번 세어지지 않는다. collab activation은 동일하게 circle 생성 시각부터 7일 뒤까지의 닫힌 구간 `[생성, 생성 + 7일]`만 사용한다.

`npm run test:analytics` fixture는 중복 event, 늦게 도착한 `received_at`, KST 자정 경계, 허용 목록 우회, activation/WCC/episode 재현을 검사한다.

## 보존·철회·롤백

운영 적재가 승인되는 경우에만, pseudonymous 이벤트를 최대 30일 보존하고 집계 결과만 보존기간 이후 유지한다. 테스트 sink의 `revokeConsent(userId)`는 해당 사용자의 pseudonymous 이벤트를 즉시 폐기하고, 이후 해당 user의 append를 거부한다. 운영 경로를 승인할 때도 같은 중단·삭제 계약을 삭제 대기열과 함께 구현해야 한다. 운영 승인 전에는 어떤 데이터도 적재하지 않는다.

롤백은 계측 호출을 연결하지 않았으므로 코드 배포 되돌리기와 sink 폐기로 충분하다. `supabase/schema_analytics_draft.sql`은 검토용 초안이며 설치 순서나 운영 migration에 포함되지 않는다.
