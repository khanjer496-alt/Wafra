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
// A net of -20 fils rounds to zero; "AED -0" is not a figure.
eq('formatAED sub-dirham negative is not -0', fmt.formatAED(-20, { decimals: false }), 'AED 0');
eq('formatAED sub-dirham negative keeps its sign with decimals', fmt.formatAED(-20), 'AED -0.20');
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

// ── the nightly spend summary ──
//
// A digest that disagrees with the screen it summarises is worse than none:
// the whole point is that the user can trust it without opening the app.
{
  const ds = require('./build/daily-summary.js');
  const acct = (id, over = {}) => ({ id, name: id, kind: 'bank', openingFils: 0, color: '#fff', ...over });
  const row = (id, title, fils, over = {}) => ({ id, type: 'expense', amountFils: fils,
    category: 'shopping', accountId: 'a1', title, date: '2026-08-06', source: 'sms', ...over });
  const base = {
    accounts: [acct('a1'), acct('a2')], budgets: [], bills: [], goals: [], cardDues: [],
    transactions: [], accountHints: {}, merchantOverrides: {},
  };

  ok('summary: a day with no spending says nothing at all',
    ds.buildDailySummary(base, '2026-08-06') === null);

  const day = { ...base, transactions: [
    row('t1', 'Noon Minutes', 3557),
    row('t2', 'Adnoc', 24001),
    row('t3', 'Dufry Sharjah', 22232),
    row('t4', 'Ginnys Plus Trading', 2700),
    row('t5', 'Noon', 5897),
    row('t6', 'Yesterday', 999900, { date: '2026-08-05' }),
    row('t7', 'Income', 500000, { type: 'income' }),
  ] };
  const s1 = ds.buildDailySummary(day, '2026-08-06');
  eq('summary: the total is the day\'s spending only', s1.totalFils, 3557 + 24001 + 22232 + 2700 + 5897);
  eq('summary: and the count matches it', s1.count, 5);
  ok('summary: another day is not in it', !s1.body.includes('Yesterday'));
  ok('summary: income is not spending', !s1.body.includes('Income'));
  // Largest first: a lock screen gets four seconds and the big row is the one
  // worth them.
  ok('summary: the largest row is named first',
    s1.body.indexOf('Adnoc') < s1.body.indexOf('Noon Minutes'), s1.body);

  // A move between the user's own accounts is not spending. Announcing one as
  // a day's expenses is the loudest possible way to get an app muted.
  const swept = { ...base, transactions: [
    row('o', 'Outgoing transfer', 2000000, { isTransfer: true }),
    row('i', 'Incoming transfer', 2000000, { type: 'income', accountId: 'a2', isTransfer: true }),
    row('real', 'Spinneys', 12000),
  ] };
  const s2 = ds.buildDailySummary(swept, '2026-08-06');
  eq('summary: an internal sweep is not spending', s2.totalFils, 12000);
  eq('summary: ...and does not pad the count', s2.count, 1);

  // Six rows: five named, the rest collapsed rather than a wall of text.
  const many = { ...base, transactions: Array.from({ length: 8 }, (_, i) =>
    row(`m${i}`, `Shop ${i}`, 1000 + i)) };
  const s3 = ds.buildDailySummary(many, '2026-08-06');
  eq('summary: only the top rows are named', s3.body.split('\n').filter((l) => l.startsWith('AED')).length, ds.SUMMARY_ROWS);
  ok('summary: the rest are counted, not dropped', /\+3 more/.test(s3.body), s3.body);

  // The budget line compares like with like: spending in the categories that
  // HAVE a limit, against the sum of those limits.
  const budgeted = { ...base,
    budgets: [{ category: 'shopping', limitFils: 100000 }],
    transactions: [row('t1', 'Noon', 25000), row('r', 'Rent', 500000, { category: 'rent' })],
  };
  const s4 = ds.buildDailySummary(budgeted, '2026-08-06');
  ok('summary: unbudgeted categories do not blow past the limit',
    /25%/.test(s4.body) && !/525%/.test(s4.body), s4.body);
  ok('summary: no limits set means no budget line',
    !/%/.test(ds.buildDailySummary(day, '2026-08-06').body));
}

// ── a fixed bill reconciles against the charge that paid it ──
//
// The two Etisalat charges that started this: no SMS at all, only an ADCB app
// notification, described as "MB BILL DR:ETISALAT TELEP DUBAI". Containment
// was the whole matching rule, so a bill the user called "Etisalat internet"
// never nested with that title and sat overdue with the money already gone.
{
  const day = new Date(2026, 7, 15);
  const charge = (id, title, fils) => ({ id, type: 'expense', amountFils: fils,
    category: 'telecom', accountId: 'a', title, date: '2026-08-04', source: 'sms' });
  const bill = (id, title, fils) => ({ id, title, category: 'telecom',
    amountFils: fils, dueDay: 10, paidMonths: [] });
  const telep = charge('t1', 'Etisalat Telep', 45045);
  const gsm = charge('t2', 'Etisalat Gsm', 31395);
  const statusOf = (bs, txs, id) =>
    bills.billsForMonth(bs, txs, day).find((r) => r.bill.id === id).status;

  eq('bill: a payee token reconciles a bill whose name does not nest',
    statusOf([bill('b1', 'Etisalat internet', 45000)], [telep, gsm], 'b1'), 'paid');
  // Two bills from one company, each with its own charge, both settle.
  const twoBills = [bill('b1', 'Etisalat internet', 45000), bill('b2', 'Etisalat mobile', 31000)];
  eq('bill: two bills from one payee each take their own charge (a)',
    statusOf(twoBills, [telep, gsm], 'b1'), 'paid');
  eq('bill: two bills from one payee each take their own charge (b)',
    statusOf(twoBills, [telep, gsm], 'b2'), 'paid');
  // ...but when one charge could be either bill, it settles NEITHER. Marking a
  // bill paid that was not is the expensive direction: the user stops looking.
  const ambiguous = [bill('b1', 'Etisalat internet', 45000), bill('b2', 'Etisalat mobile', 44000)];
  eq('bill: one charge two bills could both claim settles neither (a)',
    statusOf(ambiguous, [telep], 'b1'), 'overdue');
  eq('bill: one charge two bills could both claim settles neither (b)',
    statusOf(ambiguous, [telep], 'b2'), 'overdue');
  // A word naming the KIND of bill is not evidence of the payee.
  eq('bill: a generic word is not a payee match',
    statusOf([bill('b1', 'Internet', 45000)], [telep], 'b1'), 'overdue');
  eq('bill: another telecom at a similar amount is not a match',
    statusOf([bill('b1', 'du home internet', 45000)], [telep], 'b1'), 'overdue');
  // The exact rule that already worked still works, and still needs no
  // corroboration — a nesting title settles even when another bill also claims
  // the charge.
  eq('bill: an exactly nesting title still settles',
    statusOf([bill('b1', 'Etisalat', 45000)], [telep], 'b1'), 'paid');
}

// A money month starting on a salary day spans two calendar months, so the
// paid flag (keyed to the money month) and the countdown (calendar
// arithmetic) were describing different months.
{
  fmt.setMonthStartDay(25);
  // Money month '2026-06' runs 25 Jun – 24 Jul. Today 20 Jul is inside it.
  const t = new Date(2026, 6, 20);
  eq('money month: a day-28 bill belongs to the June money month',
    bills.dueDateInMonth('2026-06', 28), '2026-06-28');
  eq('money month: a day-3 bill falls in the second calendar month',
    bills.dueDateInMonth('2026-06', 3), '2026-07-03');
  eq('money month: day 31 clamps to a day that exists',
    bills.dueDateInMonth('2026-01', 31), '2026-01-31');
  // The bug: due 28th, paid 28 June, viewed 20 July. It read "Paid" (money
  // month 2026-06) while counting down 8 days to 28 JULY, a different month.
  const paidRow = bills.billsForMonth([mkBill(28, ['2026-06'])], [], t)[0];
  ok('money month: a bill paid this money month stays paid', paidRow.status === 'paid');
  eq('money month: and its date is the one it was paid on, not next month',
    paidRow.dueISO, '2026-06-28');
  ok('money month: its countdown agrees with that date', paidRow.daysLeft === -22);
  fmt.setMonthStartDay(1);
}
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
// Against SEED_HISTORY_MONTHS, not a hardcoded 4. The literal was written when
// the demo covered four months; the constant moved to six and the assertion did
// not, so this went red for a seed that was behaving exactly as designed.
ok('seed has salary each month',
  s1.filter(t => t.title === 'Salary').length === seed.SEED_HISTORY_MONTHS,
  `${s1.filter(t => t.title === 'Salary').length} of ${seed.SEED_HISTORY_MONTHS}`);
ok('seed no future dates', s1.every(t => t.date <= '2026-07-18'));
ok('seed reasonable volume', s1.length > 100 && s1.length < 500, `len=${s1.length}`);


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

// ── the card derivations are memoised on input IDENTITY ──
//
// `cardFigure` calls `openDues` and picks one row out of it, and Wallet calls
// `cardFigure` once per card: 17 full payment allocations over the whole
// ledger to answer 17 questions with one answer. Memoising it is only safe
// while three things hold, so all three are asserted rather than assumed.
{
  const memoDay = new Date(2026, 6, 24);
  // 1. A repeat call with the same state gives the same answer.
  const first = cardsGuardLib.openDues(guardState, memoDay);
  const second = cardsGuardLib.openDues(guardState, memoDay);
  ok('openDues: a cached answer equals the computed one',
    JSON.stringify(first) === JSON.stringify(second));
  // 2. ...but never the same ARRAY. A caller that sorts its list in place must
  //    not corrupt what every later reader in the frame sees.
  ok('openDues: each caller gets its own array',
    first !== second);
  first.length = 0;
  ok('openDues: emptying one caller\'s list leaves the next intact',
    cardsGuardLib.openDues(guardState, memoDay).length === second.length);
  // 3. A new state object must invalidate. The store is a reducer, so changed
  //    data always means a changed reference — if identity did not invalidate,
  //    the app would show last frame's numbers forever.
  const paidState = {
    ...guardState,
    transactions: [{
      id: 'pay', type: 'income', amountFils: 406100, category: 'other', accountId: 'cc',
      title: 'Card payment', date: '2026-07-08', source: 'sms', isTransfer: true,
    }],
  };
  ok('openDues: a new transactions array invalidates the cache',
    !cardsGuardLib.openDues(paidState, memoDay).some((d) => d.due.id === 'g1'));
  ok('openDues: and the old state still reads the same as before',
    cardsGuardLib.openDues(guardState, memoDay).some((d) => d.due.id === 'g1'));
  // 4. The day is part of the key: the same ledger read tomorrow is a
  //    different answer, and an app left open overnight must not keep
  //    yesterday's "days left".
  const laterDay = cardsGuardLib.openDues(guardState, new Date(2026, 6, 25));
  ok('openDues: a day later is a day fewer',
    laterDay.find((d) => d.due.id === 'g1').daysLeft ===
      second.find((d) => d.due.id === 'g1').daysLeft - 1);
}

// ── one settlement, two rows, must not be two payments ──
//
// A reported ledger had AED 5,645.07 paid onto card •3749 with both a sided
// settlement row and the older unsided compat shape against it on the same
// day. Allocation saw AED 11,290.14. It settled the right statement — nothing
// takes more than a statement owes — but the surplus spills onto the NEXT one
// and marks a bill paid that nobody paid.
{
  const dupState = {
    accounts: [
      { id: 'c', name: 'FAB Credit Card', kind: 'card', cardType: 'credit', last4: '3749', openingFils: 0, color: '#fff' },
    ],
    transactions: [
      { id: 'sided', type: 'income', amountFils: 564507, category: 'other', accountId: 'c',
        title: 'Card •3749 payment', date: '2026-08-05', source: 'sms', isTransfer: true,
        cardPaymentSide: 'debit' },
      { id: 'compat', type: 'expense', amountFils: 564507, category: 'other', accountId: 'c',
        title: 'Card payment', date: '2026-08-05', source: 'sms', isTransfer: true },
    ],
    cardDues: [
      { id: 'aug', accountId: 'c', totalDueFils: 564507, minDueFils: 28225, dueDate: '2026-08-26', paidFils: 0 },
      { id: 'sep', accountId: 'c', totalDueFils: 400000, minDueFils: 20000, dueDate: '2026-09-26', paidFils: 0 },
    ],
  };
  ok('pairing: the settlement the payment was for is paid',
    cardsGuardLib.duePaidFils(dupState, dupState.cardDues[0]) === 564507);
  ok('pairing: the surplus does NOT spill onto next month',
    cardsGuardLib.duePaidFils(dupState, dupState.cardDues[1]) === 0,
    String(cardsGuardLib.duePaidFils(dupState, dupState.cardDues[1])));

  // ...and the compat shape ALONE still settles. It is the only record of a
  // payment on ledgers imported before the parser could read that wording, and
  // dropping it unconditionally would reopen every one of those statements.
  const compatOnly = { ...dupState, transactions: [dupState.transactions[1]] };
  ok('pairing: an unsided compat payment on its own still settles the statement',
    cardsGuardLib.duePaidFils(compatOnly, compatOnly.cardDues[0]) === 564507);

  // Two REAL payments of the same amount on different days stay two payments.
  // Both statements are dated so that both payments fall inside their windows —
  // otherwise this would pass for the wrong reason, with the second payment
  // dropped as too early rather than counted.
  const twoDays = {
    ...dupState,
    transactions: [
      dupState.transactions[0],
      { ...dupState.transactions[1], id: 'later', date: '2026-08-06' },
    ],
    cardDues: [
      { id: 'aug', accountId: 'c', totalDueFils: 564507, minDueFils: 28225, dueDate: '2026-08-26', paidFils: 0 },
      { id: 'sep', accountId: 'c', totalDueFils: 564507, minDueFils: 28225, dueDate: '2026-09-10', paidFils: 0 },
    ],
  };
  ok('pairing: same amount on different days is two payments, not one',
    cardsGuardLib.duePaidFils(twoDays, twoDays.cardDues[1]) === 564507);
}

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
// The copy quoting the fuller total wins — but a payment against the statement
// counts once, for the statement, not once per copy of it. Two rows of one
// statement where one carries a manual "Mark paid" of 4,000 owe 61, not 4,061:
// keeping the copy the payment never touched is how a paid card kept reading
// as unpaid, since the unpaid copy always owes more and always won.
{
  const copies = cardsGuardLib.openDues(
    {
      ...guardState,
      cardDues: [
        { id: 'p1', accountId: 'cc', totalDueFils: 406100, minDueFils: 20300, dueDate: '2026-07-10', paidFils: 400000 },
        { id: 'p2', accountId: 'cc', totalDueFils: 406100, minDueFils: 20300, dueDate: '2026-07-10', paidFils: 0 },
      ],
    },
    new Date(2026, 6, 24),
  );
  ok('openDues: one statement stored twice is one row', copies.length === 1);
  ok('openDues: a payment counts for the statement, not for each copy of it',
    copies[0].remainingFils === 6100);
}
// Two statements on one card is one obligation, not two. A credit card rolls
// what went unpaid into the next statement, so listing both charged the user
// the June balance twice — inside July's total and again on its own row.
{
  const twoDates = cardsGuardLib.openDues(
    {
      ...guardState,
      cardDues: [
        { id: 'd1', accountId: 'cc', totalDueFils: 406100, minDueFils: 20300, dueDate: '2026-07-10', paidFils: 0 },
        { id: 'd2', accountId: 'cc', totalDueFils: 520000, minDueFils: 26000, dueDate: '2026-07-28', paidFils: 0 },
      ],
    },
    new Date(2026, 6, 24),
  );
  ok('openDues: only the newest statement on a card is owed',
    twoDates.length === 1 && twoDates[0].due.id === 'd2');
  ok('openDues: the total is the newest statement, not the sum of both',
    twoDates[0].remainingFils === 520000);
}

// Similar metadata is not enough to collapse active accounts. A confirmed
// link or proven-empty artifact cleanup must happen before accounting pools
// anything, because two real cards can share bank/type/last4.
{
  const twoRows = {
    accounts: [
      { id: 'fab-a', name: 'FAB Credit Card •5793', kind: 'card', cardType: 'credit', last4: '5793', bankName: 'FAB', openingFils: 0, color: '#fff' },
      { id: 'fab-b', name: 'FAB Credit Card •5793', kind: 'card', cardType: 'credit', last4: '5793', bankName: 'FAB', openingFils: 0, color: '#fff' },
      { id: 'enbd', name: 'ENBD Credit Card •5793', kind: 'card', cardType: 'credit', last4: '5793', bankName: 'Emirates NBD', openingFils: 0, color: '#fff' },
    ],
    transactions: [],
    cardDues: [
      { id: 'x1', accountId: 'fab-a', totalDueFils: 814400, minDueFils: 40000, dueDate: '2026-07-15', paidFils: 0 },
      { id: 'x2', accountId: 'fab-b', totalDueFils: 814400, minDueFils: 40000, dueDate: '2026-07-15', paidFils: 0 },
      { id: 'x3', accountId: 'enbd', totalDueFils: 406200, minDueFils: 20000, dueDate: '2026-07-15', paidFils: 0 },
    ],
  };
  const rows = cardsGuardLib.openDues(twoRows, new Date(2026, 6, 20));
  ok('dues: two active same-bank same-suffix accounts both remain visible',
    rows.filter(d => d.due.dueDate === '2026-07-15' && d.remainingFils === 814400).length === 2);
  ok('dues: a different bank with the same last4 remains visible too',
    rows.length === 3 && rows.some((d) => d.due.accountId === 'enbd'));
}

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
// The month-start bug the user hit: the reporting period is chosen on first
// render, when the start day is still the default 1, and hydration then moves
// every date into a DIFFERENT month key. Nothing recomputed the period, so the
// app sat on a month that had not begun and showed zeros over a full ledger.
// This asserts the two keys really do disagree, which is what makes recomputing
// after hydration necessary rather than merely tidy.
fmt.setMonthStartDay(1);
const keyBeforeHydration = fmt.monthKey('2026-08-02');
fmt.setMonthStartDay(27);
const keyAfterHydration = fmt.monthKey('2026-08-02');
ok('the month a date belongs to CHANGES when the start day loads',
  keyBeforeHydration === '2026-08' && keyAfterHydration === '2026-07');
ok('a period fixed before hydration would hold none of that day\'s spending',
  keyBeforeHydration !== keyAfterHydration);

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

// ── A manual claim and the bank's confirmation of it are ONE payment ──
//
// "Mark paid" is stamped with the device's today; the bank's receipt carries
// the provider's date, and a payment made in the evening or over a weekend can
// land days later. At a ±1 day collapse window the pair imported as two
// payments of the same money, and the surplus poured into the NEXT statement
// and settled a bill nobody had paid.
const legCard = {
  id: 'c1', name: 'Card •1234', kind: 'card', cardType: 'credit', openingFils: 0, color: '#fff',
};
const mkLegs = (rows) => ({
  accounts: [legCard],
  cardDues: [
    { id: 'jul', accountId: 'c1', totalDueFils: 100000, minDueFils: 5000, dueDate: '2026-07-15', paidFils: 0, settledAt: '2026-07-10T18:00:00Z' },
    { id: 'aug', accountId: 'c1', totalDueFils: 80000, minDueFils: 4000, dueDate: '2026-08-15', paidFils: 0 },
  ],
  transactions: rows,
});
const manualJul10 = {
  id: 'm1', type: 'income', isTransfer: true, accountId: 'c1', amountFils: 100000,
  date: '2026-07-10', category: 'other', title: 'Card •1234 payment', source: 'manual',
};
const receiptJul12 = {
  id: 'r1', type: 'income', isTransfer: true, accountId: 'c1', amountFils: 100000,
  date: '2026-07-12', category: 'other', title: 'Payment received', source: 'sms',
  cardPaymentSide: 'receipt',
};
const skewedLegs = mkLegs([manualJul10, receiptJul12]);
ok('dues: a bank receipt two days after Mark paid is the same payment, not a second one',
  allocLib.duePaidFils(skewedLegs, skewedLegs.cardDues[1]) === 0);
ok('dues: the August statement the phantom leg had settled is still owed',
  allocLib.openDues(skewedLegs, new Date(2026, 7, 1)).length === 1 &&
  allocLib.openDues(skewedLegs, new Date(2026, 7, 1))[0].remainingFils === 80000);
ok('dues: and the July statement it really paid is still covered',
  allocLib.duePaidFils(skewedLegs, skewedLegs.cardDues[0]) === 100000);
// The far side of the same window: a manual claim does not swallow a bank leg
// from a different fortnight.
const distantLegs = mkLegs([
  manualJul10,
  { ...receiptJul12, id: 'r2', date: '2026-07-25' },
]);
ok('dues: a bank receipt fifteen days later is a different payment',
  allocLib.duePaidFils(distantLegs, distantLegs.cardDues[1]) === 80000);

// The SMS-vs-SMS window stays tight. Two bank alerts are two OBSERVATIONS of a
// movement the bank timestamps itself; widening that would fold a standing
// instruction's genuine repeat payments into one.
const twoBankLegs = mkLegs([
  { id: 'b1', type: 'income', isTransfer: true, accountId: 'c1', amountFils: 100000,
    date: '2026-07-08', category: 'other', title: 'Card payment', source: 'sms', cardPaymentSide: 'debit' },
  { id: 'b2', type: 'income', isTransfer: true, accountId: 'c1', amountFils: 100000,
    date: '2026-07-12', category: 'other', title: 'Card payment', source: 'sms', cardPaymentSide: 'receipt' },
]);
ok('dues: two bank alerts four days apart stay two payments',
  allocLib.duePaidFils(twoBankLegs, twoBankLegs.cardDues[1]) === 80000);
const adjacentBankLegs = mkLegs([
  { id: 'b1', type: 'income', isTransfer: true, accountId: 'c1', amountFils: 100000,
    date: '2026-07-09', category: 'other', title: 'Card payment', source: 'sms', cardPaymentSide: 'debit' },
  { id: 'b2', type: 'income', isTransfer: true, accountId: 'c1', amountFils: 100000,
    date: '2026-07-10', category: 'other', title: 'Card payment', source: 'sms', cardPaymentSide: 'receipt' },
]);
ok('dues: the two legs of one settlement a night apart are still one payment',
  allocLib.duePaidFils(adjacentBankLegs, adjacentBankLegs.cardDues[1]) === 0);

// The invariant the whole allocator exists for, restated over the wider window:
// two overlapping statements, one payment, counted exactly once.
const overlapOnce = mkLegs([manualJul10, receiptJul12]);
ok('dues: one payment across two overlapping statements is counted exactly once',
  allocLib.duePaidFils(overlapOnce, overlapOnce.cardDues[0]) +
  allocLib.duePaidFils(overlapOnce, overlapOnce.cardDues[1]) === 100000);

// ── "N payments matched" is a claim about ONE statement ──
//
// The card sheet answered it with its own filter — every income-side transfer
// ever made to the account, lifetime-wide, no statement and no date in it — so
// a card paid monthly for six months read "6 payments matched" beside a
// statement one payment had settled.
const matchedState = {
  accounts: [legCard],
  cardDues: [
    { id: 'jun', accountId: 'c1', totalDueFils: 100000, minDueFils: 5000, dueDate: '2026-06-15', paidFils: 0 },
    { id: 'jul', accountId: 'c1', totalDueFils: 100000, minDueFils: 5000, dueDate: '2026-07-15', paidFils: 0 },
  ],
  transactions: [
    { id: 'p_jun', type: 'income', isTransfer: true, accountId: 'c1', amountFils: 100000,
      date: '2026-06-10', category: 'other', title: 'card payment', source: 'sms' },
    { id: 'p_jul', type: 'income', isTransfer: true, accountId: 'c1', amountFils: 100000,
      date: '2026-07-10', category: 'other', title: 'card payment', source: 'sms' },
  ],
};
eq('dues: each statement names only the payment credited to it',
  [allocLib.duePayments(matchedState, matchedState.cardDues[0]).map((t) => t.id),
   allocLib.duePayments(matchedState, matchedState.cardDues[1]).map((t) => t.id)],
  [['p_jun'], ['p_jul']]);
