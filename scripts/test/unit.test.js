const fmt = require('./build/format');
const bills = require('./build/bills');
const insights = require('./build/insights');
const seed = require('./build/seed');
const leaving = require('./build/leaving-soon');

let pass = 0, fail = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}\n    got ${a}\n    want ${e}`); }
}
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} ${detail}`); }
}

// ── format ──
eq('formatAED with cents', fmt.formatAED(123456), 'AED 1,234.56');
eq('formatAED whole drops decimals', fmt.formatAED(120000), 'AED 1,200');
eq('formatAED forced no decimals rounds up', fmt.formatAED(123456, { decimals: false }), 'AED 1,235');
eq('formatAED forced no decimals rounds down', fmt.formatAED(123449, { decimals: false }), 'AED 1,234');
eq('formatAED forced no decimals keeps a near-whole figure', fmt.formatAED(7699, { decimals: false }), 'AED 77');
eq('formatAED negative', fmt.formatAED(-50000), 'AED -500');
// Bills prints a total above the rows it totals. Truncating each row made the
// two disagree by a dirham per row: AED 1,025/mo over rows adding to 1,022.
{
  const read = (fils) => Number(fmt.formatAmount(fils, { decimals: false }).replace(/,/g, ''));
  const rows = [77123, 15340, 7399, 2540];
  const shown = rows.reduce((a, r) => a + read(r), 0);
  eq('rows add up to their own total', shown, read(fmt.totalAsShown(rows)));
  eq('totalAsShown of nothing', fmt.totalAsShown([]), 0);
  eq('totalAsShown keeps whole amounts exact', fmt.totalAsShown([50000, 25000]), 75000);
}
eq('formatAED millions grouping', fmt.formatAED(123456789), 'AED 1,234,567.89');
eq('parseAmountToFils decimal', fmt.parseAmountToFils('12.5'), 1250);
eq('parseAmountToFils with junk chars', fmt.parseAmountToFils('AED 1,234.56'), 123456);
eq('parseAmountToFils invalid', fmt.parseAmountToFils('abc'), null);
eq('parseAmountToFils zero', fmt.parseAmountToFils('0'), null);
eq('monthKey', fmt.monthKey('2026-07-18'), '2026-07');
eq('shiftMonthKey back over year', fmt.shiftMonthKey('2026-01', -1), '2025-12');
eq('shiftMonthKey forward', fmt.shiftMonthKey('2026-12', 1), '2027-01');
eq('daysInMonth feb non-leap', fmt.daysInMonth('2026-02'), 28);
eq('daysInMonth feb leap', fmt.daysInMonth('2028-02'), 29);
eq('shortDate', fmt.shortDate('2026-07-05'), '5 Jul');
eq('friendlyDate today', fmt.friendlyDate('2026-07-18', '2026-07-18'), 'Today');
eq('friendlyDate yesterday', fmt.friendlyDate('2026-07-17', '2026-07-18'), 'Yesterday');
eq('monthLabel short', fmt.monthLabel('2026-07', true), 'Jul 2026');

// ── bills ──
const today = new Date(2026, 6, 18); // 18 Jul 2026
const mkBill = (dueDay, paid = []) => ({ id: 'b', title: 'T', category: 'other', amountFils: 100, dueDay, paidMonths: paid });
eq('bill paid status', bills.billsForMonth([mkBill(25, ['2026-07'])], [], today)[0].status, 'paid');
eq('bill overdue', bills.billsForMonth([mkBill(5)], [], today)[0].status, 'overdue');
eq('bill due-soon (today)', bills.billsForMonth([mkBill(18)], [], today)[0].status, 'due-soon');
eq('bill due-soon (5d)', bills.billsForMonth([mkBill(23)], [], today)[0].status, 'due-soon');
eq('bill upcoming', bills.billsForMonth([mkBill(30)], [], today)[0].status, 'upcoming');
eq('bill dueDay 31 clamps in Jun', bills.billsForMonth([mkBill(31)], [], new Date(2026, 5, 15))[0].daysLeft, 15);
ok('bills sorted most urgent first',
  bills.billsForMonth([mkBill(30), mkBill(5), mkBill(20)], [], today).map(r => r.status).join() === 'overdue,due-soon,upcoming');

// ── insights ──
const txs = [
  { id: '1', type: 'income', amountFils: 1000000, category: 'salary', accountId: 'a', title: 'Salary', date: '2026-07-01' },
  { id: '2', type: 'expense', amountFils: 300000, category: 'groceries', accountId: 'a', title: 'Carrefour', date: '2026-07-05' },
  { id: '3', type: 'expense', amountFils: 100000, category: 'dining', accountId: 'a', title: 'Talabat', date: '2026-07-10' },
];
const sum = insights.summarizeMonth(txs, '2026-07');
eq('summarize income', sum.incomeFils, 1000000);
eq('summarize expense', sum.expenseFils, 400000);
eq('summarize top category', sum.byCategory[0].category, 'groceries');
ok('summarize share', Math.abs(sum.byCategory[0].share - 0.75) < 1e-9);
eq('other month empty', insights.summarizeMonth(txs, '2026-06').expenseFils, 0);

const ins = insights.buildInsights(txs, [{ category: 'groceries', limitFils: 250000 }], '2026-07', new Date(2026, 6, 18));
ok('budget-over insight fires', ins.some(i => i.id === 'budget-over-groceries'));
ok('savings insight fires', ins.some(i => i.id === 'savings'));
ok('warnings ranked before neutral',
  ins.findIndex(i => i.tone === 'warning') < ins.findIndex(i => i.tone === 'neutral'));

eq('spentInMonthForCategory', insights.spentInMonthForCategory(txs, '2026-07', 'dining'), 100000);

// ── seed ──
const now = new Date(2026, 6, 18);
const s1 = seed.generateSeedTransactions(now);
const s2 = seed.generateSeedTransactions(now);
ok('seed deterministic', JSON.stringify(s1) === JSON.stringify(s2));
ok('seed sorted desc', s1.every((t, i) => i === 0 || s1[i - 1].date >= t.date));
ok('seed has salary each month', s1.filter(t => t.title === 'Salary').length === 4);
ok('seed no future dates', s1.every(t => t.date <= '2026-07-18'));
ok('seed reasonable volume', s1.length > 100 && s1.length < 400, `len=${s1.length}`);


// ── subscriptions (v2) ──
const subsLib = require('./build/subscriptions');
const subTx = (title, date, fils, cat = 'entertainment') => ({
  id: `${title}-${date}`, type: 'expense', amountFils: fils, category: cat,
  accountId: 'a', title, date,
});

