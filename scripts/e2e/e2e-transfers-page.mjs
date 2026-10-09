// Transfers page and Transactions summary, driven through the real web UI.
// Synthetic bank records in isolated browser contexts; nothing leaves localhost.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from 'playwright/test';

const require = createRequire(import.meta.url);
const copyFor = require('../test/repair/load-typescript.cjs')(
  fileURLToPath(new URL('../../src/lib/transfer-activity-copy.ts', import.meta.url)),
  { '@/lib/i18n': { getLanguage: () => 'en' } },
).transferActivityCopy;
const BASE = process.env.BASE ?? 'http://127.0.0.1:8167';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(BASE).hostname));
const OUT = process.env.E2E_ARTIFACT_DIR ?? path.join(tmpdir(), 'wafra-transfers-page-e2e');
await mkdir(OUT, { recursive: true });

const KEY = 'wafra/state/v1', now = Date.now();
const dubaiDate = ts => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(ts);
const accounts = [
  { id: 'qa-current', name: 'QA current', kind: 'bank', bankName: 'ADCB', last4: '4111', openingFils: 1000000, color: '#367A61' },
  { id: 'qa-savings', name: 'QA savings', kind: 'bank', bankName: 'HSBC', last4: '4222', openingFils: 0, color: '#637581' },
];
const OWN_FILS = 15000, SENT_FILS = 8500, RECEIVED_FILS = 3000, NONE_FILS = 7000;
const tx = (id, type, amountFils, minutesAgo, extra = {}) => {
  const ts = now - minutesAgo * 60000, account = type === 'expense' ? accounts[0] : accounts[1];
  return { id, type, amountFils, accountId: account.id, category: 'other',
    title: type === 'expense' ? 'Outgoing transfer' : 'Incoming transfer',
    date: dubaiDate(ts), ts, source: 'sms', smsKey: `s${ts}-${id}`,
    captureInstrument: { last4: account.last4, kind: 'account', bankIdentity: account.bankName.toLowerCase() },
    transferEvidence: { version: 1, currency: 'AED', attribution: 'source', sourceBank: account.bankName }, ...extra };
};
const transactions = [
  tx('salary', 'income', 200000, 600, { title: 'Salary', category: 'salary', accountId: 'qa-current',
    captureInstrument: undefined, transferEvidence: undefined }),
  tx('coffee', 'expense', 10000, 590, { title: 'QA coffee', category: 'dining', transferEvidence: undefined }),
  // A confirmed own-account pair: the outgoing alert states the destination account.
  tx('own-out', 'expense', OWN_FILS, 500, { isTransfer: true,
    transferEvidence: { version: 1, currency: 'AED', attribution: 'source', sourceBank: 'ADCB', explicitOwn: true,
      counterparty: { last4: '4222', kind: 'account', bankIdentity: 'hsbc' } } }),
  tx('own-in', 'income', OWN_FILS, 499),
  // Explicit transfers to and from other people.
  tx('ext-out', 'expense', SENT_FILS, 400, { isTransfer: true,
    transferEvidence: { version: 1, currency: 'AED', attribution: 'source', sourceBank: 'ADCB', explicitExternal: true, counterpartyName: 'Ahmed K.' } }),
  tx('ext-in', 'income', RECEIVED_FILS, 300, { transferEvidence: { version: 1, currency: 'AED', attribution: 'source',
    sourceBank: 'HSBC', explicitExternal: true, counterpartyName: 'Sara M.' } }),
  // Two unconfirmed movements, each with both legs queued. A pair is one question, asked about its
  // outgoing leg, so the card opens at "1 of 2" on q-out (the newer movement). Answering it settles
  // q-in too ("1 of 1"); Undo brings back "1 of 2".
  tx('p-out', 'expense', 5600, 250),
  tx('p-in', 'income', 5600, 240),
  tx('q-out', 'expense', 12300, 200),
  tx('q-in', 'income', 12300, 190),
  // A flagged transfer nobody has answered and the reconciler does not queue. It names nobody: it needs an
  // answer and is counted, but the card does not walk such one-offs; its footer offers select mode for them.
  tx('unk-out', 'expense', NONE_FILS, 100, { isTransfer: true, transferEvidence: undefined }),
];
const OPEN_ROWS = 8; // own pair (one row), ext-out, ext-in, p-out, p-in, q-out, q-in, unk-out
const QUEUED = 2; // movements needing an answer: one question per pair
const seed = (language, theme) => ({
  ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 }, accounts, transactions,
  budgets: [], bills: [], cardDues: [], goals: [], merchantOverrides: {}, accountHints: {}, notSubscriptions: [],
  localCaptureQualifications: [], iosCaptureWarning: null, onboardingPlan: null, onboardingCurrencyEvidence: null,
  onboarded: true, userName: 'QA', appLock: false, marketId: 'AE', language, languagePreference: language,
  themePreference: theme, monthStartDay: 1, pro: false, founderPro: false, trialStartTs: now,
  privateMode: false, captureOptOut: true, dailySummary: false, parserVersion: 999, lastScanTs: 0,
  historyImport: null, txChunks: 0, txChunkOrder: 'oldest-first',
});
const minor = value => {
  const normalized = String(value).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6f0))
    .replace(/[؜‎‏]/g, '').replace(/٬/g, ',').replace(/٫/g, '.').replace(/−/g, '-');
  const match = normalized.match(/\d[\d,]*(?:\.\d{1,2})?/);
  assert.ok(match, `No monetary amount in ${value}`);
  return Math.round(Number(match[0].replaceAll(',', '')) * 100);
};
const digits = value => String(value).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
  .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6f0));
