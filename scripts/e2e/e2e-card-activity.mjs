import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

// Only fresh local demo exports and disposable synthetic browser ledgers.
const base = (process.env.BASE ?? 'http://localhost:8126').replace(/\/$/, '');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname));
const out = path.resolve(process.env.OUT ?? 'artifacts/e2e-card-activity');
await mkdir(out, { recursive: true });
const executablePath = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(executablePath) ? { executablePath } : {});
const results = []; const errors = []; let assertions = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); assertions++; };
const minor = value => {
  const normalized = String(value).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6f0)).replace(/٬/g, ',').replace(/٫/g, '.');
  const match = normalized.match(/\d[\d,]*(?:\.\d{1,2})?/); assert.ok(match, `Missing amount: ${value}`);
  return Math.round(Number(match[0].replaceAll(',', '')) * 100);
};
async function expose(locator) {
  await locator.scrollIntoViewIfNeeded();
  await locator.evaluate(node => {
    for (let i = 0; i < 5; i++) {
      const excess = node.getBoundingClientRect().bottom - (innerHeight - 130);
      if (excess <= 0) break;
      let parent = node.parentElement;
      while (parent && !(parent.scrollHeight > parent.clientHeight + 4 && parent.clientHeight > 160)) parent = parent.parentElement;
      if (!parent) break;
      parent.scrollTop += excess + 16;
    }
  });
}
async function tap(locator) {
  for (const target of (await locator.all()).reverse()) {
    if (!await target.isVisible()) continue;
    await expose(target);
    if (!await target.evaluate(node => {
      const r = node.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !!hit && (node.contains(hit) || hit.contains(node));
    })) continue;
    await target.click(); await target.page().waitForTimeout(200); return;
  }
  throw new Error(`No reachable control: ${locator}`);
}
async function settle(page) { await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(250); }
async function shot(page, name, locator) {
  if (locator) await expose(locator);
  await settle(page); await page.screenshot({ path: path.join(out, `${name}.png`) });
}
const rowLabels = container => container.getByRole('button').evaluateAll(nodes => nodes
  .map(node => node.getAttribute('aria-label') ?? '').filter(label => label.startsWith('QA ')));

async function seed(page, language) {
  await page.clock.setFixedTime(new Date('2026-09-27T08:00:00Z'));
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.getByTestId('home-spending-total').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !!localStorage.getItem('wafra/state/v1'));
  await page.evaluate(language => {
    const key = 'wafra/state/v1'; const state = JSON.parse(localStorage.getItem(key));
    const account = (id, name, cardType) => ({ id, name, kind: 'card', cardType, bankName: 'QA Bank',
      last4: id === 'debit' ? '5678' : '1234', openingFils: cardType === 'debit' ? 10000 : 0,
      distinctCard: true, color: '#1F6B52' });
    const row = (id, title, amountFils, date, extra = {}) => ({ id, title, amountFils, date, accountId: 'credit',
      type: 'expense', category: 'shopping', source: 'manual', userEdited: true, ...extra });
    const transactions = [
      row('purchase', 'QA Purchase', 10000, '2026-09-27'),
      row('refund', 'QA Refund', 2000, '2026-09-26', { type: 'income' }),
      row('repayment-debit', 'QA Card payment debit', 8000, '2026-09-25', { isTransfer: true, cardPaymentSide: 'debit' }),
      row('repayment-receipt', 'QA Card payment receipt', 8000, '2026-09-25', { type: 'income', isTransfer: true, cardPaymentSide: 'receipt' }),
      ...Array.from({ length: 60 }, (_, i) => row(`small-${i}`, `QA Small ${String(i + 1).padStart(2, '0')}`, 100, '2026-09-10', { ts: Date.parse('2026-09-10T12:00:00Z') + i })),
      row('old', 'QA August purchase', 4000, '2026-08-26'),
      row('sibling', 'QA Sibling purchase', 99999, '2026-09-26', { accountId: 'sibling' }),
      row('sibling-pay', 'QA Sibling payment', 7777, '2026-09-25', { accountId: 'sibling', type: 'income', isTransfer: true, cardPaymentSide: 'receipt' }),
      row('debit-buy', 'QA Debit purchase', 1500, '2026-09-27', { accountId: 'debit' }),
      row('debit-credit', 'QA Debit cashback', 200, '2026-09-26', { accountId: 'debit', type: 'income' }),
    ].sort((a, b) => b.date.localeCompare(a.date) || (b.ts ?? 0) - (a.ts ?? 0));
    delete state.txChunks; delete state.txChunkOrder;
    Object.assign(state, { accounts: [account('credit', 'QA Credit', 'credit'), account('sibling', 'QA Sibling', 'credit'), account('debit', 'QA Debit', 'debit')],
      transactions, bills: [], budgets: [], cardDues: [], goals: [], transferInternalIds: [],
      onboarded: true, language, languagePreference: language, monthStartDay: 1, themePreference: 'system',
      marketId: 'AE', ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
      captureOptOut: true, historyImport: null, merchantOverrides: {}, notSubscriptions: [], privateMode: true });
    localStorage.setItem(key, JSON.stringify(state));
  }, language);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByTestId('home-spending-total').waitFor({ state: 'visible' }); await settle(page);
}