// An overpayment really does pay into both, so it is named against both.
const spillState = {
  ...matchedState,
  transactions: [{
    id: 'big', type: 'income', isTransfer: true, accountId: 'c1', amountFils: 150000,
    date: '2026-06-10', category: 'other', title: 'card payment', source: 'sms',
  }],
};
eq('dues: a payment that spills is named against both statements it paid',
  [allocLib.duePayments(spillState, spillState.cardDues[0]).map((t) => t.id),
   allocLib.duePayments(spillState, spillState.cardDues[1]).map((t) => t.id)],
  [['big'], ['big']]);
// The reported symptom, stated as a number: six monthly payments, and the
// statement one of them settled says one — not six.
const sixMonths = {
  accounts: [legCard],
  cardDues: ['2026-03-15', '2026-04-15', '2026-05-15', '2026-06-15', '2026-07-15', '2026-08-15']
    .map((dueDate, i) => ({
      id: `d${i}`, accountId: 'c1', totalDueFils: 100000, minDueFils: 5000, dueDate, paidFils: 0,
    })),
  transactions: ['2026-03-10', '2026-04-10', '2026-05-10', '2026-06-10', '2026-07-10', '2026-08-10']
    .map((date, i) => ({
      id: `p${i}`, type: 'income', isTransfer: true, accountId: 'c1', amountFils: 100000,
      date, category: 'other', title: 'card payment', source: 'sms',
    })),
};
eq('dues: six monthly payments read as ONE against the statement one of them paid',
  allocLib.duePayments(sixMonths, sixMonths.cardDues[5]).map((t) => t.id), ['p5']);
ok('dues: the lifetime filter the sheet used to run would have said six',
  sixMonths.transactions.filter(
    (t) => t.accountId === 'c1' && t.isTransfer && t.type === 'income').length === 6);

// The two collapsed legs of one settlement are one matched payment, not two.
eq('dues: a settlement that arrived in two legs counts once in the matched list',
  allocLib.duePayments(skewedLegs, skewedLegs.cardDues[0]).length, 1);
// And the compat expense-side row `isCardPayment` credits is in the list too —
// the old filter required type === 'income' and never saw it.
const compatState = {
  accounts: [legCard],
  cardDues: [{ id: 'jul', accountId: 'c1', totalDueFils: 100000, minDueFils: 5000, dueDate: '2026-07-15', paidFils: 0 }],
  transactions: [{
    id: 'compat', type: 'expense', isTransfer: true, accountId: 'c1', amountFils: 100000,
    date: '2026-07-10', category: 'other', title: 'Card payment', source: 'sms',
  }],
};
ok('dues: the compat expense-side settlement row is a matched payment',
  allocLib.duePayments(compatState, compatState.cardDues[0]).length === 1 &&
  allocLib.duePaidFils(compatState, compatState.cardDues[0]) === 100000);

// ── The 40-day floor is deliberate, and stays ──
//
// A payment more than ~40 days before a due date belongs to the PREVIOUS
// statement's cycle, not this one. When that earlier statement was never
// captured — a first import, a card added late — crediting this one instead
// would say "nothing owed" about a balance that is genuinely owed, which is
// the expensive direction of error this whole file is written against. Leaving
// it uncredited leaves a balance the user can clear with Mark paid.
const floorState = (date) => ({
  accounts: [legCard],
  cardDues: [{ id: 'aug', accountId: 'c1', totalDueFils: 100000, minDueFils: 5000, dueDate: '2026-08-15', paidFils: 0 }],
  transactions: [{
    id: 'p', type: 'income', isTransfer: true, accountId: 'c1', amountFils: 100000,
    date, category: 'other', title: 'card payment', source: 'sms',
  }],
});
ok('dues: a payment inside the 40-day window settles the statement',
  allocLib.duePaidFils(floorState('2026-07-06'), floorState('2026-07-06').cardDues[0]) === 100000);
ok('dues: a payment from the previous cycle does not settle this statement',
  allocLib.duePaidFils(floorState('2026-07-05'), floorState('2026-07-05').cardDues[0]) === 0);

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

// ── The whole statement lifecycle: billed → part-paid → paid → settled ──
// Each stage asserts what the app TELLS the user, because every one of these
// figures is shown: the outstanding total, the "under your minimum" warning,
// and whether the card still appears as owing anything at all.
const lifeLib = require('./build/cards');
const lifeAccount = {
  id: 'cc1', name: 'ENBD Credit Card', kind: 'card', cardType: 'credit',
  last4: '8575', openingFils: 0, color: '#fff',
};
// One statement: AED 3,240 due 24 Jul, bank-stated minimum AED 162.
const lifeDue = {
  id: 'st1', accountId: 'cc1', totalDueFils: 324000, minDueFils: 16200,
  dueDate: '2026-07-24', paidFils: 0,
};
const cardPayment = (id, amountFils, date) => ({
  id, type: 'income', isTransfer: true, accountId: 'cc1', amountFils, date,
  category: 'other', title: 'Card •8575 payment', source: 'sms',
});
const lifeState = (payments, due = lifeDue) => ({
  accounts: [lifeAccount], cardDues: [due], transactions: payments,
});

// 1. Statement arrives, nothing paid.
const l1 = lifeState([]);
const l1s = lifeLib.dueWithStatus(l1, lifeDue, new Date(2026, 6, 20));
ok('lifecycle: a fresh statement owes its full total',
  l1s.remainingFils === 324000 && l1s.status === 'upcoming');
ok('lifecycle: a fresh statement is below its stated minimum', l1s.belowMinimum === true);
ok('lifecycle: a fresh statement is open', lifeLib.openDues(l1, new Date(2026, 6, 20)).length === 1);

// 2. Partial payment — AED 2,000 of 3,240. Above the minimum, still owing.
const l2 = lifeState([cardPayment('p1', 200000, '2026-07-18')]);
ok('lifecycle: a partial payment reduces the due, not settles it',
  lifeLib.duePaidFils(l2, lifeDue) === 200000);
const l2s = lifeLib.dueWithStatus(l2, lifeDue, new Date(2026, 6, 20));
ok('lifecycle: the partial remainder is total minus payment', l2s.remainingFils === 124000);
ok('lifecycle: a partial payment over the minimum clears the warning',
  l2s.belowMinimum === false && l2s.status === 'upcoming');
ok('lifecycle: a part-paid statement is still open',
  lifeLib.openDues(l2, new Date(2026, 6, 20)).length === 1);

// A payment under the stated minimum must still say so.
const l2min = lifeState([cardPayment('p1', 10000, '2026-07-18')]);
ok('lifecycle: a payment under the stated minimum still warns',
  lifeLib.dueWithStatus(l2min, lifeDue, new Date(2026, 6, 20)).belowMinimum === true);

// 3. The rest arrives — AED 1,240 more. Now fully paid.
const l3 = lifeState([
  cardPayment('p1', 200000, '2026-07-18'),
  cardPayment('p2', 124000, '2026-07-22'),
]);
ok('lifecycle: both payments together cover the statement',
  lifeLib.duePaidFils(l3, lifeDue) === 324000);
const l3s = lifeLib.dueWithStatus(l3, lifeDue, new Date(2026, 6, 23));
ok('lifecycle: a fully-paid statement owes nothing and reads settled',
  l3s.remainingFils === 0 && l3s.status === 'settled');
ok('lifecycle: a settled statement never reports below-minimum', l3s.belowMinimum === false);
ok('lifecycle: a fully-paid statement leaves openDues',
  lifeLib.openDues(l3, new Date(2026, 6, 23)).length === 0);

// 4. settledAt (set by "Mark paid") settles regardless of the arithmetic, and
//    keeps the statement out of the open list.
const l4due = { ...lifeDue, settledAt: '2026-07-24T09:00:00Z' };
const l4 = lifeState([], l4due);
ok('lifecycle: settledAt settles a statement on its own',
  lifeLib.dueWithStatus(l4, l4due, new Date(2026, 6, 25)).status === 'settled');
ok('lifecycle: a settledAt statement leaves openDues',
  lifeLib.openDues(l4, new Date(2026, 6, 25)).length === 0);

// Overpaying one statement must still not settle the next — the rule the
// allocation window exists to protect.
const twoStatements = {
  accounts: [lifeAccount],
  cardDues: [
    lifeDue,
    { id: 'st2', accountId: 'cc1', totalDueFils: 100000, minDueFils: 5000, dueDate: '2026-08-24', paidFils: 0 },
  ],
  transactions: [cardPayment('p1', 324000, '2026-07-22')],
};
ok('lifecycle: settling July does not settle August',
  lifeLib.duePaidFils(twoStatements, twoStatements.cardDues[0]) === 324000 &&
  lifeLib.duePaidFils(twoStatements, twoStatements.cardDues[1]) === 0);
ok('lifecycle: August stays open after July is settled',
  lifeLib.openDues(twoStatements, new Date(2026, 6, 25)).length === 1);

// ── An estimated minimum is never presented as a minimum ──
// The import bridge fills minDueFils with 5% when the bank stated none. That
// figure drives "Still under the minimum due", a claim about the bank's terms.
const estDue = {
  id: 'est', accountId: 'cc1', totalDueFils: 324000, minDueFils: 16200,
  dueDate: '2026-07-24', paidFils: 0, minDueEstimated: true,
};
const estState = lifeState([], estDue);
const estStatus = lifeLib.dueWithStatus(estState, estDue, new Date(2026, 6, 20));
ok('minimum: an estimated minimum is flagged as not known',
  estStatus.minimumKnown === false);
ok('minimum: an estimated minimum never claims the user is below it',
  estStatus.belowMinimum === false);
const statedStatus = lifeLib.dueWithStatus(lifeState([]), lifeDue, new Date(2026, 6, 20));
ok('minimum: a bank-stated minimum is known and still warns',
  statedStatus.minimumKnown === true && statedStatus.belowMinimum === true);
ok('minimum: an estimate changes nothing about what is owed',
  estStatus.remainingFils === 324000);

// ── A long-overdue statement is only dropped when something replaced it ──
// Dropping on age alone made a real unpaid debt disappear with no trace.
const oldDue = {
  id: 'old', accountId: 'cc1', totalDueFils: 50000, minDueFils: 2500,
  dueDate: '2026-05-01', paidFils: 0,
};
const orphan = { accounts: [lifeAccount], cardDues: [oldDue], transactions: [] };
const orphanOpen = lifeLib.openDues(orphan, new Date(2026, 6, 24));
ok('stale: an unpaid statement with no successor survives, not vanishes',
  orphanOpen.length === 1 && orphanOpen[0].due.id === 'old');
ok('stale: the surviving statement is flagged stale, not passed off as current',
  orphanOpen[0].stale === true && orphanOpen[0].status === 'overdue');
ok('stale: the surviving statement still reports what is owed',
  orphanOpen[0].remainingFils === 50000);

// A later statement on the same card genuinely supersedes it.
const superseded = {
  accounts: [lifeAccount],
  cardDues: [oldDue, lifeDue],
  transactions: [],
};
const supersededOpen = lifeLib.openDues(superseded, new Date(2026, 6, 24));
ok('stale: a superseded statement is dropped',
  !supersededOpen.some((d) => d.due.id === 'old'));
ok('stale: the statement that replaced it remains',
  supersededOpen.length === 1 && supersededOpen[0].due.id === 'st1');
ok('stale: a current statement is never flagged stale',
  supersededOpen[0].stale === false);

// Paying an orphaned stale statement still removes it — stale is about age,
// settled is about money, and money wins.
const orphanPaid = {
  accounts: [lifeAccount], cardDues: [oldDue],
  transactions: [cardPayment('p1', 50000, '2026-04-25')],
};
ok('stale: a stale statement that gets paid leaves openDues',
  lifeLib.openDues(orphanPaid, new Date(2026, 6, 24)).length === 0);

// ── net worth: one definition, not two ──
// Wallet subtracted the SERIES start from the HEADLINE total, which count
// different things. Hiding an account moved the "since Feb" line by that
// account's whole balance, and a card payment (an income-side transfer)
// raised the series out of nothing.
{
  const nwState = {
    accounts: [
      { id: 'bank', name: 'Bank', kind: 'bank', openingFils: 1000000, color: '#fff' },
      { id: 'cc', name: 'Card', kind: 'card', cardType: 'credit', openingFils: 0, color: '#fff' },
      { id: 'old', name: 'Hidden', kind: 'bank', openingFils: 2000000, color: '#fff', archived: true },
    ],
    transactions: [],
    cardDues: [],
    bills: [],
    budgets: [],
    goals: [],
  };
  const base = an.netWorthSeries(nwState);
  eq('net worth: an archived account contributes nothing',
    base[0].fils, 1000000);

  const withTransfer = {
    ...nwState,
    transactions: [
      { id: 't1', type: 'income', amountFils: 300000, category: 'other', accountId: 'cc',
        title: 'Card payment', date: '2026-07-02', source: 'manual', isTransfer: true },
    ],
  };
  const after = an.netWorthSeries(withTransfer);
  ok('net worth: paying a card does not create money',
    after[after.length - 1].fils === base[base.length - 1].fils);

  const withSpend = {
    ...nwState,
    transactions: [
      { id: 't2', type: 'expense', amountFils: 50000, category: 'dining', accountId: 'bank',
        title: 'Dinner', date: '2026-07-02', source: 'manual' },
    ],
  };
  const spent = an.netWorthSeries(withSpend);
  ok('net worth: real spending still moves it',
    spent[spent.length - 1].fils === base[base.length - 1].fils - 50000);

  // Moving your own money between your own accounts.
  //
  // The bank sends one message per side, and only the LEAVING side reads as a
  // transfer — the arriving side is worded exactly like being paid, so it
  // carries no transfer flag and nothing here excluded it. The result: shift
  // AED 20,000 from one account to another and net worth rose by 20,000. This
  // is the "double income" the user kept seeing, and it was on the figure
  // Wallet leads with.
  const between = {
    ...nwState,
    accounts: [
      ...nwState.accounts,
      { id: 'bank2', name: 'Second', kind: 'bank', openingFils: 0, color: '#fff' },
    ],
    transactions: [
      { id: 'o1', type: 'expense', amountFils: 2000000, category: 'other', accountId: 'bank',
        title: 'Transfer out', date: '2026-07-02', source: 'sms', isTransfer: true },
      { id: 'i1', type: 'income', amountFils: 2000000, category: 'other', accountId: 'bank2',
        title: 'Incoming transfer', date: '2026-07-02', source: 'sms' },
    ],
  };
  const moved = an.netWorthSeries(between);
  ok('net worth: moving money between your own accounts creates none',
    moved[moved.length - 1].fils === base[base.length - 1].fils,
    { moved: moved[moved.length - 1].fils, base: base[base.length - 1].fils });

  // Being genuinely paid still counts, even into a second account.
  const paid = {
    ...between,
    transactions: [between.transactions[1]],
  };
  const paidSeries = an.netWorthSeries(paid);
  ok('net worth: real income with no matching outflow still counts',
    paidSeries[paidSeries.length - 1].fils === base[base.length - 1].fils + 2000000,
    paidSeries[paidSeries.length - 1].fils);
}

// ── removing only proven-empty parser account artifacts ──
{
  const acc = require('./build/accounts');
  const dup = {
    accounts: [
      { id: 'a1', name: 'FAB Credit Card •5793', kind: 'card', cardType: 'credit', last4: '5793', bankName: 'FAB', openingFils: 0, color: '#fff' },
      { id: 'a2', name: 'FAB Debit Card •5793', kind: 'card', cardType: 'debit', last4: '5793', bankName: 'FAB', openingFils: 0, color: '#fff' },
      { id: 'b1', name: 'ENBD Credit Card •5793', kind: 'card', cardType: 'credit', last4: '5793', bankName: 'Emirates NBD', openingFils: 0, color: '#fff' },
      { id: 'cash', name: 'Cash', kind: 'cash', openingFils: 5000, color: '#fff' },
    ],
    transactions: [
      { id: 't1', type: 'expense', amountFils: 1000, category: 'dining', accountId: 'a1', title: 'A', date: '2026-07-01', source: 'sms' },
    ],
    cardDues: [{ id: 'd1', accountId: 'a1', totalDueFils: 100, minDueFils: 5, dueDate: '2026-07-15', paidFils: 0 }],
    bills: [],
    accountHints: { '5793': 'a2' },
  };
  const merged = acc.mergeDuplicateAccounts(dup);
  ok('artifact cleanup: empty debit fallback beside active credit is removed',
    merged.accounts.filter(a => a.bankName === 'FAB').length === 1 && !merged.accounts.some(a => a.id === 'a2'),
    merged.accounts);
  ok('artifact cleanup: a different bank and cash account stay untouched',
    merged.accounts.some(a => a.id === 'b1') && merged.accounts.some(a => a.id === 'cash'));
  ok('artifact cleanup: the hint follows the only substantive target',
    merged.accountHints['5793'] === 'a1', merged.accountHints);
  // Idempotent, because it runs on every hydrate.
  const twice = acc.mergeDuplicateAccounts(merged);
  ok('artifact cleanup: running it again changes nothing', twice === merged);

  // ── A duplicated account list ──
  //
  // From a real diagnostic: 72 card rows, 47 distinct, 25 exact duplicates —
  // and the Wallet showed "FAB Account •0004  AED 423,545" twice, with net
  // worth inflated by the second copy. Both copies carried a balance
  // snapshot, so neither was an empty artifact and the group was skipped.
  const clone = (over) => ({
    id: 'x', name: 'FAB Account •0004', kind: 'bank', last4: '0004',
    bankName: 'FAB', openingFils: 0, color: '#111',
    snapshotFils: 42354500, snapshotKind: 'balance', snapshotTs: 1000, ...over,
  });
  const dupBank = {
    accounts: [clone({ id: 'bank-old' }), clone({ id: 'bank-new', snapshotTs: 2000 })],
    transactions: [
      { id: 't1', accountId: 'bank-old', date: '2026-08-01', amountFils: 100,
        type: 'expense', category: 'other', title: 'x' },
    ],
    cardDues: [], bills: [], accountHints: { '0004': 'bank-old' },
  };
  const bankMerged = acc.mergeDuplicateAccounts(dupBank);
  ok('duplicate bank accounts are merged (they were skipped entirely before)',
    bankMerged.accounts.length === 1, bankMerged.accounts);
  ok('the survivor is the one the bank spoke to most recently',
    bankMerged.accounts[0].id === 'bank-new', bankMerged.accounts[0]);
  ok('a duplicated balance is no longer counted twice',
    bankMerged.accounts.reduce((n, a) => n + (a.snapshotFils ?? 0), 0) === 42354500);
  ok('transactions follow the survivor rather than dangling',
    bankMerged.transactions[0].accountId === 'bank-new');
  ok('hints follow the survivor too', bankMerged.accountHints['0004'] === 'bank-new');
  ok('merging a duplicated list is idempotent',
    acc.mergeDuplicateAccounts(bankMerged) === bankMerged);

  // Same shape for cards, where both copies are substantive.
  const cardClone = (over) => ({
    id: 'c', name: 'Liv Debit Card •8783', kind: 'card', cardType: 'debit',
    last4: '8783', bankName: 'Liv', openingFils: 0, color: '#222',
    snapshotFils: 900000, snapshotKind: 'balance', snapshotTs: 5, ...over,
  });
  const dupCard = {
    accounts: [cardClone({ id: 'card-a' }), cardClone({ id: 'card-b', snapshotTs: 9 })],
    transactions: [], cardDues: [], bills: [], accountHints: {},
  };
  ok('an exactly duplicated card is folded together as well',
    acc.mergeDuplicateAccounts(dupCard).accounts.length === 1);

  // The safety rule this must NOT break: two genuinely different cards that
  // merely collide on bank + last four stay separate.
  const twoReal = {
    accounts: [
      cardClone({ id: 'real-a', name: 'Liv Debit Card •8783' }),
      cardClone({ id: 'real-b', name: 'Liv Salary Card', cardType: 'credit' }),
    ],
    transactions: [], cardDues: [], bills: [], accountHints: {},
  };
  ok('two genuinely different cards sharing a suffix are still left alone',
    acc.mergeDuplicateAccounts(twoReal).accounts.length === 2);

  // ── A sub-brand and its issuer are one card ──
  //
  // Liv is Emirates NBD's app. A user with ONE card ending 8575 saw it filed
  // twice — once under each sender — so the ENBD statement sat on one row and
  // the payment clearing it on the other, and the balance never settled.
  const brandClone = (over) => ({
    id: 'x', kind: 'card', cardType: 'credit', last4: '8575',
    openingFils: 0, color: '#333', ...over,
  });
  const crossBrand = {
    accounts: [
      brandClone({ id: 'liv', name: 'Liv Credit Card •8575', bankName: 'Liv',
        snapshotFils: 0, snapshotKind: 'outstanding', snapshotTs: 99 }),
      brandClone({ id: 'enbd', name: 'Emirates NBD Credit Card •8575',
        bankName: 'Emirates NBD', snapshotFils: 407602,
        snapshotKind: 'outstanding', snapshotTs: 10 }),
    ],
    transactions: [
      { id: 'p1', accountId: 'liv', date: '2026-07-17', amountFils: 406169,
        type: 'income', category: 'other', title: 'Card •8575 payment', isTransfer: true },
    ],
    cardDues: [{ id: 'd1', accountId: 'enbd', dueDate: '2026-07-23',
      totalDueFils: 406196, minDueFils: 20310, paidFils: 0 }],
    bills: [], accountHints: { '8575': 'liv' },
  };
  const brandMerged = acc.mergeDuplicateAccounts(crossBrand);
  ok('a sub-brand card folds into its issuer',
    brandMerged.accounts.length === 1, brandMerged.accounts.map((a) => a.name));
  ok('the ISSUER survives, not the sub-brand, even with an older snapshot',
    brandMerged.accounts[0]?.bankName === 'Emirates NBD', brandMerged.accounts[0]);
  ok('the payment moves onto the surviving card, so the due can settle',
    brandMerged.transactions[0].accountId === brandMerged.cardDues[0].accountId,
    { tx: brandMerged.transactions[0].accountId, due: brandMerged.cardDues[0].accountId });

  // Liv's OWN card must not be dragged in — different digits, different card.
  const livOwn = {
    accounts: [
      brandClone({ id: 'liv-8917', name: 'Liv Credit Card •8917', bankName: 'Liv', last4: '8917' }),
      brandClone({ id: 'enbd-8575', name: 'Emirates NBD Credit Card •8575', bankName: 'Emirates NBD' }),
    ],
    transactions: [], cardDues: [], bills: [], accountHints: {},
  };
  ok('a real Liv card with different digits stays its own card',
    acc.mergeDuplicateAccounts(livOwn).accounts.length === 2);

  // ── The regression the sub-brand fix nearly shipped ──
  //
  // Folding by issuer alone, with the displayed NAME dropped from the key,
  // merged two genuinely different FAB cards ending 3749 — and computeOpenDues
  // keeps one row per (account, dueDate), so an entire statement was DISCARDED
  // rather than merged. The two tests above pass for the wrong reason: they
  // differ in cardType, which is still in the key.
  const namedCard = (id, name, dueTotal) => ({
    id, name, kind: 'card', cardType: 'credit', last4: '3749',
    bankName: 'FAB', openingFils: 0, color: '#0a0',
    snapshotFils: 1000, snapshotKind: 'outstanding', snapshotTs: 1,
  });
  const twoRealFab = {
    accounts: [namedCard('fab-a', 'FAB Cashback Card'), namedCard('fab-b', 'FAB Business Card')],
    transactions: [],
    cardDues: [
      { id: 'da', accountId: 'fab-a', dueDate: '2026-08-26', totalDueFils: 50000, minDueFils: 5000, paidFils: 0 },
      { id: 'db', accountId: 'fab-b', dueDate: '2026-08-26', totalDueFils: 70000, minDueFils: 7000, paidFils: 0 },
    ],
    bills: [], accountHints: {},
  };
  const twoRealAfter = acc.mergeDuplicateAccounts(twoRealFab);
  ok('two differently NAMED cards at one bank are never fused',
    twoRealAfter.accounts.length === 2, twoRealAfter.accounts.map((a) => a.name));
  ok('...so neither statement is discarded',
    twoRealAfter.cardDues.length === 2 &&
      twoRealAfter.cardDues.reduce((n, d) => n + d.totalDueFils, 0) === 120000,
    twoRealAfter.cardDues);

  // Same shape for bank accounts: "Salary" and "Joint" are not one account.
  const twoRealBanks = {
    accounts: [
      { id: 'sal', name: 'FAB Salary Account', kind: 'bank', last4: '0004', bankName: 'FAB',
        openingFils: 0, color: '#0a0', snapshotFils: 42354500, snapshotKind: 'balance', snapshotTs: 1 },
      { id: 'joint', name: 'FAB Joint Account', kind: 'bank', last4: '0004', bankName: 'FAB',
        openingFils: 0, color: '#0a0', snapshotFils: 1200, snapshotKind: 'balance', snapshotTs: 2 },
    ],
    transactions: [], cardDues: [], bills: [], accountHints: {},
  };
  const banksAfter = acc.mergeDuplicateAccounts(twoRealBanks);
  ok('two differently NAMED bank accounts keep both balances',
    banksAfter.accounts.length === 2 &&
      banksAfter.accounts.reduce((n, a) => n + (a.snapshotFils ?? 0), 0) === 42355700,
    banksAfter.accounts.map((a) => [a.name, a.snapshotFils]));

  // And the guard that says "two instruments" out loud: one card cannot owe
  // two different totals on one date, even under one issuer across brands.
  const contradicting = {
    accounts: [
      brandClone({ id: 'liv2', name: 'Liv Credit Card •4242', bankName: 'Liv', last4: '4242' }),
      brandClone({ id: 'enbd2', name: 'Emirates NBD Credit Card •4242', bankName: 'Emirates NBD', last4: '4242' }),
    ],
    transactions: [],
    cardDues: [
      { id: 'c1', accountId: 'liv2', dueDate: '2026-09-01', totalDueFils: 10000, minDueFils: 1000, paidFils: 0 },
      { id: 'c2', accountId: 'enbd2', dueDate: '2026-09-01', totalDueFils: 90000, minDueFils: 9000, paidFils: 0 },
    ],
    bills: [], accountHints: {},
  };
  ok('contradicting statements on one date block even a cross-brand fold',
    acc.mergeDuplicateAccounts(contradicting).accounts.length === 2);

  const meaningfulVariants = [
    { openingFils: 1 },
    { creditLimitFils: 1 },
    { snapshotFils: 1, snapshotKind: 'outstanding', snapshotTs: 1 },
    { renewedFrom: 'older-card' },
    { archived: true },
  ];
  for (const [i, patch] of meaningfulVariants.entries()) {
    const protectedState = {
      ...dup,
      accounts: [dup.accounts[0], { ...dup.accounts[1], id: `protected-${i}`, ...patch }],
      accountHints: {},
    };
    ok(`artifact cleanup: account metadata variant ${i + 1} blocks deletion`,
      acc.mergeDuplicateAccounts(protectedState) === protectedState, patch);
  }
  const referenced = {
    ...dup,
    accounts: [dup.accounts[0], dup.accounts[1]],
    transactions: dup.transactions, cardDues: [],
    bills: [{ id: 'bill', title: 'Card fee', category: 'other', amountFils: 100, dueDay: 1, accountId: 'a2', paidMonths: [] }],
    accountHints: {},
  };
  ok('artifact cleanup: a bill reference blocks deletion',
    acc.mergeDuplicateAccounts(referenced) === referenced);
  const namedByUser = {
    ...dup,
    accounts: [dup.accounts[0], { ...dup.accounts[1], name: 'My travel card' }],
    accountHints: {},
  };
  ok('artifact cleanup: a user-named empty card is not a proven parser artifact',
    acc.mergeDuplicateAccounts(namedByUser) === namedByUser);
  const activeSiblings = {
    ...dup,
    accounts: [dup.accounts[0], dup.accounts[1]],
    transactions: [
      dup.transactions[0],
      { ...dup.transactions[0], id: 't2', accountId: 'a2' },
    ],
    cardDues: [], bills: [], accountHints: {},
  };
  ok('artifact cleanup: two active same-last4 siblings are never auto-merged',
    acc.mergeDuplicateAccounts(activeSiblings) === activeSiblings);
  const emptyTypedSiblings = {
    ...dup,
    accounts: [
      { ...dup.accounts[0], id: 'adcb-credit', bankName: 'ADCB', name: 'ADCB Credit Card •5793' },
      { ...dup.accounts[1], id: 'adcb-debit', bankName: 'ADCB', name: 'ADCB Debit Card •5793' },
    ],
    transactions: [], cardDues: [], bills: [],
    accountHints: {
      'ADCB|credit|5793': 'adcb-credit',
      'ADCB|debit|5793': 'adcb-debit',
    },
  };
  const untouchedTyped = acc.mergeDuplicateAccounts(emptyTypedSiblings);
  ok('artifact cleanup: two empty explicit debit/credit siblings remain ambiguous',
    untouchedTyped === emptyTypedSiblings && untouchedTyped.accounts.length === 2,
    untouchedTyped.accounts);
  ok('artifact cleanup: ambiguous typed hints are never remapped by array order',
    untouchedTyped.accountHints['ADCB|credit|5793'] === 'adcb-credit' &&
      untouchedTyped.accountHints['ADCB|debit|5793'] === 'adcb-debit',
    untouchedTyped.accountHints);
  const activeUnknownHolding = {
    ...emptyTypedSiblings,
    accounts: [
      ...emptyTypedSiblings.accounts,
      { id: 'holding', name: 'ADCB Card •5793', kind: 'card', last4: '5793', bankName: 'ADCB', openingFils: 0, color: '#fff' },
    ],
    transactions: [{
      id: 'holding-tx', type: 'expense', amountFils: 1000, category: 'other',
      accountId: 'holding', title: 'Card purchase', date: '2026-08-01', source: 'sms',
    }],
  };
  const holdingCleaned = acc.mergeDuplicateAccounts(activeUnknownHolding);
  ok('artifact cleanup: an unknown holding with transactions is never dropped',
    holdingCleaned.accounts.some((a) => a.id === 'holding') &&
      holdingCleaned.transactions[0].accountId === 'holding',
    holdingCleaned);
  const unknownBanks = {
    ...dup,
    accounts: [
      { ...dup.accounts[0], bankName: undefined, name: 'Credit Card •5793' },
      { ...dup.accounts[1], bankName: undefined, name: 'Debit Card •5793' },
    ],
    accountHints: {},
  };
  ok('artifact cleanup: unknown bank is not proof two same-last4 rows share a bank',
    acc.mergeDuplicateAccounts(unknownBanks) === unknownBanks);
  const distinctArabicBanks = {
    ...dup,
    accounts: [
      {
        id: 'arabic-active', name: 'بنك أبوظبي بطاقة •5793', kind: 'card',
        last4: '5793', bankName: 'بنك أبوظبي', openingFils: 100, color: '#fff',
      },
      {
        id: 'arabic-empty', name: 'مصرف الشارقة بطاقة •5793', kind: 'card',
        last4: '5793', bankName: 'مصرف الشارقة', openingFils: 0, color: '#fff',
      },
    ],
    transactions: [], cardDues: [], bills: [], accountHints: {},
  };
  ok('artifact cleanup: distinct Arabic bank names never collapse into one identity',
    acc.mergeDuplicateAccounts(distinctArabicBanks) === distinctArabicBanks,
    acc.mergeDuplicateAccounts(distinctArabicBanks).accounts);
  // And a clean state is returned untouched, not rebuilt.
  ok('artifact cleanup: a state with no duplicates is returned as-is',
    acc.mergeDuplicateAccounts(guardState) === guardState);
}

