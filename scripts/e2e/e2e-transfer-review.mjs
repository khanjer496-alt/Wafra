// Synthetic browser acceptance of transfer review, accounting and persistence.
// Never load a private export or use an existing browser profile here.
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:8134';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(BASE).hostname));
const OUT = process.env.E2E_ARTIFACT_DIR ?? path.join(tmpdir(), 'wafra-transfer-review-e2e');
const KEY = 'wafra/state/v1';
const now = Date.now();
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(now);
const accounts = [
  { id: 'qa-current', name: 'QA current account', kind: 'bank', bankName: 'ADCB', last4: '4111', openingFils: 100000, color: '#367A61' },
  { id: 'qa-savings', name: 'QA savings account', kind: 'bank', bankName: 'ADCB', last4: '4222', openingFils: 0, color: '#637581' },
];
const tx = (id, type, amountFils, extra = {}) => ({
  id, type, amountFils, accountId: accounts[0].id, category: 'other',
  title: type === 'expense' ? 'Outgoing transfer' : 'Incoming transfer',
  date, ts: now, source: 'sms', smsKey: `s${now}-${id}`,
  captureInstrument: { last4: '4111', kind: 'account', bankIdentity: 'adcb' },
  transferEvidence: { version: 1, currency: 'AED', attribution: 'source' }, ...extra,
});
const rows = [
  tx('salary', 'income', 200000, { title: 'Salary', category: 'salary', transferEvidence: undefined }),
  tx('purchase', 'expense', 10000, { title: 'QA coffee', category: 'dining', transferEvidence: undefined }),
  // A company-suffix category guess cannot bypass transfer ownership review.
  tx('unknown-in', 'income', 30000, { category: 'business' }),
  tx('unknown-out', 'expense', 7000, { isTransfer: true }),
  ...[['group-a', 12000], ['group-b', 8000]].map(([id, amount]) => tx(id, 'expense', amount, {
    isTransfer: true, transferEvidence: { version: 1, currency: 'AED', attribution: 'source',
      counterparty: { last4: '4999', kind: 'account', bankIdentity: 'adcb' } },
  })),
  tx('legacy-own', 'expense', 4000, { title: 'Own account transfer', isTransfer: true, transferEvidence: undefined }),
  // Reproduce the reported backlog size using synthetic old records, not a private inbox.
  ...Array.from({ length: 3106 }, (_, i) => tx(`historical-${String(i).padStart(4, '0')}`, 'expense', 10000 + i, {
    accountId: accounts[1].id, date: '2022-11-05', ts: Date.parse('2022-11-05T10:00:00Z') + i,
    smsKey: `hqa-history-${i}`, captureInstrument: { last4: '4222', kind: 'account', bankIdentity: 'adcb' },
  })),
];
function seed(language, mode) {
  return {
    ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
    accounts, transactions: rows, budgets: [], bills: [], cardDues: [], goals: [],
    merchantOverrides: {}, accountHints: {}, notSubscriptions: [],
    localCaptureQualifications: [], iosCaptureWarning: null,
    onboardingPlan: null, onboardingCurrencyEvidence: null,
    onboarded: true, userName: 'QA', appLock: false, marketId: 'AE',
    language, languagePreference: language, themePreference: mode,
    monthStartDay: 1, pro: false, founderPro: false, trialStartTs: now,
    privateMode: false, captureOptOut: true, dailySummary: false,
    parserVersion: 37, lastScanTs: 0, historyImport: null,
    txChunks: 0, txChunkOrder: 'oldest-first',
  };
}
const labels = {
  en: { save: 'Save classification', undo: 'Undo decision', group: 'Classify these 2 transfers', backup: 'Back up everything (JSON)', leave: 'Leave unclassified' },
  ar: { save: 'حفظ التصنيف', undo: 'التراجع عن القرار', group: 'تصنيف هذه التحويلات وعددها 2', backup: 'نسخ احتياطي كامل (JSON)', leave: 'تركه غير مصنف' },
};
function minor(value) {
  const normalized = String(value).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6f0))
    .replace(/[\u061c\u200e\u200f]/g, '').replace(/٬/g, ',').replace(/٫/g, '.').replace(/−/g, '-');
  const match = normalized.match(/[+-]?\d[\d,]*(?:\.\d{1,2})?/);
  assert.ok(match, `No monetary amount in ${value}`);
  return Math.round(Number(match[0].replaceAll(',', '')) * 100);
}
async function stored(page) {
  return page.evaluate(key => {
    const meta = JSON.parse(localStorage.getItem(key) ?? '{}');
    return { ...meta, transactions: meta.transactions ?? Array.from({ length: meta.txChunks ?? 0 }, (_, n) =>
      JSON.parse(localStorage.getItem(`${key}:tx:${n}`) ?? '[]')).flat() };
  }, KEY);
}
// Offscreen mounted RN-web routes are not proof of a visible working control.
async function exposed(locator) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    for (const item of await locator.all()) {
      if (!await item.isVisible()) continue;
      await item.scrollIntoViewIfNeeded({ timeout: 500 }).catch(() => {});
      if (await item.evaluate(node => {
        // RN-web's scroll viewport extends beneath its fixed tab bar. Keep
        // controls clear of that bar before checking real pointer exposure.
        let parent = node.parentElement;
        while (parent && !(parent.scrollHeight > parent.clientHeight + 4 && parent.clientHeight > 200)) parent = parent.parentElement;
        if (parent) {
          const r = node.getBoundingClientRect(), p = parent.getBoundingClientRect();
          if (r.bottom > Math.min(p.bottom, innerHeight) - 110 || r.top < p.top) {
            parent.scrollTop += r.top - p.top - Math.max(24, parent.clientHeight / 3);
          }
        }
        const r = node.getBoundingClientRect();
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !!top && (node.contains(top) || top.contains(node));
      }).catch(() => false)) return item;
    }
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error(`No exposed control: ${locator}`);
}
async function click(locator) { await (await exposed(locator)).click(); }
async function fits(locator) {
  const root = await exposed(locator);
  const bad = await root.evaluate(node => [...node.querySelectorAll('*'), node]
    .filter(n => n.children.length === 0 && n.textContent.trim())
    .filter(n => {
      const r = n.getBoundingClientRect();
      return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1 || n.scrollWidth > n.clientWidth + 1);
    }).map(n => n.textContent));
  assert.deepEqual(bad, [], 'complete text fits without horizontal clipping');
}
async function home(page, expected, pendingCount) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const ids = ['home-income-summary', 'home-spending-total', 'home-net-summary'];
  const amounts = [];
  for (const id of ids) {
    const item = await exposed(page.getByTestId(id));
    amounts.push(minor(await item.getAttribute('aria-label')));
  }
  assert.deepEqual(amounts, expected, 'confirmed Home income, spending and Net');
  const notice = page.getByTestId('transfer-review-notice');
  if (pendingCount) {
    const label = await (await exposed(notice)).getAttribute('aria-label');
    const digits = label.replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660)).replace(/[,٬]/g, '');
    assert.match(digits, new RegExp(`\\b${pendingCount}\\b`));
    assert.ok(label.includes('Not included in totals') || label.includes('غير محتسبة في الإجماليات'));
    assert.ok(!(await notice.textContent()).includes('AED'), 'Home has no giant transfer totals');
    await fits(notice);
  } else assert.equal(await notice.count(), 0);
}
async function choose(page, words, id, ownership) {
  await page.goto(`${BASE}/review-transfers?transactionId=${id}`, { waitUntil: 'networkidle' });
  await click(page.getByTestId('transfer-review-entry'));
  await click(page.getByTestId(`transfer-choice-${ownership}`));
  await click(page.getByRole('button', { name: words.save, exact: true }));
  await page.getByTestId('transfer-review-confirmation').waitFor({ state: 'hidden' });
  assert.equal((await stored(page)).transactions.find(row => row.id === id)?.transferDecision?.ownership, ownership);
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const results = [];
try {
  for (const [language, mode, width, height] of [
    ['en', 'light', 320, 568], ['ar', 'dark', 320, 568],
    ['en', 'dark', 390, 844], ['ar', 'light', 390, 844],
  ]) {
    const name = `${language}-${mode}-${width}`;
    const words = labels[language];
    const context = await browser.newContext({ viewport: { width, height },
      locale: language === 'ar' ? 'ar-AE' : 'en-AE', colorScheme: mode, reducedMotion: 'reduce', acceptDownloads: true });
    await context.route('**/*', route => {
      const url = route.request().url();
      return url.startsWith(BASE + '/') || url.startsWith('data:') || url.startsWith('blob:') ? route.continue() : route.abort();
    });
    await context.addInitScript(({ key, state }) => {
      if (localStorage.getItem('wafra/e2e-transfer-seeded')) return;
      localStorage.setItem(key, JSON.stringify(state));
      localStorage.setItem('wafra/e2e-transfer-seeded', '1');
    }, { key: KEY, state: seed(language, mode) });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    try {
      await home(page, [200000, 10000, 190000], 4);
      await page.screenshot({ path: path.join(OUT, `${name}-home-pending.png`) });
      await click(page.getByTestId('transfer-review-notice'));
      await page.waitForURL(/review-transfers/);
      assert.equal(await page.getByTestId('transfer-review-entry').count(), 0, 'history is collapsed, not a task queue');
      await fits(page.getByTestId('transfer-search'));
      await page.screenshot({ path: path.join(OUT, `${name}-recent-groups.png`) });
      await click(page.getByTestId('transfer-review-group').filter({ hasText: '4999' }).getByTestId('transfer-group-toggle'));
      await click(page.getByRole('button', { name: words.group, exact: true }));
      await fits(page.getByTestId('transfer-review-confirmation'));
      await page.screenshot({ path: path.join(OUT, `${name}-group-confirmation.png`) });
      assert.equal(await page.getByRole('button', { name: words.save, exact: true }).isDisabled(), true);
      await click(page.getByTestId('transfer-choice-own'));
      await fits(page.getByTestId('transfer-choice-external'));
      await page.screenshot({ path: path.join(OUT, `${name}-choices.png`) });
      await click(page.getByRole('button', { name: words.save, exact: true }));
      await page.getByTestId('transfer-review-confirmation').waitFor({ state: 'hidden' });
      let saved = await stored(page);
      for (const id of ['group-a', 'group-b']) assert.equal(saved.transactions.find(t => t.id === id).transferDecision.ownership, 'own');
      await home(page, [200000, 10000, 190000], 2);
      await choose(page, words, 'unknown-in', 'external');
      await home(page, [230000, 10000, 220000], 1);
      await choose(page, words, 'unknown-out', 'external');
      await home(page, [230000, 17000, 213000], 0);
      // Explicit/automatic ownership has an override, not an invisible exclusion.
      await choose(page, words, 'legacy-own', 'external');
      await home(page, [230000, 21000, 209000], 0);
      await page.reload({ waitUntil: 'networkidle' });
      saved = await stored(page);
      assert.equal(saved.transactions.length, rows.length, 'classification never deletes or duplicates ledger rows');
      const savedById = new Map(saved.transactions.map(t => [t.id, t]));
      for (const original of rows) {
        const current = savedById.get(original.id);
        assert.deepEqual([current.amountFils, current.type, current.accountId], [original.amountFils, original.type, original.accountId]);
      }
      await page.goto(BASE + '/settings?section=data', { waitUntil: 'networkidle' });
      const backupButton = await exposed(page.getByRole('button', { name: words.backup, exact: true }));
      const [download] = await Promise.all([page.waitForEvent('download'), backupButton.click()]);
      const backup = JSON.parse(await readFile(await download.path(), 'utf8'));
      assert.equal(backup.app, 'wafra');
      assert.deepEqual(backup.data.transactions.map(t => [t.id, t.transferDecision ?? null]).sort(),
        saved.transactions.map(t => [t.id, t.transferDecision ?? null]).sort(), 'real downloaded backup preserves every decision');
      await page.goto(`${BASE}/review-transfers?transactionId=unknown-in`, { waitUntil: 'networkidle' });
      await click(page.getByTestId('transfer-review-entry'));
      await click(page.getByRole('button', { name: words.undo, exact: true }));
      await page.getByTestId('transfer-review-confirmation').waitFor({ state: 'hidden' });
      assert.equal((await stored(page)).transactions.find(t => t.id === 'unknown-in').transferDecision, undefined);
      await home(page, [200000, 21000, 179000], 1);
      await page.goto(`${BASE}/review-transfers?transactionId=deleted-entry`, { waitUntil: 'networkidle' });
      assert.equal(await page.getByTestId('transfer-review-entry').count(), 0, 'stale route cannot classify another row');
      await page.screenshot({ path: path.join(OUT, `${name}-missing-entry.png`) });
      // All 3,106 old transfers remain reachable without creating 3,106 mounted actions.
      await page.goto(`${BASE}/review-transfers`, { waitUntil: 'networkidle' });
      assert.equal(await page.getByTestId('transfer-review-group').filter({ hasText: '4222' }).count(), 0, 'old records do not occupy the recent view');
      await click(page.getByTestId('transfer-scope-all'));
      await page.getByTestId('transfer-search').fill('4222');
      await page.waitForFunction(() => document.querySelector('[data-testid="transfer-browse-summary"]')?.textContent
        .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660)).replace(/[,٬]/g, '').includes('3106'));
      assert.equal(await page.getByTestId('transfer-review-entry').count(), 0);
      await page.screenshot({ path: path.join(OUT, `${name}-3106-history-collapsed.png`) });
      const historic = page.getByTestId('transfer-review-group').filter({ hasText: '4222' });
      await click(historic.getByTestId('transfer-group-toggle'));
      assert.ok(await page.getByTestId('transfer-review-entry').count() <= 20, 'expanded records are bounded and virtualized');
      const beforeLeave = (await stored(page)).transactions.map(t => [t.id, t.transferDecision ?? null]);
      await click(page.getByTestId('transfer-review-entry').first());
      await click(page.getByRole('button', { name: words.leave, exact: true }));
      assert.deepEqual((await stored(page)).transactions.map(t => [t.id, t.transferDecision ?? null]), beforeLeave,
        'leaving unclassified does not apply or dismiss any decision');
      assert.deepEqual(errors, []);
      await rm(path.join(OUT, `${name}-failure.png`), { force: true });
      results.push({ name, passed: true });
      console.log(`PASS ${name}`);
    } catch (error) {
      results.push({ name, passed: false, error: String(error), errors });
      await page.screenshot({ path: path.join(OUT, `${name}-failure.png`) }).catch(() => {});
      console.log(`FAIL ${name}: ${error.stack ?? error}`);
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
  await writeFile(path.join(OUT, 'results.json'), JSON.stringify({ results,
    scope: 'Synthetic local browser ledger; not native device or bank coverage proof.' }, null, 2));
}
assert.ok(results.every(r => r.passed), 'Transfer review browser acceptance failed');
