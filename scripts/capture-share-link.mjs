// 랜딩 4단계용 캡처 — "발급된 만료형 공유 링크" 화면 (28-share-link-issued.png)
//
// screenshot-all.mjs 의 15-share-link 는 이 상태를 못 잡는다. page.mouse.wheel 이
// window 를 스크롤하는데 RN-web 의 ScrollView 는 내부 div 가 스크롤되기 때문에,
// 링크를 발급해도 화면이 위쪽에 머물러 결과가 안 보인다. 여기서는 실제 스크롤
// 컨테이너를 찾아 직접 스크롤한다.
//
// 준비: npx expo export --platform web --output-dir dist-web  후 8323 포트로 서빙
//       CHROMIUM_PATH 로 Chromium 경로 지정
// 실행: node scripts/capture-share-link.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const OUT = new URL('./output', import.meta.url).pathname;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const vis = (t, exact = false) => page.getByText(t, { exact }).locator('visible=true').first();

// RN-web ScrollView 는 window 가 아니라 내부 컨테이너가 스크롤된다.
const scrollInner = (dy) => page.evaluate((d) => {
  const t = [...document.querySelectorAll('div')]
    .filter((e) => e.scrollHeight > e.clientHeight + 40 && getComputedStyle(e).overflowY !== 'visible')
    .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
  if (t) t.scrollTop += d;
}, dy);

await page.goto('http://localhost:8323/', { waitUntil: 'networkidle' });
await vis('케어노트').waitFor({ timeout: 20000 });
await page.getByPlaceholder('parent@example.com').fill('demo@carenote.app');
await page.getByPlaceholder('8자 이상').fill('password123');
await vis('로그인', true).click();
await vis('안녕하세요').waitFor({ timeout: 15000 });

await page.getByText('레포트', { exact: true }).locator('visible=true').last().click();
await vis('병원 제출용 레포트').waitFor({ timeout: 10000 });
await page.waitForTimeout(600);

await scrollInner(1500);
await page.waitForTimeout(400);
await page.getByText('공유 링크 만들기', { exact: true }).locator('visible=true').first().click();
await vis('까지 열람 가능').waitFor({ timeout: 15000 });
await scrollInner(2000);
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/28-share-link-issued.png` });
console.log('shot: 28-share-link-issued');

await browser.close();
