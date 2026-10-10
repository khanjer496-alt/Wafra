import { shiftISO, toISODate } from '@/lib/format';
import { isSpending } from '@/lib/ledger';
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

/**
 * The demo's accounts, WITHOUT balance snapshots.
 *
 * A snapshot is a figure the bank quoted at a particular moment, and there is
 * no such moment until the ledger has been generated for a particular launch
 * date — see `generateSeedAccounts`. A hardcoded one would be a number that
 * disagrees with the rows underneath it on every day but one, which is the
 * exact class of defect the balance rules exist to prevent.
 *
 * `creditLimitFils` is different: it is a standing fact about the card, not a
 * moving figure, so it belongs here.
 */
export const SEED_ACCOUNTS: Account[] = [
  { id: 'acc-enbd', name: 'Emirates NBD', kind: 'bank', openingFils: 2_450_000, color: '#2DD4A8', last4: '9012', bankName: 'Emirates NBD' },
  { id: 'acc-card', name: 'FAB Credit Card', kind: 'card', openingFils: 0, color: '#60A5FA', last4: '4821', cardType: 'credit', bankName: 'FAB', creditLimitFils: 5_000_000 },
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
  min: number;
  max: number;
  accountId: string;
  /** Average occurrences per month. */
  freq: number;
}

/** Everyday, irregular spending. Amounts and dates vary; nothing here recurs. */
const MERCHANTS: MerchantDef[] = [
  { title: 'Carrefour', category: 'groceries', min: 90, max: 420, accountId: CARD, freq: 4 },
  { title: 'Lulu Hypermarket', category: 'groceries', min: 60, max: 300, accountId: CARD, freq: 2 },
  { title: 'Spinneys', category: 'groceries', min: 45, max: 180, accountId: CARD, freq: 2 },
  { title: 'Talabat', category: 'dining', min: 35, max: 140, accountId: CARD, freq: 5 },
  { title: 'Deliveroo', category: 'dining', min: 40, max: 120, accountId: CARD, freq: 2 },
  { title: 'Arabian Tea House', category: 'dining', min: 60, max: 220, accountId: CARD, freq: 1 },
  { title: 'Careem', category: 'transport', min: 18, max: 75, accountId: CARD, freq: 6 },
  { title: 'RTA Nol Top-up', category: 'transport', min: 50, max: 100, accountId: CARD, freq: 1 },
  { title: 'ENOC Fuel', category: 'transport', min: 90, max: 180, accountId: CARD, freq: 2 },
  { title: 'Amazon.ae', category: 'shopping', min: 55, max: 480, accountId: CARD, freq: 2 },
  { title: 'Noon.com', category: 'shopping', min: 40, max: 350, accountId: CARD, freq: 2 },
  { title: 'Dubai Mall', category: 'shopping', min: 120, max: 800, accountId: CARD, freq: 1 },
  { title: 'VOX Cinemas', category: 'entertainment', min: 90, max: 220, accountId: CARD, freq: 1 },
  { title: 'Aster Pharmacy', category: 'health', min: 30, max: 160, accountId: CASH, freq: 1 },
  { title: 'Coffee — Local Cafe', category: 'dining', min: 18, max: 45, accountId: CASH, freq: 6 },
  { title: 'Dubai Cares Donation', category: 'charity', min: 50, max: 200, accountId: BANK, freq: 1 },
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
  amount: number;
  /**
   * Price after the rise, applied from `raisedMonthsBack` months ago onward.
   * Relative to today, not to the calendar: the demo is a rolling window, and
   * a rise pinned to a fixed month would scroll out the back of it and leave
   * later launches with nothing to notice.
   */
  raised?: number;
  raisedMonthsBack?: number;
  /** Bill-like: swings up to this much either side of `aed`, fixed per month. */
  vary?: number;
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
  { title: 'Netflix', category: 'entertainment', accountId: CARD, day: 14, amount: 39, raised: 56, raisedMonthsBack: 2 },
  { title: 'Spotify Premium', category: 'entertainment', accountId: CARD, day: 7, amount: 21.99 },
  { title: 'YouTube Premium', category: 'entertainment', accountId: CARD, day: 27, amount: 23.99 },
  { title: 'Amazon Prime', category: 'shopping', accountId: CARD, day: 21, amount: 16 },
  { title: 'Fitness First', category: 'health', accountId: BANK, day: 2, amount: 350 },
  // Stopped three months in — proof the app notices when you cancel something.
  { title: 'OSN+', category: 'entertainment', accountId: CARD, day: 19, amount: 35, stoppedMonthsBack: 4 },

  // — fixed commitments (Bills → Utilities) —
  { title: 'Etisalat Postpaid', category: 'telecom', accountId: BANK, day: 3, amount: 199 },
  { title: 'du Home Internet', category: 'telecom', accountId: BANK, day: 8, amount: 389 },
  // DEWA genuinely moves month to month, but the swing is held under ±10% so a
  // hot summer never trips the "price up" badge — that badge is reserved for
  // the one real price rise in the demo, and two of them is one too many.
  { title: 'DEWA Bill', category: 'utilities', accountId: BANK, day: 23, amount: 452, vary: 20 },
  { title: 'Salik Auto Recharge', category: 'transport', accountId: BANK, day: 12, amount: 100 },
];

