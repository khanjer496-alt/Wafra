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
  ['market', { market: 'ZZ' }],
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

const crossCurrencyLaunch = normalizeAlertReviewTray({
  schemaVersion: 1,
  pending: [{
    ...stored,
    market: 'AE',
    amount: { currency: 'USD', minorUnits: '1850', exponent: 2 },
    grammar: { ...stored.grammar, provenance: 'launch-registry' },
  }],
  tombstones: [],
}, NOW);
ok('hydration cannot relabel UAE review money as a foreign ledger amount',
  crossCurrencyLaunch.pending.length === 0, JSON.stringify(crossCurrencyLaunch));

// The universal variant stores facts only, including unknown-bank review.
{
  const { prepareUniversalReviewAlert, isUniversalReviewAlert } = require('./build/alert-review-tray.js');
  const { inspectUniversalBankEvent } = require('./build/universal-parser.js');
  const event = () => inspectUniversalBankEvent(
    'Card purchase CAD 24.90 at MAPLE CAFE on 2026-09-05. Available balance CAD 500.00.',
  );
  const make = (over = {}) => prepareUniversalReviewAlert({
    id: ID_A, sourceKey: KEY_A, observedAt: NOW, channel: 'inbox', parserVersion: 32,
    event: event(), ...over,
  });
  const clean = make();
  const pasted = make({ channel: 'paste', id: 'paste_review_00000001', sourceKey: 'paste_source_00000001' });
  const pastedTray = admitPreparedReviewAlert(emptyAlertReviewTray(), pasted, NOW).state;
  const pastedReload = normalizeAlertReviewTray(JSON.parse(JSON.stringify(pastedTray)), NOW + 1);
  ok('user-pasted universal review survives admission and reload with its opaque identity',
    pastedReload.pending[0]?.channel === 'paste' && pastedReload.pending[0]?.sourceKey === pasted.sourceKey);
  ok('paste cannot masquerade as a registered bank channel',
    admitPreparedReviewAlert(emptyAlertReviewTray(), { ...stored, channel: 'paste' }, NOW).outcome === 'refused' &&
    normalizeAlertReviewTray({ ...emptyAlertReviewTray(), pending: [{ ...stored, channel: 'paste' }] }, NOW).pending.length === 0);

  ok('an unregistered currency and bank event has a bounded universal review variant',
    clean && isUniversalReviewAlert(clean) && clean.event.amount.value.currency === 'CAD' &&
    clean.parserVersion === 32 && clean.expiresAt === NOW + REVIEW_ALERT_TTL_MS);
  const injected = event();
  injected.raw = 'PRIVATE_SOURCE';
  injected.sender = 'PRIVATE_SOURCE';
  injected.diagnostics = { text: 'PRIVATE_SOURCE' };
  injected.amount.raw = 'PRIVATE_SOURCE';
  injected.amount.value.excerpt = 'PRIVATE_SOURCE';
  injected.amount.spans = [{ start: 0, end: 5, text: 'PRIVATE_SOURCE' }];
  injected.merchant.issues = ['PRIVATE_SOURCE'];
  injected.observations[0].raw = 'PRIVATE_SOURCE';
  const sanitized = make({ event: injected });
  ok('universal constructor strips source text and nested diagnostics/coordinates',
    sanitized && !JSON.stringify(sanitized).includes('PRIVATE_SOURCE') &&
    sanitized.event.amount.spans.length === 0 && sanitized.event.merchant.issues.length === 0);
  injected.amount.value.minorUnits = '99999';
  ok('constructor copies money facts instead of retaining mutable parser references',
    sanitized.event.amount.value.minorUnits === '2490');
  const entered = admitPreparedReviewAlert(emptyAlertReviewTray(), {
    ...clean, raw: 'PRIVATE_SOURCE', templateKey: 'PRIVATE_SOURCE',
    event: { ...clean.event, excerpt: 'PRIVATE_SOURCE' },
  }, NOW);
  ok('admission reconstructs universal facts and drops template-learning metadata',
    entered.outcome === 'admitted' && !JSON.stringify(entered.state).includes('PRIVATE_SOURCE'));
  const reload = normalizeAlertReviewTray(JSON.parse(JSON.stringify({
    ...entered.state, pending: [{ ...entered.state.pending[0], raw: 'PRIVATE_SOURCE' }],
  })), NOW + 1);
  ok('reload preserves exact universal facts and removes injected unknown properties',
    reload.pending.length === 1 && reload.pending[0].kind === 'universal' &&
    reload.pending[0].event.amount.value.minorUnits === '2490' &&
    !JSON.stringify(reload).includes('PRIVATE_SOURCE'));
  const admittedRegistered = admitPreparedReviewAlert(emptyAlertReviewTray(), {
    ...stored, raw: 'PRIVATE_SOURCE', grammar: { ...stored.grammar, raw: 'PRIVATE_SOURCE' },
    amount: { ...stored.amount, raw: 'PRIVATE_SOURCE' },
    instrument: { kind: 'card', last4: '1234', raw: 'PRIVATE_SOURCE' },
  }, NOW);
  ok('registered admission also strips unknown nested source properties',
    admittedRegistered.outcome === 'admitted' && !JSON.stringify(admittedRegistered.state).includes('PRIVATE_SOURCE'));
  const registeredReload = normalizeAlertReviewTray({ ...admittedRegistered.state,
    tombstones: [{ sourceKey: KEY_B, resolvedAt: NOW, expiresAt: NOW + 1000,
      outcome: 'dismissed', raw: 'PRIVATE_SOURCE' }],
  }, NOW);
  ok('hydration reconstructs tombstones without arbitrary source fields',
    !JSON.stringify(registeredReload).includes('PRIVATE_SOURCE'));

  for (const [label, mutate] of [
    ['family enum', (e) => { e.family = 'user-secret'; }],
    ['posting enum', (e) => { e.status = 'approved'; }],
    ['event version', (e) => { e.version = 2; }],
    ['ignored event', (e) => { e.decision = 'ignore'; }],
    ['failed posting', (e) => { e.status = 'failed'; }],
    ['no monetary facts', (e) => {
      for (const name of ['amount', 'statementTotal', 'minimumDue', 'balance', 'creditLimit']) {
        e[name] = { value: null, evidence: 'missing', alternatives: [], spans: [], issues: [] };
      }
      e.observations = [];
    }],
    ['money exponent', (e) => { e.amount.value.exponent = 3; }],
    ['money precision', (e) => { e.amount.value.minorUnits = '24.90'; }],
    ['money object', (e) => { e.amount.value = 'PRIVATE_SOURCE'; }],
    ['date validity', (e) => { e.transactionDate.value = '2026-02-30'; }],
    ['title control characters', (e) => { e.merchant.value = 'MAPLE\nSECRET'; }],
    ['full instrument', (e) => { e.instrument = { value: { kind: 'card', last4: '4111111111111234' },
      evidence: 'explicit', alternatives: [], spans: [], issues: [] }; }],
    ['field evidence conflict', (e) => { e.amount.evidence = 'missing'; }],
    ['alternative cap', (e) => { e.amount.alternatives = Array(17).fill(e.amount.value); }],
    ['observation cap', (e) => { e.observations = Array(33).fill(e.observations[0]); }],
  ]) {
    const unsafe = event(); mutate(unsafe);
    ok(`universal malformed ${label} fails closed at construction`, make({ event: unsafe }) === null);
    const hydrated = normalizeAlertReviewTray({ schemaVersion: 1,
      pending: [{ ...clean, event: unsafe }], tombstones: [] }, NOW);
    ok(`universal malformed ${label} fails closed after reload`, hydrated.pending.length === 0);
  }
  ok('universal bad observation times fail closed', make({ observedAt: -1 }) === null &&
    make({ observedAt: NaN }) === null && make({ observedAt: Number.MAX_SAFE_INTEGER }) === null);
  ok('universal evidence expires at the existing thirty-day boundary',
    pruneAlertReviewTray(entered.state, clean.expiresAt).pending.length === 0);
  ok('an excessive runtime expiry cannot bypass review retention',
    admitPreparedReviewAlert(emptyAlertReviewTray(), { ...clean, expiresAt: NOW + REVIEW_ALERT_TTL_MS + 1 }, NOW).outcome === 'refused');
  ok('old history retains existing discovery-time review TTL',
    admitPreparedReviewAlert(emptyAlertReviewTray(), {
      ...clean, observedAt: NOW - 365 * 86400000, expiresAt: NOW + REVIEW_ALERT_TTL_MS,
    }, NOW).outcome === 'admitted');
  ok('same pending id cannot be rebound to another source',
    admitPreparedReviewAlert(entered.state, { ...clean, sourceKey: KEY_B }, NOW).outcome === 'refused');
  ok('same pending id cannot be rebound to a different observed time',
    admitPreparedReviewAlert(entered.state, { ...clean, observedAt: NOW - 1 }, NOW).outcome === 'refused');
  const apple = { ...clean, sourceKey: 'apple_message_review_source_' + 'a'.repeat(64) };
  const resolved = resolveReviewAlert(admitPreparedReviewAlert(emptyAlertReviewTray(), apple, NOW).state,
    apple.id, 'dismissed', NOW + 1);
  ok('canonical native identity cannot bypass a universal dismissal tombstone',
    admitPreparedReviewAlert(resolved, { ...apple, id: ID_B, sourceKey: 'h' + 'a'.repeat(64) }, NOW + 2).outcome === 'duplicate');
  const recoveredDismissal = normalizeAlertReviewTray({ schemaVersion: 1,
    pending: [apple], tombstones: [{ sourceKey: 'h' + 'a'.repeat(64), resolvedAt: NOW,
      expiresAt: NOW + 1000, outcome: 'dismissed' }],
  }, NOW + 1);
  ok('reload removes pending aliases already covered by a canonical dismissal tombstone',
    recoveredDismissal.pending.length === 0);
  const expiredDismissal = normalizeAlertReviewTray({ schemaVersion: 1,
    pending: [apple], tombstones: [{ sourceKey: 'h' + 'a'.repeat(64), resolvedAt: NOW - 2000,
      expiresAt: NOW - 1000, outcome: 'dismissed' }],
  }, NOW + 1);
  ok('an expired tombstone does not suppress a newly retained review on reload',
    expiredDismissal.pending.length === 1);
  const longTitleEvent = event();
  longTitleEvent.merchant.value = 'M'.repeat(96);
  const longTitleItem = make({ event: longTitleEvent });
  ok('a bounded ninety-six-character merchant suggestion preserves good money for review',
    longTitleItem?.event.merchant.value.length === 96 &&
    longTitleItem.event.amount.value.minorUnits === '2490');
  longTitleEvent.merchant.value += 'M';
  ok('a merchant suggestion beyond the extractor bound is refused', make({ event: longTitleEvent }) === null);
  let capped = emptyAlertReviewTray();
  for (let index = 0; index < 55; index++) {
    capped = admitPreparedReviewAlert(capped, { ...clean, id: `bounded_review_id_${index}`,
      sourceKey: `bounded_source_key_${index}`, observedAt: NOW + index }, NOW + 60).state;
  }
  ok('the universal variant shares the existing fifty-item pending cap', capped.pending.length === 50);
}