// ── card-payment title/account mismatch repair ──
{
  const acc = require('./build/accounts');
  const cardsLib = require('./build/cards');
  const wrong = {
    accounts: [
      { id: 'fab3324', name: 'FAB Credit Card •3324', kind: 'card', cardType: 'credit', last4: '3324', bankName: 'FAB', openingFils: 0, color: '#09f' },
      { id: 'fab3749', name: 'FAB Credit Card •3749', kind: 'card', cardType: 'credit', last4: '3749', bankName: 'FAB', openingFils: 0, color: '#09f' },
      { id: 'enbd3749', name: 'ENBD Credit Card •3749', kind: 'card', cardType: 'credit', last4: '3749', bankName: 'Emirates NBD', openingFils: 0, color: '#00f' },
    ],
    transactions: [{
      id: 'wrong-payment', type: 'income', amountFils: 744800, category: 'other',
      accountId: 'fab3324', title: 'Card •3749 payment', date: '2026-07-03',
      source: 'sms', isTransfer: true, cardPaymentSide: 'receipt',
    }],
    cardDues: [{
      id: 'due3749', accountId: 'fab3749', totalDueFils: 744800, minDueFils: 37240,
      dueDate: '2026-07-10', paidFils: 0,
    }],
    accountHints: {},
  };
  const repaired = acc.repairCardPaymentAccounts(wrong);
  ok('payment account repair: Card •3749 payment moves off FAB •3324',
    repaired.transactions[0].accountId === 'fab3749', repaired.transactions[0]);
  ok('payment account repair: same last4 at another bank cannot steal it',
    repaired.transactions[0].accountId !== 'enbd3749', repaired.transactions[0]);
  ok('payment account repair: the corrected payment settles the named card',
    cardsLib.openDues(repaired, new Date(2026, 6, 8)).length === 0,
    cardsLib.cardStatementView(repaired, 'fab3749'));

  const debitMisfiled = {
    ...wrong,
    accounts: [
      { ...wrong.accounts[1], id: 'fab3749-debit', name: 'FAB Debit Card •3749', cardType: 'debit' },
      wrong.accounts[1],
    ],
    transactions: [{ ...wrong.transactions[0], accountId: 'fab3749-debit' }],
  };
  const creditTargeted = acc.repairCardPaymentAccounts(debitMisfiled);
  ok('payment account repair: same-suffix debit row yields to the unique credit card',
    creditTargeted.transactions[0].accountId === 'fab3749', creditTargeted.transactions[0]);
  ok('payment account repair: debit-to-credit correction settles the credit statement',
    cardsLib.openDues(creditTargeted, new Date(2026, 6, 8)).length === 0,
    cardsLib.cardStatementView(creditTargeted, 'fab3749'));

  const ambiguous = {
    ...wrong,
    accounts: [...wrong.accounts, { ...wrong.accounts[1], id: 'fab3749-second' }],
  };
  ok('payment account repair: two same-bank targets are ambiguous and stay untouched',
    acc.repairCardPaymentAccounts(ambiguous) === ambiguous);
  const edited = {
    ...wrong,
    transactions: [{ ...wrong.transactions[0], userEdited: true }],
  };
  ok('payment account repair: a user-edited account choice is never overwritten',
    acc.repairCardPaymentAccounts(edited) === edited);
  const unknownBank = {
    ...wrong,
    accounts: wrong.accounts.map((a) => ({ ...a, bankName: undefined })),
  };
  ok('payment account repair: no bank identity means no automatic reassignment',
    acc.repairCardPaymentAccounts(unknownBank) === unknownBank);
}

// ── a paid card stops saying it is overdue ──
//
// The whole chain, because every link of it was broken at some point: the SMS
// parses as a card payment, a row already imported the wrong way is corrected
// on rescan, and the corrected row settles the statement.
{
  const heal = require('./build/heal');
  const parser = require('./build/sms-parser');

  const raw = 'AED 4,061.69 has been deducted from your account 095XXX11XXX01 towards payment of your Credit Card ending 8575.';
  const parsed = parser.parseSms(raw);
  ok('paid card: the message reads as a card payment', parsed && parsed.kind === 'cardPayment');

  // How such a row was stored before the parser knew this wording: an expense
  // wearing a transfer hint, which nothing downstream can use.
  const wrong = {
    id: 'p1', type: 'expense', amountFils: 406169, category: 'other',
    accountId: 'cc', title: 'Card payment', date: '2026-07-10',
    source: 'sms', smsKey: 's1-406169', isTransfer: true,
  };
  const patch = heal.healPatch(wrong, parsed);
  ok('paid card: a rescan corrects the direction', !!patch && patch.type === 'income');

  const fixed = heal.applyHealPatch(wrong, patch);
  const settled = {
    accounts: [{ id: 'cc', name: 'ENBD Credit Card •8575', kind: 'card', cardType: 'credit', last4: '8575', bankName: 'Emirates NBD', openingFils: 0, color: '#fff' }],
    transactions: [fixed],
    cardDues: [{ id: 'd', accountId: 'cc', totalDueFils: 406169, minDueFils: 20308, dueDate: '2026-06-29', paidFils: 0 }],
  };
  ok('paid card: the statement is settled and leaves the list',
    cardsGuardLib.openDues(settled, new Date(2026, 6, 20)).length === 0);

  // And the UNCORRECTED row settles it too, which is the point.
  //
  // A card payment the parser did not recognize was imported as an expense
  // wearing a transfer hint — and that hint is exactly what disqualifies a row
  // from keeping its source text, so the launch-time re-parse (which reads
  // `raw`) can never reach it. These rows are only healable by a full inbox
  // re-read, which needs the message still to be in the inbox AND a
  // PARSER_VERSION bump. Until then the statement they paid stayed open.
  //
  // On a credit card a transfer can only be money arriving: purchases are
  // plain expenses, and the bank-side leg is filed against the bank account.
  const broken = { ...settled, transactions: [wrong] };
  ok('paid card: a payment stored the old way settles the statement anyway',
    cardsGuardLib.openDues(broken, new Date(2026, 6, 20)).length === 0);

  // The rule is about transfers, not about expenses. A purchase on the card is
  // money going the other way and must never settle anything.
  const purchase = {
    ...wrong, id: 'p2', isTransfer: undefined, title: 'CARREFOUR', category: 'groceries',
  };
  ok('paid card: an ordinary purchase on the card settles nothing',
    cardsGuardLib.openDues({ ...settled, transactions: [purchase] }, new Date(2026, 6, 20)).length === 1);

  // Nor is it about debit cards or bank accounts, where an expense-side
  // transfer is money LEAVING — a sweep to savings, the bank-side leg of this
  // very payment. Only a credit card can absorb one.
  const onBank = {
    accounts: [{ id: 'cc', name: 'Current account', kind: 'bank', last4: '8575', bankName: 'Emirates NBD', openingFils: 0, color: '#fff' }],
    transactions: [wrong],
    cardDues: settled.cardDues,
  };
  ok('paid card: an outgoing transfer on a bank account is not a card payment',
    cardsLib.duePaidFils(onBank, onBank.cardDues[0]) === 0);

  // Legacy compatibility must be narrow. Treating EVERY expense-side transfer
  // on a credit card as a payment lets an actual cash/balance transfer OUT of
  // the card settle its bill. Only rows whose stored title identifies a card
  // settlement can use the old expense-direction fallback.
  const outOfCard = {
    ...wrong, id: 'cash-out', title: 'Bank transfer', accountId: 'cc',
  };
  ok('paid card: an outgoing transfer from a credit card does not settle its statement',
    cardsLib.duePaidFils({ ...settled, transactions: [outOfCard] }, settled.cardDues[0]) === 0);

  // A row the user edited by hand is never overwritten by a rescan.
  ok('paid card: a hand-edited row is left alone',
    heal.healPatch({ ...wrong, userEdited: true }, parsed) === null);

  // The corrected card payment must also stop being offered as an unread
  // format. It is income now; an expense-shaped confidence test kept calling it
  // low-confidence and left the source text on it.
  ok('paid card: the corrected row stops carrying source text',
    heal.healPatch({ ...wrong, raw }, parsed).raw === null);

  // Applying the patch is a shared function now, because the launch-time
  // re-parse in the store used to be a second copy of these rules: it set the
  // transfer flag and left the direction alone, so the row stayed the exact
  // shape allocatePayments refuses. Pin the whole loop, patch and apply.
  const relaunched = heal.applyHealPatch({ ...wrong, raw }, heal.healPatch({ ...wrong, raw }, parsed));
  ok('paid card: after a relaunch it is an income-side transfer',
    relaunched.type === 'income' && relaunched.isTransfer === true);
  ok('paid card: after a relaunch it carries no source text', relaunched.raw === undefined);
  ok('paid card: a relaunched row settles the statement',
    cardsGuardLib.openDues({ ...settled, transactions: [relaunched] }, new Date(2026, 6, 20)).length === 0);

  const remittanceRaw = 'Inward remittance of AED 7,300.00 has been credited to your account.';
  const legacyRemittance = {
    ...wrong, id: 'legacy-remittance', type: 'income', title: 'Inward remittance',
    amountFils: 730000, isTransfer: true, raw: remittanceRaw,
  };
  const reparsedRemittance = {
    ...parsed, kind: 'transaction', type: 'income', merchant: 'Inward remittance',
    amountFils: 730000, card: null, transferHint: false, cardPaymentSide: undefined,
    raw: remittanceRaw,
  };
  const remittancePatch = heal.healPatch(legacyRemittance, reparsedRemittance);
  const healedRemittance = heal.applyHealPatch(legacyRemittance, remittancePatch);
  ok('income healing: a raw-bearing legacy inward remittance clears the stale transfer flag',
    remittancePatch?.isTransfer === false && healedRemittance.isTransfer === false,
    remittancePatch);
  ok('income healing: a user-edited inward remittance remains byte-for-byte untouched',
    heal.healPatch({ ...legacyRemittance, userEdited: true }, reparsedRemittance) === null);

  const oldExpense = {
    ...legacyRemittance, id: 'old-expense', type: 'expense', category: 'groceries',
    title: 'Carrefour', isTransfer: undefined,
  };
  const nowRefund = {
    ...reparsedRemittance, merchant: 'Refund', categoryGuess: 'other', transferHint: false,
  };
  const refundPatch = heal.healPatch(oldExpense, nowRefund);
  ok('direction healing: expense to income also replaces stale category and merchant',
    refundPatch?.type === 'income' && refundPatch.category === 'other' &&
      refundPatch.title === 'Refund', refundPatch);

  const oldIncome = {
    ...legacyRemittance, id: 'old-income', category: 'business', title: 'Client payment',
    isTransfer: undefined,
  };
  const nowPurchase = {
    ...reparsedRemittance, type: 'expense', merchant: 'Carrefour',
    categoryGuess: 'groceries', transferHint: false,
  };
  const purchasePatch = heal.healPatch(oldIncome, nowPurchase);
  ok('direction healing: income to expense also replaces stale category and merchant',
    purchasePatch?.type === 'expense' && purchasePatch.category === 'groceries' &&
      purchasePatch.title === 'Carrefour', purchasePatch);
}

// ── what the card detail sheet says a card owes ──
//
// This lived inside a .tsx, where nothing in this harness could reach it, and
// it drifted from every other screen three separate ways. It is `cards.ts`
// now, so these are the sequences that drift would have to survive.
{
  // Two similar rows are not declared one physical card until the user links
  // them (which remaps the ledger to one surviving account id).
  const found = {
    id: 'scanned', name: 'FAB Credit Card •4833', kind: 'card', cardType: 'credit',
    last4: '4833', bankName: 'FAB', openingFils: 0, color: '#fff',
  };
  const byHand = {
    id: 'manual', name: 'My FAB card', kind: 'card', cardType: 'credit',
    last4: '4833', openingFils: 0, color: '#fff',
  };
  const twinCard = {
    accounts: [found, byHand],
    cardDues: [{
      id: 'due-aug', accountId: 'scanned', totalDueFils: 814440, minDueFils: 40722,
      dueDate: '2026-08-20', paidFils: 0,
    }],
    transactions: [{
      id: 'pay-aug', type: 'income', amountFils: 814440, category: 'other',
      accountId: 'manual', title: 'Card •4833 payment', date: '2026-08-05',
      source: 'sms', isTransfer: true,
    }],
  };
  // Opened from the row that holds the payment but not the statement.
  const view = cardsLib.cardStatementView(twinCard, 'manual');
  ok('card sheet: an unconfirmed sibling statement is not silently pooled',
    view.statements.length === 0, view.statements.length);
  const scannedView = cardsLib.cardStatementView(twinCard, 'scanned');
  ok('card sheet: a payment on an unconfirmed sibling does not settle this card',
    scannedView.outstandingFils === 814440 && scannedView.open.length === 1,
    { outstanding: scannedView.outstandingFils, open: scannedView.open.length });
  ok('card sheet: the paid lookup covers every statement it lists',
    view.statements.every((d) => view.paidByDueId.has(d.id)));
  ok('card sheet: the payment total stays on its resolved account',
    view.paidTotalFils === 814440, view.paidTotalFils);

  // Hiding a card says where it appears, not what it costs. openDues drops
  // archived rows on purpose; this sheet is reached BY opening that card, so
  // answering 0 there is a debt vanishing with nothing to say it was dropped.
  const hidden = {
    ...twinCard,
    accounts: [{ ...found, archived: true }, { ...byHand, archived: true }],
    transactions: [],
  };
  const hiddenView = cardsLib.cardStatementView(hidden, 'scanned');
  ok('card sheet: a hidden card still owes what it owes',
    hiddenView.outstandingFils === 814440 && hiddenView.open.length === 1,
    { outstanding: hiddenView.outstandingFils, open: hiddenView.open.length });

  // A credit card rolls its unpaid balance into the next statement, so the
  // history is history — adding it up bills the user twice for one debt.
  const rolled = {
    ...twinCard,
    transactions: [],
    cardDues: [
      { id: 'due-jul', accountId: 'scanned', totalDueFils: 500000, minDueFils: 25000, dueDate: '2026-07-20', paidFils: 0 },
      { id: 'due-aug', accountId: 'scanned', totalDueFils: 814440, minDueFils: 40722, dueDate: '2026-08-20', paidFils: 0 },
    ],
  };
  const rolledView = cardsLib.cardStatementView(rolled, 'scanned');
  ok('card sheet: only the newest statement is owed',
    rolledView.open.length === 1 && rolledView.outstandingFils === 814440,
    { open: rolledView.open.length, outstanding: rolledView.outstandingFils });
  ok('card sheet: the older statement stays visible as history',
    rolledView.statements.length === 2);

  // The direction test: import stamps isTransfer on the expense-side leg too,
  // so dropping it counts money LEAVING the card as money paid toward it.
  const outgoing = {
    ...rolled,
    cardDues: [rolled.cardDues[1]],
    transactions: [{
      id: 'cash-out', type: 'expense', amountFils: 814440, category: 'other',
      accountId: 'scanned', title: 'Bank transfer', date: '2026-08-05',
      source: 'sms', isTransfer: true,
    }],
  };
  const outgoingView = cardsLib.cardStatementView(outgoing, 'scanned');
  ok('card sheet: money leaving the card is not money paid toward it',
    outgoingView.paidTotalFils === 0 && outgoingView.outstandingFils === 814440,
    { paid: outgoingView.paidTotalFils, outstanding: outgoingView.outstandingFils });

  // The legacy compat branch: a card payment an older build stored the wrong
  // way (expense-side transfer, titled as a card settlement) must settle the
  // statement AND show up as a payment. duePaidFils always allocated through
  // this branch; the sheet's own payments list and paidTotalFils used to run a
  // narrower income-only copy of the rule, so this same row could settle the
  // statement while "Payments Made" stayed empty and its total read zero.
  const compatPaid = {
    ...rolled,
    cardDues: [rolled.cardDues[1]],
    transactions: [{
      id: 'compat-pay', type: 'expense', amountFils: 814440, category: 'other',
      accountId: 'scanned', title: 'Card payment', date: '2026-08-05',
      source: 'sms', isTransfer: true,
    }],
  };
  const compatView = cardsLib.cardStatementView(compatPaid, 'scanned');
  ok('card sheet: a legacy expense-direction card payment settles the statement',
    compatView.outstandingFils === 0 && compatView.open.length === 0,
    { outstanding: compatView.outstandingFils, open: compatView.open.length });
  ok('card sheet: that same payment appears in Payments Made and its total',
    compatView.payments.length === 1 && compatView.payments[0].id === 'compat-pay' &&
    compatView.paidTotalFils === 814440,
    { payments: compatView.payments.length, paidTotal: compatView.paidTotalFils });

  // And an ordinary outgoing transfer on the same card (no settlement wording)
  // must still not count — the compat branch is narrow, not "any expense-side
  // transfer off a credit card is a payment."
  ok('card sheet: an ordinary outgoing transfer off the card is still not a payment',
    outgoingView.payments.length === 0, outgoingView.payments.length);

  // Two banks whose cards end in the same four digits are two cards.
  const collision = {
    accounts: [
      { ...found, id: 'fab', bankName: 'FAB' },
      { ...found, id: 'enbd', bankName: 'Emirates NBD' },
    ],
    cardDues: [
      { id: 'fab-due', accountId: 'fab', totalDueFils: 100000, minDueFils: 5000, dueDate: '2026-08-20', paidFils: 0 },
      { id: 'enbd-due', accountId: 'enbd', totalDueFils: 700000, minDueFils: 35000, dueDate: '2026-08-20', paidFils: 0 },
    ],
    transactions: [],
  };
  const fabView = cardsLib.cardStatementView(collision, 'fab');
  ok('card sheet: another bank\'s card sharing last4 is not this card',
    fabView.statements.length === 1 && fabView.outstandingFils === 100000,
    { statements: fabView.statements.length, outstanding: fabView.outstandingFils });
}

