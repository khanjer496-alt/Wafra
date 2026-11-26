'use strict';
// Build 195 (iPhone 16 Pro, en-US, USD): the Accounts rows and Spending's
// "With limits" rows drew "$" on one line and "24,681" under it. Money's
// currency and digits sat in a content-sized row with flexWrap: 'wrap', and
// Yoga broke that row even though the pair fit. On iOS and Android the pair is
// now one line that never wraps; a pair too wide for its box shrinks its digits
// (never below MIN_FIGURE_SCALE) instead of moving either part. Only a
// fixed-width tile opts in to wrapping the currency (`wrapCurrency`).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createHarness, text } = require('./reference-harness.cjs');

const root = path.resolve(__dirname, '../../..');
const flat = (style) => Object.assign({}, ...[style].flat(Infinity).filter((s) => s && typeof s === 'object'));
const MIN_FIGURE_SCALE = 0.6;

function renderMoney({ language, platform, largeText, fils, decimals, wrapCurrency }) {
  const h = createHarness({ language, platform, largeText });
  const ledgerMoney = h.deps['@/lib/ledger-money'];
  ledgerMoney.setDisplayMoneyLocale({ locale: 'en-US', decimalSeparator: '.', groupSeparator: ',', region: 'US' });
  try {
    const { Money } = h.local('@/components/ui/money');
    return Money({ fils, moneySpec: ledgerMoney.ledgerMoneySpec('USD'), type: 'smallBold', decimals, wrapCurrency });
  } finally {
    ledgerMoney.setDisplayMoneyLocale(null);
  }
}

const AMOUNTS = [
  { fils: 85386, decimals: undefined, figure: /^853\.86$/ },        // Cash row
  { fils: 2468100, decimals: false, figure: /^24,681$/ },           // Everyday Checking row
  { fils: 13003, decimals: undefined, figure: /^130\.03$/ },        // Transport limit row
  { fils: 123456789, decimals: undefined, figure: /^1,234,567\.89$/ }, // seven digits
];

for (const platform of ['ios', 'android']) for (const language of ['en', 'ar']) for (const largeText of [false, true]) {
  test(`Money keeps the currency and the digits on one line: ${platform}/${language}${largeText ? '/Larger Text' : ''}`, () => {
    for (const { fils, decimals, figure } of AMOUNTS) {
      const node = renderMoney({ language, platform, largeText, fils, decimals });
      const row = flat(node.props.style);
      assert.equal(row.flexDirection, 'row');
      assert.equal(row.flexWrap, 'nowrap', 'a wrapping row put "$" above "24,681" on iPhone');
      assert.equal(row.direction, 'ltr');
      assert.equal(row.maxWidth, '100%', 'the pair is bounded by its column so the digits can fit it');

      const [first, second] = [...node.props.children].filter(Boolean);
      // Arabic keeps one number-then-code run; en-US puts the symbol first.
      const [currency, digits] = language === 'ar' ? [second, first] : [first, second];
      assert.equal(currency.props.accessibilityLabel, 'USD');
      assert.equal(text(currency), language === 'ar' ? 'USD' : '$');
      assert.equal(flat(currency.props.style).flexShrink, 0, 'the currency never shrinks or clips');

      const amount = String(text(digits));
      assert.match(amount.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/٬/g, ',').replace(/٫/g, '.'), figure,
        'the whole amount is drawn: nothing truncated or abbreviated');
      assert.equal(digits.props.numberOfLines, 1, 'digits are never split across lines');
      assert.equal(digits.props.adjustsFontSizeToFit, true, 'a pair too wide for its box shrinks its digits');
      assert.equal(digits.props.minimumFontScale, MIN_FIGURE_SCALE);
      const figureStyle = flat(digits.props.style);
      assert.equal(figureStyle.flexShrink, 1, 'the digits give way to the currency beside them');
      assert.equal(figureStyle.minWidth, 0);
      assert.ok(node.props.accessibilityLabel.includes(amount), 'the full amount is spoken');
    }
  });
}

for (const platform of ['ios', 'android']) {
  test(`a fixed-width tile that opts in wraps the currency, not the digits: ${platform}`, () => {
    // Transfers' three tiles: at 1.3x "AED 123,456.78" needs the tile's whole
    // width for its digits, so the code may take its own line there.
    const node = renderMoney({ language: 'en', platform, largeText: false, fils: 12345678, wrapCurrency: true });
    assert.equal(flat(node.props.style).flexWrap, 'wrap');
    const digits = [...node.props.children].filter(Boolean)[1];
    assert.equal(flat(digits.props.style).flexShrink, 0);
    assert.equal(flat(digits.props.style).maxWidth, '100%');
    assert.equal(digits.props.numberOfLines, 1);
    assert.equal(digits.props.adjustsFontSizeToFit, true);
  });
}

test('the web keeps its CSS wrap and unshrunk figure (no native fit there)', () => {
  const node = renderMoney({ language: 'en', platform: 'web', largeText: false, fils: 85386 });
  assert.equal(flat(node.props.style).flexWrap, 'wrap');
  const digits = [...node.props.children].filter(Boolean)[1];
  assert.equal(flat(digits.props.style).flexShrink, 0);
  assert.equal(flat(digits.props.style).whiteSpace, 'nowrap');
});

test('the Accounts rows and the category-limit rows draw their figure with the shared Money', () => {
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  assert.match(read('src/components/wallet/account-groups.tsx'), /<Money fils=\{item\.figureFils\} type="smallBold"/);
  assert.match(read('src/components/spending/spending-overview.tsx'), /<Money fils=\{row\.spentFils\} type="smallBold" \/>/);
  // Only the fixed-width Transfers tiles opt in to a wrapping currency.
  const optIns = [];
  const collect = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(rel);
      else if (/\.tsx$/.test(entry.name) && /<Money\b[^>]*\bwrapCurrency\b/.test(read(rel))) optIns.push(rel);
    }
  };
  collect('src');
  assert.deepEqual(optIns, [path.join('src', 'app', 'transfers.tsx')]);
});
