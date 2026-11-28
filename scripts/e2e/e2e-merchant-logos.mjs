import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

// 1.0.2: merchant and bank logos come from Brandfetch, on by default with no
// switch, skipped only with the saved local-only preference. Brandfetch is
// stubbed here: the test sees every request the app makes and answers it, so
// no request leaves the machine and a mistaken one still fails the run.
const base = process.env.BASE || 'http://127.0.0.1:8126';
const out = path.resolve(process.env.LOGO_EVIDENCE || 'artifacts/e2e-merchant-logos');
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const results = [];
const errors = [];
const searches = [];
const cdnRequests = [];
const otherLogoHosts = [];
// A 1x1 transparent PNG stands in for CDN artwork.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==', 'base64');
const logoTiles = '[data-testid^="merchant-logo-brandfetch"], [data-testid^="bank-logo-"]';

async function open(mode, patch, { searchFails = false, imageFails = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: mode, reducedMotion: 'reduce' });
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname === 'api.brandfetch.io') {
      searches.push(request.url());
      if (searchFails) return route.fulfill({ status: 503, body: '' });
      const name = decodeURIComponent(url.pathname.replace(/^\/v2\/search\//, ''));
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'example';
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify([{ name, domain: `${slug}.com`, claimed: true }]) });
    }
    if (url.hostname === 'cdn.brandfetch.io') {
      cdnRequests.push(request.url());
      return imageFails ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    }
    if (/(?:logo\.clearbit\.com|logo\.dev|logos\.world|google\.com\/s2)/i.test(url.hostname)) otherLogoHosts.push(request.url());
    const local = url.origin === new URL(base).origin || ['data:', 'blob:'].includes(url.protocol);
    return local ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.getByTestId('reference-home-summary').waitFor({ state: 'visible' });
  await page.waitForFunction(() => localStorage.getItem('wafra/state/v1') !== null);
  if (patch) {
    await page.evaluate(values => {
      const key = 'wafra/state/v1';
      localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key)), ...values }));
    }, patch);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('reference-home-summary').waitFor({ state: 'visible' });
  }
  return { context, page };
}

async function check(name, action) {
  await action();
  results.push({ name, passed: true });
  console.log('PASS ' + name);
}

try {
  for (const mode of ['light', 'dark']) {
    // Upgrades: a pre-1.0 saved opt-in value, either way, no longer matters.
    for (const onlineLogosEnabled of [undefined, false, true]) {
      const { context, page } = await open(mode, onlineLogosEnabled === undefined ? null : { onlineLogosEnabled, privateMode: false });
      await check(`${mode}, saved opt-in ${onlineLogosEnabled}: online logos load by default`, async () => {
        await page.locator(logoTiles).first().waitFor({ state: 'attached' });
        const image = page.locator('[data-testid^="merchant-logo-brandfetch"] img').first();
        await image.waitFor({ state: 'attached' });
        assert.match(await image.getAttribute('src'), /^https:\/\/cdn\.brandfetch\.io\/domain\//);
      });
      await page.screenshot({ path: path.join(out, `home-${mode}-${onlineLogosEnabled}.png`) });
      await context.close();
    }
    const privateRun = await open(mode, { privateMode: true });
    const before = searches.length + cdnRequests.length;
    await check(`${mode}: saved local-only preference keeps letters and sends nothing`, async () => {
      for (const tab of ['Spending', 'Accounts', 'Bills', 'Home']) {
        await privateRun.page.getByRole('tab', { name: tab, exact: true }).click();
        await privateRun.page.waitForTimeout(300);
        assert.equal(await privateRun.page.locator(logoTiles).count(), 0, `${tab}: no remote logo tiles`);
      }
      assert.ok(await privateRun.page.getByTestId('monogram-avatar').count() > 0, 'letters render');
      assert.equal(searches.length + cdnRequests.length, before, 'no Brandfetch search or CDN request in local-only mode');
    });
    await privateRun.context.close();

    const searchesBefore = searches.length;
    const failing = await open(mode, null, { searchFails: true });
    await check(`${mode}: a failed lookup falls back to letters`, async () => {
      // Wait until lookups have actually been attempted, then check the result.
      for (let i = 0; i < 50 && searches.length === searchesBefore; i++) await failing.page.waitForTimeout(100);
      assert.ok(searches.length > searchesBefore, 'the failing context did attempt searches');
      await failing.page.waitForLoadState('networkidle');
      assert.equal(await failing.page.locator('[data-testid^="merchant-logo-brandfetch"]').count(), 0);
      assert.ok(await failing.page.getByTestId('monogram-avatar').count() > 0);
      await failing.page.getByRole('button', { name: 'Settings', exact: true }).click();
      await failing.page.getByTestId('settings-privacy').waitFor();
      assert.equal(await failing.page.getByTestId('settings-online-logos').count(), 0, 'no online-logo switch or consent step');
    });
    await failing.context.close();

    const cdnBefore = cdnRequests.length;
    const broken = await open(mode, null, { imageFails: true });
    await check(`${mode}: a logo image that fails to load falls back to letters`, async () => {
      for (let i = 0; i < 50 && cdnRequests.length === cdnBefore; i++) await broken.page.waitForTimeout(100);
      assert.ok(cdnRequests.length > cdnBefore, 'logo images were requested');
      await broken.page.waitForLoadState('networkidle');
      assert.equal(await broken.page.locator('[data-testid^="merchant-logo-brandfetch"] img:visible').count(), 0, 'no broken image tiles');
      assert.ok(await broken.page.getByTestId('monogram-avatar').count() > 0);
    });
    await broken.context.close();
  }
  await check('Brandfetch searches carry only a cleaned name and the client id', async () => {
    assert.ok(searches.length > 0, 'at least one search was observed');
    for (const raw of searches) {
      const url = new URL(raw);
      assert.deepEqual([...url.searchParams.keys()], ['c'], raw);
      const name = decodeURIComponent(url.pathname.replace(/^\/v2\/search\//, ''));
      assert.doesNotMatch(name, /\d{4,}|(?:aed|usd|sar|eur|gbp)\s*[\d.,]+/i, `no account digits or amounts: ${name}`);
    }
  });
  await check('No other logo provider is contacted', async () => assert.deepEqual(otherLogoHosts, []));
  await check('No JavaScript page errors', async () => assert.deepEqual(errors, []));
  console.log('PASS production export: online logos by default, local-only stops them, failures show letters');
} catch (error) {
  results.push({ name: 'Run failure', passed: false, error: String(error) });
  process.exitCode = 1;
  console.error(error);
} finally {
  await browser.close();
  await writeFile(path.join(out, 'results.json'), JSON.stringify({ results, searches, cdnRequests, otherLogoHosts, errors }, null, 2) + '\n');
}
