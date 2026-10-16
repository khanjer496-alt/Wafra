'use strict';
// "Auto-add alerts from unverified bank formats" is one setting on both
// platforms. iPhone live capture used to build its parser session with the
// policy hard-disabled, so on iOS the switch did nothing. It now runs the SAME
// unproven-format path Android's SMS scan runs (LaunchAlertSession
// .parseUnproven -> decideBestEffortAutoPost), with the same guardrails, and a
// record staged without a sender is read exactly as Android reads a blank
// sender. Synthetic bodies only; bank names are format labels.
const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('../../universal-test/load-ts.cjs').createLoader();
const markets = load('@/lib/markets');
const country = load('@/lib/country');
const policy = load('@/lib/best-effort-autopost');
const local = load('@/lib/local-message-record');
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');
const { createIosLocalCaptureCoordinator } = load('@/lib/ios-local-capture');
const { materializeImportBatch, applyMaterializedImportBatch } = load('@/lib/ledger-import');
const { admitPreparedReviewAlerts, emptyAlertReviewTray } = load('@/lib/alert-review-tray');

const NOW = Date.parse('2026-10-14T12:00:00.000Z');
const OBSERVED = '2026-10-14T11:00:00.000Z';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const record = (text, sender, id = uuid(1)) =>
  JSON.stringify({ v: 1, id, text, sender, source: 'message', observedAt: OBSERVED });

function useUsLedger() {
  markets.setActiveMarket('ZZ');
  markets.setLedgerCurrency('USD', 2);
  country.setActiveCountry('US');
}
useUsLedger();

const PURCHASE = 'Chase Bank alert: Your card ending 4421 was charged USD 24.86 at NORTH STAR MARKET.';
// [name, body, sender]. The lure names no own account or card: Android's
// policy lets a registered header (and a senderless alert naming the
// reader's own tail) keep a footer link, and iPhone keeps that same policy.
const LURE = 'USD 500.00 has been credited to your account. Click https://bank-verify.example.com to confirm.';
const NEVER = [
  ['OTP', 'Your OTP for USD 24.86 purchase at NORTH STAR MARKET is 123456. Do not share.', 'CHASE'],
  ['declined', 'Chase: Your purchase of USD 24.86 at NORTH STAR MARKET was declined. Card ending 4421.', 'CHASE'],
  ['scam link from a phone number', LURE, '+12025550190'],
  ['scam link with no sender', LURE, 'Wafra Automation'],
  ['future', 'Chase Bank alert: Your card ending 4421 will be charged USD 24.86 at NORTH STAR MARKET.', 'CHASE'],
  ['promotion', 'Get 20% cashback! Spend USD 50.00 at NORTH STAR MARKET this week.', 'CHASE'],
];

// The drain's own session: no launch market on the page, so the defaults —
// the persisted setting and the person's country — decide.
function decide(text, sender, enabled) {
  policy.setBestEffortAutoPostEnabled(enabled);
  const serialized = record(text, sender);
  const now = new Date(NOW);
  const preflight = local.preflightLocalMessageRecord(serialized, now);
  const session = createLaunchAlertSession({ overrides: {},
    bestEffort: { enabled: policy.bestEffortAutoPostEnabled(), country: country.getActiveCountry() } });
  return { preflight, outcome: local.parseLocalMessageRecord(serialized, now, preflight.market, session) };
}

test('setting on: an eligible unverified purchase is auto-added and marked for checking', () => {
  const { preflight, outcome } = decide(PURCHASE, 'CHASE', true);
  assert.equal(preflight.market, null);
  assert.equal(outcome.kind, 'parsed');
  assert.equal(outcome.market, null);
  assert.equal(outcome.row.kind, 'transaction');
  assert.equal(outcome.row.type, 'expense');
  assert.equal(outcome.row.amountFils, 2486);
  assert.equal(outcome.row.currency, 'USD');
  assert.deepEqual(outcome.row.bestEffort, { v: 1, format: 'universal:purchase:debit', market: 'US' });
  assert.equal(outcome.row.raw, undefined, 'no source text on the row');
  assert.equal(outcome.row.sender, undefined, 'no sender on the row');
  assert.equal(outcome.row.messageObservationId, uuid(1));
});

test('setting off: the same purchase waits in Review', () => {
  const { outcome } = decide(PURCHASE, 'CHASE', false);
  assert.equal(outcome.kind, 'review');
  assert.equal(JSON.stringify(outcome).includes(PURCHASE), false);
});

for (const [name, body, sender] of NEVER) {
  for (const enabled of [true, false]) {
    test(`${name} is never auto-added (setting ${enabled ? 'on' : 'off'})`, () => {
      assert.notEqual(decide(body, sender, enabled).outcome.kind, 'parsed');
    });
  }
}

test('a record with no sender is decided exactly as Android decides a blank sender', () => {
  policy.setBestEffortAutoPostEnabled(true);
  const session = () => createLaunchAlertSession({ overrides: {}, bestEffort: { enabled: true, country: 'US' } });
  const credit = 'USD 500.00 has been credited to your account. Thank you for banking with us.';
  for (const body of [PURCHASE, credit]) {
    const s = session();
    const blank = s.parseUnproven(body, '', s.inspect(body, ''), Date.parse(OBSERVED));
    const outcome = decide(body, 'Wafra Automation', true).outcome;
    assert.equal(outcome.kind === 'parsed', blank !== null, body);
    if (blank) assert.equal(outcome.row.amountFils, blank.amountFils);
  }
  // A credit naming no own account or card never auto-posts without a sender.
  assert.notEqual(decide(credit, 'Wafra Automation', true).outcome.kind, 'parsed');
});

