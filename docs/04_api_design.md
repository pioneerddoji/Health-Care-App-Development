# 4. API / 함수 설계

Supabase 클라이언트를 직접 화면에서 쓰지 않고 `src/services/*` 계층을 통해서만 접근한다.
MVP는 동일 시그니처의 인메모리 구현(AppContext)으로 동작하고, 이후 내부만 Supabase 호출로 교체한다.

> **실제 구현 메모**: 아래 함수들은 실제로는 파일별이 아니라 하나의 `Repo` 인터페이스
> (`src/services/repo.ts`)로 묶여 있고, `memoryRepo.ts`(데모)/`supabaseRepo.ts`(실서버)
> 두 구현이 env 유무로 자동 전환된다. `AppContext`가 이 인터페이스를 캐싱해 화면에 제공한다.
> 순수 계산 함수(집계, PDF HTML 생성)만 별도 파일(`records.ts`, `reportHtml.ts`)로 분리했다.

## auth.ts
```ts
signUp(email, password, profile: {name, relationship, phone?}): Promise<Session>
signIn(email, password): Promise<Session>
signOut(): Promise<void>
grantConsent(childId, type: 'guardian_legal'|'sensitive_health'|'share'): Promise<Consent>
revokeConsent(consentId): Promise<void>          // 회수 시 기록 입력 차단(RLS)
```

## children.ts
```ts
listChildren(): Promise<Child[]>                  // guardian_child 조인, 다자녀
createChild(input: ChildInput): Promise<Child>    // 트랜잭션: children + guardian_child(owner)
updateChild(id, patch: Partial<ChildInput>): Promise<Child>
deleteChildAndData(id): Promise<void>             // owner 전용, cascade 완전 삭제
inviteGuardian(childId, email, role: 'editor'|'viewer'): Promise<void>
updateGuardianRole(childId, guardianId, role): Promise<void>
removeGuardian(childId, guardianId): Promise<void>
```

## records.ts
```ts
listRecords(childId, from: ISODate, to: ISODate, type?: RecordType): Promise<DailyRecord[]>
createRecord(childId, input: RecordInput): Promise<DailyRecord>
updateRecord(id, patch): Promise<DailyRecord>
deleteRecord(id): Promise<void>
attachFile(recordId, localUri): Promise<RecordFile>   // Storage 업로드 후 record_files 삽입

// 대시보드용 집계 (클라이언트 집계 — MVP 데이터량에서 충분)
aggregateTemperature(records): {date, time, value}[]
aggregateSleep(records): {date, totalHours, wakings}[]
aggregateMeals(records): {date, mealScore, waterMl}[]
aggregateExcretion(records): {date, stool, urine, loose}[]
symptomTimeline(records): {date, symptom, severity}[]
suggestCategories(type, payload): CategorySlug[]      // 기록 유형 → 영역 태그 자동 제안
```

## growth.ts
```ts
listGrowth(childId): Promise<GrowthMeasurement[]>
addGrowth(childId, {measuredOn, heightCm?, weightKg?, headCm?}): Promise<GrowthMeasurement>
computeBmi(heightCm, weightKg): number
```

## vaccinations.ts
```ts
listVaccinations(childId): Promise<Vaccination[]>
addVaccination(childId, input): Promise<Vaccination>   // 수동 입력
markDone(id, {doneDate, hospital?, adverseReaction?}): Promise<Vaccination>
listCheckups(childId) / addCheckup(childId, input)
// addVaccination/addCheckup에 dueDate가 있으면 AppContext가 자동으로
// reminders.scheduleDueDateReminder를 호출한다 (아래 참조). checkup의
// "완료 처리" UI는 로드맵 5단계로 미룸(현재 vaccination에만 있음).
```

## reminders.ts
```ts
scheduleDueDateReminder({id, title, body, dueDate, daysBefore=1}): Promise<void>
// expo-notifications 로컬 알림. id는 'vacc-<uuid>' | 'checkup-<uuid>' 로 고정해
// 재예약(취소 후 재등록) 및 완료 시 취소가 가능하게 한다. 권한 거부/웹 환경은 조용히 스킵.
cancelReminder(id): Promise<void>
```

## share.ts (레포트 발행 + 만료형 공유 링크)
```ts
publishReport({childId, localPdfUri, periodStart, periodEnd, questionsForDoctor}): Promise<Report>
// Storage 'reports' 버킷 child_id/report_id.pdf 로 업로드 + reports 행 생성

createShareLink(reportId, expiresInHours): Promise<ShareLinkInfo>
// share_links 행 생성. url = `${SUPABASE_URL}/functions/v1/share-report?token=<token>`
// (원본 파일 서명 URL을 직접 주지 않는다 — 아래 이유 참조)

listShareLinks(childId): Promise<ShareLinkInfo[]>   // owner/editor만 조회 가능(RLS)
revokeShareLink(linkId): Promise<void>              // revoked_at 기록
```

**왜 DB RPC가 아니라 Edge Function인가**: Storage 서명 URL은 한 번 발급하면 되돌릴
수 없다. "지금 회수" 버튼이 실제로 접근을 끊으려면, 수신자가 링크를 열 때마다
서버(`supabase/functions/share-report`)가 `expires_at`/`revoked_at`을 재검사한
뒤 그때그때 5분짜리 서명 URL을 새로 발급해야 한다. 배포 시
`--no-verify-jwt` 필수(수신자는 로그인 세션이 없음).

## reportPdf.ts / reportHtml.ts
```ts
buildReportHtml(input: ReportInput): string          // reportHtml.ts — 순수 함수, 테스트 용이
// ReportInput = { child, records, growth, medications, vaccinations,
//                 periodStart, periodEnd, questionsForDoctor[], guardianName }
// 구성: ①1페이지 요약 ②체온/수면/식사/배변 그래프(inline SVG)
//       ③증상 타임라인 ④기간별 상세 기록 ⑤복용약 ⑥알레르기/기저질환
//       ⑦사진 ⑧의사에게 질문 ⑨고정 디스클레이머(진단 아님)

generateReportPdf(input): Promise<{ uri: string }>   // reportPdf.ts — expo-print, 사진은 base64 임베드
shareReportPdf(uri): Promise<void>                   // expo-sharing (기기 공유 시트로 바로 전달)
```

## 오류/정책 공통 규칙
- 모든 쓰기 함수는 RLS 위반 시 `PermissionError`로 매핑해 화면에서 "권한이 없습니다" 안내.
- `sensitive_health` 동의가 없으면 기록 계열 쓰기 함수가 사전 차단 + 동의 화면으로 유도.
- AI 보조(후순위)는 `suggestCategories`, 자연어 메모 → payload 초안, 레포트 요약문까지만.
  진단명 추정·용량 계산·수진 필요성 판단 함수는 만들지 않는다.