/**
 * Foreign-currency charges, ONE PER DEMO MONTH, rotating.
 *
 * The currency surface is a real feature and an immaculate empty state hides
 * it, so the demo has to contain some. But three of these landing every month
 * at a fixed amount is a subscription by every test subscriptions.ts applies —
 * that is exactly how the previous demo manufactured "Apple Store US, AED
 * 183.58/mo, cancellable" and filed Booking.com and TfL as fixed commitments,
 * three false positives on a screen whose whole job is spotting real ones.
 *
 * Rotating one per month puts ~60 days between repeats of the same merchant,
 * outside every cadence window (weekly 6-8, monthly 26-35, yearly 350-380),
 * and the day is drawn from the month's own stream rather than fixed. Each one
 * also carries a different `fxSource`, which is the provenance the currency
 * screen exists to show: what the bank itself converted, what a reference rate
 * supplied, and what fell back to a stored rate.
 */
interface ForeignDef {
  title: string;
  category: CategoryId;
  currency: string;
  /** Minor units in the original currency, e.g. cents. */
  originalMinor: number;
  rate: number;
  source: 'bank' | 'reference' | 'fallback';
}

const FOREIGN: ForeignDef[] = [
  { title: 'Apple Store US', category: 'shopping', currency: 'USD', originalMinor: 4_999, rate: 3.6723, source: 'bank' },
  { title: 'Booking.com', category: 'travel', currency: 'EUR', originalMinor: 21_650, rate: 3.997, source: 'reference' },
  { title: 'TfL Travel Charge', category: 'transport', currency: 'GBP', originalMinor: 3_240, rate: 4.9, source: 'fallback' },
];

/**
 * Which market the demo ledger is drawn for. `ae` is the default and the
 * ledger every e2e suite and unit test reads; `sa` and `global` exist so store
 * art can show local banks, merchants and currency instead of a UAE ledger in
 * a foreign storefront (scripts/render-appstore-promo.mjs).
 *
 * `global` rows are all entered by hand. Automatic bank-alert posting is only
 * launch-tested for AE/SA, so a global demo that read "bank message · Chase"
 * would claim coverage the app does not have.
 */
export type DemoMarket = 'ae' | 'sa' | 'global';

interface DemoProfile {
  currency: string;
  accounts: Account[];
  budgets: Budget[];
  bills: Bill[];
  merchants: MerchantDef[];
  recurring: RecurringDef[];
  foreign: ForeignDef[];
  /** Monthly salary, rent and ATM cash, in ledger minor units. */
  salaryFils: number;
  rentFils: number;
  atmFils: number;
  /** Occasional freelance income: min + up to `spread`, in major units. */
  freelance: { min: number; spread: number };
  cardPaymentTitle: string;
  /** The card's minimum-due floor, in ledger minor units. */
  minDueFloorFils: number;
  goal: { targetFils: number; savedFils: number };
  /** How bank and card rows arrived. Cash is always entered by hand. */
  rowSource: 'sms' | 'manual';
}

