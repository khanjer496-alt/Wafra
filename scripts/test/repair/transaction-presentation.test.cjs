'use strict';
// Display-only regression: actual source and actual accounting predicates.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { createHarness, walk, text } = require('./reference-harness.cjs');
const root = path.resolve(__dirname, '../../..');
const ledger = require('../build/ledger.js');
const presentation = load(path.join(root, 'src/lib/transaction-presentation.ts'), {
  '@/lib/ledger': ledger,
  '@/lib/transfer-reconciliation': require('../build/transfer-reconciliation.js'),
});
const { transactionPresentation: display, readableBankDescription: readable, maskLedgerIdentifiers: mask } = presentation;
const byId = (tree, id) => walk(tree).find(node => node.props?.testID === id);
const row = (title, extra = {}) => ({ id: 'statement-row', source: 'sms', captureSource: 'pdf', title,
  type: 'expense', category: 'other', amountFils: 10175, accountId: 'credit', date: '2026-09-03', ...extra });
const repayment = (extra = {}) => row('Card •1111 payment', { type: 'income', isTransfer: true,
  cardPaymentSide: 'receipt', captureInstrument: { kind: 'credit', last4: '1111', bankIdentity: 'hsbc' }, ...extra });

test('statement wording becomes a readable merchant, preserving branch and unknown names', () => {
  for (const [raw, expected] of [
    ['NFC - (G-PAY)- ASTER PHARMACY 177 BR DUBAI AE', 'Aster Pharmacy 177 BR'],
    ['NFC - (G-PAY)- EMARAT 6840 AL MARJAN DUBAI AE', 'Emarat 6840 Al Marjan'],
    ['IAP - (G-PAY)- Qlub*Friends Avenue dubai AE', 'Friends Avenue'],
    ['UrbanClap', 'Urban Company'], ['Urban Company dubai AE', 'Urban Company'],
    ['PAYPAL *ENDURANCEIN', 'Endurancein'], ['iHerb', 'iHerb'], ['eBay', 'eBay'],
    ['AL TARBOUCH AL SOORY R SHARJAH AE', 'Al Tarbouch Al Soory R'],
    ['Dubai Taxi', 'Dubai Taxi'], ['H2O CAFE', 'H2O Cafe'], ['متجر النور', 'متجر النور'],
  ]) assert.equal(display(row(raw)).title, expected, raw);
});

test('presentation leaves stored evidence, identity and every accounting value unchanged', () => {
  const transaction = row('IAP - (G-PAY)- Qlub*Friends Avenue dubai AE', {
    category: 'dining', amountFils: 7758, smsKey: 's1234567890000-7758', statementImportId: 'a'.repeat(32),
  });
  const before = JSON.stringify(transaction);
  const spending = ledger.isSpending(transaction), income = ledger.isIncome(transaction);
  Object.freeze(transaction);
  const view = display(transaction);
  assert.equal(view.recordedDescription, transaction.title);
  assert.equal(JSON.stringify(transaction), before);
  assert.equal(ledger.isSpending(transaction), spending);
  assert.equal(ledger.isIncome(transaction), income);
  assert.equal(view.repayment, false);
});

test('proven and legacy named repayments get neutral exact values, never ordinary income', () => {
  for (const transaction of [repayment(), repayment({ cardPaymentSide: undefined, type: 'expense', title: 'Card payment' }),
    repayment({ title: 'TO 4111 1111 1111 1111' })]) {
    const view = display(transaction);
    assert.equal(view.title, 'Credit-card repayment');
    assert.equal(view.tag, 'Card repayment');
    assert.equal(view.sign, 'none');
    assert.equal(view.note, 'Not spending or income');
    assert.equal(ledger.isSpending(transaction), false);
    assert.equal(ledger.isIncome(transaction), false);
    assert.ok(!JSON.stringify(view).includes('4111 1111'));
  }
});

test('TO card digits alone, credits, cashback, fees and explicit external decisions never invent repayments', () => {
  for (const transaction of [
    row('TO 4111 1111 1111 1111', { type: 'income' }),
    row('CASHBACK', { type: 'income' }), row('Refund', { type: 'income' }),
    row('Amazon.ae', { type: 'income' }), row('Card payment late fee'),
    repayment({ transferDecision: { version: 1, ownership: 'external', decidedAt: 1 } }),
    repayment({ paymentFlowSide: 'receipt' }),
    row('Bank transfer', { isTransfer: true, transferEvidence: { version: 1, currency: 'AED', attribution: 'fallback' } }),
  ]) assert.equal(display(transaction).repayment, false, transaction.title);
  assert.equal(display(row('TO 4111 1111 1111 1111', { type: 'income' })).purposeUnclear, true);
  assert.equal(display(row('Amazon.ae', { type: 'income' })).tag, 'Money received', 'a merchant credit is not automatically called a refund');
  assert.equal(display(row('Refund', { type: 'income' })).tag, 'Refund');
  assert.equal(display(row('CASHBACK', { type: 'income' })).tag, 'Cashback');
});

