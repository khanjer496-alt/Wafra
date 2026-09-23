/**
 * Check a finalized marketing export with JavaScript disabled.
 * Serve directory indexes, for example:
 *   python3 -m http.server 8194 --bind 127.0.0.1 --directory /tmp/wafra-marketing
 *   BASE=http://127.0.0.1:8194 PLAYWRIGHT_CHANNEL=chrome node scripts/e2e/e2e-public-pages.mjs
 * OUT optionally saves screenshots and JSON evidence outside source.
 * To verify Pages routing locally, serve via `wrangler pages dev <export>` and
 * set EXPECT_NOT_FOUND_STATUS=1. This does not prove a deployed host's state.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.env.BASE ?? 'http://127.0.0.1:8194';
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
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['privacy/', 'terms/', 'support/', '404.html']) {
      const response = await page.goto(`${base}/${route}`, { waitUntil: 'networkidle' });
      assert.equal(response.status(), 200, `generated document ${route} is served`);
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator('h1').count(), 1);
      assert.equal(await page.locator('main').count(), 1);
      assert.equal(await page.locator('script').count(), 0);
      assert.equal(await page.locator('html').getAttribute('lang'), 'en');
      const metrics = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        fontLoaded: [...document.fonts].some((font) => font.family === 'Geist' && font.status === 'loaded'),
        headingsOutsideViewport: [...document.querySelectorAll('h1,h2,h3')].some((heading) => {
          const box = heading.getBoundingClientRect();
          return box.left < 0 || box.right > innerWidth + 1;
        }),
      }));
      assert.equal(metrics.overflow, false, `${route} overflow at ${width}px`);
      assert.equal(metrics.headingsOutsideViewport, false, `${route} headings fit at ${width}px`);
      assert.equal(metrics.fontLoaded, true);
      for (const name of ['Privacy', 'Terms', 'Support']) {
        assert.equal(await page.getByRole('navigation').getByRole('link', { name, exact: true }).count(), 1);
      }
      if (route === 'privacy/') {
        assert.match(await page.locator('main').innerText(), /Launch draft\./);
        assert.equal(await page.locator('ol').count(), 1);
        assert.equal(await page.locator('ol > li').count(), 5);
        assert.match(await page.locator('ol > li').first().innerText(), /Any Sender.*trigger\./s);
      } else if (route === 'terms/') {
        assert.match(await page.locator('aside.notice').innerText(), /Launch draft.*needs counsel review/s);
        assert.match(await page.locator('main').innerText(), /\[\[GOVERNING LAW — PUBLISHER\/COUNSEL TO CONFIRM\]\]/);
      } else if (route === 'support/') {
        assert.equal(await page.getByRole('link', { name: 'support@nasidaapps.com' }).getAttribute('href'), 'mailto:support@nasidaapps.com');
      } else {
        assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex, nofollow, noarchive');
        assert.match(await page.locator('h1').innerText(), /That page is not here/);
      }
      if (out && [320, 1440].includes(width)) {
        await page.screenshot({ path: path.join(out, `${route.replace(/\W/g, '')}-${width}.png`) });
      }
      results.push({ route, width, ...metrics, pass: true });
      console.log(`PASS ${route} at ${width}px: static content, navigation, fonts, layout`);
    }
    await page.getByRole('link', { name: 'Go to Wafra home' }).click();
    assert.match(await page.locator('h1').innerText(), /Know your spending/);
    await page.locator('footer').getByRole('link', { name: 'Support', exact: true }).click();
    assert.match(await page.locator('h1').innerText(), /How can we help/);
    await page.getByRole('link', { name: 'Read deletion details' }).click();
    assert.ok(page.url().endsWith('/privacy/#your-choices-and-deletion'));
    const headingTop = await page.locator('#your-choices-and-deletion').evaluate((heading) => heading.getBoundingClientRect().top);
    assert.ok(headingTop >= 0 && headingTop < 900, 'deletion link scrolls to its heading');
    await page.getByRole('navigation').getByRole('link', { name: 'Support', exact: true }).click();
    await page.getByRole('link', { name: 'Read billing terms' }).click();
    assert.ok(page.url().endsWith('/terms/#wafra-pro-trial-and-billing'));
    const billingTop = await page.locator('#wafra-pro-trial-and-billing').evaluate((heading) => heading.getBoundingClientRect().top);
    assert.ok(billingTop >= 0 && billingTop < 900, 'billing link scrolls to its heading');
  }
  assert.deepEqual(failures, [], 'public document assets should load');
  if (process.env.EXPECT_NOT_FOUND_STATUS === '1') {
    for (const route of ['/wafra-missing-page', '/privacy/wafra-missing-page', '/missing/nested/page']) {
      const response = await context.request.get(`${base}${route}`);
      assert.equal(response.status(), 404, `${route} returns a genuine HTTP 404`);
      const html = await response.text();
      assert.match(html, /That page is not here\./);
      assert.match(html, /name="robots" content="noindex, nofollow, noarchive"/);
      assert.ok(!/<script\b/i.test(html));
      results.push({ route, status: response.status(), pass: true });
      console.log(`PASS ${route}: HTTP 404 with the static recovery document`);
    }
  }
  await context.close();
} finally {
  await browser.close();
  if (out) fs.writeFileSync(path.join(out, 'public-page-checks.json'), JSON.stringify(results, null, 2));
}
