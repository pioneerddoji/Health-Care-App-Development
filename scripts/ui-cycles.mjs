// ─────────────────────────────────────────────────────────────
// 실행 준비물 (환경 독립적으로 만들기 위한 안내):
//   1) npm i --no-save playwright-core
//   2) Chromium 실행 파일 경로를 CHROMIUM_PATH 로 지정
//      (npx playwright install chromium 후 표시되는 경로 등)
//   3) 웹 빌드 서빙: npx expo export --platform web --output-dir dist-web
//      npx serve dist-web -l <포트>   (아래 URL의 포트와 일치시킬 것)
// ─────────────────────────────────────────────────────────────
// 트랙 B: UI E2E × 5 사이클 — 가입→동의→아이 추가→기록→대시보드→레포트 링크→설정→로그아웃
// 같은 세션에서 반복해 상태 누적(아이 수 증가)과 콘솔 에러를 함께 점검한다.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const SP = new URL('./output', import.meta.url).pathname;
mkdirSync(SP, { recursive: true });

const issues = [];
const consoleErrors = [];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 160)}`));
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(`console.error: ${m.text().slice(0, 160)}`);
});

const vis = (t, exact = false) => page.getByText(t, { exact }).locator('visible=true').first();
const check = async (cond, label) => {
  if (!(await cond)) issues.push(label);
};

await page.goto('http://localhost:8321/', { waitUntil: 'networkidle' });
await vis('아이케어 🧸').waitFor({ timeout: 20000 });

for (let cycle = 1; cycle <= 5; cycle++) {
  console.log(`== UI Cycle ${cycle} ==`);
  const expectedChildren = 1; // 가입은 빈 상태에서 시작 → 사이클마다 아이 1명 등록

  // 가입 → 동의
  await vis('회원가입', true).click();
  await vis('보호자 회원가입').waitFor({ timeout: 5000 });
  const inputs = page.locator('input:visible, textarea:visible');
  await inputs.nth(0).fill(`cycle${cycle}@example.com`);
  await inputs.nth(1).fill('password123');
  await inputs.nth(2).fill(`보호자${cycle}`);
  await inputs.nth(3).fill('01012345678');
  await vis('휴대폰 인증번호 받기').click();
  await vis('데모 모드 인증번호').waitFor({ timeout: 8000 });
  const codeText = await vis('데모 모드 인증번호').textContent();
  const code = codeText.match(/(\d{6})/)[1];
  await page.locator('input:visible').last().fill(code);
  await vis('인증하고 가입 완료').click();
  await vis('이용 동의', true).waitFor({ timeout: 5000 });
  for (const t of ['서비스 이용약관', '대상자 등록 권한 확인', '건강정보(민감정보)']) {
    await vis(t).click();
    await page.waitForTimeout(120);
  }
  await vis('동의하고 시작하기').click();
  await vis('안녕하세요').waitFor({ timeout: 10000 });

  // 대상자 추가 (아이 유형 기본)
  await vis('+ 대상자 추가하기').click();
  await vis('기본 정보').waitFor({ timeout: 5000 });
  const f = page.locator('input:visible');
  await f.nth(0).fill(`테스트${cycle}`);
  await f.nth(2).fill('2022-05-10'); // 생년월일 (별명 건너뜀)
  await page.mouse.wheel(0, 2000);
  // 대상자별 동의 확인 (만 14세 미만 → 법정대리인 확인)
  await page.getByText(/^☐ /).first().click();
  // 헤더 타이틀('대상자 등록 · 수정')과 겹치므로 버튼 라벨을 정확히 일치시킨다
  await vis('대상자 등록', true).click();
  await vis('안녕하세요').waitFor({ timeout: 8000 });
  const cards = await page.getByText('프로필 ›').locator('visible=true').count();
  await check(Promise.resolve(cards === expectedChildren),
    `C${cycle}: 대상자 카드 ${expectedChildren}개 기대, 실제 ${cards}`);

  // 기록 추가 (새 아이가 자동 선택됨)
  await page.getByText('기록', { exact: true }).locator('visible=true').last().click();
  await vis('의 기록').waitFor({ timeout: 8000 });
  await vis('+ 기록 추가').click();
  await vis('기록 유형').waitFor({ timeout: 8000 });
  await vis('🤒 증상').click();
  const rf = page.locator('input:visible, textarea:visible');
  await rf.nth(1).fill(`사이클${cycle} 콧물`);   // 증상 (0=시간)
  await rf.nth(2).fill('37.9');                 // 체온
  await page.mouse.wheel(0, 2200);
  await vis('기록 저장').click();
  await vis(`사이클${cycle} 콧물`).waitFor({ timeout: 8000 });

  // 대시보드 — 신규 가입은 free 티어: 7일만 열리고 14/30일은 🔒 → 페이월
  await page.getByText('대시보드', { exact: true }).locator('visible=true').last().click();
  await vis('최근 7일').waitFor({ timeout: 8000 });
  await check(vis('14일 🔒').isVisible(), `C${cycle}: free 티어 14일 잠금 표시`);
  await check(vis('30일 🔒').isVisible(), `C${cycle}: free 티어 30일 잠금 표시`);
  await check(vis('체온').isVisible(), `C${cycle}: 대시보드 체온 차트 표시`);

  // 레포트 — 질문 추가 + 공유 링크 생성
  await page.getByText('레포트', { exact: true }).locator('visible=true').last().click();
  await vis('병원 제출용 레포트').waitFor({ timeout: 8000 });
  const q = page.locator('input:visible').last();
  await q.fill(`사이클${cycle} 질문입니다`);
  await vis('+ 질문 추가').click();
  await check(vis(`사이클${cycle} 질문입니다`).isVisible(), `C${cycle}: 질문 목록 반영`);
  await page.mouse.wheel(0, 1500);
  await page.getByText('공유 링크 만들기', { exact: true }).locator('visible=true').first().click();
  await vis('까지 열람 가능').waitFor({ timeout: 10000 });
  if (cycle === 3) await page.screenshot({ path: `${SP}/c3-report-link.png` });

  // 설정 — 공유 링크 목록 + 보호자 초대 + 동의 섹션 존재
  await page.getByText('홈', { exact: true }).locator('visible=true').last().click();
  await page.waitForTimeout(300);
  await vis('⚙️').click();
  await vis('보호자 공동 관리').waitFor({ timeout: 8000 });
  await page.mouse.wheel(0, 900);
  await check(vis('레포트').isVisible(), `C${cycle}: 설정에 공유 링크 목록 표시`);
  // 신규 가입=free 티어: 공동 보호자 초대는 잠겨 있어야 한다
  await check(vis('공동 보호자 초대는 스탠다드 플랜부터').isVisible(),
    `C${cycle}: free 티어 보호자 초대 잠금 안내`);
  await page.mouse.wheel(0, 1600);
  await check(vis('건강정보(민감정보) 수집·이용 동의').isVisible(), `C${cycle}: 동의 내역 표시`);
  if (cycle === 5) await page.screenshot({ path: `${SP}/c5-settings.png`, fullPage: false });

  // 로그아웃 → 로그인 화면 복귀
  await page.mouse.wheel(0, 800);
  try {
    await vis('로그아웃').click();
    await vis('아이케어 🧸').waitFor({ timeout: 8000 });
  } catch (e) {
    await page.screenshot({ path: `${SP}/fail-c${cycle}-logout.png` });
    console.log('logout fail state saved; visible buttons:',
      await page.locator('div[role="button"]:visible').allInnerTexts().then((t) => t.slice(-8)));
    throw e;
  }
  console.log(`  cycle ${cycle} done (children=${cards})`);
}

console.log('\n===== UI 5사이클 결과 =====');
console.log('기능 이슈:', issues.length ? issues : '없음');
const uniqErrors = [...new Set(consoleErrors)];
console.log('콘솔 에러(중복 제거):', uniqErrors.length ? uniqErrors.slice(0, 12) : '없음');
await browser.close();
if (issues.length) process.exit(1);
