'use strict';
// GAP 1: a bank SMS that near-matches an already-posted Apple Pay (Wallet)
// row, but fails the strict automatic binding rule, must never post silently
// as a second row. It becomes a source-bound Review item instead.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const build = process.env.WAFRA_TEST_BUILD_DIR || path.join(root, 'scripts/test/build');
const cache = new Map();
const subjects = new Set(['import-plan', 'dedupe', 'wallet-near-match', 'parsed-review-event', 'review-promotion']);
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
const { settleWalletNearMatches, walletNearMatchesRetained, stageWalletNearMatches } = current('wallet-near-match');
const { planReviewPromotion, walletDuplicateBinding } = current('review-promotion');
const { admitPreparedReviewAlert, emptyAlertReviewTray, pruneAlertReviewTray, resolveReviewAlert, REVIEW_ALERT_TTL_MS } = current('alert-review-tray');
const { canonicalCaptureSourceKey } = current('capture-source-identity');
const { reconcileCaptureDuplicates } = current('dedupe');
const { applyHealPatch } = current('heal');
const { setActiveMarket, setLedgerCurrency } = current('markets');
setActiveMarket('AE'); setLedgerCurrency('AED', 2);

const at = Date.parse('2026-09-23T12:00:00Z'), date = '2026-09-23', MIN = 60_000;
const wallet = extra => ({ id: 'wallet-confirmed', source: 'sms', viaPush: true, userEdited: true, titleEdited: true,
  smsKey: 'apple_pay_review_source_' + '1'.repeat(32), ts: at, date, amountFils: 25000, type: 'expense', title: 'Carrefour',
  category: 'groceries', accountId: 'chosen-card', ...extra });
const state = (transactions = [wallet()], extra = {}) => ({ hydrated: true, marketId: 'AE',
  ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 }, transactions,
  accounts: [{ id: 'chosen-card', name: 'ADIB card', kind: 'card', cardType: 'credit', last4: '4417', bankName: 'ADIB', openingFils: 0, color: '#000' },
    { id: 'other-card', name: 'Other card', kind: 'card', cardType: 'credit', last4: '5528', bankName: 'ADIB', openingFils: 0, color: '#111' }],
  reviewTray: emptyAlertReviewTray(), budgets: [], bills: [], goals: [], cardDues: [], accountHints: {}, merchantOverrides: {},
  knownBanks: [], lastScanTs: 0, parserVersion: 0, ...extra });
const sms = extra => ({ kind: 'transaction', type: 'expense', amountFils: 25000, currency: 'AED', merchant: 'CARREFOUR MOE DXB',
  categoryGuess: 'groceries', date, smsTs: at + 5 * MIN, channel: 'inbox', bankHint: 'ADIB',
  card: { kind: 'credit', last4: '4417' }, sourceEventId: 'a'.repeat(64), ...extra });
