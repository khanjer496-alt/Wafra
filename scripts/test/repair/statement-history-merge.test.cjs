'use strict';
// A movement imported first from a bank STATEMENT and then again from SMS
// History (a senderless Find-Messages record, so no bank identity) is one
// movement. Device ledger facts, reproduced synthetically: a FAB account
// statement row "Outgoing transfer" of AED 280.00, and the History alert
// "Outward remittance" one second later on the same account tail, stating the
// running balance the statement shows after that row. The reverse order was
// already merged; this order produced a duplicate. Two genuinely separate
// equal transfers on the same day must stay two.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTypescript = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const source = (name) => path.join(root, 'src/lib', `${name}.ts`);
function load(name, overrides = {}) {
  const dependencies = {};
  for (const [, dependency] of fs.readFileSync(source(name), 'utf8').matchAll(/from ['"](@\/lib\/[^'"]+)['"]/g)) {
    const built = path.join(__dirname, '../build', `${dependency.slice('@/lib/'.length)}.js`);
    if (fs.existsSync(built)) dependencies[dependency] = require(built);
  }
  return loadTypescript(source(name), { ...dependencies, ...overrides });
}
const dedupe = load('dedupe');
const { buildImportPlan } = load('import-plan', { '@/lib/dedupe': dedupe });
const heal = load('heal', { '@/lib/dedupe': dedupe });
const { materializeImportBatch, applyMaterializedImportBatch } =
  load('ledger-import', { '@/lib/dedupe': dedupe, '@/lib/heal': heal });
require(path.join(__dirname, '../build/markets.js')).setActiveMarket('AE');
require(path.join(__dirname, '../build/markets.js')).setLedgerCurrency('AED', 2);

const now = new Date('2026-09-30T12:00:00Z');
const STATEMENT_TS = 1788861835875;
const HISTORY_TS = 1788861836780;
const base = () => ({ hydrated: true, privateMode: true, marketId: 'AE',
  ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
  accounts: [], transactions: [], budgets: [], bills: [], goals: [], cardDues: [],
  accountHints: {}, merchantOverrides: {}, billAliases: {}, lastScanTs: 0, parserVersion: 0 });
const statementRow = (changes = {}) => ({ kind: 'transaction', type: 'expense', amountFils: 28000, currency: 'AED',
  merchant: 'Outgoing transfer', date: '2026-09-08', dueDay: null, minDueFils: null,
  card: { last4: '0002', kind: 'account' }, reference: null, transferHint: true,
  snapshotFils: null, snapshotKind: null, categoryGuess: 'other', categoryDeliberate: true,
  captureSource: 'pdf', smsTs: STATEMENT_TS, statementImportId: 'f'.repeat(32), statementRowIndex: 32,
  bankHint: 'FAB', ...changes });
const historyRow = (changes = {}) => ({ kind: 'transaction', type: 'expense', amountFils: 28000, currency: 'AED',
  merchant: 'Outward remittance', date: '2026-09-08', dueDay: null, minDueFils: null,
  card: { last4: '0002', kind: 'account' }, reference: null, transferHint: true,
  snapshotFils: 248448, snapshotKind: 'balance', categoryGuess: 'other', categoryDeliberate: true,
  smsTs: HISTORY_TS, channel: 'inbox', sourceEventId: 'a'.repeat(64), ...changes });
let serial = 0;
function apply(rows, state = base()) {
  const plan = buildImportPlan(rows, state, 0, now);
  return applyMaterializedImportBatch(state, materializeImportBatch(plan.batch, state, (p) => `${p}-${++serial}`));
}
const decision = { version: 1, ownership: 'external', decidedAt: Date.parse('2026-09-09T08:00:00Z') };
const withDecision = (state) => ({ ...state, transactions: state.transactions.map((t) =>
  t.captureSource === 'pdf' ? { ...t, transferDecision: decision } : t) });

for (const decided of [false, true]) {
  test(`statement first, then SMS History: one movement${decided ? ' (user already decided the transfer)' : ''}`, () => {
    let state = apply([statementRow()]);
    assert.equal(state.transactions.length, 1);
    if (decided) state = withDecision(state);
    state = apply([historyRow()], state);
    const rows = state.transactions.filter((t) => t.amountFils === 28000);
    assert.equal(rows.length, 1, JSON.stringify(rows.map((t) => [t.title, t.captureSource, t.smsKey])));
    if (decided) assert.deepEqual(rows[0].transferDecision, decision, "the user's answer survives");
  });
}

