'use strict';
// iPhone "Quiet" Apple Pay capture: a Wallet card confirmed once posts its
// later purchases on its own, and a bank alert for an Apple Pay purchase that
// is already in the ledger never becomes a second row.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const build = process.env.WAFRA_TEST_BUILD_DIR || path.join(root, 'scripts/test/build');
const links = require(path.join(build, 'apple-pay-card-links.js'));
const tray = require(path.join(build, 'alert-review-tray.js'));
const records = require(path.join(build, 'local-message-record.js'));
const { parseIosApplePayRecord } = require(path.join(build, 'ios-apple-pay-record.js'));
const { buildImportPlan } = require(path.join(build, 'import-plan.js'));
const { setActiveMarket, setLedgerCurrency } = require(path.join(build, 'markets.js'));
const health = load(path.join(root, 'src/lib/ios-capture-health.ts'));
setActiveMarket('AE'); setLedgerCurrency('AED', 2);

const MIN = 60_000;
const base = Date.now() - 6 * 60 * MIN;
const uuid = n => `aabbccdd-1234-4567-89ab-${String(n).padStart(12, '0')}`;
const payload = (card, amount = '25.00', merchant = 'Fixture Coffee', currency = 'AED') =>
  JSON.stringify({ amount, ...(card === null ? {} : { cardOrPass: card }), currency, merchant });
const capture = (n, { card = 'Apple Cash', amount, merchant, currency, at = base + n * 30 * MIN } = {}) =>
  parseIosApplePayRecord(payload(card, amount, merchant, currency), uuid(n), at).item;
const accounts = [
  { id: 'acc-liv', name: 'Liv', kind: 'bank', openingFils: 0, color: '#000' },
  { id: 'adib-card', name: 'ADIB card', kind: 'card', cardType: 'credit', last4: '4417', bankName: 'ADIB', openingFils: 0, color: '#111' },
];
const state = (extra = {}) => ({ hydrated: true, captureOptOut: false, marketId: 'AE',
  ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 }, transactions: [], accounts,
  reviewTray: tray.emptyAlertReviewTray(), budgets: [], bills: [], goals: [], cardDues: [], accountHints: {},
  merchantOverrides: {}, knownBanks: [], lastScanTs: 0, parserVersion: 0, localCaptureQualifications: [],
  customCategories: [], applePayCardLinks: [{ cardOrPass: 'Apple Cash', accountId: 'acc-liv', linkedAt: base }], ...extra });
let ids = 0;
const nextId = () => `tx-auto-${++ids}`;
const plan = (s, items, now = Date.now(), options) => links.planLinkedApplePayPosts(s, items, now, nextId, options);

test('link state: one link per card, newest wins, malformed rows dropped, forget removes one', () => {
  let current = links.rememberApplePayCardLink([], 'Apple Cash', 'acc-liv', 10);
  current = links.rememberApplePayCardLink(current, 'Liv Debit', 'adib-card', 20);
  current = links.rememberApplePayCardLink(current, 'Apple Cash', 'adib-card', 30);
  assert.deepEqual(JSON.parse(JSON.stringify(current)), [
    { cardOrPass: 'Liv Debit', accountId: 'adib-card', linkedAt: 20 },
    { cardOrPass: 'Apple Cash', accountId: 'adib-card', linkedAt: 30 },
  ]);
  assert.equal(links.rememberApplePayCardLink(current, ' bad ', 'acc-liv', 40).length, 2, 'an unsanitized name is never stored');
  assert.equal(links.normalizeApplePayCardLinks([...current, { cardOrPass: 'x', accountId: '', linkedAt: 1 }, null, 'x',
    { cardOrPass: 'a‮b', accountId: 'acc', linkedAt: 1 }]).length, 2);
  assert.deepEqual(links.normalizeApplePayCardLinks(undefined), []);
  const forgotten = links.forgetApplePayCardLink(current, 'Apple Cash');
  assert.deepEqual(forgotten.map(link => link.cardOrPass), ['Liv Debit']);
  const many = Array.from({ length: 40 }, (_, i) => ({ cardOrPass: `Card ${i}`, accountId: 'acc-liv', linkedAt: i }));
  assert.equal(links.normalizeApplePayCardLinks(many).length, links.MAX_APPLE_PAY_CARD_LINKS);
});

