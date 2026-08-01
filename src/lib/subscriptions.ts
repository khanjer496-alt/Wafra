import { daysBetweenISO, shiftISO, toISODate } from '@/lib/format';
import type { CategoryId, Transaction } from '@/lib/types';

export type Cadence = 'weekly' | 'monthly' | 'yearly';

/**
 * subscription — cancellable online/lifestyle services (streaming, apps, gym);
 * utility — recurring DEWA/telecom-style bills; housing — rent;
 * commitment — anything else that recurs (suppliers, fees, transfers to people).
 * Kept separate so "subscriptions total" only counts what you could cancel.
 */
export type RecurringGroup = 'subscription' | 'utility' | 'housing' | 'commitment';

export interface Subscription {
  title: string;
  category: CategoryId;
  group: RecurringGroup;
  /** stopped = silent for well past its cadence (likely cancelled). */
  status: 'active' | 'stopped';
  cadence: Cadence;
  avgAmountFils: number;
  lastAmountFils: number;
  lastChargedISO: string;
  nextExpectedISO: string;
  chargeCount: number;
  /** Latest charge is >10% above the average of prior charges. */
  priceIncreased: boolean;
  /**
   * The typical charge BEFORE the latest one — what it used to cost. Only
   * meaningful alongside priceIncreased, and the only place the old price
   * survives: avgAmountFils deliberately tracks the new one, so a "was X, now
   * Y" sentence built from avg alone said "AED 56 vs the usual AED 56".
   */
  previousAmountFils: number;
  /** Monthly-equivalent cost for totals (yearly/12, weekly*4.33). */
  monthlyEquivalentFils: number;
}

interface CadenceWindow {
  cadence: Cadence;
  minDays: number;
  maxDays: number;
  typicalDays: number;
}

const WINDOWS: CadenceWindow[] = [
  { cadence: 'weekly', minDays: 6, maxDays: 8, typicalDays: 7 },
  { cadence: 'monthly', minDays: 26, maxDays: 35, typicalDays: 30 },
  { cadence: 'yearly', minDays: 350, maxDays: 380, typicalDays: 365 },
];

/**
 * Merchants that are subscriptions by nature: one observed interval (or even a
 * single charge for monthly staples) is enough to surface them.
 */
const KNOWN_SUBSCRIPTION_MERCHANTS =
  /netflix|spotify|anghami|osn|shahid|starz|youtube|yt premium|apple\.com|apple services|icloud|google one|google storage|amazon prime|prime video|openai|chat\s*gpt|claude|anthropic|real-?debrid|all-?debrid|disney|hbo|deezer|audible|kindle|linkedin|dropbox|adobe|canva|microsoft 365|office 365|discord|notion|github|telegram premium|xbox game pass|playstation plus|psn plus|fitness first|gymnation|fitness time|classpass|etisalat postpaid|du postpaid|home internet/i;

// Both of these used to be local copies. Date arithmetic re-implemented per
// module is how the app ended up with two different answers for "when is this
// due", so there is now one of each, in format.ts.
const daysBetween = daysBetweenISO;
const addDays = shiftISO;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Categories where a recurring charge can plausibly BE a subscription service.
 * A recurring supplier invoice or school fee is a commitment, not a Netflix.
 */
const SUBSCRIPTION_CATEGORIES = new Set<CategoryId>(['entertainment', 'shopping', 'health']);

/**
 * Real subscription detection: per-merchant charge cadence with amount
 * stability, boosted by a known-subscription merchant list. Merchants the
 * user marked "not a subscription" are skipped entirely.
 */
