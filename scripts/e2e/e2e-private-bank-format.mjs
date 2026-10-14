// Fresh-context web presentation checks; native key storage is covered by the
// real screen/runtime host tests and still needs physical-phone validation.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const { createWebSeed } = require('./universal-review-fixtures.cjs');
const base = process.env.BASE ?? 'http://localhost:8897';
const out = process.env.E2E_ARTIFACT_DIR ?? '/tmp/wafra-private-bank-format-ui';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chrome' });
const results = [];
const sample = 'Account notice: USD 42.75 for Cedar Cafe on 2026-10-01. Available balance USD 900.00.';

async function exposed(locator) {
  const element = locator.first();
  await element.waitFor({ state: 'visible' });
  await element.scrollIntoViewIfNeeded();
  return element;
}

try {
  for (const config of [
    { name: 'english-light', language: 'en', theme: 'light', width: 412 },
    { name: 'english-dark-compact', language: 'en', theme: 'dark', width: 320 },
    { name: 'arabic-light', language: 'ar', theme: 'light', width: 390 },
  ]) {
    const context = await browser.newContext({ viewport: { width: config.width, height: 915 }, colorScheme: config.theme });
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin
      ? route.continue() : route.abort());
    const entries = createWebSeed(null, Date.now(), 'USD');
    const seeded = JSON.parse(entries[0][1]);
    Object.assign(seeded, { marketId: 'US', country: 'US', language: config.language,
      languagePreference: config.language, themePreference: config.theme, privateMode: true });
    entries[0][1] = JSON.stringify(seeded);
    await context.addInitScript(entries => {
      if (localStorage.getItem('wafra/private-format-ui-seeded')) return;
      for (const [key, value] of entries) localStorage.setItem(key, value);
      localStorage.setItem('wafra/private-format-ui-seeded', '1');
    }, entries);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.name));
    try {
      await page.goto(`${base}/import-sms`, { waitUntil: 'networkidle' });
      await (await exposed(page.getByTestId('import-teach-format'))).click();
      await page.waitForURL(/\/teach-bank-format$/);
      const source = await exposed(page.getByTestId('format-source'));
      await source.fill(sample);
      const principal = page.getByRole('radio', { name: /USD 42\.75/ });
      const balance = page.getByRole('radio', { name: /USD 900\.00/ });
      await (await exposed(principal)).click();
      await principal.check();
      assert.equal(await principal.isChecked(), true, 'selected amount radio is checked');
      assert.equal(await balance.isDisabled(), true, 'balance radio is disabled');
      await (await exposed(page.getByTestId('format-debit'))).click();
      await (await exposed(page.getByTestId('format-merchant'))).fill('Cedar Cafe');
      await (await exposed(page.getByTestId('format-date'))).fill('2026-10-01');
      const next = await exposed(page.getByTestId('format-next'));
      assert.equal(await next.isDisabled(), true, 'web must not create a device key');
      const localCopy = config.language === 'ar' ? 'يبقى وضع الخصوصية مفعلاً.' : 'Private Mode stays on.';
      assert.ok(await page.getByText(localCopy, { exact: false }).count());
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      assert.equal(await page.evaluate(sample => Object.keys(localStorage).some(key => localStorage.getItem(key)?.includes(sample)), sample), false);
      await page.getByTestId('format-source').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${out}/${config.name}-source.png` });
      await next.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${out}/${config.name}-fields.png` });
      await page.goBack();
      await page.waitForURL(/\/import-sms$/);
      await (await exposed(page.getByTestId('import-teach-format'))).click();
      assert.equal(await (await exposed(page.getByTestId('format-source'))).inputValue(), '', 'leaving clears the sample');
      assert.deepEqual(errors, []);
      results.push({ ...config, passed: true, checks: ['entry', 'amount-selection', 'balance-disabled', 'web-save-disabled', 'private-mode', 'no-overflow', 'no-source-persistence', 'leave-clears', 'no-page-error'] });
      console.log(`PASS ${config.name}`);
    } catch (error) {
      await page.screenshot({ path: `${out}/${config.name}-failure.png` }).catch(() => {});
      results.push({ ...config, passed: false, error: error.message });
      console.error(`FAIL ${config.name}: ${error.message}`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
writeFileSync(`${out}/results.safe.json`, JSON.stringify({ results, physicalPhoneVerified: false }, null, 2));
if (results.some(row => !row.passed)) process.exitCode = 1;
