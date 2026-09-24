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

test('different merchant, different account, unknown instrument and late alerts never bind automatically', () => {
  // Same amount on a compatible card within ten minutes: never bound, never
  // posted silently either. The alert goes to Review as a possible duplicate
  // (wallet-near-match.test.cjs covers that contract end to end).
  for (const patch of [
    { merchant: 'COSTA COFFEE' }, { merchant: '' }, { card: { kind: 'unknown', last4: '4417' } },
    { smsTs: at + 120_001 }, { bankHint: undefined, sender: undefined },
  ]) {
    const result = plan(sms(patch));
    assert.equal(result.txCount, 0, JSON.stringify(patch));
    assert.equal(result.walletNearMatches.length, 1, JSON.stringify(patch));
    assert.ok(!result.batch.updates.some(x => x.id === 'wallet-confirmed'), JSON.stringify(patch));
  }
  // A different card, an unknown instrument or a contradicting issuer is a
  // separate real purchase and still posts.
  for (const patch of [
    { card: { kind: 'credit', last4: '5528' } }, { card: undefined },
    { card: { kind: 'credit', last4: '9999' } }, { bankHint: 'Emirates NBD' },
  ]) {
    const result = plan(sms(patch));
    assert.equal(result.txCount, 1, JSON.stringify(patch));
    assert.equal(result.walletNearMatches.length, 0, JSON.stringify(patch));
    assert.ok(!result.batch.updates.some(x => x.id === 'wallet-confirmed'), JSON.stringify(patch));
  }
  for (const accounts of [[{ ...state().accounts[0], bankName: undefined }],
    [{ ...state().accounts[0], cardType: undefined }], [...state().accounts, { ...state().accounts[0], id: 'same-suffix' }]]) {
    const result = plan(sms(), state(wallet(), { accounts }));
    assert.equal(result.txCount, 0);
    assert.equal(result.walletNearMatches.length, 1);
    assert.ok(!result.batch.updates.some(x => x.id === 'wallet-confirmed'));
  }
  // The Wallet row's own card is gone: nothing ties the alert to it.
  assert.equal(plan(sms(), state(wallet(), { accounts: [] })).txCount, 1);
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
  const ambiguousPlan = plan(first, ambiguous);
  assert.equal(ambiguousPlan.batch.updates.length, 0, 'two possible receipts cannot authorize choosing one');
  assert.equal(ambiguousPlan.txCount, 0, 'nor may the alert post silently beside them');
  assert.equal(ambiguousPlan.walletNearMatches.length, 1);
});

test('realistic bank descriptors and late SMS never merge automatically into a Wallet row', () => {
  // Automatic binding writes without asking, so it stays exact. Wallet-side
  // promotion asks the user about these pairs instead (ios-apple-pay-promotion).
  // Nor does the planner post them as a silent second row: they go to Review.
  for (const patch of [{ merchant: 'CARREFOUR MOE DXB' }, { smsTs: at + 5 * 60_000 }]) {
    const result = plan(sms(patch));
    assert.equal(result.txCount, 0, JSON.stringify(patch));
    assert.equal(result.walletNearMatches.length, 1, JSON.stringify(patch));
    assert.ok(!result.batch.updates.some(x => x.id === 'wallet-confirmed'), JSON.stringify(patch));
  }
});

test('a parser correction of an existing SMS row heals that row instead of binding the Wallet row', () => {
  const body = 'Your ADIB credit card 4417 was used for AED 250.00 at CARREFOUR';
  const legacy = { id: 'legacy-sms', source: 'sms', smsKey: `s${at + 1000}-24000`, ts: at + 1000, date,
    amountFils: 24000, type: 'expense', title: 'CARREFOUR', category: 'groceries', accountId: 'chosen-card', raw: body };
  const before = state(wallet(), { transactions: [wallet(), legacy] });
  const result = plan(sms({ raw: body }), before);
  assert.equal(result.txCount, 0);
  assert.ok(!result.batch.updates.some(x => x.id === 'wallet-confirmed'), 'one SMS must not explain two rows');
  assert.ok(result.batch.updates.some(x => x.id === 'legacy-sms'));
});

test('a same-batch bank push copy and its SMS count the Wallet purchase once in either order', () => {
  for (const rows of [[sms({ channel: 'push', smsTs: at + 500 }), sms()],
    [sms(), sms({ channel: 'push', smsTs: at + 1500 })]]) {
    const result = buildImportPlan(rows, state(), 0, new Date(at + 60_000));
    assert.equal(result.txCount, 0, 'the push is the SMS copy and the SMS binds the Wallet row');
    assert.equal(result.batch.updates.filter(x => x.id === 'wallet-confirmed').length, 1);
  }
});

test('an SMS the generic duplicate guard already attributes to a stored bank row is not reused for the Wallet row', () => {
  const stored = { id: 'stored-push', source: 'sms', viaPush: true, smsKey: `s${at + 500}-25000`, ts: at + 500, date,
    amountFils: 25000, type: 'expense', title: 'CARREFOUR', category: 'groceries', accountId: 'chosen-card',
    captureInstrument: { last4: '4417', kind: 'credit', bankIdentity: 'adib' } };
  const result = plan(sms(), state(wallet(), { transactions: [wallet(), stored] }));
  assert.equal(result.txCount, 0);
  assert.ok(!result.batch.updates.some(x => x.id === 'wallet-confirmed'), 'one SMS must not explain two rows');
});

test('a non-confident account resolution never binds; the SMS goes to Review, not a silent second row', () => {
  // A sole known-bank default makes a second card match this suffix for the
  // resolver (which then refuses to choose) while the Wallet rule still sees
  // exactly one ADIB card. The resolution gate, not the Wallet rule, decides.
  const defaulted = { id: 'default-card', name: 'ENBD card', kind: 'card', cardType: 'credit', last4: '4417', bankName: 'Emirates NBD' };
  const result = plan(sms(), state(wallet(), { knownBanks: ['Emirates NBD'], accounts: [...state().accounts, defaulted] }));
  assert.ok(!result.batch.updates.some(x => x.id === 'wallet-confirmed'));
  assert.equal(result.txCount, 0);
  assert.equal(result.walletNearMatches.length, 1, 'the ADIB suffix still fits the Wallet card: ask');
  assert.notEqual(result.walletNearMatches[0].transaction.accountId, 'chosen-card');
});

test('binding still records the bank-quoted balance snapshot for the confidently resolved card', () => {
  const result = plan(sms({ snapshotFils: 1_000_000, snapshotKind: 'limit' }));
  assert.ok(result.batch.updates.some(x => x.id === 'wallet-confirmed'));
  assert.equal(JSON.stringify(result.batch.snapshots['chosen-card']), JSON.stringify({ fils: 1_000_000, kind: 'limit', ts: at + 1000 }));
});
