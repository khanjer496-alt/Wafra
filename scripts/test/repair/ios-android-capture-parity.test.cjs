'use strict';
// iPhone live capture must make the same posting decision Android makes for
// the same SMS. A parity run of a real 30k-message UAE inbox found three
// iOS-only gaps; every body here is SYNTHETIC, written in the same shape.
//
//  1. Market routing. Android routes the launch grammar from the SMS sender
//     alone (auto-import.ts detectLaunchMarketFromSender); iOS also read the
//     currency in the BODY, so a telco, delivery-app, parking short code or
//     merchant SMS quoting "AED" was parsed as a bank alert and auto-posted.
//     The body may only route a record whose sender is absent: the
//     automation placeholder or the notification lane.
//  2. Senderless glued dirham ("AED29.05"). With no sender the body is the
//     only routing evidence, and AED_ALERT's word boundary missed it.
//  3. Carrier re-delivery. Android folds one SMS delivered twice minutes
//     apart (carrierRedeliveryIndexes); the iOS drain posted both copies.
const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('../../universal-test/load-ts.cjs').createLoader();
const markets = load('@/lib/markets');
const local = load('@/lib/local-message-record');
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');
const { createIosLocalCaptureCoordinator } = load('@/lib/ios-local-capture');
const { materializeImportBatch, applyMaterializedImportBatch } = load('@/lib/ledger-import');
const { admitPreparedReviewAlerts, emptyAlertReviewTray } = load('@/lib/alert-review-tray');
markets.setActiveMarket('AE');
markets.setLedgerCurrency('AED', 2);
load('@/lib/country').setActiveCountry('AE');

const NOW = Date.parse('2026-10-14T12:00:00.000Z');
const now = new Date(NOW);
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const record = (text, sender, { id = uuid(1), observedAt = '2026-10-14T11:00:00.000Z', source = 'message' } = {}) =>
  JSON.stringify({ v: 1, id, text, sender, source, observedAt });
const session = () => createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'AED', activeMarket: 'AE' });
function decide(text, sender, options) {
  const serialized = record(text, sender, options);
  const preflight = local.preflightLocalMessageRecord(serialized, now);
  return { preflight, outcome: local.parseLocalMessageRecord(serialized, now, preflight.market, session()) };
}

// Launch-grammar shapes the UAE parser reads from a bank sender.
const LAUNCH_BODIES = [
  'AED 50.00 has been debited from your account XXXX1234 at SAMPLE STORE on 14/10/2026.',
  'Purchase of AED 50.00 with Debit Card ending 1234 at SAMPLE STORE. Avl Balance is AED 1,234.00.',
  'Your Cr.Card XXX1234 was used for AED 29.05 on 14/10/2026 10:59:30 at SAMPLE CAFE,DUBAI-AE. Avl. Cr.limit is AED 4,000.00.',
];
// Senders that name no UAE/Saudi bank: telco, delivery app, retailer,
// parking short code, a full phone number and an e-mail handle.
const NON_BANK_SENDERS = ['etisalat', 'Talabat', 'noon', '7275', '+971501234567', 'someone@example.com'];

// ── 1. sender-only market routing ──────────────────────────────────────────

for (const sender of NON_BANK_SENDERS) {
  test(`a non-bank sender "${sender}" routes no launch market, as Android`, () => {
    assert.equal(markets.detectLaunchMarketFromSender(sender), null, 'premise: Android sees no launch sender');
    for (const body of LAUNCH_BODIES) {
      const { preflight, outcome } = decide(body, sender);
      assert.equal(preflight.market, null, body);
      assert.notEqual(outcome.kind, 'parsed', body);
      assert.notEqual(outcome.kind, 'invalid', body);
      assert.equal(JSON.stringify(outcome).includes(body), false, 'no source text is retained');
    }
  });
}

test('the same bodies still post from a registered bank sender', () => {
  for (const body of LAUNCH_BODIES) {
    for (const sender of ['ADCB', 'EmiratesNBD', 'FAB']) {
      const { preflight, outcome } = decide(body, sender);
      assert.equal(preflight.market, 'AE');
      assert.equal(outcome.kind, 'parsed', `${sender}: ${body}`);
      assert.equal(outcome.row.type, 'expense');
    }
  }
});