const SA_PROFILE: DemoProfile = {
  currency: 'SAR',
  accounts: [
    { id: BANK, name: 'Al Rajhi Bank', kind: 'bank', openingFils: 2_300_000, color: '#2A3C8F', last4: '9012', bankName: 'Al Rajhi' },
    { id: CARD, name: 'SNB Credit Card', kind: 'card', openingFils: 0, color: '#00A651', last4: '4821', cardType: 'credit', bankName: 'SNB AlAhli', creditLimitFils: 5_000_000 },
    { id: CASH, name: 'Cash', kind: 'cash', openingFils: 120_000, color: '#E9B949' },
  ],
  budgets: SEED_BUDGETS,
  bills: [
    { id: 'bill-stc', title: 'STC Postpaid', category: 'telecom', amountFils: 23_000, dueDay: 5, paidMonths: [] },
    { id: 'bill-mobily', title: 'Mobily Fiber', category: 'telecom', amountFils: 34_500, dueDay: 10, paidMonths: [] },
    { id: 'bill-sec', title: 'Saudi Electricity', category: 'utilities', amountFils: 42_000, dueDay: 25, paidMonths: [] },
  ],
  merchants: [
    { title: 'Panda', category: 'groceries', min: 90, max: 420, accountId: CARD, freq: 4 },
    { title: 'Tamimi Markets', category: 'groceries', min: 60, max: 300, accountId: CARD, freq: 2 },
    { title: 'Danube', category: 'groceries', min: 45, max: 180, accountId: CARD, freq: 2 },
    { title: 'HungerStation', category: 'dining', min: 35, max: 140, accountId: CARD, freq: 5 },
    { title: 'Jahez', category: 'dining', min: 40, max: 120, accountId: CARD, freq: 2 },
    { title: 'Al Baik', category: 'dining', min: 30, max: 110, accountId: CARD, freq: 1 },
    { title: 'Careem', category: 'transport', min: 18, max: 75, accountId: CARD, freq: 6 },
    { title: 'Aldrees Fuel', category: 'transport', min: 90, max: 180, accountId: CARD, freq: 2 },
    { title: 'Amazon.sa', category: 'shopping', min: 55, max: 480, accountId: CARD, freq: 2 },
    { title: 'Noon.com', category: 'shopping', min: 40, max: 350, accountId: CARD, freq: 2 },
    { title: 'Jarir Bookstore', category: 'shopping', min: 120, max: 800, accountId: CARD, freq: 1 },
    { title: 'VOX Cinemas', category: 'entertainment', min: 90, max: 220, accountId: CARD, freq: 1 },
    { title: 'Nahdi Pharmacy', category: 'health', min: 30, max: 160, accountId: CASH, freq: 1 },
    { title: 'Coffee — Local Cafe', category: 'dining', min: 18, max: 45, accountId: CASH, freq: 6 },
    { title: 'Ehsan Donation', category: 'charity', min: 50, max: 200, accountId: BANK, freq: 1 },
  ],
  recurring: [
    { title: 'Netflix', category: 'entertainment', accountId: CARD, day: 14, amount: 45, raised: 59, raisedMonthsBack: 2 },
    { title: 'Spotify Premium', category: 'entertainment', accountId: CARD, day: 7, amount: 21.99 },
    { title: 'YouTube Premium', category: 'entertainment', accountId: CARD, day: 27, amount: 26.99 },
    { title: 'Amazon Prime', category: 'shopping', accountId: CARD, day: 21, amount: 16 },
    { title: 'Fitness Time', category: 'health', accountId: BANK, day: 2, amount: 320 },
    { title: 'Shahid VIP', category: 'entertainment', accountId: CARD, day: 19, amount: 29.99, stoppedMonthsBack: 4 },
    { title: 'STC Postpaid', category: 'telecom', accountId: BANK, day: 3, amount: 230 },
    { title: 'Mobily Fiber', category: 'telecom', accountId: BANK, day: 8, amount: 345 },
    { title: 'Saudi Electricity', category: 'utilities', accountId: BANK, day: 23, amount: 420, vary: 20 },
  ],
  foreign: [
    { title: 'Apple Store US', category: 'shopping', currency: 'USD', originalMinor: 4_999, rate: 3.75, source: 'bank' },
    { title: 'Booking.com', category: 'travel', currency: 'EUR', originalMinor: 21_650, rate: 4.08, source: 'reference' },
    { title: 'TfL Travel Charge', category: 'transport', currency: 'GBP', originalMinor: 3_240, rate: 4.75, source: 'fallback' },
  ],
  salaryFils: 1_900_000,
  rentFils: 450_000,
  atmFils: 50_000,
  freelance: { min: 800, spread: 2200 },
  cardPaymentTitle: 'SNB Credit Card payment',
  minDueFloorFils: 10_000,
  goal: { targetFils: 6_000_000, savedFils: 2_400_000 },
  rowSource: 'sms',
};

