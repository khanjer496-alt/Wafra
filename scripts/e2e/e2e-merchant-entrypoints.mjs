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
const businessIncomeFils = 123456789; // Million-scale synthetic income, not a user's ledger.
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
// Native-stack screens stay mounted. Scroll clear of the floating tab bar,
// then hit-test so a matching income row behind the current screen cannot win.
async function tapOnTop(locator) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    for (const target of await locator.all()) {
      await target.scrollIntoViewIfNeeded({ timeout: 500 }).catch(() => {});
      const onTop = await target.evaluate(node => {
        for (let i = 0; i < 4; i++) {
          const over = node.getBoundingClientRect().bottom - (innerHeight - 120);
          if (over <= 0) break;
          let parent = node.parentElement;
          while (parent && !(parent.scrollHeight > parent.clientHeight + 4 && parent.clientHeight > 200)) parent = parent.parentElement;
          if (!parent) break;
          parent.scrollTop += over + 12;
        }
        const rect = node.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0 || rect.top < 0 || rect.bottom > innerHeight) return false;
        const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return !!top && (node.contains(top) || top.contains(node));
      }).catch(() => false);
      if (onTop) { await target.click(); return; }
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`No uncovered target: ${locator}`);
}
const active = (page, id) => page.locator(`[data-testid="${id}"]:visible`).last();
const selectedFill = tab => tab.evaluate(node => {
  const fill = getComputedStyle(node).backgroundColor;
  return fill !== 'transparent' && fill !== 'rgba(0, 0, 0, 0)';
});
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
      await page.evaluate(({ language, businessIncomeFils }) => {
        const key = 'wafra/state/v1'; const meta = JSON.parse(localStorage.getItem(key));
        const now = new Date(); const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const prior = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const old = `${prior.getFullYear()}-${String(prior.getMonth() + 1).padStart(2, '0')}-01`;
        const row = (id, amountFils, fields = {}) => ({ id, title: 'Careem', amountFils, type: 'expense',
          category: 'transport', accountId: 'bank', date, source: 'manual', userEdited: true, ...fields });
        meta.accounts = [{ id: 'bank', name: 'Everyday bank', kind: 'bank', openingFils: 0, color: '#1F6B52' }];
        meta.transactions = [
          row('business', businessIncomeFils, { type: 'income', title: 'Careem Business', category: 'business', ts: Date.parse(date) + 20000 }),
          ...Array.from({ length: 12 }, (_, i) => row(`purchase-${i}`, 101 + i, { ts: Date.parse(date) + i * 1000 })),
          row('previous', 700, { date: old }),
          row('credit', 51, { type: 'income', category: 'other' }),
        ];
        delete meta.txChunks; delete meta.txChunkOrder;
        Object.assign(meta, { hydrated: true, monthStartDay: 1, language, languagePreference: language,
          themePreference: 'system', captureOptOut: true, onboarded: true, privateMode: true,
          historyImport: null, bills: [], cardDues: [], budgets: [], goals: [], merchantOverrides: {} });
        localStorage.setItem(key, JSON.stringify(meta));
      }, { language, businessIncomeFils });
      await page.reload({ waitUntil: 'networkidle' });
      const sourceLabel = `${language === 'ar' ? 'عرض مصدر الدخل' : 'View income source'}: `;
      await tapOnTop(page.getByTestId('home-widget-activity').getByRole('button', { name: `${sourceLabel}Careem Business`, exact: true }));
      await page.waitForURL(/\/merchant\?name=Careem%20Business&type=income$/);
      await active(page, 'merchant-total-received').waitFor({ state: 'visible' });
      assert.equal(minor(await active(page, 'merchant-total-received').innerText()), businessIncomeFils);
      assert.equal(await active(page, 'merchant-total-received').evaluate(node => Array.from(node.querySelectorAll('*'))
        .filter(el => !el.children.length && /[\d٠-٩]/.test(el.textContent || ''))
        .every(el => { const rect = el.getBoundingClientRect();
          return el.scrollWidth <= el.clientWidth + 1 && rect.left >= 0 && rect.right <= innerWidth + 1 && !el.textContent.includes('…'); })), true,
      'the complete million-scale received amount must fit the viewport without clipping or ellipsis');
      assert.equal((await active(page, 'merchant-income-count').innerText()).trim(), '1');
      const incomeOnly = active(page, 'merchant-detail');
      assert.equal(await incomeOnly.getByTestId('merchant-total-spent').count(), 0);
      assert.equal(await incomeOnly.getByTestId('transaction-merchant-link').count(), 0);
      assert.equal(await incomeOnly.getByRole('button', { name: /^Careem Business,/ }).count(), 1);
      assert.equal(await selectedFill(incomeOnly.getByRole('tab', { name: language === 'ar' ? 'الدخل' : 'Income', exact: true })), true);
      assert.ok((await incomeOnly.innerText()).includes(language === 'ar' ? 'حركات الدخل' : 'Income activity'));
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.screenshot({ path: path.join(out, `income-only-${name}.png`) });
      await tapOnTop(page.getByRole('button', { name: language === 'ar' ? 'رجوع' : 'Back', exact: true }));
      await page.waitForURL(url => !url.pathname.includes('/merchant'));
      const merchantLabel = `${language === 'ar' ? 'عرض تفاصيل التاجر' : 'View merchant details'}: Careem`;
      const homeLink = page.getByTestId('home-widget-activity').getByRole('button', { name: merchantLabel, exact: true }).first();
      await tapOnTop(homeLink);
      await page.getByTestId('merchant-total-spent').waitFor({ state: 'visible' });
      assert.equal(new URL(page.url()).pathname, '/merchant');
      assert.equal(new URL(page.url()).searchParams.get('name'), 'Careem');
      assert.equal(minor(await page.getByTestId('merchant-total-spent').innerText()), 1278);
      assert.equal((await page.getByTestId('merchant-purchase-count').innerText()).trim(), '12');
      assert.equal(minor(await page.getByTestId('merchant-money-received').innerText()), 51);
      const details = active(page, 'merchant-detail');
      assert.equal(await details.getByTestId('transaction-merchant-link').count(), 0);
      assert.equal(await details.getByRole('button', { name: /^Careem,/ }).count(), 6);
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.screenshot({ path: path.join(out, `direct-merchant-${name}.png`) });

      // Changing the existing global period updates counts and totals, not just
      // a heading. The following Activity handoff must retain that same scope.
      await tapOnTop(active(page, 'merchant-period').getByRole('button'));
      const dialog = page.locator('[role="dialog"]:visible').last();
      await dialog.getByRole('button', { name: language === 'ar' ? 'كل الفترات' : 'All time', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.querySelector('[data-testid="merchant-purchase-count"]')?.textContent === '13');
      assert.equal(minor(await page.getByTestId('merchant-total-spent').innerText()), 1978);
      const viewAll = active(page, 'merchant-view-all-transactions').getByRole('button');
      await tapOnTop(viewAll);
      await page.waitForURL(/\/transactions\?type=all&merchant=Careem$/);
      assert.equal(new URL(page.url()).searchParams.get('type'), 'all');
      const activitySearch = page.getByPlaceholder(language === 'ar' ? 'التاجر أو الفئة' : 'Merchant or category', { exact: true });
      await activitySearch.waitFor({ state: 'visible' });
      assert.equal(await activitySearch.isEditable(), true);
      assert.equal(await activitySearch.getAttribute('aria-label'), language === 'ar' ? 'ابحث في المتاجر أو التصنيفات' : 'Search merchants or categories');
      const body = await page.locator('body').innerText();
      assert.ok(!body.includes('Careem Business'), 'An exact merchant filter cannot include a similar business name');
      const creditDetails = page.getByRole('button', { name: language === 'ar'
        ? /Careem,.*زائد 0\.51 AED$/ : /Careem,.*plus 0\.51 AED$/ });
      await tapOnTop(creditDetails);
      await page.locator('[role="dialog"]:visible').last().waitFor({ state: 'visible' });
      await tapOnTop(page.locator('[role="dialog"]:visible').last().getByRole('button', {
        name: `${language === 'ar' ? 'عرض حركات الدخل' : 'View income activity'}: Careem`, exact: true }));
      await page.waitForURL(/\/merchant\?name=Careem&type=income$/);
      await active(page, 'merchant-total-received').waitFor({ state: 'visible' });
      assert.equal(minor(await active(page, 'merchant-total-received').innerText()), 51);
      assert.equal((await active(page, 'merchant-income-count').innerText()).trim(), '1');
      const mixedIncome = active(page, 'merchant-detail');
      assert.equal(await mixedIncome.getByRole('button', { name: /^Careem,/ }).count(), 1);
      assert.equal(await selectedFill(mixedIncome.getByRole('tab', { name: language === 'ar' ? 'الدخل' : 'Income', exact: true })), true);
      await page.screenshot({ path: path.join(out, `income-mixed-${name}.png`) });
      const incomeFooter = active(page, 'merchant-view-all-transactions').getByRole('button');
      assert.equal(await incomeFooter.getAttribute('aria-label'), language === 'ar' ? 'عرض كل الدخل' : 'View all income');
      await tapOnTop(incomeFooter);
      await page.waitForURL(/\/transactions\?type=income&merchant=Careem$/);
      await tapOnTop(page.getByRole('button', { name: `${sourceLabel}Careem`, exact: true }));
      await page.waitForURL(/\/merchant\?name=Careem&type=income$/);
      assert.equal(minor(await active(page, 'merchant-total-received').innerText()), 51);
      await tapOnTop(active(page, 'merchant-detail').getByRole('tab', { name: language === 'ar' ? 'كل الحركات' : 'All activity', exact: true }));
      await tapOnTop(active(page, 'merchant-view-all-transactions').getByRole('button'));
      await page.waitForURL(/\/transactions\?type=all&merchant=Careem$/);
      await tapOnTop(page.getByRole('button', { name: merchantLabel, exact: true }));
      await page.waitForURL(/\/merchant\?name=Careem$/);
      const activeTotal = page.locator('[data-testid="merchant-total-spent"]:visible').last();
      await activeTotal.waitFor({ state: 'visible' });
      assert.equal(minor(await activeTotal.innerText()), 1978);
      assert.equal(await selectedFill(active(page, 'merchant-detail').getByRole('tab', { name: language === 'ar' ? 'المصروفات' : 'Spending', exact: true })), true,
        'reopening the same source as an expense must restore the spending view');
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
