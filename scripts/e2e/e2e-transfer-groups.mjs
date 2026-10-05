// One Transfers page: a group of likely card repayments, its "What is this?" sheet with
// the "Linked to …" card, select mode and the batch preview, driven through the real
// web UI with a durable ledger. Synthetic bank records in isolated contexts.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from 'playwright/test';
import { cardRepaymentGroup } from './transfer-fixtures.mjs';

const require = createRequire(import.meta.url);
const copyFor = require('../test/repair/load-typescript.cjs')(
  fileURLToPath(new URL('../../src/lib/transfer-activity-copy.ts', import.meta.url)),
  { '@/lib/i18n': { getLanguage: () => 'en' } },
).transferActivityCopy;
const BASE = process.env.BASE ?? 'http://127.0.0.1:8167';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(BASE).hostname));
const OUT = process.env.E2E_ARTIFACT_DIR ?? path.join(tmpdir(), 'wafra-transfer-groups-e2e');
await mkdir(OUT, { recursive: true });

const KEY = 'wafra/state/v1', now = Date.now();
const dubaiDate = ts => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(ts);
const group = cardRepaymentGroup(now);
const own = [
  { id: 'qa-current', name: 'QA current', kind: 'bank', bankName: 'ADCB', last4: '4111', openingFils: 1000000, color: '#367A61' },
  { id: 'qa-savings', name: 'QA savings', kind: 'bank', bankName: 'HSBC', last4: '4222', openingFils: 0, color: '#637581' },
];
// Two suggested own-account movements (out of current, into savings ten minutes later).
const leg = (id, type, amountFils, minutesAgo) => {
  const ts = now - minutesAgo * 60000, account = type === 'expense' ? own[0] : own[1];
  return { id, type, amountFils, accountId: account.id, category: 'other', title: type === 'expense' ? 'Outgoing transfer' : 'Incoming transfer',
    date: dubaiDate(ts), ts, source: 'sms', smsKey: `s${ts}-${id}`,
    captureInstrument: { last4: account.last4, kind: 'account', bankIdentity: account.bankName.toLowerCase() },
    transferEvidence: { version: 1, currency: 'AED', attribution: 'source', sourceBank: account.bankName } };
};
const transactions = [...group.transactions,
  leg('p-out', 'expense', 5600, 250), leg('p-in', 'income', 5600, 240), leg('q-out', 'expense', 12300, 200), leg('q-in', 'income', 12300, 190)];
