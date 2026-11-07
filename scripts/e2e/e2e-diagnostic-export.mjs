import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:8191';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(BASE).hostname));
const out = path.resolve('artifacts/e2e-diagnostic-export');
await mkdir(out, { recursive: true });
const browser = await chromium.launch(); const results = [];
try {
  for (const [lang, theme, width] of [['en', 'dark', 390], ['ar', 'light', 320]]) {
    const context = await browser.newContext({ viewport: { width, height: 880 },
      locale: lang === 'ar' ? 'ar-AE' : 'en-AE', colorScheme: theme, reducedMotion: 'reduce', acceptDownloads: true });
    await context.route('**/*', route => route.request().url().startsWith(BASE + '/') ? route.continue() : route.abort());
    const page = await context.newPage(); const errors = []; const downloads = []; const uploads = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('download', download => downloads.push(download));
    page.on('request', request => {
      if (['POST', 'PUT'].includes(request.method())) uploads.push(request.url());
    });
    const name = `${lang}-${theme}-${width}`;
    try {
      await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
      await page.getByTestId('settings-data-and-help').click();
      await page.waitForURL('**/settings-data');
      await page.getByTestId('settings-data-your-data').waitFor({ state: 'visible' });
      assert.equal(await page.getByTestId('diagnostic-export-row').count(), 0);
      assert.equal(await page.getByTestId('diagnostic-export-sheet').count(), 0);
      for (const label of [/Export data for diagnosis/, /Send test diagnostics/, /تصدير البيانات للتشخيص/, /إرسال تشخيص الاختبار/]) {
        assert.equal(await page.getByRole('button', { name: label }).count(), 0);
      }
      await page.getByRole('button', { name: lang === 'ar' ? /^تصدير العمليات/ : /^Export transactions/ }).waitFor({ state: 'visible' });
      await page.getByRole('button', { name: lang === 'ar' ? /^تقرير المصروفات/ : /^Expense report/ }).waitFor({ state: 'visible' });
      await page.screenshot({ path: path.join(out, `${name}-customer-data.png`) });
      await page.goto(`${BASE}/accuracy`, { waitUntil: 'networkidle' });
      await page.getByTestId('accuracy-screen').waitFor({ state: 'visible' });
      assert.equal(await page.getByTestId('accuracy-share-cards').count(), 0);
      assert.equal(await page.getByTestId('accuracy-share-unread').count(), 0);
      await page.goto(`${BASE}/parser-research`, { waitUntil: 'networkidle' });
      await page.waitForURL('**/settings-data');
      assert.equal(downloads.length, 0, 'customer navigation never creates a diagnostic file');
      assert.deepEqual(uploads, [], 'customer navigation sends no reports');
      assert.deepEqual(errors, []);
      results.push({ name, passed: true }); console.log('PASS ' + name);
    } catch (error) {
      await page.screenshot({ path: path.join(out, `${name}-failure.png`) }).catch(() => {});
      results.push({ name, passed: false, error: String(error), pageErrors: errors }); console.log('FAIL ' + name + ': ' + error);
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
  await writeFile(path.join(out, 'results.json'), JSON.stringify({ results, scope: 'Synthetic web ledger only; no private inbox or real ledger accessed' }, null, 2));
}
assert.ok(results.length === 2 && results.every(row => row.passed));
