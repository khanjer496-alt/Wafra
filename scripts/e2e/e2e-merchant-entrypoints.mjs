// Direct merchant taps and the bounded-preview handoff, against an actual
// exported app. Every run uses a fresh synthetic browser context, never a
// phone or a user's saved ledger. No external services may receive fixtures.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.env.BASE || 'http://127.0.0.1:8146';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname));
const out = path.resolve('artifacts/e2e-merchant-entrypoints');
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const results = [];
const minor = value => {
  const normalized = String(value).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6f0)).replace(/٬/g, ',').replace(/٫/g, '.');
  const number = normalized.match(/\d[\d,]*(?:\.\d+)?/);
  assert.ok(number, `Missing displayed amount: ${normalized}`);
  return Math.round(Number(number[0].replaceAll(',', '')) * 100);
};
try {
  for (const [language, mode, width] of [['en', 'light', 390], ['ar', 'dark', 320]]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: mode,
      locale: language === 'ar' ? 'ar-AE' : 'en-AE', reducedMotion: 'reduce' });
    const page = await context.newPage(); const errors = []; const name = `${language}-${mode}-${width}`;
    page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push(String(error)));
    await context.route('**/*', route => {
      const url = route.request().url();
      return url.startsWith(`${base}/`) || /^(?:data:|blob:)/.test(url) ? route.continue() : route.abort();
    });
    try {
      await page.goto(base, { waitUntil: 'networkidle' });
      await page.getByTestId('reference-home-summary').waitFor({ state: 'visible' });
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('wafra/state/v1') || '{}').txChunks > 0);
      await page.evaluate(language => {
        const key = 'wafra/state/v1'; const meta = JSON.parse(localStorage.getItem(key));
        const now = new Date(); const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const prior = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const old = `${prior.getFullYear()}-${String(prior.getMonth() + 1).padStart(2, '0')}-01`;
        const row = (id, amountFils, fields = {}) => ({ id, title: 'Careem', amountFils, type: 'expense',
          category: 'transport', accountId: 'bank', date, source: 'manual', userEdited: true, ...fields });
        meta.accounts = [{ id: 'bank', name: 'Everyday bank', kind: 'bank', openingFils: 0, color: '#1F6B52' }];
        meta.transactions = [
          ...Array.from({ length: 12 }, (_, i) => row(`purchase-${i}`, 101 + i, { ts: Date.parse(date) + i * 1000 })),
          row('previous', 700, { date: old }),
          row('credit', 51, { type: 'income', category: 'other' }),
          row('business', 999999, { type: 'income', title: 'Careem Business', category: 'business' }),
        ];
        delete meta.txChunks; delete meta.txChunkOrder;
        Object.assign(meta, { hydrated: true, monthStartDay: 1, language, languagePreference: language,
          themePreference: 'system', captureOptOut: true, onboarded: true, privateMode: true,
          historyImport: null, bills: [], cardDues: [], budgets: [], goals: [], merchantOverrides: {} });
        localStorage.setItem(key, JSON.stringify(meta));
      }, language);
      await page.reload({ waitUntil: 'networkidle' });
      const merchantLabel = `${language === 'ar' ? 'عرض تفاصيل التاجر' : 'View merchant details'}: Careem`;
      const homeLink = page.getByTestId('journal-activity').getByRole('button', { name: merchantLabel, exact: true }).first();
      await homeLink.click();
      await page.getByTestId('merchant-total-spent').waitFor({ state: 'visible' });
      assert.equal(new URL(page.url()).pathname, '/merchant');
      assert.equal(new URL(page.url()).searchParams.get('name'), 'Careem');
      assert.equal(minor(await page.getByTestId('merchant-total-spent').innerText()), 1278);
      assert.equal((await page.getByTestId('merchant-purchase-count').innerText()).trim(), '12');
      assert.equal(minor(await page.getByTestId('merchant-money-received').innerText()), 51);
      const details = page.getByTestId('merchant-detail');
      assert.equal(await details.getByTestId('transaction-merchant-link').count(), 0);
      assert.equal(await details.getByRole('button', { name: /^Careem,/ }).count(), 6);
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.screenshot({ path: path.join(out, `direct-merchant-${name}.png`) });

      // Changing the existing global period updates counts and totals, not just
      // a heading. The following Activity handoff must retain that same scope.
      await page.getByTestId('merchant-period').getByRole('button').click();
      const dialog = page.locator('[role="dialog"]:visible').last();
      await dialog.getByRole('button', { name: language === 'ar' ? 'كل الفترات' : 'All time', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.querySelector('[data-testid="merchant-purchase-count"]')?.textContent === '13');
      assert.equal(minor(await page.getByTestId('merchant-total-spent').innerText()), 1978);
      const viewAll = page.getByTestId('merchant-view-all-transactions').getByRole('button');
      await viewAll.scrollIntoViewIfNeeded(); await viewAll.click();
      await page.waitForURL(/\/transactions\?type=all&merchant=Careem$/);
      assert.equal(new URL(page.url()).searchParams.get('type'), 'all');
      const activitySearch = page.getByPlaceholder(language === 'ar' ? 'التاجر أو الفئة' : 'Merchant or category', { exact: true });
      await activitySearch.waitFor({ state: 'visible' });
      assert.equal(await activitySearch.isEditable(), true);
      assert.equal(await activitySearch.getAttribute('aria-label'), language === 'ar' ? 'ابحث في المتاجر أو التصنيفات' : 'Search merchants or categories');
      const body = await page.locator('body').innerText();
      assert.ok(!body.includes('Careem Business'), 'An exact merchant filter cannot include a similar business name');
      await page.getByRole('button', { name: language === 'ar'
        ? /Careem,.*زائد 0\.51 AED$/ : /Careem,.*plus 0\.51 AED$/ }).waitFor({ state: 'visible' });
      // The exact-name detail button remains distinct from direct merchant links.
      // Previous native-stack screens stay mounted on web; never resolve the
      // hidden Home row instead of the active Activity result.
      const transaction = page.locator('[data-testid="transaction-details-link"]:visible').first();
      await transaction.click();
      await page.locator('[role="dialog"]:visible').last().waitFor({ state: 'visible' });
      await page.locator('[role="dialog"]:visible').last()
        .getByRole('button', { name: language === 'ar' ? 'إغلاق' : 'Close', exact: true }).click();
      await page.getByRole('button', { name: merchantLabel, exact: true }).first().click();
      await page.waitForURL(/\/merchant\?name=Careem$/);
      const activeTotal = page.locator('[data-testid="merchant-total-spent"]:visible').last();
      await activeTotal.waitFor({ state: 'visible' });
      assert.equal(minor(await activeTotal.innerText()), 1978);
      assert.deepEqual(errors, []);
      results.push({ name, passed: true }); console.log('PASS ' + name);
    } catch (error) {
      await page.screenshot({ path: path.join(out, `failure-${name}.png`) }).catch(() => {});
      results.push({ name, passed: false, error: String(error) }); console.error('FAIL ' + name, error);
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
  await writeFile(path.join(out, 'results.json'), JSON.stringify({ results,
    scope: 'Synthetic browser data. Native-device performance and refunds are not certified.' }, null, 2));
}
assert.ok(results.length === 2 && results.every(row => row.passed), 'Direct merchant journey failed');
