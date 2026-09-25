'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const copy = load(path.join(root, 'src/lib/motion-android-copy.ts'), { '@/lib/i18n': { getLanguage: () => 'en' } });
const ledgerMoney = load(path.join(root, 'src/lib/ledger-money.ts'), {
  '@/lib/currency-metadata': require('../build/currency-metadata.js'),
});
const labels = { dining: ['Dining', 'مطاعم'], groceries: ['Groceries', 'بقالة'], salary: ['Salary', 'راتب'] };
const { captureToastContent } = load(path.join(root, 'src/lib/capture-toast.ts'), {
  '@/lib/categories': { categoryLabel: (id, lang) => labels[id][lang === 'ar' ? 1 : 0] },
  '@/lib/ledger-money': ledgerMoney,
  '@/lib/motion-android-copy': copy,
});
const USD = { schemaVersion: 2, currency: 'USD', exponent: 2 };
const KWD = { schemaVersion: 2, currency: 'KWD', exponent: 3 };
const row = (patch = {}) => ({ title: 'Starbucks', category: 'dining', amountFils: 675, type: 'expense', ...patch });

test('a known capture names merchant, category and exact amount', () => {
  const content = captureToastContent(row(), USD, 'en');
  assert.equal(content.message, 'Starbucks added · Dining');
  assert.match(content.amount, /6\.75/);
  assert.equal(content.spoken, 'Starbucks added to Dining, USD 6.75');
});

test('amounts use the ledger exponent exactly', () => {
  const content = captureToastContent(row({ amountFils: 12345 }), KWD, 'en');
  assert.match(content.spoken, /KWD 12\.345$/);
});

test('income is marked as money in, never as spending', () => {
  const content = captureToastContent(row({ title: 'ACME Payroll', category: 'salary', amountFils: 500000, type: 'income' }), USD, 'en');
  assert.match(content.amount, /^\u2066\+.*\u2069$/, 'signed and isolated left-to-right for RTL toasts');
  assert.match(content.spoken, /\+USD 5,000/);
});

test('Arabic uses the Arabic table and category name', () => {
  const content = captureToastContent(row(), USD, 'ar');
  assert.match(content.message, /مطاعم/);
  assert.match(content.message, /Starbucks/);
});

test('anything not fully known falls back to the generic line (null)', () => {
  assert.equal(captureToastContent(null, USD, 'en'), null);
  assert.equal(captureToastContent(undefined, USD, 'en'), null);
  assert.equal(captureToastContent(row(), null, 'en'), null, 'no ledger currency');
  assert.equal(captureToastContent(row({ title: '   ' }), USD, 'en'), null, 'no merchant');
  assert.equal(captureToastContent(row({ amountFils: 0 }), USD, 'en'), null);
  assert.equal(captureToastContent(row({ amountFils: 1.5 }), USD, 'en'), null, 'never a fractional minor unit');
});

test('the live capture path uses the light haptic, names only one known row, and arrives from the top', () => {
  const hook = fs.readFileSync(path.join(root, 'src/hooks/use-auto-import.ts'), 'utf8');
  const body = hook.slice(hook.indexOf('const showLiveCaptureFeedback'), hook.indexOf('const performAutoImport'));
  assert.match(body, /captured\(\);/);
  assert.doesNotMatch(body, /committed\(\)/, 'a capture the user did not make is not a commitment');
  assert.match(body, /count === 1 && transactionIds\.length === 1/);
  assert.match(body, /placement: 'top'/);
  assert.match(body, /t\('liveTransactionAdded'\)/, 'generic copy remains the fallback');
  assert.match(body, /announcement: content\.spoken/);
});

test('the toast stays backward compatible and announces the full sentence', () => {
  const toast = fs.readFileSync(path.join(root, 'src/components/ui/toast.tsx'), 'utf8');
  assert.match(toast, /const placement = options\.placement \?\? 'bottom'/, 'existing callers keep the bottom toast');
  assert.match(toast, /announceForAccessibility\(announcement \?\? message\)/);
  assert.match(toast, /if \(reducedMotion\) return FadeIn\.duration\(Motion\.change\)\.reduceMotion\(ReduceMotion\.Never\)/,
    'Reduce Motion cross-fades rather than slides');
  assert.match(toast, /placement === 'top'\s*\? FadeInUp/);
});
