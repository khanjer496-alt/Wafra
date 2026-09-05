const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader } = require('./load-ts.cjs');
const load = createLoader();
const { planConfirmedUniversalImport } = load('@/lib/universal-import');
const { ledgerMoneySpec, formatMinorUnits } = load('@/lib/ledger-money');
const { materializeImportBatch, applyMaterializedImportBatch } = load('@/lib/ledger-import');
const { missingUniversalField } = load('@/lib/universal-types');

// Synthetic provider-neutral fixtures verify the ledger boundary, not bank coverage.
const field = (value) => ({ value, evidence: 'explicit', spans: [{ start: 0, end: 1 }], alternatives: [], issues: [] });
const money = (currency = 'USD', minorUnits = '12345', exponent = ledgerMoneySpec(currency).exponent) => ({ currency, minorUnits, exponent });
const event = (over = {}) => ({
  version: 1, decision: 'review', family: 'purchase', status: 'posted', direction: 'debit',
  amount: field(money()), statementTotal: missingUniversalField(), minimumDue: missingUniversalField(),
  balance: missingUniversalField(), creditLimit: missingUniversalField(),
  merchant: field('Sample merchant'), transactionDate: field('2026-09-05'),
  dueDate: missingUniversalField(), statementDate: missingUniversalField(),
  instrument: field({ kind: 'card', last4: '1234' }), observations: [], issues: [], ...over,
});
const state = (over = {}) => ({
  hydrated: true, marketId: 'AE', ledgerMoney: null,
  accounts: [{ id: 'card', name: 'My card', kind: 'card', cardType: 'credit', last4: '1234', openingFils: 0, color: '#111' }],
  transactions: [], budgets: [], bills: [], cardDues: [], goals: [], accountHints: {},
  merchantOverrides: {}, lastScanTs: 10, parserVersion: 0, ...over,
});
const confirmation = (over = {}) => ({
  confirmed: true, postingStatus: 'posted', amount: money(), direction: 'debit',
  accountId: 'card', title: 'Sample merchant', category: 'shopping', date: '2026-09-05',
  sourceKey: `apple_message_review_source_${'a'.repeat(64)}`, observedAt: 1788602400000,
  ...over,
});
let nextId = 0;
const commit = (base, plan) => {
  assert.equal(plan.outcome, 'ready');
  return applyMaterializedImportBatch(base, materializeImportBatch(plan.batch, base, (prefix) => `${prefix}-${nextId++}`));
};

for (const [currency, display] of [['JPY', '12,345'], ['USD', '123.45'], ['KWD', '12.345']]) {
  test(`${currency}: confirmed native minor units survive materialization and reducer without rescaling`, () => {
    const selected = money(currency);
    const source = event({ amount: field(selected) });
    const base = state();
    const untouched = JSON.stringify({ base, source });
    const plan = planConfirmedUniversalImport(base, source, confirmation({ amount: selected }));
    const result = commit(base, plan);
    assert.equal(result.transactions[0].amountFils, 12345);
    assert.equal(result.ledgerMoney.currency, currency);
    assert.equal(formatMinorUnits(result.transactions[0].amountFils, result.ledgerMoney), display);
    assert.equal(result.transactions[0].raw, undefined);
    assert.equal(result.transactions[0].userEdited, true);
    assert.equal(result.transactions[0].captureInstrument.last4, '1234');
    assert.equal(result.transactions[0].captureInstrument.kind, 'unknown');
    assert.equal(result.lastScanTs, base.lastScanTs);
    assert.equal(JSON.stringify({ base, source }), untouched);
    const duplicate = planConfirmedUniversalImport(result, source, confirmation({ amount: selected, sourceKey: `h${'a'.repeat(64)}` }));
    assert.equal(duplicate.outcome, 'duplicate');
  });
}

test('existing Apple review source key and canonical history key identify one message in either direction', () => {
  for (const [stored, incoming] of [
    [`apple_message_review_source_${'a'.repeat(64)}`, `h${'a'.repeat(64)}`],
    [`h${'a'.repeat(64)}`, `apple_message_review_source_${'a'.repeat(64)}`],
  ]) {
    const base = state({ ledgerMoney: ledgerMoneySpec('USD'), transactions: [{ id: 'prior', smsKey: stored }] });
    assert.deepEqual(planConfirmedUniversalImport(base, event(), confirmation({ sourceKey: incoming })),
      { outcome: 'duplicate', transactionId: 'prior' });
  }
});

test('unknown status/direction/name/date require complete explicit confirmation', () => {
  const source = event({ status: 'unknown', direction: 'unknown', merchant: missingUniversalField(), transactionDate: missingUniversalField() });
  assert.equal(planConfirmedUniversalImport(state(), source, confirmation()).outcome, 'ready');
  for (const key of ['confirmed', 'postingStatus', 'direction', 'title', 'date', 'amount', 'accountId']) {
    const input = confirmation(); delete input[key];
    assert.equal(planConfirmedUniversalImport(state(), source, input).outcome, 'refused', key);
  }
});