const netflix = subsLib.detectSubscriptions([
  subTx('Netflix', '2026-04-03', 3900),
  subTx('Netflix', '2026-05-03', 3900),
  subTx('Netflix', '2026-06-03', 3900),
  subTx('Netflix', '2026-07-03', 4500),
]);
ok('subscription: monthly cadence detected', netflix.length === 1 && netflix[0].cadence === 'monthly');
ok('subscription: price increase flagged', netflix[0]?.priceIncreased === true);
eq('subscription: next expected ~30d later', netflix[0]?.nextExpectedISO, '2026-08-02');

const weekly = subsLib.detectSubscriptions([
  subTx('Padel Court', '2026-06-05', 8000, 'health'),
  subTx('Padel Court', '2026-06-12', 8000, 'health'),
  subTx('Padel Court', '2026-06-19', 8000, 'health'),
]);
ok('subscription: weekly cadence detected', weekly.length === 1 && weekly[0].cadence === 'weekly');
ok('subscription: weekly monthly-equivalent ~4.33x',
  Math.abs(weekly[0].monthlyEquivalentFils - Math.round(8000 * 4.33)) <= 1);

ok('subscription: known merchant needs only one interval',
  subsLib.detectSubscriptions([
    subTx('Spotify', '2026-06-10', 2100),
    subTx('Spotify', '2026-07-10', 2100),
  ]).length === 1);

ok('subscription: irregular merchant rejected',
  subsLib.detectSubscriptions([
    subTx('Random Shop', '2026-06-01', 5000, 'shopping'),
    subTx('Random Shop', '2026-06-11', 9000, 'shopping'),
    subTx('Random Shop', '2026-07-29', 2000, 'shopping'),
  ]).length === 0);

// ── recurring group classification ──
const rentSubs = subsLib.detectSubscriptions([
  subTx('Apartment Rent', '2026-05-01', 550000, 'rent'),
  subTx('Apartment Rent', '2026-06-01', 550000, 'rent'),
  subTx('Apartment Rent', '2026-07-01', 550000, 'rent'),
  subTx('DEWA Bill', '2026-05-25', 45000, 'utilities'),
  subTx('DEWA Bill', '2026-06-25', 46000, 'utilities'),
  subTx('DEWA Bill', '2026-07-25', 45500, 'utilities'),
  subTx('Netflix', '2026-06-03', 3900),
  subTx('Netflix', '2026-07-03', 3900),
]);
ok('groups: rent classified as housing', rentSubs.find(s => s.title === 'Apartment Rent')?.group === 'housing');
ok('groups: DEWA classified as utility', rentSubs.find(s => s.title === 'DEWA Bill')?.group === 'utility');
ok('groups: Netflix stays a subscription', rentSubs.find(s => s.title === 'Netflix')?.group === 'subscription');
ok('groups: trueSubscriptions excludes rent/utilities',
  subsLib.trueSubscriptions(rentSubs).length === 1 && subsLib.trueSubscriptions(rentSubs)[0].title === 'Netflix');

// Recurring payments in non-subscription categories are commitments, not subscriptions
const supplier = subsLib.detectSubscriptions([
  subTx('Villabill', '2026-05-03', 1070000, 'business'),
  subTx('Villabill', '2026-06-03', 1070000, 'business'),
  subTx('Villabill', '2026-07-03', 1070000, 'business'),
  subTx('Maid Salary', '2026-05-28', 250000, 'other'),
  subTx('Maid Salary', '2026-06-28', 250000, 'other'),
  subTx('Maid Salary', '2026-07-28', 250000, 'other'),
]);
ok('groups: business supplier is a commitment, not a subscription',
  supplier.find(s => s.title === 'Villabill')?.group === 'commitment');
ok('groups: recurring other-category payment is a commitment',
  supplier.find(s => s.title === 'Maid Salary')?.group === 'commitment');
ok('groups: commitments never count in trueSubscriptions',
  subsLib.trueSubscriptions(supplier).length === 0);
ok('groups: commitments listed under fixedCommitments',
  subsLib.fixedCommitments(supplier).length === 2);
ok('groups: a supplier is not a bill',
  subsLib.billCommitments(supplier).length === 0);
ok('groups: a supplier is an other repeat payment',
  subsLib.otherCommitments(supplier).length === 2);
ok('groups: rent and DEWA are bills',
  subsLib.billCommitments(rentSubs).length === 2);
ok('groups: rent and DEWA are not other repeat payments',
  subsLib.otherCommitments(rentSubs).length === 0);

// A merchant the parser mislabelled "utilities" used to skip the amount gate
// outright, so two unrelated payments a month apart became a standing bill at
// whatever the bigger one was. One shop was listed at AED 20,918/mo.
const wildBill = subsLib.detectSubscriptions([
  subTx('Fishbasket', '2026-06-03', 2091800, 'utilities'),
  subTx('Fishbasket', '2026-07-03', 12000, 'utilities'),
]);
ok('bills: two unrelated amounts are not a monthly bill', wildBill.length === 0);

// A real utility still varies month to month and must survive.
const realBill = subsLib.detectSubscriptions([
  subTx('SEWA', '2026-05-25', 28000, 'utilities'),
  subTx('SEWA', '2026-06-25', 45000, 'utilities'),
  subTx('SEWA', '2026-07-25', 31000, 'utilities'),
]);
ok('bills: a swinging utility bill is still detected',
  realBill.length === 1 && realBill[0].group === 'utility');

// User dismissals remove a merchant from detection everywhere
const dismissed = subsLib.detectSubscriptions(
  [
    subTx('Netflix', '2026-06-03', 3900),
    subTx('Netflix', '2026-07-03', 3900),
    subTx('Spotify', '2026-06-10', 2100),
    subTx('Spotify', '2026-07-10', 2100),
  ],
  ['netflix'],
);
ok('dismiss: not-a-subscription merchant skipped',
  dismissed.length === 1 && dismissed[0].title === 'Spotify');

// Lapse detection: silence past ~2 cycles marks a subscription stopped
const lapsedRef = new Date(2026, 6, 19); // 19 Jul 2026
const lapsed = subsLib.detectSubscriptions(
  [
    subTx('Netflix', '2026-02-03', 3900),
    subTx('Netflix', '2026-03-03', 3900),
    subTx('Netflix', '2026-04-03', 3900), // silent since April
    subTx('Spotify', '2026-06-10', 2100),
    subTx('Spotify', '2026-07-10', 2100), // still charging
  ],
  [],
  lapsedRef,
);
ok('lapse: silent-for-months subscription marked stopped',
  lapsed.find(s => s.title === 'Netflix')?.status === 'stopped');