// ── importing statement reminders never erases payment state ──
//
// Android re-reads inbox history on a parser-version scan. The reducer used
// to replace whichever open due it found with the reminder row and preserve
// only the id, resetting paidFils and settledAt. A card the user had paid then
// reopened after launch. The pure merge helper is what the store calls now.
{
  const card = {
    id: 'cc', name: 'ENBD Credit Card •8575', kind: 'card', cardType: 'credit',
    last4: '8575', bankName: 'Emirates NBD', openingFils: 0, color: '#fff',
  };
  const existing = [{
    id: 'due-old', accountId: 'cc', totalDueFils: 406169, minDueFils: 20308,
    dueDate: '2026-08-20', paidFils: 406169, settledAt: '2026-08-10T08:00:00Z',
  }];
  const reminder = [{
    id: 'due-rescan', accountId: 'cc', totalDueFils: 406169, minDueFils: 20308,
    dueDate: '2026-08-20', paidFils: 0,
  }];
  const merged = cardsLib.mergeImportedCardDues(existing, reminder, [card]);
  ok('statement merge: a repeated reminder remains one statement', merged.length === 1);
  ok('statement merge: a repeated reminder preserves the paid amount',
    merged[0].paidFils === 406169);
  ok('statement merge: a repeated reminder preserves settlement proof',
    merged[0].settledAt === '2026-08-10T08:00:00Z');

  // Full-history input is oldest-first, but relay batches and manual imports
  // are not required to be. An older reminder arriving after the current one
  // must never roll the card backwards.
  const current = [{
    id: 'due-current', accountId: 'cc', totalDueFils: 510000, minDueFils: 25500,
    dueDate: '2026-09-20', paidFils: 100000,
  }];
  const stale = [{
    id: 'due-stale', accountId: 'cc', totalDueFils: 406169, minDueFils: 20308,
    dueDate: '2026-08-20', paidFils: 0,
  }];
  const afterStale = cardsLib.mergeImportedCardDues(current, stale, [card]);
  ok('statement merge: an older reminder cannot replace the current statement',
    afterStale.some((d) => d.id === 'due-current' && d.paidFils === 100000) &&
      cardsLib.openDues({ accounts: [card], transactions: [], cardDues: afterStale }, new Date(2026, 8, 10))[0]?.due.id === 'due-current');

  const fab = { ...card, id: 'fab', bankName: 'FAB' };
  const enbd = { ...card, id: 'enbd', bankName: 'Emirates NBD' };
  const separate = cardsLib.mergeImportedCardDues(
    [{ ...current[0], id: 'fab-due', accountId: 'fab' }],
    [{ ...current[0], id: 'enbd-due', accountId: 'enbd' }],
    [fab, enbd],
  );
  ok('statement merge: two banks sharing last4 remain separate obligations',
    separate.length === 2);
}

// ── Card accounting identity requires an explicit link/remap ──
//
// Bank + type + last4 is not proof: two active cards can share all three.
// Parser artifacts are cleaned separately, and confirmed links physically
// remap their ledger references before these accounting helpers run.
{
  const fabA = { id: 'fab-a', name: 'FAB Credit Card •5793', kind: 'card', cardType: 'credit', last4: '5793', bankName: 'FAB', openingFils: 0, color: '#fff' };
  // The twin, added by hand: same card, no bank name, because the user typed
  // it in and only the SMS sender ID teaches the app who the bank is.
  const fabB = { id: 'fab-b', name: 'FAB •5793', kind: 'card', cardType: 'credit', last4: '5793', openingFils: 0, color: '#fff' };
  const split = {
    accounts: [fabA, fabB],
    cardDues: [{ id: 'st', accountId: 'fab-b', totalDueFils: 814440, minDueFils: 40722, dueDate: '2026-07-06', paidFils: 0 }],
    transactions: [{
      id: 'pay', type: 'income', isTransfer: true, accountId: 'fab-a', amountFils: 814440,
      date: '2026-07-05', category: 'other', title: 'Card •5793 payment', source: 'sms',
    }],
  };
  ok('card identity: an unconfirmed sibling payment cannot settle this statement',
    cardsLib.duePaidFils(split, split.cardDues[0]) === 0);
  ok('card identity: the unconfirmed statement remains open',
    cardsLib.openDues(split, new Date(2026, 6, 27)).length === 1);

  // Missing bank metadata is not proof either.
  const key = cardsLib.cardIdentity([fabA, fabB]);
  ok('card identity: a row with no bank name stays separate until confirmed',
    key('fab-a') !== key('fab-b'));

  // But two banks really can issue cards ending in the same four digits.
  const enbd = { id: 'enbd', name: 'ENBD Credit Card •5793', kind: 'card', cardType: 'credit', last4: '5793', bankName: 'Emirates NBD', openingFils: 0, color: '#fff' };
  const twoBanks = cardsLib.cardIdentity([fabA, enbd, fabB]);
  ok('one card: two named banks with the same digits stay two cards',
    twoBanks('fab-a') !== twoBanks('enbd'));
  ok('one card: an unattributable row stands alone rather than guessing',
    twoBanks('fab-b') !== twoBanks('fab-a') && twoBanks('fab-b') !== twoBanks('enbd'));

  // Two cards at one bank must not pool their payments.
  const twoCards = {
    accounts: [
      fabA,
      { id: 'fab-3749', name: 'FAB Credit Card •3749', kind: 'card', cardType: 'credit', last4: '3749', bankName: 'FAB', openingFils: 0, color: '#fff' },
    ],
    cardDues: [
      { id: 's-5793', accountId: 'fab-a', totalDueFils: 814440, minDueFils: 40722, dueDate: '2026-07-06', paidFils: 0 },
      { id: 's-3749', accountId: 'fab-3749', totalDueFils: 744800, minDueFils: 37240, dueDate: '2026-07-04', paidFils: 0 },
    ],
    transactions: [{
      id: 'pay', type: 'income', isTransfer: true, accountId: 'fab-3749', amountFils: 766394,
      date: '2026-07-10', category: 'other', title: 'Card •3749 payment', source: 'sms',
    }],
  };
  ok('one card: a payment to one card at a bank leaves the other alone',
    cardsLib.duePaidFils(twoCards, twoCards.cardDues[0]) === 0 &&
    cardsLib.duePaidFils(twoCards, twoCards.cardDues[1]) === 744800);

  const sameSuffixAccounts = [
    { ...fabA, id: 'fab-3749-a', name: 'FAB Credit Card •3749', last4: '3749' },
    { ...fabA, id: 'fab-3749-b', name: 'FAB Credit Card •3749', last4: '3749' },
  ];
  const sameSuffixDues = [
    { id: 'due-a', accountId: 'fab-3749-a', totalDueFils: 400000, minDueFils: 20000, dueDate: '2026-08-20', paidFils: 0 },
    { id: 'due-b', accountId: 'fab-3749-b', totalDueFils: 400000, minDueFils: 20000, dueDate: '2026-08-20', paidFils: 0 },
  ];
  const sameSuffix = {
    accounts: sameSuffixAccounts,
    cardDues: sameSuffixDues,
    transactions: [{
      id: 'payment-a', type: 'income', isTransfer: true, accountId: 'fab-3749-a',
      amountFils: 400000, date: '2026-08-10', category: 'other',
      title: 'Card •3749 payment', source: 'sms',
    }],
  };
  const stillOpen = cardsLib.openDues(sameSuffix, new Date(2026, 7, 10));
  ok('card identity: one same-suffix card payment settles only its own due',
    stillOpen.length === 1 && stillOpen[0].due.accountId === 'fab-3749-b' &&
      stillOpen[0].remainingFils === 400000,
    stillOpen);
  const separateSameSuffix = cardsLib.mergeImportedCardDues(
    [sameSuffixDues[0]], [sameSuffixDues[1]], sameSuffixAccounts);
  ok('statement merge: two active same-bank same-suffix cards stay separate',
    separateSameSuffix.length === 2, separateSameSuffix);
}

// ── Which statement a payment belongs to ──
//
// The matching window starts around statement issue and ends only when a
// replacement statement is issued: consecutive statements overlap, and the rule
// that keeps every payment counted exactly once is that they are poured
// oldest-first into the oldest statement they could belong to.
{
  const card = { id: 'cc', name: 'FAB Credit Card •3749', kind: 'card', cardType: 'credit', last4: '3749', bankName: 'FAB', openingFils: 0, color: '#fff' };
  const stmt = (id, dueDate, totalDueFils, extra = {}) => ({
    id, accountId: 'cc', totalDueFils, minDueFils: Math.round(totalDueFils / 20), dueDate, paidFils: 0, ...extra,
  });
  const pay = (id, amountFils, date) => ({
    id, type: 'income', isTransfer: true, accountId: 'cc', amountFils, date,
    category: 'other', title: 'Card •3749 payment', source: 'sms',
  });
  const st = (dues, txs) => ({ accounts: [card], cardDues: dues, transactions: txs });

  // A payment before the statement was ever issued belongs to nothing here.
  const early = st([stmt('jul', '2026-07-15', 100000)], [pay('p', 100000, '2026-05-20')]);
  ok('window: a payment made before the statement existed is not credited to it',
    cardsLib.duePaidFils(early, early.cardDues[0]) === 0);
  // The month before the due date is inside the cycle and does count: the
  // statement is issued around 25 days ahead and people pay it that week.
  const onCycle = st([stmt('jul', '2026-07-15', 100000)], [pay('p', 100000, '2026-06-22')]);
  ok('window: a payment made after the statement was issued is credited',
    cardsLib.duePaidFils(onCycle, onCycle.cardDues[0]) === 100000);

  // Part of the bill is part of the bill.
  const partial = st([stmt('jul', '2026-07-15', 100000)], [pay('p', 40000, '2026-07-10')]);
  ok('window: a partial payment leaves the remainder owing',
    cardsLib.dueWithStatus(partial, partial.cardDues[0], new Date(2026, 6, 20)).remainingFils === 60000);
  ok('window: a part-paid statement is still open',
    cardsLib.openDues(partial, new Date(2026, 6, 20)).length === 1);

  // One bill paid in two transfers — two SMS, one statement.
  const inTwo = st([stmt('jul', '2026-07-15', 100000)],
    [pay('p1', 60000, '2026-07-08'), pay('p2', 40000, '2026-07-12')]);
  ok('window: a payment split across two messages settles the statement',
    cardsLib.duePaidFils(inTwo, inTwo.cardDues[0]) === 100000 &&
    cardsLib.openDues(inTwo, new Date(2026, 6, 20)).length === 0);

  const paid25DaysLate = st(
    [stmt('jul', '2026-07-15', 100000)], [pay('late25', 100000, '2026-08-09')]);
  ok('window: the newest statement accepts a payment 25 days late',
    cardsLib.duePaidFils(paid25DaysLate, paid25DaysLate.cardDues[0]) === 100000);
  const paid60DaysLate = st(
    [stmt('jul', '2026-07-15', 100000)], [pay('late60', 100000, '2026-09-13')]);
  ok('window: the newest statement accepts a payment 60 days late',
    cardsLib.duePaidFils(paid60DaysLate, paid60DaysLate.cardDues[0]) === 100000);

  // The invariant this module exists for, restated against two overlapping
  // statements and one payment: counted once, never twice.
  const overlap = st(
    [stmt('jun', '2026-06-15', 100000), stmt('jul', '2026-07-15', 100000)],
    [pay('p', 100000, '2026-06-10')],
  );
  ok('window: one payment settles one of two overlapping statements, not both',
    cardsLib.duePaidFils(overlap, overlap.cardDues[0]) === 100000 &&
    cardsLib.duePaidFils(overlap, overlap.cardDues[1]) === 0);

  // A statement stops competing for payments once the next one has been
  // issued. Without this the June statement was still eligible three weeks
  // into July and swallowed the payment made against the July bill — and June
  // is inside July's total anyway, so the app then showed the same money owed
  // on both rows.
  const rolled = st(
    [stmt('jun', '2026-06-15', 100000), stmt('jul', '2026-07-15', 250000)],
    [pay('p', 250000, '2026-07-02')],
  );
  ok('window: a payment made after the next statement was issued belongs to it',
    cardsLib.duePaidFils(rolled, rolled.cardDues[1]) === 250000);
  ok('window: paying the current statement clears the card',
    cardsLib.openDues(rolled, new Date(2026, 6, 20)).length === 0);

  // "Mark paid" on a statement already a month late records the transfer dated
  // TODAY, which fell outside that statement's window and landed on the next
  // one: one tap settled a statement nobody had paid.
  const markedLate = st(
    [stmt('jun', '2026-06-15', 100000, { settledAt: '2026-07-27T08:00:00Z' }), stmt('jul', '2026-07-15', 250000)],
    [pay('p', 100000, '2026-07-27')],
  );
  ok('window: marking a late statement paid does not pay the next one',
    cardsLib.duePaidFils(markedLate, markedLate.cardDues[1]) === 0);
  ok('window: the July statement is still owed in full',
    cardsLib.dueWithStatus(markedLate, markedLate.cardDues[1], new Date(2026, 6, 27)).remainingFils === 250000);
}

// ── A real payment SMS settles the statement it pays ──
//
// End to end from the two messages as the bank actually sends them, through
// the shape buildImportPlan gives them (a card payment lands as income on the
// CARD account, not on the account the money left), to the statement leaving
// the list. Every link of this has been broken at some point.
{
  const parser = require('./build/sms-parser');
  const statementSms =
    'Dear Customer, the payment due date of your FAB Credit Card ending with 4833 is 06-07-2026. ' +
    'The total amount due is AED 8,144.40 and the Minimum due amount is AED 407.22. ' +
    'Please ignore the message, if already paid.';
  const paymentSms =
    'Dear Customer, Your payment instructions of AED 8,144.40 to 5492********4833 has been processed on 05/07/2026 01:19';

  const stmt = parser.parseSms(statementSms);
  const paid = parser.parseSms(paymentSms);
  ok('real SMS: the reminder is a statement, with the bank\'s own minimum',
    stmt.kind === 'cardStatement' && stmt.amountFils === 814440 &&
    stmt.minDueFils === 40722 && stmt.date === '2026-07-06');
  ok('real SMS: the payment is a card payment against the card it names',
    paid.kind === 'cardPayment' && paid.amountFils === 814440 && paid.card.last4 === '4833');
  ok('real SMS: both messages name the same card',
    stmt.card.last4 === paid.card.last4);

  // What the importer builds out of them.
  const account = {
    id: 'fab4833', name: 'FAB Credit Card •4833', kind: 'card', cardType: 'credit',
    last4: stmt.card.last4, bankName: 'FAB', openingFils: 0, color: '#fff',
  };
  const billed = {
    accounts: [account],
    cardDues: [{
      id: 'd', accountId: account.id, totalDueFils: stmt.amountFils,
      minDueFils: stmt.minDueFils, dueDate: stmt.date, paidFils: 0,
    }],
    transactions: [],
  };
  const afterPaying = {
    ...billed,
    transactions: [{
      id: 'p', type: 'income', isTransfer: true, accountId: account.id,
      amountFils: paid.amountFils, date: paid.date, category: 'other',
      title: paid.merchant, source: 'sms',
    }],
  };
  const today = new Date(2026, 6, 27); // 27 Jul: three weeks past the due date
  ok('real SMS: before the payment the statement is overdue for its full total',
    cardsLib.openDues(billed, today).length === 1 &&
    cardsLib.openDues(billed, today)[0].remainingFils === 814440);
  ok('real SMS: the payment settles it and it leaves the list',
    cardsLib.openDues(afterPaying, today).length === 0);
  ok('real SMS: and it leaves "leaving soon" with it',
    leaving.leavingSoon({ ...lsBase, ...afterPaying }, today, { kinds: ['card'] }).length === 0);
}

// ── The heading over "Leaving soon" equals the rows under it ──
//
// Home prints one total, three rows and a "+N more" remainder. The total
// covers the whole list, so the column only reconciles if the rows plus the
// remainder come back to it — a heading of AED 41,933 over rows adding to
// 52,683 is the app disagreeing with itself in the user's face, whichever of
// the two is right.
{
  const cards = [];
  const dues = [];
  const amounts = [814440, 273612, 744855, 1050033, 620017, 431199, 388741, 275506, 190228];
  amounts.forEach((amountFils, i) => {
    cards.push({
      id: `c${i}`, name: `Card ${i}`, kind: 'card', cardType: 'credit',
      last4: `10${String(i).padStart(2, '0')}`, bankName: 'FAB', openingFils: 0, color: '#fff',
    });
    dues.push({
      id: `d${i}`, accountId: `c${i}`, totalDueFils: amountFils,
      minDueFils: Math.round(amountFils / 20), dueDate: `2026-07-${String(10 + i).padStart(2, '0')}`,
      paidFils: 0,
    });
  });
  const many = { ...lsBase, accounts: cards, cardDues: dues };
  const items = leaving.leavingSoon(many, new Date(2026, 6, 18), { withinDays: 9 });
  ok('leaving soon: every open statement is in the list', items.length === 9);
  const heading = fmt.totalAsShown(items.map((x) => x.amountFils));
  const shown = fmt.totalAsShown(items.slice(0, 3).map((x) => x.amountFils));
  const more = fmt.totalAsShown(items.slice(3).map((x) => x.amountFils));
  ok('leaving soon: the heading equals the three rows plus the remainder',
    heading === shown + more);
  ok('leaving soon: the remainder covers exactly what the rows do not',
    items.length - 3 === 6 && more > 0);

  // A statement that survives only because nothing replaced it is still owed,
  // but it is not "leaving in nine days" and the caller has to be able to say
  // so. It used to be indistinguishable from this week's bill.
  const orphaned = {
    ...lsBase,
    cardDues: [{ id: 'old', accountId: 'card1', totalDueFils: 814440, minDueFils: 40722, dueDate: '2026-06-15', paidFils: 0 }],
  };
  const late = leaving.leavingSoon(orphaned, new Date(2026, 6, 27), { kinds: ['card'] });
  ok('leaving soon: a 42-day-late statement is carried, and marked stale',
    late.length === 1 && late[0].overdue === true && late[0].stale === true);
  ok('leaving soon: this week\'s statement is not stale',
    leaving.leavingSoon(lsDueState, lsToday, { kinds: ['card'] })[0].stale === false);
}

// ── the accuracy report shrinks when the parser improves ──
//
// Source text is stored ONLY to show the user formats the parser cannot read.
// Nothing used to remove it, so a format stayed on the "could not read" list
// forever — including after the rescan that learned to read it. The count could
// only grow, which made every parser improvement look like a regression.
{
  const heal = require('./build/heal');
  const parser = require('./build/sms-parser');
  const accuracy = require('./build/accuracy');
  const label = (id) => id;

  const raw = 'Your Card ending 1234 was used for AED 45.00 at CARREFOUR MARKET on 10/07/2026.';
  const parsed = parser.parseSms(raw);
  ok('accuracy: the message reads with a real category',
    !!parsed && parsed.categoryGuess !== 'other');

  // How the row looked when it was imported by an older parser: no name, no
  // category, source text kept so it could be reported.
  const unread = {
    id: 'u1', type: 'expense', amountFils: 4500, category: 'other',
    accountId: 'a', title: 'Card purchase', date: '2026-07-10',
    source: 'sms', smsKey: 'u1-4500', raw,
  };
  ok('accuracy: an unreadable row is listed',
    accuracy.unreadFormats([unread], label).length === 1);
  // The two failures are told apart: no merchant at all, vs a merchant read
  // correctly that simply has no category rule. A real export of 177 was
  // almost entirely the second kind and was labelled as the first.
  ok('accuracy: a row with no merchant is marked unread',
    accuracy.unreadFormats([unread], label)[0].reason === 'unread');
  const named = { ...unread, title: 'Hutong', raw: raw.replace('CARREFOUR MARKET', 'HUTONG') };
  ok('accuracy: a named merchant with no category is marked uncategorized',
    accuracy.unreadFormats([named], label)[0].reason === 'uncategorized');
  ok('accuracy: unread formats sort ahead of uncategorized ones',
    accuracy.unreadFormats([named, named, unread], label)[0].reason === 'unread');

  const patch = heal.healPatch(unread, parsed);
  ok('accuracy: the rescan names it', !!patch && patch.title === parsed.merchant);
  ok('accuracy: the rescan drops the source text', patch.raw === null);

  const healed = { ...unread, ...patch, raw: patch.raw ?? undefined };
  ok('accuracy: the healed row is no longer reported',
    accuracy.unreadFormats([healed], label).length === 0);
  ok('accuracy: and it no longer counts',
    accuracy.unreadFormatCount({ transactions: [healed] }) === 0);

  // A row the parser still cannot read keeps its text — clearing must not be
  // unconditional, or the report goes permanently blank.
  const stillBad = { ...unread, raw };
  const noop = heal.healPatch(stillBad, { ...parsed, merchant: 'Card purchase', categoryGuess: 'other' });
  ok('accuracy: a still-unreadable row keeps its source text',
    noop === null || noop.raw !== null);

  // ── a count of zero is not always a verdict ──
  //
  // unreadFormatCount keys off tx.raw, and an iPhone never has any: the relay
  // Worker discards Message Content before sealing, which is why
  // ParsedRelayRow is typed `raw?: never`. So the count was structurally 0 on
  // every iPhone and Settings answered "Everything reads clean" — a clean bill
  // of health for a check that never ran, on the one platform whose parser
  // feedback nobody ever receives. Private mode does the same on Android by
  // stripping raw on write.
  ok('accuracy: with retention on, an empty list is a real finding',
    accuracy.noFormatsReason({ relayPlatform: false, privateMode: false }) === 'none-found');
  ok('accuracy: the relay platform cannot know, and says so',
    accuracy.noFormatsReason({ relayPlatform: true, privateMode: false }) === 'relay');
  ok('accuracy: private mode cannot know either',
    accuracy.noFormatsReason({ relayPlatform: false, privateMode: true }) === 'private');
  // Turning private mode off on an iPhone does not bring the text back, so
  // blaming private mode there points the user at a switch that cannot fix it.
  ok('accuracy: on iOS the platform is named, not the private-mode switch',
    accuracy.noFormatsReason({ relayPlatform: true, privateMode: true }) === 'relay');
}

