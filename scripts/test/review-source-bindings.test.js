const {
  collectLegacyReviewSourceKeys, reconcileReviewSourceBindings,
} = require('./build/review-source-bindings.js');
const {
  emptyAlertReviewTray, prepareUniversalReviewAlert, admitPreparedReviewAlert,
} = require('./build/alert-review-tray.js');
const { inspectUniversalBankEvent } = require('./build/universal-parser.js');
let pass = 0, fail = 0;
const ok = (name, value) => {
  if (value) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}`); }
};
const NOW = Date.UTC(2026, 8, 5, 12);
const digest = 'a'.repeat(64);
const legacyId = `ari1_${digest}`;
const legacySourceKey = `arc1_${digest}`;
const tuple = (provider = '123', overrides = {}) => ({
  legacyId, legacySourceKey, id: `ari1_${(provider === '123' ? 'b' : 'c').repeat(64)}`,
  sourceKey: `android_message_review_source_a${provider}`, observedAt: NOW, ...overrides,
});
const pending = () => prepareUniversalReviewAlert({
  id: legacyId, sourceKey: legacySourceKey, observedAt: NOW, channel: 'inbox',
  event: inspectUniversalBankEvent('Card purchase CAD 24.90 at MAPLE CAFE on 2026-09-05.'),
});
const state = (overrides = {}) => ({
  reviewTray: { ...emptyAlertReviewTray(), pending: [pending()] },
  transactions: [], ...overrides,
});
{
  const base = state();
  const before = JSON.stringify(base);
  const result = reconcileReviewSourceBindings(base, [tuple()], NOW);
  const updated = result.reviewTray.pending[0];
  ok('a matching pending legacy occurrence gets its native identity', result.changed &&
    updated.id === tuple().id && updated.sourceKey === tuple().sourceKey);
  ok('pending rekey preserves all event facts and retention times',
    JSON.stringify(updated.event) === JSON.stringify(base.reviewTray.pending[0].event) &&
    updated.observedAt === NOW && updated.expiresAt === base.reviewTray.pending[0].expiresAt);
  ok('pending rekey creates no financial updates', result.transactionKeyUpdates.length === 0);
  ok('reconciliation never mutates its input state', JSON.stringify(base) === before);
  ok('replaying the same binding after rekey is a no-op',
    !reconcileReviewSourceBindings({ ...base, reviewTray: result.reviewTray }, [tuple()], NOW).changed);
}
{
  const tombstone = { sourceKey: legacySourceKey, resolvedAt: NOW - 1000,
    expiresAt: NOW + 10000, outcome: 'dismissed' };
  const base = state({ reviewTray: { ...emptyAlertReviewTray(), pending: [], tombstones: [tombstone] } });
  const result = reconcileReviewSourceBindings(base, [tuple()], NOW);
  ok('a closed legacy occurrence rekeys its tombstone with outcome and TTL intact',
    result.changed && result.reviewTray.tombstones[0].sourceKey === `ha123t${NOW}` &&
    result.reviewTray.tombstones[0].expiresAt === tombstone.expiresAt &&
    result.reviewTray.tombstones[0].outcome === 'dismissed');
  const native = { ...pending(), id: tuple().id, sourceKey: tuple().sourceKey };
  ok('native reread cannot revive the rekeyed dismissed occurrence',
    admitPreparedReviewAlert(result.reviewTray, native, NOW).outcome === 'duplicate');
  const withCanonicalDismissal = state({ reviewTray: { ...emptyAlertReviewTray(),
    pending: [pending()], tombstones: [{ ...tombstone, sourceKey: `ha123t${NOW}` }] } });
  const suppressed = reconcileReviewSourceBindings(withCanonicalDismissal, [tuple()], NOW);
  ok('canonical existing dismissal remains effective after legacy pending rekey',
    suppressed.changed && suppressed.reviewTray.pending.length === 0);
}
{
  const transaction = { id: 'confirmed-review', smsKey: legacySourceKey, source: 'sms',
    amountFils: 2490, type: 'expense', title: 'Edited merchant', category: 'dining',
    accountId: 'selected-account', date: '2026-09-04', ts: NOW, userEdited: true,
    titleEdited: true, note: 'Keep this note', splits: [{ category: 'dining', amountFils: 2490 }] };
  const base = state({ reviewTray: emptyAlertReviewTray(), transactions: [transaction] });
  const before = JSON.stringify(base);
  const result = reconcileReviewSourceBindings(base, [tuple()], NOW);
  ok('confirmed review emits only a canonical transaction-key patch', result.changed &&
    JSON.stringify(result.transactionKeyUpdates) === JSON.stringify([{ id: transaction.id, smsKey: `ha123t${NOW}` }]));
  const patched = { ...transaction, ...result.transactionKeyUpdates[0] };
  const { smsKey: _before, ...originalFields } = transaction;
  const { smsKey: _after, ...patchedFields } = patched;
  ok('money, date, account, edits, notes and split fields remain unchanged',
    JSON.stringify(originalFields) === JSON.stringify(patchedFields));
  ok('confirmed source update never mutates the stored transaction', JSON.stringify(base) === before);
  const occupied = { ...base, transactions: [...base.transactions, { id: 'already-native', smsKey: `ha123t${NOW}`, ts: NOW }] };
  ok('reconciliation cannot collapse two existing confirmed occurrences onto one source',
    !reconcileReviewSourceBindings(occupied, [tuple()], NOW).changed);
}
{
  const low = tuple('2', { id: `ari1_${'d'.repeat(64)}` });
  const high = tuple('10', { id: `ari1_${'e'.repeat(64)}` });
  const base = state();
  const forward = reconcileReviewSourceBindings(base, [high, low], NOW);
  const reverse = reconcileReviewSourceBindings(base, [low, high], NOW);
  ok('native twins choose lowest numeric provider ID, not lexicographic order',
    forward.reviewTray.pending[0].sourceKey === low.sourceKey);
  ok('native twin selection is deterministic across input order',
    JSON.stringify(forward) === JSON.stringify(reverse));
  const otherNative = { ...pending(), id: high.id, sourceKey: high.sourceKey };
  const independent = admitPreparedReviewAlert(forward.reviewTray, otherNative, NOW);
  ok('the second byte-identical native occurrence remains independently reviewable',
    independent.outcome === 'admitted' && independent.state.pending.length === 2);
  const closed = state({ reviewTray: { ...emptyAlertReviewTray(), pending: [], tombstones: [{
    sourceKey: legacySourceKey, resolvedAt: NOW, expiresAt: NOW + 1000, outcome: 'dismissed',
  }] } });
  const twinDismissal = reconcileReviewSourceBindings(closed, [high, low], NOW);
  ok('one old dismissal cannot dismiss both byte-identical native twins',
    admitPreparedReviewAlert(twinDismissal.reviewTray, otherNative, NOW).outcome === 'admitted');
}
for (const [name, value] of [
  ['extra raw properties', { ...tuple(), raw: 'PRIVATE_SOURCE' }],
  ['wrong legacy id', tuple('123', { legacyId: `ari1_${'f'.repeat(64)}` })],
  ['same new and old id', tuple('123', { id: legacyId })],
  ['malformed legacy hash', tuple('123', { legacySourceKey: 'arc1_short' })],
  ['unbound new id', tuple('123', { id: 'arbitrary_new_id_123' })],
  ['non-native source', tuple('123', { sourceKey: 'opaque_source_123456' })],
  ['decimal provider id', tuple('1.2')],
  ['noncanonical provider id', tuple('00123')],
  ['negative observation', tuple('123', { observedAt: -1 })],
  ['invalid observation', tuple('123', { observedAt: NaN })],
  ['changed observation', tuple('123', { observedAt: NOW + 1 })],
]) {
  ok(`${name} cannot attest a rebind`, !reconcileReviewSourceBindings(state(), [value], NOW).changed);
}
{
  const base = state();
  const absent = tuple('123', { legacyId: `ari1_${'f'.repeat(64)}`,
    legacySourceKey: `arc1_${'f'.repeat(64)}` });
  ok('an unmatched attestation makes no changes', !reconcileReviewSourceBindings(base, [absent], NOW).changed);
  ok('empty attestation input returns the original tray unchanged',
    reconcileReviewSourceBindings(base, [], NOW).reviewTray === base.reviewTray);
  const conflicts = [tuple(), tuple('123', { id: `ari1_${'d'.repeat(64)}` })];
  ok('two different identities claiming one provider occurrence fail closed',
    !reconcileReviewSourceBindings(base, conflicts, NOW).changed);
  ok('contradictory observed times for one legacy hash fail closed',
    !reconcileReviewSourceBindings(base, [tuple(), tuple('2', { observedAt: NOW + 1 })], NOW).changed);
  const occupied = state({ reviewTray: { ...emptyAlertReviewTray(), pending: [pending(),
    { ...pending(), id: tuple().id, sourceKey: tuple().sourceKey }] } });
  ok('a pending native identity already occupied cannot be overwritten',
    !reconcileReviewSourceBindings(occupied, [tuple()], NOW).changed);
  const wrongLegacyId = state({ reviewTray: { ...emptyAlertReviewTray(),
    pending: [{ ...pending(), id: `ari1_${'f'.repeat(64)}` }] } });
  ok('source key alone cannot rebind a different pending review id',
    !reconcileReviewSourceBindings(wrongLegacyId, [tuple()], NOW).changed);
  const secondHash = `arc1_${'f'.repeat(64)}`;
  const twoOld = state({ transactions: [{ id: 'other-old', smsKey: secondHash }] });
  ok('different legacy occurrences cannot bind many-to-one to a native source',
    !reconcileReviewSourceBindings(twoOld, [tuple(), tuple('123', {
      legacyId: `ari1_${'f'.repeat(64)}`, legacySourceKey: secondHash,
    })], NOW).changed);
}
{
  const base = state({ transactions: [{ id: 'confirmed', smsKey: legacySourceKey },
    { id: 'short', smsKey: 'arc1_not-a-hash' }, { id: 'native', smsKey: `ha123t${NOW}` }],
    reviewTray: { ...emptyAlertReviewTray(), pending: [pending()], tombstones: [
      { sourceKey: `arc1_${'f'.repeat(64)}`, resolvedAt: NOW, expiresAt: NOW + 1000, outcome: 'added' },
    ] },
  });
  ok('capture receives only unique valid legacy source keys across all three stores',
    JSON.stringify(collectLegacyReviewSourceKeys(base)) ===
    JSON.stringify([legacySourceKey, `arc1_${'f'.repeat(64)}`]));
}
{
  const later = tuple('123', { legacyId: `ari1_${'f'.repeat(64)}`, legacySourceKey: `arc1_${'f'.repeat(64)}`,
    id: `ari1_${'e'.repeat(64)}`, observedAt: NOW + 1000 });
  const base = state({ reviewTray: { ...emptyAlertReviewTray(), pending: [pending(),
    { ...pending(), id: later.legacyId, sourceKey: later.legacySourceKey, observedAt: later.observedAt }] } });
  const result = reconcileReviewSourceBindings(base, [tuple(), later], NOW + 1000);
  ok('two independently attested occurrences can reuse one provider ID at different original times',
    result.changed && result.reviewTray.pending.length === 2 &&
    result.reviewTray.pending.some(item=>item.id===tuple().id) &&
    result.reviewTray.pending.some(item=>item.id===later.id));
  const existing = state({ transactions: [{id:'other-phone',smsKey:'ha123',ts:NOW-1000}] });
  ok('a restored native ID at another original time cannot block exact legacy rebind',
    reconcileReviewSourceBindings(existing,[tuple()],NOW).changed);
}
console.log(`\nreview-source-bindings: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