// The same pair with the History row produced by the REAL senderless History
// path from a FAB field-list alert (values replaced), and the statement row
// carrying the transfer evidence a statement import stores.
const { parseHistoricalMessageRecords } = require(path.join(__dirname, '../build/historical-import.js'));
const { createLaunchAlertSession } = require(path.join(__dirname, '../build/launch-alert-parser.js'));
const OUTWARD = 'Outward Remittance Debit\nAccount XXXX0002\nAED 280.00\nValue Date 08/09/2026\nAvailable Balance AED 2,484.48';
function realHistoryRow() {
  const result = parseHistoricalMessageRecords([JSON.stringify({ v: 1, id: 'c'.repeat(64), text: OUTWARD,
    receivedAt: new Date(HISTORY_TS).toISOString() })], {}, now, new Set(),
    createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'AED', activeMarket: 'AE' }));
  assert.equal(result.parsed.length, 1, 'premise: the senderless alert parses');
  return result.parsed[0];
}
const statementEvidence = { version: 1, currency: 'AED', attribution: 'source', sourceKindAmbiguous: true,
  counterparty: { last4: '9623', kind: 'account' }, statement: true };
for (const decided of [false, true]) {
  for (const evidence of [false, true]) {
    test(`statement then real senderless History alert: one movement (decision ${decided}, statement evidence ${evidence})`, () => {
      let state = apply([statementRow(evidence ? { transferEvidence: statementEvidence } : {})]);
      if (decided) state = withDecision(state);
      const history = realHistoryRow();
      state = apply([history], state);
      const rows = state.transactions.filter((t) => t.amountFils === 28000);
      assert.equal(rows.length, 1, JSON.stringify({ history: { title: history.merchant, card: history.card, bank: history.bankHint,
        snap: history.snapshotFils, ev: history.transferEvidence }, rows: rows.map((t) => [t.title, t.captureSource, t.accountId]) }));
      if (decided) assert.deepEqual(rows[0].transferDecision, decision);
    });
  }
}

test('SMS History first, then the statement: one movement (already worked)', () => {
  let state = apply([historyRow()]);
  state = apply([statementRow()], state);
  assert.equal(state.transactions.filter((t) => t.amountFils === 28000).length, 1);
});

test('two separate equal transfers the same day stay two: a different stated balance trail', () => {
  let state = apply([statementRow(), statementRow({ statementRowIndex: 33, smsTs: STATEMENT_TS + 1 })]);
  assert.equal(state.transactions.length, 2);
  // One History alert pairs with one statement row; the other stays.
  state = apply([historyRow()], state);
  assert.equal(state.transactions.filter((t) => t.amountFils === 28000).length, 2);
  // A second History alert, a later balance, takes the remaining row.
  state = apply([historyRow({ snapshotFils: 220448, smsTs: HISTORY_TS + 3_600_000, sourceEventId: 'b'.repeat(64) })], state);
  assert.equal(state.transactions.filter((t) => t.amountFils === 28000).length, 2);
});

test('a History transfer from a different account tail stays separate', () => {
  let state = apply([statementRow()]);
  state = apply([historyRow({ card: { last4: '0007', kind: 'account' } })], state);
  assert.equal(state.transactions.filter((t) => t.amountFils === 28000).length, 2);
});

test('a History transfer in the opposite direction stays separate', () => {
  let state = apply([statementRow()]);
  state = apply([historyRow({ type: 'income', merchant: 'Inward remittance' })], state);
  assert.equal(state.transactions.filter((t) => t.amountFils === 28000).length, 2);
});

// Earlier iPhone History builds minted bankless accounts for senderless
// alerts ("Account •0002"), so a ledger can hold the statement's FAB account
// beside a bankless account, or a FAB debit card, with the same tail.
for (const [name, extra] of [
  ['a bankless account with the same tail', [{ id: 'bankless', name: 'Account •0002', kind: 'bank', last4: '0002', openingFils: 0, color: '#000' }]],
  ['a same-bank debit card with the same tail', [{ id: 'card2', name: 'FAB Card', bankName: 'FAB', kind: 'card', cardType: 'debit', last4: '0002', openingFils: 0, color: '#000' }]],
]) {
  test(`statement then real senderless History alert beside ${name}: one movement`, () => {
    let state = apply([statementRow({ transferEvidence: statementEvidence })]);
    state = withDecision({ ...state, accounts: [...state.accounts, ...extra] });
    state = apply([realHistoryRow()], state);
    const rows = state.transactions.filter((t) => t.amountFils === 28000);
    assert.equal(rows.length, 1, JSON.stringify(rows.map((t) => [t.title, t.captureSource ?? '-', t.accountId])));
    assert.deepEqual(rows[0].transferDecision, decision);
  });
}