// ── the ledger measures its own parser ──
//
// Nobody learns the parser is failing except by a user writing in. Two have,
// and the third never will. Every imported row already carries what the parser
// made of that message, so the phone can answer the question itself — but only
// if the DENOMINATOR is right. A metric that reads correct behaviour as failure
// gets dismissed the first time it is looked at, and is then worth less than
// nothing. Each block below is one thing that must not drag the number down.
{
  const accuracy = require('./build/accuracy');
  const parser = require('./build/sms-parser');

  const row = (over) => ({
    id: `t${Math.random()}`, type: 'expense', amountFils: 4500, category: 'groceries',
    accountId: 'a', title: 'Carrefour', date: '2026-07-10', source: 'sms', ...over,
  });
  const cov = (transactions, merchantOverrides) =>
    accuracy.parserCoverage({ transactions, merchantOverrides });

  // ── an empty ledger is not 0%, it is nothing to divide by ──
  eq('coverage: an empty ledger divides by nothing',
    cov([]),
    { imported: 0, skipped: 0, measured: 0, named: 0, decided: 0, categoryMeasured: 0,
      categorised: 0 });

  // ── the plain case ──
  {
    const c = cov([
      row({ title: 'Carrefour', category: 'groceries' }),
      row({ title: 'Card purchase', category: 'other' }),
      row({ title: 'Hutong', category: 'other' }),
    ]);
    eq('coverage: three purchases, one unnamed', [c.imported, c.measured, c.named], [3, 3, 2]);
    eq('coverage: one of three carries a real category',
      [c.categoryMeasured, c.categorised], [3, 1]);
    ok('coverage: nothing was skipped', c.skipped === 0);
  }

  // ── a ledger of pure transfers must not read as 0% ──
  //
  // Both sides of an own-account move are deliberately uncategorised. Scoring
  // them is scoring the parser for getting it RIGHT.
  {
    const c = cov([
      row({ title: 'Outgoing transfer', category: 'other', isTransfer: true }),
      row({ title: 'Card •4711 payment', category: 'other', isTransfer: true, cardPaymentSide: 'debit' }),
      row({ title: 'Bank transfer', category: 'other' }),
    ]);
    eq('coverage: a ledger of pure transfers measures nothing rather than failing',
      [c.imported, c.skipped, c.measured, c.categoryMeasured], [3, 3, 0, 0]);
    ok('coverage: and it still reports how many rows it saw', c.imported === 3);
  }

  // ── every structural title the parser mints is out ──
  //
  // STRUCTURAL_TITLES is the parser's own list of "I know exactly what this is
  // and no shop is named in it". Reporting these as misses is what buried the
  // real ones in a 177-entry export.
  {
    const structural = [...parser.STRUCTURAL_TITLES].map((title) =>
      row({ title, category: 'other' }));
    const c = cov(structural);
    ok('coverage: no structural title is ever a miss',
      c.measured === 0 && c.skipped === structural.length, `${c.measured}/${c.skipped}`);
    // The three the parser mints outside that set, for the same reason.
    const minted = cov([
      row({ title: 'Card statement', category: 'other' }),
      row({ title: 'Bill payment', category: 'other' }),
      row({ title: 'Card •1234 payment', category: 'other' }),
    ]);
    ok('coverage: the card/statement/bill titles are structural too',
      minted.measured === 0 && minted.skipped === 3);
  }

  // ── a deliberately-`other` row does not count against the category figure ──
  //
  // `merchantOverrides` is the stored half of `categoryDeliberate`: the user
  // pinned this merchant, so the parser is not being asked. Pinning it to
  // `other` is still an answer.
  {
    const rows = [row({ title: 'eToro', category: 'other' }), row({ title: 'Carrefour' })];
    const blind = cov(rows);
    eq('coverage: without the pin, a deliberate other reads as a miss',
      [blind.categoryMeasured, blind.categorised], [2, 1]);
    const pinned = cov(rows, { etoro: 'other' });
    eq('coverage: a merchant the user pinned to "other" leaves the category count',
      [pinned.categoryMeasured, pinned.categorised], [1, 1]);
    // Still a named shop — the pin says nothing about whether the shop was read.
    ok('coverage: pinning a category does not remove the row from the shop count',
      pinned.measured === 2 && pinned.named === 2);
  }

  // ── credits are not purchases ──
  //
  // categoryOf can only answer salary, business, or a DELIBERATE other for
  // income (a refund, a reversal, cashback, bank interest). Its one
  // non-deliberate income answer is reserved for structural titles, which are
  // already out — so every surviving `other` on a credit is an answer.
  {
    const c = cov([
      row({ type: 'income', title: 'ADCB Refund', category: 'other' }),
      row({ type: 'income', title: 'Emirates NBD', category: 'salary' }),
      row({ title: 'Carrefour' }),
    ]);
    eq('coverage: credits are left out of both counts',
      [c.imported, c.skipped, c.measured, c.categoryMeasured], [3, 2, 1, 1]);
  }

  // ── rows the parser never wrote ──
  {
    const c = cov([
      row({ source: 'manual', title: 'Lunch', category: 'other' }),
      { id: 'old', type: 'expense', amountFils: 100, category: 'other', accountId: 'a',
        title: 'Card purchase', date: '2026-01-01' },
      row({ title: 'Carrefour' }),
    ]);
    eq('coverage: a manual entry, and a pre-v2 row with no source, measure the user',
      [c.imported, c.measured, c.named], [1, 1, 1]);
  }

  // ── a hand-typed NAME is not a parser success; a hand-edited row is still
  //    a measurement ──
  //
  // An earlier cut dropped every `userEdited` row out of `measured`. That
  // laundered real misses: `setMerchantOverride` stamps `userEdited` on every
  // row it moves, so sorting shops silently shrank the denominator and the
  // parser looked better the more of their ledger a user sorted.
  {
    const c = cov([
      // The user retyped this one, so the name is theirs and not a hit.
      row({ title: 'Al Adil Trading', userEdited: true, titleEdited: true }),
      // Still unnamed, still a miss — the hand edit was to some other field.
      row({ title: 'Card purchase', category: 'other', userEdited: true }),
      row({ title: 'Carrefour' }),
    ]);
    eq('coverage: a hand-edited row stays in the denominator',
      [c.imported, c.skipped, c.measured], [3, 0, 3]);
    eq('coverage: a name the user typed is not counted as one the parser read',
      c.named, 1);
    ok('coverage: but a hand edit to some other field does not invent a miss',
      cov([row({ title: 'Carrefour', userEdited: true })]).named === 1);
    eq('coverage: their category is theirs, so it leaves the category count only',
      [c.decided, c.categoryMeasured], [2, 1]);
  }

  // ── the regression that made the whole number worthless ──
  //
  // Ten unnamed rows plus a bulk override on the generic title reported a
  // PERFECT naming score, because every one of the ten was stamped
  // `userEdited` and fell out of `measured`. Three taps from a shipped screen.
  {
    const rows = [];
    for (let i = 0; i < 10; i += 1) rows.push(row({ title: 'Card purchase', category: 'other' }));
    for (let i = 0; i < 5; i += 1) rows.push(row({ title: 'Carrefour' }));
    const before = cov(rows);
    const after = cov(rows.map((t) => (t.title === 'Card purchase'
      ? { ...t, category: 'shopping', userEdited: true } : t)), { 'card purchase': 'shopping' });
    eq('coverage: a bulk override cannot erase the naming misses under it',
      [after.measured, after.named], [before.measured, before.named]);
    ok('coverage: and the misses are still ten of fifteen', after.measured - after.named === 10);
  }

  // ── every measured row is accounted for on screen ──
  //
  // The screen shows `named of measured`, then `categorised of
  // categoryMeasured`. If those do not close, the user reads 100 then 60 with
  // nothing saying where the other 40 went.
  {
    const rows = [
      row({ title: 'Carrefour' }),
      row({ title: 'Talabat', category: 'dining' }),
      row({ title: 'Noon', userEdited: true }),
    ];
    const c = cov(rows, { carrefour: 'groceries' });
    ok('coverage: measured is exactly the decided rows plus the asked-about ones',
      c.measured === c.decided + c.categoryMeasured);
    eq('coverage: a pin and a hand-filed row are both decided', c.decided, 2);
  }

  // ── a pin only decides a row it can reach ──
  //
  // Everything `measured` gets here is an expense — non-expense rows were
  // skipped above — and `overrideFitsDirection` says an income category may not
  // decide an expense row. `decided` keyed on the pin's bare PRESENCE, so an
  // income pin (correct a credit, tap Remember) moved that merchant's expense
  // rows out of `categoryMeasured` and reported "you already answered for this"
  // about rows the rule can never touch. `isCandidate` makes the same bare
  // check, so those rows were struck off the categorise screen at the same
  // time: uncounted and unaskable at once.
  {
    const rows = [row({ title: 'Acme', category: 'other' }), row({ title: 'Acme', category: 'other' })];
    const income = cov(rows, { acme: 'salary' });
    eq('coverage: an income pin does not decide a merchant\'s expense rows',
      [income.decided, income.categoryMeasured], [0, 2]);
    const expense = cov(rows, { acme: 'shopping' });
    eq('coverage: an expense pin on those same rows still does',
      [expense.decided, expense.categoryMeasured], [2, 0]);
    ok('coverage: and measured still closes either way',
      income.measured === income.decided + income.categoryMeasured &&
        expense.measured === expense.decided + expense.categoryMeasured);
  }

  // ── the two halves of the screen agree ──
  //
  // The list below the sentence is built from `unreadFormats`, which keys off
  // the retained source text. Anything it calls 'unread' must be a row the
  // coverage figure counts as un-named, or the screen contradicts itself: a
  // sentence claiming every shop was named above a list of shops that were not.
  {
    const raws = [
      { title: 'Card purchase', category: 'other', raw: 'AED 45.00 at SOME NEW SHOP' },
      { title: 'Hutong', category: 'other', raw: 'AED 120.00 at HUTONG' },
    ].map((o) => row(o));
    const listed = accuracy.unreadFormats(raws, (id) => id);
    const c = cov(raws);
    const unread = listed.filter((r) => r.reason === 'unread').length;
    const uncategorised = listed.filter((r) => r.reason === 'uncategorized').length;
    ok('coverage: every reportable "could not read" row is an un-named row',
      c.measured - c.named === unread, `${c.measured - c.named} vs ${unread}`);
    ok('coverage: every reportable "no category" row is an uncategorised row',
      c.categoryMeasured - c.categorised - unread === uncategorised,
      `${c.categoryMeasured - c.categorised - unread} vs ${uncategorised}`);
  }

  // ── the figure survives a phone that keeps no message text ──
  //
  // This is the whole point of measuring rather than listing. The relay strips
  // Message Content before sealing, so `unreadFormats` is structurally empty on
  // every iPhone — but merchant and category ride along on the row, so coverage
  // still answers. See noFormatsReason() above for what it CANNOT answer there.
  {
    const relayRows = [
      row({ title: 'Carrefour' }),
      row({ title: 'Card purchase', category: 'other' }),
    ];
    ok('coverage: the format list is blind without raw text',
      accuracy.unreadFormats(relayRows, (id) => id).length === 0);
    const c = cov(relayRows);
    ok('coverage: the measurement is not', c.measured === 2 && c.named === 1);
  }
}

// ── a confidently wrong category is healed, a merely-guessed one is not ──
//
// Grubtech sells a POS system to restaurants, matched a food rule, and 55
// charges of AED 1,295.63 sat in Dining — money against a dining budget, and a
// software subscription the Subscriptions tab could never list because
// `dining` is not a subscription category. Healing only out of `other` reached
// none of them.
{
  const heal = require('./build/heal.js');
  const base = {
    id: 'g1', type: 'expense', amountFils: 129563, category: 'dining',
    accountId: 'a', title: 'Grubtech', date: '2026-08-01', source: 'sms',
  };
  const parsed = {
    kind: 'transaction', type: 'expense', amountFils: 129563, merchant: 'Grubtech',
    categoryGuess: 'software', categoryDeliberate: true, transferHint: false,
    date: '2026-08-01', card: null, currency: 'AED',
  };
  const p1 = heal.healPatch(base, parsed);
  ok('heal: a deliberate category correction reaches a row that was not "other"',
    !!p1 && p1.category === 'software', p1);

  // The fallback must not sweep. A rule that merely failed to match anything
  // is not evidence the stored category is wrong.
  const guessed = heal.healPatch(base, { ...parsed, categoryGuess: 'shopping', categoryDeliberate: false });
  ok('heal: a non-deliberate guess never overwrites a real category',
    guessed === null || guessed.category === undefined, guessed);

  // `other` is where transfers and card settlements deliberately live. A row
  // that already knows what it is must never be demoted into it.
  const demote = heal.healPatch(base, { ...parsed, categoryGuess: 'other' });
  ok('heal: a deliberate "other" never demotes a categorised row',
    demote === null || demote.category === undefined, demote);

  // The user's own correction outranks every rule in the file.
  const edited = heal.healPatch({ ...base, userEdited: true }, parsed);
  ok('heal: a hand-corrected row is still untouchable', edited === null, edited);

  // And a transfer keeps its category: both sides of an own-account move are
  // deliberately uncategorised, and re-filing one as spending double-counts.
  const transfer = heal.healPatch({ ...base, isTransfer: true }, parsed);
  ok('heal: a transfer is not re-categorised as spending',
    transfer === null || transfer.category === undefined, transfer);
}

// ── one transaction, three channels, one row ──
//
// A user's Home screen showed the same AED 28,538 salary twice and the same
// AED 77 ChatGPT charge twice. The cause is that the same event reaches the
// app through up to three capture channels, and the fingerprint that was
// supposed to collapse them was built out of a timestamp each channel
// stamps from a different clock.
{
  const { duplicateGuard, bodyPrint } = require('./build/dedupe');

  const salary = {
    id: 't1', type: 'income', amountFils: 2853750, category: 'salary',
    accountId: 'fab', title: 'Incoming transfer', date: '2026-07-25',
    source: 'sms', smsKey: 's1753400000000-2853750',
  };

  // The delivery receiver's copy of the SAME SMS. Identical in every way the
  // user can see; the carrier's PDU timestamp is 4 seconds off the
  // provider's, so the smsKey does not match.
  {
    const guard = duplicateGuard([salary]);
    ok('duplicate: the same SMS caught twice is one row',
      guard.has({
        date: '2026-07-25', amountFils: 2853750, title: 'Incoming transfer',
        type: 'income', smsKey: 's1753400004000-2853750', channel: 'delivery',
      }));
  }

  // The bank's own app notification about the same credit. Different words,
  // so a different title — nothing but the money, the day and the direction
  // is shared. This is the pair the user actually saw.
  {
    const guard = duplicateGuard([salary]);
    ok('duplicate: a push about an SMS already imported is one row',
      guard.has({
        date: '2026-07-25', amountFils: 2853750, title: 'Salary credited',
        type: 'income', smsKey: 's1753400009000-2853750', channel: 'push',
      }));
  }

  // ...but that looseness is for push only. Two real charges of the same
  // amount on the same day, both by SMS, are two charges.
  {
    const coffee = { ...salary, id: 't2', type: 'expense', amountFils: 1800, title: 'Costa', category: 'dining' };
    const guard = duplicateGuard([coffee]);
    ok('duplicate: two same-day same-amount SMS charges stay two rows',
      !guard.has({
        date: '2026-07-25', amountFils: 1800, title: 'Starbucks',
        type: 'expense', smsKey: 's1753400500000-1800', channel: 'inbox',
      }));
    // The same shop, amount and day, captured SECONDS apart, is one event
    // seen twice — that is the delivery receiver racing the inbox.
    ok('duplicate: the same shop seconds later is one row',
      guard.has({
        date: '2026-07-25', amountFils: 1800, title: 'costa',
        type: 'expense', smsKey: 's1753400003000-1800', channel: 'inbox',
      }));

    // The same shop, amount and day, captured EIGHT MINUTES apart, is two
    // coffees. This used to collapse into one row and the second charge was
    // lost — the comment above claimed both survived, and only the differing
    // TITLE was making that true. Buy the same thing twice and the app quietly
    // under-read the day's spending.
    ok('duplicate: the same shop again later in the day is a second row',
      !guard.has({
        date: '2026-07-25', amountFils: 1800, title: 'costa',
        type: 'expense', smsKey: 's1753400480000-1800', channel: 'inbox',
      }));
  }

  // The race the user hit: the bank app's notification lands BEFORE the SMS.
  // The push row is imported first, then the SMS about the same charge turns
  // up worded differently — and the old guard only ever dropped a push for
  // matching an SMS, never the reverse, so the charge appeared twice.
  {
    const pushed = {
      id: 't9', type: 'expense', amountFils: 31000, category: 'shopping',
      accountId: 'fab', title: 'The One', date: '2026-07-25',
      source: 'sms', viaPush: true, smsKey: 's1753400900000-31000',
    };
    const guard = duplicateGuard([pushed]);
    const sms = {
      date: '2026-07-25', amountFils: 31000, title: 'The One Home',
      type: 'expense', smsKey: 's1753400903000-31000', channel: 'inbox',
    };
    ok('duplicate: an SMS supersedes the push row it duplicates',
      guard.supersedes(sms) === 't9', guard.supersedes(sms));
    // And it does not work the other way: a push never rewrites an SMS row.
    const smsRow = { ...pushed, id: 't10', viaPush: undefined };
    ok('duplicate: a push never supersedes an SMS row',
      duplicateGuard([smsRow]).supersedes({ ...sms, channel: 'push' }) === null);
  }

  // A push that matches nothing is a transaction the SMS channel missed —
  // the whole reason the listener exists.
  {
    const guard = duplicateGuard([salary]);
    ok('duplicate: a push with no SMS behind it still imports',
      !guard.has({
        date: '2026-07-26', amountFils: 4500, title: 'Carrefour',
        type: 'expense', smsKey: 's1753500000000-4500', channel: 'push',
      }));
  }

  // Day + amount + direction is not an event identity. A person can make the
  // same AED 35 purchase again later that day, and the second one may arrive
  // only through the bank notification channel. The old loose Set swallowed
  // it merely because an SMS for the first purchase existed that day.
  {
    const first = {
      id: 'first-coffee', type: 'expense', amountFils: 3500, category: 'dining',
      accountId: 'fab', title: 'Costa', date: '2026-07-25', source: 'sms',
      smsKey: 's1753400000000-3500', ts: 1753400000000,
    };
    const laterPush = {
      date: '2026-07-25', amountFils: 3500, title: 'Costa Coffee',
      type: 'expense', smsKey: 's1753400480000-3500', channel: 'push',
      ts: 1753400480000,
    };
    ok('duplicate: a later same-value push is a second real purchase',
      !duplicateGuard([first]).has(laterPush));

    const withoutSmsKey = { ...first, smsKey: undefined };
    const laterSameTitle = {
      date: first.date, amountFils: first.amountFils, title: first.title,
      type: first.type, channel: 'inbox', ts: first.ts + 9 * 60 * 60_000,
    };
    ok('duplicate: persisted event time keeps a later smsKey-less repeat purchase',
      !duplicateGuard([withoutSmsKey]).has(laterSameTitle));
  }

  // Settlement pairing is cardinality-safe: one bank-side debit can explain
  // one receipt, never every equal receipt that follows it that day.
  {
    const guard = duplicateGuard([]);
    const debit = {
      date: '2026-08-10', amountFils: 400000, title: 'Card •3749 payment',
      type: 'income', smsKey: 's1786320000000-400000', ts: 1786320000000,
      channel: 'inbox', accountId: 'fab-3749', eventKind: 'cardPayment',
      cardPaymentSide: 'debit',
    };
    guard.add(debit);
    const receipt = {
      ...debit, smsKey: `s${debit.ts + 10 * 60_000}-400000`,
      ts: debit.ts + 10 * 60_000, cardPaymentSide: 'receipt',
    };
    ok('duplicate: one opposite settlement receipt consumes the debit alert',
      guard.has(receipt));
    const secondReceipt = {
      ...receipt, smsKey: `s${debit.ts + 20 * 60_000}-400000`,
      ts: debit.ts + 20 * 60_000,
    };
    ok('duplicate: a second real receipt is not consumed by the same debit',
      !guard.has(secondReceipt));

    const manualGuard = duplicateGuard([{
      id: 'manual-paid', type: 'income', amountFils: debit.amountFils,
      category: 'other', accountId: debit.accountId, title: 'FAB card payment',
      date: debit.date, source: 'manual', isTransfer: true,
    }]);
    ok('duplicate: Mark paid suppresses the matching bank debit side',
      manualGuard.has(debit));
    ok('duplicate: the same Mark paid also suppresses its matching receipt side',
      manualGuard.has(receipt));
    const nextDebit = {
      ...debit, ts: debit.ts + 60 * 60_000,
      smsKey: `s${debit.ts + 60 * 60_000}-400000`,
    };
    ok('duplicate: a second real payment is not consumed by the manual token',
      !manualGuard.has(nextDebit));
    manualGuard.add(nextDebit);
    const nextReceipt = {
      ...receipt, ts: nextDebit.ts + 10 * 60_000,
      smsKey: `s${nextDebit.ts + 10 * 60_000}-400000`,
    };
    ok('duplicate: the second real payment still coalesces its own opposite side',
      manualGuard.has(nextReceipt));
  }

  // The fix must reach ledgers that already contain the old bug. Repair is
  // conservative and prefers the fuller SMS row (including its card account).
  {
    const push = {
      id: 'old-push', type: 'expense', amountFils: 31000, category: 'shopping',
      accountId: 'fallback', title: 'The One', date: '2026-07-25', source: 'sms',
      viaPush: true, smsKey: 's1753400900000-31000', ts: 1753400900000,
    };
    const sms = {
      ...push, id: 'better-sms', accountId: 'card-9876', title: 'The One Home',
      viaPush: undefined, smsKey: 's1753400903000-31000', ts: 1753400903000,
    };
    const repaired = require('./build/dedupe').reconcileCaptureDuplicates([push, sms]);
    ok('duplicate repair: an existing push/SMS pair becomes one row', repaired.length === 1);
    ok('duplicate repair: the fuller SMS account and identity win',
      repaired[0].id === 'better-sms' && repaired[0].accountId === 'card-9876' && !repaired[0].viaPush);

    const distinct = require('./build/dedupe').reconcileCaptureDuplicates([
      { ...sms, id: 'coffee-1', amountFils: 3500, title: 'Costa', ts: 1753400000000, smsKey: 's1753400000000-3500' },
      { ...sms, id: 'coffee-2', amountFils: 3500, title: 'Costa', ts: 1753400480000, smsKey: 's1753400480000-3500' },
    ]);
    ok('duplicate repair: two genuine later purchases are preserved', distinct.length === 2);

    const edited = require('./build/dedupe').reconcileCaptureDuplicates([
      { ...push, userEdited: true }, sms,
    ]);
    ok('duplicate repair: an edited strong-identity copy wins without double counting',
      edited.length === 1 && edited[0].id === 'old-push' &&
        edited[0].title === 'The One' && edited[0].accountId === 'fallback', edited);

    const bothEdited = require('./build/dedupe').reconcileCaptureDuplicates([
      { ...push, userEdited: true }, { ...sms, userEdited: true },
    ]);
    ok('duplicate repair: two edited copies are never destructively reconciled',
      bothEdited.length === 2, bothEdited);

    const debit = {
      id: 'payment-debit', type: 'expense', amountFils: 400000, category: 'other',
      accountId: 'fab-3749', title: 'Card •3749 payment', date: '2026-08-10',
      source: 'sms', isTransfer: true, cardPaymentSide: 'debit',
      ts: 1786320000000, smsKey: 's1786320000000-400000',
    };
    const receipt = {
      ...debit, id: 'payment-receipt', type: 'income', cardPaymentSide: 'receipt',
      ts: debit.ts + 10 * 60_000, smsKey: `s${debit.ts + 10 * 60_000}-400000`,
    };
    const settlement = require('./build/dedupe').reconcileCaptureDuplicates([debit, receipt]);
    ok('duplicate repair: opposite settlement alerts become one retained payment',
      settlement.length === 1 && settlement[0].cardPaymentSide === 'receipt', settlement);

    const midnightTs = Date.parse('2026-08-10T23:59:00Z');
    const crossMidnightDebit = {
      ...debit, id: 'midnight-debit', date: '2026-08-10', ts: midnightTs,
      smsKey: `s${midnightTs}-400000`,
    };
    const crossMidnightReceipt = {
      ...receipt, id: 'midnight-receipt', date: '2026-08-11',
      ts: midnightTs + 3 * 60_000,
      smsKey: `s${midnightTs + 3 * 60_000}-400000`,
    };
    const midnightSettlement = require('./build/dedupe').reconcileCaptureDuplicates([
      crossMidnightDebit, crossMidnightReceipt,
    ]);
    ok('duplicate repair: opposite settlement sides across midnight become one payment',
      midnightSettlement.length === 1, midnightSettlement);
    const midnightSameSide = require('./build/dedupe').reconcileCaptureDuplicates([
      {
        ...crossMidnightReceipt, id: 'same-side-before', date: '2026-08-10',
        ts: midnightTs, smsKey: `s${midnightTs}-400000`,
      },
      crossMidnightReceipt,
    ]);
    ok('duplicate repair: same-side payments on adjacent dates stay distinct',
      midnightSameSide.length === 2, midnightSameSide);
    const due = {
      id: 'due-7000', accountId: 'fab-3749', totalDueFils: 700000,
      minDueFils: 35000, dueDate: '2026-08-20', paidFils: 0,
    };
    const settlementState = {
      accounts: [{
        id: 'fab-3749', name: 'FAB Credit Card •3749', kind: 'card', cardType: 'credit',
        last4: '3749', bankName: 'FAB', openingFils: 0, color: '#fff',
      }],
      transactions: settlement,
      cardDues: [due],
    };
    const remainder = cardsGuardLib.dueWithStatus(
      settlementState, due, new Date(2026, 7, 10));
    ok('duplicate repair: one AED 4,000 settlement leaves AED 3,000 of AED 7,000 open',
      remainder.remainingFils === 300000, remainder);

    const secondReceipt = {
      ...receipt, id: 'payment-receipt-2',
      ts: debit.ts + 20 * 60_000, smsKey: `s${debit.ts + 20 * 60_000}-400000`,
    };
    const onePairPlusReal = require('./build/dedupe').reconcileCaptureDuplicates([
      debit, receipt, secondReceipt,
    ]);
    ok('duplicate repair: one debit consumes only one of two real receipts',
      onePairPlusReal.length === 2, onePairPlusReal);

    const twoDebits = {
      ...debit, id: 'payment-debit-2',
      ts: debit.ts + 2 * 60_000, smsKey: `s${debit.ts + 2 * 60_000}-400000`,
    };
    const twoReceipts = {
      ...receipt, id: 'payment-receipt-2',
      ts: debit.ts + 12 * 60_000, smsKey: `s${debit.ts + 12 * 60_000}-400000`,
    };
    const twoGenuinePayments = require('./build/dedupe').reconcileCaptureDuplicates([
      debit, twoDebits, receipt, twoReceipts,
    ]);
    ok('duplicate repair: two genuine settlement pairs remain two payments',
      twoGenuinePayments.length === 2, twoGenuinePayments);

    const editedSettlement = require('./build/dedupe').reconcileCaptureDuplicates([
      { ...debit, userEdited: true }, receipt,
    ]);
    ok('duplicate repair: weak settlement pairing never removes a user-edited row',
      editedSettlement.length === 2, editedSettlement);

    const otherCardReceipt = { ...receipt, id: 'other-card', accountId: 'fab-1111' };
    ok('duplicate repair: equal settlements on different cards remain separate',
      require('./build/dedupe').reconcileCaptureDuplicates([debit, otherCardReceipt]).length === 2);

    const large = Array.from({ length: 5_000 }, (_, index) => ({
      ...sms,
      id: `bulk-${index}`,
      amountFils: 1000 + index,
      ts: 1753400000000 + index * 60_000,
      smsKey: `s${1753400000000 + index * 60_000}-${1000 + index}`,
    }));
    const started = process.hrtime.bigint();
    const largeResult = require('./build/dedupe').reconcileCaptureDuplicates(large);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    ok(`duplicate repair: 5,000-row ledger stays linear (${elapsedMs.toFixed(0)}ms)`,
      largeResult.length === 5_000 && elapsedMs < 500);
  }

  // Adding to the guard has to close the door behind it, or a batch
  // duplicates against itself.
  {
    const guard = duplicateGuard([]);
    const c = {
      date: '2026-07-25', amountFils: 1200, title: 'Noon',
      type: 'expense', smsKey: 's1753400000000-1200', channel: 'inbox',
    };
    ok('duplicate: the first copy is not a duplicate', !guard.has(c));
    guard.add(c);
    ok('duplicate: the second copy in the same batch is', guard.has(c));
  }

  // The two SMS sources rejoin multi-part messages independently, so the
  // whitespace does not always survive identically.
  ok('duplicate: body prints ignore how the PDUs were rejoined',
    bodyPrint('Purchase of AED 77.00\n  at OPENAI  ') === bodyPrint('Purchase of AED 77.00 at OPENAI'));
}

