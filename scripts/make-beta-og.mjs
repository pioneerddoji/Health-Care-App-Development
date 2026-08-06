// ─────────────────────────────────────────────────────────────
// SNS 공유 카드(og:image) 1200×630 을 만든다 → web/beta-media/og.png
//
//   node scripts/make-beta-og.mjs
//
// 왜 Chromium 으로 그리는가
//   이 환경에는 PIL 이 쓸 수 있는 한글 폰트가 없다(DejaVu/Liberation 뿐).
//   브라우저는 한글을 제대로 렌더하므로 HTML 을 그려 캡처한다. 덤으로 베타
//   페이지와 같은 토큰을 쓰게 되어 카드와 착지 페이지가 따로 놀지 않는다.
//
// 소재는 체온 그래프 화면이다 — 링크 카드는 1초 안에 "무슨 앱인지"가
// 읽혀야 하고, 이 제품에서 그 역할을 하는 화면은 그래프다.
// ─────────────────────────────────────────────────────────────
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = new URL('..', import.meta.url).pathname;
const MEDIA = join(ROOT, 'web', 'beta-media');
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const poster = readFileSync(join(MEDIA, 'chart-poster.webp')).toString('base64');

const html = `<!doctype html><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body {
    width: 1200px; height: 630px; display: flex; align-items: center; gap: 64px;
    padding: 0 72px; background: #000; color: #fff; overflow: hidden;
    font-family: 'Pretendard Variable', Pretendard, 'Apple SD Gothic Neo',
                 'Noto Sans KR', 'Malgun Gothic', system-ui, sans-serif;
    word-break: keep-all;
  }
  .copy { flex: 1 1 auto; display: flex; flex-direction: column; gap: 26px; align-items: flex-start; }
  .tag {
    font-size: 21px; font-weight: 700; color: #76b900;
    border: 2px solid #76b900; padding: 7px 16px; border-radius: 2px;
  }
  h1 { font-size: 56px; line-height: 1.2; letter-spacing: -0.03em; font-weight: 800; }
  .sub { font-size: 24px; line-height: 1.5; color: rgba(255,255,255,0.72); }
  .brand { display: flex; align-items: center; gap: 10px; font-size: 22px; font-weight: 700; margin-top: 6px; }
  .brand .mark { color: #76b900; }
  .phone {
    flex: none; width: 300px; height: 560px; overflow: hidden;
    border: 9px solid #0d0d0d; border-radius: 34px;
    box-shadow: 0 0 0 1px #4a4a4a, 0 24px 60px rgba(0,0,0,0.7);
  }
  .phone img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top; }
</style>
<div class="copy">
  <span class="tag">베타 테스터 100명 모집</span>
  <h1>열이 39도까지 올랐던 게<br>화요일이었나, 수요일이었나</h1>
  <p class="sub">매일 한 줄이면, 진료실에서 그대로 꺼낼 수 있습니다</p>
  <div class="brand">케어<span class="mark">노트</span></div>
</div>
<div class="phone"><img src="data:image/webp;base64,${poster}" alt=""></div>`;

const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'load' });
await page.waitForTimeout(600);
mkdirSync(MEDIA, { recursive: true });
await page.screenshot({ path: join(MEDIA, 'og.png') });
await browser.close();
console.log('web/beta-media/og.png (1200×630)');
