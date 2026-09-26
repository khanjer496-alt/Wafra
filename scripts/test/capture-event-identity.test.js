// A bank alert's own event identity, end to end through the Android capture
// path: notification queue -> scanInbox -> buildImportPlan -> ledger apply ->
// persisted hydrate.
//
// Reproduces a real device report (text synthetic, shape exact): the ADCB app
// posted ONE card alert three times, minutes apart, with identical text. The
// ledger gained two rows dated by notification post time. The text states its
// own instant to the second, and that instant — not the post time — is the
// event. Two genuine identical purchases state two instants and must stay two.
//
// Also covers the FAB field-list payroll credit that never reached the ledger
// and the Emirates NBD dash-labelled card due reminder that never reached
// Bills. Every message here is a synthetic look-alike; no owner text.
const path = require('path');
const { createHash } = require('crypto');

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail)); }
}

let inboxRows = [];
let notificationRows = [];
const smsReader = {
  async getInboxSms(sinceMs, beforeDateMs, beforeId, max) {
    return inboxRows
      .filter((row) => row.date >= sinceMs &&
        (row.date < beforeDateMs || (row.date === beforeDateMs && row.id < beforeId)))
      .sort((a, b) => b.date - a.date || b.id - a.id)
      .slice(0, max);
  },
  async getReceived() { return []; },
};
const notificationReader = {
  isAvailable: () => true,
  isEnabled: () => true,
  async getCaptured() {
    return notificationRows.map((row) => ({ sourceClass: 'trusted-bank', appLabel: 'ADCB', ...row }));
  },
  async ackCaptured() { return true; },
  async clearCaptured() { return true; },
};
const installNativeStub = (moduleName, value) => {
  const resolved = require.resolve(path.join(__dirname, 'build', moduleName));
  require.cache[resolved] = {
    id: resolved, filename: resolved, loaded: true,
    exports: { __esModule: true, default: value }, children: [], paths: [],
  };
};
installNativeStub('sms-reader.js', smsReader);
installNativeStub('notification-reader.js', notificationReader);
process.env.EXPO_PUBLIC_WAFRA_ANDROID_NOTIFICATION_CAPTURE_BETA = '1';
const expoCrypto = require('./build/stub-expo-crypto.js');
expoCrypto.CryptoDigestAlgorithm = { SHA256: 'sha256' };
expoCrypto.digestStringAsync = async (_algorithm, data) => createHash('sha256').update(data, 'utf8').digest('hex');
require('./build/stub-secure-store.js').__keychain.items.set('wafra.database.key.v1', 'a5'.repeat(32));
require('./build/stub-react-native.js').Platform.OS = 'android';
const markets = require('./build/markets.js');
markets.setLedgerCurrency(null);
markets.setActiveMarket('AE');
const { scanInbox } = require('./build/auto-import.js');
const { buildImportPlan } = require('./build/import-plan.js');
const { materializeImportBatch, applyMaterializedImportBatch } = require('./build/ledger-import.js');
const { reconcileCaptureDuplicates, duplicateGuard, captureEventIdentity } = require('./build/dedupe.js');
const { alertTextClock } = require('./build/capture-source-identity.js');
const { parseSms, nonPostingReason } = require('./build/sms-parser.js');
const { displayTransactionTime, transactionTime } = require('./build/format.js');

const EMPTY = {
  hydrated: true, privateMode: false, captureOptOut: false,
  accounts: [], transactions: [], budgets: [], bills: [], goals: [], cardDues: [],
  accountHints: {}, merchantOverrides: {}, billAliases: {}, knownBanks: [],
  lastScanTs: 0, parserVersion: 0, marketId: 'AE',
  reviewTray: { schemaVersion: 1, pending: [], tombstones: [] },
};

