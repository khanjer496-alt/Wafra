/**
 * Render the App Store product-page header (21:9) and search-results visual
 * (3:2) from the app's real light-mode screens.
 *
 *   EXPO_PUBLIC_WAFRA_E2E_DEMO=1 EXPO_PUBLIC_WAFRA_DEMO_MARKET=global \
 *     npx expo export --clear --platform web --output-dir DIST
 *   node scripts/e2e/serve.mjs DIST 8126 &
 *   node scripts/render-appstore-promo.mjs --market global [--out DIR] [--shots DIR] [--base URL]
 *
 * One export per market: the demo ledger's banks, merchants and currency are
 * baked in at export time (DemoMarket in src/lib/seed.ts). `--market` picks
 * the copy and language and checks the export really is that market.
 *
 *   global  English, USD, every row entered by hand
 *   ae      English, AED (the default demo ledger)
 *   sa      Arabic, SAR, right-to-left
 *
 * Phase 1 captures the seeded demo ledger (synthetic data only) at the 6.9"
 * logical width, 54pt shorter than the panel so an iOS status bar can sit
 * above it without cropping the tab bar. Phase 2 lays those captures into
 * device frames with one headline and the app name, and exports opaque PNGs.
 *
 * Header safe area: Apple crops the 21:9 header to narrower aspect ratios on
 * smaller devices and overlays the app icon, name and Get button along the
 * bottom. Everything that must be read stays inside the centre 60% of the
 * width and the top 72% of the height.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { stripAlpha, readPngHeader } from './e2e/png-rgb.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const BASE = arg('base', process.env.BASE ?? 'http://localhost:8126');
const MARKETS = {
  global: { lang: 'en', currency: /\bUSD\b|\$/ },
  ae: { lang: 'en', currency: /\bAED\b/ },
  sa: { lang: 'ar', currency: /\bSAR\b|ر\.س|ريال/ },
};
const MARKET = arg('market', 'ae');
if (!MARKETS[MARKET]) {
  console.error(`render-appstore-promo: --market must be one of ${Object.keys(MARKETS).join(', ')}`);
  process.exit(1);
}
const { lang: LANG } = MARKETS[MARKET];
const RTL = LANG === 'ar';
const OUT = path.resolve(arg('out', path.join('docs/store-assets/appstore-promo', MARKET)));
fs.mkdirSync(OUT, { recursive: true });
// Intermediate captures are not deliverables; keep them out of the tree.
const SHOTS = path.resolve(arg('shots', fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-promo-'))));
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
fs.mkdirSync(SHOTS, { recursive: true });

const STATUS_PT = 54;
const SCREEN = { width: 440, height: 956 };

/** Light-mode surfaces used in the art. `tab` is the tab bar position. */
const SURFACES = [
  { name: 'home', tab: 0 },
  { name: 'spending', tab: 1 },
  { name: 'bills', tab: 2 },
  { name: 'accounts', tab: 3 },
  { name: 'transactions', path: '/transactions' },
];

