'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const ISOLATES = /[⁦-⁩]/;

// Arabic money is wrapped in U+2066..U+2069 by moneyCodeRun for ON-SCREEN and spoken
// text. Anything a user copies, shares or exports must stay plain.
const tx = { id: 't1', type: 'expense', amountFils: 12345, category: 'transport', accountId: 'a1',
  title: 'مطعم الشام', date: '2026-07-10' };
const account = { id: 'a1', name: 'بطاقتي', kind: 'card', openingFils: 0, color: '#000' };

test('CSV export amounts are plain decimals with no bidi isolates, in Arabic ledgers too', () => {
  const { buildLedgerCsv } = load(path.join(root, 'src/lib/ledger-export.ts'));
  const csv = buildLedgerCsv([tx], [account], { currency: 'AED', exponent: 2 }, []);
  assert.ok(csv.includes('123.45,AED'));
  assert.ok(!ISOLATES.test(csv));
});

test('the reimbursement report HTML carries no bidi isolates in English or Arabic', () => {
  // Only the ledger/category lookups are stubbed; formatting and HTML are the real module.
  const { buildExpenseReportHtml } = load(path.join(root, 'src/lib/reimbursement-report.ts'), {
    '@/lib/ledger': {
      internalTransferIds: () => new Set(),
      isSpending: (item) => item.type === 'expense' && !item.isTransfer,
      liveAccountIds: (list) => new Set(list.map((item) => item.id)),
    },
    '@/lib/categories': { categoryLabel: (id) => id },
  });
  for (const language of ['en', 'ar']) {
    const html = buildExpenseReportHtml({
      customCategories: [], transactions: [tx], accounts: [account], currency: 'AED', currencyExponent: 2,
      language, region: 'AE', from: '2026-07-01', to: '2026-07-31',
    });
    assert.ok(html.length > 100 && /123/.test(html), `${language}: report rendered an amount`);
    assert.ok(!ISOLATES.test(html), `${language}: no U+2066-2069`);
  }
});

test('export and report modules do not import the isolate-producing money helpers', () => {
  for (const file of ['src/lib/ledger-export.ts', 'src/lib/reimbursement-report.ts']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(!/money-code-run|ui-money-text|from '@\/lib\/format'/.test(source), `${file} must stay isolate-free`);
  }
});
