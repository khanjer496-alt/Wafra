/**
 * Exercise the finalized, zero-JavaScript landing page, not the Expo dev server.
 * BASE=http://localhost:8186 PLAYWRIGHT_CHANNEL=chrome node scripts/e2e/e2e-marketing.mjs
 * OUT is optional; generated evidence belongs outside shipping source.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.env.BASE ?? 'http://localhost:8186';
const out = process.env.OUT;
if (out) fs.mkdirSync(out, { recursive: true });
const launchOptions = process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH }
  : process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {};
const browser = await chromium.launch({ ...launchOptions, headless: true });
const results = [];

try {
  const context = await browser.newContext({ javaScriptEnabled: false, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const failures = [];
  page.on('requestfailed', (request) => failures.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on('response', (response) => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });

  for (const width of [320, 390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    const response = await page.goto(base, { waitUntil: 'networkidle' });
    assert.equal(response.status(), 200);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('h1').count(), 1);
    assert.equal(await page.locator('script:not([type="application/ld+json"])').count(), 0);
    assert.equal(await page.locator('article').count(), 3);
    assert.equal((await page.locator('h1').innerText()).replace(/\s+/g, ' '), 'Know your spending. Plan what comes next.');

    const metrics = await page.evaluate(() => {
      const main = document.querySelector('main');
      const width = innerWidth;
      const overflow = [...main.querySelectorAll('a,h1,h2,h3,p,article,img,summary')].filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && (rect.right > width + 1 || rect.left < -1);
      }).map((el) => el.tagName + ': ' + el.textContent.slice(0, 60));
      return {
        overflow,
        mainFits: main.scrollWidth <= main.clientWidth + 1,
        font: getComputedStyle(main).fontFamily,
        geist: [...document.fonts].some((face) => face.family === 'Geist' && face.status === 'loaded'),
        mono: [...document.fonts].some((face) => face.family === 'GeistMono' && face.status === 'loaded'),
        arabic: [...document.fonts].some((face) => face.family === 'NotoKufiArabic' && face.status === 'loaded'),
        background: getComputedStyle(main).backgroundColor,
        images: [...document.images].map((img) => ({ loaded: img.complete && img.naturalWidth === 390 && img.naturalHeight === 844, alt: img.alt })),
      };
    });
    assert.deepEqual(metrics.overflow, [], `horizontal overflow at ${width}px`);
    assert.ok(metrics.mainFits, `main overflows at ${width}px`);
    assert.match(metrics.font, /Geist/);
    assert.ok(metrics.geist, 'Geist must actually load without the Expo runtime');
    assert.ok(metrics.mono, 'Geist Mono must load for ledger labels');
    assert.ok(metrics.arabic, 'Noto Kufi Arabic must load for the Arabic wordmark');
    assert.equal(metrics.background, 'rgb(244, 241, 234)');
    assert.equal(metrics.images.length, 2);
    assert.ok(metrics.images.every((img) => img.loaded && img.alt.length > 20));

    if (out) await page.screenshot({ path: path.join(out, `landing-${width}.png`) });
    if (out && [390, 1440].includes(width)) {
      for (const id of ['how-it-works', 'privacy', 'questions']) {
        await page.locator(`#${id}`).evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await page.screenshot({ path: path.join(out, `landing-${width}-${id}.png`) });
      }
    }
    await page.getByRole('link', { name: 'Questions', exact: true }).click();
    const placement = await page.evaluate(() => ({
      question: document.querySelector('#questions').getBoundingClientRect().top,
      nav: document.querySelector('nav').getBoundingClientRect().bottom,
    }));
    assert.ok(placement.question >= placement.nav - 1, 'anchor must clear sticky navigation');
    for (const detail of await page.locator('details').all()) {
      await detail.locator('summary').focus();
      await page.keyboard.press('Enter');
      assert.ok(await detail.evaluate((el) => el.open), 'FAQ must open by keyboard with JavaScript disabled');
      await page.keyboard.press('Enter');
    }
    assert.equal(await page.locator('a[href="https://testflight.apple.com/join/jbwzCgZ6"]').count(), 1);
    assert.equal(await page.locator('a[href="https://github.com/khanjer496-alt/Wafra/releases/download/android-test-9ea4cd8/Wafra-android-9ea4cd8.apk"]').count(), 1);
    results.push({ width, pass: true, ...metrics });
    console.log(`PASS ${width}px: layout, fonts, app previews, navigation, keyboard FAQs, downloads; no page JavaScript`);
  }

  assert.deepEqual(failures, [], 'all landing assets should load');
  await context.close();
} finally {
  await browser.close();
  if (out) fs.writeFileSync(path.join(out, 'marketing-checks.json'), JSON.stringify(results, null, 2));
}
