const {
  REVIEW_ALERT_TTL_MS,
  admitPreparedReviewAlert,
  admitReviewAlert,
  emptyAlertReviewTray,
  normalizeAlertReviewTray,
  pruneAlertReviewTray,
  resolveReviewAlert,
} = require('./build/alert-review-tray.js');
const { inspectUniversalAlert } = require('./build/alert-market-detection.js');

let pass = 0;
let fail = 0;
const ok = (name, condition, detail) => {
  if (condition) { pass += 1; console.log(`✓ ${name}`); }
  else { fail += 1; console.log(`✗ ${name}`, detail ?? ''); }
};
const NOW = Date.UTC(2026, 7, 11, 12, 0, 0);
const KEY_A = 'opaque_source_key_A0001';
const KEY_B = 'opaque_source_key_B0002';
const ID_A = 'opaque_review_id_A00001';
const ID_B = 'opaque_review_id_B00002';
const inspect = (source, sender = 'CHASE') => inspectUniversalAlert({ source, sender, regionHint: 'US' });
const input = (source, over = {}) => ({
  id: ID_A, sourceKey: KEY_A, observedAt: NOW, channel: 'inbox',
  inspection: inspect(source), ...over,
});

const purchase = input('Chase Bank: Card purchase USD 18.50 at TARGET completed');
const admitted = admitReviewAlert(emptyAlertReviewTray(), purchase);
ok('a posted exact institution-backed purchase is admitted',
  admitted.outcome === 'admitted' && admitted.state.pending.length === 1,
  JSON.stringify(admitted));
const stored = admitted.state.pending[0];
ok('review item stores exact exponent-aware money without raw source',
  stored.amount.currency === 'USD' && stored.amount.minorUnits === '1850' &&
    stored.amount.exponent === 2 && stored.grammar.status === 'experimental' &&
    !JSON.stringify(stored).includes('TARGET'), JSON.stringify(stored));

for (const [name, source] of [
  ['OTP', 'Chase Bank: OTP 123456 for USD 18.50'],
  ['failed', 'Chase Bank: Card purchase USD 18.50 declined'],
  ['future', 'Chase Bank: Card will be charged USD 18.50 tomorrow'],
  ['balance', 'Chase Bank: Available balance USD 18.50'],
]) {
  const result = admitReviewAlert(emptyAlertReviewTray(), input(source));
  ok(`${name} evidence never enters the tray`, result.outcome === 'refused', JSON.stringify(result));
}

const exactAgain = admitReviewAlert(admitted.state, purchase);
ok('exact source retries are idempotent',
  exactAgain.outcome === 'duplicate' && exactAgain.state.pending.length === 1);

const equalButDistinct = admitReviewAlert(admitted.state, input(
  'Chase Bank: Card purchase USD 18.50 at TARGET completed',
  { id: ID_B, sourceKey: KEY_B, observedAt: NOW + 30_000 },
));
ok('distinct equal purchases are not silently discarded by a weak semantic match',
  equalButDistinct.outcome === 'admitted' && equalButDistinct.state.pending.length === 2);

const beneficiaryOnly = admitReviewAlert(emptyAlertReviewTray(), {
  ...input('INR 500 debited through UPI transfer to HDFC Bank', {
    inspection: inspectUniversalAlert({
      source: 'INR 500 debited through UPI transfer to HDFC Bank',
      sender: 'VM-UNKNOWN-T',
      regionHint: 'IN',
    }),
  }),
});
ok('a beneficiary bank named only in the body cannot create review evidence',
  beneficiaryOnly.outcome === 'refused', JSON.stringify(beneficiaryOnly));

const promotionalIndia = admitReviewAlert(emptyAlertReviewTray(), {
  ...input('HDFC Bank: Card purchase INR 999 completed. Get cashback.', {
    inspection: inspectUniversalAlert({
      source: 'HDFC Bank: Card purchase INR 999 completed. Get cashback.',
      sender: 'VM-HDFCBK-P',
      regionHint: 'IN',
    }),
  }),
});
ok('a promotional Indian sender route cannot create review evidence',
  promotionalIndia.outcome === 'refused', JSON.stringify(promotionalIndia));

const dismissed = resolveReviewAlert(admitted.state, ID_A, 'dismissed', NOW + 60_000);
ok('dismissal deletes pending evidence and leaves only an opaque tombstone',
  dismissed.pending.length === 0 && dismissed.tombstones[0]?.sourceKey === KEY_A &&
    !JSON.stringify(dismissed).includes('TARGET'), JSON.stringify(dismissed));
const afterDismiss = admitReviewAlert(dismissed, purchase);
ok('a dismissed source cannot reappear on rescan', afterDismiss.outcome === 'duplicate');

const expired = pruneAlertReviewTray(admitted.state, NOW + REVIEW_ALERT_TTL_MS + 1);
ok('pending review evidence expires automatically', expired.pending.length === 0);
ok('an already-expired historical candidate is not re-admitted',
  admitPreparedReviewAlert(
    emptyAlertReviewTray(),
    stored,
    stored.expiresAt + 1,
  ).outcome === 'refused');

const malformed = normalizeAlertReviewTray({ schemaVersion: 1, pending: [{ raw: 'secret' }], tombstones: [] }, NOW);
ok('hydration drops malformed or raw-only review records', malformed.pending.length === 0);

for (const [name, mutation] of [
  ['market', { market: 'AE' }],
  ['channel', { channel: 'unknown' }],
  ['currency', { amount: { ...stored.amount, currency: 'usd' } }],
  ['direction', { direction: 'none' }],
  ['family', { family: 'authentication' }],
  ['grammar', { grammar: { ...stored.grammar, status: 'trusted' } }],
  ['instrument', { instrument: { kind: 'card', last4: '12345' } }],
]) {
  const normalized = normalizeAlertReviewTray({
    schemaVersion: 1,
    pending: [{ ...stored, ...mutation }],
    tombstones: [],
  }, NOW);
  ok(`hydration rejects malformed ${name} evidence before it can become money`,
    normalized.pending.length === 0, JSON.stringify(normalized));
}

console.log(`\nalert-review-tray: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
