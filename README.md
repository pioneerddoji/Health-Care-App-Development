# 케어노트 (carenote) — 아이 건강 관리 앱

한국 보호자를 위한 **0–18세 소아청소년 건강 기록 앱**. 일자별 건강·행동·식사·수면·증상을
기록하고 → 건강관리 영역으로 분류 → 기간별로 시각화 → **병원 제출용 PDF 레포트**를 발행한다.

> 🤝 **개발을 이어받는 AI 에이전트/개발자는 [`AGENTS.md`](./AGENTS.md)부터 읽으세요**
> (불변 원칙 · 아키텍처 규칙 · 검증 절차 · 현재 상태 · 다음 작업).
> 시간순 진행 기록·결정 이유는 **[`docs/DEVLOG.md`](./docs/DEVLOG.md)** 에 있습니다.

## ⚠️ 제품 원칙 (불변)

- **진단/처방 앱이 아님**: 진단명 추정, 약 용량 추천, "병원 방문 불필요" 판단을 하지 않는다.
  레포트에는 "보호자 관찰 기록이며 의학적 소견이 아님" 고지가 항상 포함된다.
- **가입은 법정대리인 본인만**: 만 14세 미만 아동의 법정대리인(부모 등 보호자)만 가입.
  가입 직후 법정대리인 확인 + 건강정보(민감정보) 별도 동의를 받는다.
- **아이 얼굴 사진 미저장**: 프로필은 이모지 아바타만. 기록 첨부 사진은 얼굴 회피 안내.

## 현재 진행 상황 (2026-07 기준)

**기능 완성 (로드맵 0~7단계 + 사용자 피드백 1~3차 반영):**
- 회원가입/로그인(휴대폰 문자 인증 — 현재 데모 스텁), 법정대리인·민감정보 동의, 계정 찾기
- 아이 프로필 CRUD, 일자별 기록 12종 + 사진 첨부, 건강관리 영역 14종 자동 분류
- 시각화: 캘린더, 체온/수면/식사·수분/배변 그래프, 증상 타임라인, 성장 그래프
- 대시보드 그래프 **드래그로 순서 변경**(아이패드식), 기록 상세 팝업 + 사진 뷰어(스와이프)
- **병원 제출용 PDF 레포트**(큰 글자) + 만료형 공유 링크(Edge Function 재검사)
- 예방접종/검진 기록 + 로컬 알림, 보호자 공동 관리(owner/editor/viewer)
- 개인정보 보호: 동의 철회, 데이터 완전 삭제(Storage 포함), 개인정보처리방침
- **구독 3티어(무료/스탠다드/패밀리)** + 월간/연간 결제 + 얼리버드 가격 구조
- 결제 연동 준비 구조(추상화 계층 `billing.ts` + RevenueCat 웹훅 Edge Function 스텁)

**검증 체계:** 타입체크, 저장소 계층 E2E(110건), 구독 게이팅(27건), RLS 통합 테스트
(PostgreSQL 16, 44건), Playwright 웹 빌드 시나리오(영속화·UI 5사이클·드래그·페이월), GitHub Actions CI.

**다음 단계 (안드로이드 출시):** 상세 체크리스트는 [`docs/09_android_release.md`](./docs/09_android_release.md).
남은 결정 3건 — 번들 ID 확정 / 1차 무료 출시(기본값 준비됨) / 문자 인증 공급자.
그 외 Supabase 운영 프로젝트 실환경 검증, 개인정보처리방침 법률 검토가 선행 필요.

> 개인정보처리방침·이용약관은 **법률 검토 전 초안**, SMS·결제 SDK는 미연동 상태입니다.

## 실행 (혼자 먼저 써보기 — 서버 불필요)

> 🚀 5분 가이드: [`QUICKSTART.md`](./QUICKSTART.md) (휴대폰 Expo Go)

```bash
npm install
npm start          # Expo Go에서 QR 스캔
```

- 별도 설정 없이 **로컬 데모 모드**로 동작한다. `demo@carenote.app`로 로그인하면 샘플
  데이터(아이 2명 + 14일 기록)가 로드되고, 일반 가입은 빈 상태 + 무료 티어로 시작한다.
- 변경 사항은 **기기에 저장되어 앱을 재시작해도 유지**된다(자동 로그인).

## Supabase 연동 (선택)

`.env`에 아래를 설정하면 앱이 자동으로 Supabase 모드로 전환된다(`src/services/repo.ts`).

```
EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

1. [supabase.com](https://supabase.com) 프로젝트 생성
2. SQL Editor에서 `supabase/schema.sql` → `schema_stage3.sql` → `schema_subscriptions.sql` → `schema_settings.sql` → `schema_recipients.sql` 순서 실행
3. 공유 링크 Edge Function 배포: `supabase functions deploy share-report --no-verify-jwt --project-ref <ref>`
4. `SUPABASE_URL=... SUPABASE_ANON_KEY=... npm run verify:supabase`로 가입→기록→Storage→RLS→공유 링크→삭제 자동 검증

배포(EAS·스토어)는 [`docs/06_deployment.md`](./docs/06_deployment.md) / [`docs/09_android_release.md`](./docs/09_android_release.md),
구독·결제는 [`docs/07_monetization.md`](./docs/07_monetization.md) 참조.

## 핵심 구조

```
화면(src/screens) → AppContext(src/context) → Repo 인터페이스(src/services/repo.ts)
                                                ├─ memoryRepo.ts   (데모: AsyncStorage 영속)
                                                └─ supabaseRepo.ts (실서버: RLS/Storage)
```

- **차트 단일 코드 경로**: `src/components/charts/svg.ts`가 SVG 문자열을 생성 — 앱 화면(`SvgXml`)과
  PDF(HTML inline SVG)가 동일 함수를 공유.
- **보안 한도는 서버가 진실**: 동의 게이트·아이 수·공동 보호자 수를 RLS/트리거/RPC가 강제,
  mock은 같은 규칙을 미러링.
- **구독 게이팅**: 핵심 안전 기능(기록·그래프·PDF·알림·동의·삭제)은 전 티어 무료. 규모·편의만 차등.

## 기술 스택

React Native 0.81 · Expo SDK 54 · TypeScript · React Navigation 7 · react-native-svg ·
expo-print/sharing · Supabase (Auth/PostgreSQL/Storage/Edge Functions) · RevenueCat(예정)