test('a linked capture posts once, on the linked account, through the promotion planner', () => {
  const item = capture(1);
  const result = plan(state(), [item]);
  assert.deepEqual(result.postedIds, [item.id]);
  assert.equal(result.transactions.length, 1);
  const [row] = result.transactions;
  assert.equal(row.accountId, 'acc-liv'); assert.equal(row.amountFils, 2500); assert.equal(row.type, 'expense');
  assert.equal(row.title, 'Fixture Coffee'); assert.equal(row.smsKey, item.sourceKey); assert.equal(row.ts, item.observedAt);
  assert.equal(row.viaPush, true);
  assert.ok(result.reviewTray.tombstones.some(entry => entry.sourceKey === item.sourceKey && entry.outcome === 'added'));
  assert.equal(result.reviewTray.pending.length, 0);
  const after = state({ transactions: result.transactions, reviewTray: result.reviewTray });
  assert.deepEqual(plan(after, [item]).postedIds, [], 'a replayed receipt never posts twice');
  assert.deepEqual(plan(state(), [item, item]).postedIds, [item.id], 'one receipt in one page posts once');
});

test('unlinked cards, a missing card name, deleted or hidden accounts and other currencies keep Review', () => {
  assert.deepEqual(plan(state(), [capture(1, { card: 'Liv Debit' })]).postedIds, [], 'unlinked card');
  assert.deepEqual(plan(state(), [capture(2, { card: null })]).postedIds, [], 'no card name');
  assert.deepEqual(plan(state({ applePayCardLinks: [] }), [capture(3)]).postedIds, [], 'no links');
  assert.deepEqual(plan(state({ accounts: accounts.slice(1) }), [capture(4)]).postedIds, [], 'deleted account');
  assert.deepEqual(plan(state({ accounts: [{ ...accounts[0], archived: true }, accounts[1]] }), [capture(5)]).postedIds, [],
    'hidden account');
  assert.deepEqual(plan(state(), [capture(6, { currency: 'USD' })]).postedIds, [], 'foreign currency needs a rate and a look');
  assert.deepEqual(plan(state({ ledgerMoney: null }), [capture(7)]).postedIds, [], 'no ledger currency yet');
  assert.deepEqual(plan(state(), [capture(8, { merchant: '' })]).postedIds, [], 'no merchant and no fallback title');
  const titled = plan(state(), [capture(9, { merchant: '' })], Date.now(), { fallbackTitle: 'Card payment' });
  assert.equal(titled.transactions[0].title, 'Card payment');
  const expired = capture(10, { at: Date.now() - tray.REVIEW_ALERT_TTL_MS - MIN });
  assert.deepEqual(plan(state(), [expired].filter(Boolean)).postedIds, [], 'an expired receipt is not posted');
});

test('anything that may already be recorded asks first: bank row, pending review or another Wallet tap', () => {
  const item = capture(1);
  const bank = { id: 'bank-row', type: 'expense', amountFils: 2500, accountId: 'adib-card', title: 'FIXTURE COFFEE DXB',
    date: '2026-10-16', ts: item.observedAt - 4 * MIN, source: 'sms', smsKey: 'h' + 'c'.repeat(64), category: 'dining' };
  assert.deepEqual(plan(state({ transactions: [bank] }), [item]).postedIds, [],
    'a bank SMS that arrived first on another account keeps the Wallet purchase in Review');
  assert.deepEqual(plan(state({ transactions: [{ ...bank, ts: item.observedAt - 11 * MIN }] }), [item]).postedIds, [item.id],
    'outside the window it is a different purchase');
  const pendingBank = { ...capture(2, { card: null }), id: 'notification_review_id_' + 'd'.repeat(16),
    sourceKey: 'local_review_source_' + 'e'.repeat(32), observedAt: item.observedAt + 2 * MIN };
  assert.deepEqual(plan(state({ reviewTray: { ...tray.emptyAlertReviewTray(), pending: [pendingBank] } }), [item]).postedIds, []);
  const twin = capture(3, { at: item.observedAt + 3 * MIN });
  assert.deepEqual(plan(state(), [item, twin]).postedIds, [item.id], 'a second same-amount tap minutes later asks');
});

test('only an Apple Pay review with a usable card is remembered on confirmation', () => {
  assert.equal(links.applePayCardOfReview(capture(1)), 'Apple Cash');
  assert.equal(links.applePayCardOfReview(capture(2, { card: null })), null);
  assert.equal(links.applePayCardOfReview({ ...capture(3), sourceKey: 'local_review_source_' + 'f'.repeat(32) }), null);
  assert.equal(links.applePayCardOfReview(undefined), null);
});