test('beside a bankless same-tail account, two equal statement rows never both claim one alert', () => {
  const bankless = { id: 'bankless', name: 'Account •0002', kind: 'bank', last4: '0002', openingFils: 0, color: '#000' };
  let state = apply([statementRow(), statementRow({ statementRowIndex: 33, smsTs: STATEMENT_TS + 1 })]);
  state = { ...state, accounts: [...state.accounts, bankless] };
  state = apply([realHistoryRow()], state);
  // Two candidate statement rows: ambiguous, so the alert is kept, not merged.
  assert.equal(state.transactions.filter((t) => t.amountFils === 28000).length, 3);
});

test('beside a bankless same-tail account, a next-day equal transfer is a separate movement', () => {
  const bankless = { id: 'bankless', name: 'Account •0002', kind: 'bank', last4: '0002', openingFils: 0, color: '#000' };
  let state = apply([statementRow({ transferEvidence: statementEvidence })]);
  state = { ...state, accounts: [...state.accounts, bankless] };
  const nextDay = realHistoryRow();
  state = apply([{ ...nextDay, date: '2026-09-09', smsTs: HISTORY_TS + 86_400_000, sourceEventId: 'd'.repeat(64) }], state);
  assert.equal(state.transactions.filter((t) => t.amountFils === 28000).length, 2);
});

// Real-device order: the live capture of the transfer, then the FAB statement
// (whose transfer evidence re-titles the live row "Outgoing transfer"), then
// the senderless History copy of the SAME Message ("Outward remittance", the
// same running balance, 0.9 s later). One movement, not two.
const LIVE_TS = STATEMENT_TS;
const liveRow = () => {
  const { sourceEventId: _id, ...rest } = realHistoryRow();
  return { ...rest, smsTs: LIVE_TS, messageObservationId: '12345678-1234-4123-8123-123456789abc' };
};
const deviceEvidence = { version: 1, currency: 'AED', attribution: 'source', sourceKindAmbiguous: true,
  counterparty: { last4: '9623', kind: 'unknown' }, statement: true };
test('live capture, then the statement, then the senderless History copy: one movement', () => {
  let state = apply([liveRow()]);
  state = apply([statementRow({ statementRowIndex: 40, transferEvidence: deviceEvidence })], state);
  assert.equal(state.transactions.filter((t) => t.amountFils === 28000).length, 1, 'premise: the statement claims the live row');
  state = apply([realHistoryRow()], state);
  const rows = state.transactions.filter((t) => t.amountFils === 28000);
  assert.equal(rows.length, 1, JSON.stringify(rows.map((t) => [t.title, t.smsKey?.slice(0, 2), t.statedBalanceFils])));
});
test('the device pair in the other order (History, then statement) is one movement too', () => {
  let state = apply([realHistoryRow()]);
  state = apply([statementRow({ statementRowIndex: 40, transferEvidence: deviceEvidence })], state);
  assert.equal(state.transactions.filter((t) => t.amountFils === 28000).length, 1);
});
test('a statement row and an alert with different transfer titles pair on the same running balance', () => {
  // The statement's closing row carries its running balance (server: closing snapshot).
  let state = apply([statementRow({ statementRowIndex: 40, merchant: 'Transfer-MOB-LOCAL FT', snapshotFils: 248448, snapshotKind: 'balance' })]);
  state = apply([historyRow({ merchant: 'Funds sent' })], state);
  assert.equal(state.transactions.filter((t) => t.amountFils === 28000).length, 1);
});
test('a different running balance keeps a renamed-title pair apart', () => {
  let state = apply([statementRow({ statementRowIndex: 40, merchant: 'Transfer-MOB-LOCAL FT', snapshotFils: 248448, snapshotKind: 'balance' })]);
  state = apply([historyRow({ merchant: 'Funds sent', snapshotFils: 199000 })], state);
  assert.equal(state.transactions.filter((t) => t.amountFils === 28000).length, 2);
});
test('two equal same-day live transfers with different balances stay two after the statement and History', () => {
  let state = apply([liveRow(), { ...liveRow(), smsTs: LIVE_TS + 3_600_000, snapshotFils: 220448,
    messageObservationId: '22345678-1234-4123-8123-123456789abc' }]);
  assert.equal(state.transactions.filter((t) => t.amountFils === 28000).length, 2);
  state = apply([statementRow({ statementRowIndex: 40, transferEvidence: deviceEvidence })], state);
  state = apply([realHistoryRow()], state);
  assert.equal(state.transactions.filter((t) => t.amountFils === 28000).length, 2);
});

