'use strict';
// Issue #262: restoring a backup re-filed SMS rows saved as Other (Starbucks to
// Dining, Pharmacy to Health) and re-ran the other persisted-row repairs. A
// backup written by Wafra 1.0.0 or later restores exactly as saved; an older
// file still gets the repairs it was written without. Runs the SHIPPING store
// and reducer. Synthetic data only. Requires `bash scripts/test/build.sh`.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const vm = require('node:vm');
const { loadStore } = require('../../perf/load-store.cjs');

const { store, reducer } = loadStore();

const AED = { schemaVersion: 2, currency: 'AED', exponent: 2 };
const accounts = [
  { id: 'acc-debit', name: 'Sample Bank Debit Card •1111', kind: 'card', cardType: 'debit', last4: '1111', bankName: 'Sample Bank', openingFils: 0, color: '#2563eb' },
  { id: 'acc-credit', name: 'Sample Bank Credit Card •2222', kind: 'card', cardType: 'credit', last4: '2222', bankName: 'Sample Bank', openingFils: 0, color: '#9333ea' },
  { id: 'acc-bank', name: 'Sample Bank Account', kind: 'bank', bankName: 'Sample Bank', openingFils: 0, color: '#16a34a' },
];
const DAY = 86_400_000;
const START = Date.UTC(2026, 10, 9, 8);
let seq = 0;
const sms = (title, fields = {}) => {
  seq += 1;
  const ts = START - seq * DAY / 3;
  return {
    type: 'expense', amountFils: 1_000 + seq * 137, category: 'other', accountId: accounts[seq % 2].id,
    title, date: new Date(ts).toISOString().slice(0, 10), ts, source: 'sms',
    smsKey: `sample${seq}t${ts}`, id: `tx-${ts}-${seq}-${100000 + seq}`, ...fields,
  };
};

// The F8 shape: SMS expenses the parser vocabulary would now file elsewhere,
// saved as Other. Every one came back re-filed on 1.0.0.
const savedAsOther = ['Starbucks 280', 'Noon 216', 'Talabat 256', 'Pharmacy 315', 'Cinema 20',
  'Lulu 191', 'Gym 394', 'Carrefour 3', 'ADNOC 227', 'Spinneys 24'].map((title) => sms(title));
// Each of the other persisted-row repairs, on a row it would rewrite.
const repairTargets = {
  maskedCard: sms('4782********4833 Sample payee'),
  incomeInSpending: sms('Sample Payout', { type: 'income', category: 'dining', accountId: 'acc-bank' }),
  anonymousIncome: sms('Incoming transfer', { type: 'income', category: 'business', accountId: 'acc-bank' }),
  remittanceTransfer: sms('Inward remittance', { type: 'income', category: 'other', isTransfer: true, accountId: 'acc-bank' }),
  atm: sms('ATM withdrawal', { category: 'shopping' }),
  bnpl: sms('Tabby', { category: 'loan' }),
  retainedSms: sms('CARREFOUR', {
    amountFils: 4_500, raw: 'Purchase of AED 45.00 with card ending 1234 at CARREFOUR, DUBAI on 02/07/2026',
  }),
};
const transactions = [
  ...savedAsOther,
  ...Object.values(repairTargets),
  sms('Talabat 33', { category: 'health' }),
  sms('Sample Grocer', { category: 'groceries' }),
  sms('Starbucks 99', { userEdited: true }),
  { ...sms('Starbucks cash'), source: 'manual', smsKey: undefined },
].map((row) => JSON.parse(JSON.stringify(row)));

// The repro file's ledger fields (QA F8, synthetic): an Android ledger whose
// inbox was re-read under the 1.0.0 grammar.
const ledger = {
  customCategories: [], ledgerMoney: AED, localCaptureQualifications: [], iosCaptureWarning: null,
  accounts, transactions, budgets: [], bills: [], cardDues: [], statementCoverage: [], goals: [],
  onboardingPlan: null, onboardingProfile: null, onboardingCurrencyEvidence: 'AED',
  merchantOverrides: {}, billAliases: {}, accountHints: { 1111: 'acc-debit', 2222: 'acc-credit' },
  trustedNotificationPackages: [], notSubscriptions: [], cancelledSubscriptions: {},
  lastScanTs: START, historyImport: null, onboarded: true, userName: 'Sample', appLock: true,
  monthStartDay: 1, themePreference: 'system', privateMode: false, captureOptOut: false,
  dailySummary: false, marketId: 'AE', country: 'AE', language: 'en', languagePreference: 'en',
  knownBanks: [], transferNormalizationVersion: 2, transferInternalIds: [],
  androidCaptureSources: { sms: true, notifications: true }, parserVersion: 50, recentRereadParserVersion: 71,
};

const device = () => reducer({ hydrated: false, transactions: [], accounts: [] }, {
  type: 'hydrate', state: { onboarded: true, language: 'en', marketId: 'AE', ledgerMoney: AED },
});