// ── one definition of spending ──
//
// This was written four ways across six files. They agreed by luck, and one
// of them did not: archiving an account took its balance off Wallet and its
// history out of net worth, while its spending went on counting on Home, in
// Flow's categories, and against budgets. Hiding a card half-hid it.
{
  const ledger = require('./build/ledger');
  const ins = require('./build/insights');

  const accounts = [
    { id: 'live', name: 'FAB', kind: 'bank', openingFils: 0, color: '#000' },
    { id: 'gone', name: 'Old card', kind: 'card', openingFils: 0, color: '#000', archived: true },
  ];
  const live = ledger.liveAccountIds(accounts);
  ok('ledger: an archived account is not live', live.has('live') && !live.has('gone'));

  const tx = (over) => ({
    id: 'x', type: 'expense', amountFils: 10000, category: 'dining',
    accountId: 'live', title: 'Shop', date: '2026-07-10', source: 'sms', ...over,
  });

  ok('ledger: an ordinary purchase is spending', ledger.isSpending(tx(), live));
  ok('ledger: a transfer is not spending', !ledger.isSpending(tx({ isTransfer: true }), live));
  ok('ledger: income is not spending', !ledger.isSpending(tx({ type: 'income' }), live));
  ok('ledger: a hidden account spends nothing', !ledger.isSpending(tx({ accountId: 'gone' }), live));
  ok('ledger: without an account list, the transfer rule still applies',
    ledger.isSpending(tx({ accountId: 'gone' })) && !ledger.isSpending(tx({ isTransfer: true })));

  // The one thing that must NOT be filtered away as "just a transfer" —
  // card settlement is built on finding it.
  ok('ledger: the inbound leg of a transfer is findable',
    ledger.isInboundTransfer(tx({ type: 'income', isTransfer: true })) &&
      !ledger.isInboundTransfer(tx({ isTransfer: true })));

  // And the screens agree, because they ask the same function.
  const rows = [
    tx({ id: 'a', amountFils: 10000 }),
    tx({ id: 'b', amountFils: 25000, accountId: 'gone' }),
    tx({ id: 'c', amountFils: 5000, isTransfer: true }),
    tx({ id: 'd', type: 'income', amountFils: 900000, category: 'salary' }),
  ];
  const period = { mode: 'month', key: '2026-07' };
  const all = ins.summarizeMonth(rows, period);
  const shown = ins.summarizeMonth(rows, period, live);
  ok('ledger: the hidden account was counted before', all.expenseFils === 35000, String(all.expenseFils));
  ok('ledger: and is not counted now', shown.expenseFils === 10000, String(shown.expenseFils));
  ok('ledger: income skips transfers either way', shown.incomeFils === 900000, String(shown.incomeFils));
  ok('ledger: a category total agrees with the summary',
    ins.spentInMonthForCategory(rows, period, 'dining', live) === shown.expenseFils);
}

// ── every card under "Worth knowing" must lead somewhere real ──
//
// The user reported that MOST of them opened Unmatched Route. Twelve kinds of
// insight exist and seven of them pointed at "/stats" or "/budgets", neither
// of which has ever been a route. The static check in routes.test.js reads
// the destinations off the source; this one drives the real function with
// real data and checks what actually comes out, which is the only way to know
// a kind was not missed.
{
  const ins = require('./build/insights');
  const routes = new Set(ins.INSIGHT_DESTINATIONS);
  ok('insights: the destination list is not empty', routes.size > 0);

  // A ledger shaped to trip as many insight kinds as possible at once: two
  // months of history, a blown budget, a subscription, a price rise, and one
  // charge far bigger than the rest.
  const rows = [];
  const push = (date, amountFils, title, category, type = 'expense') =>
    rows.push({ id: `t${rows.length}`, type, amountFils, category, accountId: 'a', title, date, source: 'sms' });
  for (const m of ['06', '07']) {
    push(`2026-${m}-02`, 900000, 'Salary', 'salary', 'income');
    push(`2026-${m}-03`, 350000, 'Rent', 'rent');
    push(`2026-${m}-05`, 4500, 'Carrefour', 'groceries');
    push(`2026-${m}-09`, 290000, 'Carrefour', 'groceries');
    push(`2026-${m}-12`, 7700, 'ChatGPT', 'entertainment');
    push(`2026-${m}-19`, 12000, 'Talabat', 'dining');
  }
  push('2026-07-21', 480000, 'Emirates', 'travel'); // the outlier
  push('2026-07-22', 8800, 'ChatGPT', 'entertainment'); // a price rise

  const budgets = [{ category: 'groceries', limitFils: 250000 }];
  const built = [];
  for (const period of [{ mode: 'month', key: '2026-07' }, { mode: 'year', key: '2026' }, { mode: 'all' }]) {
    built.push(...ins.buildInsights(rows, budgets, period, new Date(2026, 6, 25)));
  }
  ok('insights: the fixture produces a useful spread', built.length >= 4, `${built.length}`);

  const noHref = built.filter((i) => !i.href);
  ok('insights: every card has somewhere to go', noHref.length === 0,
    noHref.map((i) => i.id).join(' | '));

  // Compare the ROUTE half. A destination may carry a query that scopes the
  // screen it opens ("/transactions?category=groceries"), which is still the
  // same route — and a card that lands you on an unfiltered list you have to
  // search yourself is barely better than one that lands you nowhere.
  const offRoute = built.filter((i) => i.href && !routes.has(i.href.split('?')[0]));
  ok('insights: no card points at a route that does not exist', offRoute.length === 0,
    [...new Set(offRoute.map((i) => `${i.id}→${i.href}`))].join(' | '));

  // The kinds this fixture actually reached, so a future reader can see the
  // coverage rather than trusting the count.
  const kinds = [...new Set(built.map((i) => i.id.replace(/-.*$/, '')))].sort();
  console.log(`  insight kinds exercised: ${kinds.join(', ')}`);
  ok('insights: budget cards were among them', kinds.includes('budget'), kinds.join(','));
}

// ── a price rise has to be a rise the user can see ──
//
// Home showed "Claude got pricier — Last charge AED 386 vs the usual AED
// 386." The test fires on the last charge against the PRIOR typical, and the
// card explained itself with the average of all charges INCLUDING that one,
// which had already absorbed the rise. Two numbers that had to agree, and
// nothing checking that they did.
{
  const subsLib = require('./build/subscriptions');
  const ins = require('./build/insights');

  const charge = (date, amountFils) => ({
    id: `c${date}`, type: 'expense', amountFils, category: 'entertainment',
    accountId: 'a', title: 'Claude', date, source: 'sms',
  });
  // Ten months at 350, then TWO at 386 — the shape that produced the bug.
  // `avgAmountFils` is the median of the last three charges, so as soon as
  // two of them are the new price it IS the new price, and quoting it beside
  // the new price says "386 vs 386". `priorTypicalFils` is the median of
  // everything before the latest charge, which is what the test used.
  const rows = [];
  for (let m = 1; m <= 10; m++) rows.push(charge(`2025-${String(m).padStart(2, '0')}-05`, 35000));
  rows.push(charge('2025-11-05', 38600));
  rows.push(charge('2025-12-05', 38600));

  const [sub] = subsLib.detectSubscriptions(rows, []);
  ok('price: the rise is detected', !!sub && sub.priceIncreased);
  ok('price: the prior typical is the figure it was judged against',
    sub.priorTypicalFils === 35000, String(sub?.priorTypicalFils));
  ok('price: the recent average has already absorbed the rise',
    sub.avgAmountFils === 38600, String(sub?.avgAmountFils));

  const built = ins.buildInsights(rows, [], { mode: 'all' }, new Date(2025, 11, 20));
  const card = built.find((i) => i.id.startsWith('price-up'));
  ok('price: the card is shown', !!card, built.map((i) => i.id).join(','));
  // The two figures in the sentence must differ, or it says nothing.
  const figures = (card?.body ?? '').match(/[\d,]+/g) ?? [];
  ok('price: the sentence names two different amounts',
    figures.length >= 2 && figures[0] !== figures[1], (card?.body ?? '').slice(0, 70));
}

// ── every row knows what time it happened ──
{
  const fmt = require('./build/format');
  const at = new Date(2026, 6, 18, 14, 32).getTime();

  ok('time: a new row carries its own timestamp',
    fmt.clockTime({ ts: at }) === '14:32', fmt.clockTime({ ts: at }));
  // Rows imported before `ts` existed still know — the fingerprint has always
  // been `s{timestamp}-{amount}`, so no migration is needed to read it back.
  ok('time: an older row recovers it from the SMS fingerprint',
    fmt.clockTime({ smsKey: `s${at}-4500` }) === '14:32', fmt.clockTime({ smsKey: `s${at}-4500` }));
  ok('time: a manual row simply has none', fmt.clockTime({}) === '');
  ok('time: a malformed fingerprint is not a date', fmt.clockTime({ smsKey: 'sABC-4500' }) === '');

  const stamp = fmt.fullDateTime({ date: '2026-07-18', ts: at });
  ok('time: the full stamp carries the year', /2026/.test(stamp), stamp);
  ok('time: and the clock', /14:32/.test(stamp), stamp);
  ok('time: a row with no clock still names its day',
    fmt.fullDateTime({ date: '2026-07-18' }) === '18 Jul 2026',
    fmt.fullDateTime({ date: '2026-07-18' }));
}

// ── a renewed card is the same card with new digits ──
//
// The user's Wallet listed six "FAB Credit Card" rows. They are not six
// cards: the bank reissued them, and a reissue keeps the account and changes
// the last four. The OLD number holds every purchase and payment; the NEW
// number holds the statement, because nothing has been spent on it yet. So
// the due sits on a row no payment will ever reach, and the payments sit on a
// row with no due. That is why a paid card kept reading as overdue.
{
  const cardsLib = require('./build/cards');
  const acc = require('./build/accounts');
  const today = new Date(2026, 6, 27);

  const card = (id, last4, over = {}) => ({
    id, name: `FAB Credit Card •${last4}`, kind: 'card', cardType: 'credit',
    last4, bankName: 'FAB', openingFils: 0, color: '#fff', ...over,
  });
  const spend = (id, accountId, date, fils) => ({
    id, type: 'expense', amountFils: fils, category: 'shopping', accountId,
    title: 'Shop', date, source: 'sms',
  });

  // •5793 has the history. •3324 has only the statement.
  const state = {
    accounts: [card('old', '5793'), card('new', '3324')],
    transactions: [spend('t1', 'old', '2026-05-02', 500000), spend('t2', 'old', '2026-06-11', 314440)],
    cardDues: [{ id: 'd', accountId: 'new', totalDueFils: 890900, minDueFils: 44545, dueDate: '2026-07-14', paidFils: 0 }],
    accountHints: { '5793': 'old', '3324': 'new' },
  };

  const found = cardsLib.reissueSuggestions(state, today);
  ok('reissue: the statement-only card is spotted', found.length === 1, JSON.stringify(found));
  ok('reissue: it points at the card holding the history',
    found[0]?.newAccountId === 'new' && found[0]?.candidateIds[0] === 'old');

  // A card with purchases of its own is not a reissue candidate.
  const spent = { ...state, transactions: [...state.transactions, spend('t3', 'new', '2026-07-20', 1000)] };
  ok('reissue: a card that has been spent on is not suggested',
    cardsLib.reissueSuggestions(spent, today).length === 0);

  // Different bank is a different card, whatever the timing.
  const otherBank = {
    ...state,
    accounts: [card('old', '5793'), card('new', '3324', { bankName: 'Emirates NBD' })],
  };
  ok('reissue: a different bank is never suggested',
    cardsLib.reissueSuggestions(otherBank, today).length === 0);

  // Most recently used first, so a card renewed last month beats one silent
  // since 2023.
  const three = {
    ...state,
    accounts: [card('old', '5793'), card('older', '4499'), card('new', '3324')],
    transactions: [...state.transactions, spend('t4', 'older', '2023-01-04', 900)],
  };
  ok('reissue: candidates are ranked by most recent use',
    cardsLib.reissueSuggestions(three, today)[0].candidateIds[0] === 'old');

  const livSplit = {
    accounts: [
      card('liv-history', '8575', { name: 'Liv Debit Card •8575', bankName: 'Liv', cardType: 'debit' }),
      card('enbd-statement', '8575', { name: 'Emirates NBD Credit Card •8575', bankName: 'Emirates NBD' }),
    ],
    transactions: [
      spend('liv-buy', 'liv-history', '2026-07-02', 14900),
      { id: 'enbd-pay', type: 'income', amountFils: 5000, category: 'other', accountId: 'enbd-statement', title: 'Card •8575 payment', date: '2026-07-10', source: 'sms', isTransfer: true, cardPaymentSide: 'receipt' },
    ],
    cardDues: [{ id: 'liv-due', accountId: 'enbd-statement', totalDueFils: 14900, minDueFils: 745, dueDate: '2026-07-14', paidFils: 0 }],
    accountHints: {}, bills: [],
  };
  const livCandidate = cardsLib.reissueSuggestions(livSplit, today);
  ok('link suggestion: Liv/ENBD same-last4 split is offered for confirmation',
    livCandidate[0]?.newAccountId === 'enbd-statement' &&
      livCandidate[0]?.candidateIds[0] === 'liv-history', livCandidate);
  ok('link suggestion: a payment row does not hide the split-card prompt',
    livCandidate.length === 1, livCandidate);
  ok('link suggestion: issuer context never auto-merges the rows',
    acc.mergeDuplicateAccounts(livSplit) === livSplit);

  const adcbSplit = {
    ...livSplit,
    accounts: [
      card('adcb-debit', '1111', { name: 'ADCB Debit Card •1111', bankName: 'ADCB', cardType: 'debit' }),
      card('adcb-credit', '1111', { name: 'ADCB Credit Card •1111', bankName: 'ADCB' }),
    ],
    transactions: [spend('adcb-buy', 'adcb-debit', '2026-07-02', 14900)],
    cardDues: [{ ...livSplit.cardDues[0], id: 'adcb-due', accountId: 'adcb-credit' }],
  };
  const adcbCandidate = cardsLib.reissueSuggestions(adcbSplit, today);
  ok('link suggestion: same-bank debit/credit split is offered, not auto-merged',
    adcbCandidate[0]?.newAccountId === 'adcb-credit' &&
      adcbCandidate[0]?.candidateIds[0] === 'adcb-debit' &&
      acc.mergeDuplicateAccounts(adcbSplit) === adcbSplit,
    adcbCandidate);

  const unrelatedSameDigits = {
    ...adcbSplit,
    accounts: [
      card('fab-debit', '1111', { name: 'FAB Debit Card •1111', bankName: 'FAB', cardType: 'debit' }),
      card('adcb-credit', '1111', { name: 'ADCB Credit Card •1111', bankName: 'ADCB' }),
    ],
    transactions: [spend('fab-buy', 'fab-debit', '2026-07-02', 14900)],
  };
  ok('link suggestion: unrelated banks sharing last4 are not suggested',
    cardsLib.reissueSuggestions(unrelatedSameDigits, today).length === 0);

  // The merge is what actually settles the statement.
  const stateWithMetadata = {
    ...state,
    accounts: [
      card('old', '5793', { creditLimitFils: 5000000, snapshotFils: 123400, snapshotKind: 'outstanding', snapshotTs: 200 }),
      card('new', '3324'),
    ],
    bills: [{ id: 'fee', title: 'Annual fee', category: 'other', amountFils: 10000, dueDay: 1, accountId: 'old', paidMonths: [] }],
  };
  const merged = acc.mergeRenewedCard(stateWithMetadata, 'old', 'new');
  ok('reissue: the old row is gone', merged.accounts.length === 1);
  ok('reissue: the survivor is the NEW number', merged.accounts[0].id === 'new');
  ok('reissue: it remembers what it replaced', merged.accounts[0].renewedFrom === 'old');
  ok('reissue: the history came across',
    merged.transactions.every((t) => t.accountId === 'new'));
  ok('reissue: the last-four hints follow', merged.accountHints['5793'] === 'new');
  ok('reissue: the due is on the same card as the history',
    merged.cardDues[0].accountId === 'new');
  ok('reissue: account metadata and bill references survive the confirmed link',
    merged.accounts[0].creditLimitFils === 5000000 &&
      merged.accounts[0].snapshotFils === 123400 &&
      merged.accounts[0].snapshotKind === 'outstanding' &&
      merged.bills[0].accountId === 'new',
    { account: merged.accounts[0], bills: merged.bills });

  // And once merged, a payment made under the OLD digits settles the
  // statement issued under the new ones. That is the whole point.
  const paid = {
    ...merged,
    transactions: [
      ...merged.transactions,
      { id: 'p', type: 'income', amountFils: 890900, category: 'other', accountId: 'new',
        title: 'Card payment', date: '2026-07-10', source: 'sms', isTransfer: true },
    ],
  };
  ok('reissue: a payment now settles the statement',
    cardsLib.openDues(paid, today).length === 0);

  // Declining must stick, or the app nags forever.
  const declined = acc.markCardsDistinct(state, 'new');
  ok('reissue: a declined suggestion is not offered again',
    cardsLib.reissueSuggestions(declined, today).length === 0);
}

// ── a salary month must say which days it covers ──
//
// A user opened Transactions, saw "4 transactions · Jun 2026" above four rows
// dated 2, 3, 10 and 13 JULY, and concluded their July payments had gone
// missing. They had not: their month starts on the 25th, so "Jun 2026" runs
// 25 Jun – 24 Jul and every one of those rows was correctly inside it. The
// heading was right and unreadable at the same time.
{
  const period = require('./build/period');
  const fmt = require('./build/format');

  fmt.setMonthStartDay(1);
  ok('period: a calendar month needs no explaining',
    period.periodRange({ mode: 'month', key: '2026-06' }) === '',
    period.periodRange({ mode: 'month', key: '2026-06' }));

  fmt.setMonthStartDay(25);
  const range = period.periodRange({ mode: 'month', key: '2026-06' });
  ok('period: a salary month states its real dates', range.includes('25') && /Jul/.test(range), range);
  ok('period: and it still calls itself June',
    period.periodLabel({ mode: 'month', key: '2026-06' }).startsWith('Jun'));

  // The thing that confused the user, asserted directly: a payment made on
  // 3 July belongs to the money-month called June.
  ok('period: a 3 July payment sits in the June salary month',
    fmt.monthKey('2026-07-03') === '2026-06', fmt.monthKey('2026-07-03'));
  ok('period: and a 27 July one sits in July', fmt.monthKey('2026-07-27') === '2026-07');

  // Other modes already state their own dates; do not repeat them.
  ok('period: a year needs no range', period.periodRange({ mode: 'year', year: 2026 }) === '');
  ok('period: all time needs no range', period.periodRange({ mode: 'all' }) === '');
  fmt.setMonthStartDay(1);
}