ok('lapse: recently charged subscription stays active',
  lapsed.find(s => s.title === 'Spotify')?.status === 'active');
ok('lapse: stopped subscriptions cost nothing in the monthly total',
  subsLib.subscriptionsMonthlyTotal(lapsed) === 2100);
ok('lapse: helper splits active and stopped',
  subsLib.activeSubscriptions(lapsed).length === 1 && subsLib.stoppedSubscriptions(lapsed).length === 1);

// Stopped list only shows KNOWN services — a shop you stopped visiting is not
// a cancelled subscription.
const lapsedShop = subsLib.detectSubscriptions(
  [
    subTx('Homebox Tomorrow', '2026-03-18', 31200, 'shopping'),
    subTx('Homebox Tomorrow', '2026-04-18', 31200, 'shopping'),
    subTx('Netflix', '2026-03-25', 5000),
    subTx('Netflix', '2026-04-25', 5000),
  ],
  [],
  new Date(2026, 6, 24),
);
const stoppedKnown = subsLib.stoppedSubscriptions(lapsedShop);
ok('stopped list hides unknown merchants, keeps known services',
  stoppedKnown.length === 1 && stoppedKnown[0].title === 'Netflix');

// ── openDues guardrails: credit cards only, stale overdues decay ──
const guardState = {
  accounts: [
    { id: 'cc', name: 'ENBD Credit Card', kind: 'card', cardType: 'credit', openingFils: 0, color: '#fff' },
    { id: 'dc', name: 'FAB Debit Card', kind: 'card', cardType: 'debit', openingFils: 0, color: '#fff' },
  ],
  transactions: [],
  cardDues: [
    { id: 'g1', accountId: 'cc', totalDueFils: 406100, minDueFils: 20300, dueDate: '2026-07-10', paidFils: 0 },
    { id: 'g2', accountId: 'dc', totalDueFils: 2000, minDueFils: 100, dueDate: '2026-07-06', paidFils: 0 },
    { id: 'g3', accountId: 'cc', totalDueFils: 50000, minDueFils: 2500, dueDate: '2026-05-01', paidFils: 0 },
  ],
};
const cardsGuardLib = require('./build/cards');
const guardOpen = cardsGuardLib.openDues(guardState, new Date(2026, 6, 24));
ok('openDues: debit-card dues never surface',
  !guardOpen.some(d => d.due.id === 'g2'));
ok('openDues: dues stale past 30d overdue decay away',
  !guardOpen.some(d => d.due.id === 'g3'));
ok('openDues: recent overdue credit due still shows',
  guardOpen.some(d => d.due.id === 'g1' && d.status === 'overdue'));

// The same statement stored twice — a reminder SMS read as a fresh statement —
// listed the card twice on Home and counted it twice in the total.
const twinState = {
  ...guardState,
  cardDues: [
    ...guardState.cardDues,
    { id: 'g1b', accountId: 'cc', totalDueFils: 406100, minDueFils: 20300, dueDate: '2026-07-10', paidFils: 0 },
  ],
};
const twinOpen = cardsGuardLib.openDues(twinState, new Date(2026, 6, 24));
ok('openDues: one statement per account and due date',
  twinOpen.filter(d => d.due.accountId === 'cc' && d.due.dueDate === '2026-07-10').length === 1);
ok('openDues: the copy still owing the most wins',
  cardsGuardLib
    .openDues(
      {
        ...guardState,
        cardDues: [
          { id: 'p1', accountId: 'cc', totalDueFils: 406100, minDueFils: 20300, dueDate: '2026-07-10', paidFils: 400000 },
          { id: 'p2', accountId: 'cc', totalDueFils: 406100, minDueFils: 20300, dueDate: '2026-07-10', paidFils: 0 },
        ],
      },
      new Date(2026, 6, 24),
    )
    .every(d => d.remainingFils === 406100));
// Two genuinely different statements on one card must both survive.
ok('openDues: different due dates are different statements',
  cardsGuardLib
    .openDues(
      {
        ...guardState,
        cardDues: [
          { id: 'd1', accountId: 'cc', totalDueFils: 406100, minDueFils: 20300, dueDate: '2026-07-10', paidFils: 0 },
          { id: 'd2', accountId: 'cc', totalDueFils: 120000, minDueFils: 6000, dueDate: '2026-07-28', paidFils: 0 },
        ],
      },
      new Date(2026, 6, 24),
    ).length === 2);

// Archived (hidden) cards drop out of dues too
const archivedState = {
  ...guardState,
  accounts: guardState.accounts.map(a => a.id === 'cc' ? { ...a, archived: true } : a),
};
ok('openDues: archived cards contribute no dues',
  cardsGuardLib.openDues(archivedState, new Date(2026, 6, 24)).length === 0);

// ── inactive-account detection: expired cards fade out after 90 silent days ──
const dormancyState = {
  accounts: [
    { id: 'live', name: 'Live Card', kind: 'card', cardType: 'credit', openingFils: 0, color: '#fff' },
    { id: 'dead', name: 'Expired Card', kind: 'card', cardType: 'credit', openingFils: 0, color: '#fff' },
    { id: 'snap', name: 'Snapshot-only Card', kind: 'card', cardType: 'credit', openingFils: 0, color: '#fff', snapshotTs: new Date(2026, 6, 20).getTime() },
    { id: 'manual', name: 'Hand-added Cash', kind: 'cash', openingFils: 100000, color: '#fff' },
    { id: 'hidden', name: 'Hidden Card', kind: 'card', cardType: 'debit', openingFils: 0, color: '#fff', archived: true },
  ],
  transactions: [
    { id: 't1', type: 'expense', amountFils: 5000, category: 'dining', accountId: 'live', title: 'Cafe', date: '2026-07-20' },
    { id: 't2', type: 'expense', amountFils: 5000, category: 'dining', accountId: 'dead', title: 'Old charge', date: '2025-11-02' },
    { id: 't3', type: 'expense', amountFils: 5000, category: 'dining', accountId: 'hidden', title: 'Recent charge', date: '2026-07-21' },
  ],
  cardDues: [],
};
const dToday = new Date(2026, 6, 24);
const inactive = (id) => cardsGuardLib.isInactiveAccount(
  dormancyState, dormancyState.accounts.find(a => a.id === id), dToday);
ok('dormancy: recently used card stays active', inactive('live') === false);
ok('dormancy: card silent since last year is inactive', inactive('dead') === true);
ok('dormancy: a fresh bank snapshot counts as activity', inactive('snap') === false);
ok('dormancy: hand-added account with no history stays active', inactive('manual') === false);
ok('dormancy: archived beats recent activity (hidden means hidden)', inactive('hidden') === true);
ok('dormancy: last activity date reported',
  cardsGuardLib.accountLastActivityISO(dormancyState, 'dead') === '2025-11-02');