for (const placeholder of ['Wafra Automation', '   ']) {
  test(`an absent sender (${JSON.stringify(placeholder)}) still falls back to the body's currency`, () => {
    for (const body of LAUNCH_BODIES) {
      const { preflight, outcome } = decide(body, placeholder);
      assert.equal(preflight.market, 'AE', body);
      assert.equal(outcome.kind, 'parsed', body);
    }
  });
}

test('the notification lane (no attested sender) keeps body routing', () => {
  const body = 'Your ADIB Covered Card ending with 4417 has been used for AED 250.00 at SAMPLE STORE on 14/10/2026.';
  const { preflight, outcome } = decide(body, local.LOCAL_NOTIFICATION_SENDER, { source: 'notification' });
  assert.equal(preflight.market, 'AE');
  assert.equal(outcome.kind, 'parsed');
  assert.equal(outcome.row.amountFils, 25000);
});

test('a non-bank sender quoting a Saudi riyal amount routes nothing either', () => {
  const { preflight } = decide('SAR 75.00 has been debited from your account XXXX1234 at SAMPLE STORE.', 'Talabat');
  assert.equal(preflight.market, null);
  assert.equal(decide('SAR 75.00 has been debited from your account XXXX1234 at SAMPLE STORE.', 'Wafra Automation')
    .preflight.market, 'SA');
});

test('a forced market cannot be smuggled past a non-bank sender', () => {
  // The drain passes preflight.market back in; a caller that forces AE for a
  // non-bank sender is refused as an inconsistent record, never parsed.
  const serialized = record(LAUNCH_BODIES[0], 'Talabat');
  assert.equal(local.parseLocalMessageRecord(serialized, now, 'AE', session()).kind, 'invalid');
});

// ── 2. senderless glued dirham ─────────────────────────────────────────────

const GLUED = 'Your Cr.Card XXX1234 was used for AED29.05 on 14/10/2026 10:59:30 at SAMPLE CAFE,DUBAI-AE. Avl. Cr.limit is AED4,000.00.';
const GLUED_FX = 'Credit Card XXX1234 used for AED32.14 (+2.5% foreign txn fee) on 14/10/2026 10:59:30 at SAMPLE ONLINE,LUXEMBOURG-LU. Avl. Cr.limit is AED4,000.00.';

test('a glued "AED29.05" is dirham evidence for a senderless record', () => {
  assert.equal(markets.detectLaunchMarketFromAlert(GLUED, ''), 'AE');
  assert.equal(markets.detectLaunchMarketFromAlert(GLUED_FX, ''), 'AE');
  assert.equal(markets.detectLaunchMarketFromAlert('Amount debited 195.00AED from card XXX1234', ''), 'AE');
  for (const [body, fils] of [[GLUED, 2905], [GLUED_FX, 3214]]) {
    const { preflight, outcome } = decide(body, 'Wafra Automation');
    assert.equal(preflight.market, 'AE');
    assert.equal(outcome.kind, 'parsed', body);
    assert.equal(outcome.row.amountFils, fils);
  }
});

test('glued-dirham negatives: words, references and a stated riyal', () => {
  // A word that merely starts with the letters is not a currency.
  assert.equal(markets.detectLaunchMarketFromAlert('Use code AEDXTRA at checkout for 20 off', ''), null);
  assert.equal(markets.detectLaunchMarketFromAlert('Your parcel AEDX4412 is out for delivery', ''), null);
  // An alphanumeric reference token is not an amount.
  assert.equal(markets.detectLaunchMarketFromAlert('Ticket AED4412B has been updated', ''), null);
  // A hyphen-joined field label is not a bank sentence: a parking
  // confirmation (charged to the phone bill) stays unrouted with no sender.
  const parking = 'Confirmation PlateNo-12345 PlateSource-Dubai TicketNo-654321 Fee-AED2.38 VAT-AED0.019 Paid upto 14/10/2026 10:30PM';
  assert.equal(markets.detectLaunchMarketFromAlert(parking, ''), null);
  assert.notEqual(decide(parking, 'Wafra Automation').outcome.kind, 'parsed');
  // A field label after a colon is still a figure.
  assert.equal(markets.detectLaunchMarketFromAlert('Amount:AED50.00 debited from card XXX1234', ''), 'AE');
  // A spaced riyal outranks a glued dirham, as the glued riyal yields to AED.
  assert.equal(markets.detectLaunchMarketFromAlert('SAR 50.00 debited. Ref AED20.00', ''), 'SA');
  // The existing glued-riyal rule is unchanged.
  assert.equal(markets.detectLaunchMarketFromAlert('Amount:100SR from card 1234', ''), 'SA');
});

