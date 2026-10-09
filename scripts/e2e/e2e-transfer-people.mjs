// Transfers grouped by person, through the real web UI with a durable ledger: one person's
// transfers (in and out, every spelling of the name) are one row and one question; the answer is
// saved per entry with Undo; Home's Needs you, the Transactions summary and the Transfers card
// give one count. Synthetic bank records and names in isolated browser contexts.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from 'playwright/test';

const require = createRequire(import.meta.url);
const load = require('../test/repair/load-typescript.cjs');
const copyFor = language => load(fileURLToPath(new URL('../../src/lib/transfer-activity-copy.ts', import.meta.url)),
  { '@/lib/i18n': { getLanguage: () => language } }).transferActivityCopy(language);
const homeCopy = load(fileURLToPath(new URL('../../src/lib/home-copy.ts', import.meta.url))).homeCopy;
const BASE = process.env.BASE ?? 'http://127.0.0.1:8167';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(BASE).hostname));
const OUT = process.env.E2E_ARTIFACT_DIR ?? path.join(tmpdir(), 'wafra-transfer-people-e2e');
await mkdir(OUT, { recursive: true });

const KEY = 'wafra/state/v1', now = Date.now();
const dubaiDate = ts => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(ts);
const accounts = [
  { id: 'qa-current', name: 'QA current', kind: 'bank', bankName: 'ADCB', last4: '4111', openingFils: 1000000, color: '#367A61' },
  { id: 'qa-savings', name: 'QA savings', kind: 'bank', bankName: 'HSBC', last4: '4222', openingFils: 0, color: '#637581' },
];
const tx = (id, type, amountFils, minutesAgo, name, extra = {}) => {
  const ts = now - minutesAgo * 60000, account = type === 'expense' ? accounts[0] : accounts[1];
  return { id, type, amountFils, accountId: account.id, category: 'other',
    title: name ? `Transfer ${type === 'expense' ? 'to' : 'from'} ${name}` : type === 'expense' ? 'Outgoing transfer' : 'Incoming transfer',
    date: dubaiDate(ts), ts, source: 'sms', smsKey: `s${ts}-${id}`,
    captureInstrument: { last4: account.last4, kind: 'account', bankIdentity: account.bankName.toLowerCase() },
    transferEvidence: { version: 1, currency: 'AED', attribution: 'source', sourceBank: account.bankName,
      ...(name ? { counterpartyName: name } : {}) }, ...extra };
};
// Mariam S in three spellings, money both ways; Khalid R once; one transfer that names nobody.
const MARIAM = ['m1', 'm2', 'm3'], MARIAM_OUT = 40000 + 10000, MARIAM_IN = 15000;
const transactions = [
  tx('salary', 'income', 500000, 300, null, { title: 'Salary', category: 'salary', transferEvidence: undefined, captureInstrument: undefined }),
  tx('coffee', 'expense', 2500, 290, null, { title: 'QA coffee', category: 'dining', transferEvidence: undefined }),
  tx('m1', 'expense', 40000, 200, 'MARIAM S'),
  tx('m2', 'income', MARIAM_IN, 150, 'Mariam S.'),
  tx('m3', 'expense', 10000, 100, 'MARIAM S'),
  tx('k1', 'expense', 7000, 90, 'KHALID R'),
  tx('u1', 'expense', 3000, 80, null),
];
const WAITING = 5;
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
const decided = async (page, ids) => (await stored(page)).filter(row => ids.includes(row.id) && row.transferDecision);
const minor = value => {
  const normalized = String(value).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
    .replace(/[؜‎‏⁦-⁩]/g, '').replace(/٬/g, ',').replace(/٫/g, '.').replace(/−/g, '-');
  const match = normalized.match(/-?\d[\d,]*(?:\.\d{1,2})?/);
  assert.ok(match, `No monetary amount in ${value}`);
  return Math.round(Number(match[0].replaceAll(',', '')) * 100);
};
async function fits(page, locator, label) {
  const clipped = await locator.evaluate(node => [...node.querySelectorAll('*')].filter(n => {
    if (n.children.length || !n.textContent?.trim()) return false;
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.bottom > 0 && r.top < innerHeight && (r.left < -1 || r.right > innerWidth + 1);
  }).map(n => n.textContent));
  assert.deepEqual(clipped, [], `${label}: visible text fits the phone width`);
}
/** Home's pill, the Transactions summary and the Transfers card, each saying `count`. */
async function sameCount(page, words, home, count) {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  if (count > 0) await expect(page.getByTestId('home-needs-you-open')).toHaveAttribute('aria-label', home.transfersToAnswer(count));
  else await expect(page.getByTestId('home-needs-you-open')).toHaveCount(0);
  await page.goto(`${BASE}/transactions`, { waitUntil: 'networkidle' });
  const strip = page.getByTestId('transactions-separated-transfers');
  await expect(strip).toBeVisible();
  if (count > 0) await expect(strip).toContainText(words.strip.needsAnswer(count));
  else await expect(strip).not.toContainText(words.strip.needsAnswer(1).replace(/^1/, ''));
  const net = minor(await page.getByTestId('transactions-net-total').innerText());
  await page.goto(`${BASE}/transfers`, { waitUntil: 'networkidle' });
  // The To answer tab says the count (and is the view the page opens on while anything waits).
  if (count > 0) {
    await expect(page.getByTestId('transfers-view-answer')).toHaveAttribute('aria-label', `${words.views.answer}. ${words.card.title(count)}`);
    await expect(page.getByTestId('transfers-view-answer')).toHaveAttribute('aria-selected', 'true');
  }
  return net;
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const results = [];
try {
  for (const [language, theme, width, height] of [['en', 'light', 390, 844], ['en', 'dark', 390, 844], ['ar', 'dark', 390, 844], ['ar', 'light', 320, 568]]) {
    const name = `${language}-${theme}-${width}`, words = copyFor(language), home = homeCopy(language);
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme,
      locale: language === 'ar' ? 'ar-AE' : 'en-AE', timezoneId: 'Asia/Dubai', reducedMotion: 'reduce' });
    await context.route('**/*', route => {
      const url = route.request().url();
      return url.startsWith(BASE + '/') || url.startsWith('data:') || url.startsWith('blob:') ? route.continue() : route.abort();
    });
    await context.addInitScript(({ key, state }) => {
      if (localStorage.getItem('wafra/e2e-transfer-people-seeded')) return;
      localStorage.clear(); localStorage.setItem(key, JSON.stringify(state));
      localStorage.setItem('wafra/e2e-transfer-people-seeded', '1');
    }, { key: KEY, state: seed(language, theme) });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    try {
      // One count everywhere: three with Mariam, one with Khalid, one naming nobody.
      const netBefore = await sameCount(page, words, home, WAITING);
      const screen = page.getByTestId('transfers-screen');
      await expect(screen).toBeVisible();
      const card = page.getByTestId('transfer-question-card');
      await expect(card.getByTestId('transfer-question-person')).toContainText('MARIAM S');
      // The card walks the two people; the transfer that names nobody is counted and is one row in the list
      // that opens select mode.
      await expect(card).toContainText(words.card.step(1, 2));
      await expect(card.getByTestId('transfer-question-person')).toContainText(words.person.transfers(3));
      await expect(screen.getByTestId('transfer-question-unnamed')).toHaveAttribute('aria-label',
        `${words.card.unnamedTitle(1)}. ${words.card.unnamedBody}`);
      // The person on the card is not listed under it a second time.
      const mariam = screen.getByTestId('transfer-person-person:mariam s');
      await expect(mariam).toHaveCount(0);
      await expect(screen.getByTestId('transfer-person-person:khalid r')).toBeVisible();
      await expect(screen.getByTestId('transfer-person-person:khalid r').getByTestId('transfer-person-count')).toContainText(words.person.transfers(1));
      await fits(page, screen, `${name} page`);
      await page.screenshot({ path: path.join(OUT, `${name}-1-people.png`) });
      // History lists the period's transfers: the unnamed one waits there; Mariam's are answered as the person.
      await page.getByTestId('transfers-view-history').click();
      await expect(screen.getByTestId('transfer-row-u1')).toContainText(words.tags.needsAnswer);
      for (const id of MARIAM) await expect(screen.getByTestId(`transfer-row-${id}`)).toHaveCount(0);
      await page.getByTestId('transfers-view-answer').click();

      // The card's answer opens the sheet: the person, every entry and the count; nothing saved yet.
      await card.getByTestId('transfer-answer-external').click();
      const sheet = page.getByTestId('transfer-answer-sheet');
      await expect(sheet).toBeVisible();
      await expect(sheet.getByTestId('transfer-batch-preview-person')).toContainText('MARIAM S');
      await expect(sheet.getByTestId('transfer-answer-sheet-person')).toBeVisible();
      await expect(sheet.getByTestId('transfer-group-entry')).toHaveCount(3);
      await expect(sheet.getByTestId('transfer-answer-external')).toHaveAttribute('aria-checked', 'true');
      await expect(sheet.getByTestId('transfer-answer-sheet-save')).toHaveAttribute('aria-label', words.batch.save(3));
      assert.equal((await decided(page, MARIAM)).length, 0, 'opening the sheet writes nothing');
      await fits(page, sheet, `${name} sheet`);
      await page.screenshot({ path: path.join(OUT, `${name}-2-person-sheet.png`) });
      await sheet.getByTestId('transfer-answer-sheet-save').click();
      await expect(sheet).toHaveCount(0);
      await expect.poll(async () => (await decided(page, MARIAM)).length).toBe(3);
      for (const row of await decided(page, MARIAM)) {
        assert.equal(row.transferDecision.ownership, 'external');
        assert.equal(row.transferDecision.counterpartId, undefined, 'never linked');
      }
      // Answered: the card moves on to Khalid.
      await expect(card.getByTestId('transfer-question-person')).toContainText('KHALID R');
      // Undo from the toast clears all three, and the card asks about Mariam again.
      await page.getByRole('button', { name: words.answers.undo, exact: true }).click();
      await expect.poll(async () => (await decided(page, MARIAM)).length).toBe(0);
      await expect(card.getByTestId('transfer-question-person')).toContainText('MARIAM S');

      // Saved again, from the list this time (searching lists the card's person too): someone else counts in Net
      // on Transactions, and every count follows.
      await screen.locator('input').first().fill('mariam');
      await expect(mariam).toBeVisible();
      await expect(mariam.getByTestId('transfer-person-count')).toContainText(words.person.transfers(3));
      await mariam.click();
      await sheet.getByTestId('transfer-answer-external').click();
      await sheet.getByTestId('transfer-answer-sheet-save').click();
      await expect.poll(async () => (await decided(page, MARIAM)).length).toBe(3);
      const netAfter = await sameCount(page, words, home, WAITING - 3);
      assert.equal(netAfter - netBefore, MARIAM_IN - MARIAM_OUT, 'paid and received from someone else now count in Net');

      // Select mode: a person is one tick; own for Khalid saves one own answer, never linked. The unnamed
      // transfer is a tick of its own there.
      await page.getByTestId('transfer-question-unnamed').click();
      await expect(screen.getByTestId('transfer-row-u1')).toHaveAttribute('role', 'checkbox');
      await screen.getByTestId('transfer-person-person:khalid r').click();
      const bar = page.getByTestId('transfer-selection-footer');
      await expect(bar).toContainText(words.select.selected(1));
      await page.screenshot({ path: path.join(OUT, `${name}-3-select-person.png`) });
      await bar.getByTestId('transfer-answer-own').click();
      await expect(sheet.getByTestId('transfer-answer-sheet-save')).toHaveAttribute('aria-label', words.batch.save(1));
      await sheet.getByTestId('transfer-answer-sheet-save').click();
      await expect.poll(async () => (await decided(page, ['k1'])).map(row => row.transferDecision.ownership)).toEqual(['own']);
      assert.equal((await decided(page, ['k1']))[0].transferDecision.counterpartId, undefined);
      const netOwn = await sameCount(page, words, home, WAITING - 4);
      // Only the unnamed transfer waits: no question card, the counted link opens select mode.
      await expect(page.getByTestId('transfer-question-card')).toHaveCount(0);
      await expect(page.getByTestId('transfers-review-link')).toBeVisible();
      assert.equal(netOwn, netAfter, 'own money stays out of Net');
      await page.reload({ waitUntil: 'networkidle' });
      assert.equal((await decided(page, [...MARIAM, 'k1'])).length, 4, 'answers survive reopening');
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
assert.ok(results.every(result => result.pass), `Transfer people failures; screenshots in ${OUT}`);