// ── The iOS drain, with the real planner ────────────────────────────────────
function drainHarness({ initial, sms = [], wallet = [] }) {
  const calls = [];
  const current = initial;
  let smsQueue = sms.map(entry => entry.id);
  let walletQueue = [...wallet];
  const parsedBy = new Map(sms.map(entry => [entry.id, entry.row]));
  const api = load(path.join(root, 'src/lib/ios-local-capture.ts'), {
    '@/lib/ios-capture-health': health,
    '@/lib/ios-notification-replay': { createIosNotificationReplayGuard: () => outcome => outcome },
    '@/lib/import-plan': { buildImportPlan },
    '@/lib/launch-alert-parser': { createLaunchAlertSession: () => ({}) },
    '@/lib/alert-review-tray': tray,
    '@/lib/ledger-money': require(path.join(build, 'ledger-money.js')),
    '@/lib/local-message-record': { ...records,
      preflightLocalMessageRecord: (value, now) => parsedBy.has(value)
        ? { id: value, valid: true, market: 'AE', observedAt: parsedBy.get(value).smsTs, attribution: null }
        : records.preflightLocalMessageRecord(value, now),
      localMessageCarrierFacts: () => null,
      parseLocalMessageRecord: value => ({ kind: 'parsed', market: 'AE', milestone: 'financial', row: parsedBy.get(value) }),
    },
    '@/lib/types': { normalizeLocalCaptureQualifications: () => [], isLocalCaptureQualificationCandidate: () => true },
  }, { setTimeout });
  const native = { notificationCaptureSupported: true, applePayCaptureSupported: true,
    getCaptureStatus: async () => ({ firstCapturedAt: base }), purgeExpired: async () => 0,
    listPendingRecords: async () => [...smsQueue],
    listPendingRecordsIncludingNotifications: async () => [...smsQueue],
    listPendingApplePayRecords: async limit => walletQueue.slice(0, limit),
    recordFirstCapturedAt: async () => {},
    acknowledgeRecords: async acked => {
      calls.push(['ack', acked]);
      smsQueue = smsQueue.filter(id => !acked.includes(id));
      walletQueue = walletQueue.filter(raw => !acked.includes(JSON.parse(raw).id));
    },
  };
  const ledger = {
    getState: () => current, getStateGeneration: () => 1,
    importBatch: batch => {
      calls.push(['save', batch.transactions.length]);
      const added = batch.transactions.map((row, index) => ({ ...row, id: `sms-${current.transactions.length + index}` }));
      current.transactions = [...added, ...current.transactions];
      return { durable: Promise.resolve(), ids: added.map(row => row.id) };
    },
    ensureDurable: async () => {},
    setMarket: () => true,
    stageReviewAlerts: items => {
      calls.push(['stage', items.map(item => item.id)]);
      const batch = tray.admitPreparedReviewAlerts(current.reviewTray, items, Date.now());
      current.reviewTray = batch.state;
      return { admitted: batch.outcomes.filter(outcome => outcome === 'admitted').length, qualificationIds: [], durable: Promise.resolve() };
    },
  };
  const postLinkedApplePay = items => {
    calls.push(['post', items.map(item => item.id)]);
    const result = links.planLinkedApplePayPosts(current, items, Date.now(), nextId, { fallbackTitle: 'Card payment' });
    if (result.postedIds.length > 0) {
      current.transactions = [...result.transactions, ...current.transactions];
      current.reviewTray = result.reviewTray;
      current.ledgerMoney = result.ledgerMoney;
    }
    return { posted: result.postedIds, durable: Promise.resolve() };
  };
  const coordinator = api.createIosLocalCaptureCoordinator({ native, ledger, postLinkedApplePay,
    retireShortcutCapture: async () => 'complete' });
  return { calls, state: current, coordinator, queues: () => ({ sms: smsQueue, wallet: walletQueue }) };
}
const envelope = (n, opts = {}) => {
  const at = opts.at ?? Date.now() - 20 * MIN;
  return JSON.stringify({ v: 1, id: uuid(n), observedAt: new Date(at).toISOString(), source: 'apple-pay',
    sender: 'Wafra Apple Pay', text: payload(opts.card === undefined ? 'Apple Cash' : opts.card, opts.amount) });
};
const bankSms = (id, extra = {}) => ({ id, row: { kind: 'transaction', type: 'expense', amountFils: 2500, currency: 'AED',
  merchant: 'FIXTURE COFFEE DXB', categoryGuess: 'dining', date: '2026-10-16', smsTs: Date.now() - 15 * MIN, channel: 'inbox',
  bankHint: 'ADIB', card: { kind: 'credit', last4: '4417' }, sourceEventId: id, ...extra } });