test('manual and user-corrected names keep their spelling and are not normalised', () => {
  for (const extra of [{ userEdited: true }, { titleEdited: true }, { source: 'manual', captureSource: undefined },
    { source: undefined, captureSource: undefined }]) {
    assert.equal(display(row('IAP - (G-PAY)- My Custom Name', extra)).title, 'IAP - (G-PAY)- My Custom Name');
    assert.equal(display(row('UrbanClap', extra)).title, 'UrbanClap');
  }
});

test('unexplained bank channels are flagged as unclear, not silently converted to transfers', () => {
  const transaction = row('Personal Internet Banking', { type: 'income' });
  assert.equal(display(transaction).title, 'Bank credit');
  assert.equal(display(transaction).note, 'Purpose not confirmed');
  assert.equal(display(transaction).sign, 'plus');
  assert.equal(ledger.isIncome(transaction), true, 'presentation is not a reclassification');
  assert.equal(display(row('Account debit', { category: 'telecom' })).title, 'Bank debit');
});

test('Arabic purpose labels and identifier masking are deterministic', () => {
  assert.equal(display(repayment(), 'ar').title, 'سداد بطاقة ائتمان');
  assert.match(display(repayment(), 'ar').note, /الإنفاق/);
  for (const value of ['TO 4111111111111111', 'TO 4111-1111-1111-1111', 'TO ٤١١١ ١١١١ ١١١١ ١١١١']) {
    assert.ok(!/[\d٠-٩۰-۹]{5}/u.test(mask(value).replace(/ /g, '')));
  }
  assert.equal(mask('AE070331234567890123456'), '••3456');
  assert.equal(mask('03/09/2026 101.75'), '03/09/2026 101.75');
  assert.equal(readable('NFC - (G-PAY)- متجر النور'), 'متجر النور');
});

test('list, accessibility and detail use the same repayment label and retain 101.75 exactly', () => {
  const h = createHarness();
  const transaction = repayment();
  const tree = h.deps['@/components/transaction-row'].TransactionRow({ transaction,
    account: { id: 'credit', name: 'HSBC Credit Card', last4: '1111' }, onPress() {} });
  assert.match(text(tree), /Credit-card repayment/);
  assert.match(text(tree), /101\.75/);
  assert.match(text(tree), /Not spending or income/);
  assert.doesNotMatch(tree.props.accessibilityLabel, /plus|minus/i);
  assert.match(tree.props.accessibilityLabel, /101\.75/);
  assert.match(tree.props.accessibilityLabel, /Credit-card repayment/);
  assert.equal(byId(tree, 'transaction-merchant-link'), undefined);
  const details = h.renderDetail(transaction);
  assert.match(text(byId(details, 'entry-detail-head')), /Credit-card repayment/);
  assert.match(text(byId(details, 'entry-purpose-explainer')), /excluded from spending and income/);
  assert.equal(text(byId(details, 'entry-recorded-description')), 'Card •1111 payment');
});

test('readable merchant navigation still uses the original key, and opening never writes', () => {
  const h = createHarness();
  h.deps['expo-router'].useRouter = () => ({ navigate: route => h.events.push(['navigate', route]) });
  h.local('@/components/transaction-row');
  const transaction = row('IAP - (G-PAY)- Qlub*Friends Avenue dubai AE', { category: 'dining', amountFils: 7758 });
  const tree = h.deps['@/components/transaction-row'].TransactionRow({ transaction, onPress() {} });
  const link = byId(tree, 'transaction-merchant-link');
  assert.match(link.props.accessibilityLabel, /Friends Avenue/);
  assert.doesNotMatch(link.props.accessibilityLabel, /IAP|G-PAY/);
  link.props.onPress();
  assert.equal(h.events.at(-1)[1], `/merchant?name=${encodeURIComponent(transaction.title)}`);
  h.events.length = 0;
  const detail = h.renderDetail(transaction);
  assert.equal(text(byId(detail, 'entry-recorded-description')), transaction.title);
  assert.match(text(byId(detail, 'entry-detail-head')), /Friends Avenue/);
  assert.doesNotMatch(text(byId(detail, 'entry-detail-head')), /IAP|G-PAY/);
  assert.deepEqual(h.events, []);
});

