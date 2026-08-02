import { toISODate } from '@/lib/format';
import type { Account, Budget, CategoryId, Transaction } from '@/lib/types';

/** Deterministic PRNG so demo data is stable across launches. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SEED_ACCOUNTS: Account[] = [
  {
    id: 'acc-enbd',
    name: 'Emirates NBD',
    kind: 'bank',
    openingFils: 2_450_000,
    color: '#2DD4A8',
    last4: '9012',
    bankName: 'Emirates NBD',
    // The demo must obey the same truth rule as a real SMS-fed account: its
    // balance is only shown when the bank quoted it. This keeps Wallet alive
    // without inventing a running balance from partial message history.
    snapshotFils: 6_875_000,
    snapshotKind: 'balance',
    snapshotTs: Date.UTC(2026, 6, 31, 18, 42),
  },
  {
    id: 'acc-card',
    name: 'FAB Credit Card',
    kind: 'card',
    openingFils: 0,
    color: '#60A5FA',
    last4: '4821',
    cardType: 'credit',
    bankName: 'FAB',
    snapshotFils: 120_900,
    snapshotKind: 'outstanding',
    snapshotTs: Date.UTC(2026, 6, 31, 20, 8),
    creditLimitFils: 5_000_000,
  },
  { id: 'acc-cash', name: 'Cash', kind: 'cash', openingFils: 850_000, color: '#E9B949' },
];

export const SEED_BUDGETS: Budget[] = [
  { category: 'groceries', limitFils: 180_000 },
  { category: 'dining', limitFils: 120_000 },
  { category: 'transport', limitFils: 80_000 },
  { category: 'shopping', limitFils: 100_000 },
  { category: 'entertainment', limitFils: 60_000 },
];

interface MerchantDef {
  title: string;
  category: CategoryId;
  minAED: number;
  maxAED: number;
  accountId: string;
  /** Average occurrences per month. */
  freq: number;
}

const MERCHANTS: MerchantDef[] = [
  { title: 'Carrefour', category: 'groceries', minAED: 90, maxAED: 420, accountId: 'acc-card', freq: 4 },
  { title: 'Lulu Hypermarket', category: 'groceries', minAED: 60, maxAED: 300, accountId: 'acc-card', freq: 2 },
  { title: 'Spinneys', category: 'groceries', minAED: 45, maxAED: 180, accountId: 'acc-card', freq: 2 },
  { title: 'Talabat', category: 'dining', minAED: 35, maxAED: 140, accountId: 'acc-card', freq: 5 },
  { title: 'Deliveroo', category: 'dining', minAED: 40, maxAED: 120, accountId: 'acc-card', freq: 2 },
  { title: 'Arabian Tea House', category: 'dining', minAED: 60, maxAED: 220, accountId: 'acc-card', freq: 1 },
  { title: 'Careem', category: 'transport', minAED: 18, maxAED: 75, accountId: 'acc-card', freq: 6 },
  { title: 'RTA Nol Top-up', category: 'transport', minAED: 50, maxAED: 100, accountId: 'acc-card', freq: 1 },
  { title: 'Salik Recharge', category: 'transport', minAED: 50, maxAED: 100, accountId: 'acc-enbd', freq: 1 },
  { title: 'ENOC Fuel', category: 'transport', minAED: 90, maxAED: 180, accountId: 'acc-card', freq: 2 },
  { title: 'DEWA Bill', category: 'utilities', minAED: 380, maxAED: 620, accountId: 'acc-enbd', freq: 1 },
  { title: 'Etisalat Postpaid', category: 'telecom', minAED: 199, maxAED: 199, accountId: 'acc-enbd', freq: 1 },
  { title: 'du Home Internet', category: 'telecom', minAED: 389, maxAED: 389, accountId: 'acc-enbd', freq: 1 },
  { title: 'Amazon.ae', category: 'shopping', minAED: 55, maxAED: 480, accountId: 'acc-card', freq: 2 },
  { title: 'Noon.com', category: 'shopping', minAED: 40, maxAED: 350, accountId: 'acc-card', freq: 2 },
  { title: 'Dubai Mall', category: 'shopping', minAED: 120, maxAED: 800, accountId: 'acc-card', freq: 1 },
  { title: 'VOX Cinemas', category: 'entertainment', minAED: 90, maxAED: 220, accountId: 'acc-card', freq: 1 },
  { title: 'Fitness First', category: 'health', minAED: 350, maxAED: 350, accountId: 'acc-enbd', freq: 1 },
  { title: 'Aster Pharmacy', category: 'health', minAED: 30, maxAED: 160, accountId: 'acc-cash', freq: 1 },
  { title: 'Coffee — Local Cafe', category: 'dining', minAED: 18, maxAED: 45, accountId: 'acc-cash', freq: 6 },
  { title: 'Dubai Cares Donation', category: 'charity', minAED: 50, maxAED: 200, accountId: 'acc-enbd', freq: 1 },
];

