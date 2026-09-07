import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.env.BASE || 'http://127.0.0.1:8126';
const out = path.resolve(process.env.LOGO_EVIDENCE || 'artifacts/e2e-merchant-logos');
await mkdir(out, { recursive: true });
const results = [];
const browser = await chromium.launch();
const externalImages = [];
const errors = [];
const selector = '[data-testid^="merchant-logo-"]';

async function check(name, action) {
  await action();
  results.push({ name, passed: true });
  console.log('PASS ' + name);
}
async function decoded(scope) {
  const images = scope.locator(selector + ' img');
  // Tab content mounts after the press resolves. Wait for a real image rather
  // than sampling count() on the preceding React commit.
  await images.first().waitFor({ state: 'attached' });
  assert.ok(await images.count() > 0, 'Expected at least one real merchant logo');
  await images.first().evaluate(image => image.decode());
  const sources = await images.evaluateAll(nodes => nodes.map(node => ({
    url: node.currentSrc || node.src, width: node.naturalWidth, height: node.naturalHeight,
  })));
  for (const image of sources) {
    assert.equal(new URL(image.url).origin, new URL(base).origin, 'Logo is a bundled same-origin asset');
    // Decode every image, including rows outside the viewport, before checking.
  }
  await images.evaluateAll(nodes => Promise.all(nodes.map(node => node.decode())));
  assert.ok(await images.evaluateAll(nodes => nodes.every(node => node.naturalWidth === 128 && node.naturalHeight === 128)));
}

try {
  for (const mode of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: mode, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push(String(error)));
    // The demo stays local. In particular, no logo provider may receive a request.
    await context.route('**/*', route => {
      const request = route.request();
      const url = request.url();
      const local = url.startsWith(base + '/') || url.startsWith('data:') || url.startsWith('blob:');
      if (!local && request.resourceType() === 'image') externalImages.push(url);
      return local ? route.continue() : route.abort();
    });
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.getByTestId('reference-home-summary').waitFor({ state: 'visible' });
    await check(`Home ${mode}: bundled logos decode`, () => decoded(page));
    await page.screenshot({ path: path.join(out, `home-${mode}.png`) });

    await page.getByRole('tab', { name: 'Spending', exact: true }).click();
    await page.getByRole('tab', { name: 'Activity', exact: true }).click();
    const activity = page.getByTestId('spending-activity');
    await activity.waitFor({ state: 'visible' });
    await check(`Activity ${mode}: real logos replace category icons`, () => decoded(activity));
    const tile = activity.locator(selector).first();
    const identity = await tile.getAttribute('data-testid');
    const row = tile.locator('xpath=..');
    const merchant = (await row.getAttribute('aria-label')).split(', ')[0];
    const search = page.getByRole('textbox', { name: 'Search spending', exact: true });
    await search.fill(merchant);
    await activity.getByTestId(identity).first().waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(out, `activity-${mode}.png`) });
    await activity.getByTestId(identity).first().locator('xpath=..').click();
    const dialog = page.locator('[role="dialog"]:visible').last();
    await dialog.waitFor({ state: 'visible' });
    await check(`Detail ${mode}: same identity as its transaction row`, async () => {
      await dialog.getByTestId(identity).waitFor({ state: 'visible' });
      await decoded(dialog);
      const size = await dialog.getByTestId(identity).boundingBox();
      assert.equal(size.width, 64); assert.equal(size.height, 64);
    });
    await page.screenshot({ path: path.join(out, `detail-${mode}.png`) });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await search.fill('');

    await page.getByRole('tab', { name: 'Trends', exact: true }).click();
    const trends = page.getByTestId('spending-trends');
    await trends.waitFor({ state: 'visible' });
    await check(`Trends ${mode}: top merchants have logos`, () => decoded(trends));
    await trends.locator(selector).first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, `trends-${mode}.png`) });

    await page.getByRole('tab', { name: 'Bills', exact: true }).click();
    const agenda = page.getByTestId('payment-agenda');
    await agenda.waitFor({ state: 'visible' });
    await check(`Bills ${mode}: payment agenda has logos`, () => decoded(agenda));
    await page.screenshot({ path: path.join(out, `bills-${mode}.png`) });
    await context.setOffline(true);
    await page.getByRole('tab', { name: 'Spending', exact: true }).click();
    await page.getByRole('tab', { name: 'Activity', exact: true }).click();
    await check(`Offline ${mode}: previously displayed logos remain available`, () => decoded(activity));
    await context.close();
  }
  await check('No external image requests', async () => assert.deepEqual(externalImages, []));
  await check('No JavaScript page errors', async () => assert.deepEqual(errors, []));
} catch (error) {
  results.push({ name: 'Run failure', passed: false, error: String(error) });
  for (const context of browser.contexts()) {
    for (const page of context.pages()) await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
  }
  process.exitCode = 1;
  console.error(error);
} finally {
  await browser.close();
  await writeFile(path.join(out, 'results.json'), JSON.stringify({ results, externalImages, errors }, null, 2) + '\n');
}
