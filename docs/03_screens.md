# 3. 주요 화면 목록

네비게이션: 인증 스택 → (로그인 후) 하단 탭 4개 + 모달 스택.

## 인증 스택
| 화면 | 파일 | 내용 |
|---|---|---|
| 로그인 | `screens/auth/LoginScreen` | 이메일/비밀번호, 회원가입 이동 |
| 회원가입 | `screens/auth/SignUpScreen` | 이메일, 비밀번호, 보호자 이름/관계 |
| 동의 | `screens/auth/ConsentScreen` | 서비스 약관 + **법정대리인 확인** + **건강정보(민감정보) 별도 동의**(개별 체크, 전체동의 불가 항목 구분) |

## 하단 탭
| 탭 | 화면 | 내용 |
|---|---|---|
| 홈 | `children/ChildListScreen` | 아이 카드 목록(다자녀), 오늘 요약(마지막 체온·수면·식사), 아이 추가 |
| 기록 | `records/DayRecordsScreen` | 날짜 이동 + 해당일 기록 타임라인, 유형별 추가 버튼 |
| 대시보드 | `dashboard/DashboardScreen` | 기간 선택(7/14/30일) + 그래프 6종 |
| 레포트 | `report/ReportScreen` | 기간 선택, 의사에게 질문 입력, PDF 미리보기/공유 |

## 모달/푸시 화면
| 화면 | 내용 |
|---|---|
| `children/ChildFormScreen` | 아이 등록/수정 — 인적사항, 출생정보(재태주수·조산), 알레르기, 만성질환, 복용약, 수술/입원, 주치의/병원 |
| `children/ChildProfileScreen` | 프로필 상세 + 성장 그래프 진입 + 접종/검진 진입 |
| `records/RecordFormScreen` | 기록 유형 선택 → 유형별 입력 폼(12종), 건강관리 영역 태그 자동제안+수정, 사진 첨부 |
| `dashboard/CalendarScreen` | 월 캘린더 — 날짜별 기록 유무/증상 뱃지, 탭하면 해당일 기록으로 |
| `vaccination/VaccinationScreen` | 예방접종·건강검진 목록/추가 (예정일, 완료일, 병원, 이상반응) |
| `settings/SettingsScreen` | 보호자 초대/권한(owner·editor·viewer), 공유 링크 관리(만료·회수), 동의 내역, **데이터 전체 삭제** |

## 대시보드 그래프 6종 (+캘린더)
1. 체온 그래프 — `symptom.temperature_c` 라인차트, 37.5℃ 기준선
2. 수면 그래프 — 일별 총 수면시간 바차트 + 밤중 깸 횟수
3. 식사/수분 그래프 — 일별 식사 섭취량 점수 + 수분(ml)
4. 배변 그래프 — 일별 대변/소변 횟수, 묽은 변 강조
5. 증상 타임라인 — 날짜×증상 도트 타임라인
6. 성장 그래프 — 키/체중/BMI 라인차트 (ChildProfile에서 진입)

## 화면 흐름
```
Login ─ SignUp ─ Consent ─▶ 홈(아이 목록)
  홈 ─ 아이 카드 ─▶ ChildProfile ─▶ ChildForm / 성장그래프 / Vaccination
  기록 탭 ─▶ DayRecords ─ (+) ─▶ RecordForm
  대시보드 탭 ─▶ Dashboard ─▶ Calendar
  레포트 탭 ─▶ Report ─▶ PDF 미리보기 → 공유/저장
  설정(홈 우상단) ─▶ Settings
```