// ── 3. carrier re-delivery fold in the iOS drain ───────────────────────────

const baseState = () => ({
  hydrated: true, onboarded: true,
  accounts: [], transactions: [], budgets: [], bills: [], goals: [], cardDues: [],
  accountHints: {}, merchantOverrides: {}, reviewTray: emptyAlertReviewTray(),
  lastScanTs: 0, parserVersion: 0, marketId: 'AE', monthStartDay: 1,
  privateMode: false, captureOptOut: false,
  ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
  localCaptureQualifications: [], notSubscriptions: [],
});

async function drainAll(records) {
  let state = baseState();
  let seq = 0;
  let queue = records.map((r, i) => ({ id: r.id ?? uuid(100 + i),
    serialized: record(r.text, r.sender ?? 'ADCB', { id: r.id ?? uuid(100 + i), observedAt: new Date(r.at).toISOString() }) }));
  const acked = [];
  const native = {
    notificationCaptureSupported: false,
    getCaptureStatus: async () => ({ firstCapturedAt: null }),
    purgeExpired: async () => 0,
    listPendingRecords: async (limit) => queue.slice(0, limit).map((r) => r.serialized),
    recordFirstCapturedAt: async () => {},
    acknowledgeRecords: async (ids) => {
      const set = new Set(ids);
      acked.push(...ids);
      queue = queue.filter((r) => !set.has(r.id));
    },
  };
  const ledger = {
    getState: () => state,
    getStateGeneration: () => 1,
    ensureDurable: async () => {},
    setMarket: (id) => { state = { ...state, marketId: id }; return true; },
    importBatch: (input) => {
      const m = materializeImportBatch(input, state, (p) => `T-${p}-${++seq}`);
      state = applyMaterializedImportBatch(state, m);
      return { ids: m.transactions.map((t) => t.id), qualificationIds: [], durable: Promise.resolve() };
    },
    stageReviewAlerts: (items) => {
      const batch = admitPreparedReviewAlerts(emptyAlertReviewTray(), items, NOW);
      return { admitted: batch.outcomes.filter((o) => o === 'admitted').length, qualificationIds: [],
        durable: Promise.resolve() };
    },
  };
  const coordinator = createIosLocalCaptureCoordinator({ native, ledger, now: () => NOW,
    retireShortcutCapture: async () => 'complete' });
  const result = await coordinator.drain();
  return { state, result, acked, pending: queue.length };
}

const T0 = Date.parse('2026-10-14T10:00:00.000Z');
const MIN = 60_000;
// Identity-bearing: a running balance figure, and a seconds-precision clock.
const withBalance = (amount = '14.05', balance = '2,345.67') =>
  `Purchase of AED ${amount} at SAMPLE STORE with Debit Card ending 1234. Avl Bal AED ${balance}`;
const withSeconds = 'Your Cr.Card XXX1234 was used for AED 29.05 on 14/10/2026 09:59:30 at SAMPLE CAFE,DUBAI-AE.';
const noToken = 'Purchase of AED 14.05 at SAMPLE STORE with Debit Card ending 1234';

test('one SMS delivered twice minutes apart posts once and both records are acknowledged', async () => {
  for (const body of [withBalance(), withSeconds]) {
    const { state, acked, pending } = await drainAll([
      { text: body, at: T0 },
      { text: body, at: T0 + 3 * MIN },
    ]);
    assert.equal(state.transactions.length, 1, body);
    assert.equal(acked.length, 2);
    assert.equal(pending, 0);
    // The EARLIER copy is the one kept, as on Android.
    assert.equal(state.transactions[0].ts, T0);
  }
});