// Canonical names make variant descriptors group as ONE subscription
const gpt = subsLib.detectSubscriptions([
  subTx('ChatGPT', '2026-05-03', 7341),
  subTx('ChatGPT', '2026-06-03', 7341),
  subTx('ChatGPT', '2026-07-03', 7341),
  subTx('Real-Debrid', '2026-06-14', 1650),
  subTx('Real-Debrid', '2026-07-14', 1650),
  subTx('Claude', '2026-06-20', 7341),
  subTx('Claude', '2026-07-20', 7341),
]);
ok('online services detected as subscriptions',
  gpt.length === 3 && gpt.every(s => s.group === 'subscription'));
ok('ChatGPT cadence and next date known',
  gpt.find(s => s.title === 'ChatGPT')?.cadence === 'monthly' &&
  gpt.find(s => s.title === 'ChatGPT')?.nextExpectedISO === '2026-08-02');
ok('groups: fixedCommitments has rent + DEWA', subsLib.fixedCommitments(rentSubs).length === 2);

// ── bill auto-reconciliation ──
const dewaBill = { id: 'b-dewa', title: 'DEWA Bill', category: 'utilities', amountFils: 45000, dueDay: 25, paidMonths: [] };
const dewaTx = [{ id: 'x1', type: 'expense', amountFils: 45500, category: 'utilities', accountId: 'a', title: 'DEWA', date: '2026-07-12', source: 'sms' }];
const recon1 = bills.billsForMonth([dewaBill], dewaTx, new Date(2026, 6, 18))[0];
ok('reconcile: imported DEWA debit marks bill paid', recon1.status === 'paid' && recon1.autoReconciled === true);
const wrongAmount = [{ ...dewaTx[0], amountFils: 90000 }];
ok('reconcile: amount outside ±15% does not match',
  bills.billsForMonth([dewaBill], wrongAmount, new Date(2026, 6, 18))[0].status !== 'paid');
const wrongMonth = [{ ...dewaTx[0], date: '2026-06-12' }];
ok('reconcile: other month does not match',
  bills.billsForMonth([dewaBill], wrongMonth, new Date(2026, 6, 18))[0].status !== 'paid');
const transferTx = [{ ...dewaTx[0], isTransfer: true }];
ok('reconcile: transfers never match bills',
  bills.billsForMonth([dewaBill], transferTx, new Date(2026, 6, 18))[0].status !== 'paid');

// ── cards & dues (v2) ──
const cardsLib = require('./build/cards');
const dueState = {
  accounts: [{ id: 'card1', name: 'Credit Card', kind: 'card', cardType: 'credit', openingFils: 0, color: '#fff' }],
  transactions: [],
  cardDues: [],
};
const due = { id: 'd1', accountId: 'card1', totalDueFils: 324000, minDueFils: 16200, dueDate: '2026-07-25', paidFils: 0 };

const ds1 = cardsLib.dueWithStatus(dueState, due, new Date(2026, 6, 18));
ok('due: upcoming 7d out', ds1.status === 'upcoming' && ds1.daysLeft === 7 && ds1.remainingFils === 324000);
ok('due: below minimum flagged', ds1.belowMinimum === true);

const ds2 = cardsLib.dueWithStatus(dueState, due, new Date(2026, 6, 23));
ok('due: urgent within 3d', ds2.status === 'urgent');

const ds3 = cardsLib.dueWithStatus(dueState, due, new Date(2026, 6, 28));
ok('due: overdue after date', ds3.status === 'overdue' && ds3.daysLeft === -3);

const paidState = {
  ...dueState,
  transactions: [{ id: 'p1', type: 'income', amountFils: 324000, category: 'other', accountId: 'card1', title: 'Card payment', date: '2026-07-20', isTransfer: true }],
};
const ds4 = cardsLib.dueWithStatus(paidState, due, new Date(2026, 6, 21));
ok('due: transfer payment settles it', ds4.status === 'settled' && ds4.remainingFils === 0);

const partialState = {
  ...dueState,
  transactions: [{ id: 'p2', type: 'income', amountFils: 100000, category: 'other', accountId: 'card1', title: 'Card payment', date: '2026-07-20', isTransfer: true }],
};
const ds5 = cardsLib.dueWithStatus(partialState, due, new Date(2026, 6, 21));
ok('due: partial payment reduces remaining', ds5.remainingFils === 224000 && ds5.status !== 'settled');
ok('due: partial above minimum clears flag', ds5.belowMinimum === false);

// ── analytics (v2) ──
const an = require('./build/analytics');
const aTx = [
  { id: '1', type: 'expense', amountFils: 50000, category: 'dining', accountId: 'a', title: 'Talabat', date: '2026-07-04' },
  { id: '2', type: 'expense', amountFils: 30000, category: 'dining', accountId: 'a', title: 'Talabat', date: '2026-07-11' },
  { id: '3', type: 'expense', amountFils: 20000, category: 'groceries', accountId: 'a', title: 'Carrefour', date: '2026-07-05' },
  { id: '4', type: 'expense', amountFils: 90000, category: 'dining', accountId: 'a', title: 'Talabat', date: '2026-06-10' },
  { id: '5', type: 'income', amountFils: 999, category: 'other', accountId: 'a', title: 'Pay', date: '2026-07-01', isTransfer: true },
];
const tm = an.topMerchants(aTx, '2026-07');
ok('analytics: top merchant aggregated', tm[0].title === 'Talabat' && tm[0].totalFils === 80000 && tm[0].count === 2);
const mv = an.categoryMovers(aTx, '2026-07');
ok('analytics: dining moved down vs June', mv.some(m => m.category === 'dining' && m.deltaFils === -10000));
const dw = an.dayOfWeekSpend(aTx, '2026-07');
ok('analytics: transfers excluded from weekday spend', dw.reduce((a, b) => a + b, 0) === 100000);

