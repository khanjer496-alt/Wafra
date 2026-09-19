'use strict';
// Synthetic bank grammar only. Native transport is stubbed; parsing, review,
// account discovery, reconciliation and persistence use shipping modules.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const build = process.env.WAFRA_TEST_BUILD_DIR || path.join(root, 'scripts/test/build');
const NOW = Date.parse('2026-09-19T12:00:00Z');
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return NOW; }
}
const plain = value => JSON.parse(JSON.stringify(value));
const compiled = name => require(path.join(build, name + '.js'));
const subjects = new Set(['auto-import', 'historical-import', 'ios-history-import',
  'sms-parser', 'bank-alert-interpreter', 'launch-alert-parser', 'import-plan', 'heal', 'ledger-import']);

function harness(messages, market = 'AE', {
  activeMarket = market, unpinned = false, currency = market === 'SA' ? 'SAR' : market === 'US' ? 'USD' : 'AED',
} = {}) {
  const markets = compiled('markets');
  const resetMarket = () => {
    assert.equal(markets.setActiveMarket(activeMarket), true, 'test must use a supported regional parser pack');
    markets.setLedgerCurrency(unpinned ? null : currency, 2);
  };
  resetMarket();
  const cache = new Map();
  const boundaries = {
    'react-native': { Platform: { OS: 'android' }, AppState: { currentState: 'background' } },
    'expo-crypto': { CryptoDigestAlgorithm: { SHA256: 'sha256' },
      digestStringAsync: async (_algorithm, text) => createHash('sha256').update(text).digest('hex') },
    'expo-secure-store': { getItemAsync: async () => 'a5'.repeat(32) },
    '../../modules/notification-reader': { __esModule: true, default: null },
    '../../modules/sms-reader': { __esModule: true, default: {
      getInboxSms: async () => messages.map((message, index) => ({
        id: index + 1000, body: message.body, address: message.sender,
        date: Date.parse(message.receivedAt),
      })).sort((a, b) => b.date - a.date),
    } },
    '@/lib/foreground-history-priority': { waitForForegroundHistoryIdle: async () => {} },
  };
  function current(name) {
    if (!subjects.has(name)) return compiled(name);
    if (cache.has(name)) return cache.get(name);
    const file = path.join(root, 'src/lib', name + '.ts');
    const deps = { ...boundaries };
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/from ['"](@\/lib\/[^'"]+)['"]/g)) {
      if (!(match[1] in deps)) deps[match[1]] = current(match[1].slice(6));
    }
    const result = load(file, deps, { Date: Clock });
    cache.set(name, result);
    return result;
  }
  const records = messages.map((message, index) => JSON.stringify({
    v: 1, id: (index + 1).toString(16).padStart(64, '0'),
    text: message.body, sender: message.sender, receivedAt: message.receivedAt,
  }));
  const chunks = [];
  for (let index = 0; index < records.length; index += 2) chunks.push(records.slice(index, index + 2));
  const native = {
    purgeExpired: async () => {},
    getCompletedSession: async () => ({ paged: true, chunkIndices: chunks.map((_, index) => index), found: records.length,
      attempted: records.length, accepted: records.length, skipped: 0 }),
    readChunk: async (_session, index) => chunks[index],
    discardSession: async () => assert.fail('valid history must not be discarded while reading'),
  };
  const base = () => ({ hydrated: true, privateMode: true, marketId: activeMarket,
    ...(!unpinned ? { ledgerMoney: { schemaVersion: 2, currency, exponent: 2 } } : {}),
    accounts: [], transactions: [], budgets: [], bills: [], goals: [], cardDues: [],
    accountHints: {}, merchantOverrides: {}, billAliases: {}, notSubscriptions: [], lastScanTs: 0,
    parserVersion: 49 });
  const apply = (result, state = base()) => {
    let serial = 0;
    const plan = current('import-plan').buildImportPlan(result.parsed, state, 0, new Clock(), result.declined);
    const ledger = current('ledger-import');
    return ledger.applyMaterializedImportBatch(state,
      ledger.materializeImportBatch(plan.batch, state, prefix => `${prefix}-${++serial}`));
  };
  return { apply, current, records, async run() {
    const android = await current('auto-import').scanInbox(0, {}, undefined, market, { maxInboxPages: 1 });
    // Android aligns the detected launch market before planning. iOS history
    // must retain the bank without relying on Android's UI alignment step.
    if (android.detectedLaunchMarket) markets.setActiveMarket(android.detectedLaunchMarket);
    const androidState = apply(android);
    resetMarket();
    const ios = await current('ios-history-import').loadIosHistorySession({
      sessionId: 'synthetic_parity_session', native, overrides: {}, now: new Clock(),
    });
    return { android, ios, androidState, iosState: apply(ios) };
  } };
}