test('an AED ledger is unchanged: UAE formats stay proven, never best-effort', () => {
  markets.setActiveMarket('AE');
  markets.setLedgerCurrency('AED', 2);
  country.setActiveCountry('AE');
  try {
    for (const sender of ['Talabat', 'etisalat']) {
      const { outcome } = decide('AED 50.00 has been debited from your account XXXX1234 at SAMPLE STORE on 14/10/2026.', sender, true);
      assert.notEqual(outcome.kind, 'parsed', sender);
    }
  } finally {
    useUsLedger();
  }
});

// ── the drain reads the persisted setting ──────────────────────────────────

async function drain(text, sender, enabled) {
  policy.setBestEffortAutoPostEnabled(enabled);
  let state = { hydrated: true, onboarded: true, accounts: [], transactions: [], budgets: [], bills: [], goals: [],
    cardDues: [], accountHints: {}, merchantOverrides: {}, reviewTray: emptyAlertReviewTray(), lastScanTs: 0,
    parserVersion: 0, marketId: 'ZZ', monthStartDay: 1, privateMode: false, captureOptOut: false,
    ledgerMoney: { schemaVersion: 2, currency: 'USD', exponent: 2 }, localCaptureQualifications: [], notSubscriptions: [] };
  let queue = [{ id: uuid(9), serialized: record(text, sender, uuid(9)) }];
  let reviews = 0;
  const coordinator = createIosLocalCaptureCoordinator({
    native: {
      notificationCaptureSupported: false,
      getCaptureStatus: async () => ({ firstCapturedAt: null }),
      purgeExpired: async () => 0,
      listPendingRecords: async (limit) => queue.slice(0, limit).map((r) => r.serialized),
      recordFirstCapturedAt: async () => {},
      acknowledgeRecords: async (ids) => { queue = queue.filter((r) => !ids.includes(r.id)); },
    },
    ledger: {
      getState: () => state,
      getStateGeneration: () => 1,
      ensureDurable: async () => {},
      setMarket: () => false,
      importBatch: (input) => {
        let seq = 0;
        const m = materializeImportBatch(input, state, (p) => `T-${p}-${++seq}`);
        state = applyMaterializedImportBatch(state, m);
        return { ids: m.transactions.map((t) => t.id), qualificationIds: [], durable: Promise.resolve() };
      },
      stageReviewAlerts: (items) => {
        const batch = admitPreparedReviewAlerts(emptyAlertReviewTray(), items, NOW);
        const admitted = batch.outcomes.filter((o) => o === 'admitted').length;
        reviews += admitted;
        return { admitted, qualificationIds: [], durable: Promise.resolve() };
      },
    },
    now: () => NOW,
    retireShortcutCapture: async () => 'complete',
  });
  await coordinator.drain();
  return { state, reviews, pending: queue.length };
}

test('the iPhone drain honours the Settings switch both ways', async () => {
  const on = await drain(PURCHASE, 'CHASE', true);
  assert.equal(on.state.transactions.length, 1);
  assert.equal(on.state.transactions[0].amountFils, 2486);
  assert.ok(on.state.transactions[0].bestEffort, 'the row carries the Auto-added - check marker');
  assert.equal(on.pending, 0);
  const off = await drain(PURCHASE, 'CHASE', false);
  assert.equal(off.state.transactions.length, 0);
  assert.equal(off.reviews, 1);
  assert.equal(off.pending, 0);
  for (const [, body, sender] of NEVER) {
    const never = await drain(body, sender, true);
    assert.equal(never.state.transactions.length, 0, body);
  }
  policy.setBestEffortAutoPostEnabled(true);
});

// The iPhone Messages automation fires on EVERY text, including iMessages
// and contacts, which an Android SMS scan never shows the policy. So on
// iPhone an unverified format auto-adds only from a bank-style sender ID (a
// known institution sender, or a carrier short code) and never from a
// person, a phone number or an e-mail address; and never a forwarded body or
// a call-this-number lure. They wait in Review instead.
const PLAIN = 'Your card ending 4421 was charged USD 240.86 at BEST BUY.';
const FORWARDED = 'Fwd: Chase Bank alert: Your card ending 4421 was charged USD 240.86 at BEST BUY.';
const CALL_LURE = 'Your card ending 4421 was charged USD 499.99 at APPLE STORE. Not you? Call 18885550100';
for (const sender of ['Mom', 'John Smith', '+12025550190', 'john@icloud.com']) {
  for (const body of [PURCHASE, PLAIN, FORWARDED, CALL_LURE]) {
    test(`a personal sender "${sender}" never auto-adds: ${body.slice(0, 36)}`, () => {
      const { outcome } = decide(body, sender, true);
      assert.notEqual(outcome.kind, 'parsed');
      assert.notEqual(outcome.kind, 'invalid');
    });
  }
}
for (const sender of ['CHASE', 'Wafra Automation']) {
  for (const body of [FORWARDED, CALL_LURE]) {
    test(`a forwarded or call-this-number body never auto-adds, even from "${sender}"`, () => {
      assert.notEqual(decide(body, sender, true).outcome.kind, 'parsed');
    });
  }
}
test('paired control: the same clear alert from the bank sender ID still auto-adds', () => {
  assert.equal(decide(PURCHASE, 'CHASE', true).outcome.kind, 'parsed');
});