// ── period model ──
const per = require('./build/period');
const pTx = [
  { id: 'q1', type: 'expense', amountFils: 10000, category: 'dining', accountId: 'a', title: 'A', date: '2025-11-20' },
  { id: 'q2', type: 'expense', amountFils: 20000, category: 'dining', accountId: 'a', title: 'B', date: '2026-03-05' },
];
ok('period: string coerces to month', per.toPeriod('2026-07').mode === 'month');
ok('period: inPeriod month', per.inPeriod('2026-07-15', '2026-07') && !per.inPeriod('2026-06-30', '2026-07'));
ok('period: inPeriod year', per.inPeriod('2026-01-01', { mode: 'year', year: 2026 }) && !per.inPeriod('2025-12-31', { mode: 'year', year: 2026 }));
ok('period: inPeriod range inclusive', per.inPeriod('2026-07-01', { mode: 'range', from: '2026-07-01', to: '2026-07-10' }) && per.inPeriod('2026-07-10', { mode: 'range', from: '2026-07-01', to: '2026-07-10' }) && !per.inPeriod('2026-07-11', { mode: 'range', from: '2026-07-01', to: '2026-07-10' }));
ok('period: inPeriod all', per.inPeriod('1999-01-01', { mode: 'all' }));

ok('period: previous month wraps year', per.previousPeriod('2026-01').key === '2025-12');
ok('period: previous year', per.previousPeriod({ mode: 'year', year: 2026 }).year === 2025);
const prevRange = per.previousPeriod({ mode: 'range', from: '2026-07-11', to: '2026-07-20' });
ok('period: previous range equal length', prevRange.from === '2026-07-01' && prevRange.to === '2026-07-10');
ok('period: all has no previous', per.previousPeriod({ mode: 'all' }) === null);

const pNow = new Date(2026, 6, 18); // 18 Jul 2026
ok('period: current month detected', per.isCurrentMonth('2026-07', pNow) && !per.isCurrentMonth('2026-06', pNow));
ok('period: elapsed days current month', per.elapsedDays('2026-07', pNow, []) === 18);
ok('period: elapsed days past month is full', per.elapsedDays('2026-06', pNow, []) === 30);
ok('period: elapsed days future month is zero', per.elapsedDays('2026-08', pNow, []) === 0);
ok('period: elapsed days current year', per.elapsedDays({ mode: 'year', year: 2026 }, pNow, []) === 199);
ok('period: elapsed days range clamps at today', per.elapsedDays({ mode: 'range', from: '2026-07-10', to: '2026-07-31' }, pNow, []) === 9);
ok('period: elapsed days all from earliest tx', per.elapsedDays({ mode: 'all' }, pNow, pTx) === 241);

ok('period: end of past month', per.periodEndISO('2026-06', pNow) === '2026-06-30');
ok('period: end of current month clamps to today', per.periodEndISO('2026-07', pNow) === '2026-07-18');
ok('period: end of past year', per.periodEndISO({ mode: 'year', year: 2025 }, pNow) === '2025-12-31');
ok('period: end of range', per.periodEndISO({ mode: 'range', from: '2026-05-01', to: '2026-05-20' }, pNow) === '2026-05-20');
ok('period: label month', per.periodLabel('2026-07').length > 0);

// summarize + movers accept Period objects
const yearSum = insights.summarizeMonth(aTx, { mode: 'year', year: 2026 });
ok('period: year summary aggregates all months', yearSum.expenseFils === 190000);
const allSum = insights.summarizeMonth(aTx, { mode: 'all' });
ok('period: all-time summary equals year here', allSum.expenseFils === 190000);
ok('period: movers empty for all-time', an.categoryMovers(aTx, { mode: 'all' }).length === 0);
const rangeTop = an.topMerchants(aTx, { mode: 'range', from: '2026-07-01', to: '2026-07-05' });
ok('period: range-scoped top merchants', rangeTop[0].totalFils === 50000 && rangeTop.length === 2);

// ── salary-day month start (runs last: it mutates the global grouping) ──
fmt.setMonthStartDay(25);
ok('salary month: day before start belongs to previous month',
  fmt.monthKey('2026-07-24') === '2026-06');
ok('salary month: start day opens the new month', fmt.monthKey('2026-07-25') === '2026-07');
ok('salary month: start ISO uses the start day', fmt.monthStartISO('2026-07') === '2026-07-25');
ok('salary month: end is day before next start', fmt.monthEndISO('2026-06') === '2026-07-24');
ok('salary month: inPeriod follows the shifted boundary',
  per.inPeriod('2026-07-24', { mode: 'month', key: '2026-06' }) &&
  !per.inPeriod('2026-07-24', { mode: 'month', key: '2026-07' }));
ok('salary month: elapsed days counted from the start day',
  per.elapsedDays({ mode: 'month', key: '2026-06' }, new Date(2026, 6, 24), []) === 30);
ok('salary month: period end for a past month',
  per.periodEndISO({ mode: 'month', key: '2026-05' }, new Date(2026, 6, 24)) === '2026-06-24');
fmt.setMonthStartDay(1);
ok('calendar months restore cleanly', fmt.monthKey('2026-07-24') === '2026-07');

// ── Pro trial: 3 free days, then the paywall ──
const purch = require('./build/purchases');
const T0 = new Date(2026, 6, 1).getTime();
const DAY = 86400000;
ok('trial: fresh install has full trial days',
  purch.trialDaysLeft({ trialStartTs: T0 }, T0) === 3);
ok('trial: pro active during trial',
  purch.isProActive({ pro: false, trialStartTs: T0 }, T0 + 2 * DAY + DAY / 2));
ok('trial: expires after day 3',
  !purch.isProActive({ pro: false, trialStartTs: T0 }, T0 + 3 * DAY + 1));
ok('trial: purchase beats an expired trial',
  purch.isProActive({ pro: true, trialStartTs: T0 }, T0 + 30 * DAY));

// ── market packs: automatic localization (runs last: mutates globals) ──
const markets = require('./build/markets');
const mparser = require('./build/sms-parser');

markets.setActiveMarket('SA');
ok('market: SAR renders in amounts', fmt.formatAED(123400) === 'SAR 1,234');
const saTx = mparser.parseSms(
  'Purchase of SAR 187.50 with Debit Card ending 1234 at PANDA RIYADH');
ok('market: Saudi SMS parses under the SA pack',
  saTx && saTx.amountFils === 18750 && saTx.categoryGuess === 'groceries');
const saBank = markets.bankFromSender('AlRajhi');
ok('market: Saudi bank recognized with logo domain',
  saBank && saBank.name === 'Al Rajhi' && saBank.domain === 'alrajhibank.com.sa');
const saUsd = mparser.parseSms(
  'USD 20.00 charged on Credit Card ending 4833 - OPENAI CHATGPT SUBSCRIPTION');
ok('market: USD converts into SAR under the SA pack',
  saUsd && saUsd.amountFils === 7500); // 20 * 3.75 * 100
ok('market: STC categorized as telecom in SA',
  mparser.guessCategory('Payment to STC bill', 'expense') === 'telecom');