test('search accepts both readable names and recorded descriptions without changing grouping keys', () => {
  const filter = load(path.join(root, 'src/lib/transaction-filter.ts'), {
    '@/lib/categories': require('../build/categories.js'), '@/lib/format': require('../build/format.js'),
    '@/lib/ledger': ledger, '@/lib/splits': require('../build/splits.js'),
    '@/lib/transaction-source': load(path.join(root, 'src/lib/transaction-source.ts')),
    '@/lib/transaction-presentation': presentation,
  });
  const transactions = [row('UrbanClap'), repayment({ id: 'repayment' })];
  const index = filter.createTransactionFilterIndex(transactions, 'en');
  const indexed = index.ordered('newest');
  assert.ok(indexed[0].search.includes('urban company'));
  assert.ok(indexed[0].search.includes('urbanclap'));
  assert.equal(indexed[0].merchantKey, 'urbanclap');
  assert.ok(indexed[1].search.includes('credit-card repayment'));
  assert.equal(indexed[1].merchantKey, 'card •1111 payment');
  assert.equal(indexed[1].row, transactions[1]);
});

test('ledger-confirmed own transfers never gain income labels or unclear-purpose notes', () => {
  const transaction = row('Personal Internet Banking', { type: 'income' });
  const view = display(transaction, 'en', true);
  assert.equal(view.purposeUnclear, false);
  assert.equal(view.tag, null);
  assert.equal(view.repayment, false);
  const h = createHarness();
  const tree = h.deps['@/components/transaction-row'].TransactionRow({ transaction, internal: true, onPress() {} });
  assert.doesNotMatch(text(tree), /Money received|Purpose not confirmed/);
  assert.ok(byId(tree, 'own-transfer-meaning'));
});

test('structural refund/cashback labels translate without renaming a merchant credit', () => {
  assert.equal(display(row('Cashback', { type: 'income' }), 'ar').title, 'استرداد نقدي');
  assert.equal(display(row('Refund', { type: 'income' }), 'ar').title, 'مبلغ مسترد');
  assert.equal(display(row('Amazon.ae', { type: 'income' }), 'ar').title, 'Amazon.ae');
});

test('wrapped and full-width card digits cannot reappear after description formatting', () => {
  assert.equal(mask('TO 4111 1111\n1111 1111'), 'TO ••1111');
  assert.equal(readable('TO ４１１１ １１１１\n１１１１ １１１１'), 'To ••1111');
});

test('statement rows show the bank date, not the relay synthetic clock; alerts retain their time', () => {
  const h = createHarness();
  h.deps['@/lib/format'].clockTime = () => '16:00';
  h.deps['@/lib/format'].fullDateTime = transaction => transaction.date + (transaction.ts ? ', 16:00' : '');
  const statement = row('Urban Company', { ts: Date.parse('2026-09-03T12:00:00Z') });
  const render = transaction => h.deps['@/components/transaction-row'].TransactionRow({ transaction, onPress() {} });
  assert.doesNotMatch(text(render(statement)), /16:00/);
  assert.doesNotMatch(text(h.renderDetail(statement)), /16:00/);
  const alert = { ...statement, captureSource: undefined, viaPush: true };
  assert.match(text(render(alert)), /16:00/);
  assert.match(text(h.renderDetail(alert)), /16:00/);
});


