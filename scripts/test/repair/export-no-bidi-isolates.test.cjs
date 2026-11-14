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

test('CSV export amounts are plain decimals with no bidi isolates, with the app language set to Arabic', () => {
  // Real i18n shared with the real categories module, so the app language really is 'ar'.
  const i18n = load(path.join(root, 'src/lib/i18n.ts'));
  i18n.setLanguage('ar');
  assert.equal(i18n.getLanguage(), 'ar');
  const categories = load(path.join(root, 'src/lib/categories.ts'), { '@/lib/i18n': i18n });
  const { buildLedgerCsv } = load(path.join(root, 'src/lib/ledger-export.ts'), { '@/lib/categories': categories });
  const csv = buildLedgerCsv([tx], [account], { currency: 'AED', exponent: 2 }, []);
  assert.ok(csv.includes('123.45,AED'));
  assert.ok(!ISOLATES.test(csv));
  // The helper that adds isolates is language-driven, so this proves the CSV does not use it.
  const { moneyCodeRun } = load(path.join(root, 'src/lib/money-code-run.ts'));
  assert.ok(ISOLATES.test(moneyCodeRun('123.45', 'AED', i18n.getLanguage())));
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

test('Arabic text people read keeps its isolates, but nothing copies or shares a bare amount', () => {
  const { moneyCodeRun } = load(path.join(root, 'src/lib/money-code-run.ts'));
  // Readable text (WhatsApp, Notes, on screen): amount and code stay in order inside isolates.
  assert.equal(moneyCodeRun('123.45', 'AED', 'ar'), '\u2066123.45\u00a0AED\u2069');
  assert.equal(moneyCodeRun('123.45', 'AED', 'en'), 'AED 123.45');
  // A bare amount for a number field or the clipboard must be plain digits. No such path
  // exists today (the CSV test above covers the only plain-decimal amount writer), and the
  // scan below fails if a Clipboard/Share caller starts building money with the isolate helpers.
  // If one is added that formats money with the isolate-producing helpers, this fails and says so.
  const callers = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name);
      if (fs.statSync(file).isDirectory()) walk(file);
      else if (/\.(ts|tsx)$/.test(name)) {
        const source = fs.readFileSync(file, 'utf8');
        if (/Clipboard\.setStringAsync|Share\.share\(|shareAsync\(|copyTextToClipboard\(/.test(source)) callers.push([file, source]);
      }
    }
  };
  walk(path.join(root, 'src'));
  assert.ok(callers.length > 0, 'found the clipboard/share callers');
  for (const [file, source] of callers) {
    assert.ok(!/money-code-run|ui-money-text|from '@\/lib\/format'|formatAED|formatMoney/.test(source),
      `${path.relative(root, file)} copies or shares text and must not build money with isolate-producing helpers`);
  }
});