// Exact source identities and their integrity signatures differ by transport.
// No amounts, roles, dates, categories, bank facts, account links or evidence
// are removed. Generated ledger IDs are deterministic in the shared reducer.
function businessState(state) {
  const { transferFingerprint } = compiled('transfer-reconciliation');
  for (const row of state.transactions) {
    if (!row.transferMatch) continue;
    assert.equal(row.transferMatch.signature, transferFingerprint(row));
    const counterpart = state.transactions.find(other => other.id === row.transferMatch.counterpartId);
    assert.ok(counterpart);
    assert.equal(row.transferMatch.counterpartSignature, transferFingerprint(counterpart));
  }
  const copy = plain(state);
  for (const row of copy.transactions) {
    delete row.smsKey;
    if (row.transferMatch) {
      delete row.transferMatch.signature;
      delete row.transferMatch.counterpartSignature;
    }
  }
  return copy;
}
function businessReview(items) {
  return plain(items).map(item => {
    for (const key of ['id', 'sourceKey', 'templateKey', 'channel']) delete item[key];
    return item;
  }).sort((a, b) => a.observedAt - b.observedAt);
}
function reviewMoney(item) {
  if (item.kind === 'universal') {
    assert.equal(item.event.amount.evidence, 'explicit');
    assert.ok(item.event.amount.value, 'universal review must retain grounded money');
    return item.event.amount.value;
  }
  assert.ok(item.amount, 'registered review must retain grounded money');
  return item.amount;
}
const message = (sender, body, receivedAt = '2026-09-08T12:00:00.000Z') => ({ sender, body, receivedAt });

test('AE history and Android produce the same accounts, spending, salary, card dues/payments and bank snapshots', async () => {
  const h = harness([
    message('ENBD', 'Purchase of AED 120.00 with Debit Card ending 1234 at CARREFOUR, DUBAI. Available balance AED 880.00.'),
    message('FAB', 'Payroll credit: AED 7,500.00 was posted to your account 5678.', '2026-09-09T12:00:00.000Z'),
    message('ADIB', 'Your ADIB Covered Card ending 4321 statement is ready. Total Amount Due AED 8240.00. Minimum Amount Due AED 412.00. Payment due by 25/09/2026.', '2026-09-10T12:00:00.000Z'),
    message('ADIB', 'Payment of AED 412.00 has been received towards your ADIB Covered Card ending 4321. Thank you.', '2026-09-11T12:00:00.000Z'),
  ]);
  const { androidState, iosState, ios } = await h.run();
  assert.deepEqual(businessState(iosState), businessState(androidState));
  assert.equal(iosState.transactions.length, 3);
  assert.equal(iosState.cardDues.length, 1);
  assert.equal(iosState.cardDues[0].totalDueFils, 824000);
  assert.ok(iosState.transactions.some(row => row.category === 'salary' && row.amountFils === 750000));
  assert.ok(iosState.transactions.some(row => row.cardPaymentSide === 'receipt' && row.isTransfer));
  assert.ok(iosState.accounts.some(account => account.snapshotFils === 88000));
  assert.ok(ios.parsed.every(row => !Object.hasOwn(row, 'raw') && !Object.hasOwn(row, 'sender')));
});

test('Saudi Mada purchase keeps SAR money, health category, debit role and quoted balance on both platforms', async () => {
  const { androidState, iosState } = await harness([
    message('SNB', 'Purchase of SAR 45.00 with Mada Card ending 1234 at NAHDI PHARMACY, RIYADH. Available balance SAR 900.00.'),
  ], 'SA').run();
  assert.deepEqual(businessState(iosState), businessState(androidState));
  assert.equal(iosState.transactions[0].amountFils, 4500);
  assert.equal(iosState.transactions[0].category, 'health');
  assert.equal(iosState.accounts[0].cardType, 'debit');
  assert.equal(iosState.accounts[0].snapshotFils, 90000);
});