async function stored(page) {
  return page.evaluate(key => {
    const meta = JSON.parse(localStorage.getItem(key) ?? '{}');
    return meta.transactions ?? Array.from({ length: meta.txChunks ?? 0 }, (_, n) =>
      JSON.parse(localStorage.getItem(`${key}:tx:${n}`) ?? '[]')).flat();
  }, KEY);
}
const rowIds = page => page.locator('[data-testid^="transfer-row-"]').evaluateAll(nodes =>
  nodes.map(node => node.getAttribute('data-testid').replace('transfer-row-', '')).sort());
const stepOf = async (page, i, n) => {
  const card = page.getByTestId('transfer-question-card');
  await expect(card).toBeVisible();
  await expect.poll(async () => digits(await card.innerText()).replace(/\s+/g, ' ')).toMatch(
    new RegExp(`(^|\\D)${i}\\D+${n}(\\D|$)`));
};
async function fits(page, testId) {
  const clipped = await page.getByTestId(testId).evaluate(node => [...node.querySelectorAll('*')].filter(n => {
    if (n.children.length || !n.textContent?.trim()) return false;
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.bottom > 0 && r.top < innerHeight && (r.left < -1 || r.right > innerWidth + 1);
  }).map(n => n.textContent));
  assert.deepEqual(clipped, [], `${testId}: visible text fits the phone width`);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const results = [];
try {
  for (const width of [320, 390]) for (const theme of ['light', 'dark']) for (const language of ['en', 'ar']) {
    const name = `${language}-${theme}-${width}`, height = width === 320 ? 568 : 844, words = copyFor(language);
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme,
      locale: language === 'ar' ? 'ar-AE' : 'en-AE', timezoneId: 'Asia/Dubai', reducedMotion: 'reduce' });
    await context.route('**/*', route => {
      const url = route.request().url();
      return url.startsWith(BASE + '/') || url.startsWith('data:') || url.startsWith('blob:') ? route.continue() : route.abort();
    });
    await context.addInitScript(({ key, state }) => {
      if (localStorage.getItem('wafra/e2e-transfers-page-seeded')) return;
      localStorage.clear(); localStorage.setItem(key, JSON.stringify(state));
      localStorage.setItem('wafra/e2e-transfers-page-seeded', '1');
    }, { key: KEY, state: seed(language, theme) });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    try {
      // 4. Transactions summary: the count line and the net sit on separate lines, and the line is not squeezed.
      await page.goto(`${BASE}/transactions`, { waitUntil: 'networkidle' });
      await expect(page.getByTestId('transactions-summary')).toBeVisible();
      const line = await page.getByTestId('transactions-summary-line').boundingBox();
      const net = await page.getByTestId('transactions-net-total').boundingBox();
      assert.ok(line && net, 'summary line and net are both laid out');
      assert.notEqual(Math.round(line.y), Math.round(net.y), 'summary line and net do not share a row');
      assert.ok(line.width > 200, `summary line is not squeezed (${Math.round(line.width)}px)`);
      await expect(page.getByTestId('transactions-separated-transfers')).toBeVisible();
      await fits(page, 'transactions-summary');
      const netBefore = minor(await page.getByTestId('transactions-net-total').innerText());
      await page.screenshot({ path: path.join(OUT, `${name}-transactions.png`) });

      // 1. Tiles (History): own total, and Sent filters to external rows only.
      await page.goto(`${BASE}/transfers`, { waitUntil: 'networkidle' });
      await expect(page.getByTestId('transfers-screen')).toBeVisible();
      // Something waits, so the page opens on To answer; the period's transfers are under History.
      await expect(page.getByTestId('transfers-view-answer')).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('transfers-tile-own')).toHaveCount(0);
      await page.getByTestId('transfers-view-history').click();
      await expect(page.getByTestId('transfers-view-history')).toHaveAttribute('aria-selected', 'true');
      assert.equal(minor(await page.getByTestId('transfers-tile-own').getAttribute('aria-label')), OWN_FILS, 'Your accounts tile total');
      assert.equal(minor(await page.getByTestId('transfers-tile-sent').getAttribute('aria-label')), SENT_FILS, 'Sent tile total');
      assert.equal(minor(await page.getByTestId('transfers-tile-received').getAttribute('aria-label')), RECEIVED_FILS, 'Received tile total');
      assert.deepEqual(await rowIds(page), ['ext-in', 'ext-out', 'own-out|own-in', 'p-in', 'p-out', 'q-in', 'q-out', 'unk-out'], 'one row per transfer');
      assert.equal(await rowIds(page).then(ids => ids.length), OPEN_ROWS);
      await fits(page, 'transfers-screen');
      await page.screenshot({ path: path.join(OUT, `${name}-transfers.png`) });
      await page.getByTestId('transfers-tile-sent').click();
      assert.deepEqual(await rowIds(page), ['ext-out'], 'Sent leaves only the outgoing external row');
      await page.getByTestId('transfers-tile-sent').click();
      await expect.poll(() => rowIds(page).then(ids => ids.length)).toBe(OPEN_ROWS);

      // 2. The question card (To answer): answer, Undo, and the count follows.
      await page.getByTestId('transfers-view-answer').click();
      await stepOf(page, 1, QUEUED);
      // Every transfer waiting is counted on the tab (two movements and the unnamed one); the unnamed one is a
      // row in the list that opens select mode.
      const answerTab = page.getByTestId('transfers-view-answer');
      await expect(answerTab).toHaveAttribute('aria-label', `${words.views.answer}. ${words.card.title(3)}`);
      await expect(page.getByTestId('transfer-question-unnamed')).toHaveAttribute('aria-label', `${words.card.unnamedTitle(1)}. ${words.card.unnamedBody}`);
      await page.getByTestId('transfer-answer-external').click();
      const toast = page.getByText(new RegExp(`^${words.answers.saved}`)).first();
      await expect(toast).toBeVisible();
      const undo = page.getByRole('button', { name: words.answers.undo, exact: true });
      await expect(undo).toBeVisible();
      await stepOf(page, 1, QUEUED / 2);
      // The other leg of the answered movement is not counted yet, so it still needs an answer: it is counted
      // and joins the unnamed one-offs offered through select mode.
      await expect(answerTab).toHaveAttribute('aria-label', `${words.views.answer}. ${words.card.title(3)}`);
      await expect(page.getByTestId('transfer-question-unnamed')).toHaveAttribute('aria-label', `${words.card.unnamedTitle(2)}. ${words.card.unnamedBody}`);
      const answered = (await stored(page)).filter(row => row.transferDecision);
      assert.equal(answered.length, 1, 'one decision saved');
      assert.equal(answered[0].transferDecision.ownership, 'external');
      await undo.click();
      await stepOf(page, 1, QUEUED);
      await expect.poll(async () => (await stored(page)).filter(row => row.transferDecision).length).toBe(0);
      await page.screenshot({ path: path.join(OUT, `${name}-question.png`) });

      // 3. Not a transfer (History): the row leaves Transfers and is counted in Net on Transactions.
      await page.getByTestId('transfers-view-history').click();
      await page.getByTestId('transfer-row-unk-out').click();
      await expect(page.getByTestId('entry-transfer-question')).toBeVisible();
      await fits(page, 'entry-transfer-question');
      await page.screenshot({ path: path.join(OUT, `${name}-detail.png`) });
      await page.getByTestId('entry-transfer-question').getByTestId('transfer-answer-none').click();
      await expect(page.getByTestId('entry-detail-sheet')).toHaveCount(0);
      await expect(page.getByTestId('transfer-row-unk-out')).toHaveCount(0);
      await expect.poll(async () => (await stored(page)).find(row => row.id === 'unk-out')?.transferDecision?.ownership).toBe('none');
      await page.goto(`${BASE}/transactions`, { waitUntil: 'networkidle' });
      if (language === 'en') await expect(page.getByRole('button', { name: /^Outgoing transfer,/ })).toHaveCount(1);
      const netAfter = minor(await page.getByTestId('transactions-net-total').innerText());
      assert.equal(netBefore - netAfter, NONE_FILS, 'the answered row now counts in Net');
      await page.goto(`${BASE}/transfers`, { waitUntil: 'networkidle' });
      await page.getByTestId('transfers-view-history').click();
      await expect(page.getByTestId('transfer-row-p-out')).toBeVisible();
      await expect(page.getByTestId('transfer-row-unk-out')).toHaveCount(0);
      await page.screenshot({ path: path.join(OUT, `${name}-transfers-after.png`) });
      assert.deepEqual(errors, []);
      results.push({ name, pass: true });
      console.log(`PASS ${name}`);
    } catch (error) {
      await page.screenshot({ path: path.join(OUT, `${name}-failure.png`) }).catch(() => {});
      results.push({ name, pass: false, error: error.stack, pageErrors: errors });
      console.log(`FAIL ${name}: ${error.stack ?? error}`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
await writeFile(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
assert.ok(results.every(result => result.pass), `Transfers page failures; screenshots in ${OUT}`);
