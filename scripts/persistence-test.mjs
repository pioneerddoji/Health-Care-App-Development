// ─────────────────────────────────────────────────────────────
// 실행 준비물 (환경 독립적으로 만들기 위한 안내):
//   1) npm i --no-save playwright-core
//   2) Chromium 실행 파일 경로를 CHROMIUM_PATH 로 지정
//      (npx playwright install chromium 후 표시되는 경로 등)
//   3) 웹 빌드 서빙: npx expo export --platform web --output-dir dist-web
//      npx serve dist-web -l <포트>   (아래 URL의 포트와 일치시킬 것)
// ─────────────────────────────────────────────────────────────
// 데모 영속화 검증: 로그인 → 기록 추가 → 새로고침 → 자동 로그인 + 기록 유지
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright-core');

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const vis = (t, exact = false) => page.getByText(t, { exact }).locator('visible=true').first();
const results = [];
const check = (c, l) => { results.push(`${c ? 'PASS' : 'FAIL'} ${l}`); };

await page.goto('http://localhost:8325/', { waitUntil: 'networkidle' });
await vis('케어노트').waitFor({ timeout: 20000 });
check(true, '첫 방문: 로그인 화면');

await page.getByPlaceholder('parent@example.com').fill('demo@carenote.app');
await page.getByPlaceholder('8자 이상').fill('password123');
await vis('로그인', true).click();
await vis('안녕하세요').waitFor({ timeout: 10000 });

// 기록 추가
await page.getByText('기록', { exact: true }).locator('visible=true').last().click();
await vis('+ 기록 추가').click();
await vis('기록 유형').waitFor({ timeout: 8000 });
await vis('🤒 증상').click();
const inputs = page.locator('input:visible, textarea:visible');
await inputs.nth(1).fill('영속테스트 기침');
await page.mouse.wheel(0, 2200);
await vis('기록 저장').click();
await vis('영속테스트 기침').waitFor({ timeout: 8000 });
check(true, '기록 저장됨');
await page.waitForTimeout(600); // persist 완료 대기

// ── 새로고침 (앱 재시작 시뮬레이션) ──
await page.reload({ waitUntil: 'networkidle' });
try {
  await vis('안녕하세요').waitFor({ timeout: 12000 });
  check(true, '재시작 후 자동 로그인 (로그인 화면 생략)');
} catch {
  check(false, '재시작 후 자동 로그인');
}
await page.getByText('기록', { exact: true }).locator('visible=true').last().click();
try {
  await vis('영속테스트 기침').waitFor({ timeout: 8000 });
  check(true, '재시작 후 기록 유지');
} catch {
  check(false, '재시작 후 기록 유지');
}

// 로그아웃 후 새로고침 → 로그인 화면이어야 함 (로그아웃 상태도 영속)
await page.getByText('홈', { exact: true }).locator('visible=true').last().click();
await page.waitForTimeout(300);
await vis('⚙️').click();
await vis('로그아웃').waitFor({ timeout: 8000 });
await page.mouse.wheel(0, 3000);
await vis('로그아웃').click();
await vis('케어노트').waitFor({ timeout: 8000 });
await page.waitForTimeout(600);
await page.reload({ waitUntil: 'networkidle' });
try {
  await vis('케어노트').waitFor({ timeout: 12000 });
  check(true, '로그아웃 상태 유지 (재시작 후 로그인 화면)');
} catch {
  check(false, '로그아웃 상태 유지');
}

// ── 앱 이름 변경(아이케어 → 케어노트) 마이그레이션 ──
// 구버전 사용자의 기기에는 'kidcare.demo.v1' 키로만 데이터가 있다.
// 새 빌드가 이를 새 키로 이관해 기록이 사라지지 않아야 한다.
// (AsyncStorage는 웹에서 localStorage라 여기서만 실제 검증이 가능하다 — Node 불가)
const legacyState = {
  guardian: { id: 'guardian-1', name: '구버전보호자', relationship: '엄마' },
  accountEmail: 'legacy@example.com',
  accountPassword: 'password123',
  children: [{
    id: 'child-9001', name: '구버전아이', birthDate: '2021-04-01', sex: 'female',
    isPreterm: false, allergies: [], chronicConditions: [], surgeries: [], hospitalizations: [],
  }],
  records: [{
    id: 'rec-9001', childId: 'child-9001', authorId: 'guardian-1',
    recordDate: new Date().toISOString().slice(0, 10), recordTime: '09:00',
    type: 'note', categories: [], payload: { note: '이름변경전기록' }, photoUris: [],
  }],
  growth: [], medications: [], vaccinations: [], checkups: [],
  guardians: [{
    guardianId: 'guardian-1', childId: 'child-9001', role: 'owner',
    name: '구버전보호자', relationship: '엄마', isMe: true,
  }],
  reports: [], shareLinks: [], sensitiveConsent: {},
  subscription: { tier: 'free' }, settings: { dashboardOrder: ['sleep', 'temp'] },
  idSeq: 9001,
};
await page.evaluate((state) => {
  localStorage.clear();
  localStorage.setItem('kidcare.demo.v1', JSON.stringify(state));
}, legacyState);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

check(await page.getByText('구버전보호자').locator('visible=true').count() > 0,
  '이름 변경: 구 저장본으로 자동 로그인 유지');
check(await page.getByText('구버전아이').locator('visible=true').count() > 0,
  '이름 변경: 구 저장본의 대상자 보존');
const migrated = await page.evaluate(() => localStorage.getItem('carenote.demo.v1'));
check(!!migrated && JSON.parse(migrated).children[0].id === 'child-9001',
  '이름 변경: 새 저장 키로 이관 완료');
check(!!migrated && JSON.parse(migrated).subscription.tier === 'free',
  '이름 변경: 플랜(free) 보존 — 데모 계정으로 오인되지 않음');

console.log(results.join('\n'));
await browser.close();
if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);
