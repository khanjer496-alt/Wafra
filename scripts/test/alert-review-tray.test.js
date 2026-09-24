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

{
  const tray = require('./build/alert-review-tray.js');
  const DAY = 24 * 60 * 60 * 1000;
  // M1: an unresolved review that ages out is recorded, never silently lost.
  const aged = pruneAlertReviewTray(admitted.state, stored.expiresAt + 1);
  const expiredTombstones = aged.tombstones.filter((item) => item.outcome === 'expired');
  ok('an expired pending review leaves one source-free expired tombstone dated at its expiry',
    aged.pending.length === 0 && expiredTombstones.length === 1 &&
      expiredTombstones[0].resolvedAt === stored.expiresAt &&
      JSON.stringify(Object.keys(expiredTombstones[0]).sort()) ===
        JSON.stringify(['expiresAt', 'outcome', 'resolvedAt', 'sourceKey']),
    JSON.stringify(aged.tombstones));
  ok('expired reviews are counted for the Review surface',
    tray.recentlyExpiredReviewCount(aged, stored.expiresAt + 1) === 1 &&
      tray.recentlyExpiredReviewCount(aged, stored.expiresAt + REVIEW_ALERT_TTL_MS + 1) === 0 &&
      tray.recentlyExpiredReviewCount(emptyAlertReviewTray(), NOW) === 0);
  const raw = JSON.parse(JSON.stringify(admitted.state));
  const firstLoad = normalizeAlertReviewTray(raw, stored.expiresAt + 5);
  const secondLoad = normalizeAlertReviewTray(firstLoad, stored.expiresAt + 10);
  const reloadUnsaved = normalizeAlertReviewTray(raw, stored.expiresAt + 10);
  ok('repeated hydration and re-pruning count one expiry exactly once',
    firstLoad.tombstones.filter((item) => item.outcome === 'expired').length === 1 &&
      secondLoad.tombstones.filter((item) => item.outcome === 'expired').length === 1 &&
      JSON.stringify(reloadUnsaved.tombstones) === JSON.stringify(firstLoad.tombstones),
    JSON.stringify({ firstLoad: firstLoad.tombstones, secondLoad: secondLoad.tombstones }));
  ok('an expired tombstone survives hydration validation',
    normalizeAlertReviewTray({ ...emptyAlertReviewTray(), tombstones: expiredTombstones },
      stored.expiresAt + 1).tombstones.length === 1);
  ok('an expired review cannot be re-admitted after its tombstone',
    admitPreparedReviewAlert(aged, stored, stored.expiresAt - 1).outcome !== 'admitted');
  ok('an item expired longer ago than the tombstone window leaves no tombstone',
    pruneAlertReviewTray(admitted.state, stored.expiresAt + 91 * DAY).tombstones.length === 0);

  ok('rows show days left only in the final week and never a zero or negative count',
    tray.reviewExpiresInDays({ expiresAt: NOW + 8 * DAY }, NOW) === null &&
      tray.reviewExpiresInDays({ expiresAt: NOW + 7 * DAY }, NOW) === 7 &&
      tray.reviewExpiresInDays({ expiresAt: NOW + 1 }, NOW) === 1 &&
      tray.reviewExpiresInDays({ expiresAt: NOW }, NOW) === null);

  // M2: iOS local capture can leave its record queued instead of evicting.
  const legacyFiller = (index) => ({ ...stored,
    id: `legacy_review_id_${String(index).padStart(8, '0')}`,
    sourceKey: `legacy_review_source_${String(index).padStart(8, '0')}`,
    observedAt: NOW + index, expiresAt: NOW + index + REVIEW_ALERT_TTL_MS });
  const fullLegacy = { ...emptyAlertReviewTray(),
    pending: Array.from({ length: tray.REVIEW_ALERT_CAP }, (_, index) => legacyFiller(index)) };
  const incoming = legacyFiller(500);
  const duplicate = legacyFiller(3);
  const partition = tray.partitionReviewsByCapacity(fullLegacy, [duplicate, incoming], NOW + 1000);
  ok('a full legacy lane defers a new review instead of evicting and passes duplicates through',
    partition.deferred.length === 1 && partition.deferred[0] === incoming &&
      partition.admit.length === 1 && partition.admit[0] === duplicate,
    JSON.stringify({ admit: partition.admit.map((item) => item.id), deferred: partition.deferred.map((item) => item.id) }));
  const roomy = { ...fullLegacy, pending: fullLegacy.pending.slice(1) };
  const fill = tray.partitionReviewsByCapacity(roomy, [incoming, legacyFiller(501)], NOW + 1000);
  ok('backpressure admits exactly the remaining room in order',
    fill.admit.length === 1 && fill.admit[0] === incoming && fill.deferred.length === 1);
  const protectedItem = { ...stored, channel: 'push',
    id: 'local_review_id_' + 'a'.repeat(32), sourceKey: 'local_review_source_' + 'a'.repeat(32) };
  ok('protected iOS reviews bypass legacy backpressure (admission refuses them itself)',
    tray.partitionReviewsByCapacity(fullLegacy, [protectedItem], NOW + 1000).admit.length === 1);
  ok('capacity reports each lane independently',
    tray.reviewTrayCapacity(fullLegacy, NOW + 1000).legacyFull === true &&
      tray.reviewTrayCapacity(fullLegacy, NOW + 1000).protectedFull === false &&
      tray.reviewTrayCapacity(roomy, NOW + 1000).legacyFull === false &&
      tray.reviewTrayCapacity({ pending: [] }, NOW).protectedFull === false);

  const informational = (index) => ({ kind: 'universal',
    id: `info_review_id_${String(index).padStart(8, '0')}`,
    sourceKey: `info_review_source_${String(index).padStart(8, '0')}`,
    observedAt: NOW + index, expiresAt: NOW + index + REVIEW_ALERT_TTL_MS, channel: 'inbox',
    parserVersion: 1, event: { family: 'balance', status: 'informational' } });
  ok('money movement is registered or an ordinary posted/unknown universal family',
    tray.isMoneyMovementReview(stored) &&
      !tray.isMoneyMovementReview(informational(1)) &&
      tray.isMoneyMovementReview({ ...informational(1), event: { family: 'purchase', status: 'posted' } }) &&
      !tray.isMoneyMovementReview({ ...informational(1), event: { family: 'purchase', status: 'future' } }) &&
      !tray.isMoneyMovementReview({ ...informational(1), event: undefined }));
  const mixed = pruneAlertReviewTray({ ...emptyAlertReviewTray(), pending: [
    informational(900), ...Array.from({ length: 50 }, (_, index) => legacyFiller(index)),
  ] }, NOW + 1000);
  ok('legacy overflow evicts an informational review before an older money movement',
    mixed.pending.length === 50 && !mixed.pending.some((item) => item.id === informational(900).id) &&
      mixed.pending.some((item) => item.id === legacyFiller(0).id));
  ok('a new informational review never waits, even behind fifty money movements',
    tray.partitionReviewsByCapacity(fullLegacy, [informational(700)], NOW + 1000).deferred.length === 0);
  const infoFull = { ...emptyAlertReviewTray(),
    pending: Array.from({ length: 50 }, (_, index) => informational(index)) };
  const overInfo = tray.partitionReviewsByCapacity(infoFull, [incoming], NOW + 1000);
  ok('a money movement is admitted by evicting an informational review instead of waiting',
    overInfo.deferred.length === 0 && overInfo.admit[0] === incoming);

  // Gap B: callers without backpressure (relay, History, Android) still evict
  // at the legacy cap. A money movement may never vanish without a trace.
  const overflow = admitPreparedReviewAlert(fullLegacy, incoming, NOW + 1000);
  const evictedTombstones = overflow.state.tombstones.filter((item) => item.outcome === 'evicted');
  ok('evicting a money review from the Message lane records a durable evicted tombstone',
    overflow.outcome === 'admitted' && overflow.state.pending.length === 50 &&
      !overflow.state.pending.some((item) => item.id === legacyFiller(0).id) &&
      evictedTombstones.length === 1 && evictedTombstones[0].sourceKey === legacyFiller(0).sourceKey &&
      tray.recentlyLostReviewCount(overflow.state, NOW + 1000, 'evicted') === 1,
    JSON.stringify(overflow.state.tombstones));
  const reread = admitPreparedReviewAlert(overflow.state, legacyFiller(0), NOW + 2000);
  ok('re-reading an evicted review into a still-full lane never counts it twice',
    tray.recentlyLostReviewCount(reread.state, NOW + 2000, 'evicted') === 1 &&
      tray.recentlyLostReviewCount(pruneAlertReviewTray(overflow.state, NOW + 3000), NOW + 3000, 'evicted') === 1,
    JSON.stringify(reread.state.tombstones));
  const roomAgain = resolveReviewAlert(overflow.state, legacyFiller(10).id, 'dismissed', NOW + 2000);
  const recovered = admitPreparedReviewAlert(roomAgain, legacyFiller(0), NOW + 2500);
  ok('a re-read evicted review is recovered once Review has room and its loss record is retired',
    recovered.outcome === 'admitted' && recovered.state.pending.some((item) => item.id === legacyFiller(0).id) &&
      tray.recentlyLostReviewCount(recovered.state, NOW + 2500, 'evicted') === 0,
    JSON.stringify(recovered.state.tombstones));
  ok('callers cannot record a loss outcome as a user decision',
    JSON.stringify(resolveReviewAlert(fullLegacy, legacyFiller(1).id, 'evicted', NOW + 1000)) ===
      JSON.stringify(pruneAlertReviewTray(fullLegacy, NOW + 1000)));
  const decisions = Array.from({ length: tray.REVIEW_TOMBSTONE_CAP }, (_, index) => ({
    sourceKey: `dismissed_source_${String(index).padStart(8, '0')}`, resolvedAt: NOW,
    expiresAt: NOW + 86_400_000, outcome: 'dismissed' }));
  const cappedOverflow = admitPreparedReviewAlert({ ...fullLegacy, tombstones: decisions }, incoming, NOW + 1000).state;
  ok('eviction loss records never push dismissal dedupe tombstones out of the cap',
    cappedOverflow.tombstones.length === tray.REVIEW_TOMBSTONE_CAP &&
      decisions.every((item) => cappedOverflow.tombstones.some((kept) => kept.sourceKey === item.sourceKey)),
    String(cappedOverflow.tombstones.length));
  ok('informational-first eviction stays silent',
    mixed.tombstones.length === 0 && tray.recentlyLostReviewCount(mixed, NOW + 1000, 'evicted') === 0,
    JSON.stringify(mixed.tombstones));
  const rawOverCap = JSON.parse(JSON.stringify({ ...emptyAlertReviewTray(),
    pending: Array.from({ length: 52 }, (_, index) => legacyFiller(index)) }));
  const loadOnce = normalizeAlertReviewTray(rawOverCap, NOW + 1000);
  const loadTwice = normalizeAlertReviewTray(rawOverCap, NOW + 1500);
  const reloadSaved = normalizeAlertReviewTray(JSON.parse(JSON.stringify(loadOnce)), NOW + 2000);
  ok('hydration eviction is idempotent: unsaved or saved reloads never double count',
    tray.recentlyLostReviewCount(loadOnce, NOW + 1000, 'evicted') === 2 &&
      tray.recentlyLostReviewCount(loadTwice, NOW + 1500, 'evicted') === 2 &&
      tray.recentlyLostReviewCount(reloadSaved, NOW + 2000, 'evicted') === 2 &&
      reloadSaved.pending.length === 50,
    JSON.stringify({ once: loadOnce.tombstones, saved: reloadSaved.tombstones }));

  // Gap A: foreign-currency money reviews can never be posted. They live in
  // their own bounded lane, never occupy the Message lane and never wait.
  const { inspectUniversalBankEvent } = require('./build/universal-parser.js');
  const sarEvent = inspectUniversalBankEvent('Card purchase SAR 125.50 at JARIR on 2026-09-05.');
  const currencyItem = (index) => ({
    ...tray.prepareUniversalReviewAlert({
      id: `currency_review_id_${String(index).padStart(8, '0')}`,
      sourceKey: `currency_review_source_${String(index).padStart(8, '0')}`,
      observedAt: NOW + index, channel: 'inbox', event: sarEvent,
    }),
    currencyConflict: true,
  });
  const currencyFull = { ...emptyAlertReviewTray(),
    pending: Array.from({ length: 50 }, (_, index) => currencyItem(index)) };
  ok('the currency-conflict marker survives hydration',
    normalizeAlertReviewTray(JSON.parse(JSON.stringify(currencyFull)), NOW + 100).pending
      .every((item) => item.currencyConflict === true) &&
      tray.isCurrencyConflictReview(currencyItem(1)) && !tray.isCurrencyConflictReview(stored));
  ok('fifty foreign-currency reviews leave the Message lane empty for new money reviews',
    tray.reviewTrayCapacity(currencyFull, NOW + 100).legacyFull === false &&
      tray.partitionReviewsByCapacity(currencyFull, [incoming], NOW + 1000).deferred.length === 0);
  const moreForeign = Array.from({ length: 5 }, (_, index) => currencyItem(100 + index));
  const foreignPartition = tray.partitionReviewsByCapacity(currencyFull, moreForeign, NOW + 1000);
  ok('a foreign-currency review never waits for Review space',
    foreignPartition.deferred.length === 0 && foreignPartition.admit.length === 5);
  let foreignState = currencyFull;
  for (const item of moreForeign) foreignState = admitPreparedReviewAlert(foreignState, item, NOW + 1000).state;
  const currencyTombstones = foreignState.tombstones.filter((item) => item.outcome === 'currency-evicted');
  ok('the currency lane keeps its newest fifty and tombstones each evicted foreign alert',
    foreignState.pending.length === 50 && foreignState.pending.every(tray.isCurrencyConflictReview) &&
      currencyTombstones.length === 5 &&
      tray.recentlyLostReviewCount(foreignState, NOW + 1000, 'currency-evicted') === 5 &&
      tray.recentlyLostReviewCount(foreignState, NOW + 1000, 'evicted') === 0,
    JSON.stringify(foreignState.tombstones));
  const mixedLanes = pruneAlertReviewTray({ ...emptyAlertReviewTray(),
    pending: [...fullLegacy.pending, ...currencyFull.pending] }, NOW + 1000);
  ok('fifty Message reviews and fifty foreign-currency reviews coexist without eviction',
    mixedLanes.pending.length === 100 && mixedLanes.tombstones.length === 0);
  const protectedForeign = { ...currencyItem(300), channel: 'push',
    id: 'local_review_id_' + 'c'.repeat(32), sourceKey: 'local_review_source_' + 'c'.repeat(32) };
  const protectedFull = { ...emptyAlertReviewTray(), pending: Array.from({ length: 50 }, (_, index) => ({
    ...stored, channel: 'push', id: `local_review_id_${String(index).padStart(32, 'b')}`,
    sourceKey: `local_review_source_${String(index).padStart(32, 'b')}` })) };
  ok('a foreign-currency notification review is not refused by a full notification lane',
    admitPreparedReviewAlert(protectedFull, protectedForeign, NOW + 1000).outcome === 'admitted');

  // H3(c): source-free presentation facts for the Review banner.
  tray.reviewCaptureBacklog.reset();
  let notified = 0;
  const unsubscribe = tray.reviewCaptureBacklog.subscribe(() => { notified += 1; });
  tray.reviewCaptureBacklog.publish({ waiting: 12, currencyConflicts: 2 });
  tray.reviewCaptureBacklog.publish({ waiting: 12 });
  tray.reviewCaptureBacklog.publish({ waiting: 3, currencyConflicts: 1 });
  const snapshot = tray.reviewCaptureBacklog.get();
  unsubscribe();
  tray.reviewCaptureBacklog.publish({ waiting: 0 });
  ok('backlog replaces waiting, accumulates currency conflicts, and notifies only on change',
    snapshot.waiting === 3 && snapshot.currencyConflicts === 3 && notified === 2 &&
      JSON.stringify(Object.keys(snapshot).sort()) === JSON.stringify(['currencyConflicts', 'waiting']),
    JSON.stringify({ snapshot, notified }));
  tray.reviewCaptureBacklog.reset();
}

console.log(`\nalert-review-tray: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