// Short Android canonical source keys are identities, never shortened review IDs.
{
  const canonical = `ha123t${stored.observedAt}`;
  const closed = normalizeAlertReviewTray({ ...emptyAlertReviewTray(),
    pending: [{ ...stored, sourceKey: 'android_message_review_source_a123' }],
    tombstones: [{ sourceKey: canonical, resolvedAt: NOW, expiresAt: NOW + 1000, outcome: 'dismissed' }],
  }, NOW + 1);
  ok('timestamp-bound Android dismissal survives hydration and suppresses a pending alias',
    closed.pending.length === 0 && closed.tombstones[0]?.sourceKey === canonical);
  ok('a retained timestamp-bound Android dismissal suppresses native review reimport',
    admitPreparedReviewAlert(closed, { ...stored, sourceKey: 'android_message_review_source_a123' }, NOW + 2).outcome === 'duplicate');
  ok('canonical Android source keys can be retained without weakening review ids',
    admitPreparedReviewAlert(emptyAlertReviewTray(), { ...stored, sourceKey: canonical }, NOW).outcome === 'admitted' &&
    admitPreparedReviewAlert(emptyAlertReviewTray(), { ...stored, id: 'ha123' }, NOW).outcome === 'refused' &&
    admitPreparedReviewAlert(emptyAlertReviewTray(), { ...stored, templateKey: 'ha123' }, NOW).outcome === 'refused');
  for (const key of ['ha00123', 'ha' + '1'.repeat(41), 'ha12.3', 'ha-123', 'ha123garbage']) {
    const restored = normalizeAlertReviewTray({ ...emptyAlertReviewTray(),
      tombstones: [{ sourceKey: key, resolvedAt: NOW, expiresAt: NOW + 1000, outcome: 'dismissed' }],
    }, NOW);
    ok(`malformed reserved Android source ${key} fails closed`, restored.tombstones.length === 0);
  }
}

console.log(`\nalert-review-tray: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