test('ambiguous money requires selection of an exact source alternative, never a guessed conversion', () => {
  const selected = money('KWD', '12000');
  const source = event({ amount: { value: null, evidence: 'ambiguous', spans: [], alternatives: [money(), selected], issues: [] } });
  assert.equal(planConfirmedUniversalImport(state(), source, confirmation({ amount: selected })).outcome, 'ready');
  assert.equal(planConfirmedUniversalImport(state(), source, confirmation({ amount: money('KWD', '12001') })).outcome, 'refused');
});

test('missing transaction money cannot be promoted from balance or statement observations', () => {
  const source = event({ amount: missingUniversalField(), balance: field(money()), statementTotal: field(money()) });
  assert.equal(planConfirmedUniversalImport(state(), source, confirmation()).outcome, 'refused');
});

for (const [label, source] of [
  ['ignored', event({ decision: 'ignore' })],
  ...['failed', 'future', 'informational'].map((status) => [status, event({ status })]),
  ...['statement', 'balance', 'authentication', 'card-payment'].map((family) => [family, event({ family })]),
]) test(`${label} evidence cannot become a transaction despite confirmation`, () => {
  assert.equal(planConfirmedUniversalImport(state(), source, confirmation()).outcome, 'refused');
});

for (const [label, base, source, input] of [
  ['unhydrated state', state({ hydrated: false }), event(), confirmation()],
  ['cross-currency ledger', state({ ledgerMoney: ledgerMoneySpec('AED') }), event(), confirmation()],
  ['legacy funded AED ledger', state({ accounts: [{ ...state().accounts[0], openingFils: 100 }] }), event(), confirmation()],
  ['incorrect currency exponent', state(), event({ amount: field(money('USD', '12345', 3)) }), confirmation({ amount: money('USD', '12345', 3) })],
  ['unknown currency', state(), event({ amount: field({ currency: 'ZZZ', exponent: 2, minorUnits: '12345' }) }), confirmation({ amount: { currency: 'ZZZ', exponent: 2, minorUnits: '12345' } })],
  ['stored currency metadata drift', state({ ledgerMoney: { schemaVersion: 2, currency: 'KWD', exponent: 2 } }), event({ amount: field(money('KWD')) }), confirmation({ amount: money('KWD') })],
  ['unsafe amount', state(), event({ amount: field(money('USD', '9007199254740992')) }), confirmation({ amount: money('USD', '9007199254740992') })],
  ['zero amount', state(), event({ amount: field(money('USD', '0')) }), confirmation({ amount: money('USD', '0') })],
  ['negative amount', state(), event({ amount: field(money('USD', '-1')) }), confirmation({ amount: money('USD', '-1') })],
  ['missing account', state(), event(), confirmation({ accountId: 'absent' })],
  ['conflicting account tail', state({ accounts: [{ ...state().accounts[0], last4: '9999' }] }), event(), confirmation()],
  ['conflicting instrument kind', state({ accounts: [{ ...state().accounts[0], kind: 'bank' }] }), event(), confirmation()],
  ['malformed source instrument', state({ accounts: [{ ...state().accounts[0], last4: undefined }] }), event({ instrument: field({ kind: 'card', last4: 1234 }) }), confirmation()],
  ['direction contradicts explicit debit', state(), event(), confirmation({ direction: 'credit', category: 'business' })],
  ['category contradicts direction', state(), event(), confirmation({ category: 'salary' })],
  ['unknown category', state(), event(), confirmation({ category: 'made-up' })],
  ['invalid calendar date', state(), event(), confirmation({ date: '2026-02-30' })],
  ['control character in title', state(), event(), confirmation({ title: 'Shop\nAED 10' })],
  ['invalid source identity', state(), event(), confirmation({ sourceKey: 'raw text with spaces' })],
  ['invalid timestamp', state(), event(), confirmation({ observedAt: NaN })],
]) test(`${label} is refused without mutating state`, () => {
  const before = JSON.stringify(base);
  assert.equal(planConfirmedUniversalImport(base, source, input).outcome, 'refused');
  assert.equal(JSON.stringify(base), before);
});

test('ambiguous instruments require explicit grounded selection before account attribution', () => {
  const source = event({ instrument: { value: null, evidence: 'ambiguous', spans: [], alternatives: [
    { kind: 'card', last4: '1234' }, { kind: 'card', last4: '5678' },
  ], issues: [] } });
  assert.equal(planConfirmedUniversalImport(state(), source, confirmation()).outcome, 'refused');
  assert.equal(planConfirmedUniversalImport(state(), source, confirmation({ instrument: { kind: 'card', last4: '1234' } })).outcome, 'ready');
  assert.equal(planConfirmedUniversalImport(state(), source, confirmation({ instrument: { kind: 'card', last4: '9999' } })).outcome, 'refused');
});

test('confirmed own-account movement remains excluded from ordinary spending', () => {
  const result = commit(state(), planConfirmedUniversalImport(state(), event({ family: 'transfer' }), confirmation({ betweenOwnAccounts: true })));
  assert.equal(result.transactions[0].isTransfer, true);
});