test('drain: a linked capture posts once and is acknowledged; an unlinked one goes to Review', async () => {
  const h = drainHarness({ initial: state(), wallet: [envelope(1), envelope(2, { card: 'Liv Debit', at: Date.now() - 40 * MIN })] });
  const result = await h.coordinator.drain();
  assert.equal(result.imported, 1);
  assert.equal(result.reviews, 1);
  assert.equal(h.state.transactions.length, 1);
  assert.equal(h.state.transactions[0].accountId, 'acc-liv');
  assert.equal(h.state.reviewTray.pending.length, 1);
  assert.equal(h.state.reviewTray.pending[0].walletCardOrPass, 'Liv Debit');
  assert.deepEqual(h.queues().wallet, [], 'both receipts are acknowledged behind their durable outcome');
  const staged = h.calls.filter(call => call[0] === 'stage').flatMap(call => call[1]);
  assert.ok(!staged.includes('apple_pay_review_id_' + uuid(1).replace(/-/g, '')), 'the posted capture never enters Review');
  // The same receipt delivered again (an ACK lost after the write) adds nothing.
  const again = drainHarness({ initial: h.state, wallet: [envelope(1)] });
  const replay = await again.coordinator.drain();
  assert.equal(replay.imported, 0);
  assert.equal(again.state.transactions.length, 1);
  assert.deepEqual(again.queues().wallet, []);
});

test('drain: a linked capture followed by the bank SMS on ANOTHER account does not double count', async () => {
  const h = drainHarness({ initial: state(), wallet: [envelope(1)] });
  await h.coordinator.drain();
  assert.equal(h.state.transactions.length, 1);
  const walletRow = h.state.transactions[0];
  const smsId = 'b'.repeat(64);
  const bank = drainHarness({ initial: h.state, sms: [bankSms(smsId)] });
  const result = await bank.coordinator.drain();
  assert.equal(result.imported, 0);
  assert.equal(bank.state.transactions.length, 1, 'no second ledger row');
  const flagged = bank.state.reviewTray.pending.find(item => item.attentionReason === 'possible-apple-pay-duplicate');
  assert.ok(flagged, 'the bank alert waits in Review as a possible Apple Pay duplicate');
  assert.equal(flagged.walletTransactionId, walletRow.id);
  assert.deepEqual(bank.queues().sms, [], 'acknowledged only once its Review item is retained');
  assert.ok(!bank.calls.some(call => call[0] === 'save' && call[1] > 0));
});

test('drain: a linked capture followed by the bank SMS on the SAME card is flagged by the planner', async () => {
  const s = state({ applePayCardLinks: [{ cardOrPass: 'Apple Cash', accountId: 'adib-card', linkedAt: base }] });
  const h = drainHarness({ initial: s, wallet: [envelope(1)] });
  await h.coordinator.drain();
  assert.equal(h.state.transactions[0].accountId, 'adib-card');
  const bank = drainHarness({ initial: h.state, sms: [bankSms('c'.repeat(64))] });
  const result = await bank.coordinator.drain();
  assert.equal(result.imported, 0);
  assert.equal(bank.state.transactions.length, 1);
  assert.equal(bank.state.reviewTray.pending.filter(item => item.attentionReason === 'possible-apple-pay-duplicate').length, 1);
});

test('drain: the review is not retained, so the bank SMS stays queued rather than posting', async () => {
  const h = drainHarness({ initial: state(), wallet: [envelope(1)] });
  await h.coordinator.drain();
  const full = { ...h.state, reviewTray: h.state.reviewTray };
  const bank = drainHarness({ initial: full, sms: [bankSms('d'.repeat(64))] });
  const original = bank.coordinator;
  // Refuse every review: the record must be held, never imported.
  const stage = tray.admitPreparedReviewAlerts;
  tray.admitPreparedReviewAlerts = (current, items) => ({ state: current, outcomes: items.map(() => 'refused') });
  try {
    const result = await original.drain();
    assert.equal(result.imported, 0);
    assert.equal(bank.state.transactions.length, 1);
    assert.equal(bank.queues().sms.length, 1, 'the native record waits for Review space');
  } finally {
    tray.admitPreparedReviewAlerts = stage;
  }
});

test('drain: a bank SMS of a different amount still posts normally (no over-reach)', async () => {
  const h = drainHarness({ initial: state(), wallet: [envelope(1)] });
  await h.coordinator.drain();
  const bank = drainHarness({ initial: h.state, sms: [bankSms('e'.repeat(64), { amountFils: 4100 })] });
  const result = await bank.coordinator.drain();
  assert.equal(result.imported, 1);
  assert.equal(bank.state.transactions.length, 2);
  assert.equal(bank.state.reviewTray.pending.length, 0);
});

test('drain: a bank SMS that arrived before the Apple Pay capture keeps the capture in Review', async () => {
  const smsId = 'f'.repeat(64);
  const h = drainHarness({ initial: state(), sms: [bankSms(smsId, { smsTs: Date.now() - 21 * MIN })], wallet: [envelope(1)] });
  const result = await h.coordinator.drain();
  assert.equal(result.imported, 1, 'only the bank row posts');
  assert.equal(h.state.transactions.length, 1);
  assert.equal(h.state.reviewTray.pending.length, 1, 'the linked Wallet capture asks in Review instead of posting');
  assert.equal(h.state.reviewTray.pending[0].walletCardOrPass, 'Apple Cash');
});