test('Saudi history discovers the bank and SAR ledger even with the initial AE app locale', async () => {
  const { androidState, iosState } = await harness([
    message('SNB', 'Purchase of SAR 45.00 with Mada Card ending 1234 at NAHDI PHARMACY, RIYADH. Available balance SAR 900.00.'),
  ], 'SA', { activeMarket: 'AE', unpinned: true }).run();
  assert.deepEqual(businessState(iosState), businessState(androidState));
  assert.equal(iosState.accounts[0].bankName, 'SNB AlAhli');
  assert.equal(iosState.accounts[0].snapshotFils, 90000);
  assert.equal(iosState.ledgerMoney.currency, 'SAR');
});

test('partially masked bank accounts keep their own quoted Wallet snapshot after history import', async () => {
  const h = harness([
    message('ENBD', 'AED 7,000.00 has been debited from your account no. 095XXX13XXX01 TO LIV FROM EMERGENCY FUNDS. The available balance is AED 7,939.20.'),
  ]);
  const { androidState, iosState, ios } = await h.run();
  assert.deepEqual(businessState(iosState), businessState(androidState));
  assert.equal(iosState.accounts.length, 1);
  assert.equal(iosState.accounts[0].bankName, 'Emirates NBD');
  assert.equal(iosState.accounts[0].snapshotFils, 793920);
  assert.equal(iosState.accounts[0].last4, undefined, 'a masked source is not an invented last four');
  assert.equal(compiled('balances').netWorthFils(iosState), 793920);
  assert.deepEqual(plain(h.apply(ios, iosState)), plain(iosState), 'reread preserves one masked account and snapshot');
});

test('actual completed iOS history preserves reciprocal transfer evidence until the ledger has reconciled it', async () => {
  const h = harness([
    message('FAB', 'Dear Customer, your funds transfer request of AED 813.00 from account XXXX1111 to account XXXX2222 has been processed on 08/09/2026 16:00. For more information please call 600525500.'),
    message('FAB', 'An amount of AED 813.00 has been credited to your FAB account XXXX2222 on 08/09/2026. Your balance is AED 9813.00', '2026-09-08T12:04:00.000Z'),
  ]);
  const { androidState, iosState, ios, android } = await h.run();
  assert.deepEqual(businessState(iosState), businessState(androidState));
  const reconciliation = compiled('transfer-reconciliation').reconcileTransfers(iosState.transactions, iosState.accounts);
  assert.equal(reconciliation.internalIds.size, 2, 'both bank observations belong to one own-account movement');
  assert.ok(iosState.transactions.every(row => row.transferMatch?.basis === 'destination-and-receipt'));
  assert.equal(compiled('cash-flow').summarizeCashOutflow(iosState, { mode: 'all' }).totalFils, 0);
  assert.deepEqual(plain(h.apply(ios, iosState)), plain(iosState), 'exact iOS replay creates no new money or accounts');
  assert.deepEqual(plain(h.apply(android, androidState)), plain(androidState), 'exact Android replay is also idempotent');
});

test('explicit own-account transfer evidence survives body removal without inventing a second posting', async () => {
  const { androidState, iosState } = await harness([
    message('FAB', 'AED 500.00 transferred from your account XXXX1111 to your account XXXX2222 on 08/09/2026.'),
  ]).run();
  assert.deepEqual(businessState(iosState), businessState(androidState));
  assert.equal(iosState.transactions.length, 1);
  assert.equal(iosState.transactions[0].transferEvidence.explicitOwn, true);
});

test('history replay preserves a user-edited ledger row on both platforms', async () => {
  const h = harness([message('ENBD',
    'Purchase of AED 120.00 with Debit Card ending 1234 at CARREFOUR, DUBAI.')]);
  const result = await h.run();
  for (const [parsed, state] of [[result.android, result.androidState], [result.ios, result.iosState]]) {
    const edited = { ...state, transactions: state.transactions.map(row => ({
      ...row, title: 'My weekly groceries', titleEdited: true, category: 'shopping', userEdited: true,
    })) };
    const replay = h.apply(parsed, edited);
    assert.deepEqual(plain(replay.transactions), plain(edited.transactions));
    assert.equal(replay.accounts.length, edited.accounts.length);
  }
});