/**
 * Generates ~4 months of realistic history ending today, including monthly
 * salary and rent so analytics and budgets have something to show.
 */
export function generateSeedTransactions(now: Date): Transaction[] {
  const rand = mulberry32(20260718);
  const txs: Transaction[] = [];
  let n = 0;
  const push = (t: Omit<Transaction, 'id'>) => {
    txs.push({ id: `seed-${n++}`, ...t });
  };

  for (let monthsBack = 3; monthsBack >= 0; monthsBack--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
    const daysTotal = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
    const lastDay = monthsBack === 0 ? now.getDate() : daysTotal;

    const dayInMonth = (min: number, max: number) =>
      Math.min(lastDay, min + Math.floor(rand() * (max - min + 1)));
    const dateOn = (day: number) =>
      toISODate(new Date(monthStart.getFullYear(), monthStart.getMonth(), Math.min(day, lastDay)));

    if (lastDay >= 1) {
      push({
        type: 'income',
        amountFils: 1_850_000,
        category: 'salary',
        accountId: 'acc-enbd',
        title: 'Salary',
        date: dateOn(1),
        source: 'sms',
      });
      push({
        type: 'expense',
        amountFils: 550_000,
        category: 'rent',
        accountId: 'acc-enbd',
        title: 'Apartment Rent',
        date: dateOn(1),
        source: 'sms',
      });
    }
    if (rand() < 0.5 && lastDay > 12) {
      push({
        type: 'income',
        amountFils: Math.round((800 + rand() * 2200) / 10) * 1000,
        category: 'business',
        accountId: 'acc-enbd',
        title: 'Freelance Project',
        date: dateOn(dayInMonth(8, 20)),
        source: 'sms',
      });
    }

    // Fixed dates make these genuinely monthly recurring charges rather than
    // four loosely similar purchases. Bills is therefore populated on the
    // very first launch with recognisable, credible UAE subscription data.
    const subscriptions = [
      { title: 'Netflix', amountFils: 5_699, day: 3 },
      { title: 'Spotify', amountFils: 2_199, day: 11 },
      { title: 'iCloud+', amountFils: 1_099, day: 19 },
    ];
    for (const sub of subscriptions) {
      if (lastDay < sub.day) continue;
      push({
        type: 'expense',
        amountFils: sub.amountFils,
        category: 'entertainment',
        accountId: 'acc-card',
        title: sub.title,
        date: dateOn(sub.day),
        source: 'sms',
      });
    }

    for (const m of MERCHANTS) {
      const count = Math.round(m.freq * (0.7 + rand() * 0.6) * (lastDay / daysTotal));
      for (let i = 0; i < count; i++) {
        const aed = m.minAED + rand() * (m.maxAED - m.minAED);
        push({
          type: 'expense',
          amountFils: Math.round(aed * 100),
          category: m.category,
          accountId: m.accountId,
          title: m.title,
          date: dateOn(1 + Math.floor(rand() * daysTotal)),
          source: m.accountId === 'acc-cash' ? 'manual' : 'sms',
        });
      }
    }

    // Bank alerts preserve both the original currency and the AED amount that
    // settles into the ledger. Keep a few deterministic travel/online charges
    // in every demo month so the currency surface is useful on first launch,
    // rather than an immaculate empty state that hides the feature entirely.
    const appleDate = dateOn(dayInMonth(4, 9));
    const bookingDate = dateOn(dayInMonth(10, 16));
    const tflDate = dateOn(dayInMonth(18, 24));
    push({
      type: 'expense',
      amountFils: 18_358,
      originalAmountMinor: 4_999,
      originalCurrency: 'USD',
      fxRate: 3.6723,
      fxSource: 'bank',
      category: 'shopping',
      accountId: 'acc-card',
      title: 'Apple Store US',
      date: appleDate,
      source: 'sms',
    });
    push({
      type: 'expense',
      amountFils: 86_535,
      originalAmountMinor: 21_650,
      originalCurrency: 'EUR',
      fxRate: 3.997,
      fxRateDate: bookingDate,
      fxSource: 'reference',
      category: 'travel',
      accountId: 'acc-card',
      title: 'Booking.com',
      date: bookingDate,
      source: 'sms',
    });
    push({
      type: 'expense',
      amountFils: 15_876,
      originalAmountMinor: 3_240,
      originalCurrency: 'GBP',
      fxRate: 4.9,
      fxSource: 'fallback',
      category: 'transport',
      accountId: 'acc-card',
      title: 'TfL Travel Charge',
      date: tflDate,
      source: 'sms',
    });
  }

  txs.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return txs;
}