// ── moving your own money is not income ──
//
// A user moved AED 19,000 and AED 5,000 from their FAB •0002 account to their
// FAB •0004 account. The bank sends one message per side, neither mentions
// the other, and the arriving one reads exactly like being paid — so June's
// "In" carried 24,000 of their own savings as business revenue.
{
  const ledger = require('./build/ledger');
  const ins = require('./build/insights');

  const accounts = [
    { id: 'a2', name: 'FAB •0002', kind: 'bank', openingFils: 0, color: '#000' },
    { id: 'a4', name: 'FAB •0004', kind: 'bank', openingFils: 0, color: '#000' },
  ];
  const live = ledger.liveAccountIds(accounts);
  const row = (id, type, accountId, amountFils, date, over = {}) => ({
    id, type, amountFils, category: type === 'income' ? 'business' : 'other',
    accountId, title: 'Incoming transfer', date, source: 'sms', ...over,
  });

  const moved = [
    row('out19', 'expense', 'a2', 1900000, '2026-06-26', { title: 'Outgoing transfer', isTransfer: true }),
    row('in19', 'income', 'a4', 1900000, '2026-06-26'),
    row('out5', 'expense', 'a2', 500000, '2026-06-26', { title: 'Outgoing transfer', isTransfer: true }),
    row('in5', 'income', 'a4', 500000, '2026-06-26'),
    // Real salary, from outside — must survive.
    row('pay', 'income', 'a2', 2882800, '2026-06-26', { category: 'salary' }),
    // Real spending — must survive.
    row('shop', 'expense', 'a2', 12000, '2026-06-27', { title: 'Carrefour', category: 'groceries' }),
  ];

  const internal = ledger.internalTransferIds(moved, live);
  ok('internal: both halves of the move are paired',
    internal.size === 4 && internal.has('in19') && internal.has('out19'), [...internal].join(','));
  ok('internal: the salary is untouched', !internal.has('pay'));
  ok('internal: real spending is untouched', !internal.has('shop'));

  const period = { mode: 'month', key: '2026-06' };
  const before = ins.summarizeMonth(moved, period, live);
  const after = ins.summarizeMonth(moved, period, live, internal);
  ok('internal: In counted the arriving move before pairing', before.incomeFils === 2882800 + 2400000, String(before.incomeFils));
  ok('internal: In is just the salary now', after.incomeFils === 2882800, String(after.incomeFils));
  ok('internal: Out drops the outgoing half too', after.expenseFils === 12000, String(after.expenseFils));

  const externalRemittance = row(
    'external-remit', 'income', 'a4', 730000, '2026-06-27',
    { title: 'Inward remittance', category: 'other', isTransfer: false },
  );
  const externalInternal = ledger.internalTransferIds([externalRemittance], live);
  ok('internal: an unpaired inward remittance remains real income',
    externalInternal.size === 0 && ledger.isIncome(externalRemittance, live, externalInternal));

  const ownRemittance = [
    row('remit-out', 'expense', 'a2', 730000, '2026-06-27', {
      title: 'Outgoing transfer', isTransfer: true,
    }),
    externalRemittance,
  ];
  const ownRemittanceInternal = ledger.internalTransferIds(ownRemittance, live);
  ok('internal: a matched inward remittance is excluded only with its own-account leg',
    ownRemittanceInternal.size === 2 &&
      !ledger.isIncome(externalRemittance, live, ownRemittanceInternal),
    [...ownRemittanceInternal]);

  // Strictness. A same-amount pair on ONE account is not a move between two.
  const sameAccount = [
    row('o', 'expense', 'a2', 50000, '2026-06-10'),
    row('i', 'income', 'a2', 50000, '2026-06-10'),
  ];
  ok('internal: one account cannot transfer to itself',
    ledger.internalTransferIds(sameAccount, live).size === 0);

  // Two weeks apart is not one movement.
  const farApart = [
    row('o', 'expense', 'a2', 50000, '2026-06-01'),
    row('i', 'income', 'a4', 50000, '2026-06-20'),
  ];
  ok('internal: weeks apart is not a pair',
    ledger.internalTransferIds(farApart, live).size === 0);

  // Each row pairs once: two arrivals cannot both cancel one departure.
  const oneOut = [
    row('o', 'expense', 'a2', 50000, '2026-06-10', { title: 'Outgoing transfer', isTransfer: true }),
    row('i1', 'income', 'a4', 50000, '2026-06-10'),
    row('i2', 'income', 'a4', 50000, '2026-06-11'),
  ];
  ok('internal: one departure cancels one arrival, not two',
    ledger.internalTransferIds(oneOut, live).size === 2);

  // Coincidental money is not a transfer. The old matcher considered every
  // expense a possible outgoing leg, so a same-value purchase could erase a
  // real client payment or salary from both In and Out.
  const coincidence = [
    row('coffee', 'expense', 'a2', 50000, '2026-06-10', {
      title: 'Carrefour', category: 'groceries',
    }),
    row('client', 'income', 'a4', 50000, '2026-06-10', {
      title: 'Client payment', category: 'business',
    }),
  ];
  ok('internal: ordinary spend and real income of the same value are not paired',
    ledger.internalTransferIds(coincidence, live).size === 0);

  const salaryCoincidence = [
    row('sweep', 'expense', 'a2', 500000, '2026-06-10', {
      title: 'Outgoing transfer', isTransfer: true,
    }),
    row('salary-same', 'income', 'a4', 500000, '2026-06-10', {
      title: 'Salary', category: 'salary',
    }),
  ];
  ok('internal: a salary is never consumed as an arriving transfer leg',
    ledger.internalTransferIds(salaryCoincidence, live).size === 0);

  // Older rows can carry the structural title but predate isTransfer. The
  // headline already used the paired set; budgets and insight cards did not,
  // so one screen simultaneously said Out=0 and "budget exceeded".
  const legacyMove = [
    row('legacy-out', 'expense', 'a2', 200000, '2026-06-15', {
      title: 'Outgoing transfer', category: 'other',
    }),
    row('legacy-in', 'income', 'a4', 200000, '2026-06-15', {
      title: 'Incoming transfer', category: 'business',
    }),
  ];
  const legacyInternal = ledger.internalTransferIds(legacyMove, live);
  ok('internal: legacy structural transfer titles still pair safely', legacyInternal.size === 2);
  ok('internal: the category budget agrees with the transfer-safe headline',
    ins.spentInMonthForCategory(legacyMove, period, 'other', live, legacyInternal) === 0);
  const transferInsights = ins.buildInsights(
    legacyMove,
    [{ category: 'other', limitFils: 100000 }],
    period,
    new Date(2026, 5, 20),
    [],
    live,
    legacyInternal,
  );
  ok('internal: insights do not call an own-account move a budget overrun',
    !transferInsights.some((item) => item.id === 'budget-over-other'));
}

// ── the rest of the totals learn the same two exclusions ──
//
// The headline, the categories, the budget bar and the budget editor were
// taught to skip hidden accounts and both halves of an own-account move. Five
// figures were not, and each of them is printed within one tap of a figure
// that was: the "Biggest purchase" insight, and the four analytics rollups.
//
// categoryTrend was the worst of them, because it spelled the rule out by
// hand in the POSITIVE form — `type === 'expense' && !t.isTransfer` — which is
// the one shape the contract scan for hand-rolled spending was not looking
// for. It skipped only the flagged side of a transfer and knew nothing about
// hidden accounts at all.
{
  const ledger = require('./build/ledger');
  const ins = require('./build/insights');
  const an = require('./build/analytics');
  const fmt = require('./build/format');

  // Blocks above move the month boundary and put it back. Say so here rather
  // than inherit it, because every date below is built from monthKey(today).
  fmt.setMonthStartDay(1);

  const accounts = [
    { id: 'a2', name: 'FAB •0002', kind: 'bank', openingFils: 0, color: '#000' },
    { id: 'a4', name: 'FAB •0004', kind: 'bank', openingFils: 0, color: '#000' },
    { id: 'hidden', name: 'Old card', kind: 'card', openingFils: 0, color: '#000', archived: true },
  ];
  const live = ledger.liveAccountIds(accounts);

  // The trend series is keyed off the real clock, so the rows have to land in
  // the month the code will ask for rather than a month pinned in the file.
  const key = fmt.monthKey(new Date());
  const day = (n) => `${key}-${String(n).padStart(2, '0')}`;
  const period = { mode: 'month', key };

  const row = (id, type, accountId, amountFils, date, over = {}) => ({
    id, type, amountFils, accountId, date, source: 'sms',
    category: 'shopping', title: 'Carrefour', ...over,
  });

  const rows = [
    // A legacy own-account sweep: structural title, no isTransfer flag,
    // because it was imported before the flag existed. Both legs pair.
    row('sweep-out', 'expense', 'a2', 2400000, day(15), { title: 'Outgoing transfer' }),
    row('sweep-in', 'income', 'a4', 2400000, day(15), { title: 'Incoming transfer' }),
    // Spending on a card the user has hidden.
    row('hidden-buy', 'expense', 'hidden', 900000, day(16), { title: 'Emirates' }),
    // Real spending, which every one of these figures must still show.
    row('real', 'expense', 'a2', 30000, day(17), { title: 'Carrefour' }),
    row('apple', 'expense', 'a4', 1900000, day(18), { title: 'Apple Store' }),
  ];
  const internal = ledger.internalTransferIds(rows, live);
  ok('residual: the sweep pairs and nothing else does',
    internal.size === 2 && internal.has('sweep-out') && internal.has('sweep-in'),
    [...internal].join(','));

  // A purchase of exactly the sweep's value, on the account the sweep landed
  // in, on the same day. It is the outgoing leg the matcher would reach for if
  // amount and date were enough — and it is an AED 24,000 purchase, so pairing
  // it would erase a real expense AND leave the real sweep counted.
  const decoy = [
    row('leg-out', 'expense', 'a2', 2400000, day(10), { title: 'Outgoing transfer' }),
    row('same-value-buy', 'expense', 'a4', 2400000, day(10), { title: 'Apple Store' }),
    row('leg-in', 'income', 'a4', 2400000, day(10), { title: 'Incoming transfer' }),
  ];
  const decoyInternal = ledger.internalTransferIds(decoy, live);
  ok('residual: a same-value purchase is not mistaken for the outgoing leg',
    decoyInternal.size === 2 && decoyInternal.has('leg-out')
      && !decoyInternal.has('same-value-buy'), [...decoyInternal].join(','));

  // ── the insight that names one specific row ──
  const biggest = (extra) =>
    ins.buildInsights(rows, [], period, new Date(`${day(28)}T12:00:00`), [], ...extra)
      .find((i) => i.id === 'largest');

  const unguarded = biggest([]);
  ok('residual: unguarded, the biggest purchase was the sweep',
    !!unguarded && /transfer/i.test(unguarded.body), unguarded && unguarded.body);

  const guarded = biggest([live, internal]);
  ok('residual: the biggest purchase is a purchase',
    !!guarded && !/transfer/i.test(guarded.body) && !/Emirates/.test(guarded.body),
    guarded && guarded.body);
  ok('residual: the biggest surviving purchase is the one named',
    !!guarded && /Apple Store/.test(guarded.body), guarded && guarded.body);

  // It must agree with the headline it sits beside: the row it names has to be
  // one of the rows the month's Out actually counted.
  const summary = ins.summarizeMonth(rows, period, live, internal);
  ok('residual: Out counts only the two surviving purchases',
    summary.expenseFils === 30000 + 1900000, String(summary.expenseFils));

  // ── the four analytics rollups ──
  // The 4th argument is endKey, and it is a "YYYY-MM" string. Both branches
  // shipped a 4-parameter categoryTrend with the same arity and an
  // incompatible 4th parameter, so a Set arriving where the key belongs makes
  // every bucket read zero — a strip that says "nothing spent in this
  // category" rather than one that says "bug". Passing the month explicitly is
  // what pins the merged order here; analytics.ts throws by name if this call
  // site ever slides back to the old shape.
  const trendBefore = an.categoryTrend(rows, 'shopping', 1, period.key);
  const trendAfter = an.categoryTrend(rows, 'shopping', 1, period.key, live, internal);
  ok('residual: categoryTrend counted the hidden card and the sweep',
    trendBefore[0].fils === 30000 + 900000 + 1900000 + 2400000, String(trendBefore[0].fils));
  ok('residual: categoryTrend agrees with the month it is drawn under',
    trendAfter[0].fils === summary.expenseFils, String(trendAfter[0].fils));

  const merchants = an.topMerchants(rows, period, 5, live, internal);
  ok('residual: no merchant is a transfer or a hidden card',
    !merchants.some((m) => /transfer/i.test(m.title) || m.title === 'Emirates'),
    merchants.map((m) => m.title).join(','));
  ok('residual: topMerchants totals what the headline totals',
    merchants.reduce((s, m) => s + m.totalFils, 0) === summary.expenseFils);

  ok('residual: dayOfWeekSpend totals what the headline totals',
    an.dayOfWeekSpend(rows, period, live, internal).reduce((s, n) => s + n, 0)
      === summary.expenseFils);

  // Movers compare against the previous month, which is empty here — so every
  // surviving dirham shows up as the whole rise, and nothing else may.
  const movers = an.categoryMovers(rows, period, 4, live, internal);
  ok('residual: categoryMovers rises by exactly the surviving spend',
    movers.reduce((s, m) => s + m.currentFils, 0) === summary.expenseFils,
    JSON.stringify(movers));
}

// ── a legacy own-account sweep must not become a subscription or an export line ──
//
// detectSubscriptions and the expense-report export both totalled every
// title's own history without ever consulting internalTransferIds or the
// live-account set — the same gap the "residual" block above closed for the
// headline, categoryTrend, topMerchants, dayOfWeekSpend and categoryMovers.
// A monthly sweep between the user's own accounts, old enough to carry only
// the structural "Outgoing/Incoming transfer" title (no isTransfer flag),
// repeats on a stable monthly cadence exactly like a subscription — so it
// surfaced in Bills as a recurring commitment, and printed on the PDF handed
// to someone else as three months of reimbursable spend.
{
  const ledger = require('./build/ledger');
  const subsLib = require('./build/subscriptions');
  const report = require('./build/reimbursement-report');

  const accounts = [
    { id: 'a2', name: 'FAB •0002', kind: 'bank', openingFils: 0, color: '#000' },
    { id: 'a4', name: 'FAB •0004', kind: 'bank', openingFils: 0, color: '#000' },
  ];
  const live = ledger.liveAccountIds(accounts);

  const row = (id, type, accountId, amountFils, date, over = {}) => ({
    id, type, amountFils, accountId, date, source: 'sms',
    category: 'other', title: 'Outgoing transfer', ...over,
  });

  const sweep = [
    row('sweep-out-1', 'expense', 'a2', 500000, '2026-04-15'),
    row('sweep-in-1', 'income', 'a4', 500000, '2026-04-15', { title: 'Incoming transfer', category: 'business' }),
    row('sweep-out-2', 'expense', 'a2', 500000, '2026-05-15'),
    row('sweep-in-2', 'income', 'a4', 500000, '2026-05-15', { title: 'Incoming transfer', category: 'business' }),
    row('sweep-out-3', 'expense', 'a2', 500000, '2026-06-15'),
    row('sweep-in-3', 'income', 'a4', 500000, '2026-06-15', { title: 'Incoming transfer', category: 'business' }),
    // A legitimate recurring expense on the same cadence — must survive.
    row('netflix-1', 'expense', 'a2', 3999, '2026-04-20', { title: 'Netflix', category: 'entertainment' }),
    row('netflix-2', 'expense', 'a2', 3999, '2026-05-20', { title: 'Netflix', category: 'entertainment' }),
    row('netflix-3', 'expense', 'a2', 3999, '2026-06-20', { title: 'Netflix', category: 'entertainment' }),
    // A one-off purchase worth exactly the sweep's amount, on the day the
    // final sweep leg lands, on the account it lands in — the classic decoy
    // for a matcher that goes by amount and date alone, and real spending
    // every one of these figures must still show.
    row('decoy-buy', 'expense', 'a4', 500000, '2026-06-15', { title: 'Furniture Store', category: 'shopping' }),
  ];

  const internal = ledger.internalTransferIds(sweep, live);
  ok('sweep: all three months of the sweep pair off',
    internal.size === 6, [...internal].join(','));
  ok('sweep: the same-value furniture purchase is not swept into the pairing',
    !internal.has('decoy-buy'));

  const today = new Date(2026, 6, 25);

  const unguardedSubs = subsLib.detectSubscriptions(sweep, [], today);
  ok('sweep: without the exclusion, the sweep itself is detected as recurring',
    unguardedSubs.some((s) => s.title === 'Outgoing transfer'),
    unguardedSubs.map((s) => s.title).join(','));

  const guardedSubs = subsLib.detectSubscriptions(sweep, [], today, live, internal);
  ok('sweep: with live accounts and internal transfers passed in, the sweep never becomes a subscription',
    !guardedSubs.some((s) => s.title === 'Outgoing transfer'),
    guardedSubs.map((s) => s.title).join(','));
  ok('sweep: the real Netflix subscription still surfaces',
    guardedSubs.some((s) => s.title === 'Netflix'));
  ok('sweep: a one-off purchase is not treated as a recurring commitment',
    !guardedSubs.some((s) => s.title === 'Furniture Store'));

  // ── the expense export applies the same rule ──
  const unguardedRows = report.reportExpenses(sweep, '2026-04-01', '2026-06-30');
  ok('export: without the exclusion, all three sweep legs print as expenses',
    unguardedRows.filter((t) => t.title === 'Outgoing transfer').length === 3,
    unguardedRows.map((t) => t.id).join(','));

  const guardedRows = report.reportExpenses(sweep, '2026-04-01', '2026-06-30', live, internal);
  ok('export: with live accounts and internal transfers passed in, no sweep leg reaches the report',
    guardedRows.every((t) => t.title !== 'Outgoing transfer'),
    guardedRows.map((t) => t.id).join(','));
  ok('export: the real Netflix charges still print',
    guardedRows.filter((t) => t.title === 'Netflix').length === 3);
  ok('export: the same-value furniture purchase still prints',
    guardedRows.some((t) => t.id === 'decoy-buy'));

  // ── spending on an archived account must not reach the export either ──
  const archivedAccounts = [...accounts, { id: 'old', name: 'Old card', kind: 'card', openingFils: 0, color: '#000', archived: true }];
  const liveWithHidden = ledger.liveAccountIds(archivedAccounts);
  const hiddenRow = row('hidden-gym', 'expense', 'old', 15000, '2026-06-05', { title: 'Fitness First', category: 'health' });
  const withHidden = [...sweep, hiddenRow];
  const hiddenInternal = ledger.internalTransferIds(withHidden, liveWithHidden);
  const guardedWithHidden = report.reportExpenses(withHidden, '2026-04-01', '2026-06-30', liveWithHidden, hiddenInternal);
  ok('export: spending on an archived account does not print',
    !guardedWithHidden.some((t) => t.id === 'hidden-gym'));
}

// ── a price that halved must not say "price up" ──
//
// The user's Google One: AED 7.99 for a year, up to 76.99 on a tier change,
// then DOWN to 37 — and the row wore a PRICE UP badge in a month they paid
// less than half. The comment in subscriptions.ts had already claimed this
// merchant fixed once. It was not; the window was the problem both times.
{
  const subsLib = require('./build/subscriptions');
  const mk = (amountFils, date, i) => ({
    id: `g${i}`, type: 'expense', amountFils, category: 'entertainment',
    accountId: 'a', title: 'Google One', date, source: 'sms',
  });

  // Twelve months at 7.99, two at 76.99, three at 37 — their real shape.
  const rows = [];
  let i = 0;
  for (let m = 4; m <= 12; m++) rows.push(mk(799, `2025-${String(m).padStart(2, '0')}-02`, i++));
  for (const d of ['2026-01-02', '2026-02-02', '2026-03-02']) rows.push(mk(799, d, i++));
  rows.push(mk(7699, '2026-04-02', i++));
  rows.push(mk(7699, '2026-05-02', i++));
  for (const d of ['2026-06-02', '2026-07-02', '2026-08-02']) rows.push(mk(3700, d, i++));

  const [sub] = subsLib.detectSubscriptions(rows, [], new Date(2026, 7, 25));
  ok('google: the subscription is detected', !!sub, JSON.stringify(sub && sub.title));
  ok('google: a halved price is NOT a rise', sub.priceIncreased === false,
    `prior=${sub && sub.priorTypicalFils} last=${sub && sub.lastAmountFils}`);
  ok('google: the price it is compared against is the one before, not the lifetime median',
    sub.priorTypicalFils === 7699, String(sub && sub.priorTypicalFils));
  ok('google: the reported price is what it costs now', sub.avgAmountFils === 3700,
    String(sub && sub.avgAmountFils));

  // The rise that started it is still a rise, however long ago — a user who
  // has been paying more for three months has not stopped paying more.
  const upgraded = rows.slice(0, 14);
  const [up] = subsLib.detectSubscriptions(upgraded, [], new Date(2026, 4, 25));
  ok('google: the tier upgrade itself still reports as a rise', up.priceIncreased === true);
  ok('google: and names the old price it rose from', up.priorTypicalFils === 799,
    String(up && up.priorTypicalFils));

  // A price that never moved has nothing to announce.
  const steady = ['2026-04-02', '2026-05-02', '2026-06-02', '2026-07-02'].map((d, n) =>
    mk(3700, d, 100 + n));
  const [flat] = subsLib.detectSubscriptions(steady, [], new Date(2026, 6, 25));
  ok('google: a steady price is never a rise', flat.priceIncreased === false);
}

// ── Wallet says one thing per row ──
//
// The right-hand figure meant different things depending on what happened to
// be known: a bank-quoted balance where there was one, this month's spending
// where there was not, in the same column at the same weight. One row read
// "21,933 per bank SMS" and the row above it "466 spent this month", and
// nothing about the layout said those were different kinds of number.
{
  const cardsLib = require('./build/cards');
  const today = new Date(2026, 6, 27);

  const card = (id, over) => ({
    id, name: 'Card', kind: 'card', cardType: 'credit', last4: '1111',
    bankName: 'FAB', openingFils: 0, color: '#fff', ...over,
  });

  // A credit card with an open statement leads with what is still owed.
  const owing = {
    accounts: [card('c')],
    transactions: [],
    cardDues: [{ id: 'd', accountId: 'c', totalDueFils: 814440, minDueFils: 40722, dueDate: '2026-07-14', paidFils: 100000 }],
  };
  const owed = cardsLib.cardFigure(owing, owing.accounts[0], today);
  ok('wallet: a credit card leads with what is owed', owed.kind === 'owed');
  ok('wallet: and it is the REMAINDER, not the statement total',
    owed.fils === 714440, String(owed.fils));

  // Nothing owed is a real answer, not a blank.
  const clear = { accounts: [card('c')], transactions: [], cardDues: [] };
  const none = cardsLib.cardFigure(clear, clear.accounts[0], today);
  ok('wallet: a settled credit card owes zero', none.kind === 'owed' && none.fils === 0);

  // A debit card leads with its balance, and only when the bank quoted one.
  const debit = {
    accounts: [card('d', { cardType: 'debit', snapshotKind: 'balance', snapshotFils: 2193300 })],
    transactions: [], cardDues: [],
  };
  const bal = cardsLib.cardFigure(debit, debit.accounts[0], today);
  ok('wallet: a debit card leads with its balance',
    bal.kind === 'balance' && bal.fils === 2193300);

  const unknown = {
    accounts: [card('u', { cardType: 'debit' })],
    transactions: [{ id: 't', type: 'expense', amountFils: 100, category: 'other', accountId: 'u', title: 'x', date: '2026-07-01', source: 'sms' }],
    cardDues: [],
  };
  const nothing = cardsLib.cardFigure(unknown, unknown.accounts[0], today);
  ok('wallet: an unknown balance is never guessed at',
    nothing.kind === 'unknown' && nothing.fils === null);

  // Grouping: six FAB rows become one FAB group.
  const many = [
    card('a', { last4: '3644' }), card('b', { last4: '3749' }), card('c', { last4: '5793' }),
    card('d', { last4: '7720', bankName: 'ADCB' }),
    card('e', { last4: '1354', bankName: 'Liv' }),
    card('f', { last4: '9999', bankName: undefined }),
  ];
  const groups = cardsLib.groupCardsByBank(many);
  ok('wallet: cards are grouped by their bank', groups.length === 4, String(groups.length));
  ok('wallet: the biggest group leads', groups[0].bank === 'FAB' && groups[0].accounts.length === 3);
  ok('wallet: a card with no known bank is not its own bank',
    groups.some((g) => g.bank === 'Other cards' && g.accounts.length === 1));
  ok('wallet: every card appears exactly once',
    groups.reduce((n, g) => n + g.accounts.length, 0) === many.length);
}
// ── Splits ──
//
// The one thing that must never slip: the parts sum to the charge. If they
// drift, category totals stop matching the bank statement, which is the single
// bug a money app cannot ship.
const splits = require('./build/splits');

const tx = (over) => ({
  id: 't1', type: 'expense', amountFils: 10000, category: 'groceries',
  accountId: 'a1', title: 'Carrefour', date: '2026-07-18', ...over,
});

eq('allocationsOf: an unsplit row is one allocation of the whole amount',
  splits.allocationsOf(tx()), [{ category: 'groceries', amountFils: 10000 }]);

const twoWay = splits.normalizeSplits(10000, [
  { category: 'groceries', amountFils: 7000 },
  { category: 'shopping', amountFils: 3000 },
]);
eq('normalizeSplits: an exact split is left alone', twoWay.length, 2);
eq('normalizeSplits: exact split still sums to the charge',
  splits.unallocatedFils(10000, twoWay), 0);

// 100.00 three ways is 33.33 each — a fil short. Nobody should hunt for it.
const threeWay = splits.splitEvenly(10000, ['groceries', 'dining', 'shopping']);
eq('splitEvenly: three-way rounding remainder is absorbed',
  splits.unallocatedFils(10000, threeWay), 0);
eq('splitEvenly: every part stays positive',
  threeWay.every((s) => s.amountFils > 0), true);

// Parts that do not add up are corrected rather than stored wrong.
const short = splits.normalizeSplits(10000, [
  { category: 'groceries', amountFils: 4000 },
  { category: 'dining', amountFils: 3000 },
]);
eq('normalizeSplits: a short split is topped up to the charge',
  splits.unallocatedFils(10000, short), 0);
const over = splits.normalizeSplits(10000, [
  { category: 'groceries', amountFils: 9000 },
  { category: 'dining', amountFils: 6000 },
]);
eq('normalizeSplits: an overshooting split is pulled back to the charge',
  splits.unallocatedFils(10000, over), 0);

eq('normalizeSplits: the same category twice is folded into one part',
  splits.normalizeSplits(10000, [
    { category: 'groceries', amountFils: 6000 },
    { category: 'groceries', amountFils: 4000 },
  ]),
  undefined);
eq('normalizeSplits: a single part is not a split',
  splits.normalizeSplits(10000, [{ category: 'groceries', amountFils: 10000 }]), undefined);
eq('normalizeSplits: zero and negative parts are dropped',
  splits.normalizeSplits(10000, [
    { category: 'groceries', amountFils: 10000 },
    { category: 'dining', amountFils: 0 },
  ]), undefined);