export function detectSubscriptions(
  transactions: Transaction[],
  notSubscriptions: string[] = [],
  today: Date = new Date(),
): Subscription[] {
  const dismissed = new Set(notSubscriptions.map((s) => s.trim().toLowerCase()));
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.type !== 'expense' || t.isTransfer) continue;
    const k = t.title.trim().toLowerCase();
    if (!k || dismissed.has(k)) continue;
    const list = groups.get(k) ?? [];
    list.push(t);
    groups.set(k, list);
  }

  const subs: Subscription[] = [];
  for (const txs of groups.values()) {
    txs.sort((a, b) => (a.date < b.date ? -1 : 1));
    const title = txs[txs.length - 1].title;
    const known = KNOWN_SUBSCRIPTION_MERCHANTS.test(title);

    // Collapse same-day duplicates (split payments) into one charge.
    const charges: Transaction[] = [];
    for (const t of txs) {
      const prev = charges[charges.length - 1];
      if (prev && prev.date === t.date) prev.amountFils += t.amountFils;
      else charges.push({ ...t });
    }

    // A utility bill is recurring precisely BECAUSE it is a bill, and its
    // amount is never stable — SEWA is 280 one month and 450 the next. The
    // ±15% gate below is the right test for a subscription and the wrong one
    // for a bill, and applying it to both left the Utilities tab empty for a
    // user who pays four of them every month. For these, cadence alone is the
    // evidence.
    const billLike =
      charges[charges.length - 1].category === 'utilities' ||
      charges[charges.length - 1].category === 'telecom' ||
      charges[charges.length - 1].category === 'rent' ||
      charges[charges.length - 1].category === 'loan';

    const amounts = charges.map((c) => c.amountFils);
    const mid = median(amounts);
    if (mid <= 0) continue;
    const stable = amounts.every((a) => a >= mid * 0.85 && a <= mid * 1.15);
    if (!stable && !known && !billLike) continue;

    // Known merchants skip the stability gate, which let a single misparsed
    // charge set the price: one bad row put Canva on the list at AED 18,313 a
    // month. The typical charge is what the subscription costs, so anything
    // more than 3x or less than a third of the median is an outlier and takes
    // no part in the average or the price-rise comparison.
    const typical = amounts.filter((a) => a >= mid / 3 && a <= mid * 3);
    if (typical.length === 0) continue;

    const gaps: number[] = [];
    for (let i = 1; i < charges.length; i++) {
      gaps.push(daysBetween(charges[i - 1].date, charges[i].date));
    }

    let window: CadenceWindow | null = null;
    if (gaps.length > 0) {
      for (const w of WINDOWS) {
        const inWindow = gaps.filter((g) => g >= w.minDays && g <= w.maxDays).length;
        if (inWindow >= Math.max(1, Math.ceil(gaps.length * 0.6))) {
          window = w;
          break;
        }
      }
    }

    // One charge is not evidence of recurrence, however well-known the
    // merchant is. Treating it as one invented subscriptions from a single
    // Prime Video rental or a one-off app-store purchase, and an imaginary
    // monthly commitment is worse than a real one surfacing a cycle late.
    // Known merchants still get the easier bar: one interval rather than two.
    const requiredIntervals = known || billLike ? 1 : 2;
    if (!window || gaps.length < requiredIntervals) continue;

    const last = charges[charges.length - 1];
    // Compare against the MEDIAN of prior charges, and only once there are at
    // least two of them. A mean over one prorated first charge made every
    // steady subscription look like a price rise — Google One was flagged
    // "price up" in a month its price went down.
    // The latest charge against the MEDIAN of every charge before it. Median
    // rather than mean so one bad parse cannot move the bar, and unfiltered so
    // a real upgrade is not hidden by the outlier guard — a tier change and a
    // misparse look identical to that guard, and it silently prefers the past.
    const priorAmounts = amounts.slice(0, -1);
    const priorTypical = priorAmounts.length ? median(priorAmounts) : last.amountFils;
    // What it costs NOW, not what it averaged over its life. A lifetime average
    // reports a price the user no longer pays: Google One went from AED 7.99
    // to AED 76.99 on a tier upgrade and the app kept showing 7, because the
    // outlier guard below treats a genuine new price the same as a misparse.
    //
    // The median of the last three charges tracks an upgrade immediately —
    // once two of the three are the new amount — while still absorbing a
    // single bad parse, which is all the outlier guard was ever needed for.
    const recent = amounts.slice(-3);
    const avg = median(recent);
    const monthlyEquivalentFils =
      window.cadence === 'monthly'
        ? avg
        : window.cadence === 'weekly'
          ? Math.round(avg * 4.33)
          : Math.round(avg / 12);

    const group: RecurringGroup =
      last.category === 'rent'
        ? 'housing'
        : last.category === 'utilities' || last.category === 'telecom'
          ? 'utility'
          : known || SUBSCRIPTION_CATEGORIES.has(last.category)
            ? 'subscription'
            : 'commitment';

    // Silence for ~2 cycles past the last charge means it was cancelled.
    const silentDays = daysBetween(last.date, toISODate(today));
    const status: Subscription['status'] =
      silentDays > window.typicalDays * 2.2 + 5 ? 'stopped' : 'active';

    subs.push({
      title,
      category: last.category,
      group,
      status,
      cadence: window.cadence,
      avgAmountFils: avg,
      lastAmountFils: last.amountFils,
      lastChargedISO: last.date,
      nextExpectedISO: addDays(last.date, window.typicalDays),
      chargeCount: charges.length,
      priceIncreased: priorAmounts.length >= 2 && last.amountFils > priorTypical * 1.1,
      previousAmountFils: priorTypical,
      monthlyEquivalentFils,
    });
  }

  subs.sort((a, b) => b.monthlyEquivalentFils - a.monthlyEquivalentFils);
  return subs;
}

/** Monthly-equivalent total of what is still charging (stopped ones cost nothing). */
export function subscriptionsMonthlyTotal(subs: Subscription[]): number {
  return subs.reduce((s, sub) => (sub.status === 'active' ? s + sub.monthlyEquivalentFils : s), 0);
}

/** Only the cancellable online/lifestyle subscriptions. */
export function trueSubscriptions(subs: Subscription[]): Subscription[] {
  return subs.filter((s) => s.group === 'subscription');
}

/** Still-charging subscriptions. */
export function activeSubscriptions(subs: Subscription[]): Subscription[] {
  return subs.filter((s) => s.status === 'active');
}

/**
 * Likely-cancelled subscriptions (no charge for well past their cadence).
 * Restricted to KNOWN services: a shop you simply stopped visiting is not a
 * cancelled subscription, and listing it as one reads as a bug.
 */
export function stoppedSubscriptions(subs: Subscription[]): Subscription[] {
  return subs.filter((s) => s.status === 'stopped' && KNOWN_SUBSCRIPTION_MERCHANTS.test(s.title));
}

/** Rent + utilities/telecom recurring commitments. */
export function fixedCommitments(subs: Subscription[]): Subscription[] {
  return subs.filter((s) => s.group !== 'subscription');
}

/** Days until the next expected charge; negative if the date passed. */
export function daysUntilNext(sub: Subscription, today: Date): number {
  return daysBetween(toISODate(today), sub.nextExpectedISO);
}
