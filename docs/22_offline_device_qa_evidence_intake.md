# P1 오프라인 실기기 QA 증거 intake 계약

> 이 문서는 실기기 연결, emulator, build, upload, signing, 계정 로그인 또는 운영 서비스 연결을 수행하지 않는다.
> 이 계약은 별도 승인 뒤 수집할 QA 결과를 **민감정보 없이 fail-closed**로 받아들이기 위한 정적 입력 규격이다.

## 1. 선행 결정 패킷 대조

수집 파일의 `source`는 아래 선행 패킷과 일치해야 한다. 값은 protected shared credential helper로
선행 카드에서 재대조된 source evidence이며, helper의 credential/token을 출력·저장하지 않는다.

| 필드 | 기준 |
|---|---|
| exact commit SHA | `7cb43eed5b532c236f6ed7d91f9a35a82fbdcd16` |
| Draft PR | https://github.com/pioneerddoji/Health-Care-App-Development/pull/22 |
| current-head CI | https://github.com/pioneerddoji/Health-Care-App-Development/actions/runs/32676272592 |
| canonical review verdict | `kanban://task/t_d5098b8a/run/162` |

이 기준의 Workers Builds는 failure이므로 **non-green**이다. 이를 preview artifact, upload, production,
physical-device runtime 또는 PASS 근거로 바꾸어 해석하면 안 된다. 현재 패키지는 따라서 모든
실기기 항목을 `ABORT` + `needs-device`로 명시하는 것이 정상이다.

## 2. 기계 검증 계약

- 구현: `scripts/validate-device-qa-evidence.ts`
- 결정적 테스트: `scripts/device-qa-evidence-validator.test.mts`
- 양성 fixture: `fixtures/device-qa-evidence/positive-needs-device.json`
- 음성 fixture: `fixtures/device-qa-evidence/negative-sensitive-and-false-green.json`

```bash
npm run test:device-qa-evidence
npx tsx scripts/validate-device-qa-evidence.ts <redacted-evidence.json>
```

최상위 필수 필드는 `schemaVersion`, `source`, `devices`, `checks`다. 알 수 없는 필드도 거부한다.
`source`에는 full 40-character SHA, Draft PR URL, current-head CI URL, verdict URL을 모두 써야 한다.
`devices`에는 Android와 iOS 각각의 비밀이 아닌 OS/app build 식별자가 있어야 한다.

각 `checks[]`는 다음 필드를 모두 가져야 한다.

| 필드 | 규칙 |
|---|---|
| `id`, `platform`, `area` | 고유 식별자, `android`/`ios`, 아래 coverage 영역 |
| `preconditions`, `testDataClass`, `steps` | 실행 전제, `synthetic` 또는 `no-personal-data`, 재현 단계 |
| `expected`, `actual`, `captureReference` | 기대/관찰 결과와 redacted `qa://pending/...` 또는 `qa://capture/...` 참조 |
| `result`, `evidenceState` | `PASS`=`proven`, `FAIL`=`not-proven`, `ABORT`=`needs-device`만 허용 |
| `abortReason`, `rollback` | ABORT 사유와 후보 Draft 보존 또는 후속 안전 조치 |

Android와 iOS 모두에 다음 여섯 `area`가 하나씩 있어야 한다.

1. `screen-reader` — TalkBack/VoiceOver 제어 이름·역할·상태, 모달 종료 후 focus 복귀
2. `picker-focus` — picker focus trap, cancel/back, validation error, 중복 열림 방지
3. `permissions` — 사진/알림 deny·재시도, 안전 안내, 입력 보존
4. `pdf-share` — 고지, 로컬 PDF 확인, share cancel 후 데이터 보존
5. `notification-deep-link` — QA-only 알림 destination, stale/duplicate navigation 방지
6. `app-resume` — background/foreground 및 권한 화면 복귀 후 stale write/crash/input loss 방지

## 3. 비식별 및 abort 규칙

`testDataClass`는 synthetic/no-personal-data만 허용한다. 실제 아동·보호자·계정·수신자·사진·기록은
입력하지 않는다. validator는 이메일, 전화번호, token-like/Bearer/JWT/GitHub credential 값, local
absolute path, 그리고 영어/한국어 건강정보 표현을 발견하면 거부한다. capture는 파일 경로나 raw
log가 아니라 `qa://capture/<redacted-id>` 형태의 외부 redacted reference만 기록한다.

다음은 즉시 `ABORT`하고 candidate Draft를 보존한다: 건강정보·credential·계정 식별자 노출,
교차 계정 데이터 접근, 실제 OAuth/결제/운영 Supabase 연결, 파괴 동작 오발동이다. 화면 또는
로그를 이 문서/fixture/PR comment에 붙이지 않는다.

`PASS`는 해당 exact approved device build에서 expected가 충족되고 비식별 검토까지 끝났을 때만
가능하다. `FAIL`은 결함과 safe rollback을 남기되 proven이라고 주장하지 않는다. 승인이 없거나
기기 증거가 없으면 `ABORT`와 `needs-device`를 사용한다. 이 상태 불일치는 validator가 fail-closed로
거부하므로 정적 통과만으로 native QA PASS가 되는 false-green을 막는다.

## 4. 수집 템플릿 사용법

1. `positive-needs-device.json`을 복사해 접근 제어된 QA 증거 저장소에서 작성한다. 이 저장소에는
   실제 기기 연결 전에는 `qa://pending/...`만 남긴다.
2. 별도 승인된 QA 후, `devices`에 비밀이 아닌 platform/OS/app-build 식별자만 적고 capture reference를
   redacted `qa://capture/...`로 바꾼다.
3. 각 결과의 `actual`, `result`, `evidenceState`, `abortReason`, `rollback`을 함께 갱신한다.
4. validator가 통과해도 exact SHA/PR/CI/verdict가 새로 바뀌면 수집을 중단하고 새 decision packet을
   대조한다. 검증기는 어떤 build, upload, device, account 또는 production action도 시작하지 않는다.

## 5. 범위와 rollback

이 카드가 만드는 것은 문서, fixture, validator, test뿐이다. rollback은 이 작은 docs/static-test
commit을 revert하고 Draft PR을 close하는 것이다. main 병합, package/bundle ID 확정, EAS/store,
Apple/Google/Expo 로그인, signing, OAuth/billing, 운영 Supabase와 실제 기기/에뮬레이터 연결은
범위 밖이며 수행하지 않았다.
