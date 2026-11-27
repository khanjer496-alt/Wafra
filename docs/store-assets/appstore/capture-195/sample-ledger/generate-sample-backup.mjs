// Synthetic USD sample ledger for the App Store 1.0 (build 195) captures.
//
// Every merchant, bank and card name below is fictional. No real messages,
// statements or personal data are used. The shape follows src/lib/seed.ts
// (the app's own demo ledger): a recurring spine, irregular everyday spending,
// one foreign charge per month and a card whose past statements were paid on
// time, so the app's own detectors find subscriptions and one open card due.
//
// Output: a Wafra backup file (`{ app: 'wafra', version: 1, data }`) restored
// through the app's normal "Restore a backup" flow on the simulator.
//
//   node generate-sample-backup.mjs 2026-11-26 > wafra-sample-backup-usd.json
import { argv } from 'node:process';

const now = argv[2] ? new Date(`${argv[2]}T10:30:00`) : new Date();
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const shift = (s, days) => { const d = new Date(`${s}T12:00:00`); d.setDate(d.getDate() + days); return iso(d); };
const cents = (usd) => Math.round(usd * 100);

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function monthSeed(year, month) {
  let h = (year * 12 + month) ^ 0x1b873593;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

const BANK = 'acc-checking';
const CARD = 'acc-card';
const CASH = 'acc-cash';
const ACCOUNTS = [
  { id: BANK, name: 'Everyday Checking', kind: 'bank', openingFils: cents(6200), color: '#2DD4A8', last4: '4417', bankName: 'Larkspur Bank' },
  { id: CARD, name: 'Larkspur Rewards Card', kind: 'card', openingFils: 0, color: '#60A5FA', last4: '2093', cardType: 'credit', bankName: 'Larkspur Bank', creditLimitFils: cents(8000) },
  { id: CASH, name: 'Cash', kind: 'cash', openingFils: cents(160), color: '#E9B949' },
];
const BUDGETS = [
  { category: 'groceries', limitFils: cents(650) },
  { category: 'dining', limitFils: cents(380) },
  { category: 'transport', limitFils: cents(260) },
  { category: 'shopping', limitFils: cents(450) },
  { category: 'entertainment', limitFils: cents(120) },
];
const MERCHANTS = [
  { title: 'Greenleaf Market', category: 'groceries', min: 38, max: 140, accountId: CARD, freq: 4 },
  { title: 'Harvest Grocer', category: 'groceries', min: 22, max: 95, accountId: CARD, freq: 2 },
  { title: 'Corner Pantry', category: 'groceries', min: 8, max: 34, accountId: CASH, freq: 2 },
  { title: 'Blue Door Bistro', category: 'dining', min: 28, max: 86, accountId: CARD, freq: 2 },
  { title: 'Noodle Lane', category: 'dining', min: 14, max: 38, accountId: CARD, freq: 3 },
  { title: 'Sunrise Bakery', category: 'dining', min: 6, max: 18, accountId: CASH, freq: 4 },
  { title: 'Daily Grind Cafe', category: 'dining', min: 4, max: 9, accountId: CARD, freq: 6 },
  { title: 'CityRide', category: 'transport', min: 9, max: 32, accountId: CARD, freq: 5 },
  { title: 'Fuel Stop', category: 'transport', min: 34, max: 62, accountId: CARD, freq: 2 },
  { title: 'Northwind Goods', category: 'shopping', min: 18, max: 140, accountId: CARD, freq: 2 },
  { title: 'Maple Home Store', category: 'shopping', min: 25, max: 120, accountId: CARD, freq: 1 },
  { title: 'Starlight Cinema', category: 'entertainment', min: 14, max: 36, accountId: CARD, freq: 1 },
  { title: 'Willow Pharmacy', category: 'health', min: 9, max: 48, accountId: CARD, freq: 1 },
];
const RECURRING = [
  { title: 'StreamBox', category: 'software', accountId: CARD, day: 14, usd: 11.99, raised: 15.99, raisedMonthsBack: 2 },
  { title: 'Tuneful Music', category: 'software', accountId: CARD, day: 7, usd: 10.99 },
  { title: 'CloudVault Storage', category: 'software', accountId: CARD, day: 25, usd: 2.99 },
  { title: 'ParcelPass Plus', category: 'software', accountId: CARD, day: 21, usd: 14.99 },
  { title: 'FitLoop Gym', category: 'health', accountId: BANK, day: 3, usd: 39 },
  { title: 'Popcorn TV', category: 'software', accountId: CARD, day: 19, usd: 8.99, stoppedMonthsBack: 3 },
  { title: 'Brightline Mobile', category: 'telecom', accountId: BANK, day: 4, usd: 45 },
  { title: 'Fiberwave Internet', category: 'telecom', accountId: BANK, day: 9, usd: 65 },
  { title: 'City Power & Light', category: 'utilities', accountId: BANK, day: 22, usd: 118, vary: 8 },
];
// Subscription services use the 'software' category: the app's detector
// lists cancellable services by known name or that category, and every
// name here is fictional.
// Reminders two days after the matching debit, as in src/lib/seed.ts.
const BILLS = [
  { id: 'bill-mobile', title: 'Brightline Mobile', category: 'telecom', amountFils: cents(45), dueDay: 6, paidMonths: [] },
  { id: 'bill-internet', title: 'Fiberwave Internet', category: 'telecom', amountFils: cents(65), dueDay: 11, paidMonths: [] },
  { id: 'bill-power', title: 'City Power & Light', category: 'utilities', amountFils: cents(118), dueDay: 24, paidMonths: [] },
];
const FOREIGN = [
  { title: 'Cafe Lumiere', category: 'dining', currency: 'EUR', originalMinor: 2_480, rate: 1.0842, source: 'bank' },
  { title: 'Thames Bookshop', category: 'shopping', currency: 'GBP', originalMinor: 3_150, rate: 1.2715, source: 'reference' },
  { title: 'Maple Leaf Outfitters', category: 'shopping', currency: 'CAD', originalMinor: 6_400, rate: 0.7312, source: 'fallback' },
];
const HISTORY_MONTHS = 6;
const CYCLE = 30, CLOSED_DAYS_AGO = 12, DAYS_TO_PAY = 21;
const today = iso(now);

function statements() {
  const count = Math.ceil((HISTORY_MONTHS + 1) * 31 / CYCLE);
  const out = [];
  for (let back = count - 1; back >= 0; back--) {
    const toISO = shift(today, -(CLOSED_DAYS_AGO + back * CYCLE));
    out.push({ id: `sample-stmt-${back}`, fromISO: shift(toISO, -(CYCLE - 1)), toISO, dueISO: shift(toISO, DAYS_TO_PAY), paidISO: shift(toISO, DAYS_TO_PAY - 3) });
  }
  return out;
}
const spentOnCard = (txs, w) => txs.reduce((sum, t) => (t.accountId === CARD && t.type === 'expense' && !t.isTransfer && t.date >= w.fromISO && t.date <= w.toISO ? sum + t.amountFils : sum), 0);

const txs = [];
let n = 0;
const push = (t) => { if (t.date <= today) txs.push({ id: `sample-${n++}`, ...t }); };
for (let back = HISTORY_MONTHS - 1; back >= 0; back--) {
  const start = new Date(now.getFullYear(), now.getMonth() - back, 1);
  const year = start.getFullYear(), month = start.getMonth();
  const days = new Date(year, month + 1, 0).getDate();
  const rand = mulberry32(monthSeed(year, month));
  const on = (day) => iso(new Date(year, month, Math.min(day, days)));
  push({ type: 'income', amountFils: cents(5400), category: 'salary', accountId: BANK, title: 'Salary', date: on(1), source: 'manual' });
  push({ type: 'expense', amountFils: cents(1850), category: 'rent', accountId: BANK, title: 'Apartment Rent', date: on(1), source: 'manual' });
  push({ type: 'expense', amountFils: cents(200), category: 'other', accountId: BANK, title: 'ATM Withdrawal', date: on(2), isTransfer: true, source: 'manual' });
  push({ type: 'income', amountFils: cents(200), category: 'other', accountId: CASH, title: 'ATM Withdrawal', date: on(2), isTransfer: true, source: 'manual' });
  if (rand() < 0.5) push({ type: 'income', amountFils: Math.round((300 + rand() * 900) / 10) * 1000, category: 'business', accountId: BANK, title: 'Freelance Project', date: on(8 + Math.floor(rand() * 13)), source: 'manual' });
  for (const r of RECURRING) {
    if (r.stoppedMonthsBack !== undefined && back < r.stoppedMonthsBack) continue;
    const price = r.raised !== undefined && back <= r.raisedMonthsBack ? r.raised : r.usd;
    const bump = r.vary ? ((monthSeed(year, month) >>> 8) % (r.vary * 2 + 1)) - r.vary : 0;
    push({ type: 'expense', amountFils: cents(price + bump), category: r.category, accountId: r.accountId, title: r.title, date: on(r.day), source: 'manual' });
  }
  for (const m of MERCHANTS) {
    const count = Math.round(m.freq * (0.7 + rand() * 0.6));
    for (let i = 0; i < count; i++) {
      push({ type: 'expense', amountFils: cents(m.min + rand() * (m.max - m.min)), category: m.category, accountId: m.accountId, title: m.title, date: on(1 + Math.floor(rand() * days)), source: 'manual' });
    }
  }
  const fx = FOREIGN[back % FOREIGN.length];
  const fxDate = on(4 + Math.floor(rand() * 20));
  push({ type: 'expense', amountFils: Math.round(fx.originalMinor * fx.rate), originalAmountMinor: fx.originalMinor, originalCurrency: fx.currency, fxRate: fx.rate, ...(fx.source === 'reference' ? { fxRateDate: fxDate } : {}), fxSource: fx.source, category: fx.category, accountId: CARD, title: fx.title, date: fxDate, source: 'manual' });
}
for (const w of statements()) {
  if (w.dueISO >= today) continue;
  const total = spentOnCard(txs, w);
  if (total > 0) push({ type: 'income', amountFils: total, category: 'other', accountId: CARD, title: 'Larkspur Rewards Card payment', date: w.paidISO, isTransfer: true, source: 'manual' });
}
txs.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

const cardDues = statements().flatMap((w) => {
  const total = spentOnCard(txs, w);
  if (total <= 0) return [];
  return [{ id: w.id, accountId: CARD, totalDueFils: total, minDueFils: Math.min(total, Math.max(cents(35), Math.round(total * 0.02))), minDueEstimated: true, dueDate: w.dueISO, paidFils: 0, ...(w.dueISO < today ? { settledAt: w.paidISO } : {}) }];
});
const quotedTs = now.getTime() - 5 * 60 * 60 * 1000;
const balance = (id, opening) => txs.reduce((s, t) => (t.accountId === id ? s + (t.type === 'income' ? t.amountFils : -t.amountFils) : s), opening);
const accounts = ACCOUNTS.map((a) => (a.id === BANK
  ? { ...a, snapshotFils: balance(BANK, a.openingFils), snapshotKind: 'balance', snapshotTs: quotedTs }
  : a.id === CARD ? { ...a, snapshotFils: Math.max(0, -balance(CARD, a.openingFils)), snapshotKind: 'outstanding', snapshotTs: quotedTs } : a));

const data = {
  ledgerMoney: { schemaVersion: 2, currency: 'USD', exponent: 2 },
  onboardingCurrencyEvidence: 'USD',
  country: 'US',
  accounts,
  transactions: txs,
  budgets: BUDGETS,
  bills: BILLS,
  cardDues,
  goals: [
    { id: 'goal-emergency', title: 'Emergency fund', emoji: 'target', targetFils: cents(12000), savedFils: cents(4800) },
    { id: 'goal-trip', title: 'Summer trip', emoji: 'plane', targetFils: cents(2500), savedFils: cents(900) },
  ],
  onboarded: true,
  userName: 'there',
  themePreference: 'system',
  onlineLogosEnabled: false,
};
process.stdout.write(`${JSON.stringify({ app: 'wafra', version: 1, exportedAt: now.toISOString(), sampleData: true, data }, null, 1)}\n`);