// The store's actual reducer switch (setReviewTray has no runtime dependencies).
const storeText = fs.readFileSync(path.join(root, 'src/lib/store.tsx'), 'utf8');
const storeSource = ts.createSourceFile('store.tsx', storeText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const reduceNode = storeSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'reduceState');
const reduceState = (() => {
  const js = ts.transpileModule(reduceNode.getText(storeSource) + '\nmodule.exports = reduceState;',
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', js)(module, module.exports);
  return module.exports;
})();
const plan = (rows, s = state(), today = new Date(at + 10 * MIN)) => buildImportPlan(rows, s, 0, today);

test('Wallet posted, then a bank SMS with another descriptor 5 minutes later: Review item, no second ledger row', () => {
  for (const [patch, key] of [
    [{}, 'h' + 'a'.repeat(64)],
    [{ sourceEventId: undefined }, `s${at + 5 * MIN}-25000`],
    [{ sourceEventId: 'a123' }, `ha123t${at + 5 * MIN}`],
  ]) {
    const row = sms(patch);
    const result = plan([row]);
    assert.equal(result.txCount, 0, JSON.stringify(patch));
    assert.equal(result.batch.transactions.length, 0);
    assert.ok(!result.batch.updates.some(u => u.id === 'wallet-confirmed'), 'a near-match never binds automatically');
    assert.equal(result.walletNearMatches.length, 1);
    const [near] = result.walletNearMatches;
    assert.equal(near.row, row, 'the exact scanned row travels for queue acknowledgement');
    assert.equal(near.walletTransactionId, 'wallet-confirmed');
    assert.equal(near.review.attentionReason, 'possible-apple-pay-duplicate');
    assert.equal(near.review.kind, 'universal');
    assert.equal(near.review.observedAt, row.smsTs);
    assert.equal(canonicalCaptureSourceKey(near.review.sourceKey, near.review.observedAt), key,
      'the review is bound to the SMS identity, so promotion and rescans share one identity');
    assert.equal(near.review.event.amount.value.minorUnits, '25000');
    assert.equal(near.transaction.amountFils, 25000, 'the posting it would have made is kept for capacity fallback');
    assert.equal(near.transaction.smsKey, key);
    // Admission keeps it; exact source dedupe keeps a replay out of the tray.
    const admitted = admitPreparedReviewAlert(emptyAlertReviewTray(), near.review, at + 10 * MIN);
    assert.equal(admitted.outcome, 'admitted');
    assert.equal(admitted.state.pending[0].attentionReason, 'possible-apple-pay-duplicate');
    assert.equal(admitPreparedReviewAlert(admitted.state, near.review, at + 11 * MIN).outcome, 'duplicate');
  }
});

test('the same batch push copy of a withheld SMS does not post either', () => {
  const result = plan([sms(), sms({ channel: 'push', smsTs: at + 5 * MIN + 400, sourceEventId: undefined })]);
  assert.equal(result.txCount, 0);
  assert.equal(result.walletNearMatches.length, 1);
});

test('strict automatic binding is unchanged', () => {
  const result = plan([sms({ merchant: 'CARREFOUR', smsTs: at + 1000 })]);
  assert.equal(result.txCount, 0);
  assert.equal(result.walletNearMatches.length, 0);
  assert.ok(result.batch.updates.some(u => u.id === 'wallet-confirmed'));
});

test('genuine separate purchases post: different amount, beyond ten minutes, other card, income, push or statements', () => {
  for (const patch of [{ amountFils: 26000 }, { smsTs: at + 10 * MIN + 1 }, { smsTs: at - 10 * MIN - 1 },
    { card: { kind: 'credit', last4: '5528' } }, { card: { kind: 'credit', last4: '9999' } },
    { type: 'income', categoryGuess: 'salary' }, { transferHint: true }, { captureSource: 'pdf' },
    { bankHint: 'Emirates NBD', card: { kind: 'credit', last4: '4417' } }]) {
    const result = plan([sms(patch)]);
    assert.equal(result.walletNearMatches.length, 0, JSON.stringify(patch));
    assert.equal(result.txCount, 1, JSON.stringify(patch));
  }
  // Boundaries: exactly ten minutes either side still asks.
  for (const smsTs of [at + 10 * MIN, at - 10 * MIN]) {
    assert.equal(plan([sms({ smsTs })]).walletNearMatches.length, 1);
  }
});

test('two SMS near one Wallet row are two Review items, never merged or silently counted', () => {
  const result = plan([sms(), sms({ sourceEventId: 'b'.repeat(64), smsTs: at + 6 * MIN })]);
  assert.equal(result.txCount, 0);
  assert.equal(result.walletNearMatches.length, 2);
  assert.notEqual(result.walletNearMatches[0].review.sourceKey, result.walletNearMatches[1].review.sourceKey);
});

test('an SMS too old to stay reviewable keeps the old visible posting instead of an expiring review', () => {
  const late = new Date(at + REVIEW_ALERT_TTL_MS);
  const result = plan([sms()], state(), late);
  assert.equal(result.walletNearMatches.length, 0);
  assert.equal(result.txCount, 1);
});

test('capacity: a full Review lane posts (or defers) instead of evicting or dropping the SMS', () => {
  const result = plan([sms()]);
  const empty = settleWalletNearMatches(result, emptyAlertReviewTray(), at + 10 * MIN);
  assert.equal(empty.reviews.length, 1);
  assert.equal(empty.plan.batch.transactions.length, 0);
  assert.equal(empty.deferred.length, 0);
  let tray = emptyAlertReviewTray();
  const base = result.walletNearMatches[0].review;
  for (let i = 0; i < 50; i += 1) {
    const suffix = String(i).padStart(4, '0');
    tray = admitPreparedReviewAlert(tray, { ...base, attentionReason: undefined, id: 'fill_review_id_' + suffix,
      sourceKey: 'fill_review_source_' + suffix, observedAt: at + 6 * MIN + i,
      expiresAt: at + 6 * MIN + i + REVIEW_ALERT_TTL_MS }, at + 10 * MIN).state;
  }
  assert.equal(tray.pending.length, 50);
  const posted = settleWalletNearMatches(result, tray, at + 10 * MIN);
  assert.equal(posted.reviews.length, 0);
  assert.equal(posted.plan.batch.transactions.length, 1, 'a visible duplicate is recoverable, a dropped charge is not');
  assert.equal(posted.plan.txCount, 1);
  const deferred = settleWalletNearMatches(result, tray, at + 10 * MIN, 'defer');
  assert.equal(deferred.reviews.length, 0);
  assert.equal(deferred.deferred.length, 1);
  assert.equal(deferred.plan.batch.transactions.length, 0);
  // A plan without the field (older mocks) passes through.
  const bare = { txCount: 0, batch: { transactions: [] } };
  assert.equal(settleWalletNearMatches(bare, tray, at).plan, bare);
  // Retention check is exact-source and survives a tombstone.
  const staged = admitPreparedReviewAlert(emptyAlertReviewTray(), base, at + 10 * MIN).state;
  assert.equal(walletNearMatchesRetained(staged, [base], at + 10 * MIN), true);
  assert.equal(walletNearMatchesRetained(emptyAlertReviewTray(), [base], at + 10 * MIN), false);
});

test('promotion asks, the separate-purchase override posts exactly once, and a rescan never re-adds it', () => {
  const row = sms();
  const near = plan([row]).walletNearMatches[0];
  const tray = admitPreparedReviewAlert(emptyAlertReviewTray(), near.review, at + 10 * MIN).state;
  const before = state([wallet()], { reviewTray: tray });
  before.accounts.push({ id: 'plain-card', name: 'Card', kind: 'card', openingFils: 0, color: '#222' });
  const review = tray.pending[0];
  const input = extra => ({ reviewId: review.id, type: 'expense', title: 'CARREFOUR MOE DXB', category: 'groceries',
    accountId: 'chosen-card', date, betweenOwnAccounts: false,
    universal: { confirmed: true, postingStatus: 'posted', amount: review.event.amount.value,
      expectedSourceKey: review.sourceKey, expectedObservedAt: review.observedAt }, ...extra });
  assert.equal(planReviewPromotion(before, input(), 'tx-new', at + 11 * MIN).reason, 'possible-duplicate');
  assert.equal(planReviewPromotion(before, input({ accountId: 'plain-card' }), 'tx-new', at + 11 * MIN).reason,
    'possible-duplicate', 'choosing another card still asks about the flagged Wallet purchase');
  const separate = { separatePurchase: { confirmed: true, expectedSourceKey: review.sourceKey, expectedObservedAt: review.observedAt } };
  const added = planReviewPromotion(before, input(separate), 'tx-new', at + 11 * MIN);
  assert.equal(added.outcome, 'added');
  assert.equal(added.transaction.amountFils, 25000);
  const after = { ...before, transactions: [...before.transactions, added.transaction], reviewTray: added.reviewTray };
  assert.equal(planReviewPromotion(after, input(separate), 'tx-again', at + 12 * MIN).reason, 'not-found');
  const rescan = plan([row], after, new Date(at + 12 * MIN));
  assert.equal(rescan.txCount, 0, 'the promoted row owns the SMS identity');
  assert.equal(rescan.walletNearMatches.length, 0);
});

test('a decision made in Review is honoured by a rescan after the review window', () => {
  const row = sms();
  const near = plan([row]).walletNearMatches[0];
  for (const outcome of ['duplicate', 'dismissed', 'expired']) {
    const staged = admitPreparedReviewAlert(emptyAlertReviewTray(), near.review, at + 10 * MIN).state;
    // Expiry is recorded only by pruning (resolve refuses 'expired' by design).
    const decided = outcome === 'expired'
      ? pruneAlertReviewTray(staged, at + 10 * MIN + REVIEW_ALERT_TTL_MS + 86_400_000)
      : resolveReviewAlert(staged, near.review.id, outcome, at + 11 * MIN);
    const late = new Date(at + REVIEW_ALERT_TTL_MS + 5 * 86_400_000);
    const result = plan([row], state([wallet()], { reviewTray: decided }), late);
    assert.equal(result.txCount, 0, `${outcome}: never a silent second copy`);
    assert.equal(result.walletNearMatches.length, 1, outcome);
    // Collectors re-stage it: the live decision keeps it retained without a new item.
    const settled = settleWalletNearMatches(result, decided, late.getTime());
    assert.equal(settled.plan.batch.transactions.length, 0);
    assert.equal(walletNearMatchesRetained(decided, settled.reviews, late.getTime()), true);
  }
});

test('a review the tray refuses is posted in the same batch instead of being dropped behind the cursor', async () => {
  const result = plan([sms()]);
  let tray = emptyAlertReviewTray();
  const refused = stageWalletNearMatches(result, () => tray, () => ({ admitted: 0, durable: Promise.resolve() }));
  assert.equal(refused.plan.batch.transactions.length, 1, 'fallback posting before importBatch runs');
  assert.equal(refused.plan.txCount, 1);
  await refused.settle();
  const kept = stageWalletNearMatches(result, () => tray, items => {
    for (const item of items) tray = admitPreparedReviewAlert(tray, item, at + 10 * MIN).state;
    return { admitted: items.length, durable: Promise.resolve() };
  });
  assert.equal(kept.plan.batch.transactions.length, 0);
  assert.equal(kept.admitted, 1);
  await kept.settle();
  assert.throws(() => stageWalletNearMatches(result, () => emptyAlertReviewTray(), undefined), /not kept for Review/);
});

test('a bank-app notification near an unbound Wallet row goes to Review exactly like an SMS', () => {
  const push = sms({ channel: 'push', sourceEventId: undefined, notificationObservationId: '11111111-1111-4111-8111-111111111111' });
  const result = plan([push]);
  assert.equal(result.txCount, 0);
  assert.equal(result.walletNearMatches.length, 1);
  const [near] = result.walletNearMatches;
  assert.equal(near.row, push);
  assert.equal(near.review.channel, 'push');
  assert.equal(canonicalCaptureSourceKey(near.review.sourceKey, near.review.observedAt), `s${push.smsTs}-25000`);
  assert.equal(admitPreparedReviewAlert(emptyAlertReviewTray(), near.review, at + 10 * MIN).outcome, 'admitted');
  // Same rule: other amounts and clocks still post; strict binding still ignores push.
  assert.equal(plan([{ ...push, amountFils: 26000 }]).txCount, 1);
  assert.equal(plan([{ ...push, smsTs: at + 11 * MIN }]).txCount, 1);
  const exact = plan([{ ...push, merchant: 'Carrefour', smsTs: at + 1000 }]);
  assert.ok(!exact.batch.updates.some(u => u.id === 'wallet-confirmed'), 'push never binds automatically');
  assert.equal(exact.walletNearMatches.length, 1);
});

test('Already recorded binds a Message identity to the Wallet row, so a rescan after the tray record expires adds nothing', () => {
  for (const row of [sms(), sms({ sourceEventId: undefined })]) {
    const near = plan([row]).walletNearMatches[0];
    assert.equal(near.review.walletTransactionId, 'wallet-confirmed');
    const tray = admitPreparedReviewAlert(emptyAlertReviewTray(), near.review, at + 10 * MIN).state;
    const before = state([wallet()], { reviewTray: tray });
    const binding = walletDuplicateBinding(before, near.review.id);
    assert.deepEqual({ ...binding }, { id: 'wallet-confirmed', smsKey: near.transaction.smsKey, viaPush: false, walletBound: true });
    // The store's "Already recorded" write: tombstone plus identity-only move.
    const resolved = resolveReviewAlert(tray, near.review.id, 'duplicate', at + 11 * MIN);
    assert.equal(resolved.tombstones.length, 1);
    const written = reduceState({ ...before, trustedNotificationPackages: [] },
      { type: 'setReviewTray', reviewTray: resolved, sourceKeyUpdates: [binding] });
    const bound = written.transactions[0];
    assert.equal(bound.smsKey, binding.smsKey);
    assert.equal(bound.viaPush, false);
    assert.equal(bound.walletBound, true);
    for (const field of ['ts', 'title', 'accountId', 'category', 'date', 'amountFils', 'userEdited', 'titleEdited']) {
      assert.equal(bound[field], wallet()[field], `${field} is preserved (clock and date stay consistent)`);
    }
    // Tray record gone (expired), months later a full rescan re-reads the alert.
    const later = state([bound], { reviewTray: emptyAlertReviewTray() });
    for (const today of [new Date(at + 12 * MIN), new Date(at + 200 * 86_400_000)]) {
      const rescan = plan([row], later, today);
      assert.equal(rescan.txCount, 0, JSON.stringify(row));
      assert.equal(rescan.walletNearMatches.length, 0);
      assert.equal(rescan.batch.transactions.length, 0);
    }
    // A bound row stays in the ten-minute net for the purchase's OTHER alert,
    // including a different-merchant push or another Message within 2 minutes.
    for (const [minutes, merchant, channel] of [[1, 'COSTA COFFEE', 'push'], [1, 'Carrefour', 'push'],
      [3, 'CARREFOUR', 'push'], [7, 'CARREFOUR', 'push'], [9, 'CARREFOUR', 'push'], [1, 'Carrefour', 'inbox']]) {
      const other = sms({ channel, sourceEventId: undefined, merchant, smsTs: at + minutes * MIN + 7 });
      const next = plan([other], later, new Date(at + 12 * MIN));
      assert.equal(next.txCount, 0, `bound Message then ${channel} ${merchant} +${minutes}m`);
      assert.equal(next.walletNearMatches.length, 1, `bound Message then ${channel} ${merchant} +${minutes}m`);
      // Adding that flagged alert asks first, on any account.
      const flagged = next.walletNearMatches[0].review;
      const withReview = { ...later, reviewTray: admitPreparedReviewAlert(emptyAlertReviewTray(), flagged, at + 12 * MIN).state };
      withReview.accounts = [...withReview.accounts, { id: 'plain-card', name: 'Card', kind: 'card', openingFils: 0, color: '#222' }];
      for (const accountId of ['chosen-card', 'plain-card']) {
        const add = extra => planReviewPromotion(withReview, { reviewId: flagged.id, type: 'expense', title: 'X',
          category: 'groceries', accountId, date, betweenOwnAccounts: false,
          universal: { confirmed: true, postingStatus: 'posted', amount: flagged.event.amount.value,
            expectedSourceKey: flagged.sourceKey, expectedObservedAt: flagged.observedAt }, ...extra }, 'tx-x', at + 13 * MIN);
        assert.equal(add().reason, 'possible-duplicate', accountId);
        assert.equal(add({ separatePurchase: { confirmed: true, expectedSourceKey: flagged.sourceKey,
          expectedObservedAt: flagged.observedAt } }).outcome, 'added');
      }
    }
    // Hydration never folds the bound decision into a different same-amount row.
    const other = { ...wallet(), id: 'other', smsKey: `s${at + 30_000}-25000`, ts: at + 30_000, userEdited: false,
      titleEdited: false, viaPush: true, title: 'Card purchase' };
    assert.equal(reconcileCaptureDuplicates([bound, other]).length, 2);
    assert.equal(reconcileCaptureDuplicates([other, bound]).length, 2);
  }
});

test('Already recorded on a notification keeps the Wallet row unbound so the SMS that follows still asks', () => {
  const push = sms({ channel: 'push', sourceEventId: undefined, smsTs: at + MIN });
  const near = plan([push]).walletNearMatches[0];
  const tray = admitPreparedReviewAlert(emptyAlertReviewTray(), near.review, at + 2 * MIN).state;
  assert.equal(walletDuplicateBinding(state([wallet()], { reviewTray: tray }), near.review.id), null,
    'a one-shot notification is never re-read; binding it would hide the Wallet row');
  const resolved = resolveReviewAlert(tray, near.review.id, 'duplicate', at + 3 * MIN);
  for (const minutes of [3, 6, 9]) {
    const next = plan([sms({ smsTs: at + minutes * MIN })], state([wallet()], { reviewTray: resolved }));
    assert.equal(next.txCount, 0, `push then SMS +${minutes}m`);
    assert.equal(next.walletNearMatches.length, 1);
  }
});

test('Already recorded binds only the still-unbound, still-matching Wallet row', () => {
  const near = plan([sms()]).walletNearMatches[0];
  const tray = admitPreparedReviewAlert(emptyAlertReviewTray(), near.review, at + 10 * MIN).state;
  const binding = rows => walletDuplicateBinding(state(rows, { reviewTray: tray }), near.review.id);
  assert.equal(binding([]), null, 'Wallet row deleted');
  assert.equal(binding([wallet({ smsKey: 'h' + 'c'.repeat(64) })]), null, 'already bound to another alert');
  assert.equal(binding([wallet({ amountFils: 26000 })]), null, 'amount edited');
  assert.equal(binding([wallet({ ts: at + 20 * MIN })]), null);
  assert.equal(binding([wallet(), { ...wallet(), id: 'owner', smsKey: near.transaction.smsKey, viaPush: false }]), null,
    'another row already owns this exact alert');
  assert.equal(walletDuplicateBinding(state([wallet()], { reviewTray: tray }), 'missing'), null);
  // Android provider keys carry their own clock; they are never moved onto a Wallet row.
  const android = plan([sms({ sourceEventId: 'a123' })]).walletNearMatches[0];
  const androidTray = admitPreparedReviewAlert(emptyAlertReviewTray(), android.review, at + 10 * MIN).state;
  assert.equal(walletDuplicateBinding(state([wallet()], { reviewTray: androidTray }), android.review.id), null);
});

test('a held-back alert creates no account, learns no card facts and records no balance snapshot', () => {
  const accounts = [{ id: 'chosen-card', name: 'Card', kind: 'card', last4: '4417', openingFils: 0, color: '#000' }];
  const row = sms({ snapshotFils: 1_000_000, snapshotKind: 'limit' });
  const held = plan([row], state([wallet()], { accounts }));
  assert.equal(held.walletNearMatches.length, 1);
  assert.equal(held.newAccountCount, 0);
  assert.deepEqual({ ...held.batch.snapshots }, {});
  assert.deepEqual({ ...held.batch.bankNames }, {});
  assert.deepEqual({ ...held.batch.cardTypes }, {});
  assert.deepEqual({ ...held.batch.newHints }, {});
  // The same alert when it is actually posted still records them.
  const posted = plan([{ ...row, amountFils: 26000 }], state([wallet()], { accounts }));
  assert.equal(posted.txCount, 1);
  assert.ok(Object.keys(posted.batch.snapshots).length > 0);
});

test('the store dismisses with a Wallet binding only for Already recorded', () => {
  const body = storeText.slice(storeText.indexOf('const dismissReviewAlert = useCallback('));
  const handler = body.slice(0, body.indexOf('}, [dispatch, persist]);'));
  assert.match(handler, /outcome === 'duplicate'\s*\?\s*walletDuplicateBinding\(authoritativeState\.current, id\)/);
  assert.match(handler, /sourceKeyUpdates: \[binding\]/);
});

test('strict automatic binding marks the row too, so the other alert of the purchase asks and Add refuses first', () => {
  const strict = sms({ merchant: 'Carrefour', smsTs: at + 1000 });
  const bound = plan([strict]);
  const update = bound.batch.updates.find(u => u.id === 'wallet-confirmed');
  assert.equal(update.walletBound, true);
  const row = applyHealPatch(wallet(), update);
  assert.equal(row.walletBound, true);
  assert.equal(row.title, 'Carrefour');
  const later = state([row]);
  assert.equal(plan([strict], later).txCount, 0, 'the bound Message itself is exact identity');
  const push = sms({ channel: 'push', sourceEventId: undefined, merchant: 'COSTA COFFEE', smsTs: at + 90_000 });
  const next = plan([push], later);
  assert.equal(next.txCount, 0);
  assert.equal(next.walletNearMatches.length, 1);
  const flagged = next.walletNearMatches[0].review;
  const withReview = { ...later, reviewTray: admitPreparedReviewAlert(emptyAlertReviewTray(), flagged, at + 3 * MIN).state };
  const add = planReviewPromotion(withReview, { reviewId: flagged.id, type: 'expense', title: 'Coffee', category: 'groceries',
    accountId: 'chosen-card', date, betweenOwnAccounts: false, universal: { confirmed: true, postingStatus: 'posted',
      amount: flagged.event.amount.value, expectedSourceKey: flagged.sourceKey, expectedObservedAt: flagged.observedAt } },
    'tx-y', at + 4 * MIN);
  assert.equal(add.reason, 'possible-duplicate');
  // Hydration keeps it apart from a different same-amount row.
  const other = { ...wallet(), id: 'other', smsKey: `s${at + 30_000}-25000`, ts: at + 30_000, userEdited: false,
    titleEdited: false, viaPush: true, title: 'Card purchase' };
  assert.equal(reconcileCaptureDuplicates([row, other]).length, 2);
});

test('a held-back alert posted on overflow keeps its account facts and balance snapshot', () => {
  const accounts = [{ id: 'chosen-card', name: 'Card', kind: 'card', last4: '4417', openingFils: 0, color: '#000' }];
  const result = plan([sms({ snapshotFils: 1_000_000, snapshotKind: 'limit' })], state([wallet()], { accounts }));
  assert.deepEqual({ ...result.batch.snapshots }, {});
  const refused = stageWalletNearMatches(result, () => emptyAlertReviewTray(), () => ({ admitted: 0, durable: Promise.resolve() }));
  assert.equal(refused.plan.batch.transactions.length, 1);
  assert.equal(refused.plan.batch.snapshots['chosen-card'].fils, 1_000_000);
  assert.equal(refused.plan.batch.bankNames['chosen-card'], 'ADIB');
  assert.equal(refused.plan.batch.cardTypes['chosen-card'], 'credit');
});

// A bound Wallet row stays out of the loose indexes, but a bank statement row
// for the same purchase must still pair with it one-to-one.
test('a statement row for a bound Wallet purchase is not added a second time', () => {
  const stmt = extra => ({ kind: 'transaction', type: 'expense', amountFils: 25000, currency: 'AED', merchant: 'CARREFOUR MOE DXB',
    date, dueDay: null, minDueFils: null, card: { last4: '4417', kind: 'credit' }, reference: null, transferHint: false,
    snapshotFils: null, snapshotKind: null, categoryGuess: 'groceries', categoryDeliberate: true,
    captureSource: 'pdf', smsTs: Date.parse(`${date}T12:00:00Z`) + 3 * MIN, statementImportId: 'f'.repeat(32), ...extra });
  const bound = wallet({ smsKey: 'h' + 'a'.repeat(64), viaPush: false, walletBound: true,
    captureInstrument: { last4: '4417', kind: 'credit' } });
  for (const [label, row] of [['names the card', stmt()], ['names no account', stmt({ card: null })]]) {
    const result = buildImportPlan([row], state([bound]), 0, new Date(at + 86_400_000));
    assert.equal(result.txCount, 0, `statement that ${label}`);
  }
  // One-to-one: a second genuine statement purchase of the same amount still imports.
  const two = buildImportPlan([stmt(), stmt({ merchant: 'CARREFOUR MOE DXB 2' })], state([bound]), 0, new Date(at + 86_400_000));
  assert.equal(two.txCount, 1);
});

test('a statement row never strictly binds an unbound Wallet row', () => {
  const row = { kind: 'transaction', type: 'expense', amountFils: 25000, currency: 'AED', merchant: 'Carrefour',
    date, categoryGuess: 'groceries', card: { last4: '4417', kind: 'credit' }, bankHint: 'ADIB',
    captureSource: 'pdf', smsTs: at + MIN, statementImportId: 'e'.repeat(32) };
  const result = buildImportPlan([row], state(), 0, new Date(at + 86_400_000));
  assert.ok(!result.batch.updates.some(update => update.id === 'wallet-confirmed' && update.patch?.walletBound),
    'the Wallet row keeps its own identity');
});

test('an expired but unpruned review still counts as the user\'s open decision', () => {
  const row = sms();
  const near = plan([row]).walletNearMatches[0];
  const staged = admitPreparedReviewAlert(emptyAlertReviewTray(), near.review, at + 10 * MIN).state;
  const late = new Date(at + REVIEW_ALERT_TTL_MS + 5 * 86_400_000);
  const result = plan([row], state([wallet()], { reviewTray: staged }), late);
  assert.equal(result.txCount, 0, 'no silent second copy before the tray is pruned');
});