test('planning valid USD does not grant authority to commit into a subsequently restored AED ledger', () => {
  const base = state();
  const plan = planConfirmedUniversalImport(base, event(), confirmation());
  assert.equal(plan.outcome, 'ready');
  assert.throws(() => commit({ ...base, ledgerMoney: ledgerMoneySpec('AED') }, plan), /money|currency/i);
});

test('confirmed credit preserves income direction in an existing matching currency ledger', () => {
  const base = state({ ledgerMoney: ledgerMoneySpec('USD') });
  const result = commit(base, planConfirmedUniversalImport(base, event({ direction: 'credit', family: 'transfer' }),
    confirmation({ direction: 'credit', category: 'business' })));
  assert.equal(result.transactions[0].type, 'income');
  assert.equal(result.ledgerMoney.currency, 'USD');
});

test('missing instrument permits explicit account selection without inventing source instrument evidence', () => {
  const result = planConfirmedUniversalImport(state(), event({ instrument: missingUniversalField() }), confirmation());
  assert.equal(result.outcome, 'ready');
  assert.equal(result.batch.transactions[0].accountId, 'card');
  assert.equal(result.batch.transactions[0].captureInstrument, undefined);
});

test('a chosen explicit instrument is copied without linking mutable provider objects into the batch', () => {
  const source = event();
  const plan = planConfirmedUniversalImport(state(), source, confirmation());
  source.instrument.value.last4 = '9999';
  source.amount.value.minorUnits = '1';
  assert.equal(plan.outcome, 'ready');
  assert.equal(plan.batch.transactions[0].captureInstrument.last4, '1234');
  assert.equal(plan.batch.transactions[0].amountFils, 12345);
});

test('Android review provider identity survives reparse and reload without inventing a second source', () => {
  for (const initialKey of ['ha123', 'android_message_review_source_a123']) {
    const first = commit(state(), planConfirmedUniversalImport(state(), event(), confirmation({ sourceKey: initialKey })));
    const restored = JSON.parse(JSON.stringify(first));
    assert.equal(restored.transactions[0].smsKey, `ha123t${confirmation().observedAt}`);
    for (const sourceKey of ['ha123', 'android_message_review_source_a123']) {
      assert.equal(planConfirmedUniversalImport(restored, event(), confirmation({ sourceKey })).outcome, 'duplicate');
    }
    const second = planConfirmedUniversalImport(restored, event(), confirmation({ sourceKey: 'ha124' }));
    const afterSecond = commit(restored, second);
    assert.equal(afterSecond.transactions.length, 2);
    assert.deepEqual(afterSecond.transactions.map((tx) => tx.smsKey).sort(), [`ha123t${confirmation().observedAt}`, `ha124t${confirmation().observedAt}`]);
  }
});

test('existing Android review alias matches its later canonical provider key', () => {
  const base = state({ ledgerMoney: ledgerMoneySpec('USD'), transactions: [{ id: 'prior-android', smsKey: 'android_message_review_source_a123', ts: confirmation().observedAt }] });
  assert.deepEqual(planConfirmedUniversalImport(base, event(), confirmation({ sourceKey: 'ha123' })),
    { outcome: 'duplicate', transactionId: 'prior-android' });
});

for (const sourceKey of ['ha', 'ha123x', 'ha-123', 'android_message_review_source_a', 'android_message_review_source_a123x', 'android_message_review_source_a-123']) {
  test(`malformed Android provider identity is refused: ${sourceKey}`, () => {
    assert.equal(planConfirmedUniversalImport(state(), event(), confirmation({ sourceKey })).outcome, 'refused');
  });
}

// Restored Android row IDs have meaning only together with their original time.
test('a restored Android provider ID at a different original time is a new occurrence', () => {
  const input = confirmation({ sourceKey: 'android_message_review_source_a123' });
  const first = commit(state(), planConfirmedUniversalImport(state(), event(), input));
  const restored = JSON.parse(JSON.stringify(first));
  const original = JSON.stringify(restored.transactions[0]);
  const later = { ...input, observedAt: input.observedAt + 86400000, date: '2026-09-06' };
  const second = planConfirmedUniversalImport(restored, event(), later);
  assert.equal(second.outcome, 'ready');
  const committed = commit(restored, second);
  assert.equal(committed.transactions.length, 2);
  assert.equal(JSON.stringify(committed.transactions.find(tx => tx.id === restored.transactions[0].id)), original);
  assert(committed.transactions.some(tx => tx.smsKey === `ha123t${later.observedAt}`));
  assert.equal(planConfirmedUniversalImport(committed, event(), input).outcome, 'duplicate');
  assert.equal(planConfirmedUniversalImport(committed, event(), later).outcome, 'duplicate');
});

test('an old Android alias without original time cannot prove a duplicate', () => {
  const restored = state({ ledgerMoney: ledgerMoneySpec('USD'), transactions: [
    { id: 'unknown-time', smsKey: 'android_message_review_source_a123' },
  ] });
  assert.equal(planConfirmedUniversalImport(restored, event(), confirmation({ sourceKey: 'ha123' })).outcome, 'ready');
});
