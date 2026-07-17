# 6. 배포 준비 가이드 (Supabase 연결 + 스토어 출시)

이 문서는 두 파트로 나뉜다: **A. 저장소에 이미 준비된 것** (바로 사용 가능),
**B. 계정 소유자가 직접 해야 하는 것** (계정/결제/심사 — 코드로 대신할 수 없음).

---

## A. 저장소에 준비된 것

| 항목 | 위치 | 상태 |
|---|---|---|
| DB 스키마 + RLS + Storage 정책 | `supabase/schema.sql` → `schema_stage3.sql` → `schema_subscriptions.sql` → `schema_settings.sql` | SQL Editor에서 순서대로 실행 |
| 공유 링크 Edge Function | `supabase/functions/share-report` | `deploy --no-verify-jwt`로 배포 |
| **연결 검증 스크립트** | `npm run verify:supabase` | 프로젝트 생성 직후 1회 실행 |
| RLS 회귀 테스트 (48건) | `supabase/tests/rls_test.sql` + GitHub Actions CI | push/PR마다 자동 |
| EAS 빌드 프로파일 | `eas.json` (development/preview/production) | 준비됨 |
| 앱 아이콘/스플래시 | `assets/` (icon, adaptive-icon, splash) | 임시 시안 — 교체 가능 |
| 개인정보처리방침 | `docs/privacy_policy.html` (호스팅용), 앱 내 화면 | **법률 검토 전 초안** |
| E2E 스모크 | `maestro/smoke.yaml` | 실기기에서 실행 |

## B. 계정 소유자 체크리스트 (순서대로)

### B-1. Supabase 운영 프로젝트 (약 30분)
1. [ ] supabase.com에서 프로젝트 생성 — **리전 선택 주의**: 한국 사용자 대상이면
   `ap-northeast-2 (서울)` 권장. 국외 리전 선택 시 개인정보처리방침 4조(국외 이전) 구체화 필요.
2. [ ] SQL Editor에서 `supabase/schema.sql` → `schema_stage3.sql` →
   `schema_subscriptions.sql` → `schema_settings.sql` 순서대로 실행
3. [ ] Supabase CLI 로그인 후 Edge Function 배포:
   ```bash
   supabase functions deploy share-report --no-verify-jwt --project-ref <ref>
   ```
4. [ ] (검증 동안만) Authentication → Email에서 *Confirm email* 끄기
5. [ ] 로컬에서 연결 검증 — **전부 PASS 확인**:
   ```bash
   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon> npm run verify:supabase
   ```
6. [ ] 운영 설정 되돌리기: Confirm email 켜기 + 커스텀 SMTP(가입 메일 발신자) 연결,
   테스트 계정(verify-*) 삭제, 백업(PITR) 활성화 검토(Pro 플랜)

### B-2. 앱 자산·식별자 확정 (첫 업로드 전 필수)
1. [ ] **번들 ID 확정** — 현재 `app.kidcare.mvp`는 자리표시. 소유한 도메인 역순으로
   변경(`app.json`의 `ios.bundleIdentifier`, `android.package`).
   **스토어 첫 업로드 후에는 변경 불가.**
2. [ ] 아이콘/스플래시 검토 — `assets/`의 임시 시안(🧸)을 그대로 쓰거나 디자인 교체
3. [ ] `docs/privacy_policy.html`을 실제 도메인에 호스팅(예: GitHub Pages, Vercel)
   → 스토어 등록 폼에 URL 입력. **법률 검토 필수**(민감정보+아동 — 일반 템플릿보다 엄격)

### B-3. EAS 빌드 → 내부 테스트 (반나절)
1. [ ] Expo 계정 + `npm i -g eas-cli` → `eas login`
2. [ ] `eas init` (projectId가 app.json에 자동 추가됨)
3. [ ] 환경변수는 EAS Secrets로 (.env는 커밋 금지):
   ```bash
   eas env:create --name EXPO_PUBLIC_SUPABASE_URL --value https://<ref>.supabase.co --environment production
   eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon> --environment production
   ```
4. [ ] Apple Developer($99/년) / Google Play 개발자($25 1회) 계정 등록
5. [ ] 내부 테스트 빌드: `eas build --profile preview --platform all`
   → iOS TestFlight 내부 테스터 / Android 내부 테스트 트랙 업로드(`eas submit`)
6. [ ] **실기기 확인 목록**: 가입→동의→아이 등록→사진 첨부 기록→PDF 생성/공유→
   공유 링크(수신자 브라우저에서 열람→회수 후 차단)→접종 알림(예정일 알림 수신)→
   보호자 초대(두 기기)→동의 철회→데이터 삭제. `maestro/smoke.yaml`도 이 단계에서 실행.

### B-4. 심사 제출
1. [ ] 스토어 등록 정보: 앱 이름(아이케어), 설명, 스크린샷(실기기 캡처), 카테고리(의료 아님 —
   "건강 및 피트니스" 또는 "라이프스타일" 권장: 의료 카테고리는 심사 기준이 더 엄격)
2. [ ] Apple 심사 노트에 명시: "본 앱은 보호자의 관찰 기록 도구이며 진단·처방 기능이
   없음. 데모 계정: (내부 테스트 계정 제공)"
3. [ ] Google Play 데이터 보안 폼: 건강 정보 수집=예(앱 기능용, 암호화 전송, 삭제 요청 가능),
   아동 대상 여부=보호자 대상 앱으로 신고(아동이 직접 사용하는 앱 아님)
4. [ ] iOS App Privacy: Health & Fitness / Contact Info / Identifiers 항목 신고
5. [ ] 출시 후 JS 수정은 `eas update`(OTA)로 심사 없이 배포 가능

## 운영 시 주의(요약)
- anon key는 공개되어도 RLS가 방어선 — 단 **RLS 테스트(CI)가 깨진 채 배포 금지**
- service_role 키는 Edge Function 환경에만 존재 — 절대 앱/저장소에 넣지 않는다
- Supabase 무료 플랜은 1주 미사용 시 일시정지됨 — 운영은 Pro 플랜 권장
- 사진 서명 URL 24h 만료 — 장시간 사용 시 재발급 로직(백로그) 배포 전 검토