for (const platform of ['android', 'ios']) for (const language of ['en', 'ar']) {
  test(`${platform}/${language}: ordinary movement signs and repayment neutrality agree with speech`, () => {
    const h = createHarness({ platform, language });
    const t = h.deps['@/lib/i18n'].t;
    const render = transaction => h.deps['@/components/transaction-row'].TransactionRow({
      transaction, merchantLinks: false, onPress() {},
    });
    for (const type of ['income', 'expense']) {
      const glyph = type === 'income' ? '+' : '−';
      const spoken = t(type === 'income' ? 'plusWord' : 'minusWord', language);
      const opposite = t(type === 'income' ? 'minusWord' : 'plusWord', language);
      for (const extra of [
        {},
        { title: 'Own account transfer', isTransfer: true,
          transferEvidence: { version: 1, currency: 'AED', attribution: 'source', explicitOwn: true } },
        { title: 'Bank transfer', isTransfer: true,
          transferEvidence: { version: 1, currency: 'AED', attribution: 'fallback' } },
        { title: 'Bank transfer',
          transferDecision: { version: 1, ownership: 'external', decidedAt: 1 } },
      ]) {
        const tx = row('Local Shop', { type, ...extra });
        const view = display(tx, language);
        const tree = render(tx);
        const exact = h.format.formatAmount(tx.amountFils, { decimals: true });
        assert.equal(view.repayment, false);
        assert.equal(view.sign, type === 'income' ? 'plus' : 'minus');
        assert.ok(text(tree).includes(`${glyph} ${exact}`), `${type}: ${tx.title}`);
        assert.ok(tree.props.accessibilityLabel.includes(spoken));
        assert.ok(!tree.props.accessibilityLabel.includes(opposite));
      }
      const tx = repayment({ type });
      const tree = render(tx);
      const exact = h.format.formatAmount(tx.amountFils, { decimals: true });
      assert.equal(display(tx, language).repayment, true);
      assert.ok(text(tree).includes(exact));
      assert.ok(!text(tree).includes(`+ ${exact}`));
      assert.ok(!text(tree).includes(`− ${exact}`));
      assert.ok(!tree.props.accessibilityLabel.includes(t('plusWord', language)));
      assert.ok(!tree.props.accessibilityLabel.includes(t('minusWord', language)));
    }
  });
}

// Per-index caching may reuse formatting, never a transaction's meaning.
test('search presentation cache is build-local and respects every row-specific classification', () => {
  let calls = 0;
  const filter = load(path.join(root, 'src/lib/transaction-filter.ts'), {
    '@/lib/categories': require('../build/categories.js'), '@/lib/format': require('../build/format.js'),
    '@/lib/ledger': ledger, '@/lib/splits': require('../build/splits.js'),
    '@/lib/transaction-source': load(path.join(root, 'src/lib/transaction-source.ts')),
    '@/lib/transaction-presentation': {
      transactionPresentation(...args) { calls++; return display(...args); },
    },
  });
  const repeated = Array.from({ length: 1000 }, (_, i) => Object.freeze(row('NFC - (G-PAY)- SHOP 123 DUBAI AE', {
    id: `format-${i}`, category: ['shopping', 'dining', 'groceries', 'transport', 'other'][i % 5], amountFils: i + 1,
  })));
  const first = filter.createTransactionFilterIndex(repeated, 'en');
  assert.equal(calls, 1, 'identical merchant formatting is computed once even across ordinary expense categories');
  assert.equal(first.ordered('newest').length, repeated.length);
  const categories = require('../build/categories.js');
  for (const indexed of first.ordered('newest')) {
    assert.ok(indexed.search.includes(categories.getCategory(indexed.row.category).label.toLowerCase()),
      'each row retains its own searchable category');
  }
  const cases = [
    {}, { type: 'income' }, { userEdited: true }, { titleEdited: true },
    { source: 'manual', captureSource: undefined },
    { isTransfer: true, cardPaymentSide: 'receipt', type: 'income' },
    { isTransfer: true, paymentFlowSide: 'receipt' },
    { type: 'income', category: 'salary' }, { type: 'income', category: 'business' },
    { type: 'income', transferEvidence: { version: 1, currency: 'AED', attribution: 'source', explicitOwn: true } },
    { type: 'income', transferEvidence: { version: 1, currency: 'AED', attribution: 'source', explicitExternal: true } },
    { type: 'income', transferDecision: { version: 1, ownership: 'own', decidedAt: 1 } },
    { type: 'income', transferDecision: { version: 1, ownership: 'external', decidedAt: 1 } },
  ].map((extra, i) => Object.freeze(row('Personal Internet Banking', { id: `meaning-${i}`, ...extra })));
  for (const language of ['en', 'ar']) {
    const index = filter.createTransactionFilterIndex([...cases, ...cases], language);
    for (const indexed of index.ordered('newest')) {
      const expected = display(indexed.row, language);
      const segment = [expected.title, expected.tag].filter(Boolean).join(' ').toLowerCase();
      assert.ok(indexed.search.includes(`\u0000${segment}\u0000`), `${language}/${indexed.row.id}`);
      assert.equal(indexed.merchantKey, indexed.row.title.toLowerCase());
    }
  }
  const before = calls;
  filter.createTransactionFilterIndex(repeated, 'en');
  assert.equal(calls, before + 1, 'no personal strings are reused across independent index builds');
});