// FAB texts one transfer twice (fictional values in the bank's wording): the
// request confirmation says "from your account/card XXXX0007" and has no
// balance; the debit alert names "Account XXXX0007" and its balance, a second
// later. The statement prints one row. On the device, a senderless History
// import after the statement healed the statement row with the confirmation
// AND added the debit as a second movement.
const CONFIRM = (amount, to) => `Dear Customer, your funds transfer request of  AED ${amount} to IBAN/Account/Card XXXX${to}  has been processed successfully from your account/card XXXX0007 on 08/09/2026`;
const DEBIT = (amount, balance) => `Outward Remittance \nDebit \nAccount XXXX0007 \nAED ${amount}\nDate 08/09/2026  \nBalance AED ${balance}`;
const T0 = Date.parse('2026-09-08T10:03:55.875Z');
const hist = (items, changes = {}) => parseHistoricalMessageRecords(items.map(([id, text, ts]) =>
  JSON.stringify({ v: 1, id: id.repeat(64), text, receivedAt: new Date(ts).toISOString() })),
{}, now, new Set(), createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'AED', activeMarket: 'AE' }))
  .parsed.map((row) => ({ ...row, ...changes }));
const historyPair = (ids, confirmTs, debitTs, amount = '150.00', balance = '1000.00', to = '1111', changes = {}) => {
  const rows = hist([[ids[0], CONFIRM(amount, to), confirmTs], [ids[1], DEBIT(amount, balance), debitTs]], changes);
  assert.equal(rows.length, 2, 'premise: both alerts parse');
  assert.equal(rows[0].transferEvidence?.sourceKindAmbiguous, true, 'premise: the confirmation is the ambiguous form');
  return rows;
};
const stmt0007 = (changes = {}) => statementRow({ amountFils: 15000, card: { last4: '0007', kind: 'account' }, statementRowIndex: 12,
  smsTs: Date.parse('2026-09-08T11:57:59.000Z'), snapshotFils: 100000, snapshotKind: 'balance', ...changes });
const rows0007 = (state) => state.transactions.filter((t) => t.amountFils === 15000);
const show = (state) => JSON.stringify(rows0007(state).map((t) => [t.title, t.captureSource ?? 'sms',
  state.accounts.find((a) => a.id === t.accountId)?.name ?? t.accountId]));
