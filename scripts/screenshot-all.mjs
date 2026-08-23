// ─────────────────────────────────────────────────────────────
// 실행 준비물 (환경 독립적으로 만들기 위한 안내):
//   1) npm i --no-save playwright-core
//   2) Chromium 실행 파일 경로를 CHROMIUM_PATH 로 지정
//      (npx playwright install chromium 후 표시되는 경로 등)
//   3) 웹 빌드 서빙: npx expo export --platform web --output-dir dist-web
//      npx serve dist-web -l <포트>   (아래 URL의 포트와 일치시킬 것)
// ─────────────────────────────────────────────────────────────
// 최신 빌드 전체 화면 스크린샷 (구독/페이월/방침/캘린더 포함 20컷)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const SP = new URL('./output', import.meta.url).pathname;
mkdirSync(SP, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const vis = (t, exact = false) => page.getByText(t, { exact }).locator('visible=true').first();
const shot = async (name) => {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${SP}/${name}.png` });
  console.log('shot:', name);
};
const goBack = async () => {
  await page.locator('[aria-label="Go back"], [aria-label*="back"]').locator('visible=true').first().click();
  await page.waitForTimeout(400);
};

await page.goto('http://localhost:8323/', { waitUntil: 'networkidle' });
await vis('케어노트').waitFor({ timeout: 20000 });
await shot('01-login');

// 회원가입(연락처+문자 인증) → 동의 → 빈 홈 → 로그아웃 → 데모 로그인
await vis('회원가입', true).click();
await vis('주로 기록할 대상자와의 관계').waitFor({ timeout: 5000 });
const si = page.locator('input:visible');
await si.nth(0).fill('me@example.com');
await si.nth(1).fill('password123');
await si.nth(2).fill('김보호');
await si.nth(3).fill('01012345678');
await shot('02-signup');
await vis('휴대폰 인증번호 받기').click();
await vis('데모 모드 인증번호').waitFor({ timeout: 8000 });
await shot('02b-signup-otp');
const codeText = await vis('데모 모드 인증번호').textContent();
await page.locator('input:visible').last().fill(codeText.match(/(\d{6})/)[1]);
await vis('인증하고 가입 완료').click();
await vis('이용 동의', true).waitFor({ timeout: 8000 });
await shot('03-consent');
await vis('전문 보기 ›').click();
await page.waitForTimeout(500);
await shot('03b-terms-full');
await vis('확인했습니다 — 동의').click();
for (const t of ['대상자 등록 권한 확인', '건강정보(민감정보)']) {
  await vis(t).click(); await page.waitForTimeout(120);
}
await vis('동의하고 시작하기').click();
await vis('안녕하세요').waitFor({ timeout: 10000 });
await shot('04-home-empty');
// 로그아웃 후 데모 계정으로 (샘플 데이터 화면 촬영용)
await vis('⚙️').click();
await page.waitForTimeout(500);
await page.mouse.wheel(0, 4000);
await vis('로그아웃').click();
await vis('케어노트').waitFor({ timeout: 8000 });
await page.getByPlaceholder('parent@example.com').fill('demo@carenote.app');
await page.getByPlaceholder('8자 이상').fill('password123');
await vis('로그인', true).click();
await vis('안녕하세요').waitFor({ timeout: 10000 });
await shot('04-home');

// 프로필/성장/접종
await page.getByText('프로필 ›').locator('visible=true').first().click();
await vis('프로필 수정').waitFor({ timeout: 8000 });
await shot('05-child-profile');
await page.mouse.wheel(0, 1500);
await shot('06-growth-charts');
await vis('예방접종 · 건강검진 기록').click();
await vis('예정된 접종').waitFor({ timeout: 8000 });
await shot('07-vaccination');
await goBack(); await goBack();

// 기록 + 입력 폼
await page.getByText('기록', { exact: true }).locator('visible=true').last().click();
await vis('의 기록').waitFor({ timeout: 8000 });
await shot('08-day-records');
await vis('+ 기록 추가').click();
await vis('기록 유형').waitFor({ timeout: 8000 });
await vis('🤒 증상').click();
await page.waitForTimeout(250);
await shot('09-record-form');
await page.mouse.wheel(0, 1300);
await shot('10-photo-and-tags');
await goBack();

// 대시보드 + 캘린더
await page.getByText('대시보드', { exact: true }).locator('visible=true').last().click();
await vis('최근 14일').waitFor({ timeout: 8000 });
await shot('11-dashboard');
await page.mouse.wheel(0, 1600);
await shot('12-dashboard-charts');
await page.mouse.wheel(0, -1600);
await vis('월간 캘린더 보기').click();
await page.getByText(/\d+년 \d+월/).locator('visible=true').first().waitFor({ timeout: 8000 });
await shot('13-calendar');
await goBack();

// 레포트 + 공유 링크
await page.getByText('레포트', { exact: true }).locator('visible=true').last().click();
await vis('병원 제출용 레포트').waitFor({ timeout: 8000 });
await shot('14-report');
await page.mouse.wheel(0, 1500);
await page.getByText('공유 링크 만들기', { exact: true }).locator('visible=true').first().click();
await vis('까지 열람 가능').waitFor({ timeout: 10000 });
await shot('15-share-link');

// 설정 (플랜 카드 → 공동관리 → 동의/삭제)
await page.getByText('홈', { exact: true }).locator('visible=true').last().click();
await page.waitForTimeout(300);
await vis('⚙️').click();
await vis('플랜', true).waitFor({ timeout: 8000 });
await shot('16-settings-plan');
await page.mouse.wheel(0, 1100);
await shot('17-settings-guardians');
await page.mouse.wheel(0, 1100);
await shot('18-settings-consent-delete');

// 페이월
await page.mouse.wheel(0, -2500);
await vis('플랜 관리 · 비교').click();
await vis('플랜 관리', true).waitFor({ timeout: 8000 });
await shot('19-paywall');
await page.mouse.wheel(0, 1400);
await shot('20-paywall-family');

// 무료 전환 → 게이팅 확인 (대시보드 🔒 + 홈 아이 추가 🔒)
await page.mouse.wheel(0, -1400);
await page.getByText('무료로 전환', { exact: true }).locator('visible=true').first().click();
await page.waitForTimeout(700); // mock: 페이월→설정으로 자동 복귀
await goBack();                  // 설정 → 탭
await page.getByText('대시보드', { exact: true }).locator('visible=true').last().click();
await vis('최근 7일').waitFor({ timeout: 8000 });
await shot('21-free-tier-locked');
await page.getByText('홈', { exact: true }).locator('visible=true').last().click();
await page.waitForTimeout(400);
await shot('22-free-tier-home-lock');

// 방침 화면
await vis('⚙️').click();
await vis('플랜 관리 · 비교').waitFor({ timeout: 8000 });
await page.mouse.wheel(0, 3200);
await vis('개인정보처리방침').click();
await vis('수집하는 개인정보').waitFor({ timeout: 8000 });
await shot('23-privacy-policy');

await browser.close();
console.log('DONE');
