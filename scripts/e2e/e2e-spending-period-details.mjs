import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

// Run against a freshly exported EXPO_PUBLIC_WAFRA_E2E_DEMO=1 app.
// All storage belongs to disposable browser contexts, never a user's ledger.
const base = (process.env.BASE ?? 'http://localhost:8126').replace(/\/$/, '');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'Local synthetic export only');
const out = path.resolve(process.env.OUT ?? 'artifacts/e2e-spending-period-details');
await mkdir(out, { recursive: true });
const executablePath = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(executablePath) ? { executablePath } : {});
const results = []; const errors = [];
let assertions = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); assertions++; };
const minor = value => {
  const normalized = String(value).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6f0))
    .replace(/[\u061c\u200e\u200f]/g, '').replace(/٬/g, ',').replace(/٫/g, '.');
  const number = normalized.match(/\d[\d,]*(?:\.\d{1,2})?/);
  assert.ok(number, `Missing exact amount: ${value}`);
  return Math.round(Number(number[0].replaceAll(',', '')) * 100);
};

// Mounted screens and the floating tabs require both scrolling and hit-testing.
async function expose(locator) {
  await locator.scrollIntoViewIfNeeded();
  await locator.evaluate(node => {
    for (let i = 0; i < 4; i++) {
      const rect = node.getBoundingClientRect();
      const overflow = rect.bottom - (innerHeight - 130);
      if (overflow <= 0) break;
      let parent = node.parentElement;
      while (parent && !(parent.scrollHeight > parent.clientHeight + 4 && parent.clientHeight > 160)) parent = parent.parentElement;
      if (!parent) break;
      parent.scrollTop += overflow + 16;
    }
  });
}
async function tap(locator) {
  for (const candidate of (await locator.all()).reverse()) {
    if (!await candidate.isVisible()) continue;
    await expose(candidate);
    const top = await candidate.evaluate(node => {
      const r = node.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !!hit && (node.contains(hit) || hit.contains(node));
    });
    if (!top) continue;
    await candidate.click();
    await candidate.page().waitForTimeout(150);
    return;
  }
  throw new Error(`No uncovered control: ${locator}`);
}
async function settle(page) { await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(200); }
async function shot(page, name, locator) {
  if (locator) await expose(locator);
  await settle(page);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
}
async function seed(page, language) {
  await page.clock.setFixedTime(new Date('2026-09-27T08:00:00Z'));
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  const sample = page.getByRole('button', { name: /Start with sample data/i });
  if (await sample.isVisible().catch(() => false)) await tap(sample);
  await page.getByTestId('reference-home-summary').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !!localStorage.getItem('wafra/state/v1'));
  await page.evaluate(lang => {
    const key = 'wafra/state/v1'; const meta = JSON.parse(localStorage.getItem(key));
    const row = (id, date, amountFils, extra = {}) => ({ id, title: id, date, amountFils, type: 'expense',
      category: 'groceries', accountId: 'qa-cash', source: 'manual', userEdited: true, ...extra });
    const transactions = [row('QA Today', '2026-09-27', 1234), row('QA Saturday', '2026-09-26', 2200),
      row('QA Monday', '2026-09-21', 666), row('QA Before week', '2026-09-20', 900),
      row('QA September second', '2026-09-02', 444), row('QA Rent', '2026-09-01', 10000, { category: 'rent' }),
      row('QA August end', '2026-08-31', 555), row('QA August boundary', '2026-08-29', 777),
      row('QA Before thirty', '2026-08-28', 888), row('QA January', '2026-01-01', 222),
      row('QA Previous year', '2025-12-31', 333),
      row('QA Hidden', '2026-09-27', 999999, { accountId: 'qa-hidden' }),
      row('QA Transfer', '2026-09-27', 888888, { isTransfer: true }),
      row('QA Income', '2026-09-27', 50000, { type: 'income', category: 'salary' })]
      .sort((a, b) => b.date.localeCompare(a.date));
    delete meta.txChunks; delete meta.txChunkOrder;
    Object.assign(meta, { transactions, language: lang, languagePreference: lang, monthStartDay: 1,
      themePreference: 'system', onboarded: true, captureOptOut: true, historyImport: null,
      marketId: 'AE', ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
      accounts: [{ id: 'qa-cash', name: 'QA cash', kind: 'cash', openingFils: 0, color: '#1F6B52' },
        { id: 'qa-hidden', name: 'QA hidden', kind: 'cash', openingFils: 0, color: '#1F6B52', archived: true }],
      bills: Array.from({ length: 14 }, (_, i) => ({ id: `qa-bill-${i}`, title: i === 0 ? 'Netflix' : `QA Bill ${i + 1}`,
        category: 'utilities', amountFils: 1000 + i * 100, dueDay: 28, paidMonths: [], accountId: 'qa-cash' })),
      cardDues: [], budgets: [], goals: [], notSubscriptions: [], merchantOverrides: {}, billAliases: {}, privateMode: true });
    localStorage.setItem(key, JSON.stringify(meta));
  }, language);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByTestId('home-spending-total').waitFor({ state: 'visible' });
  await settle(page);
}