const fabAccount = { id: 'fab-0007', name: 'FAB Account •0007', kind: 'bank', last4: '0007', bankName: 'FAB', color: '#000', openingFils: 0 };
const withFabAccount = () => ({ ...base(), accounts: [fabAccount] });
test('device case: statement first, then the senderless History pair, is one movement', () => {
  let state = apply([stmt0007()]);
  state = apply(historyPair(['3', '4'], T0, T0 + 905), state);
  assert.equal(rows0007(state).length, 1, show(state));
  assert.equal(rows0007(state)[0].absorbedSmsKeys?.length, 1, 'the dropped alert\'s identity stays on the row');
  const title = rows0007(state)[0].title;
  state = apply(historyPair(['3', '4'], T0, T0 + 905), state);
  assert.equal(rows0007(state).length, 1, `re-read: ${show(state)}`);
  assert.equal(rows0007(state)[0].title, title, 'a re-read never retitles it');
});
test('device case keeps the confirmation\'s own heal: the absorbed identity never replaces it', () => {
  let state = apply([stmt0007()]);
  const pair = historyPair(['3', '4'], T0, T0 + 905);
  const confirmationOnly = apply([pair[0]], state);
  state = apply(pair, state);
  const [row] = rows0007(state);
  const [control] = rows0007(confirmationOnly);
  assert.equal(row.smsKey, control.smsKey, 'the confirmation\'s identity reached the statement row');
  assert.equal(row.ts, control.ts);
  assert.equal(row.absorbedSmsKeys?.length, 1);
});
test('an absorbed-only patch merges with a full heal, even with the undefined fields materialize adds', () => {
  const tx = { id: 'x', type: 'expense', amountFils: 1, category: 'other', accountId: 'a', title: 'T', date: '2026-01-01', source: 'sms' };
  const key = `h${'a'.repeat(64)}`;
  for (const patches of [
    [{ id: 'x', title: 'Healed' }, { id: 'x', absorbedSmsKeys: [key] }],
    [{ id: 'x', title: 'Healed', accountId: undefined }, { id: 'x', absorbedSmsKeys: [key], accountId: undefined }],
  ]) {
    const [healed] = heal.applyHealUpdates([tx], patches);
    assert.equal(healed.title, 'Healed');
    assert.equal(healed.absorbedSmsKeys?.length, 1);
  }
  const [moved] = heal.applyHealUpdates([tx], [{ id: 'x', accountId: 'b' }, { id: 'x', absorbedSmsKeys: [key], accountId: undefined }]);
  assert.equal(moved.accountId, 'b', 'the earlier patch\'s account move survives');
  assert.equal(moved.absorbedSmsKeys?.length, 1);
});
test('reverse order: the History pair on the existing account, then the statement, is one movement', () => {
  let state = apply(historyPair(['5', '6'], T0, T0 + 905), withFabAccount());
  assert.equal(rows0007(state).length, 1, show(state));
  assert.equal(rows0007(state)[0].accountId, 'fab-0007');
  state = apply([stmt0007()], state);
  assert.equal(rows0007(state).length, 1, show(state));
});
for (const [name, order] of [['confirmation first', [0, 1]], ['debit alert first', [1, 0]]]) {
  test(`the pair imported one alert at a time (${name}) is one row on the existing account`, () => {
    const pair = historyPair(['b', 'c'], T0, T0 + 905);
    let state = apply([pair[order[0]]], withFabAccount());
    const title = rows0007(state)[0].title;
    state = apply([pair[order[1]]], state);
    assert.equal(rows0007(state).length, 1, show(state));
    assert.equal(rows0007(state)[0].title, title, 'the second alert never retitles the first');
    assert.equal(state.accounts.find((a) => a.id === 'fab-0007').snapshotFils, 100000, 'the debit\'s balance still lands');
  });
}
test('statement, then the confirmation, then the debit alert, each its own import: one movement', () => {
  const pair = historyPair(['8', '9'], T0, T0 + 905);
  let state = apply([stmt0007()]);
  state = apply([pair[0]], state);
  state = apply([pair[1]], state);
  assert.equal(rows0007(state).length, 1, show(state));
});
test('two genuine equal transfers, each texted twice, stay two', () => {
  const first = historyPair(['7', '8'], T0, T0 + 905, '150.00', '1000.00', '1111');
  const second = historyPair(['9', 'a'], T0 + 60_000, T0 + 60_900, '150.00', '850.00', '2222');
  assert.equal(rows0007(apply([...first, ...second], withFabAccount())).length, 2);
});
test('a confirmation naming another counterparty never pairs', () => {
  const pair = historyPair(['d', 'e'], T0, T0 + 905);
  const other = hist([['f', CONFIRM('150.00', '3333'), T0 + 1500]]);
  const debit = { ...pair[1], transferEvidence: { ...pair[1].transferEvidence, counterparty: { last4: '1111', kind: 'unknown' } } };
  const state = apply([debit, other[0]], withFabAccount());
  assert.equal(rows0007(state).length, 2, show(state));
});
test('a debit naming a payee (not the bank\'s transfer form) never pairs with a confirmation', () => {
  const pair = historyPair(['d', 'e'], T0, T0 + 905);
  const rows = [pair[0], { ...pair[1], merchant: 'Transfer to Sara Omar', transferEvidence: undefined }];
  const state = apply(rows, withFabAccount());
  assert.equal(rows0007(state).length, 2, show(state));
});
test('a category edit keeps the row its partner: re-importing History adds nothing', () => {
  let state = apply(historyPair(['2', '3'], T0, T0 + 905), withFabAccount());
  state = { ...state, transactions: state.transactions.map((t) => t.amountFils === 15000 ? { ...t, category: 'travel', userEdited: true } : t) };
  state = apply(historyPair(['2', '3'], T0, T0 + 905), state);
  assert.equal(rows0007(state).length, 1, show(state));
  assert.equal(rows0007(state)[0].category, 'travel');
});
test('the absorbed identity holds after a retitle or a move', () => {
  const state = apply(historyPair(['4', '5'], T0, T0 + 905), withFabAccount());
  const retitled = { ...state, transactions: state.transactions.map((t) => t.amountFils === 15000
    ? { ...t, title: 'Rent to landlord', titleEdited: true, userEdited: true } : t) };
  assert.equal(rows0007(apply(historyPair(['4', '5'], T0, T0 + 905), retitled)).length, 1, 'after a retitle');
  const cash = { id: 'cash', name: 'Cash', kind: 'cash', color: '#000', openingFils: 0 };
  const moved = { ...state, accounts: [...state.accounts, cash], transactions: state.transactions.map((t) =>
    t.amountFils === 15000 ? { ...t, accountId: 'cash', userEdited: true } : t) };
  const after = apply(historyPair(['4', '5'], T0, T0 + 905), moved);
  assert.equal(rows0007(after).length, 1, 'after a move');
  assert.equal(rows0007(after)[0].accountId, 'cash');
});
// With a known FAB sender, the confirmation goes to the existing account, not
// a legacy "Card •0007" holding nothing but such confirmations.
const legacyPhantom = (changes = {}) => ({ id: 'card-0007', name: 'FAB Card •0007', kind: 'card', last4: '0007', bankName: 'FAB',
  color: '#000', openingFils: 0, ...changes });