// The shipping exportBackup callback, lifted out of StoreProvider the way
// complimentary-access.test.cjs does, so a change to what it strips is tested.
function storeAction(name, bindings) {
  const file = path.join(__dirname, '../../../src/lib/store.tsx');
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let body;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) body = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(body, `${name} found in store.tsx`);
  return vm.runInNewContext(ts.transpileModule(`(${body.getText(source)})`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, bindings);
}
const exportBackup = (state) => storeAction('exportBackup', { authoritativeState: { current: state } })();
const exportData = (state) => JSON.parse(exportBackup(state)).data;
const envelope = (data) => JSON.stringify({ app: 'wafra', version: 1, exportedAt: '2026-11-11T12:00:00.000Z', data });
const restore = (json) => {
  const parsed = store.parseBackupForRestore(json);
  assert.ok(parsed, 'the backup restores');
  return reducer(device(), { type: 'restore', state: parsed });
};
// The next launch: persisted state through the hydration migration and reducer.
const relaunch = (state) => {
  const { hydrated: _h, ...persisted } = JSON.parse(JSON.stringify(state));
  return reducer({ hydrated: false, transactions: [], accounts: [] }, {
    type: 'hydrate', state: store.migratePersistedState(persisted, { reuseCompletedReparse: true }),
  });
};

const assertSameTransactions = (actual, expected, label) => {
  assert.equal(actual.length, expected.length, `${label}: row count`);
  const byId = new Map(actual.map((row) => [row.id, row]));
  for (const row of expected) assert.deepStrictEqual(byId.get(row.id), row, `${label}: ${row.title}`);
  assert.equal(JSON.stringify(actual), JSON.stringify(expected), `${label}: byte-for-byte`);
};

test('a 1.0.0 backup restores every transaction exactly, and backup -> restore -> backup is identical', () => {
  // A real 1.0.0 export, written from a hydrated ledger (it carries the
  // ledger defaults every 1.0.0 build writes, App Lock on as in the repro).
  const { parserVersion: _p, recentRereadParserVersion: _r, ...iosLedger } = JSON.parse(JSON.stringify(ledger));
  const saved = exportData(reducer(device(), { type: 'restore', state: iosLedger }));
  // The real export keeps the 1.0.0 markers; without them this file would
  // take the pre-1.0.0 path (it has no Android parser receipt).
  assert.equal(typeof saved.onlineLogosEnabled, 'boolean');
  assert.equal(typeof saved.hideWidgetAmountsWhenLocked, 'boolean');
  assert.equal(saved.parserVersion, undefined);
  const backup = envelope(saved);

  const restored = restore(backup);
  assertSameTransactions(restored.transactions, saved.transactions, 'restore');
  assert.equal(restored.transactions.filter((row) => row.category === 'other' && row.source === 'sms').length,
    saved.transactions.filter((row) => row.category === 'other' && row.source === 'sms').length);

  const again = exportData(restored);
  assert.equal(JSON.stringify(again.transactions), JSON.stringify(saved.transactions), 'second backup');
  assertSameTransactions(restore(envelope(again)).transactions, saved.transactions, 'second restore');
  assertSameTransactions(relaunch(restored).transactions, saved.transactions, 'relaunch after restore');
});

test('the F8 repro shape (Android parser receipt 50, no ledger defaults) restores exactly', () => {
  const backup = envelope(JSON.parse(JSON.stringify(ledger)));
  const restored = restore(backup);
  assertSameTransactions(restored.transactions, ledger.transactions, 'restore');
  assertSameTransactions(restore(envelope(exportData(restored))).transactions, ledger.transactions, 'round trip');
  assertSameTransactions(relaunch(restored).transactions, ledger.transactions, 'relaunch after restore');
});

test('each 1.0.0 marker alone restores exactly; a pre-1.0.0 parser receipt does not', () => {
  const { parserVersion: _p, recentRereadParserVersion: _r, ...base } = JSON.parse(JSON.stringify(ledger));
  const starbucks = (data) => restore(envelope(data)).transactions.find((row) => row.id === savedAsOther[0].id).category;
  assert.equal(starbucks({ ...base, onlineLogosEnabled: false }), 'other');
  assert.equal(starbucks({ ...base, hideWidgetAmountsWhenLocked: true }), 'other');
  assert.equal(starbucks({ ...base, parserVersion: 50 }), 'other');
  assert.equal(starbucks({ ...base, parserVersion: 49 }), 'dining');
});

test('a backup from a build before 1.0.0 still gets the persisted-row repairs', () => {
  const {
    parserVersion: _p, recentRereadParserVersion: _r, ...older
  } = JSON.parse(JSON.stringify(ledger));
  const restored = restore(envelope(older));
  const byId = new Map(restored.transactions.map((row) => [row.id, row]));
  const repaired = (row) => byId.get(row.id);
  const original = new Map(ledger.transactions.map((row) => [row.id, row]));

  assert.equal(repaired(savedAsOther[0]).category, 'dining', 'Starbucks re-filed from Other');
  assert.equal(repaired(savedAsOther[3]).category, 'health', 'Pharmacy re-filed from Other');
  assert.equal(repaired(repairTargets.maskedCard).title, 'Card payment');
  assert.equal(repaired(repairTargets.maskedCard).isTransfer, true);
  assert.equal(repaired(repairTargets.incomeInSpending).category, 'business');
  assert.equal(repaired(repairTargets.anonymousIncome).category, 'other');
  assert.equal('isTransfer' in repaired(repairTargets.remittanceTransfer), false);
  assert.notEqual(repaired(repairTargets.atm).category, 'shopping');
  assert.equal(repaired(repairTargets.bnpl).category, 'shopping');
  assert.equal(repaired(repairTargets.retainedSms).category, 'groceries');
  // User answers and hand-entered rows are never repaired, in either format.
  for (const row of ledger.transactions.filter((t) => t.userEdited || t.source === 'manual')) {
    assert.deepStrictEqual(byId.get(row.id), original.get(row.id), row.title);
  }
});
