// Actual web UI and durable ledger; synthetic bank records in isolated contexts.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from 'playwright/test';

const require = createRequire(import.meta.url);
const wordsFor = require('../test/repair/load-typescript.cjs')(
  fileURLToPath(new URL('../../src/lib/transfer-review-copy.ts', import.meta.url)),
  { '@/lib/i18n': { getLanguage: () => 'en' } },
).transferReviewCopy;
const BASE = process.env.BASE ?? 'http://127.0.0.1:8167';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(BASE).hostname));
const OUT = process.env.E2E_ARTIFACT_DIR ?? path.join(tmpdir(), 'wafra-transfer-batch-e2e');
await mkdir(OUT, { recursive: true });
const KEY = 'wafra/state/v1', now = Date.now(), PAIRS = 256;
const accounts = [
  { id: 'qa-current', name: 'QA current', kind: 'bank', bankName: 'ADCB', last4: '4111', openingFils: 100000, color: '#367A61' },
  { id: 'qa-savings', name: 'QA savings', kind: 'bank', bankName: 'HSBC', last4: '4222', openingFils: 0, color: '#637581' },
];
const transactions = Array.from({ length: PAIRS }, (_, i) => ['expense', 'income'].map((type, direction) => {
  const account = accounts[direction], ts = now - 86400000 + i * 1000 + direction * 600000;
  return { id: `qa-${i}-${direction ? 'in' : 'out'}`, type, amountFils: 12000 + i * 100,
    accountId: account.id, category: 'other', title: direction ? 'Incoming transfer' : 'Outgoing transfer',
    date: new Date(ts).toISOString().slice(0, 10), ts, source: 'sms', smsKey: `s${ts}-qa-${i}-${direction}`,
    captureInstrument: { last4: account.last4, kind: 'account', bankIdentity: account.bankName.toLowerCase() },
    transferEvidence: { version: 1, currency: 'AED', attribution: 'source', sourceBank: account.bankName } };
})).flat();
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
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [language, theme, width, height] of [['en', 'light', 320, 568], ['ar', 'dark', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, locale: language === 'ar' ? 'ar-AE' : 'en-AE',
      timezoneId: 'Asia/Dubai', reducedMotion: 'reduce' });
    await context.addInitScript(({ key, state }) => {
      if (!localStorage.getItem('qa-transfer-batch-seeded')) {
        localStorage.clear(); localStorage.setItem(key, JSON.stringify(state));
        localStorage.setItem('qa-transfer-batch-seeded', '1');
      }
    }, { key: KEY, state: seed(language, theme) });
    const page = await context.newPage(), errors = [], words = wordsFor(language);
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`${BASE}/review-transfers`, { waitUntil: 'networkidle' });
      const screen = page.getByTestId('review-transfers-screen');
      await expect(screen).toBeVisible();
      await screen.getByRole('button', { name: words.selectTransfers, exact: true }).click();
      await expect(screen.getByTestId('transfer-select-shown')).toHaveAttribute('aria-label', words.selectShown(PAIRS));
      const checks = screen.getByTestId('transfer-pair-select');
      await expect(checks.first()).toBeAttached();
      const mounted = await checks.count();
      assert.ok(mounted > 0 && mounted < PAIRS / 2, `virtualized card count ${mounted}/${PAIRS}`);
      await checks.nth(0).click(); await checks.nth(1).click();
      await expect(checks.nth(0)).toBeChecked(); await expect(checks.nth(1)).toBeChecked();
      await page.screenshot({ path: path.join(OUT, `${language}-selection.png`) });
      await screen.getByRole('button', { name: words.reviewSelected(2), exact: true }).click();
      const sheet = page.getByTestId('transfer-review-confirmation');
      await expect(sheet).toBeVisible();
      await expect(sheet.getByTestId('transfer-batch-preview-item')).toHaveCount(2);
      await expect(sheet.getByTestId('transfer-batch-preview-item').first()).toContainText(words.sent);
      await expect(sheet.getByTestId('transfer-batch-preview-item').first()).toContainText(words.received);
      const confirm = sheet.getByRole('button', { name: words.confirmSelected(2), exact: true });
      await expect(confirm).toBeEnabled();
      await page.screenshot({ path: path.join(OUT, `${language}-confirmation.png`) });
      const start = performance.now();
      await confirm.click();
      await expect(sheet).toHaveCount(0);
      await expect.poll(async () => (await stored(page)).filter(tx => tx.transferDecision).length).toBe(4);
      const saveMs = performance.now() - start, saved = await stored(page);
      const confirmed = saved.filter(tx => tx.transferDecision);
      assert.equal(saved.length, transactions.length);
      for (const tx of confirmed) {
        const counterpart = saved.find(other => other.id === tx.transferDecision.counterpartId);
        assert.equal(tx.transferDecision.ownership, 'own');
        assert.equal(counterpart.transferDecision.counterpartId, tx.id);
        assert.equal(counterpart.transferMatch.counterpartId, tx.id);
        assert.equal(tx.amountFils, transactions.find(original => original.id === tx.id).amountFils);
      }
      await page.reload({ waitUntil: 'networkidle' });
      await expect(screen).toBeVisible();
      assert.equal((await stored(page)).filter(tx => tx.transferDecision).length, 4, 'batch survives reopening');
      const clipping = await screen.evaluate(node => [...node.querySelectorAll('*')].filter(n => {
        if (n.children.length || !n.textContent?.trim()) return false;
        const r = n.getBoundingClientRect();
        return r.width > 0 && r.bottom > 0 && r.top < innerHeight && (r.left < -1 || r.right > innerWidth + 1);
      }).map(n => n.textContent));
      assert.deepEqual(clipping, [], 'visible text fits the phone width');
      assert.deepEqual(errors, []);
      results.push({ language, theme, width, height, mounted, pairs: PAIRS, confirmed: 2, saveMs: Math.round(saveMs), pass: true });
    } catch (error) {
      await page.screenshot({ path: path.join(OUT, `${language}-failure.png`) }).catch(() => {});
      results.push({ language, pass: false, error: error.stack, pageErrors: errors });
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
await writeFile(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
assert.ok(results.every(result => result.pass), `Transfer batch failures; screenshots in ${OUT}`);