const legacyRow = (changes = {}) => ({ id: 'old-confirm', type: 'expense', amountFils: 9900, category: 'other', accountId: 'card-0007',
  title: 'Outgoing transfer', date: '2026-08-01', ts: T0 - 86_400_000 * 30, source: 'sms', smsKey: `h${'e'.repeat(64)}`,
  captureInstrument: { last4: '0007', kind: 'unknown' }, isTransfer: true,
  transferEvidence: { version: 1, currency: 'AED', attribution: 'source', sourceKindAmbiguous: true }, ...changes });
const withLegacyPhantom = () => ({ ...base(), accounts: [fabAccount, legacyPhantom()], transactions: [legacyRow()] });
test('a FAB confirmation goes to the existing FAB account beside a legacy confirmation-only card', () => {
  const state = apply(historyPair(['6', '7'], T0, T0 + 905, '150.00', '1000.00', '1111', { bankHint: 'FAB' }), withLegacyPhantom());
  assert.equal(rows0007(state).length, 1, show(state));
  assert.equal(rows0007(state)[0].accountId, 'fab-0007');
  assert.equal(state.transactions.find((t) => t.id === 'old-confirm').accountId, 'card-0007', 'stored rows never move');
  assert.ok(state.accounts.some((a) => a.id === 'card-0007'), 'no account is removed');
});
test('re-reading a stored confirmation never moves it off the account it is on', () => {
  const conf = hist([['a', CONFIRM('99.00', '1111'), T0 - 86_400_000 * 30]], { bankHint: 'FAB' });
  const start = { ...withLegacyPhantom(), transactions: [legacyRow({ smsKey: `h${'a'.repeat(64)}`, ts: conf[0].smsTs,
    captureInstrument: { last4: '0007', kind: 'unknown', bankIdentity: 'fab' } })] };
  const plan = buildImportPlan(conf, start, 0, now);
  assert.ok(!(plan.batch.updates ?? []).some((patch) => patch.accountId !== undefined), JSON.stringify(plan.batch.updates));
  const state = apply(conf, start);
  assert.equal(state.transactions.find((t) => t.id === 'old-confirm').accountId, 'card-0007');
  assert.equal(state.transactions.length, 1);
});
test('any card alert for that tail in the batch keeps the old routing (no guess)', () => {
  const purchase = hist([['1', 'Purchase of AED 20.00 with Card ending 0007 at STARBUCKS DUBAI. Avl Bal AED 880.00', T0 - 3_600_000]],
    { bankHint: 'FAB' });
  const pair = historyPair(['8', '9'], T0, T0 + 905, '150.00', '1000.00', '1111', { bankHint: 'FAB' });
  const state = apply([...purchase, ...pair], withLegacyPhantom());
  assert.equal(state.transactions.find((t) => t.amountFils === 15000 && t.title === 'Outgoing transfer').accountId, 'card-0007');
});
// The four review repros keep the old, safe outcome.
test('review H1: a card purchase never moves the legacy card\'s rows or removes it', () => {
  const purchase = hist([['1', 'Purchase of AED 20.00 with Card ending 0007 at STARBUCKS DUBAI. Avl Bal AED 880.00', T0]], { bankHint: 'FAB' });
  const state = apply(purchase, withLegacyPhantom());
  assert.equal(state.transactions.find((t) => t.id === 'old-confirm').accountId, 'card-0007');
  assert.equal(state.accounts.length, 2);
});
test('review H2: two transfers to different people seconds apart stay two', () => {
  const state = apply(hist([
    ['3', 'AED 100.00 debited from your account XXXX0007 for a FastPay transfer to Khalid Rashid. Avl bal AED 900.00', T0],
    ['4', 'AED 100.00 debited from your account XXXX0007 for a FastPay transfer to Sara Omar.', T0 + 4000],
  ], { bankHint: 'FAB' }), withFabAccount());
  assert.equal(state.transactions.filter((t) => t.amountFils === 10000).length, 2);
});
test('review M2: an ENBD debit on 0007 leaves a bankless legacy card exactly as it was', () => {
  const enbd = { id: 'enbd-0007', name: 'Emirates NBD Account •0007', kind: 'bank', last4: '0007', bankName: 'Emirates NBD', color: '#000', openingFils: 0 };
  const start = { ...base(), accounts: [enbd, legacyPhantom({ name: 'Card •0007', bankName: undefined })], transactions: [legacyRow()] };
  const debit = historyRow({ amountFils: 4000, merchant: 'Outward remittance', card: { last4: '0007', kind: 'account' },
    smsTs: T0, sourceEventId: '5'.repeat(64), bankHint: 'Emirates NBD' });
  const state = apply([debit], start);
  assert.equal(state.transactions.find((t) => t.id === 'old-confirm').accountId, 'card-0007');
  assert.equal(state.accounts.length, 2);
});
test('review M3: a legacy confirmation\'s debit arriving later is a known duplicate on the right account', () => {
  const start = { ...withLegacyPhantom(), transactions: [legacyRow({ amountFils: 15000, date: '2026-09-08', ts: T0 })] };
  const debit = historyPair(['6', '7'], T0, T0 + 905)[1];
  const state = apply([debit], start);
  const rows = rows0007(state);
  assert.equal(rows.length, 2, show(state));
  assert.ok(rows.some((t) => t.accountId === 'fab-0007'), 'the debit is on the bank account');
  assert.equal(state.transactions.find((t) => t.id === 'old-confirm').accountId, 'card-0007');
});
// Only FAB's ambiguous form is read this way: card transfers and card
// payments with an untyped card keep their card (fictional messages).
const CARD_TRANSFERS = [
  'AED 300.00 has been debited from your card ending 1234 for funds transfer through mobile banking. Avl bal AED 700.00',
  'Your Liv card ending 1234 was debited AED 200.00 for RULE TRANSFER TO SAVINGS WITH ONE-SHOT SAVING',
  'AED 500.00 transferred from your card ending 1234 to your own account',
  'AED 250.00 paid towards card no. XXXX1234. Thank you.',
];
for (const [index, text] of CARD_TRANSFERS.entries()) {
  test(`a card-worded transfer or payment keeps its card (${index + 1})`, () => {
    const state = apply(hist([['c', text, T0]]));
    assert.equal(state.accounts.filter((a) => a.last4 === '1234' && a.kind === 'bank').length, 0,
      JSON.stringify(state.accounts.map((a) => [a.name, a.kind])));
  });
}
test('an SMS that is the better copy of a stored push row still replaces it', () => {
  let state = apply([historyRow({ amountFils: 12000, merchant: 'Transfer', snapshotFils: null, snapshotKind: null,
    channel: 'push', sourceEventId: undefined, smsTs: T0 })]);
  state = apply([historyRow({ amountFils: 12000, merchant: 'Transfer to Ahmed', snapshotFils: 90000,
    sourceEventId: '3'.repeat(64), smsTs: T0 + 2000 })], state);
  const rows = state.transactions.filter((t) => t.amountFils === 12000);
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].viaPush, true);
});