async function waitForStable(page) {
  let last = '';
  let steady = 0;
  for (let i = 0; i < 40 && steady < 3; i++) {
    const now = await page.evaluate(() => [...document.querySelectorAll('div,span,svg')].slice(0, 400)
      .map((n) => { const r = n.getBoundingClientRect(); return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}`; })
      .join('|')).catch(() => '');
    steady = now && now === last ? steady + 1 : 0;
    last = now;
    await page.waitForTimeout(150);
  }
}

async function capture(browser) {
  const ctx = await browser.newContext({
    viewport: { width: SCREEN.width, height: SCREEN.height - STATUS_PT },
    deviceScaleFactor: 3,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    // The app follows the system language unless the user overrides it, so
    // the device locale is what actually switches the UI.
    locale: RTL ? 'ar-SA' : 'en-US',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  // Language lives in persisted state; the Settings toggle cannot be probed
  // reliably (see setLanguage in scripts/e2e/capture.mjs).
  const persisted = await page.evaluate((want) => {
    const raw = window.localStorage.getItem('wafra/state/v1');
    if (!raw) return false;
    const meta = JSON.parse(raw);
    meta.language = want;
    window.localStorage.setItem('wafra/state/v1', JSON.stringify(meta));
    return true;
  }, LANG);
  if (!persisted) throw new Error('no persisted demo state: is this an EXPO_PUBLIC_WAFRA_E2E_DEMO export?');
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await waitForStable(page);
  // A wrong export would put one market's ledger under another market's copy.
  const body = await page.evaluate(() => document.body.innerText);
  if (!MARKETS[MARKET].currency.test(body)) {
    throw new Error(`the served export does not show ${MARKET} currency; re-export with EXPO_PUBLIC_WAFRA_DEMO_MARKET=${MARKET}`);
  }
  const meta = {};
  for (const s of SURFACES) {
    if (s.tab !== undefined) {
      await page.goto(`${BASE}/`, { waitUntil: 'networkidle' }).catch(() => {});
      await page.waitForTimeout(250);
      await page.getByRole('tab').nth(s.tab).click().catch(() => {});
    } else {
      await page.goto(BASE + s.path, { waitUntil: 'networkidle' }).catch(() => {});
    }
    await page.waitForTimeout(400);
    await waitForStable(page);
    const file = path.join(SHOTS, `${s.name}.png`);
    fs.writeFileSync(file, stripAlpha(await page.screenshot()));
    // The status bar continues whatever colour the screen's top band is.
    meta[s.name] = await page.evaluate(() => {
      const el = document.elementFromPoint(4, 2);
      let n = el;
      while (n && getComputedStyle(n).backgroundColor === 'rgba(0, 0, 0, 0)') n = n.parentElement;
      return n ? getComputedStyle(n).backgroundColor : 'rgb(244, 241, 234)';
    });
    console.log(`screen ${s.name} ${meta[s.name]}`);
  }
  await ctx.close();
  return meta;
}

// setContent pages are about:blank and cannot read file:// URLs, so inline.
const dataUri = (file, type) => `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;

const isDark = (rgb) => {
  const [r, g, b] = rgb.match(/\d+/g).map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 150;
};

/** A modern iPhone: titanium rail, thin black bezel, Dynamic Island, real status bar. */
function phone(name, bands, { pageWidth, width, x, y, rotate = 0, z = 1, shadow = 1 }) {
  // Right-to-left art is the left-to-right layout mirrored.
  if (RTL) {
    x = pageWidth - x - width;
    rotate = -rotate;
  }
  const band = bands[name];
  const ink = isDark(band) ? '#F7F5F0' : '#16130F';
  const s = width / (SCREEN.width + 24);
  const src = dataUri(path.join(SHOTS, `${name}.png`), 'image/png');
  return `
  <div class="phone" style="left:${x}px;top:${y}px;width:${width}px;transform:rotate(${rotate}deg);z-index:${z};--s:${s};--sh:${shadow}">
    <div class="rail"><div class="bezel"><div class="screen">
      <div class="status" style="background:${band};color:${ink}">
        <span class="time">9:41</span>
        <span class="island"></span>
        <span class="icons">
          <svg viewBox="0 0 18 12" width="18" height="12"><g fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></g></svg>
          <svg viewBox="0 0 16 12" width="16" height="12"><path fill="currentColor" d="M8 2.6c2.3 0 4.4.9 6 2.4l1.1-1.2A10.2 10.2 0 0 0 8 1 10.2 10.2 0 0 0 .9 3.8L2 5c1.6-1.5 3.7-2.4 6-2.4Zm0 3.3c1.4 0 2.6.5 3.6 1.4l1.1-1.2A7 7 0 0 0 8 4.3a7 7 0 0 0-4.7 1.8l1.1 1.2c1-.9 2.2-1.4 3.6-1.4Zm0 3.3c-.6 0-1.1.2-1.5.6L8 11.4l1.5-1.6c-.4-.4-.9-.6-1.5-.6Z"/></svg>
          <svg viewBox="0 0 27 13" width="27" height="13"><rect x=".5" y=".5" width="23" height="12" rx="3.8" fill="none" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="20" height="9" rx="2.5" fill="currentColor"/><path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2Z" fill="currentColor" opacity=".45"/></svg>
        </span>
      </div>
      <img src="${src}" alt="">
    </div></div></div>
  </div>`;
}

const fontFace = (family, file, weight) =>
  `@font-face{font-family:${family};src:url(${dataUri(path.join(ROOT, 'assets/fonts', file), 'font/ttf')});font-weight:${weight}}`;

const MARK = `<svg viewBox="0 0 48 48"><path d="M8 15 L15.5 33 L23 19 L30.5 33 L40 11.5" fill="none" stroke="#F4F1EA" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M34 11.5 H40 V17.5" fill="none" stroke="#F4F1EA" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const CSS = `
${fontFace('Geist', 'Geist-Regular.ttf', 400)}
${fontFace('Geist', 'Geist-Medium.ttf', 500)}
${fontFace('Geist', 'Geist-SemiBold.ttf', 600)}
${RTL ? fontFace('PlexArabic', 'IBMPlexSansArabic-Regular.ttf', 400) : ''}
${RTL ? fontFace('PlexArabic', 'IBMPlexSansArabic-SemiBold.ttf', 600) : ''}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden}
body{font-family:Geist,system-ui,sans-serif;color:#16130F;background:#F4F1EA;position:relative;-webkit-font-smoothing:antialiased}
.bg{position:absolute;inset:0;background:
  radial-gradient(60% 70% at 50% 62%, #FBF9F4 0%, rgba(251,249,244,0) 70%),
  radial-gradient(38% 46% at 82% 18%, rgba(31,107,82,.10) 0%, rgba(31,107,82,0) 70%),
  radial-gradient(34% 40% at 14% 86%, rgba(226,180,90,.16) 0%, rgba(226,180,90,0) 70%),
  #F4F1EA}
.brand{display:flex;align-items:center;gap:.5em}
.brand .icon{width:1.6em;height:1.6em;border-radius:.42em;background:#1F6B52;display:grid;place-items:center;box-shadow:0 .08em .3em rgba(22,19,15,.18)}
.brand .icon svg{width:1.1em;height:1.1em}
.brand b{font-weight:600;letter-spacing:-.01em}
h1{font-weight:600;letter-spacing:-.035em;line-height:1.02}
h1 em{font-style:normal;color:#1F6B52}
.sub{color:#57524A;font-weight:400;letter-spacing:-.005em}
[dir=rtl] body{font-family:PlexArabic,Geist,sans-serif}
[dir=rtl] h1{letter-spacing:0;line-height:1.3}
[dir=rtl] .brand b{letter-spacing:0}
.phone{position:absolute;transform-origin:50% 50%}
.rail{padding:calc(5px*var(--s));border-radius:calc(70px*var(--s));
  background:linear-gradient(135deg,#d9d6cf 0%,#a9a59c 22%,#e9e6df 48%,#8f8b82 76%,#cfccc4 100%);
  box-shadow:0 calc(60px*var(--s)) calc(120px*var(--s)) rgba(22,19,15,calc(.22*var(--sh))),0 calc(14px*var(--s)) calc(30px*var(--s)) rgba(22,19,15,calc(.16*var(--sh)))}
.bezel{padding:calc(7px*var(--s));border-radius:calc(65px*var(--s));background:#0b0b0c}
.screen{position:relative;overflow:hidden;border-radius:calc(58px*var(--s));aspect-ratio:${SCREEN.width}/${SCREEN.height};background:#F4F1EA}
.screen img{position:absolute;left:0;top:${(STATUS_PT / SCREEN.height) * 100}%;width:100%;display:block}
.status{position:absolute;left:0;right:0;top:0;height:${(STATUS_PT / SCREEN.height) * 100}%;display:flex;align-items:center;justify-content:space-between;
  padding:0 calc(34px*var(--s)) 0 calc(52px*var(--s));font-size:calc(17px*var(--s));font-weight:600}
.status .icons{display:flex;gap:calc(6px*var(--s));align-items:center}
.status svg{width:auto;height:calc(12px*var(--s))}
.status .island{position:absolute;left:50%;top:calc(11px*var(--s));transform:translateX(-50%);width:calc(124px*var(--s));height:calc(36px*var(--s));border-radius:999px;background:#000}
`;

/**
 * Headline copy per language. No prices, trial terms or "AI": the art has to
 * stay true in every storefront and through every price change.
 */
const COPY = {
  en: {
    name: 'Wafra',
    a: 'See where your money <em>goes.</em>',
    aSub: 'Spending, bills and savings<br>in one private ledger.',
    b: 'Know your spending.<br><em>Plan what comes next.</em>',
    bSub: 'Budgets, bills and savings in one private ledger.',
    c: 'Every bill and budget, <em>in one place.</em>',
  },
  ar: {
    name: 'وفرة',
    a: 'اعرف أين <em>يذهب مالك.</em>',
    aSub: 'المصاريف والفواتير والادخار<br>في سجل مالي خاص.',
    b: 'اعرف مصاريفك.<br><em>وخطّط لما هو قادم.</em>',
    bSub: 'الميزانيات والفواتير والادخار في سجل مالي خاص.',
    c: 'كل فواتيرك وميزانياتك <em>في مكان واحد.</em>',
  },
};

/** Each composition: a page size in CSS px, a device scale, and its markup. */
function compositions(bands) {
  const t = COPY[LANG];
  // Split layouts anchor their text to the reading-start edge.
  const start = RTL ? 'right' : 'left';
  // Every composition is 1920 CSS px wide; phones mirror across that width.
  const P = (n, o) => phone(n, bands, { pageWidth: 1920, ...o });
  return [
    {
      // Header A: centred headline over a fan of three phones bleeding off the bottom.
      file: 'header-a-3840x1646.png', width: 1920, height: 823, scale: 2,
      html: `<div class="bg"></div>
        <div style="position:absolute;left:0;right:0;top:78px;text-align:center;z-index:5">
          <div class="brand" style="justify-content:center;font-size:26px;margin-bottom:22px"><span class="icon">${MARK}</span><b>${t.name}</b></div>
          <h1 style="font-size:76px">${t.a}</h1>
        </div>
        ${P('spending', { width: 330, x: 610, y: 330, rotate: -7, z: 1 })}
        ${P('bills', { width: 330, x: 980, y: 330, rotate: 7, z: 1 })}
        ${P('home', { width: 360, x: 780, y: 296, z: 3 })}`,
    },
    {
      // Header B: split layout, still inside the centre-safe band.
      file: 'header-b-3840x1646.png', width: 1920, height: 823, scale: 2,
      html: `<div class="bg"></div>
        <div style="position:absolute;${start}:420px;top:180px;width:540px;z-index:5">
          <div class="brand" style="font-size:24px;margin-bottom:26px"><span class="icon">${MARK}</span><b>${t.name}</b></div>
          <h1 style="font-size:64px">${t.b}</h1>
          <p class="sub" style="font-size:24px;margin-top:22px;line-height:1.35">${t.bSub}</p>
        </div>
        ${P('bills', { width: 290, x: 1200, y: 160, rotate: 6, z: 1 })}
        ${P('home', { width: 320, x: 1000, y: 120, z: 3 })}`,
    },
    {
      // Search A: headline left, two phones right.
      file: 'search-a-1920x1280.png', width: 1920, height: 1280, scale: 1,
      html: `<div class="bg"></div>
        <div style="position:absolute;${start}:130px;top:360px;width:720px;z-index:5">
          <div class="brand" style="font-size:34px;margin-bottom:36px"><span class="icon">${MARK}</span><b>${t.name}</b></div>
          <h1 style="font-size:104px">${t.a}</h1>
          <p class="sub" style="font-size:36px;margin-top:34px;line-height:1.35">${t.aSub}</p>
        </div>
        ${P('spending', { width: 470, x: 1360, y: 230, rotate: 5, z: 1 })}
        ${P('home', { width: 500, x: 960, y: 150, z: 3 })}`,
    },
    {
      // Search B: three upright phones, headline on top.
      file: 'search-b-1920x1280.png', width: 1920, height: 1280, scale: 1,
      html: `<div class="bg"></div>
        <div style="position:absolute;left:0;right:0;top:80px;text-align:center;z-index:5">
          <div class="brand" style="justify-content:center;font-size:32px;margin-bottom:26px"><span class="icon">${MARK}</span><b>${t.name}</b></div>
          <h1 style="font-size:92px">${t.c}</h1>
        </div>
        ${P('bills', { width: 430, x: 300, y: 400, z: 2 })}
        ${P('home', { width: 430, x: 745, y: 370, z: 3 })}
        ${P('accounts', { width: 430, x: 1190, y: 400, z: 2 })}`,
    },
  ];
}

const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
try {
  const bands = await capture(browser);
  let bad = 0;
  for (const c of compositions(bands)) {
    for (const scale of c.file.startsWith('search') ? [1, 2] : [c.scale]) {
      const file = scale === c.scale ? c.file : c.file.replace('1920x1280', '3840x2560');
      const ctx = await browser.newContext({ viewport: { width: c.width, height: c.height }, deviceScaleFactor: scale });
      const page = await ctx.newPage();
      await page.setContent(`<!doctype html><html lang="${LANG}" dir="${RTL ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>${CSS}</style></head><body>${c.html}</body></html>`, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
      const buf = stripAlpha(await page.screenshot());
      const h = readPngHeader(buf);
      const want = { width: c.width * scale, height: c.height * scale };
      if (h.width !== want.width || h.height !== want.height) { console.log(`! ${file}: ${h.width}x${h.height}`); bad++; }
      fs.writeFileSync(path.join(OUT, file), buf);
      console.log(`art ${file} ${h.width}x${h.height}`);
      await ctx.close();
    }
  }
  if (bad) process.exitCode = 1;
} finally {
  await browser.close();
}