markets.setActiveMarket('AE');
ok('market: AED restores cleanly', fmt.formatAED(123400) === 'AED 1,234');
const aeAgain = mparser.parseSms(
  'Purchase of AED 187.50 with Debit Card ending 1234 at CARREFOUR');
ok('market: UAE parsing unchanged after switching back',
  aeAgain && aeAgain.amountFils === 18750);

// ── reliable balances: only bank-quoted or fully-manual figures count ──
const bal = require('./build/balances');
const mkAcc = (over) => ({
  id: over.id, name: over.id, kind: 'bank', openingFils: 0, color: '#000', ...over,
});
const balState = {
  accounts: [
    mkAcc({ id: 'cc-quoted', kind: 'card', cardType: 'credit', snapshotKind: 'outstanding', snapshotFils: 406100 }),
    mkAcc({ id: 'cc-limit-only', kind: 'card', cardType: 'credit', snapshotKind: 'limit', snapshotFils: 1200000 }),
    mkAcc({ id: 'debit-quoted', kind: 'card', cardType: 'debit', snapshotKind: 'balance', snapshotFils: 1250000 }),
    mkAcc({ id: 'debit-sms-no-snap', kind: 'card', cardType: 'debit' }),
    mkAcc({ id: 'manual-cash', kind: 'cash', openingFils: 50000 }),
    mkAcc({ id: 'archived-quoted', snapshotKind: 'balance', snapshotFils: 999900, archived: true }),
  ],
  transactions: [
    { id: 'b1', accountId: 'debit-sms-no-snap', type: 'expense', amountFils: 108873_00, date: '2026-07-01', title: 'X', category: 'other', source: 'sms' },
    { id: 'b2', accountId: 'manual-cash', type: 'expense', amountFils: 10000, date: '2026-07-02', title: 'Y', category: 'other', source: 'manual' },
  ],
};
ok('reliable: credit card uses bank outstanding as negative',
  bal.reliableBalanceFils(balState, balState.accounts[0]) === -406100);
ok('reliable: credit card with only a limit snapshot is unknowable',
  bal.reliableBalanceFils(balState, balState.accounts[1]) === null);
ok('reliable: debit card uses bank balance snapshot',
  bal.reliableBalanceFils(balState, balState.accounts[2]) === 1250000);
ok('reliable: SMS-fed account without a quote never shows derived garbage',
  bal.reliableBalanceFils(balState, balState.accounts[3]) === null);
ok('reliable: fully-manual account derives from opening + entries',
  bal.reliableBalanceFils(balState, balState.accounts[4]) === 40000);
ok('net worth sums only reliable, skips archived',
  bal.netWorthFils(balState) === -406100 + 1250000 + 40000);

// ── One payment must not settle two overlapping statements ──
const allocLib = require('./build/cards');
const allocAccount = {
  id: 'c1', name: 'FAB Credit Card', kind: 'card', cardType: 'credit', openingFils: 0, color: '#fff',
};
const mkAlloc = (payments) => ({
  accounts: [allocAccount],
  cardDues: [
    { id: 'd_jun', accountId: 'c1', totalDueFils: 100000, minDueFils: 10000, dueDate: '2026-06-15', paidFils: 0 },
    { id: 'd_jul', accountId: 'c1', totalDueFils: 100000, minDueFils: 10000, dueDate: '2026-07-15', paidFils: 0 },
  ],
  transactions: payments.map((p, i) => ({
    id: `t${i}`, type: 'income', isTransfer: true, accountId: 'c1',
    amountFils: p.amountFils, date: p.date, category: 'other', title: 'card payment', source: 'manual',
  })),
});

const oneCoversOne = mkAlloc([{ amountFils: 100000, date: '2026-06-10' }]);
ok('dues: a single payment settles only the statement it covers',
  allocLib.duePaidFils(oneCoversOne, oneCoversOne.cardDues[0]) === 100000 &&
  allocLib.duePaidFils(oneCoversOne, oneCoversOne.cardDues[1]) === 0);
ok('dues: the unpaid second statement stays open',
  allocLib.openDues(oneCoversOne, new Date(2026, 6, 20)).length === 1);

const overpay = mkAlloc([{ amountFils: 150000, date: '2026-06-10' }]);
ok('dues: an overpayment spills onto the next statement',
  allocLib.duePaidFils(overpay, overpay.cardDues[0]) === 100000 &&
  allocLib.duePaidFils(overpay, overpay.cardDues[1]) === 50000);

const bothPaid = mkAlloc([
  { amountFils: 100000, date: '2026-06-10' },
  { amountFils: 100000, date: '2026-07-10' },
]);
ok('dues: two payments settle two statements',
  allocLib.openDues(bothPaid, new Date(2026, 6, 20)).length === 0);

// ── "Mark paid" must settle its own statement only ──
// The reducer records a transfer and leaves paidFils at 0, so the payment is
// counted once. Previously it did both and the surplus settled the next month.
const markPaidState = {
  accounts: [allocAccount],
  cardDues: [
    { id: 'd_jun', accountId: 'c1', totalDueFils: 100000, minDueFils: 10000, dueDate: '2026-06-15', paidFils: 0, settledAt: '2026-06-20T10:00:00Z' },
    { id: 'd_jul', accountId: 'c1', totalDueFils: 100000, minDueFils: 10000, dueDate: '2026-07-15', paidFils: 0 },
  ],
  transactions: [{
    id: 'p1', type: 'income', isTransfer: true, accountId: 'c1', amountFils: 100000,
    date: '2026-06-20', category: 'other', title: 'FAB payment', source: 'manual',
  }],
};
ok('dues: marking June paid does not settle the July statement',
  allocLib.duePaidFils(markPaidState, markPaidState.cardDues[1]) === 0);
ok('dues: the June payment still covers June',
  allocLib.duePaidFils(markPaidState, markPaidState.cardDues[0]) === 100000);
ok('dues: July stays open after June is marked paid',
  allocLib.openDues(markPaidState, new Date(2026, 6, 20)).length === 1);

// ── One charge is not a subscription ──
const subsLib2 = require('./build/subscriptions');
const oneOff = (title, date) => ({
  id: title + date, type: 'expense', amountFils: 1999, category: 'entertainment',
  accountId: 'a1', title, date, source: 'sms',
});
ok('subs: a single charge from a known merchant is not a subscription',
  subsLib2.detectSubscriptions([oneOff('Amazon Prime', '2026-07-10')], [], new Date(2026, 6, 25)).length === 0);
ok('subs: two charges a month apart still detect',
  subsLib2.detectSubscriptions(
    [oneOff('Amazon Prime', '2026-06-10'), oneOff('Amazon Prime', '2026-07-10')],
    [], new Date(2026, 6, 25),
  ).length === 1);

