import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
    const page = await context.newPage(); const errors = []; const downloads = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('download', download => downloads.push(download));
    const name = `${lang}-${theme}-${width}`;
    try {
      await page.goto(`${BASE}/settings?section=data`, { waitUntil: 'networkidle' });
      const label = lang === 'ar' ? 'تصدير البيانات للتشخيص' : 'Export data for diagnosis';
      await page.getByRole('button', { name: label, exact: true }).click();
      const sheet = page.getByTestId('diagnostic-export-sheet');
      await sheet.waitFor({ state: 'visible' });
      assert.equal(downloads.length, 0, 'opening Settings/consent never exports');
      assert.match(await sheet.innerText(), lang === 'ar' ? /مبالغ|المبالغ/ : /private merchant names/);
      await sheet.getByRole('button', { name: lang === 'ar' ? 'تحضير ملف التشخيص' : 'Prepare diagnostic file', exact: true }).click();
      const share = sheet.getByRole('button', { name: lang === 'ar' ? 'مشاركة ملف التشخيص' : 'Share diagnostic file', exact: true });
      await share.waitFor({ state: 'visible' });
      assert.equal(downloads.length, 0, 'prepared data stays local until Share');
      await page.screenshot({ path: path.join(out, `${name}-ready.png`) });
      const ready = page.waitForEvent('download'); await share.click();
      const download = await ready;
      assert.equal(download.suggestedFilename(), 'wafra-diagnostics.json');
      const data = JSON.parse(await readFile(await download.path(), 'utf8'));
      assert.equal(data.schema, 'wafra-diagnostics-v1');
      assert.equal(data.delivery.uploadedByWafra, false);
      assert.ok(data.transactions.length > 10, 'all synthetic demo records included');
      assert.equal(data.transactions.length, data.coverage.transactionCount);
      assert.ok(data.transactions.every(row => row.raw === undefined));
      assert.ok(data.transactions.some(row => row.diagnostic.logo.id));
      assert.ok(data.monthlyTotals.length > 1, 'export is not restricted to displayed period');
      assert.deepEqual(data.bankMessages, []);
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