test('a re-delivery straddling two native pages still posts once', async () => {
  const filler = Array.from({ length: 49 }, (_, i) =>
    ({ text: `Purchase of AED ${i + 1}.00 at FILLER ${i} with Debit Card ending 1234. Avl Bal AED ${9000 - i}.00`,
      at: T0 + i * 1000 }));
  const { state, pending } = await drainAll([
    ...filler,
    { text: withSeconds, at: T0 + 60_000 },
    { text: withSeconds, at: T0 + 4 * MIN },
  ]);
  assert.equal(pending, 0);
  assert.equal(state.transactions.filter((t) => t.amountFils === 2905).length, 1);
  assert.equal(state.transactions.length, 50);
});

test('identical bodies with nothing to tell two charges apart both post', async () => {
  const { state } = await drainAll([{ text: noToken, at: T0 }, { text: noToken, at: T0 + 3 * MIN }]);
  assert.equal(state.transactions.length, 2);
});

test('equal charges whose balances differ both post', async () => {
  const { state } = await drainAll([
    { text: withBalance('14.05', '2,345.67'), at: T0 },
    { text: withBalance('14.05', '2,331.62'), at: T0 + 2 * MIN },
  ]);
  assert.equal(state.transactions.length, 2);
});

test('a balance that moved in between makes an identical body a new movement', async () => {
  const credit = 'AED 14.05 has been credited to your account XXXX1234. Avl Bal AED 2,345.67';
  const debit = 'AED 14.05 has been debited from your account XXXX1234. Avl Bal AED 2,331.62';
  const { state } = await drainAll([
    { text: credit, at: T0 }, { text: debit, at: T0 + MIN }, { text: credit, at: T0 + 2 * MIN },
  ]);
  assert.equal(state.transactions.length, 3);
});

test('opposite directions of the same amount are never folded', async () => {
  const { state } = await drainAll([
    { text: 'AED 14.05 has been credited to your account XXXX1234 on 14/10/2026 10:00:05', at: T0 },
    { text: 'AED 14.05 has been debited from your account XXXX1234 on 14/10/2026 10:00:05', at: T0 + 30_000 },
  ]);
  assert.equal(state.transactions.length, 2);
  assert.deepEqual(state.transactions.map((t) => t.type).sort(), ['expense', 'income']);
});

test('the fold window is Android\'s ten minutes, and the sender must match', async () => {
  const late = await drainAll([{ text: withSeconds, at: T0 }, { text: withSeconds, at: T0 + 11 * MIN }]);
  assert.equal(late.state.transactions.length, 2);
  const senders = await drainAll([
    { text: withSeconds, at: T0, sender: 'ADCB' },
    { text: withSeconds, at: T0 + MIN, sender: 'FAB' },
  ]);
  assert.equal(senders.state.transactions.length, 2);
});

// ── 4. UAE advertising senders ─────────────────────────────────────────────
// The UAE regulator requires promotional SMS to carry an "AD-" sender prefix,
// and no transactional alert may use one; in the owner's inbox none of 1,242
// AD- messages was a movement, yet 212 offers reached Review on BOTH
// platforms. Elsewhere "AD-" is an operator code on real alerts (India's
// "AD-HDFCBK"), so the rule is UAE-only. Synthetic offer text below.
const OFFER = 'Earn up to AED500 in talabat credit when you refer a friend to ADCB. Share your referral code today. T&Cs apply.';
test('a UAE advertising sender is ignored, never Review', () => {
  const { outcome } = decide(OFFER, 'AD-ADCB');
  assert.equal(outcome.kind, 'ignored');
  assert.equal(decide(LAUNCH_BODIES[0], 'AD-ADCB').outcome.kind, 'ignored', 'even a bank-shaped body');
});
test('the same offer from the bank\'s alert sender keeps its existing outcome', () => {
  assert.notEqual(decide(OFFER, 'ADCB').outcome.kind, 'parsed');
  assert.equal(decide(LAUNCH_BODIES[0], 'ADCB').outcome.kind, 'parsed');
});
test('the AD- rule reads the sender itself, never the person\'s country', () => {
  const country = load('@/lib/country');
  const { isUaeAdvertisingSender } = load('@/lib/auto-import');
  for (const where of ['AE', 'IN', 'US']) {
    country.setActiveCountry(where);
    // India's operator/circle code on a real bank alert, whatever the country.
    assert.equal(isUaeAdvertisingSender('AD-HDFCBK'), false, where);
    assert.equal(isUaeAdvertisingSender('AD-ICICIB'), false, where);
    // UAE banks and telcos advertising under the regulator's prefix.
    assert.equal(isUaeAdvertisingSender('AD-ADCB'), true, where);
    assert.equal(isUaeAdvertisingSender('AD-FAB'), true, where);
    assert.equal(isUaeAdvertisingSender('AD-e& money'), true, where);
    assert.equal(isUaeAdvertisingSender('AD-du'), true, where);
    // A UAE bank name is not a PREFIX rule: HSBC India and an Indian ENBD
    // header are other banks' real alerts.
    for (const indian of ['AD-HSBCIN', 'AD-HSBCBK', 'AD-ENBDIN', 'AD-ADCBXY', 'AD-duBank']) {
      assert.equal(isUaeAdvertisingSender(indian), false, `${where}: ${indian}`);
    }
  }
  country.setActiveCountry('AE');
  assert.equal(isUaeAdvertisingSender('ADCB'), false);
  assert.equal(isUaeAdvertisingSender('ADIB'), false);
});
test('an Indian AD- bank alert is not silently ignored on a UAE phone', () => {
  const body = 'Rs.2,500.00 debited from a/c **1234 on 14-10-26 to VPA shop@okaxis (UPI Ref No 123456789012). Not you? Call 18002586161 - HDFC Bank';
  for (const sender of ['AD-HDFCBK', 'AD-HSBCIN', 'AD-ENBDIN']) {
    assert.notEqual(decide(body, sender).outcome.kind, 'ignored', sender);
  }
});

