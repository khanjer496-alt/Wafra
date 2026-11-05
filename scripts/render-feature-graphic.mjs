/**
 * Render a Google Play feature graphic (1024x500) from the brand assets.
 *
 * Play's feature graphic is marketing artwork, not device evidence, so unlike
 * launch screenshots it is legitimately generated rather than captured from a
 * signed build. Everything it says must still be true of the shipping app.
 *
 * The output is written as an opaque RGB PNG (colour type 2). Chromium always
 * emits RGBA, and `check-store-assets.mjs` rejects an alpha channel, so the
 * buffer goes through the same `stripAlpha` the screenshot harness uses.
 *
 * Usage:
 *   node scripts/render-feature-graphic.mjs --variant global-en
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { stripAlpha } from './e2e/png-rgb.mjs';

const root = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

/**
 * Brand values sampled from the existing Gulf English graphic so the global
 * set reads as the same family rather than a near miss.
 */
const BRAND = {
  background: '#040a08',
  headline: '#ffffff',
  accent: '#61d1ad',
  subtitle: '#b7c8c1',
};

/**
 * Per-variant copy. The headline is the brand line and stays put; the subtitle
 * is what changes per market, and it must not claim coverage the app does not
 * have. Bank-alert capture is market-specific, so the global graphic leads on
 * statement import, which works everywhere.
 */
const VARIANTS = {
  'global-en': {
    output: 'docs/store-assets/play/global-en-feature-graphic.png',
    lines: ['Know where it goes.', 'Watch it grow.'],
    subtitle: 'Budgets · bills · statement imports',
    badge: 'Private by design',
  },
};

const variantName = arg('variant', 'global-en');
const variant = VARIANTS[variantName];
if (!variant) {
  console.error(`render-feature-graphic: unknown variant ${variantName}`);
  process.exit(1);
}

const dataUri = (file, mime) =>
  `data:${mime};base64,${fs.readFileSync(path.join(root, file)).toString('base64')}`;

const geistSemiBold = dataUri('assets/fonts/Geist-SemiBold.ttf', 'font/ttf');
const geistMedium = dataUri('assets/fonts/Geist-Medium.ttf', 'font/ttf');
const icon = dataUri('assets/images/icon.png', 'image/png');

const html = `<!doctype html>
<meta charset="utf-8">
<style>
  @font-face { font-family: Geist; src: url(${geistSemiBold}); font-weight: 600; }
  @font-face { font-family: Geist; src: url(${geistMedium}); font-weight: 500; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 1024px; height: 500px; overflow: hidden; }
  .canvas {
    position: relative;
    width: 1024px;
    height: 500px;
    background: ${BRAND.background};
    font-family: Geist, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  /* The same off-centre glow and card edge the Gulf graphic carries. */
  .glow {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(760px 520px at 86% 58%, rgba(97, 209, 173, 0.16), transparent 70%),
      radial-gradient(420px 320px at 12% 8%, rgba(97, 209, 173, 0.06), transparent 70%);
  }
  .card {
    position: absolute;
    right: -70px;
    top: 86px;
    width: 300px;
    height: 430px;
    border-radius: 34px;
    transform: rotate(-13deg);
    background: linear-gradient(160deg, #0d1a16 0%, #071310 100%);
    border: 1px solid rgba(97, 209, 173, 0.16);
  }
  .card.back {
    right: 118px;
    top: 150px;
    opacity: 0.55;
    transform: rotate(-13deg) scale(0.94);
  }
  .arc {
    position: absolute;
    right: -160px;
    bottom: -220px;
    width: 760px;
    height: 520px;
    border-radius: 50%;
    border: 1px solid rgba(201, 162, 90, 0.42);
    border-left-color: transparent;
    border-top-color: transparent;
  }
  .content { position: absolute; left: 70px; top: 98px; }
  .lockup { display: flex; align-items: center; gap: 22px; }
  .lockup img { width: 76px; height: 76px; border-radius: 20px; }
  .wordmark { font-size: 50px; font-weight: 600; color: ${BRAND.headline}; letter-spacing: -0.5px; }
  h1 { margin-top: 36px; font-size: 44px; line-height: 1.17; font-weight: 600; letter-spacing: -1.1px; }
  h1 .one { color: ${BRAND.headline}; display: block; }
  h1 .two { color: ${BRAND.accent}; display: block; }
  .subtitle { margin-top: 20px; font-size: 20px; font-weight: 500; color: ${BRAND.subtitle}; }
  .badge {
    display: inline-block;
    margin-top: 26px;
    padding: 11px 22px;
    border-radius: 999px;
    border: 1px solid rgba(97, 209, 173, 0.45);
    color: ${BRAND.accent};
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 1.4px;
    text-transform: uppercase;
  }
</style>
<div class="canvas">
  <div class="glow"></div>
  <div class="card back"></div>
  <div class="card"></div>
  <div class="arc"></div>
  <div class="content">
    <div class="lockup">
      <img src="${icon}" alt="">
      <span class="wordmark">Wafra</span>
    </div>
    <h1><span class="one">${variant.lines[0]}</span><span class="two">${variant.lines[1]}</span></h1>
    <p class="subtitle">${variant.subtitle}</p>
    <span class="badge">${variant.badge}</span>
  </div>
</div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
const shot = await page.screenshot({ type: 'png' });
await browser.close();

const opaque = stripAlpha(shot, [4, 10, 8]);
const out = path.join(root, variant.output);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, opaque);
console.log(`render-feature-graphic: wrote ${variant.output}`);