const accounts = [...group.accounts, ...own];
const GROUP_IDS = group.transactions.filter(tx => tx.id.startsWith('liv-')).map(tx => tx.id);
const seed = (language, theme) => ({
  ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 }, accounts, transactions,
  budgets: [], bills: [], cardDues: [], goals: [], merchantOverrides: {}, accountHints: {}, notSubscriptions: [],
  localCaptureQualifications: [], iosCaptureWarning: null, onboardingPlan: null, onboardingCurrencyEvidence: null,
  onboarded: true, userName: 'QA', appLock: false, marketId: 'AE', language, languagePreference: language,
  themePreference: theme, monthStartDay: 1, pro: false, founderPro: false, trialStartTs: now,
  privateMode: false, captureOptOut: true, dailySummary: false, parserVersion: 999, lastScanTs: 0,
  historyImport: null, txChunks: 0, txChunkOrder: 'oldest-first',
});
async function stored(page) {
  return page.evaluate(key => {
    const meta = JSON.parse(localStorage.getItem(key) ?? '{}');
    return meta.transactions ?? Array.from({ length: meta.txChunks ?? 0 }, (_, n) =>
      JSON.parse(localStorage.getItem(`${key}:tx:${n}`) ?? '[]')).flat();
  }, KEY);
}
const decided = async (page, ids) => (await stored(page)).filter(tx => ids.includes(tx.id) && tx.transferDecision);
async function fits(page, locator, label) {
  const clipped = await locator.evaluate(node => [...node.querySelectorAll('*')].filter(n => {
    if (n.children.length || !n.textContent?.trim()) return false;
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.bottom > 0 && r.top < innerHeight && (r.left < -1 || r.right > innerWidth + 1);
  }).map(n => n.textContent));
  assert.deepEqual(clipped, [], `${label}: visible text fits the phone width`);
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const results = [];
try {
  for (const [language, theme, width, height] of [['en', 'light', 390, 844], ['en', 'dark', 390, 844], ['ar', 'light', 320, 568], ['ar', 'dark', 390, 844]]) {
    const name = `${language}-${theme}-${width}`, words = copyFor(language);
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme,
      locale: language === 'ar' ? 'ar-AE' : 'en-AE', timezoneId: 'Asia/Dubai', reducedMotion: 'reduce' });
    await context.route('**/*', route => {
      const url = route.request().url();
      return url.startsWith(BASE + '/') || url.startsWith('data:') || url.startsWith('blob:') ? route.continue() : route.abort();
    });
    await context.addInitScript(({ key, state }) => {
      if (localStorage.getItem('wafra/e2e-transfer-groups-seeded')) return;
      localStorage.clear(); localStorage.setItem(key, JSON.stringify(state));
      localStorage.setItem('wafra/e2e-transfer-groups-seeded', '1');
    }, { key: KEY, state: seed(language, theme) });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`${BASE}/transfers`, { waitUntil: 'networkidle' });
      const screen = page.getByTestId('transfers-screen');
      await expect(screen).toBeVisible();
      // The six likely card repayments are one route row: Liv Account → ?, 6 entries, waiting for an answer.
      const row = screen.locator('[data-testid^="transfer-group-transfer-group"]').filter({ hasText: 'Liv' });
      await expect(row).toHaveCount(1);
      await expect(row.getByTestId('transfer-group-count')).toContainText(words.group.entries(6));
      await expect(row).toContainText('ADCB Credit Card');
      await expect(screen.getByTestId('transfers-list-head')).toContainText(words.group.section);
      await fits(page, screen, `${name} page`);
      await page.screenshot({ path: path.join(OUT, `${name}-1-page-with-group.png`) });

      // Its sheet is the same "What is this?" with the three answers; the card is "Linked to …" under own.
      await row.click();
      const sheet = page.getByTestId('transfer-answer-sheet');
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText(words.answers.question);
      for (const answer of ['own', 'external', 'none']) await expect(sheet.getByTestId(`transfer-answer-${answer}`)).toHaveCount(1);
      await expect(sheet.getByTestId('transfer-answer-own-suggestion')).toContainText('ADCB Credit Card');
      await expect(sheet.getByTestId('transfer-answer-own-suggestion')).toContainText(words.answers.suggestedOnly);
      // Each entry names its matching card payment: the card, what it was, when and how much.
      await expect(sheet.getByTestId('transfer-group-entry-match')).toHaveCount(6);
      await expect(sheet.getByTestId('transfer-group-entry-match').first()).toContainText('Payment received');
      await expect(sheet.getByTestId('transfer-group-entry')).toHaveCount(6);
      for (const old of ['Check a transfer', 'Save classification', 'Leave as recorded', 'What was this transfer?', 'Matching bank entry']) {
        await expect(sheet).not.toContainText(old);
      }
      await expect(sheet.getByTestId('transfer-answer-sheet-save')).toBeDisabled();
      await fits(page, sheet, `${name} sheet`);
      await page.screenshot({ path: path.join(OUT, `${name}-2-group-sheet-linked.png`) });

      // Own for all six, through the batch path; the card receipts are left as recorded (not linked).
      await sheet.getByTestId('transfer-answer-own').click();
      await expect(sheet.getByTestId('transfer-answer-sheet-save')).toHaveAttribute('aria-label', words.batch.save(6));
      await sheet.getByTestId('transfer-answer-sheet-save').click();
      await expect(sheet).toHaveCount(0);
      await expect.poll(async () => (await decided(page, GROUP_IDS)).length).toBe(6);
      for (const tx of await decided(page, GROUP_IDS)) {
        assert.equal(tx.transferDecision.ownership, 'own');
        assert.equal(tx.transferDecision.counterpartId, undefined, 'a card repayment answer is not a pair link');
      }
      await expect(row).toHaveCount(0);
      // Undo from the toast clears all six.
      await page.getByRole('button', { name: words.answers.undo, exact: true }).click();
      await expect.poll(async () => (await decided(page, GROUP_IDS)).length).toBe(0);
      await expect(row).toHaveCount(1);

      // Select several: Select in the list head, tick the group and a pair, the bar's three answers.
      await screen.getByTestId('transfers-select').click();
      const bar = page.getByTestId('transfer-selection-footer');
      await expect(bar).toContainText(words.select.none);
      // On a 320pt phone the Undo toast (kept long on web, which reports a screen reader) covers the
      // middle of the row; tap its top edge.
      await row.click({ position: { x: 12, y: 8 } });
      await screen.getByTestId('transfer-row-p-out|p-in').click();
      await expect(bar).toContainText(words.select.selected(2));
      await expect(bar.getByTestId('transfer-answer-own')).toBeVisible();
      await fits(page, bar, `${name} bar`);
      await page.screenshot({ path: path.join(OUT, `${name}-3-select-mode-bar.png`) });
      await bar.getByTestId('transfer-answer-own').click();
      await expect(sheet).toBeVisible();
      await expect(sheet.getByTestId('transfer-batch-preview-item')).toHaveCount(2);
      await expect(sheet.getByTestId('transfer-answer-sheet-save')).toHaveAttribute('aria-label', words.batch.save(8));
      await fits(page, sheet, `${name} preview`);
      await page.screenshot({ path: path.join(OUT, `${name}-4-batch-preview.png`) });
      await sheet.getByTestId('transfer-answer-sheet-save').click();
      await expect(sheet).toHaveCount(0);
      await expect.poll(async () => (await decided(page, [...GROUP_IDS, 'p-out', 'p-in'])).length).toBe(8);
      const pair = await decided(page, ['p-out', 'p-in']);
      assert.deepEqual(pair.map(tx => tx.transferDecision.counterpartId).sort(), ['p-in', 'p-out'], 'the pair is linked both ways');
      await expect(bar).toHaveCount(0);
      await page.reload({ waitUntil: 'networkidle' });
      assert.equal((await decided(page, [...GROUP_IDS, 'p-out', 'p-in'])).length, 8, 'answers survive reopening');
      assert.equal((await stored(page)).length, transactions.length, 'no row is added or lost');
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
assert.ok(results.every(result => result.pass), `Transfer groups failures; screenshots in ${OUT}`);