test('uncertain and unsupported messages enter the same source-free review while declines never post', async () => {
  const { android, ios, androidState, iosState } = await harness([
    message('FAB', 'AED 2,500.00 has been transferred to your FAB account from JOHN DOE'),
    message('Chase', 'A purchase of USD 12.50 was made on your card ending in 1234 at Example Store.', '2026-09-08T12:01:00.000Z'),
    message('ENBD', 'Your card transaction was declined for AED 22.00.', '2026-09-08T12:02:00.000Z'),
  ]).run();
  assert.deepEqual(businessState(iosState), businessState(androidState));
  assert.equal(iosState.transactions.length, 0);
  assert.equal(ios.reviewCandidates.length, 2);
  assert.deepEqual(businessReview(ios.reviewCandidates), businessReview(android.reviewCandidates));
  assert.equal(ios.declined.length, 1);
  assert.equal(ios.declined[0].reason, android.declined[0].reason);
  assert.equal(JSON.stringify(ios).includes('JOHN DOE'), false);
});

for (const unpinned of [false, true]) {
  test(`global bank purchase and transfer stay in the same review on ${unpinned ? 'an unpinned fresh' : 'a USD'} ledger`, async () => {
    // The app's two regional parser packs are AE/SA. A US locale and USD
    // ledger do not manufacture an unsupported US regional parser pack.
    const { android, ios, androidState, iosState } = await harness([
      message('Chase', 'Chase Alert: Your card ending 1234 was charged USD 20.00 at TARGET.'),
      message('Chase', 'USD 100.00 was debited from your account and credited to the beneficiary by bank transfer', '2026-09-08T12:01:00.000Z'),
    ], 'US', { activeMarket: 'AE', currency: 'USD', unpinned }).run();
    assert.equal(android.parsed.length, 0, 'Android SMS admission is review-first outside its regional launch parsers');
    assert.equal(ios.parsed.length, 0, 'history must not silently auto-post the same global evidence');
    assert.deepEqual(businessReview(ios.reviewCandidates), businessReview(android.reviewCandidates));
    assert.equal(ios.reviewCandidates.length, 2);
    assert.deepEqual(plain(ios.reviewCandidates.map(reviewMoney)), [
      { currency: 'USD', minorUnits: '2000', exponent: 2 },
      { currency: 'USD', minorUnits: '10000', exponent: 2 },
    ]);
    assert.deepEqual(businessState(iosState), businessState(androidState));
    assert.equal(iosState.transactions.length, 0);
  });
}

test('a known global issuer quoting AED stays review-first on an AED ledger', async () => {
  const { android, ios, androidState, iosState } = await harness([
    message('Chase', 'Purchase of AED 120.00 with Debit Card ending 1234 at CARREFOUR, DUBAI.'),
  ]).run();
  assert.equal(android.parsed.length, 0);
  assert.equal(ios.parsed.length, 0, 'an AED token does not turn Chase into a supported regional issuer');
  assert.deepEqual(businessReview(ios.reviewCandidates), businessReview(android.reviewCandidates));
  assert.equal(ios.reviewCandidates.length, 1);
  assert.deepEqual(plain(reviewMoney(ios.reviewCandidates[0])),
    { currency: 'AED', minorUnits: '12000', exponent: 2 });
  assert.deepEqual(businessState(iosState), businessState(androidState));
});

test('completed history uses original Message time to repair the admitted ambiguous receipt date', async () => {
  const h = harness([message('Unknown Sender',
    'Dear Customer, your payment of AED 42.10 on 01/10/2021 for card ending with **1234 has been credited. Thank you.',
    '2021-01-10T10:30:00.000Z')]);
  const loaded = await h.current('ios-history-import').loadIosHistorySession({
    sessionId: 'synthetic_receipt_session', overrides: {}, now: new Clock(), native: {
      purgeExpired: async () => {},
      getCompletedSession: async () => ({ chunkIndices: [0], found: 1, attempted: 1, accepted: 1, skipped: 0 }),
      readChunk: async () => h.records, discardSession: async () => assert.fail('valid source discarded'),
    },
  });
  assert.equal(loaded.parsed[0].date, '2021-01-10');
  assert.equal(loaded.parsed[0].smsTs, Date.parse('2021-01-10T10:30:00.000Z'));
  assert.equal(h.apply(loaded).transactions[0].date, '2021-01-10');
});