const GLOBAL_PROFILE: DemoProfile = {
  currency: 'USD',
  accounts: [
    { id: BANK, name: 'Everyday Checking', kind: 'bank', openingFils: 850_000, color: '#2DD4A8', last4: '9012' },
    { id: CARD, name: 'Visa Credit Card', kind: 'card', openingFils: 0, color: '#60A5FA', last4: '4821', cardType: 'credit', creditLimitFils: 800_000 },
    { id: CASH, name: 'Cash', kind: 'cash', openingFils: 30_000, color: '#E9B949' },
  ],
  budgets: [
    { category: 'groceries', limitFils: 100_000 },
    { category: 'dining', limitFils: 45_000 },
    { category: 'transport', limitFils: 40_000 },
    { category: 'shopping', limitFils: 70_000 },
    { category: 'entertainment', limitFils: 12_000 },
  ],
  bills: [
    { id: 'bill-phone', title: 'Verizon Wireless', category: 'telecom', amountFils: 8_500, dueDay: 5, paidMonths: [] },
    { id: 'bill-internet', title: 'Xfinity Internet', category: 'telecom', amountFils: 7_000, dueDay: 10, paidMonths: [] },
    { id: 'bill-electric', title: 'Electric Bill', category: 'utilities', amountFils: 12_000, dueDay: 25, paidMonths: [] },
  ],
  merchants: [
    { title: 'Whole Foods Market', category: 'groceries', min: 40, max: 180, accountId: CARD, freq: 4 },
    { title: "Trader Joe's", category: 'groceries', min: 30, max: 120, accountId: CARD, freq: 2 },
    { title: 'Costco', category: 'groceries', min: 80, max: 260, accountId: CARD, freq: 1 },
    { title: 'DoorDash', category: 'dining', min: 20, max: 60, accountId: CARD, freq: 5 },
    { title: 'Chipotle', category: 'dining', min: 12, max: 30, accountId: CARD, freq: 2 },
    { title: 'Local Bistro', category: 'dining', min: 40, max: 110, accountId: CARD, freq: 1 },
    { title: 'Uber', category: 'transport', min: 12, max: 40, accountId: CARD, freq: 6 },
    { title: 'Shell', category: 'transport', min: 35, max: 65, accountId: CARD, freq: 2 },
    { title: 'Amazon', category: 'shopping', min: 20, max: 160, accountId: CARD, freq: 2 },
    { title: 'Target', category: 'shopping', min: 25, max: 140, accountId: CARD, freq: 2 },
    { title: 'IKEA', category: 'shopping', min: 60, max: 300, accountId: CARD, freq: 1 },
    { title: 'AMC Theatres', category: 'entertainment', min: 25, max: 60, accountId: CARD, freq: 1 },
    { title: 'CVS Pharmacy', category: 'health', min: 10, max: 60, accountId: CASH, freq: 1 },
    { title: 'Coffee — Local Cafe', category: 'dining', min: 4, max: 9, accountId: CASH, freq: 6 },
    { title: 'Red Cross Donation', category: 'charity', min: 25, max: 100, accountId: BANK, freq: 1 },
  ],
  recurring: [
    { title: 'Netflix', category: 'entertainment', accountId: CARD, day: 14, amount: 15.49, raised: 17.99, raisedMonthsBack: 2 },
    { title: 'Spotify Premium', category: 'entertainment', accountId: CARD, day: 7, amount: 11.99 },
    { title: 'YouTube Premium', category: 'entertainment', accountId: CARD, day: 27, amount: 13.99 },
    { title: 'Amazon Prime', category: 'shopping', accountId: CARD, day: 21, amount: 14.99 },
    { title: 'Planet Fitness', category: 'health', accountId: BANK, day: 2, amount: 24.99 },
    { title: 'Disney+', category: 'entertainment', accountId: CARD, day: 19, amount: 13.99, stoppedMonthsBack: 4 },
    { title: 'Verizon Wireless', category: 'telecom', accountId: BANK, day: 3, amount: 85 },
    { title: 'Xfinity Internet', category: 'telecom', accountId: BANK, day: 8, amount: 70 },
    { title: 'Electric Bill', category: 'utilities', accountId: BANK, day: 23, amount: 118, vary: 6 },
    { title: 'Transit Pass', category: 'transport', accountId: BANK, day: 12, amount: 90 },
  ],
  // Entered by hand with the original amount, so every rate is a reference or
  // stored fallback rate. A `bank` rate would claim a parsed bank alert.
  foreign: [
    { title: 'Booking.com', category: 'travel', currency: 'EUR', originalMinor: 21_650, rate: 1.09, source: 'reference' },
    { title: 'TfL Travel Charge', category: 'transport', currency: 'GBP', originalMinor: 3_240, rate: 1.29, source: 'fallback' },
    { title: 'Tim Hortons', category: 'dining', currency: 'CAD', originalMinor: 1_475, rate: 0.73, source: 'reference' },
  ],
  salaryFils: 520_000,
  rentFils: 165_000,
  atmFils: 20_000,
  freelance: { min: 300, spread: 900 },
  cardPaymentTitle: 'Visa Credit Card payment',
  minDueFloorFils: 2_500,
  goal: { targetFils: 1_500_000, savedFils: 600_000 },
  rowSource: 'manual',
};

