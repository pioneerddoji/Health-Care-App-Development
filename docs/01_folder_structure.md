# 1. 폴더 구조

React Native + Expo + TypeScript 기준. 화면(screens) / 도메인 로직(services) / 순수 데이터 모델(types)을 분리해,
백엔드(Supabase)를 붙이기 전에도 샘플 데이터로 전체 플로우가 동작하도록 구성한다.

```
kidcare/
├── app.json                  # Expo 앱 설정 (이름, 스킴, 권한)
├── package.json
├── tsconfig.json
├── babel.config.js
├── .env.example              # SUPABASE_URL / SUPABASE_ANON_KEY
├── App.tsx                   # 엔트리: Provider + 네비게이션
│
├── docs/                     # 설계 문서 (본 문서들)
│
├── supabase/
│   ├── schema.sql            # PostgreSQL 스키마 + RLS 정책
│   └── seed.sql              # 샘플 데이터 시드
│
└── src/
    ├── types/
    │   └── index.ts          # Child, DailyRecord, Vaccination 등 전 도메인 타입
    │
    ├── constants/
    │   ├── categories.ts     # 건강관리 영역 14종 정의
    │   └── recordTypes.ts    # 일자별 기록 유형 12종 정의
    │
    ├── lib/
    │   ├── supabase.ts       # Supabase 클라이언트 (env 없으면 mock 모드)
    │   └── date.ts           # 날짜 유틸 (기간 계산, 포맷)
    │
    ├── data/
    │   └── sample.ts         # 인앱 샘플 데이터 (아이 2명 + 14일 기록)
    │
    ├── context/
    │   └── AppContext.tsx    # 앱 상태 (선택된 아이, 기록 CRUD) — MVP는 인메모리
    │
    ├── services/             # 백엔드 호출 계층 (화면은 이 계층만 사용)
    │   ├── auth.ts           # 회원가입/로그인/동의
    │   ├── children.ts       # 아이 프로필 CRUD, 보호자 공동관리
    │   ├── records.ts        # 일자별 기록 CRUD, 기간 조회, 통계 집계
    │   ├── growth.ts         # 키/체중/BMI 계산·조회
    │   ├── vaccinations.ts   # 예방접종/건강검진
    │   ├── share.ts          # 만료형 공유 링크
    │   └── reportPdf.ts      # 병원 제출용 PDF 생성 (expo-print)
    │
    ├── components/
    │   ├── ui.tsx            # Button, Card, Chip, Section 등 공용 컴포넌트
    │   └── charts/
    │       ├── svg.ts        # 차트 SVG 문자열 생성 (앱/PDF 공용 순수 함수)
    │       └── Charts.tsx    # LineChart, BarChart, Timeline (react-native-svg)
    │
    ├── navigation/
    │   └── index.tsx         # 스택 + 하단 탭 구성
    │
    └── screens/
        ├── auth/             # Login, SignUp, Consent(동의)
        ├── children/         # ChildList(홈), ChildForm, ChildProfile
        ├── records/          # DayRecords(일자별), RecordForm
        ├── dashboard/        # Dashboard(그래프), Calendar
        ├── report/           # Report(기간 선택 → PDF)
        ├── vaccination/      # Vaccination(접종/검진)
        └── settings/         # Settings(권한/공유/삭제)
```

## 설계 원칙
- **화면 → context/services → (mock | Supabase)**: 화면 코드는 저장소 구현을 모른다.
  MVP는 `AppContext`의 인메모리 저장으로 즉시 동작하고, 이후 services 내부만 Supabase 호출로 교체한다.
- **차트 이원화 방지**: 차트의 기하 계산은 `charts/svg.ts` 순수 함수로 두고,
  앱 화면(react-native-svg)과 PDF(HTML 내 inline SVG)가 같은 함수를 공유한다.
- **의료행위 금지 가드**: 진단/용량 추천 문구가 나올 수 있는 위치(레포트, 요약)는
  고정 디스클레이머를 강제 삽입한다 (`reportPdf.ts`).