const splitTx = tx({ splits: twoWay });
eq('amountInCategory: reads the part, not the whole charge',
  splits.amountInCategory(splitTx, 'groceries'), 7000);
eq('amountInCategory: a category not in the split contributes nothing',
  splits.amountInCategory(splitTx, 'transport'), 0);
eq('amountInCategory: an unsplit row still answers for its own category',
  splits.amountInCategory(tx(), 'groceries'), 10000);
eq('dominantCategory: the largest part wins', splits.dominantCategory(splitTx), 'groceries');
eq('isSplit', [splits.isSplit(splitTx), splits.isSplit(tx())], [true, false]);

// The whole point: a split changes how a charge is COUNTED, never how much.
eq('a split never changes the total spent',
  splits.allocationsOf(splitTx).reduce((n, a) => n + a.amountFils, 0), splitTx.amountFils);

// And analytics must agree with that.
const splitLedger = [splitTx];
eq('insights: category spend follows the split, not the headline category',
  [insights.spentInMonthForCategory(splitLedger, '2026-07', 'groceries'),
   insights.spentInMonthForCategory(splitLedger, '2026-07', 'shopping')],
  [7000, 3000]);
eq('analytics: the category trend follows the split too',
  an.categoryTrend(splitLedger, 'shopping', 1).length >= 1, true);


/* ══════════════════════════════════════════════════════════════════════════
 * Assertions carried across from the other branch's unit suite.
 *
 * Each branch's suite stayed green over the other's defects, so neither one is
 * a superset. What follows is everything the other side proved that this file
 * did not: the printed-total rounding identity, the declared route table
 * against the files on disk, the weekday chart's exclusions and trendShape, the
 * whole of reminders.ts (which had no coverage here at all), bill due-day
 * placement inside a salary-day month, and the demo seed swept over three years
 * of launch dates.
 *
 * It sits in one block so its locals cannot collide with anything above, and so
 * the two blocks that mutate module-level state — the month-start day — are
 * visibly opened and closed.
 * ══════════════════════════════════════════════════════════════════════════ */
{
  const fs = require('fs');
  const path = require('path');

  // ── A total is the sum of the figures printed under it ──
  //
  // Parts are snapped to the dirham BEFORE they are added, because the total is
  // a claim about the rows the user can see. Truncating instead put Wallet's
  // net worth at 96,467 over accounts reading 93,891 and 2,575.
  {
    const balForTotal = require('./build/balances');
    eq('net worth agrees with its parts to the dirham',
      fmt.formatAmount(
        balForTotal.netWorthFils({
          accounts: [
            { id: 'a', name: 'A', kind: 'bank', openingFils: 9389163, color: '#fff' },
            { id: 'b', name: 'B', kind: 'cash', openingFils: 257481, color: '#fff' },
          ],
          transactions: [],
        }),
        { decimals: false },
      ),
      '96,467');
  }

  // ── The declared route union, against the files on disk ──
  //
  // routes.test.js checks the routes the app PUSHES to. This checks the
  // declared `APP_ROUTES` union that the AppRoute type is built from — nothing
  // else does, and a union entry with no file behind it type-checks perfectly
  // and lands on "Unmatched Route" at runtime.
  {
    const routes = require('./build/routes');
    const APP_DIR = path.join(__dirname, '..', '..', 'src', 'app');

    /** Every route expo-router will actually serve, read off the filesystem. */
    const realRoutes = (dir = APP_DIR, prefix = '') => {
      const found = new Set();
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        // A (group) directory shapes navigation but contributes no URL segment.
        const segment = /^\(.*\)$/.test(entry.name) ? prefix : `${prefix}/${entry.name}`;
        if (entry.isDirectory()) {
          for (const r of realRoutes(path.join(dir, entry.name), segment)) found.add(r);
          continue;
        }
        if (!entry.name.endsWith('.tsx')) continue;
        const name = entry.name.replace(/\.tsx$/, '');
        if (name.startsWith('_') || name.startsWith('+')) continue; // layouts, +not-found
        found.add(name === 'index' ? prefix || '/' : `${prefix}/${name}`);
      }
      return found;
    };

    const onDisk = realRoutes();
    const missing = routes.APP_ROUTES.filter((r) => !onDisk.has(r));
    ok('routes: every declared route has a screen', missing.length === 0,
      `missing ${missing.join(', ')}`);
    ok('routes: the analytics screen exists', onDisk.has('/stats'));

    // The exact scenario from the bug: the demo seed, and every chevron on it.
    const seedTx = seed.generateSeedTransactions(new Date(2026, 6, 18));
    const seedInsights = insights.buildInsights(
      seedTx, seed.SEED_BUDGETS, '2026-07', new Date(2026, 6, 18));
    ok('routes: the seed still produces insights', seedInsights.length > 0);
    const deadEnds = seedInsights
      .map((i) => i.href)
      .filter((h) => h !== undefined)
      // A destination may carry a query string; the screen is what precedes it.
      .filter((h) => !onDisk.has(h.split('?')[0]));
    ok('routes: no insight points at a screen that does not exist', deadEnds.length === 0,
      `dead ends: ${deadEnds.join(', ')}`);
  }

  // ── The weekday chart is a claim about HABIT ──
  {
    const anx = require('./build/analytics');
    const aTx = [
      { id: '1', type: 'expense', amountFils: 50000, category: 'dining', accountId: 'a', title: 'Talabat', date: '2026-07-04' },
      { id: '2', type: 'expense', amountFils: 30000, category: 'dining', accountId: 'a', title: 'Talabat', date: '2026-07-11' },
      { id: '3', type: 'expense', amountFils: 20000, category: 'groceries', accountId: 'a', title: 'Carrefour', date: '2026-07-05' },
      { id: '4', type: 'expense', amountFils: 90000, category: 'dining', accountId: 'a', title: 'Talabat', date: '2026-06-10' },
      { id: '5', type: 'income', amountFils: 999, category: 'other', accountId: 'a', title: 'Pay', date: '2026-07-01', isTransfer: true },
    ];
    const dw = anx.dayOfWeekSpend(aTx, '2026-07');

    // One AED 5,500 rent charge is 55x a grocery run: leave it in and the bar
    // for whichever weekday the standing order fell on IS the chart, and the
    // "heaviest day" reading flips if the landlord takes it a day later.
    const rentTx = aTx.concat([
      { id: 'r1', type: 'expense', amountFils: 550000, category: 'rent', accountId: 'a', title: 'Apartment Rent', date: '2026-07-01' },
      { id: 'b1', type: 'expense', amountFils: 300000, category: 'business', accountId: 'a', title: 'Supplier', date: '2026-07-02' },
    ]);
    const dwRent = anx.dayOfWeekSpend(rentTx, '2026-07');
    ok('analytics: rent excluded from weekday spend', dwRent.reduce((a, b) => a + b, 0) === 100000);
    ok('analytics: business costs excluded from weekday spend', dwRent.every((v, i) => v === dw[i]));
    // 1 Jul 2026 is a Wednesday. With rent counted it owned the chart outright;
    // without it, Saturday (the AED 500 Talabat on the 4th) is the heaviest day.
    const heaviest = dwRent.indexOf(Math.max(...dwRent));
    ok('analytics: heaviest day is a real habit, not rent day',
      heaviest === 6 && dwRent[3] === 0, `heaviest ${heaviest}, wed ${dwRent[3]}`);

    // The trend window ends where the REPORT ends, not at today: a screen
    // reporting on June must not draw a strip that runs to August.
    const junTrend = anx.categoryTrend(aTx, 'dining', 3, '2026-06');
    ok('analytics: trend window ends at the month asked for',
      junTrend.length === 3 && junTrend[2].key === '2026-06' && junTrend[2].fils === 90000,
      JSON.stringify(junTrend));
    ok('analytics: trend window walks backwards from there',
      junTrend[0].key === '2026-04' && junTrend[0].fils === 0);

    // ── trend shape: the flat case is a finding, not a template hole ──
    //
    // Rent is the same AED 5,500 every month, and the caption read "AED 5,500 a
    // month on average, AED 5,500 in the latest" — one number printed twice and
    // called an observation.
    const flatShape = anx.trendShape(
      [550000, 550000, 550000, 550000, 550000, 550000].map((fils) => ({ fils })));
    ok('trendShape: identical months read flat',
      flatShape.flat === true && flatShape.averageFils === 550000);
    // A standing order that wobbles a few fils has still not moved.
    const wobbly = anx.trendShape(
      [550000, 550100, 549900, 550000, 550050, 550000].map((fils) => ({ fils })));
    ok('trendShape: sub-1% wobble still reads flat', wobbly.flat === true);
    const risingShape = anx.trendShape(
      [10000, 10000, 10000, 10000, 10000, 20000].map((fils) => ({ fils })));
    ok('trendShape: a rising series is not flat', risingShape.flat === false);
    ok('trendShape: average across the window', risingShape.averageFils === 11667,
      String(risingShape.averageFils));
    ok('trendShape: latest against average',
      Math.round(risingShape.latestVsAverage * 100) === 71,
      String(risingShape.latestVsAverage));
    ok('trendShape: latest recognised as the peak',
      risingShape.latestIsHighest === true && risingShape.latestIsLowest === false);
    const fallingShape = anx.trendShape(
      [20000, 20000, 20000, 20000, 20000, 10000].map((fils) => ({ fils })));
    ok('trendShape: latest recognised as the floor',
      fallingShape.latestIsLowest === true && fallingShape.latestVsAverage < 0);
    const emptyShape = anx.trendShape([]);
    ok('trendShape: empty series is flat and zero',
      emptyShape.flat === true && emptyShape.averageFils === 0 &&
        emptyShape.latestVsAverage === 0);
  }

  // ── reminders.ts: nothing else in this suite touches it ──
  //
  // A reminder that fires after the bill is due is worse than none: it teaches
  // the user the notification means "you are late". The clamp is the whole
  // problem — a bill due on the 31st used to roll forward to 2–3 March in
  // February, so both of its reminders landed after it was already overdue.
  {
    const remind = require('./build/reminders');
    // The account is not decoration. buildPaymentReminders passes
    // liveAccountIds(state.accounts) into detectSubscriptions, so with no
    // accounts every transaction reads as belonging to a dead account and
    // nothing is ever detected — the subscription reminders below would pass
    // vacuously by finding nothing to remind about.
    const remState = (over = {}) => ({
      accounts: [{ id: 'a', name: 'Current', kind: 'bank', openingFils: 0, color: '#fff' }],
      transactions: [], cardDues: [], bills: [], notSubscriptions: [], ...over,
    });
    const mkRemBill = (id, dueDay, over = {}) => ({
      id, title: id, category: 'utilities', amountFils: 20000, dueDay, paidMonths: [], ...over,
    });
    const febNow = new Date(2026, 1, 20); // 20 Feb 2026 — February has 28 days

    eq('billDueISO clamps day 31 into February', bills.billDueISO(31, '2026-02'), '2026-02-28');
    eq('billDueISO clamps day 31 into a leap February', bills.billDueISO(31, '2028-02'), '2028-02-29');
    eq('billDueISO leaves a day that fits alone', bills.billDueISO(15, '2026-07'), '2026-07-15');

    const febRem = remind.buildPaymentReminders(
      remState({ bills: [mkRemBill('Etisalat', 31)] }), febNow);
    eq('reminders: a 31st-of-the-month bill is reminded inside February',
      febRem.map((r) => r.dateISO), ['2026-02-27', '2026-02-28']);
    ok('reminders: never spill into the next month',
      febRem.every((r) => !r.dateISO.startsWith('2026-03')));
    // Midnight is when a phone is face-down on a nightstand; 09:00 is when a
    // bill can actually be paid.
    ok('reminders: fire at 09:00 local, not midnight',
      febRem.every((r) => r.date.getHours() === 9 && r.date.getMinutes() === 0));
    ok('reminders: the day-before one is worded as tomorrow',
      febRem[0].title.endsWith('due tomorrow') && febRem[1].title.endsWith('due today'));

    ok('reminders: a manually paid bill is silent',
      remind.buildPaymentReminders(
        remState({ bills: [mkRemBill('Etisalat', 31, { paidMonths: ['2026-02'] })] }), febNow,
      ).length === 0);

    // status === 'paid' already covers auto-reconciled, which is why the second
    // paidMonths check the old loop carried after it was unreachable.
    ok('reminders: a bill already reconciled from its debit is silent',
      remind.buildPaymentReminders(remState({
        bills: [mkRemBill('DEWA', 31, { amountFils: 44900 })],
        transactions: [{ id: 'd', type: 'expense', amountFils: 45000, category: 'utilities', accountId: 'a', title: 'DEWA Bill', date: '2026-02-14' }],
      }), febNow).length === 0);

    ok('reminders: a due date already gone is not scheduled',
      remind.buildPaymentReminders(remState({ bills: [mkRemBill('Salik', 5)] }), febNow).length === 0);

    const cardRem = remind.buildPaymentReminders(remState({
      accounts: [{ id: 'cc', name: 'FAB Credit Card', kind: 'card', cardType: 'credit', openingFils: 0, color: '#fff' }],
      cardDues: [{ id: 'd1', accountId: 'cc', totalDueFils: 100000, minDueFils: 5000, dueDate: '2026-02-25', paidFils: 0 }],
    }), febNow);
    eq('reminders: a card statement gets three days of warning, then the day itself',
      cardRem.map((r) => r.dateISO), ['2026-02-22', '2026-02-25']);

    const subTxs = ['2025-11-25', '2025-12-25', '2026-01-25'].map((date, i) => ({
      id: `s${i}`, type: 'expense', amountFils: 5600, category: 'entertainment',
      accountId: 'a', title: 'Netflix', date,
    }));
    const subsForRem = require('./build/subscriptions')
      .detectSubscriptions(subTxs, [], febNow)
      .find((s) => s.title === 'Netflix');
    const subRem = remind.buildPaymentReminders(remState({ transactions: subTxs }), febNow);
    ok('reminders: a subscription is flagged the day before it renews',
      subsForRem && subRem.length === 1 &&
        subRem[0].dateISO === fmt.shiftISO(subsForRem.nextExpectedISO, -1),
      JSON.stringify(subRem.map((r) => r.dateISO)));
    ok('reminders: a merchant already tracked as a bill is not reminded twice',
      remind.buildPaymentReminders(
        remState({ transactions: subTxs, bills: [mkRemBill('Netflix', 5)] }), febNow,
      ).length === 0);

    const manyRem = remind.buildPaymentReminders(
      remState({ bills: Array.from({ length: 40 }, (_, i) => mkRemBill(`B${i}`, 28)) }), febNow, 24);
    ok('reminders: capped and sorted soonest first',
      manyRem.length === 24 &&
        manyRem.every((r, i) => i === 0 || manyRem[i - 1].date.getTime() <= r.date.getTime()));
  }

  // ── The demo seed a first launch actually opens on ──
  //
  // A fresh install opened on "SUBS 0 · CARDS 0": every merchant in the seed was
  // charged on a random day for a random amount, so nothing recurred and nothing
  // recurring could be detected; and the bills' due days sat before their
  // debits, so the demo greeted you with an overdue DEWA. Nothing below is
  // anchored to a fixed date — the three-year sweep is the point, because the
  // seed draws from a PRNG stream anchored to wall-clock `now` and what surfaces
  // must not drift with the calendar.
  {
    const demoCards = require('./build/cards');
    const demoSubs = require('./build/subscriptions');
    const demoBills = require('./build/bills');
    const demoBal = require('./build/balances');
    const demoFacts = (nowDate) => {
      const transactions = seed.generateSeedTransactions(nowDate);
      const cardDues = seed.generateSeedCardDues(nowDate, transactions);
      const state = {
        hydrated: true, accounts: seed.SEED_ACCOUNTS, transactions, cardDues,
        bills: seed.SEED_BILLS, budgets: seed.SEED_BUDGETS, goals: [],
        merchantOverrides: {}, accountHints: {}, notSubscriptions: [],
      };
      const detected = demoSubs.detectSubscriptions(transactions, [], nowDate);
      return {
        subs: demoSubs.activeSubscriptions(demoSubs.trueSubscriptions(detected)),
        commitments: demoSubs.activeSubscriptions(demoSubs.fixedCommitments(detected)),
        stopped: demoSubs.stoppedSubscriptions(demoSubs.trueSubscriptions(detected)),
        dues: demoCards.openDues(state, nowDate),
        bills: demoBills.billsForMonth(seed.SEED_BILLS, transactions, nowDate),
        priceRises: detected.filter((s) => s.priceIncreased),
        cashFils: demoBal.accountBalanceFils(state, 'acc-cash'),
      };
    };

    const demoJul = demoFacts(new Date(2026, 6, 18));
    ok('demo: Bills → Subscriptions is not empty', demoJul.subs.length >= 5,
      `${demoJul.subs.length}: ${demoJul.subs.map((s) => s.title).join(', ')}`);
    ok('demo: Netflix, Spotify and the gym are among them',
      ['Netflix', 'Spotify Premium', 'Fitness First']
        .every((t) => demoJul.subs.some((s) => s.title === t)),
      demoJul.subs.map((s) => s.title).join(', '));
    ok('demo: Bills → Cards is not empty', demoJul.dues.length > 0);
    ok('demo: the card due is real money', demoJul.dues.every((d) => d.remainingFils > 0));
    ok('demo: du, Etisalat, DEWA and Salik are detected as fixed commitments',
      ['du Home Internet', 'Etisalat Postpaid', 'DEWA Bill', 'Salik Auto Recharge']
        .every((t) => demoJul.commitments.some((s) => s.title === t)),
      demoJul.commitments.map((s) => s.title).join(', '));
    ok('demo: one cancelled subscription to show', demoJul.stopped.length === 1,
      demoJul.stopped.map((s) => s.title).join(', '));
    ok('demo: exactly one thing worth noticing (a price rise)', demoJul.priceRises.length === 1,
      demoJul.priceRises.map((s) => s.title).join(', '));
    // `priorTypicalFils`, not the other branch's `previousAmountFils`: the
    // merged Subscription carries one name for this and a rise that reads
    // "AED 56 up from AED 56" is the tautology this assertion exists to stop.
    ok('demo: the price rise reads as a rise, not a tautology',
      demoJul.priceRises.every((s) => s.priorTypicalFils < s.lastAmountFils),
      JSON.stringify(demoJul.priceRises.map((s) => [s.priorTypicalFils, s.lastAmountFils])));

    // Every launch date for three years. What the demo GUARANTEES must not
    // drift with the calendar — an e2e suite broke on exactly that.
    const sweep = { subs: [], dues: [], overdue: 0, noRise: 0, negativeCash: 0, days: 0 };
    for (let d = new Date(2025, 0, 1); d < new Date(2028, 0, 1); d.setDate(d.getDate() + 1)) {
      const f = demoFacts(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
      sweep.days++;
      sweep.subs.push(f.subs.length);
      sweep.dues.push(f.dues.length);
      if (f.bills.some((b) => b.status === 'overdue')) sweep.overdue++;
      if (f.priceRises.length !== 1) sweep.noRise++;
      if (f.cashFils < 0) sweep.negativeCash++;
    }
    ok(`demo: subscriptions on every one of ${sweep.days} launch dates`,
      Math.min(...sweep.subs) >= 5, `worst day had ${Math.min(...sweep.subs)}`);
    ok(`demo: a card due on every one of ${sweep.days} launch dates`,
      Math.min(...sweep.dues) >= 1, `worst day had ${Math.min(...sweep.dues)}`);
    ok('demo: never opens on an overdue bill', sweep.overdue === 0,
      `${sweep.overdue}/${sweep.days} days`);
    ok('demo: always has exactly one price rise', sweep.noRise === 0,
      `${sweep.noRise}/${sweep.days} days`);
    ok('demo: the cash wallet never goes negative', sweep.negativeCash === 0,
      `${sweep.negativeCash}/${sweep.days} days`);

    // Stability: a given calendar month holds the same rows whenever you look,
    // and today's ledger is yesterday's plus today's — never a rewrite.
    // Three exemptions, each one a deliberate rolling element rather than a
    // leak: transfers and card payments are re-dated with the statement cycle,
    // Netflix's price step is relative to today, and the one foreign-currency
    // charge a month rotates by MONTHS-BACK from `now` (seed.ts picks
    // FOREIGN[back % 3] so the same merchant never repeats inside a cadence
    // window and is never mistaken for a subscription). Everything else in a
    // past month is frozen — that is what the e2e suite trusts.
    const rollingByDesign = (t) =>
      t.isTransfer || t.title === 'Netflix' || t.originalCurrency !== undefined;
    const marchFrom = (nowDate) => seed.generateSeedTransactions(nowDate)
      .filter((t) => t.date.startsWith('2026-03') && !rollingByDesign(t))
      .map((t) => `${t.date}|${t.title}|${t.amountFils}`).sort().join('\n');
    ok('demo: a past month reads the same from any later launch date',
      marchFrom(new Date(2026, 3, 9)) === marchFrom(new Date(2026, 5, 27)));
    const dayBefore = seed.generateSeedTransactions(new Date(2026, 4, 20));
    const dayAfter = new Set(seed.generateSeedTransactions(new Date(2026, 4, 21))
      .map((t) => `${t.date}|${t.title}|${t.amountFils}`));
    ok('demo: a new day adds rows, it does not rewrite them',
      dayBefore.filter((t) => !rollingByDesign(t))
        .every((t) => dayAfter.has(`${t.date}|${t.title}|${t.amountFils}`)));
  }

  // ── A bill's due DAY inside a salary-day month ──
  //
  // MUTATES the module-level month-start day, and restores it at the end of the
  // block. A report month starting on the 25th runs 25 Jun – 24 Jul, so day 30
  // is in June and day 10 is in July — a bare `new Date(year, month, dueDay)`
  // put both in the same calendar month, and Bills and the reminder set then
  // disagreed about which month a bill was even in.
  {
    const remind = require('./build/reminders');
    fmt.setMonthStartDay(25);
    try {
      // The identity every "days left in the month" figure leans on: a report
      // month starting on day D holds exactly as many days as its calendar
      // month does.
      ok('salary month: daysInMonth IS the report-month length',
        ['2026-01', '2026-02', '2026-04', '2028-02'].every((k) =>
          fmt.daysBetweenISO(fmt.monthStartISO(k), fmt.monthEndISO(k)) + 1 === fmt.daysInMonth(k)));

      ok('salary month: a due day at or after the start sits in the first half',
        bills.billDueISO(30, '2026-06') === '2026-06-30');
      ok('salary month: a due day before the start sits in the tail',
        bills.billDueISO(10, '2026-06') === '2026-07-10');
      ok('salary month: the tail is still clamped to its own month length',
        bills.billDueISO(10, '2026-01') === '2026-02-10' &&
          bills.billDueISO(30, '2026-02') === '2026-02-28');

      const salaryNow = new Date(2026, 6, 10); // 10 Jul 2026 → report month 2026-06
      const salaryBills = [
        { id: 'early', title: 'Early', category: 'utilities', amountFils: 10000, dueDay: 30, paidMonths: [] },
        { id: 'late', title: 'Late', category: 'utilities', amountFils: 10000, dueDay: 20, paidMonths: [] },
      ];
      const salaryRows = bills.billsForMonth(salaryBills, [], salaryNow);
      const salaryRow = (id) => salaryRows.find((r) => r.bill.id === id);
      ok('salary month: a due day already passed in the window reads overdue',
        salaryRow('early').dueISO === '2026-06-30' && salaryRow('early').daysLeft === -10,
        JSON.stringify(salaryRow('early') && [salaryRow('early').dueISO, salaryRow('early').daysLeft]));
      ok('salary month: a due day still ahead in the window reads upcoming',
        salaryRow('late').dueISO === '2026-07-20' && salaryRow('late').daysLeft === 10,
        JSON.stringify(salaryRow('late') && [salaryRow('late').dueISO, salaryRow('late').daysLeft]));

      // Only 'late' is still ahead, and it is reminded on the pair of days
      // either side of the date the Bills screen prints — not on the 19th/20th
      // of June, which is where the raw calendar month would have put it.
      const salaryReminders = remind.buildPaymentReminders(
        { accounts: [], transactions: [], cardDues: [], bills: salaryBills, notSubscriptions: [] },
        salaryNow);
      eq('salary month: reminders land either side of the date Bills shows',
        salaryReminders.map((r) => r.dateISO), ['2026-07-19', '2026-07-20']);
    } finally {
      fmt.setMonthStartDay(1);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