// ── 5. carrier re-delivery across drains ────────────────────────────────────
// While the app is open it drains roughly per message, so the two copies of
// one carrier re-delivery usually arrive in DIFFERENT drains. The fold keeps
// its opaque, source-free facts for the live app's coordinator (ten-minute
// window, never persisted), so the second copy still folds. A replaced ledger
// (restore/erase) starts clean.
function liveCoordinator() {
  let state = baseState();
  let generation = 1;
  let queue = [];
  let seq = 0;
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
      getStateGeneration: () => generation,
      ensureDurable: async () => {},
      setMarket: (id) => { state = { ...state, marketId: id }; return true; },
      importBatch: (input) => {
        const m = materializeImportBatch(input, state, (p) => `L-${p}-${++seq}`);
        state = applyMaterializedImportBatch(state, m);
        return { ids: m.transactions.map((t) => t.id), qualificationIds: [], durable: Promise.resolve() };
      },
      stageReviewAlerts: (items) => ({ admitted: admitPreparedReviewAlerts(emptyAlertReviewTray(), items, NOW)
        .outcomes.filter((o) => o === 'admitted').length, qualificationIds: [], durable: Promise.resolve() }),
    },
    now: () => NOW,
    retireShortcutCapture: async () => 'complete',
  });
  return {
    async deliver(n, text, at, sender = 'ADCB') {
      const id = uuid(500 + n);
      queue.push({ id, serialized: record(text, sender, { id, observedAt: new Date(at).toISOString() }) });
      await coordinator.drain();
    },
    replaceLedger() { state = baseState(); generation += 1; },
    rows: () => state.transactions,
  };
}

test('a re-delivery in a later drain of the open app posts once', async () => {
  const app = liveCoordinator();
  await app.deliver(1, withSeconds, T0);
  await app.deliver(2, withSeconds, T0 + 3 * MIN);
  assert.equal(app.rows().length, 1);
});
test('across drains, different bodies and the ten-minute window still post separately', async () => {
  const app = liveCoordinator();
  await app.deliver(1, withBalance('14.05', '2,345.67'), T0);
  await app.deliver(2, withBalance('14.05', '2,331.62'), T0 + 2 * MIN);
  await app.deliver(3, withSeconds, T0 + 3 * MIN);
  await app.deliver(4, withSeconds, T0 + 14 * MIN);
  assert.equal(app.rows().length, 4);
});
test('a replaced ledger forgets the previous ledger\'s fold facts', async () => {
  const app = liveCoordinator();
  await app.deliver(1, withSeconds, T0);
  app.replaceLedger();
  await app.deliver(2, withSeconds, T0 + 3 * MIN);
  assert.equal(app.rows().length, 1, 'the copy is the only row of the new ledger');
});