// 25/09/2026 17:38:39 in the device zone, which is how the text is read.
const TEXT_AT = new Date(2026, 8, 25, 17, 38, 39).getTime();
const alertText = (last4, amount, stamp, merchant, limit) =>
  `Credit Card XX${last4} was used for AED${amount} on ${stamp} at ${merchant}, Dubai-AE. Available limit AED${limit}`;
const ADCB_TEXT = alertText('7301', '290.00', '25/09/2026 17:38:39', 'TEST FRIED CHICKEN', '41000.50');
const instrument = { last4: '7301', kind: 'credit', bankIdentity: 'adcb' };
const identity = (raw, amountFils = 29000) => captureEventIdentity({raw, amountFils, type: 'expense', currency: 'AED', captureInstrument: instrument});

let ids = 0;
async function drain(state, options = { notificationOnly: true }) {
  const scan = await scanInbox(0, {}, undefined, 'en-AE', options);
  const now = new Date(TEXT_AT + 86_400_000);
  const plan = buildImportPlan(scan.parsed, state, scan.newestTs, now, scan.declined);
  const batch = materializeImportBatch(plan.batch, state, (prefix) => `${prefix}-${++ids}`);
  return { state: applyMaterializedImportBatch(state, batch), scan, plan };
}
/** A process restart: persisted JSON back through hydration's capture reconciliation. */
const restart = (state) => {
  const persisted = JSON.parse(JSON.stringify(state));
  return { ...persisted, transactions: reconcileCaptureDuplicates(persisted.transactions) };
};
const spending = (state) => state.transactions.filter((t) => t.type === 'expense' && t.amountFils === 29000);
const push = (id, ts, text = ADCB_TEXT, title = 'ADCBAlert') =>
  ({ id: `adcb-repost-${String(id).padStart(8, '0')}`, pkg: 'com.adcb.nexgen', title, text, ts });

