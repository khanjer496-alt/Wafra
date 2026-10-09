// Synthetic browser acceptance of transfer review, accounting and persistence.
// Never load a private export or use an existing browser profile here.
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';

// Home v3 keeps the transfers notice off by default (the Needs-you pill carries it); this suite
// drives that notice, so it switches the section on through a saved v3 layout.
const HOME_LAYOUT = JSON.stringify({ version: 3,
  order: ['greeting', 'hero', 'today', 'overview', 'week', 'transfers', 'activity', 'due', 'upcoming', 'insight', 'assistant', 'capture'],
  hidden: ['today', 'overview', 'week', 'due', 'upcoming', 'insight', 'assistant', 'capture'] });
const withHomeLayout = (context) => context.addInitScript(layout => {
  if (!localStorage.getItem('wafra/ui/home-widgets/v1')) localStorage.setItem('wafra/ui/home-widgets/v1', layout); }, HOME_LAYOUT);
const BASE = process.env.BASE ?? 'http://127.0.0.1:8134';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(BASE).hostname));
const OUT = process.env.E2E_ARTIFACT_DIR ?? path.join(tmpdir(), 'wafra-transfer-review-e2e');
const KEY = 'wafra/state/v1';
const HISTORICAL_PENDING_COUNT = 3106;
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
  transferEvidence: { version: 1, currency: 'AED', attribution: 'source', reference: 'COLLISION984512' }, ...extra,
});
const rows = [
  tx('salary', 'income', 200000, { title: 'Salary', category: 'salary', transferEvidence: undefined }),
  tx('purchase', 'expense', 10000, { title: 'QA coffee', category: 'dining', transferEvidence: undefined }),
  // A company-suffix category guess cannot bypass transfer ownership review.
  tx('unknown-in', 'income', 30000, { category: 'business' }),
  tx('unknown-out', 'expense', 7000, { isTransfer: true }),
  ...[['group-a', 12000], ['group-b', 8000]].map(([id, amount]) => tx(id, 'expense', amount, {
    isTransfer: true, transferEvidence: { version: 1, currency: 'AED', attribution: 'source', reference: 'COLLISION984512',
      counterparty: { last4: '4999', kind: 'account', bankIdentity: 'adcb' } },
  })),
  tx('legacy-own', 'expense', 4000, { title: 'Own account transfer', isTransfer: true, transferEvidence: undefined }),
  // Reproduce the reported backlog size using synthetic old records, not a private inbox.
  ...Array.from({ length: HISTORICAL_PENDING_COUNT }, (_, i) => tx(`historical-${String(i).padStart(4, '0')}`, 'expense', 10000 + i, {
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
  en: { backup: 'Back up to a file' },
  ar: { backup: 'نسخ احتياطي إلى ملف' },
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
async function home(page, expected, currentPendingCount, historicalPendingCount = HISTORICAL_PENDING_COUNT) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const ids = ['home-income-summary', 'home-spending-total', 'home-net-summary'];
  const amounts = [];
  for (const id of ids) {
    const item = await exposed(page.getByTestId(id));
    amounts.push(minor(await item.getAttribute('aria-label')));
  }
  assert.deepEqual(amounts, expected, 'confirmed Home income, spending and Net');
  // Home counts every transfer waiting, including the intentionally unresolved
  // historical collision backlog. Home v3 says it in the Needs you pill (the
  // Transfers section with its notice is off by default). Completing today's four decisions does not
  // silently classify those 3,106 old records. Wait for the deferred projection,
  // then assert its exact count in either language.
  const pendingCount = historicalPendingCount + currentPendingCount;
  await page.waitForFunction(expectedCount => {
    const notices = [...document.querySelectorAll('[data-testid="home-needs-you-open"]')];
    if (expectedCount === 0) return notices.length === 0;
    if (notices.length !== 1) return false;
    const label = (notices[0].getAttribute('aria-label') ?? '')
      .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
      .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6f0)).replace(/[,٬]/g, '');
    return Number(label.match(/\d+/)?.[0]) === expectedCount;
  }, pendingCount, { timeout: 10000 });
  const notice = page.getByTestId('home-needs-you-open');
  assert.equal(await notice.count(), pendingCount === 0 ? 0 : 1);
  if (pendingCount > 0) assert.equal(minor(await notice.getAttribute('aria-label')) / 100, pendingCount,
    'Home names the exact full review queue, including historical entries');
}
async function decisionOf(page, id, expected) {
  const deadline = Date.now() + 8000;
  let current;
  while (Date.now() < deadline) {
    current = (await stored(page)).transactions.find(row => row.id === id)?.transferDecision?.ownership;
    if (current === expected) return current;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return current;
}
/** An old Review transfers link opens the entry's "What is this?" on Transfers; one tap saves the answer. */
async function choose(page, id, ownership) {
  await page.goto(`${BASE}/review-transfers?transactionId=${id}`, { waitUntil: 'networkidle' });
  await page.waitForURL(/\/transfers\?transactionId=/);
  const question = page.getByTestId('entry-transfer-question');
  await click(question.getByTestId(`transfer-answer-${ownership}`));
  await page.getByTestId('entry-detail-sheet').waitFor({ state: 'hidden' });
  assert.equal(await decisionOf(page, id, ownership), ownership);
}
/** Answer the open entry sheet "my own account"; when several accounts could be the other side, link none. */
async function answerOwnInSheet(page) {
  const detail = page.getByTestId('entry-detail-sheet');
  await click(page.getByTestId('entry-transfer-question').getByTestId('transfer-answer-own'));
  const none = page.getByTestId('entry-transfer-candidate-none');
  await Promise.race([none.waitFor({ state: 'visible' }), detail.waitFor({ state: 'hidden' })]);
  if (await none.isVisible()) await click(none);
  await detail.waitFor({ state: 'hidden' });
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
    const contextOptions = { viewport: { width, height },
      // The fixture date above is Dubai-local; a UTC browser treats these rows
      // as tomorrow between 20:00 and midnight UTC and correctly hides them
      // from a recent-through-today view. Test in the same explicit timezone.
      timezoneId: 'Asia/Dubai',
      locale: language === 'ar' ? 'ar-AE' : 'en-AE', colorScheme: mode, reducedMotion: 'reduce', acceptDownloads: true };
    const context = await browser.newContext(contextOptions);
    await context.route('**/*', route => {
      const url = route.request().url();
      return url.startsWith(BASE + '/') || url.startsWith('data:') || url.startsWith('blob:') ? route.continue() : route.abort();
    });
    await context.addInitScript(({ key, state }) => {
      if (localStorage.getItem('wafra/e2e-transfer-seeded')) return;
      localStorage.setItem(key, JSON.stringify(state));
      localStorage.setItem('wafra/e2e-transfer-seeded', '1');
    }, { key: KEY, state: seed(language, mode) });
    await withHomeLayout(context);
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    try {
      await home(page, [200000, 10000, 190000], 4);
      await page.screenshot({ path: path.join(OUT, `${name}-home-pending.png`) });
      // Transfer review is contextual: open a pending transfer's details, then
      // take its explicit review action. Transfer records live in their own
      // history (docs/design/transfers.md), not among regular transactions.
      await page.goto(`${BASE}/transactions`, { waitUntil: 'networkidle' });
      assert.equal(await page.getByRole('button', { name: /^Outgoing transfer,/ }).count(), 0,
        'transfer records are not regular transaction rows');
      // Home's Needs you pill opens the Transfers page, whose question card takes the queue one at a time.
      await page.goto(BASE + '/', { waitUntil: 'networkidle' });
      await click(page.getByTestId('home-needs-you-open'));
      await page.waitForURL(/\/transfers(?:[?#]|$)/);
      await page.getByTestId('transfers-screen').waitFor({ state: 'visible' });
      await page.getByTestId('transfer-question-card').waitFor({ state: 'visible' });
      await click(page.getByTestId('transfer-row-unknown-out'));
      // The detail sheet asks the one question; its three answers are always offered.
      await fits(page.getByTestId('entry-transfer-question'));
      for (const answer of ['own', 'external', 'none']) {
        assert.equal(await page.getByTestId('entry-transfer-question').getByTestId(`transfer-answer-${answer}`).count(), 1, `detail sheet offers ${answer}`);
      }
      await click(page.getByTestId('entry-detail-done'));
      await page.getByTestId('entry-detail-sheet').waitFor({ state: 'hidden' });
      // "See all" on the question card selects several on this same page: no second screen.
      await click(page.getByTestId('transfer-question-see-all'));
      await page.getByTestId('transfer-selection-footer').waitFor({ state: 'visible' });
      assert.match(page.url(), /\/transfers(?:[?#]|$)/, 'See all stays on Transfers');
      await click(page.getByTestId('transfer-cancel-selection'));
      await page.getByTestId('transfer-selection-footer').waitFor({ state: 'hidden' });
      // An old Review transfers link to one entry opens that entry's question on Transfers.
      await page.goto(`${BASE}/review-transfers?transactionId=unknown-out`, { waitUntil: 'networkidle' });
      await page.waitForURL(/\/transfers\?transactionId=unknown-out/);
      await page.getByTestId('entry-transfer-question').waitFor({ state: 'visible' });
      // The old review address itself is now Transfers, with what waits for an answer at the top as groups.
      await page.goto(`${BASE}/review-transfers`, { waitUntil: 'networkidle' });
      await page.waitForURL(/\/transfers(?:[?#]|$)/);
      await page.getByTestId('transfers-screen').waitFor({ state: 'visible' });
      assert.equal(await page.getByTestId('transfer-group-entry').count(), 0, 'groups are collapsed rows, not a task list');
      await page.screenshot({ path: path.join(OUT, `${name}-recent-groups.png`) });
      // Two transfers to the same masked account (4999) whose reference collides, so the reconciler cannot
      // tell them apart (ambiguous): one route row with its count. It is not answered as a whole: its sheet
      // lists both entries, and each opens its own "What is this?".
      const shared = page.locator('[data-testid^="transfer-group-transfer-group"]').filter({ hasText: '4999' });
      await click(shared);
      const sheet = page.getByTestId('transfer-answer-sheet');
      await sheet.waitFor({ state: 'visible' });
      await fits(sheet);
      assert.equal(await sheet.getByTestId('transfer-group-entry').count(), 2, 'the sheet lists both entries');
      assert.equal(await sheet.getByTestId('transfer-answer-sheet-save').count(), 0, 'no answer for all of them');
      assert.equal(await sheet.getByTestId('transfer-answer-own').count(), 0);
      await sheet.getByTestId('transfer-answer-sheet-one-by-one').waitFor({ state: 'visible' });
      await page.screenshot({ path: path.join(OUT, `${name}-group-sheet.png`) });
      await click(sheet.getByTestId('transfer-group-entry').first());
      await sheet.waitFor({ state: 'hidden' });
      await page.getByTestId('entry-transfer-question').waitFor({ state: 'visible' });
      await page.screenshot({ path: path.join(OUT, `${name}-choices.png`) });
      await answerOwnInSheet(page);
      let first;
      for (const deadline = Date.now() + 8000; !first && Date.now() < deadline;) {
        first = (await stored(page)).transactions.find(row => ['group-a', 'group-b'].includes(row.id) && row.transferDecision);
        if (!first) await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(first, 'the opened entry is answered on its own');
      const other = first.id === 'group-a' ? 'group-b' : 'group-a';
      assert.equal(await decisionOf(page, other, undefined), undefined, 'the other entry is not answered with it');
      await page.goto(`${BASE}/review-transfers?transactionId=${other}`, { waitUntil: 'networkidle' });
      await page.waitForURL(/\/transfers\?transactionId=/);
      await answerOwnInSheet(page);
      for (const id of ['group-a', 'group-b']) assert.equal(await decisionOf(page, id, 'own'), 'own');
      let saved = await stored(page);
      await home(page, [200000, 10000, 190000], 2);
      await choose(page, 'unknown-in', 'external');
      await home(page, [230000, 10000, 220000], 1);
      await choose(page, 'unknown-out', 'external');
      await home(page, [230000, 17000, 213000], 0);
      // Explicit/automatic ownership has an override, not an invisible exclusion.
      await choose(page, 'legacy-own', 'external');
      await home(page, [230000, 21000, 209000], 0);
      await page.reload({ waitUntil: 'networkidle' });
      saved = await stored(page);
      assert.equal(saved.transactions.length, rows.length, 'classification never deletes or duplicates ledger rows');
      const savedById = new Map(saved.transactions.map(t => [t.id, t]));
      for (const original of rows) {
        const current = savedById.get(original.id);
        assert.deepEqual([current.amountFils, current.type, current.accountId], [original.amountFils, original.type, original.accountId]);
      }
      await page.goto(BASE + '/settings', { waitUntil: 'networkidle' });
      await click(page.getByTestId('settings-data-and-help'));
      await page.waitForURL('**/settings-data');
      const backupButton = await exposed(page.getByRole('button', { name: words.backup, exact: false }));
      const [download] = await Promise.all([page.waitForEvent('download'), backupButton.click()]);
      const backup = JSON.parse(await readFile(await download.path(), 'utf8'));
      assert.equal(backup.app, 'wafra');
      assert.deepEqual(backup.data.transactions.map(t => [t.id, t.transferDecision ?? null]).sort(),
        saved.transactions.map(t => [t.id, t.transferDecision ?? null]).sort(), 'real downloaded backup preserves every decision');
      // A saved answer can be taken back from the entry's own sheet: it waits for an answer again.
      await page.goto(`${BASE}/review-transfers?transactionId=unknown-in`, { waitUntil: 'networkidle' });
      await page.waitForURL(/\/transfers\?transactionId=unknown-in/);
      await click(page.getByTestId('entry-transfer-clear'));
      await page.getByTestId('entry-detail-sheet').waitFor({ state: 'hidden' });
      assert.equal(await decisionOf(page, 'unknown-in', undefined), undefined);
      await home(page, [200000, 21000, 179000], 1);
      await page.goto(`${BASE}/review-transfers?transactionId=deleted-entry`, { waitUntil: 'networkidle' });
      await page.getByTestId('transfers-link-notice').waitFor({ state: 'visible' });
      assert.equal(await page.getByTestId('entry-detail-sheet').count(), 0, 'stale route cannot open or classify another row');
      await page.screenshot({ path: path.join(OUT, `${name}-missing-entry.png`) });
      // All 3,106 old transfers remain reachable without creating 3,106 mounted actions.
      await page.goto(`${BASE}/transfers`, { waitUntil: 'networkidle' });
      const historic = page.locator('[data-testid^="transfer-group-transfer-group"]').filter({ hasText: '4222' });
      assert.equal(await historic.count(), 1, 'old unresolved records remain reachable as one group row');
      assert.equal(await page.getByTestId('transfer-scope-all').count(), 0, 'there is no second transfer-history mode');
      await page.locator('input').first().fill('4222');
      await page.waitForFunction(() => [...document.querySelectorAll('[data-testid^="transfer-group-count"]')]
        .some(node => (node.textContent ?? '').replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
          .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6f0)).replace(/[,٬]/g, '').includes('3106')));
      await page.screenshot({ path: path.join(OUT, `${name}-3106-history-collapsed.png`) });
      await click(historic);
      await sheet.waitFor({ state: 'visible' });
      const mounted = await sheet.getByTestId('transfer-group-entry').count();
      assert.ok(mounted > 0 && mounted <= 20, `the group's entries are paged (${mounted})`);
      const beforeLeave = (await stored(page)).transactions.map(t => [t.id, t.transferDecision ?? null]);
      await click(sheet.getByTestId('transfer-answer-sheet-cancel'));
      await sheet.waitFor({ state: 'hidden' });
      assert.deepEqual((await stored(page)).transactions.map(t => [t.id, t.transferDecision ?? null]), beforeLeave,
        'leaving unanswered does not apply or dismiss any decision');
      // A separate reviewed-current-ledger fixture has genuinely no pending
      // queue. Keep the backlog scenario above intact, including its untouched
      // history and Undo checks; do not fake completion of those old records.
      const settledContext = await browser.newContext(contextOptions);
      try {
        await settledContext.route('**/*', route => {
          const url = route.request().url();
          return url.startsWith(BASE + '/') || url.startsWith('data:') || url.startsWith('blob:') ? route.continue() : route.abort();
        });
        const settledRows = saved.transactions.filter(t => !t.id.startsWith('historical-'));
        assert.equal(settledRows.length, 7);
        for (const id of ['group-a', 'group-b', 'unknown-in', 'unknown-out', 'legacy-own']) {
          assert.ok(settledRows.find(t => t.id === id)?.transferDecision, `reviewed fixture retains ${id}'s saved decision`);
        }
        await settledContext.addInitScript(({ key, state }) => {
          if (localStorage.getItem('wafra/e2e-transfer-seeded')) return;
          localStorage.setItem(key, JSON.stringify(state));
          localStorage.setItem('wafra/e2e-transfer-seeded', '1');
        }, { key: KEY, state: { ...seed(language, mode), transactions: settledRows } });
        await withHomeLayout(settledContext);
        const settledPage = await settledContext.newPage();
        settledPage.on('pageerror', error => errors.push(String(error)));
        await home(settledPage, [230000, 21000, 209000], 0, 0);
        const settledStored = await stored(settledPage);
        assert.deepEqual(settledStored.transactions.map(t => [t.id, t.transferDecision ?? null]).sort(),
          settledRows.map(t => [t.id, t.transferDecision ?? null]).sort(), 'empty-queue fixture preserves all reviewed decisions');
        await settledPage.screenshot({ path: path.join(OUT, `${name}-empty-review-queue.png`) });
      } finally { await settledContext.close(); }
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
