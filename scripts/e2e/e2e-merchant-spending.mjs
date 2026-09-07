import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.env.BASE || 'http://127.0.0.1:8126';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'Synthetic local app only');
const out = path.resolve('artifacts/e2e-merchant-spending');
await mkdir(out, { recursive: true });
const results = []; const errors = []; const browser = await chromium.launch();
const minor = value => {
  const text = String(value).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6f0)).replace(/٬/g, ',').replace(/٫/g, '.');
  const match = text.match(/\d[\d,]*(?:\.\d+)?/); assert.ok(match, `Missing money: ${text}`);
  return Math.round(Number(match[0].replace(/,/g, '')) * 100);
};
async function seed(page, language) {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByTestId('reference-home-summary').waitFor({ state: 'visible' });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('wafra/state/v1') || '{}').txChunks > 0);
  // This context is disposable. Replace only its synthetic demo ledger.
  await page.evaluate(lang => {
    const key = 'wafra/state/v1'; const meta = JSON.parse(localStorage.getItem(key));
    const now = new Date(); const month = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2, '0')}`;
    const prior = new Date(now.getFullYear(), now.getMonth()-1, 1);
    const oldMonth = `${prior.getFullYear()}-${String(prior.getMonth()+1).padStart(2, '0')}`;
    meta.accounts = ['bank', 'card', 'hidden'].map(id => ({ id, name: id === 'card' ? 'Everyday card' : id === 'hidden' ? 'Hidden account' : 'Everyday bank',
      kind: id === 'card' ? 'card' : 'bank', openingFils: 0, color: '#1F6B52', archived: id === 'hidden' }));
    const row = (id, amountFils, more = {}) => ({ id, title: 'Careem', amountFils, type: 'expense', accountId: 'bank', category: 'transport',
      date: month + '-01', source: 'manual', userEdited: true, ...more });
    meta.transactions = [row('current-1', 1275), row('current-2', 2226), row('credit', 501, { type: 'income' }),
      row('transfer', 50000, { isTransfer: true }), row('hidden', 10000, { accountId: 'hidden' }),
      row('old', 8000, { date: oldMonth + '-01' }), row('business', 999999, { title: 'Careem Business', type: 'income', category: 'business' }),
      row('other', 7500, { title: 'Carrefour', category: 'groceries' })];
    delete meta.txChunks; delete meta.txChunkOrder;
    Object.assign(meta, { monthStartDay: 1, language: lang, languagePreference: lang, themePreference: 'system',
      captureOptOut: true, onboarded: true, historyImport: null, bills: [], cardDues: [], budgets: [], goals: [],
      notSubscriptions: [], merchantOverrides: {}, privateMode: true });
    localStorage.setItem(key, JSON.stringify(meta));
  }, language);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByTestId('reference-home-summary').waitFor({ state: 'visible' });
}
try {
  for (const [language, mode, width] of [['en', 'light', 390], ['en', 'dark', 390], ['ar', 'light', 320], ['ar', 'dark', 430]]) {
    const name = `${language}-${mode}-${width}`;
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: language === 'ar' ? 'ar-AE' : 'en-AE', colorScheme: mode, reducedMotion: 'reduce' });
    await context.route('**/*', route => {
      const url = route.request().url(); return url.startsWith(base + '/') || url.startsWith('data:') || url.startsWith('blob:') ? route.continue() : route.abort();
    });
    const page = await context.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', e => errors.push(String(e)));
    try {
      await seed(page, language);
      await page.getByRole('button', { name: `${language === 'ar' ? 'عرض تفاصيل التاجر' : 'View merchant details'}: Careem`, exact: true }).first().click();
      await page.getByTestId('merchant-total-spent').waitFor({ state: 'visible' });
      assert.equal(minor(await page.getByTestId('merchant-total-spent').innerText()), 3501, 'Direct name/logo tap shows merchant spending');
      assert.equal(await page.getByTestId('merchant-detail').getByTestId('transaction-merchant-link').count(), 0, 'Merchant page has no self-links');
      await page.getByRole('button', { name: language === 'ar' ? 'رجوع' : 'Back', exact: true }).click();
      await page.getByRole('tab', { name: language === 'ar' ? 'الإنفاق' : 'Spending', exact: true }).click();
      await page.getByTestId('browse-merchant-spending').click();
      await page.getByTestId('merchant-directory').waitFor({ state: 'visible' });
      assert.equal(minor(await page.getByTestId('merchant-directory-total').innerText()), 11001);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(out, `directory-${name}.png`) });
      const search = page.getByRole('textbox', { name: language === 'ar' ? 'البحث عن تاجر' : 'Search merchants', exact: true });
      await search.fill('Careem');
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="merchant-spending-row"]').length === 1);
      assert.equal(minor(await page.getByTestId('merchant-directory-total').innerText()), 3501);
      await page.getByTestId('merchant-spending-row').click();
      await page.getByTestId('merchant-total-spent').waitFor({ state: 'visible' });
      assert.equal(new URL(page.url()).searchParams.get('name'), 'Careem');
      assert.equal(minor(await page.getByTestId('merchant-total-spent').innerText()), 3501);
      assert.equal((await page.getByTestId('merchant-purchase-count').innerText()).trim(), '2');
      assert.equal(minor(await page.getByTestId('merchant-money-received').innerText()), 501);
      assert.equal(await page.getByTestId('view-merchant-spending').count(), 0, 'No recursive merchant action in profile');
      const background = await page.getByTestId('merchant-detail').evaluate(el => getComputedStyle(el).backgroundColor);
      assert.equal(background, mode === 'dark' ? 'rgb(20, 18, 15)' : 'rgb(244, 241, 234)');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.screenshot({ path: path.join(out, `detail-${name}.png`) });
      await page.getByRole('tab', { name: language === 'ar' ? 'كل الحركات' : 'All activity', exact: true }).click();
      await page.getByText(language === 'ar' ? 'غير مشمولة في إجمالي الإنفاق' : 'Not included in spending totals', { exact: true }).first().waitFor({ state: 'visible' });
      assert.equal(minor(await page.getByTestId('merchant-total-spent').innerText()), 3501, 'Viewing transfers does not inflate spending');
      await page.getByTestId('merchant-period').getByRole('button').click();
      const dialog = page.locator('[role="dialog"]:visible').last();
      await dialog.getByRole('button', { name: language === 'ar' ? 'كل الفترات' : 'All time', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.querySelector('[data-testid="merchant-purchase-count"]')?.textContent === '3');
      assert.equal(minor(await page.getByTestId('merchant-total-spent').innerText()), 11501);
      await page.getByTestId('merchant-view-all-transactions').getByRole('button').click();
      await page.waitForURL(/transactions.*type=all/);
      assert.equal(new URL(page.url()).searchParams.get('merchant'), 'Careem');
      await page.getByRole('button', { name: /^Careem,.*(?:plus|زائد)/ }).first().waitFor({ state: 'visible' });
      await page.getByRole('button', { name: language === 'ar' ? 'رجوع' : 'Back', exact: true }).click();
      await page.getByTestId('merchant-detail').waitFor({ state: 'visible' });
      await page.getByRole('button', { name: language === 'ar' ? 'رجوع' : 'Back', exact: true }).click();
      await page.getByTestId('merchant-directory').waitFor({ state: 'visible' });
      assert.equal(minor(await page.getByTestId('merchant-directory-total').innerText()), 11501, 'Search and all-time period survive Back');
      // Open a recorded entry using the existing transaction route, then its new merchant action.
      await page.goto(base + '/transactions?type=expense&merchant=Careem', { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: /^Careem,/ }).first().click();
      await page.getByTestId('view-merchant-spending').click();
      await page.getByTestId('merchant-total-spent').waitFor({ state: 'visible' });
      assert.equal(await page.locator('[role="dialog"]:visible').count(), 0, 'Entry sheet closes before merchant page');
      assert.equal(new URL(page.url()).pathname, '/merchant');
      results.push({ name, passed: true }); console.log('PASS ' + name);
    } catch (error) {
      results.push({ name, passed: false, error: String(error) });
      await page.screenshot({ path: path.join(out, `failure-${name}.png`) }).catch(() => {});
      console.error('FAIL ' + name, error);
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
  await writeFile(path.join(out, 'results.json'), JSON.stringify({ results, errors, scope: 'Synthetic disposable browser ledgers. Not physical native performance.' }, null, 2));
}
assert.deepEqual(errors, []); assert.ok(results.every(result => result.passed));
console.log(`${results.length} merchant journeys passed`);
