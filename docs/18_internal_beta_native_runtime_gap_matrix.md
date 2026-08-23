# P1 내부 베타 native runtime gap matrix·비용 없는 사전점검

> 기준: PR #17 승인 exact head `53de38f355514e581548993cff232be9d312316d` 위의 문서·정적 QA 범위입니다. 이 문서는 Android/iOS 실행 성공을 주장하지 않습니다. 실행은 credential, 결제, telemetry, 외부 SDK, 기기 연결 없이 로컬 source/config 읽기와 결정론 fixture로만 수행합니다.

## 1. 해석 규칙

- **proven (static)**: 소스·Expo 설정·결정론 preflight가 해당 선언 또는 분기 존재를 확인했습니다. 네이티브 OS가 실제로 허용·렌더·전달했다는 증거는 아닙니다.
- **not-proven**: 현재 자동 증거가 없거나 웹/Node 경로만 확인했습니다. 성공으로 해석하면 false-green입니다.
- **needs-device**: Android/iOS 실기기 또는 에뮬레이터와 명시적 캡틴 승인이 있어야 확인할 수 있습니다. 이 카드에서 실행하지 않습니다.
- rollback은 이 카드의 문서·정적 preflight 커밋만 revert합니다. 앱 설정, 운영 데이터, 서명, 빌드 산출물은 바꾸지 않았습니다.

## 2. 기능별 증거와 native gap

| 기능 | 현재 정적 증거 | 상태 | false-green / needs-device 확인 | rollback |
| --- | --- | --- | --- | --- |
| 날짜·시간 picker | `src/components/DateField.tsx`가 community picker를 import하고 Android dismiss/IOS modal 분기를 둔다. | proven (static), needs-device | Android default dialog의 취소·시간대·back 버튼, iOS inline/spinner·VoiceOver focus, 한국어 locale 렌더는 미증명. | 문서/preflight revert; picker runtime 변경 없음. |
| 사진 권한·선택 | `RecordFormScreen`이 media-library permission을 요청하고 거부 Alert 후 image picker를 연다. `app.json`에 `READ_MEDIA_IMAGES` 및 iOS 사진 설명이 있다. | proven (static), needs-device | Android 13+/iOS 제한 사진 권한, 거부 뒤 Settings 복귀, 다중 선택/얼굴 회피 안내는 기기 확인 필요. | 문서/preflight revert; 권한 선언 변경 없음. |
| PDF 생성·공유 | `reportPdf.ts`가 `expo-print` PDF 생성과 `expo-sharing` availability guard를 사용한다. | proven (static), needs-device | iOS/Android PDF WebView 렌더, large photo memory, 공유 시트 cancel·대상 앱 전달은 미증명. 웹 export는 `expo-print`를 증명하지 않는다. | 문서/preflight revert; file/share runtime 변경 없음. |
| 로컬 알림 | `reminders.ts`는 permission query/request, web early return, schedule/cancel을 둔다. `app.json`은 `POST_NOTIFICATIONS`와 `expo-notifications` plugin을 선언한다. | proven (static), needs-device | Android runtime prompt, Android 13 channel/notification visibility, iOS provisional/denied Settings 복귀, 백그라운드·재부팅 뒤 trigger는 미증명. | 문서/preflight revert; 예약/취소 동작 변경 없음. |
| deep link/auth resume | `AppContext`가 `Linking.getInitialURL()` 및 URL event listener를, `App.tsx`가 web auth-session completion을 둔다. | proven (static), needs-device | cold start, foreground resume, OAuth browser round-trip, malformed/duplicate URL 및 Android intent/iOS universal-link association은 미증명. 운영 OAuth 설정도 이 범위 밖. | 문서/preflight revert; URL handler 변경 없음. |
| app resume/lifecycle | `AppContext`가 `AppState`·Linking을 generation-guarded `AppResumeLifecycle`에 연결하고, `loadAll`의 실제 state 적용도 current-generation 경계 안에 둔다. 성공한 새 인증의 data bootstrap 뒤에만 lifecycle을 re-arm한다. | proven (static), needs-device | background→foreground에서 OS가 실제로 lifecycle event를 전달하고 stale UI/permission/notification state가 기대대로 refresh되는지는 기기 검증이 필요하다. invalidate 뒤 sign-out/recovery 완료 전 refresh·confirm은 fail-closed로 차단하며, 새 인증 성공 뒤의 이후 resume만 허용한다. | lifecycle/documentation commit revert; native runtime 변경 없음. |
| accessibility | 공용 Button role/state, Field label, Settings/Recovery error live-region source를 확인한다. | proven (static), needs-device | TalkBack/VoiceOver 실제 탐색 순서, picker/modal focus trap, Android back 후 focus restore, 동적 알림 발화는 미증명. | 문서/preflight revert; UI semantics 변경 없음. |

## 3. 결정론 static preflight

`npm run test:native-preflight`는 source와 `app.json`을 로컬에서만 읽어 다음을 검사합니다.

1. native scheme, 사진/알림 Android 선언, `expo-notifications` plugin
2. picker, 사진 permission, PDF/share guard, notification schedule, deep-link cold/foreground handler
3. button/input/error의 최소 accessibility semantics
4. 이 matrix가 **not-proven**, **needs-device**, `AppState`, 승인 gate를 계속 명시하는지
5. `scripts/fixtures/native-runtime-preflight-missing-notifications.json`의 누락 notification fixture가 반드시 실패하는지

이는 registry, telemetry, Expo/EAS, 외부 SDK, network, secret를 사용하지 않습니다. 이 스크립트의 PASS는 위 정적 조건만 뜻하며 native runtime PASS로 승격할 수 없습니다.

## 4. 캡틴 승인 게이트 (실행 금지)

다음은 이 카드에서 실행하지 않았으며, 필요한 경우 별도 카드와 명시적 캡틴 승인이 필요합니다.

- Android/iOS 실기기·에뮬레이터 연결, permission prompt/notification/PDF/share/deep-link/accessibility 수행
- EAS/스토어 build·upload, signing·bundle ID 확정, OAuth/결제/Supabase 운영 연결 및 migration/data access
- 외부 사용자·고객 메시지, telemetry, 광고/가격/브랜드 결정, DNS/secrets/비용 증가, production/store 배포 및 `main` 병합

## 5. 다음 handoff

native 확인은 이 matrix의 `needs-device` 행을 순서대로 수행하는 별도 승인 QA 카드에서만 기록합니다. 각 결과는 OS/version/device, permission 초기 상태, 재현 단계, 예상/실제 결과, screenshot 또는 non-sensitive log, rollback 여부를 남기되 건강정보·token·URL query secret는 기록하지 않습니다.