// ── A hand-corrected row survives re-parsing ──
// buildImportPlan heals rows the parser now reads better. A row the user
// corrected must be exempt, or every rescan silently undoes their work.
const healLib = require('./build/sms-parser');
const healPrior = {
  id: 'tx1', type: 'expense', amountFils: 5000, category: 'other', accountId: 'a1',
  title: 'Card purchase', date: '2026-07-10', source: 'sms', smsKey: 's1752100000000-5000',
  raw: 'Purchase of AED 50.00 at CARREFOUR with Credit Card ending 1234',
};
const healParsed = healLib.parseSms(healPrior.raw);
// This is what makes the guard matter: without it, re-parsing WOULD rewrite
// this row's title and category on the next launch.
ok('heal: re-parsing a stored row does produce a different title and category',
  healParsed.merchant === 'Carrefour' &&
  healParsed.categoryGuess === 'groceries' &&
  healParsed.merchant !== healPrior.title &&
  healParsed.categoryGuess !== healPrior.category);
// NOTE: the userEdited short-circuit itself lives in auto-import.ts and
// store.tsx, neither of which the harness can load (native module imports,
// JSX). Covering it needs the heal decision extracted into a pure module.

// ── A blank transaction title must not auto-pay bills ──
const billsLib = require('./build/bills');
const blankTitled = [{
  id: 'b1', type: 'expense', isTransfer: false, accountId: 'a1', amountFils: 20000,
  date: '2026-07-05', category: 'utilities', title: '***', source: 'sms',
}];
ok('bills: a row whose title normalizes to nothing never marks a bill paid',
  billsLib.billsForMonth(
    [{ id: 'bill1', title: 'DEWA', amountFils: 20000, dueDay: 10, paidMonths: [] }],
    blankTitled,
    new Date(2026, 6, 6),
  )[0].status !== 'paid');

// ── Recurring detection: bills vs subscriptions ──
const mkTx = (title, category, amountFils, date, i) => ({
  id: `r${title}${i}`, type: 'expense', isTransfer: false, accountId: 'a1',
  amountFils, date, category, title, source: 'sms',
});

// A utility bill's amount is never stable — that IS what a utility bill is.
// Requiring ±15% stability left the Utilities tab empty for someone paying
// four of them a month.
const sewa = ['2026-04-10', '2026-05-11', '2026-06-10', '2026-07-10'].map((d, i) =>
  mkTx('SEWA', 'utilities', [28000, 45300, 31200, 52000][i], d, i));
const sewaFound = subsLib.detectSubscriptions(sewa, [], new Date(2026, 6, 25));
ok('recurring: a utility with swinging amounts is still detected',
  sewaFound.length === 1 && sewaFound[0].group === 'utility');

// ...but an unstable NON-bill merchant is still just repeat shopping.
const shop = ['2026-04-10', '2026-05-11', '2026-06-10', '2026-07-10'].map((d, i) =>
  mkTx('Corner Shop', 'groceries', [1200, 9800, 3100, 20400][i], d, i));
ok('recurring: an unstable shop is not a subscription',
  subsLib.detectSubscriptions(shop, [], new Date(2026, 6, 25)).length === 0);

// One misparsed charge must not set the price. Canva appeared at AED 18,313/mo
// because known merchants skipped the stability gate entirely.
const canva = ['2026-03-18', '2026-04-18', '2026-05-18', '2026-06-18'].map((d, i) =>
  mkTx('Canva', 'entertainment', [5500, 5500, 1831300, 5500][i], d, i));
const canvaFound = subsLib.detectSubscriptions(canva, [], new Date(2026, 6, 25));
ok('recurring: an outlier charge does not become the price',
  canvaFound.length === 1 && canvaFound[0].avgAmountFils === 5500);

// A single low first charge (proration) made every steady service read as a
// price rise — Google One was flagged "price up" the month it went down.
const gone = ['2026-04-02', '2026-05-02', '2026-06-02', '2026-07-02'].map((d, i) =>
  mkTx('Google One', 'entertainment', [900, 2500, 2500, 2500][i], d, i));
const goneFound = subsLib.detectSubscriptions(gone, [], new Date(2026, 6, 25));
ok('recurring: a prorated first charge is not a price rise',
  goneFound.length === 1 && goneFound[0].priceIncreased === false);

// A real rise still reports.
const rise = ['2026-04-02', '2026-05-02', '2026-06-02', '2026-07-02'].map((d, i) =>
  mkTx('Netflix', 'entertainment', [4000, 4000, 4000, 5600][i], d, i));
const riseFound = subsLib.detectSubscriptions(rise, [], new Date(2026, 6, 25));
ok('recurring: a real price rise still reports',
  riseFound.length === 1 && riseFound[0].priceIncreased === true);

// A tier upgrade is the new price, not an outlier. Google One went from
// AED 7.99 to AED 76.99 and the app kept reporting 7 for months.
const upgrade = ['2026-02-02','2026-03-02','2026-04-02','2026-05-02','2026-06-02','2026-07-02']
  .map((d, i) => mkTx('Google One', 'entertainment', [799, 799, 799, 7699, 7699, 7699][i], d, i));
const upFound = subsLib.detectSubscriptions(upgrade, [], new Date(2026, 6, 25));
ok('recurring: an upgrade becomes the reported price',
  upFound.length === 1 && upFound[0].avgAmountFils === 7699,
  JSON.stringify(upFound[0] && upFound[0].avgAmountFils));
ok('recurring: an upgrade reports as a price rise', upFound[0]?.priceIncreased === true);

// ...but one bad parse among steady charges still must not set the price.
const glitch = ['2026-03-18','2026-04-18','2026-05-18','2026-06-18','2026-07-18']
  .map((d, i) => mkTx('Canva', 'entertainment', [5500, 5500, 1831300, 5500, 5500][i], d, i));
const glitchFound = subsLib.detectSubscriptions(glitch, [], new Date(2026, 6, 25));
ok('recurring: a single bad parse still does not set the price',
  glitchFound.length === 1 && glitchFound[0].avgAmountFils === 5500,
  JSON.stringify(glitchFound[0] && glitchFound[0].avgAmountFils));

// ── Bundled brand marks ──
const { brandMarkFor } = require('./build/brand-marks');

