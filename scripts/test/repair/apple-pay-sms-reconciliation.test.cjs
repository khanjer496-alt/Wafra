'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const build = process.env.WAFRA_TEST_BUILD_DIR || path.join(root, 'scripts/test/build');
const cache = new Map(), subjects = new Set(['import-plan', 'dedupe']);
function current(name) {
  if (cache.has(name)) return cache.get(name);
  if (!subjects.has(name)) return require(path.join(build, `${name}.js`));
  const file = path.join(root, `src/lib/${name}.ts`);
  const emitted = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const deps = {};
  for (const [, specifier] of emitted.matchAll(/require\(["']([^"']+)["']\)/g)) {
    assert.ok(specifier.startsWith('@/lib/'), specifier);
    deps[specifier] = current(specifier.slice(6));
  }
  const result = load(file, deps); cache.set(name, result); return result;
}
const { buildImportPlan } = current('import-plan');
const { duplicateGuard, reconcileCaptureDuplicates } = current('dedupe');
const { setActiveMarket, setLedgerCurrency } = current('markets');
setActiveMarket('AE'); setLedgerCurrency('AED', 2);
const at = Date.parse('2026-09-23T12:00:00Z'), date = '2026-09-23';
const wallet = extra => ({ id: 'wallet-confirmed', source: 'sms', viaPush: true, userEdited: true, titleEdited: true,
  smsKey: 'apple_pay_review_source_' + '1'.repeat(32), ts: at, date, amountFils: 25000, type: 'expense', title: 'CARREFOUR',
  category: 'groceries', accountId: 'chosen-card', ...extra });
const state = (row = wallet(), extra = {}) => ({ hydrated: true, marketId: 'AE', ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
  transactions: [row], accounts: [{ id: 'chosen-card', name: 'ADIB card', kind: 'card', cardType: 'credit', last4: '4417', bankName: 'ADIB' },
    { id: 'other-card', name: 'Other card', kind: 'card', cardType: 'credit', last4: '5528', bankName: 'ADIB' }],
  budgets: [], bills: [], goals: [], cardDues: [], accountHints: {}, merchantOverrides: {}, knownBanks: [], lastScanTs: 0, parserVersion: 0, ...extra });
const sms = extra => ({ kind: 'transaction', type: 'expense', amountFils: 25000, currency: 'AED', merchant: 'CARREFOUR',
  categoryGuess: 'groceries', date, smsTs: at + 1000, channel: 'inbox', bankHint: 'ADIB', card: { kind: 'credit', last4: '4417' }, ...extra });
const plan = (p = sms(), s = state()) => buildImportPlan([p], s, 0, new Date(at + 60_000));

test('Wallet reviewed before its SMS binds identity once while preserving the explicit user fields', () => {
  for (const sourceEventId of [undefined, 'a'.repeat(64)]) {
    const original = state(), incoming = sms({ sourceEventId, merchant: '  carrefour  ' });
    const result = plan(incoming, original);
    assert.equal(result.txCount, 0); assert.equal(result.newAccountCount, 0);
    const update = result.batch.updates.find(x => x.id === 'wallet-confirmed');
    assert.ok(update, 'even timestamp-key SMS must durably bind the reviewed Wallet row');
    assert.equal(update.smsKey, sourceEventId ? 'h' + sourceEventId : `s${incoming.smsTs}-${incoming.amountFils}`);
    assert.equal(update.viaPush, false); assert.equal(update.remove, undefined);
    assert.equal(update.accountId, undefined); assert.equal(update.title, undefined);
    const promoted = { ...original.transactions[0], ...update };
    assert.equal(promoted.userEdited, true); assert.equal(promoted.title, 'CARREFOUR');
    assert.equal(promoted.accountId, 'chosen-card');
    const restored = { ...original, transactions: reconcileCaptureDuplicates(JSON.parse(JSON.stringify([promoted]))) };
    assert.equal(plan(incoming, restored).txCount, 0, 'retry after JSON hydration does not duplicate the matched SMS');
  }
});

test('different merchant, different account, unknown instrument and late alerts stay separate real purchases', () => {
  for (const patch of [
    { merchant: 'COSTA COFFEE' }, { merchant: '' }, { card: { kind: 'credit', last4: '5528' } },
    { card: undefined }, { card: { kind: 'unknown', last4: '4417' } },
    { card: { kind: 'credit', last4: '9999' } }, { smsTs: at + 120_001 },
    { bankHint: undefined, sender: undefined }, { bankHint: 'Emirates NBD' },
  ]) {
    const result = plan(sms(patch));
    assert.equal(result.txCount, 1, JSON.stringify(patch));
    assert.ok(!result.batch.updates.some(x => x.id === 'wallet-confirmed'), JSON.stringify(patch));
  }
  for (const accounts of [[], [{ ...state().accounts[0], bankName: undefined }],
    [{ ...state().accounts[0], cardType: undefined }], [...state().accounts, { ...state().accounts[0], id: 'same-suffix' }]]) {
    assert.equal(plan(sms(), state(wallet(), { accounts })).txCount, 1);
  }
});

test('Wallet never joins generic amount, title, statement or push heuristics but retains exact receipt identity', () => {
  const original = wallet();
  const candidate = { date, amountFils: 25000, type: 'expense', title: 'CARREFOUR', ts: at + 1000, channel: 'inbox',
    accountId: 'chosen-card', smsKey: `s${at + 1000}-25000` };
  assert.equal(duplicateGuard([original]).has(candidate), false);
  assert.equal(duplicateGuard([original]).supersedes(candidate), null);
  assert.equal(duplicateGuard([original]).has({ ...candidate, captureSource: 'pdf' }), false);
  assert.equal(duplicateGuard([original]).has({ ...candidate, smsKey: original.smsKey, ts: original.ts }), true);
});

test('hydration never heuristically deletes a Wallet review decision or an unproven SMS counterpart', () => {
  for (const title of ['CARREFOUR', 'OTHER SHOP']) for (const accountId of ['chosen-card', 'other-card', '']) {
    const other = { ...wallet(), id: 'bank-sms', smsKey: `s${at + 1000}-25000`, ts: at + 1000,
      viaPush: false, userEdited: false, titleEdited: false, title, accountId };
    for (const rows of [[wallet(), other], [other, wallet()]]) assert.equal(reconcileCaptureDuplicates(rows).length, 2);
  }
});

test('a bound Wallet row cannot swallow the next equal purchase and ambiguous Wallet matches stay separate', () => {
  const first = sms({ sourceEventId: 'a'.repeat(64) });
  const second = sms({ sourceEventId: 'b'.repeat(64), smsTs: at + 2000 });
  const result = buildImportPlan([first, second], state(), 0, new Date(at + 60_000));
  assert.equal(result.txCount, 1);
  const ambiguous = state(wallet(), { transactions: [wallet(), wallet({ id: 'other-wallet', smsKey: 'apple_pay_review_source_' + '2'.repeat(32), ts: at + 500 })] });
  assert.equal(plan(first, ambiguous).txCount, 1, 'two possible receipts cannot authorize choosing one');
});