try {
  for (const [language, scheme, width, scale] of [
    ['en', 'light', 390, 1], ['ar', 'dark', 320, 1], ['en', 'dark', 390, 1.8], ['ar', 'light', 390, 1.8],
  ]) {
    const name = `${language}-${scheme}-${width}-${scale}`;
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme,
      locale: language === 'ar' ? 'ar-AE' : 'en-AE', timezoneId: 'Asia/Dubai', reducedMotion: 'reduce' });
    await context.addInitScript(fontScale => { window.__WAFRA_E2E_FONT_SCALE__ = fontScale; }, scale);
    await context.route('**/*', route => {
      const url = route.request().url();
      return url.startsWith(base + '/') || /^(data|blob):/.test(url) ? route.continue() : route.abort();
    });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push({ name, error: String(error) }));
    const label = (en, ar) => language === 'ar' ? ar : en;
    const flow = page.getByTestId('reference-spending-screen');
    const amount = () => flow.getByTestId('spending-total');
    const period = () => flow.getByTestId('spending-period');
    const view = mode => tap(flow.getByTestId(`spending-view-${mode}`));
    async function preset(en, ar) {
      await tap(period());
      const dialog = page.locator('[role="dialog"]:visible').last();
      await tap(dialog.getByRole('button', { name: label(en, ar), exact: true }));
      await dialog.waitFor({ state: 'hidden' }); await settle(page);
    }
    async function sameTotal(expected) {
      const selected = await period().innerText();
      check(selected.trim().length > 0, true, 'selected period is visibly named');
      for (const mode of ['categories', 'compare', 'calendar']) {
        await view(mode);
        check(minor(await amount().innerText()), expected, `${mode}: exact total for selected period`);
        check(await period().innerText(), selected, `${mode}: switching view preserves visible scope`);
      }
    }
    try {
      await seed(page, language);
      const homeTotal = page.getByTestId('home-spending-total');
      check(minor(await homeTotal.innerText()), 15444, 'Home selected-month amount is independently correct');
      const homeBox = await homeTotal.boundingBox(); const weekBox = await page.getByTestId('home-week').boundingBox();
      check(weekBox.y < homeBox.y, true, 'Home week on the band precedes the selected total on the sheet');
      check(await page.getByTestId('home-week').locator('[data-testid^="week-value-"]').count(), 7, 'seven daily values remain visible');
      // Columns are labelled in whole units (12); Larger Text lists the exact
      // 12.34. The exact amount is always in the week's spoken label.
      // Larger Text (useLargeTextLayout: font scale 1.6 or more) is the exact list.
      check(minor(await page.getByTestId('week-value-2026-09-27').innerText()), scale >= 1.6 ? 1234 : 1200,
        scale >= 1.6 ? 'Home today exact daily amount in the Larger Text list' : 'Home today column in whole units');
      check((await page.getByTestId('home-week').getAttribute('aria-label')).includes('12.34'), true, 'Home today exact daily amount is spoken');
      await shot(page, `${name}-home`, homeTotal);
      await page.getByRole('tab', { name: label('Spending', 'الإنفاق'), exact: true }).click();
      await sameTotal(15444);
      await preset('Last 7 days', 'آخر ٧ أيام');
      await sameTotal(4100);
      check(await flow.locator('[data-testid^="spending-calendar-day-"]').count(), 7, 'last seven days populate Calendar');
      await tap(flow.getByTestId('spending-calendar-day-2026-09-21'));
      check(minor(await flow.getByTestId('spending-calendar-selected-total').innerText()), 666, 'selected-day amount next to calendar');
      check(minor(await flow.getByTestId('spending-day-total').innerText()), 666, 'selected-day amount agrees with activity heading');
      check((await flow.getByTestId('spending-activity').innerText()).includes('QA Monday'), true, 'selected day lists its transaction');
      check((await flow.getByTestId('spending-activity').innerText()).includes('QA Today'), false, 'selected day excludes another day');
      check(minor(await amount().innerText()), 4100, 'day selection does not replace period total');
      await shot(page, `${name}-seven-days`, flow.getByTestId('spending-calendar'));
      await preset('Last 30 days', 'آخر ٣٠ يوماً');
      await sameTotal(16776);
      check(await flow.locator('[data-testid^="spending-calendar-day-"]').count(), 30, 'last thirty days populate Calendar');
      check(await flow.getByTestId('spending-calendar-month-2026-08').count(), 1, 'August dates have a month heading');
      check(await flow.getByTestId('spending-calendar-month-2026-09').count(), 1, 'September dates have a month heading');
      await tap(period());
      const dialog = page.locator('[role="dialog"]:visible').last();
      await dialog.locator('input[aria-label="' + label('From date', 'تاريخ البداية') + '"]').fill('2026-08-29');
      await dialog.locator('input[aria-label="' + label('To date', 'تاريخ النهاية') + '"]').fill('2026-09-02');
      await tap(dialog.getByRole('button', { name: label('Apply range', 'تطبيق النطاق'), exact: true }));
      await dialog.waitFor({ state: 'hidden' });
      await sameTotal(11776);
      check(await flow.locator('[data-testid^="spending-calendar-day-"]').count(), 5, 'inclusive custom cross-month range has five days');
      await tap(flow.getByTestId('spending-calendar-day-2026-09-01'));
      check(minor(await flow.getByTestId('spending-calendar-selected-total').innerText()), 10000, 'rent-only day total includes the fixed payment');
      await shot(page, `${name}-cross-month`, flow.getByTestId('spending-calendar'));
      for (const [en, ar, total] of [['This year', 'هذا العام', 17886], ['All time', 'كل الفترات', 18219]]) {
        await preset(en, ar); await sameTotal(total);
        check(await flow.getByTestId('spending-daily-pager').count(), 1, `${en}: month pager is available`);
        check(await flow.locator('[data-testid^="spending-calendar-day-"]').count() <= 31, true, `${en}: bounded monthly calendar`);
        await tap(flow.getByTestId('spending-daily-previous'));
        check(await flow.getByTestId('spending-calendar-month-2026-08').count(), 1, `${en}: previous page is August`);
        const activity = await flow.getByTestId('spending-activity').innerText();
        check(activity.includes('QA August end'), true, `${en}: activity follows displayed month`);
        check(activity.includes('QA Today'), false, `${en}: another month's activity is excluded`);
        check(minor(await amount().innerText()), total, `${en}: paging keeps selected-period total`);
      }
      check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'no horizontal document overflow');
      await shot(page, `${name}-all-time`, flow.getByTestId('spending-calendar'));
      await page.getByRole('tab', { name: label('Bills', 'الفواتير'), exact: true }).click();
      const tiles = page.locator('[data-testid^="bills-timeline-payment-"]');
      await tiles.first().waitFor({ state: 'visible' });
      check(await tiles.count(), 8, 'dense payment preview keeps its eight-item window');
      for (const tile of await tiles.all()) {
        await tile.scrollIntoViewIfNeeded();
        check(await tile.evaluate(node => {
          const r = node.getBoundingClientRect();
          return r.left >= -1 && r.right <= innerWidth + 1 && [...node.querySelectorAll('*')]
            .filter(n => n.children.length === 0 && n.textContent.trim())
            .every(n => { const t = n.getBoundingClientRect(); return n.scrollWidth <= n.clientWidth + 1 && t.left >= r.left - 1 && t.right <= r.right + 1; });
        }), true, 'every dated payment tile and full amount can be revealed');
      }
      await shot(page, `${name}-dense-bills`, tiles.first());
      results.push({ name, passed: true }); console.log(`PASS ${name}`);
    } catch (error) {
      results.push({ name, passed: false, error: String(error) });
      await page.screenshot({ path: path.join(out, `${name}-failure.png`) }).catch(() => {});
      console.error(`FAIL ${name}: ${error}`);
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
  await writeFile(path.join(out, 'results.json'), JSON.stringify({ assertions, results, errors,
    scope: 'Fresh local web export with synthetic ledger; browser font-scale emulation, not native device proof.' }, null, 2));
}
assert.deepEqual(errors, [], 'no page runtime errors');
assert.ok(results.every(result => result.passed), 'Spending period details regression failed');
console.log(`${results.length} cases, ${assertions} assertions passed`);