(async () => {
  // ── alertTextClock, the identity itself ──────────────────────────────────
  ok('the stated second is the identity', alertTextClock(ADCB_TEXT, '2026-09-25') === TEXT_AT);
  ok('minute precision is not an identity (a terminal double-tap reads the same)',
    alertTextClock('Purchase of AED 12.00 at CAFE on 25/09/2026 17:38.', '2026-09-25') === null);
  ok('a clock whose date disagrees with the parsed date is not this event',
    alertTextClock(ADCB_TEXT, '2026-09-26') === null);
  ok('two different clocks in one alert are ambiguous',
    alertTextClock('Paid on 25/09/2026 17:38:39, posted 25/09/2026 18:02:11', '2026-09-25') === null);
  ok('month-first counts only when the parser chose that reading',
    alertTextClock('Paid on 09/25/2026 17:38:39', '2026-09-25') === TEXT_AT);
  ok('ISO and 12-hour clocks read the same instant',
    alertTextClock('at 2026-09-25 17:38:39', '2026-09-25') === TEXT_AT &&
      alertTextClock('on 25-09-26 05:38:39 PM', '2026-09-25') === TEXT_AT);

  ok('identity rejects batch midnight and end-of-day clocks',
    identity(ADCB_TEXT.replace('17:38:39', '00:00:00')) === undefined &&
    identity(ADCB_TEXT.replace('17:38:39', '23:59:59')) === undefined);
  ok('identity rejects multiple distinct clocks and ambiguous AM/PM',
    identity(ADCB_TEXT + ' Processed 25/09/2026 18:02:11') === undefined &&
    identity(ADCB_TEXT.replace('17:38:39', '05:38:39 PM')) === undefined);

  // ── one alert, re-posted ─────────────────────────────────────────────────
  notificationRows = [push(1, TEXT_AT + 1_200)];
  let run = await drain(EMPTY);
  let rows = spending(run.state);
  ok('first copy posts one row carrying the stated instant as evidence',
    rows.length === 1 && rows[0].textClock === TEXT_AT && rows[0].date === '2026-09-25' &&
      rows[0].viaPush === true &&
      // Matching clocks stay the post time; only the display reads the text.
      rows[0].ts === TEXT_AT + 1_200 && rows[0].smsKey === `s${TEXT_AT + 1_200}-29000`,
    rows);
  ok('the row shows the stated time, not the post time',
    displayTransactionTime(rows[0])?.getTime() === TEXT_AT &&
      transactionTime(rows[0])?.getTime() === TEXT_AT + 1_200);

  for (const [label, delay] of [['+3 minutes', 3 * 60_000], ['+40 minutes', 40 * 60_000]]) {
    notificationRows = [push(delay, TEXT_AT + delay)];
    run = await drain(run.state);
    ok(`a re-post ${label} later is the same row`, spending(run.state).length === 1, spending(run.state));
  }
  let state = restart(run.state);
  ok('restart keeps one row', spending(state).length === 1);
  notificationRows = [push(99, TEXT_AT + 3 * 3_600_000)];
  run = await drain(state);
  ok('a re-post after restart (hours later) is the same row', spending(run.state).length === 1, spending(run.state));

  notificationRows = [
    push(1, TEXT_AT + 1_200), push(2, TEXT_AT + 3 * 60_000), push(3, TEXT_AT + 40 * 60_000),
  ];
  run = await drain(EMPTY);
  ok('three copies drained in one batch are one row', spending(run.state).length === 1, spending(run.state));

  notificationRows = [push(1, TEXT_AT + 1_200), push(2, TEXT_AT + 7 * 60_000, ADCB_TEXT, 'ADCB')];
  run = await drain(EMPTY);
  ok('a re-post under a different notification title is the same row', spending(run.state).length === 1);

  // ── notification + SMS for the same purchase ─────────────────────────────
  notificationRows = [push(1, TEXT_AT + 1_200)];
  run = await drain(EMPTY);
  notificationRows = [];
  inboxRows = [{ id: 501, address: 'ADCBAlert', body: ADCB_TEXT, date: TEXT_AT + 5 * 60_000 }];
  run = await drain(run.state, {});
  rows = spending(run.state);
  ok('an SMS arriving 5 minutes after the notification replaces it, one row',
    rows.length === 1 && rows[0].viaPush !== true && rows[0].textClock === TEXT_AT, rows);
  notificationRows = [push(4, TEXT_AT + 50 * 60_000)];
  run = await drain(restart(run.state), {});
  ok('a later re-post of the notification does not come back beside the SMS', spending(run.state).length === 1);

  notificationRows = [];
  inboxRows = [{ id: 502, address: 'ADCBAlert', body: ADCB_TEXT, date: TEXT_AT + 2_000 }];
  run = await drain(EMPTY, {});
  inboxRows = [];
  notificationRows = [push(5, TEXT_AT + 6 * 60_000)];
  run = await drain(restart(run.state), {});
  rows = spending(run.state);
  ok('a notification arriving 6 minutes after the SMS is dropped, one row',
    rows.length === 1 && rows[0].viaPush !== true, rows);
  inboxRows = [];

  // ── genuine identical purchases stay separate ────────────────────────────
  const first = alertText('7301', '290.00', '25/09/2026 15:23:32', 'TEST FRIED CHICKEN', '41000.50');
  const second = alertText('7301', '290.00', '25/09/2026 15:39:32', 'TEST FRIED CHICKEN', '40710.50');
  notificationRows = [push(11, new Date(2026, 8, 25, 15, 23, 33).getTime(), first)];
  run = await drain(EMPTY);
  notificationRows = [push(12, new Date(2026, 8, 25, 15, 39, 33).getTime(), second)];
  run = await drain(run.state);
  ok('two identical purchases 16 minutes apart are two rows', spending(run.state).length === 2);
  const quick = alertText('7301', '290.00', '25/09/2026 15:24:10', 'TEST FRIED CHICKEN', '40710.50');
  notificationRows = [
    push(13, new Date(2026, 8, 25, 15, 23, 33).getTime(), first),
    push(14, new Date(2026, 8, 25, 15, 24, 11).getTime(), quick),
  ];
  run = await drain(EMPTY);
  ok('two identical purchases 38 seconds apart, different stated seconds, are two rows',
    spending(run.state).length === 2, spending(run.state));
  ok('and survive restart reconciliation', spending(restart(run.state)).length === 2);

  // Two different purchases can share a second and an amount; the stated
  // instant is evidence only together with the same card AND merchant.
  const coffee = alertText('7301', '50.00', '25/09/2026 17:38:39', 'TEST COFFEE HOUSE', '41000.50');
  const grocer = alertText('7301', '50.00', '25/09/2026 17:38:39', 'TEST GROCER HYPER', '40950.50');
  notificationRows = [push(21, TEXT_AT + 1_000, coffee), push(22, TEXT_AT + 2_000, grocer)];
  run = await drain(EMPTY);
  ok('different merchants charged in the same second are two rows',
    run.state.transactions.filter((t) => t.amountFils === 5000).length === 2);
  ok('and stay two through restart reconciliation',
    restart(run.state).transactions.filter((t) => t.amountFils === 5000).length === 2);
  ok('a midnight/end-of-day batch stamp is not an event instant',
    alertTextClock('Charged AED 30.00 on 25/09/2026 00:00:00 for SUBSCRIPTION', '2026-09-25') === null &&
      alertTextClock('Charged AED 30.00 on 25/09/2026 23:59:59 for SUBSCRIPTION', '2026-09-25') === null);
  const batchStamped = alertText('7301', '30.00', '25/09/2026 00:00:00', 'TEST STREAMING', '41000.50');
  notificationRows = [push(23, TEXT_AT, batchStamped), push(24, TEXT_AT + 3 * 3_600_000, batchStamped)];
  run = await drain(EMPTY);
  ok('two batch-stamped charges posted hours apart are two rows',
    run.state.transactions.filter((t) => t.amountFils === 3000).length === 2);

  // Two genuine purchases on one card, same merchant and amount, 51 seconds
  // apart. Their alerts state different instants, so no arrival window may
  // pair an SMS of one with the notification of the other.
  const at = (h, m, sec) => new Date(2026, 8, 25, h, m, sec).getTime();
  const buyA = alertText('7301', '50.00', '25/09/2026 17:38:39', 'TEST COFFEE HOUSE', '41000.50');
  const buyB = alertText('7301', '50.00', '25/09/2026 17:39:30', 'TEST COFFEE HOUSE', '40950.50');
  const coffees = (state) => state.transactions.filter((t) => t.amountFils === 5000);
  notificationRows = [];
  inboxRows = [{ id: 701, address: 'ADCBAlert', body: buyA, date: at(17, 38, 41) }];
  run = await drain(EMPTY, {});
  inboxRows = [];
  notificationRows = [push(31, at(17, 39, 36), buyB)];
  run = await drain(restart(run.state), {});
  ok('SMS of purchase A then the notification of purchase B 55s later: two rows (B has no SMS)',
    coffees(run.state).length === 2, coffees(run.state));
  notificationRows = [push(32, at(17, 39, 31), buyB)];
  run = await drain(EMPTY);
  notificationRows = [];
  inboxRows = [{ id: 702, address: 'ADCBAlert', body: buyA, date: at(17, 39, 40) }];
  run = await drain(restart(run.state), {});
  ok('notification of B stored first, then the SMS of A: the SMS does not replace B',
    coffees(run.state).length === 2, coffees(run.state));
  inboxRows = [];
  notificationRows = [push(33, at(17, 38, 40), buyA), push(34, at(17, 39, 32), buyB)];
  run = await drain(EMPTY);
  ok('both notifications in one batch are two rows', coffees(run.state).length === 2);

  // Exercise the planner's edited-push fast path, not only duplicateGuard.
  inboxRows = [];
  notificationRows = [push(35, at(17, 38, 40), buyA)];
  const editable = await drain(EMPTY);
  const editedState = {
    ...editable.state,
    transactions: editable.state.transactions.map((t) => ({ ...t, userEdited: true, category: 'groceries' })),
  };
  notificationRows = [];
  inboxRows = [{ id: 703, address: 'ADCBAlert', body: buyB, date: at(17, 39, 40) }];
  const editedDifferentClock = await drain(editedState, {});
  ok('planner retains distinct SMS beside category-edited push with a different stated second',
    coffees(editedDifferentClock.state).length === 2, editedDifferentClock.plan.batch);
  const otherMerchantSameClock = buyA.replace('TEST COFFEE HOUSE', 'TEST GROCER HYPER');
  inboxRows = [{ id: 704, address: 'ADCBAlert', body: otherMerchantSameClock, date: at(17, 39, 40) }];
  const editedDifferentMerchant = await drain(editedState, {});
  ok('planner retains another merchant beside category-edited push even at the same stated second',
    coffees(editedDifferentMerchant.state).length === 2, editedDifferentMerchant.plan.batch);
  const renamedState = {
    ...editedState,
    transactions: editedState.transactions.map((t) => ({ ...t, titleEdited: true, title: 'Morning coffee' })),
  };
  inboxRows = [{ id: 705, address: 'ADCBAlert', body: buyA, date: at(17, 39, 40) }];
  const renamedSamePurchase = await drain(renamedState, {});
  ok('planner folds the matching SMS into a user-renamed push and preserves user fields',
    coffees(renamedSamePurchase.state).length === 1 &&
      coffees(renamedSamePurchase.state)[0].title === 'Morning coffee' &&
      coffees(renamedSamePurchase.state)[0].category === 'groceries', renamedSamePurchase.plan.batch);
  inboxRows = [];

  const coffeeRow = {
    type: 'expense', amountFils: 5000, category: 'dining', accountId: 'card', title: 'Test Coffee House',
    date: '2026-09-25', source: 'sms', captureInstrument: { last4: '7301', kind: 'credit' },
  };
  ok('repair never folds a stored notification and an SMS stating different instants',
    reconcileCaptureDuplicates([
      { ...coffeeRow, id: 'pa', viaPush: true, ts: at(17, 38, 40), smsKey: `s${at(17, 38, 40)}-5000`, textClock: at(17, 38, 39) },
      { ...coffeeRow, id: 'sb', ts: at(17, 39, 32), smsKey: `ha9t${at(17, 39, 32)}`, textClock: at(17, 39, 30) },
    ]).length === 2);
  ok('repair still folds a notification and its own SMS (same stated instant)',
    reconcileCaptureDuplicates([
      { ...coffeeRow, id: 'pa', viaPush: true, ts: at(17, 38, 40), smsKey: `s${at(17, 38, 40)}-5000`, textClock: at(17, 38, 39) },
      { ...coffeeRow, id: 'sa', ts: at(17, 39, 50), smsKey: `ha8t${at(17, 39, 50)}`, textClock: at(17, 38, 39) },
    ]).length === 1);

  const candidateAt = (title) => ({
    date: '2026-09-25', amountFils: 5000, title, type: 'expense', smsKey: `s${at(18, 30, 0)}-5000`,
    ts: at(18, 30, 0), textClock: at(17, 38, 39), channel: 'push', eventKind: 'transaction',
    captureInstrument: instrument, eventIdentity: identity(buyA, 5000),
  });
  const stored = { ...coffeeRow, id: 'edited', viaPush: true, ts: at(17, 38, 40),
    smsKey: `s${at(17, 38, 40)}-5000`, textClock: at(17, 38, 39), captureEventIdentity: identity(buyA, 5000) };
  ok('a category-only edit keeps the merchant test (different merchant same second is new)',
    !duplicateGuard([{ ...stored, userEdited: true, category: 'groceries' }]).has(candidateAt('Test Grocer Hyper')));
  ok('a user-renamed row still folds its own re-post by card and stated second',
    duplicateGuard([{ ...stored, userEdited: true, titleEdited: true, title: 'Morning coffee' }])
      .has(candidateAt('Test Coffee House')));

  // ── one-time repair of already-stored copies ─────────────────────────────
  const base = {
    type: 'expense', amountFils: 29000, category: 'dining', accountId: 'card', title: 'Test Fried Chicken',
    date: '2026-09-25', source: 'sms', viaPush: true,
    captureInstrument: instrument, captureEventIdentity: identity(ADCB_TEXT),
  };
  const a = { ...base, id: 'a', ts: TEXT_AT, textClock: TEXT_AT, smsKey: `s${TEXT_AT}-29000` };
  const b = { ...base, id: 'b', ts: TEXT_AT + 180_000, textClock: TEXT_AT, smsKey: `s${TEXT_AT + 180_000}-29000` };
  const repaired = reconcileCaptureDuplicates([a, b]);
  ok('stored copies stating the same instant fold into one', repaired.length === 1 && repaired[0].id === 'a');
  ok('the repair is idempotent', reconcileCaptureDuplicates(repaired) === repaired);
  ok('a user-edited copy is never folded',
    reconcileCaptureDuplicates([a, { ...b, userEdited: true, title: 'Lunch' }]).length === 2);
  ok('different stated instants are two purchases',
    reconcileCaptureDuplicates([a, { ...b, textClock: TEXT_AT + 60_000 }]).length === 2);
  ok('without card digits on both rows the stated instant cannot fold two apps',
    reconcileCaptureDuplicates([
      { ...a, captureInstrument: undefined }, { ...b, captureInstrument: undefined },
    ]).length === 2);
  ok('a different card is a different purchase',
    reconcileCaptureDuplicates([a, { ...b, captureInstrument: { last4: '9999', kind: 'credit' } }]).length === 2);
  ok('rows without stored text evidence are never folded on post time alone',
    reconcileCaptureDuplicates([
      { ...a, textClock: undefined, captureEventIdentity: undefined }, { ...b, textClock: undefined, captureEventIdentity: undefined },
    ]).length === 2);
  ok('two stored SMS copies are left to provider identity',
    reconcileCaptureDuplicates([
      { ...a, viaPush: undefined, smsKey: 'ha1t1790000000000', ts: 1790000000000 },
      { ...b, viaPush: undefined, smsKey: 'ha2t1790000001000', ts: 1790000001000 },
    ]).length === 2);

  const guard = duplicateGuard([{ ...a, id: 'stored' }]);
  ok('guard: a notification copy stating the stored instant is a duplicate at any distance',
    guard.has({ date: '2026-09-25', amountFils: 29000, title: 'Test Fried Chicken', type: 'expense',
      smsKey: `s${TEXT_AT}-29000`.replace(String(TEXT_AT), String(TEXT_AT + 1)), ts: TEXT_AT + 86_400_000,
      textClock: TEXT_AT, channel: 'push', eventKind: 'transaction', eventIdentity: identity(ADCB_TEXT),
      captureInstrument: instrument }) && guard.takeMatchedId() === 'stored');

  // ── FAB field-list payroll credit ────────────────────────────────────────
  const salary = 'Salary Credit\nAccount XXXX0042\nAED 12345.00\n26/09/2026\nBalance AED 13000.25';
  const salaryParsed = parseSms(salary, undefined, { sender: 'FAB' });
  ok('FAB "Salary Credit" field list is Salary income dated by its own line',
    salaryParsed?.type === 'income' && salaryParsed.merchant === 'Salary' &&
      salaryParsed.categoryGuess === 'salary' && salaryParsed.categoryDeliberate === true &&
      salaryParsed.date === '2026-09-26' && salaryParsed.amountFils === 1234500 &&
      salaryParsed.card?.last4 === '0042' && salaryParsed.snapshotFils === 1300025,
    salaryParsed);
  const crlf = parseSms('Salary Credit\r\nAccount XXXX0042\r\nAED 900.00\r\n01/10/26\r\nBalance AED 950.00', undefined, { sender: 'FAB' });
  ok('CRLF and two-digit years read the same', crlf?.date === '2026-10-01' && crlf.categoryGuess === 'salary', crlf);
  const advance = parseSms('Salary Advance Credit\nAccount XXXX0042\nAED 900.00\n01/10/2026\nBalance AED 950.00', undefined, { sender: 'FAB' });
  ok('an advance is not pay', advance?.merchant === 'Account credit' && advance.categoryGuess === 'other', advance);
  const plain = parseSms('Account activity\nCredit\nAccount XXXX0042\nAED 900.00\n01/10/2026\nBalance AED 950.00', undefined, { sender: 'FAB' });
  ok('an unnamed FAB credit stays a Review-first account credit',
    plain?.merchant === 'Account credit' && plain.categoryDeliberate === false && plain.date === '2026-10-01', plain);

  notificationRows = [];
  inboxRows = [{ id: 601, address: 'FAB', body: salary, date: new Date(2026, 8, 26, 9, 0, 0).getTime() }];
  run = await drain(EMPTY, {});
  const salaryRows = run.state.transactions.filter((t) => t.category === 'salary');
  ok('the FAB salary reaches the ledger through the Android inbox path, not Review',
    salaryRows.length === 1 && salaryRows[0].amountFils === 1234500 && salaryRows[0].date === '2026-09-26' &&
      run.scan.reviewCandidates.length === 0,
    { salaryRows, review: run.scan.reviewCandidates.length });
  inboxRows = [
    { id: 602, address: 'FAB', body: salary, date: new Date(2026, 8, 26, 9, 0, 0).getTime() },
    { id: 603, address: 'FAB', body: salary.replace('13000.25', '25345.25'), date: new Date(2026, 8, 26, 9, 5, 0).getTime() },
  ];
  run = await drain(EMPTY, {});
  ok('two date-only salary credits of the same amount on one day stay two rows',
    run.state.transactions.filter((t) => t.category === 'salary').length === 2);
  inboxRows = [];

  // ── Emirates NBD card due reminder ───────────────────────────────────────
  const due = parseSms(
    'Payment for Credit Card ending 4321 is due on 05/10/26. Total Amt - AED 2345.67; Min Amt - AED 117.28. Please pay by due date to avoid charges.',
    undefined, { sender: 'EmiratesNBD' });
  ok('ENBD dash-labelled due reminder is a card statement due',
    due?.kind === 'cardStatement' && due.amountFils === 234567 && due.minDueFils === 11728 &&
      due.date === '2026-10-05' && due.card?.last4 === '4321' && due.card?.kind === 'credit',
    due);
  ok('a purchase mentioning a total amount is untouched',
    parseSms('Purchase of AED 50.00 with Credit Card ending 4321 at SHOP. Total Amt - AED 50.00', undefined,
      { sender: 'EmiratesNBD' })?.kind === 'transaction');
  const zero = 'Credit Card Purchase \nCard No XXXX1234 \nUSD 0.00 \nTEST SHOP ONLINE USA \n12/06/26 10:15 \nAvl Bal AED 12345.67\nJune statement due on 01/07/2026';
  ok('a FAB zero-amount card verification stays refused (no money moved)', parseSms(zero, undefined, { sender: 'FAB' }) === null);
  const foreign = parseSms(zero.replace('USD 0.00', 'USD 4.99'), undefined, { sender: 'FAB' });
  ok('a FAB foreign purchase with the statement-due footer is a purchase dated by its timestamp',
    foreign?.kind === 'transaction' && foreign.type === 'expense' && foreign.originalCurrency === 'USD' &&
      foreign.date === '2026-06-12', foreign);
  ok('the zero verification is not a declined posting either', nonPostingReason(zero) === null);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})().catch((error) => { console.error(error); process.exit(1); });