/** The default UAE ledger, built from the constants above. */
const AE_PROFILE: DemoProfile = {
  currency: 'AED',
  accounts: SEED_ACCOUNTS,
  budgets: SEED_BUDGETS,
  bills: SEED_BILLS,
  merchants: MERCHANTS,
  recurring: RECURRING,
  foreign: FOREIGN,
  salaryFils: 1_850_000,
  rentFils: 550_000,
  atmFils: 50_000,
  freelance: { min: 800, spread: 2200 },
  cardPaymentTitle: 'FAB Credit Card payment',
  minDueFloorFils: 10_000,
  // Six months of the demo's own outgoings, roughly 40% of the way there —
  // an AED 20,000 target next to a AED 93,000 bank balance read as a goal
  // already met and left on the screen by mistake.
  goal: { targetFils: 6_000_000, savedFils: 2_400_000 },
  rowSource: 'sms',
};

const PROFILES: Record<DemoMarket, DemoProfile> = { ae: AE_PROFILE, sa: SA_PROFILE, global: GLOBAL_PROFILE };

/** The static parts of a market's demo ledger. Unknown values read as `ae`. */
export function demoProfile(market: string = 'ae'): Readonly<DemoProfile> {
  return PROFILES[market as DemoMarket] ?? AE_PROFILE;
}

