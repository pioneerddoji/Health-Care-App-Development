// ─────────────────────────────────────────────────────────────
// 베타 페이지용 동적 이미지 3컷 — **실제로 동작하는 웹 빌드를 조작하며 녹화**한다.
// 목업을 그리지 않는다. 앱이 바뀌면 이 스크립트만 다시 돌리면 소재가 갱신된다.
//
// 실행 준비물
//   1) npx expo export --platform web --output-dir dist-web
//   2) cd dist-web && python3 -m http.server 8099
//   3) node scripts/record-beta-clips.mjs
//      → web/beta-media/{record,chart,report}.webp (+ -poster.webp)
//
// 왜 영상이 아니라 애니메이션 WebP 인가
//   `<video>` 자동재생은 muted+playsinline 을 붙여도 iOS 저전력 모드에서 막힌다.
//   SNS 유입은 대부분 모바일이라 그 실패가 곧 첫인상이 된다. `<img>` 의 애니메이션
//   WebP 는 자동재생 정책을 아예 타지 않는다. (부수적으로, Playwright 번들
//   ffmpeg 는 VP8/PNG 만 낼 수 있어 mp4 를 만들 수도 없다.)
//
// 로그인 화면이 영상에 안 들어가는 이유
//   Playwright 영상은 **페이지 단위**로 녹화된다. 같은 컨텍스트에서 로그인용
//   페이지를 따로 열어 로그인한 뒤 닫고, 새 페이지를 열면 세션(localStorage)은
//   남고 영상은 처음부터 다시 시작한다.
// ─────────────────────────────────────────────────────────────
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = new URL('..', import.meta.url).pathname;
const APP_URL = process.env.APP_URL ?? 'http://localhost:8099/';
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FFMPEG = process.env.FFMPEG_PATH ?? '/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux';
const FPS = 8;
const VP = { width: 430, height: 932 };

const work = mkdtempSync(join(tmpdir(), 'beta-clips-'));
const videoDir = join(work, 'video');

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: VP, recordVideo: { dir: videoDir, size: VP } });

// ── 로그인 (이 페이지의 영상은 버린다) ──
const login = await ctx.newPage();
await login.goto(APP_URL, { waitUntil: 'networkidle' });
await login.waitForTimeout(2000);
const li = login.locator('input');
await li.nth(0).fill('demo@carenote.app');
await li.nth(1).fill('demo1234');
await login.getByText('로그인', { exact: false }).locator('visible=true').first().click();
await login.waitForTimeout(3000);
await login.close();

const tapTab = async (p, i) => {
  await p.mouse.click(VP.width * (0.125 + 0.25 * i), VP.height - 28);
  await p.waitForTimeout(1000);
};
const tap = async (p, text, exact = false) => {
  const el = p.getByText(text, { exact }).locator('visible=true').first();
  await el.waitFor({ timeout: 6000 });
  await el.click();
  await p.waitForTimeout(600);
};

const clips = [];
const record = async (name, seconds, fn) => {
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.innerText.includes('안녕하세요'), null, { timeout: 20000 });
  await page.waitForTimeout(500);
  // 부팅에 쓴 앞부분은 흰 화면이라 잘라낸다. 여기서 실측해 둔다.
  const boot = (Date.now() - t0) / 1000;
  await fn(page);
  const path = await page.video().path();
  await page.close();
  clips.push({ name, path, start: +(boot + 1.6).toFixed(2), duration: seconds });
  console.log(`녹화 [${name}] 부팅 ${boot.toFixed(1)}s`);
};

// ── 컷1: 밤중 발열을 기록한다 ──
await record('record', 12.2, async (p) => {
  await p.waitForTimeout(800);
  await tapTab(p, 1);
  await p.waitForTimeout(800);
  await tap(p, '+ 기록 추가');
  await p.waitForTimeout(600);
  await tap(p, '🤒 증상');
  const b = p.locator('input');
  // 기본값은 '지금'이다. 밤중 발열 상황이 더 자연스러워 시간만 바꿔 넣는다.
  await b.nth(0).click(); await b.nth(0).fill('');
  await b.nth(0).pressSequentially('21:30', { delay: 110 });
  await p.waitForTimeout(350);
  await b.nth(1).click(); await b.nth(1).pressSequentially('발열', { delay: 130 });
  await p.waitForTimeout(350);
  await b.nth(2).click(); await b.nth(2).pressSequentially('38.2', { delay: 150 });
  await p.waitForTimeout(600);
  await tap(p, '3', true);
  await p.waitForTimeout(500);
  await p.mouse.wheel(0, 520); await p.waitForTimeout(800);
  await tap(p, '기록 저장');
  await p.waitForTimeout(2400);
});

// ── 컷2: 기간을 바꾸면 그래프가 다시 그려진다 ──
//    대상자 전환(도도)은 넣지 않는다 — 도도는 체온 기록이 없어 그래프가 비고,
//    빈 화면으로 끝나는 클립은 안 쓰느니만 못하다.
await record('chart', 7.4, async (p) => {
  await p.waitForTimeout(400);
  await tapTab(p, 2);
  await p.waitForTimeout(1600);
  await tap(p, '7일', true); await p.waitForTimeout(1500);
  await tap(p, '14일', true); await p.waitForTimeout(1800);
});

// ── 컷3: 병원 제출용 레포트 미리보기 ──
await record('report', 7.0, async (p) => {
  await p.waitForTimeout(400);
  await tapTab(p, 3);
  await p.waitForTimeout(2200);
  await p.mouse.wheel(0, 300); await p.waitForTimeout(2000);
  await p.mouse.wheel(0, 260); await p.waitForTimeout(1800);
});

await ctx.close();
await browser.close();

// ── webm → PNG 시퀀스 ──
// 이 ffmpeg 는 최소 빌드라 fps 필터가 없다. 출력 옵션 -r 로 대신한다.
const seqRoot = join(work, 'seq');
for (const c of clips) {
  const dir = join(seqRoot, c.name);
  mkdirSync(dir, { recursive: true });
  const r = spawnSync(FFMPEG, [
    '-y', '-loglevel', 'error',
    '-ss', String(c.start), '-t', String(c.duration),
    '-i', c.path,
    '-r', String(FPS), '-vf', `scale=${VP.width}:${VP.height}`,
    join(dir, '%04d.png'),
  ], { encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
  console.log(`프레임 [${c.name}] ${readdirSync(dir).length}장`);
}

// ── PNG 시퀀스 → 애니메이션 WebP + 정지 포스터 ──
const py = spawnSync('python3', [
  join(ROOT, 'scripts', 'assemble-beta-clips.py'),
  seqRoot, join(ROOT, 'web', 'beta-media'), String(Math.round(1000 / FPS)),
], { stdio: 'inherit' });
rmSync(work, { recursive: true, force: true });
if (py.status !== 0) process.exit(py.status ?? 1);
console.log('\n다음: python3 scripts/build-beta.py');