// Matched against the title the PARSER produces, not the raw descriptor.
for (const [title, mark] of [
  ['Noon', 'n'], ['Tabby', 'tb'], ['YouTube Premium', 'yt'], ['Apple', 'ap'],
  ['Steam', 'st'], ['Kokoro Qlub', 'ql'], ['Kitopi', 'kt'], ['Capital.com', 'cp'],
  ['Name.com', 'dn'], ['Claude', 'cl'], ['ChatGPT', 'ai'], ['Exinity Me Ltd', 'ex'],
  ['Road & Transport Auth', 'rta'], ['% Arabica', '%'], ['Carrefour', 'cf'],
]) {
  ok(`brand mark: ${title} → ${mark}`, brandMarkFor(title)?.mark === mark);
}

// Unknown merchants must fall through to the category glyph, and near-misses
// must not borrow a brand they only share letters with.
for (const title of [
  'Al Nimar Al Abyadh', 'Account debit', 'Pineapple Cafe', 'Dubai Families',
  'ATM withdrawal', 'Transfer to Khalid Rashid', '',
]) {
  ok(`brand mark: "${title}" has none`, brandMarkFor(title) === null);
}

// Every mark must be short enough for the avatar's three size steps, and no
// two brands may share a colour AND a mark (they'd be indistinguishable).
const seenMarks = new Map();
let markShapeOk = true;
let markClash = '';
for (const title of [
  'Noon', 'Tabby', 'Tamara', 'Amazon', 'AliExpress', 'Shein', 'Temu', 'Namshi',
  'IKEA', 'Sharaf DG', 'Dubizzle', 'Decathlon', 'Nike', 'Adidas', 'GMG Consumer',
  'Al Shaya', 'Virgin Megastore', 'Carrefour', 'Lulu', 'Spinneys', 'Union Coop',
  'Choithram', 'Nesto', 'InstaShop', 'Talabat', 'Deliveroo', 'Kokoro Qlub',
  'Kitopi', 'Starbucks', 'Tim Hortons', 'Costa', 'McDonalds', 'KFC', 'Pizza Hut',
  'Dominos', 'Subway', '% Arabica', 'Careem', 'Uber', 'Salik', 'RTA', 'ADNOC',
  'ENOC', 'Emarat', 'Emirates', 'flydubai', 'Etihad', 'Air Arabia', 'Booking',
  'Airbnb', 'DragonPass', 'DEWA', 'SEWA', 'Etisalat', 'Du', 'Apple',
  'YouTube Premium', 'Netflix', 'Spotify', 'Anghami', 'Shahid', 'OSN+', 'Disney+',
  'Steam', 'PlayStation Plus', 'Xbox Game Pass', 'ChatGPT', 'Claude', 'OpenRouter',
  'Perplexity', 'Cursor', 'GitHub', 'Notion', 'Canva', 'Adobe', 'Microsoft 365',
  'LinkedIn', 'Dropbox', 'Fiverr', 'Google One', 'Hetzner', 'Vercel', 'Namecheap',
  'Kickresume', 'Mailsuite', 'eToro', 'Capital.com', 'Binance', 'Crypto.com',
  'Exinity', 'Ziina', 'VOX Cinemas', 'Reel Cinemas', 'Novo Cinemas', 'Zomato',
  'Discord', 'Telegram Premium', 'Audible', 'Real-Debrid', 'AllDebrid',
]) {
  const b = brandMarkFor(title);
  if (!b) { markShapeOk = false; markClash ||= `${title} resolved to nothing`; continue; }
  if (b.mark.length < 1 || b.mark.length > 3) {
    markShapeOk = false;
    markClash ||= `${title} mark "${b.mark}" is not 1-3 chars`;
  }
  if (!/^#[0-9A-Fa-f]{6}$/.test(b.color)) {
    markShapeOk = false;
    markClash ||= `${title} color "${b.color}" is not a 6-digit hex`;
  }
  const key = `${b.mark}|${b.color}`;
  if (seenMarks.has(key)) {
    markShapeOk = false;
    markClash ||= `${title} is indistinguishable from ${seenMarks.get(key)}`;
  }
  seenMarks.set(key, title);
}
ok(`brand marks: every mark is 1-3 chars, hex-coloured and distinguishable${markClash ? ` (${markClash})` : ''}`, markShapeOk);

// ── leaving soon ──
// Home used to answer "what leaves next" three times in three orders; this is
// the single merged list behind it.
const lsToday = new Date(2026, 6, 18); // 18 Jul 2026
const lsBase = {
  hydrated: true,
  accounts: [
    { id: 'card1', name: 'FAB Credit Card', kind: 'card', openingFils: 0, color: '#000', cardType: 'credit' },
  ],
  transactions: [],
  budgets: [],
  bills: [],
  cardDues: [],
  goals: [],
  merchantOverrides: {},
  accountHints: {},
  notSubscriptions: [],
  lastScanTs: 0,
  onboarded: true,
  userName: 'there',
  appLock: false,
  remindersOn: true,
  monthStartDay: 1,
  pro: true,
  trialStartTs: 0,
  marketId: 'AE',
  language: 'en',
};

const lsDueState = {
  ...lsBase,
  cardDues: [
    { id: 'd1', accountId: 'card1', totalDueFils: 100000, minDueFils: 20000, dueDate: '2026-07-22', paidFils: 0 },
  ],
  bills: [{ id: 'b1', title: 'DEWA', category: 'utilities', amountFils: 45000, dueDay: 25, paidMonths: [] }],
};
const lsRows = leaving.leavingSoon(lsDueState, lsToday);
eq('leavingSoon merges dues and bills', lsRows.length, 2);
eq('leavingSoon sorts by how soon', lsRows.map((r) => r.kind), ['card', 'bill']);
eq('leavingSoon totals the window', leaving.outgoingTotalFils(lsRows), 145000);

// The window is a real cut-off, not a sort key.
eq('leavingSoon drops anything past the window',
  leaving.leavingSoon(lsDueState, lsToday, { withinDays: 5 }).length, 1);
eq('leavingSoon can ask for one kind',
  leaving.leavingSoon(lsDueState, lsToday, { kinds: ['bill'] }).map((r) => r.kind), ['bill']);

// A statement past its pay-by date still has to show, and show as late.
const lsLate = leaving.leavingSoon(
  { ...lsDueState, cardDues: [{ ...lsDueState.cardDues[0], dueDate: '2026-07-15' }] },
  lsToday,
);
ok('leavingSoon keeps an overdue statement', lsLate.some((r) => r.overdue && r.kind === 'card'));
eq('daysPhrase late', leaving.daysPhrase(-3), '3 days late');
eq('daysPhrase today', leaving.daysPhrase(0), 'today');
eq('daysPhrase tomorrow', leaving.daysPhrase(1), 'tomorrow');
eq('daysPhrase future', leaving.daysPhrase(5), 'in 5 days');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
