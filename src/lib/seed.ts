import { toISODate } from '@/lib/format';
import type { Account, Bill, Budget, CardDue, CategoryId, Transaction } from '@/lib/types';

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

/**
 * A seed for one calendar month, not for the whole run.
 *
 * The old generator drew every month from a single stream anchored to launch
 * day, and the number of draws per month depended on how far into the month
 * "today" was. So the same calendar month held different merchants depending
 * on when you opened the app: the demo re-wrote its own history overnight and
 * an e2e suite that asserted on it broke by the calendar. Seeding per month
 * means March 2026 contains the same rows forever, and the current month only
 * ever grows — today's rows are yesterday's rows plus today's.
 */
function monthSeed(year: number, month: number): number {
  let h = (year * 12 + month) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export const SEED_ACCOUNTS: Account[] = [
  { id: 'acc-enbd', name: 'Emirates NBD', kind: 'bank', openingFils: 2_450_000, color: '#2DD4A8', last4: '9012', bankName: 'Emirates NBD' },
  { id: 'acc-card', name: 'FAB Credit Card', kind: 'card', openingFils: 0, color: '#60A5FA', last4: '4821', cardType: 'credit', bankName: 'FAB' },
  { id: 'acc-cash', name: 'Cash', kind: 'cash', openingFils: 120_000, color: '#E9B949' },
];

const BANK = 'acc-enbd';
const CARD = 'acc-card';
const CASH = 'acc-cash';

/**
 * Set against what the demo actually spends, not plucked from the air. The
 * old limits sat below the generated median in three categories, so a fresh
 * install opened on three red budget alerts — the app shouting at a ledger it
 * had invented itself. These leave headroom everywhere except dining, which
 * runs close on purpose: a budget page where nothing is ever tight has nothing
 * to say either.
 */
export const SEED_BUDGETS: Budget[] = [
  { category: 'groceries', limitFils: 220_000 },
  { category: 'dining', limitFils: 120_000 },
  { category: 'transport', limitFils: 90_000 },
  { category: 'shopping', limitFils: 180_000 },
  { category: 'entertainment', limitFils: 40_000 },
];

/**
 * Reminders for the three bills that arrive by post, not by card. Their
 * `dueDay` is deliberately two days AFTER the matching charge in RECURRING
 * below, so bills.ts auto-reconciles them the moment the debit lands and the
 * demo can never open on a red "6 days late" row — an overdue bill on a fresh
 * install reads as a bug in the app, not as a fact about the user.
 */
export const SEED_BILLS: Bill[] = [
  { id: 'bill-etisalat', title: 'Etisalat Postpaid', category: 'telecom', amountFils: 19_900, dueDay: 5, paidMonths: [] },
  { id: 'bill-du', title: 'du Home Internet', category: 'telecom', amountFils: 38_900, dueDay: 10, paidMonths: [] },
  { id: 'bill-dewa', title: 'DEWA Bill', category: 'utilities', amountFils: 45_000, dueDay: 25, paidMonths: [] },
];

/** Months of history the demo carries, including the current partial one. */
export const SEED_HISTORY_MONTHS = 6;

interface MerchantDef {
  title: string;
  category: CategoryId;
  minAED: number;
  maxAED: number;
  accountId: string;
  /** Average occurrences per month. */
  freq: number;
}

/** Everyday, irregular spending. Amounts and dates vary; nothing here recurs. */
const MERCHANTS: MerchantDef[] = [
  { title: 'Carrefour', category: 'groceries', minAED: 90, maxAED: 420, accountId: CARD, freq: 4 },
  { title: 'Lulu Hypermarket', category: 'groceries', minAED: 60, maxAED: 300, accountId: CARD, freq: 2 },
  { title: 'Spinneys', category: 'groceries', minAED: 45, maxAED: 180, accountId: CARD, freq: 2 },
  { title: 'Talabat', category: 'dining', minAED: 35, maxAED: 140, accountId: CARD, freq: 5 },
  { title: 'Deliveroo', category: 'dining', minAED: 40, maxAED: 120, accountId: CARD, freq: 2 },
  { title: 'Arabian Tea House', category: 'dining', minAED: 60, maxAED: 220, accountId: CARD, freq: 1 },
  { title: 'Careem', category: 'transport', minAED: 18, maxAED: 75, accountId: CARD, freq: 6 },
  { title: 'RTA Nol Top-up', category: 'transport', minAED: 50, maxAED: 100, accountId: CARD, freq: 1 },
  { title: 'ENOC Fuel', category: 'transport', minAED: 90, maxAED: 180, accountId: CARD, freq: 2 },
  { title: 'Amazon.ae', category: 'shopping', minAED: 55, maxAED: 480, accountId: CARD, freq: 2 },
  { title: 'Noon.com', category: 'shopping', minAED: 40, maxAED: 350, accountId: CARD, freq: 2 },
  { title: 'Dubai Mall', category: 'shopping', minAED: 120, maxAED: 800, accountId: CARD, freq: 1 },
  { title: 'VOX Cinemas', category: 'entertainment', minAED: 90, maxAED: 220, accountId: CARD, freq: 1 },
  { title: 'Aster Pharmacy', category: 'health', minAED: 30, maxAED: 160, accountId: CASH, freq: 1 },
  { title: 'Coffee — Local Cafe', category: 'dining', minAED: 18, maxAED: 45, accountId: CASH, freq: 6 },
  { title: 'Dubai Cares Donation', category: 'charity', minAED: 50, maxAED: 200, accountId: BANK, freq: 1 },
];

interface RecurringDef {
  title: string;
  category: CategoryId;
  accountId: string;
  /**
   * Day of month it charges. Always ≤ 27: subscriptions.ts reads a gap of
   * 26–35 days as "monthly", and a charge on the 30th silently becomes the
   * 28th in February, producing a 26/33 pair that used to read as noise.
   */
  day: number;
  aed: number;
  /**
   * Price after the rise, applied from `raisedMonthsBack` months ago onward.
   * Relative to today, not to the calendar: the demo is a rolling window, and
   * a rise pinned to a fixed month would scroll out the back of it and leave
   * later launches with nothing to notice.
   */
  raisedAED?: number;
  raisedMonthsBack?: number;
  /** Bill-like: swings up to this much either side of `aed`, fixed per month. */
  varyAED?: number;
  /** Cancelled — no charges from this many months back onward. */
  stoppedMonthsBack?: number;
}

/**
 * The spine of the demo. Every row here charges on a FIXED day at a FIXED
 * price, because that is the only thing subscriptions.ts can detect: it wants
 * a per-merchant gap inside 26–35 days and amounts within ±15% of each other.
 * These merchants used to sit in MERCHANTS above with random dates and random
 * amounts, which is why a fresh install opened on "SUBS 0 · CARDS 0" — the
 * data never recurred, so nothing recurring could be found in it.
 */
const RECURRING: RecurringDef[] = [
  // — cancellable services (Bills → Subscriptions) —
  // The one thing worth noticing on day one: Standard → Premium, +AED 16/mo.
  { title: 'Netflix', category: 'entertainment', accountId: CARD, day: 14, aed: 39, raisedAED: 56, raisedMonthsBack: 2 },
  { title: 'Spotify Premium', category: 'entertainment', accountId: CARD, day: 7, aed: 21.99 },
  { title: 'YouTube Premium', category: 'entertainment', accountId: CARD, day: 27, aed: 23.99 },
  { title: 'Amazon Prime', category: 'shopping', accountId: CARD, day: 21, aed: 16 },
  { title: 'Fitness First', category: 'health', accountId: BANK, day: 2, aed: 350 },
  // Stopped three months in — proof the app notices when you cancel something.
  { title: 'OSN+', category: 'entertainment', accountId: CARD, day: 19, aed: 35, stoppedMonthsBack: 4 },

  // — fixed commitments (Bills → Utilities) —
  { title: 'Etisalat Postpaid', category: 'telecom', accountId: BANK, day: 3, aed: 199 },
  { title: 'du Home Internet', category: 'telecom', accountId: BANK, day: 8, aed: 389 },
  // DEWA genuinely moves month to month, but the swing is held under ±10% so a
  // hot summer never trips the "price up" badge — that badge is reserved for
  // the one real price rise in the demo, and two of them is one too many.
  { title: 'DEWA Bill', category: 'utilities', accountId: BANK, day: 23, aed: 452, varyAED: 20 },
  { title: 'Salik Auto Recharge', category: 'transport', accountId: BANK, day: 12, aed: 100 },
];

/** Fixed-per-month swing for the bills that genuinely move month to month. */
function monthlyBump(year: number, month: number, spread: number): number {
  return ((monthSeed(year, month) >>> 8) % (spread * 2 + 1)) - spread;
}

function shiftISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/**
 * The demo card's statement rhythm, anchored to `now` rather than to the
 * calendar. A calendar-anchored cycle leaves a ten-day hole every month where
 * the last statement is already past its due date and the next has not closed
 * — on those days the Cards tab is empty, and on the days just after, it opens
 * on an overdue balance. Anchoring means the guarantee holds on every date:
 * one open statement, always due comfortably in the future, and closed ones
 * that were paid on time.
 */
const STATEMENT_CYCLE_DAYS = 30;
const OPEN_STATEMENT_CLOSED_DAYS_AGO = 12;
const DAYS_TO_PAY = 21;
/**
 * Enough cycles to reach the back of the history, so EVERY older statement
 * gets paid. Covering only the recent few left the months before them settled
 * by nobody, and the card's derived balance sank to −AED 19,000 on a card the
 * demo says is paid on time.
 */
const STATEMENT_HISTORY = Math.ceil((SEED_HISTORY_MONTHS + 1) * 31 / STATEMENT_CYCLE_DAYS);

interface StatementWindow {
  id: string;
  /** First and last day of spending on the statement, inclusive. */
  fromISO: string;
  toISO: string;
  dueISO: string;
  paidISO: string;
}

/** Statement windows for the demo card, oldest first. */
function seedStatements(now: Date): StatementWindow[] {
  const todayISO = toISODate(now);
  const out: StatementWindow[] = [];
  for (let back = STATEMENT_HISTORY - 1; back >= 0; back--) {
    const closedDaysAgo = OPEN_STATEMENT_CLOSED_DAYS_AGO + back * STATEMENT_CYCLE_DAYS;
    const toISO = shiftISO(todayISO, -closedDaysAgo);
    out.push({
      id: `seed-stmt-${back}`,
      fromISO: shiftISO(toISO, -(STATEMENT_CYCLE_DAYS - 1)),
      toISO,
      dueISO: shiftISO(toISO, DAYS_TO_PAY),
      /** The payment lands three days before the deadline. */
      paidISO: shiftISO(toISO, DAYS_TO_PAY - 3),
    });
  }
  return out;
}

/** What was charged to the demo card inside one statement window. */
function statementTotalFils(transactions: Transaction[], w: StatementWindow): number {
  let total = 0;
  for (const t of transactions) {
    if (t.accountId !== CARD || t.type !== 'expense' || t.isTransfer) continue;
    if (t.date < w.fromISO || t.date > w.toISO) continue;
    total += t.amountFils;
  }
  return total;
}

/** FAB's minimum: 5% of the balance, floor AED 100. */
function minimumDueFils(totalFils: number): number {
  return Math.min(totalFils, Math.max(10_000, Math.round(totalFils * 0.05)));
}

/**
 * Generates SEED_HISTORY_MONTHS of realistic UAE history ending today:
 * salary and rent, a recurring spine (see RECURRING), everyday spending, and
 * the card payments that settle every statement whose due date has passed.
 */
export function generateSeedTransactions(now: Date): Transaction[] {
  const todayISO = toISODate(now);
  const txs: Transaction[] = [];
  let n = 0;
  // Anything dated after today is generated but never emitted, so the current
  // month is always a prefix of the finished month rather than a reshuffle.
  const push = (t: Omit<Transaction, 'id'>) => {
    if (t.date > todayISO) return;
    txs.push({ id: `seed-${n++}`, ...t });
  };

  for (let back = SEED_HISTORY_MONTHS - 1; back >= 0; back--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - back, 1);
    const year = monthStart.getFullYear();
    const month = monthStart.getMonth();
    const daysTotal = new Date(year, month + 1, 0).getDate();
    const rand = mulberry32(monthSeed(year, month));
    const dateOn = (day: number) => toISODate(new Date(year, month, Math.min(day, daysTotal)));

    push({
      type: 'income',
      amountFils: 1_850_000,
      category: 'salary',
      accountId: BANK,
      title: 'Salary',
      date: dateOn(1),
    });
    push({
      type: 'expense',
      amountFils: 550_000,
      category: 'rent',
      accountId: BANK,
      title: 'Apartment Rent',
      date: dateOn(1),
    });
    // Cash has to come from somewhere. Without this the Wallet's cash line
    // drifts negative by the third month — a balance the demo invented for
    // itself, and the one figure on that screen a user would read as a bug.
    for (const [accountId, type] of [[BANK, 'expense'], [CASH, 'income']] as const) {
      push({
        type,
        amountFils: 50_000,
        category: 'other',
        accountId,
        title: 'ATM Withdrawal',
        date: dateOn(2),
        isTransfer: true,
      });
    }

    if (rand() < 0.5) {
      push({
        type: 'income',
        amountFils: Math.round((800 + rand() * 2200) / 10) * 1000,
        category: 'business',
        accountId: BANK,
        title: 'Freelance Project',
        date: dateOn(8 + Math.floor(rand() * 13)),
      });
    }

    for (const r of RECURRING) {
      if (r.stoppedMonthsBack !== undefined && back < r.stoppedMonthsBack) continue;
      const priced =
        r.raisedAED !== undefined && back <= (r.raisedMonthsBack ?? 0) ? r.raisedAED : r.aed;
      const aed = priced + (r.varyAED ? monthlyBump(year, month, r.varyAED) : 0);
      push({
        type: 'expense',
        amountFils: Math.round(aed * 100),
        category: r.category,
        accountId: r.accountId,
        title: r.title,
        date: dateOn(r.day),
      });
    }

    for (const m of MERCHANTS) {
      const count = Math.round(m.freq * (0.7 + rand() * 0.6));
      for (let i = 0; i < count; i++) {
        const aed = m.minAED + rand() * (m.maxAED - m.minAED);
        push({
          type: 'expense',
          amountFils: Math.round(aed * 100),
          category: m.category,
          accountId: m.accountId,
          title: m.title,
          date: dateOn(1 + Math.floor(rand() * daysTotal)),
        });
      }
    }
  }

  // Statements whose due date has passed were paid, three days early. The open
  // one is left alone — that is the card due the Bills tab is meant to show.
  for (const w of seedStatements(now)) {
    if (w.dueISO >= todayISO) continue;
    const total = statementTotalFils(txs, w);
    if (total <= 0) continue;
    push({
      type: 'income',
      amountFils: total,
      category: 'other',
      accountId: CARD,
      title: 'FAB Credit Card payment',
      date: w.paidISO,
      isTransfer: true,
    });
  }

  txs.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return txs;
}

/**
 * Statement obligations for the demo card, derived from the same windows the
 * payments above were written against. Settled ones are kept so the card's
 * detail sheet has a payment history; openDues() filters them out.
 */
export function generateSeedCardDues(now: Date, transactions: Transaction[]): CardDue[] {
  const todayISO = toISODate(now);
  const dues: CardDue[] = [];
  for (const w of seedStatements(now)) {
    const total = statementTotalFils(transactions, w);
    if (total <= 0) continue;
    dues.push({
      id: w.id,
      accountId: CARD,
      totalDueFils: total,
      minDueFils: minimumDueFils(total),
      dueDate: w.dueISO,
      // Left at zero even on settled statements: cards.ts pours the recorded
      // payments across the statements itself, and pre-filling paidFils makes
      // a statement look already covered, so its own payment spills forward
      // and settles the OPEN one — the demo's single card due, gone.
      paidFils: 0,
      ...(w.dueISO < todayISO ? { settledAt: w.paidISO } : {}),
    });
  }
  return dues;
}