try {
  for (const [language, scheme, width, scale] of [['en', 'light', 390, 1], ['ar', 'dark', 320, 1.8]]) {
    const name = `${language}-${scheme}-${width}-${scale}`;
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: language === 'ar' ? 'ar-AE' : 'en-AE',
      colorScheme: scheme, timezoneId: 'Asia/Dubai', reducedMotion: 'reduce' });
    await context.addInitScript(scale => { window.__WAFRA_E2E_FONT_SCALE__ = scale; }, scale);
    await context.route('**/*', route => {
      const url = route.request().url(); return url.startsWith(base + '/') || /^(data|blob):/.test(url) ? route.continue() : route.abort();
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push({ name, error: String(error) }));
    const card = () => page.getByTestId('card-screen').last();
    async function back(target) {
      await tap(page.getByRole('button', { name: language === 'ar' ? 'رجوع' : 'Back', exact: true }));
      await page.getByTestId(target).last().waitFor({ state: 'visible' }); await settle(page);
    }
    async function choosePeriod(en, ar) {
      await tap(card().getByTestId('card-period'));
      const dialog = page.locator('[role="dialog"]:visible').last();
      await tap(dialog.getByRole('button', { name: language === 'ar' ? ar : en, exact: true }));
      await dialog.waitFor({ state: 'hidden' }); await settle(page);
    }
    async function openAll() {
      await tap(card().getByTestId('card-all-transactions'));
      await page.waitForURL(url => url.pathname === '/card' && url.searchParams.get('id') === 'credit' && url.searchParams.get('all') === '1');
      await page.getByTestId('card-all-list').waitFor({ state: 'visible' }); await settle(page);
    }
    try {
      await seed(page, language);
      await page.getByRole('tab', { name: language === 'ar' ? 'الحسابات' : 'Accounts', exact: true }).click();
      await page.getByTestId('wallet-screen').waitFor({ state: 'visible' });
      await tap(page.getByTestId('wallet-card-credit').getByRole('button', { name: /^QA Credit\./ }));
      await page.waitForURL(url => url.pathname === '/card' && url.searchParams.get('id') === 'credit');
      await card().getByTestId('card-spending').waitFor({ state: 'visible' });
      check(minor(await card().getByTestId('card-spending').innerText()), 16000, 'purchases include 100.00 + sixty 1.00 entries');
      check(minor(await card().getByTestId('card-credits').innerText()), 2000, 'refund shown separately from purchases');
      check(minor(await card().getByTestId('card-payments').innerText()), 8000, 'paired debit/receipt count once as repayment');
      check(await card().getByTestId('card-unknown-figure').count(), 1, 'unknown credit outstanding is explicitly unknown');
      check(await card().getByTestId('card-known-figure').count(), 0, 'unknown credit debt is never fabricated as zero');
      const previewLabels = await rowLabels(card().getByTestId('card-activity'));
      check(previewLabels.length, 12, 'bounded activity preview');
      const payment = previewLabels.filter(label => /^QA Card payment /.test(label));
      check(payment.length, 1, 'one canonical repayment appears in preview');
      check(previewLabels.some(label => label.startsWith('QA Sibling')), false, 'same issuer/last-four sibling stays excluded');
      await shot(page, `${name}-credit`, card().getByTestId('card-spending'));
      await tap(card().getByTestId('card-activity').getByRole('button', { name: /^QA Purchase,/ }));
      await page.getByTestId('entry-detail-sheet').waitFor({ state: 'visible' });
      check(minor(await page.getByTestId('entry-detail-amount').innerText()), 10000, 'purchase opens exact transaction detail');
      await tap(page.getByTestId('entry-detail-done'));
      await page.getByTestId('entry-detail-sheet').waitFor({ state: 'hidden' });
      await openAll();
      const list = page.getByTestId('card-all-list'); const seen = new Set(); let atEnd = 0;
      // FlatList extends its measured window asynchronously. An initial end
      // position can belong to the first batch, so keep scrolling until the
      // fixture's real last row has mounted, under a bounded attempt count.
      for (let step = 0; step < 100 && !(atEnd >= 2 && seen.size >= 63); step++) {
        for (const label of await rowLabels(list)) seen.add(label);
        const scroll = await list.evaluate(node => {
          const scroller = [node, ...node.querySelectorAll('*')].find(el => el.scrollHeight > el.clientHeight + 4
            && el.clientHeight > 100 && /auto|scroll/.test(getComputedStyle(el).overflowY));
          if (!scroller) return { missing: true };
          scroller.scrollTop += Math.max(200, scroller.clientHeight * 0.8);
          return { end: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2 };
        });
        assert.ok(!scroll.missing, 'full-history list owns a bounded scroller');
        atEnd = scroll.end ? atEnd + 1 : 0; await page.waitForTimeout(200);
      }
      check(atEnd >= 2, true, 'full history scroll reaches the actual final row');
      check(seen.size, 63, 'full list exposes all sixty purchases plus purchase/refund/one repayment');
      check([...seen].filter(label => /^QA Card payment /.test(label)), payment, 'full list keeps the same canonical repayment as preview');
      check([...seen].some(label => /^QA Small 01,/.test(label)), true, 'last virtualized purchase is reachable');
      check([...seen].some(label => /^QA (Sibling|August)/.test(label)), false, 'full history keeps account and selected-month filters');
      await shot(page, `${name}-full-history-end`, list);
      await back('card-screen');
      await choosePeriod('Last month', 'الشهر الماضي');
      check(minor(await card().getByTestId('card-spending').innerText()), 4000, 'period change displays August purchase total');
      check(minor(await card().getByTestId('card-credits').innerText()), 0, 'September credits excluded from August');
      check(minor(await card().getByTestId('card-payments').innerText()), 0, 'September repayments excluded from August');
      const selectedPeriod = await card().getByTestId('card-selected-period').innerText();
      check(selectedPeriod.includes('2026'), true, 'selected period visibly names its year');
      await openAll();
      const august = await rowLabels(page.getByTestId('card-all-list'));
      check(august.length, 1, 'full list retains changed period');
      check(august[0].startsWith('QA August purchase,'), true, 'only August purchase appears');
      await back('card-screen');
      await tap(card().getByTestId('card-statements'));
      await page.waitForURL(url => url.pathname === '/cards' && url.searchParams.get('card') === 'credit');
      await page.getByTestId('cards-screen').waitFor({ state: 'visible' });
      check(new URL(page.url()).searchParams.get('card'), 'credit', 'statements retain exact selected card');
      const statementDetail = page.locator('[role="dialog"]:visible').last();
      await statementDetail.waitFor({ state: 'visible' });
      await tap(statementDetail.getByRole('button', { name: language === 'ar' ? 'إغلاق' : 'Close', exact: true }));
      await statementDetail.waitFor({ state: 'hidden' });
      await back('card-screen'); await choosePeriod('This month', 'هذا الشهر');
      await back('wallet-screen');
      await tap(page.getByTestId('wallet-card-details-credit'));
      await page.waitForURL(url => url.pathname === '/card' && url.searchParams.get('id') === 'credit');
      await card().getByTestId('card-spending').waitFor({ state: 'visible' });
      check(minor(await card().getByTestId('card-spending').innerText()), 16000, 'Wallet Details opens identical card activity');
      await back('wallet-screen');
      await tap(page.getByTestId('wallet-account-debit').getByRole('button', { name: /^QA Debit\./ }));
      await page.waitForURL(url => url.pathname === '/card' && url.searchParams.get('id') === 'debit');
      await card().getByTestId('card-spending').waitFor({ state: 'visible' });
      check(minor(await card().getByTestId('card-spending').innerText()), 1500, 'debit purchases remain card scoped');
      check(minor(await card().getByTestId('card-credits').innerText()), 200, 'debit cashback remains separate');
      check(minor(await card().getByTestId('card-known-figure').innerText()), 8700, 'debit balance reconciles opening 100 minus 15 plus 2');
      check(await card().getByTestId('card-payments').count(), 0, 'debit has no credit repayment metric');
      check(await card().getByTestId('card-statements').count(), 0, 'debit has no credit statements action');
      check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'no horizontal document overflow');
      await shot(page, `${name}-debit`, card().getByTestId('card-spending'));
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
    scope: 'Synthetic disposable web ledger, not physical card or native-device evidence.' }, null, 2));
}
assert.deepEqual(errors, [], 'no runtime errors');
assert.ok(results.every(result => result.passed), 'Card activity browser regression failed');
console.log(`${results.length} cases, ${assertions} assertions passed`);