/** Fixed-per-month swing for the bills that genuinely move month to month. */
function monthlyBump(year: number, month: number, spread: number): number {
  return ((monthSeed(year, month) >>> 8) % (spread * 2 + 1)) - spread;
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

/**
 * What was charged to the demo card inside one statement window.
 *
 * Through `isSpending` rather than a hand-written `expense && !isTransfer`:
 * that is the shared definition, and a statement total that disagreed with it
 * would put the demo's card due at odds with every screen that adds the same
 * rows up. It is also the shape `contracts.test.js` refuses.
 */
function statementTotalFils(transactions: Transaction[], w: StatementWindow): number {
  let total = 0;
  for (const t of transactions) {
    if (t.accountId !== CARD || !isSpending(t)) continue;
    if (t.date < w.fromISO || t.date > w.toISO) continue;
    total += t.amountFils;
  }
  return total;
}

/** A typical card minimum: 5% of the balance, with a market floor (FAB: AED 100). */
function minimumDueFils(totalFils: number, floorFils: number): number {
  return Math.min(totalFils, Math.max(floorFils, Math.round(totalFils * 0.05)));
}

/**
 * Generates SEED_HISTORY_MONTHS of realistic history for one market ending today:
 * salary and rent, a recurring spine (see RECURRING), everyday spending, and
 * the card payments that settle every statement whose due date has passed.
 */
export function generateSeedTransactions(now: Date, market: DemoMarket = 'ae'): Transaction[] {
  const p = demoProfile(market);
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
      amountFils: p.salaryFils,
      category: 'salary',
      accountId: BANK,
      title: 'Salary',
      date: dateOn(1),
      source: p.rowSource,
    });
    push({
      type: 'expense',
      amountFils: p.rentFils,
      category: 'rent',
      accountId: BANK,
      title: 'Apartment Rent',
      date: dateOn(1),
      source: p.rowSource,
    });
    // Cash has to come from somewhere. Without this the Wallet's cash line
    // drifts negative by the third month — a balance the demo invented for
    // itself, and the one figure on that screen a user would read as a bug.
    for (const [accountId, type] of [[BANK, 'expense'], [CASH, 'income']] as const) {
      push({
        type,
        amountFils: p.atmFils,
        category: 'other',
        accountId,
        title: 'ATM Withdrawal',
        date: dateOn(2),
        isTransfer: true,
        // The bank side arrives by SMS; the cash side is the user counting
        // notes into their own pocket. That difference is what lets
        // reliableBalanceFils show a cash balance and refuse a bank one.
        source: accountId === CASH ? 'manual' : p.rowSource,
      });
    }

    if (rand() < 0.5) {
      push({
        type: 'income',
        amountFils: Math.round((p.freelance.min + rand() * p.freelance.spread) / 10) * 1000,
        category: 'business',
        accountId: BANK,
        title: 'Freelance Project',
        date: dateOn(8 + Math.floor(rand() * 13)),
        source: p.rowSource,
      });
    }

    for (const r of p.recurring) {
      if (r.stoppedMonthsBack !== undefined && back < r.stoppedMonthsBack) continue;
      const priced =
        r.raised !== undefined && back <= (r.raisedMonthsBack ?? 0) ? r.raised : r.amount;
      const amount = priced + (r.vary ? monthlyBump(year, month, r.vary) : 0);
      push({
        type: 'expense',
        amountFils: Math.round(amount * 100),
        category: r.category,
        accountId: r.accountId,
        title: r.title,
        date: dateOn(r.day),
        source: r.accountId === CASH ? 'manual' : p.rowSource,
      });
    }

    for (const m of p.merchants) {
      const count = Math.round(m.freq * (0.7 + rand() * 0.6));
      for (let i = 0; i < count; i++) {
        const amount = m.min + rand() * (m.max - m.min);
        push({
          type: 'expense',
          amountFils: Math.round(amount * 100),
          category: m.category,
          accountId: m.accountId,
          title: m.title,
          date: dateOn(1 + Math.floor(rand() * daysTotal)),
          source: m.accountId === CASH ? 'manual' : p.rowSource,
        });
      }
    }

    // One foreign charge this month. `back` rather than a random pick so the
    // rotation is stable: a given calendar month always gets the same
    // merchant, and the same merchant never lands in consecutive months.
    const fx = p.foreign[(back + p.foreign.length) % p.foreign.length];
    const fxDate = dateOn(4 + Math.floor(rand() * 20));
    push({
      type: 'expense',
      amountFils: Math.round(fx.originalMinor * fx.rate),
      originalAmountMinor: fx.originalMinor,
      originalCurrency: fx.currency,
      fxRate: fx.rate,
      ...(fx.source === 'reference' ? { fxRateDate: fxDate } : {}),
      fxSource: fx.source,
      category: fx.category,
      accountId: CARD,
      title: fx.title,
      date: fxDate,
      source: p.rowSource,
    });
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
      title: p.cardPaymentTitle,
      date: w.paidISO,
      isTransfer: true,
      source: p.rowSource,
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
export function generateSeedCardDues(
  now: Date,
  transactions: Transaction[],
  market: DemoMarket = 'ae',
): CardDue[] {
  const floorFils = demoProfile(market).minDueFloorFils;
  const todayISO = toISODate(now);
  const dues: CardDue[] = [];
  for (const w of seedStatements(now)) {
    const total = statementTotalFils(transactions, w);
    if (total <= 0) continue;
    dues.push({
      id: w.id,
      accountId: CARD,
      totalDueFils: total,
      minDueFils: minimumDueFils(total, floorFils),
      // The 5%-with-an-AED-100-floor figure above is Wafra's estimate, not
      // FAB's stated minimum — no demo SMS quotes one. Without this flag
      // cards.ts reports minimumKnown: true and the app presents an invented
      // number as the bank's, including in a push notification.
      minDueEstimated: true,
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

/**
 * The demo's accounts with the balances a bank would have quoted, stamped
 * against `now`.
 *
 * Wallet does not show a running balance for an SMS-fed account — SMS history
 * is partial by nature, so a derived figure would be fiction (see
 * `reliableBalanceFils`). The demo obeys the same rule as a real account, so
 * without a quoted snapshot the bank and card rows show no balance at all and
 * the screen the demo exists to sell is blank.
 *
 * The figures are DERIVED from the ledger that was just generated, not written
 * down. A hardcoded snapshot is right on exactly one launch date: the previous
 * demo carried an AED 1,209 card figure beside a card that had actually
 * charged AED 18,060 and never paid it, and Wallet and Cards contradicted each
 * other on the first screen a reviewer sees.
 *
 * The stamp is deliberately a few hours old rather than `now`: a balance
 * quoted this second reads as live data, and the honest claim is "this is what
 * the bank last told us".
 */
export function generateSeedAccounts(
  now: Date,
  transactions: Transaction[],
  market: DemoMarket = 'ae',
): Account[] {
  const p = demoProfile(market);
  const quotedTs = now.getTime() - 5 * 60 * 60 * 1000;
  const balanceOf = (accountId: string, openingFils: number) =>
    transactions.reduce(
      (sum, t) =>
        t.accountId === accountId
          ? sum + (t.type === 'income' ? t.amountFils : -t.amountFils)
          : sum,
      openingFils,
    );
  return p.accounts.map((a) => {
    // A hand-entered ledger has no bank quote to show; its running balance is
    // knowable from the rows, exactly as cash is below.
    if (p.rowSource === 'manual') return a;
    if (a.id === BANK) {
      return {
        ...a,
        snapshotFils: balanceOf(BANK, a.openingFils),
        snapshotKind: 'balance' as const,
        snapshotTs: quotedTs,
      };
    }
    if (a.id === CARD) {
      // A card snapshot is what is OWED, so it is the negative of the account
      // balance: purchases push it down, the statement payments push it back
      // up. `reliableBalanceFils` negates it again to place it on the ledger.
      return {
        ...a,
        snapshotFils: Math.max(0, -balanceOf(CARD, a.openingFils)),
        snapshotKind: 'outstanding' as const,
        snapshotTs: quotedTs,
      };
    }
    // Cash is fully manual: its rows are the user's own entries, so the
    // running balance IS knowable and no snapshot is wanted.
    return a;
  });
}
