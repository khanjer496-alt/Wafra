import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.env.BASE || 'http://127.0.0.1:8126';
const out = path.resolve(process.env.LOGO_EVIDENCE || 'artifacts/e2e-merchant-logos');
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const requests = [];
const results = [];
const errors = [];
try {
  for (const mode of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: mode, reducedMotion: 'reduce' });
    context.on('request', request => {
      if (/(?:brandfetch\.io|logo\.clearbit\.com|logo\.url|logos\.world)/i.test(new URL(request.url()).hostname)) requests.push(request.url());
    });
    // Do not abort logo requests: a mistaken request must be observed and fail.
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.getByTestId('reference-home-summary').waitFor({ state: 'visible' });
    await page.waitForFunction(() => localStorage.getItem('wafra/state/v1') !== null);
    // Upgrade fixture: previously granted iPhone consent must not restore artwork.
    await page.evaluate(() => {
      const key = 'wafra/state/v1';
      localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key)), onlineLogosEnabled: true, privateMode: false }));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByTestId('reference-home-summary').waitFor({ state: 'visible' });
    assert.ok(await page.getByTestId('monogram-avatar').count() > 0, 'Home shows local merchant initials');
    for (const tab of ['Spending', 'Accounts', 'Bills']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await page.screenshot({ path: path.join(out, `${tab.toLowerCase()}-${mode}.png`) });
      assert.equal(await page.locator('[data-testid^="merchant-logo-"], [data-testid^="bank-logo-"]').count(), 0, 'no brand image tiles');
      assert.equal(await page.getByTestId('settings-online-logos').count(), 0, 'no online-logo switch');
    }
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByTestId('settings-privacy').waitFor();
    assert.equal(await page.getByTestId('settings-online-logos').count(), 0);
    await page.getByRole('button', { name: 'Back', exact: true }).last().click();
    await context.setOffline(true);
    await page.getByRole('tab', { name: 'Home', exact: true }).click();
    assert.ok(await page.getByTestId('monogram-avatar').count() > 0, 'initials still render offline');
    results.push({ name: `${mode}: upgraded consent, Home/Spending/Accounts/Bills/Settings and offline monograms`, passed: true });
    await context.close();
  }
  assert.deepEqual(requests, [], 'store export never requests Brandfetch search or logo CDN artwork');
  assert.deepEqual(errors, []);
  console.log('PASS production store export: no logo provider/CDN requests, no brand assets, no online-logo toggle');
} catch (error) {
  results.push({ name: 'Run failure', passed: false, error: String(error) });
  process.exitCode = 1;
  console.error(error);
} finally {
  await browser.close();
  await writeFile(path.join(out, 'results.json'), JSON.stringify({ results, requests, errors }, null, 2) + '\n');
}
