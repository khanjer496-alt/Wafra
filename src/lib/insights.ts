import { categoryLabel, getCategory } from '@/lib/categories';
import { isIncome, isSpending } from '@/lib/ledger';
import { formatAED, monthKey, shortDate, totalAsShown, wholeFilsAsShown } from '@/lib/format';
import { t, tf } from '@/lib/i18n';
import {
  elapsedDays,
  inPeriod,
  isCurrentMonth,
  periodLabel,
  previousPeriod,
  toPeriod,
  type PeriodLike,
} from '@/lib/period';
import { allocationsOf, amountInCategory } from '@/lib/splits';
import {
  activeSubscriptions,
  detectSubscriptions,
  subscriptionsMonthlyTotal,
  trueSubscriptions,
} from '@/lib/subscriptions';
import type { Budget, CategoryId, Transaction } from '@/lib/types';

export interface MonthSummary {
  /** Exact fils for rates, budgets and other financial arithmetic. */
  incomeFils: number;
  expenseFils: number;
  /** Per-transaction whole-AED figures, exactly as Activity rows are printed. */
  incomeShownFils: number;
  expenseShownFils: number;
  byCategory: {
    category: CategoryId;
    /** Exact fils for budget arithmetic. */
    totalFils: number;
    /** Whole-AED allocation whose category sum equals expenseShownFils. */
    shownFils: number;
    share: number;
  }[];
}

export interface CashflowSummary {
  incomeFils: number;
  expenseFils: number;
}

/**
 * One ledger pass for charts that need several reporting months at once.
 * Values use the same per-row whole-AED rule as the chart labels and Home.
 */
export function summarizeCashflowMonths(
  transactions: Transaction[],
  keys: string[],
  live?: Set<string>,
  internal?: Set<string>,
): Map<string, CashflowSummary> {
  const summaries = new Map<string, CashflowSummary>(
    keys.map((key) => [key, { incomeFils: 0, expenseFils: 0 }] as const),
  );
  for (const transaction of transactions) {
    const summary = summaries.get(monthKey(transaction.date));
    if (!summary) continue;
    if (isIncome(transaction, live, internal)) {
      summary.incomeFils += wholeFilsAsShown(transaction.amountFils);
    } else if (isSpending(transaction, live, internal)) {
      summary.expenseFils += wholeFilsAsShown(transaction.amountFils);
    }
  }
  return summaries;
}

/** Beyond five slices the ramp stops being readable, so the tail is pooled. */
export const MAX_COMPOSITION_SLICES = 5;

/**
 * The month's spending broken into the slices Flow draws, and the total of
 * those slices AS THEY ARE SHOWN.
 *
 * Both parts live here because they have to agree with each other and with
 * Home. Flow's heading is printed above the slices, so it has to total them
 * at the precision they are drawn at; Home's "Out" cell is the same quantity
 * one tap away, and was rounding the raw sum once. The two came out a dirham
 * apart — each correct by its own rule, and plainly contradictory to anyone
 * who looked at both. One rule, one place.
 */
export interface CompositionSlice {
  key: string;
  /** The single category, or null for the pooled tail. */
  category: CategoryId | null;
  /**
   * Every category this slice stands for — one for a named slice, all of the
   * tail for the pooled one. What a drill-down from the row has to filter on,
   * so the list it opens totals what the row said.
   */
  categories: CategoryId[];
  totalFils: number;
  share: number;
}

export function composition(
  summary: MonthSummary,
  maxSlices = MAX_COMPOSITION_SLICES,
): { slices: CompositionSlice[]; totalFils: number } {
  const head: CompositionSlice[] = summary.byCategory.slice(0, maxSlices).map((c) => ({
    key: c.category as string,
    category: c.category,
    categories: [c.category],
    totalFils: c.shownFils,
    share: summary.expenseShownFils > 0 ? c.shownFils / summary.expenseShownFils : 0,
  }));
  const tail = summary.byCategory.slice(maxSlices);
  if (tail.length > 0) {
    const totalFils = tail.reduce((sum, c) => sum + c.shownFils, 0);
    head.push({
      key: 'rest',
      category: null,
      categories: tail.map((c) => c.category),
      totalFils,
      share: summary.expenseShownFils > 0 ? totalFils / summary.expenseShownFils : 0,
    });
  }
  return { slices: head, totalFils: totalAsShown(head.map((h) => h.totalFils)) };
}

/**
 * Allocate one row's displayed whole dirhams across its split categories.
 *
 * Rounding each split independently can manufacture or lose dirhams. Floor
 * every part, then give the row's remaining displayed dirhams to the largest
 * fractional parts. The result is deterministic, non-negative and sums to the
 * same `wholeFilsAsShown(transaction.amountFils)` printed in Activity.
 */
function categoryAllocationsAsShown(
  transaction: Transaction,
  allocations: readonly { category: CategoryId; amountFils: number }[],
): { category: CategoryId; amountFils: number }[] {
  if (allocations.length === 0) return [];
  const rows = allocations.map((allocation, index) => ({
    category: allocation.category,
    index,
    units: Math.floor(allocation.amountFils / 100),
    fraction: allocation.amountFils % 100,
  }));
  let remaining = wholeFilsAsShown(transaction.amountFils) / 100 -
    rows.reduce((sum, row) => sum + row.units, 0);
  const byRemainder = [...rows].sort(
    (a, b) => b.fraction - a.fraction || a.index - b.index,
  );
  for (let index = 0; remaining > 0; index += 1, remaining -= 1) {
    byRemainder[index % byRemainder.length].units += 1;
  }
  return rows.map((row) => ({ category: row.category, amountFils: row.units * 100 }));
}

export function summarizeMonth(
  transactions: Transaction[],
  period: PeriodLike,
  live?: Set<string>,
  internal?: Set<string>,
): MonthSummary {
  let incomeFils = 0;
  let expenseFils = 0;
  let incomeShownFils = 0;
  let expenseShownFils = 0;
  const catTotals = new Map<CategoryId, number>();
  const catShownTotals = new Map<CategoryId, number>();

  for (const t of transactions) {
    if (!inPeriod(t.date, period)) continue;
    // One definition of spending and income, shared with every other screen
    // that adds money up. See ledger.ts for what these exclude and why.
    if (isIncome(t, live, internal)) {
      incomeFils += t.amountFils;
      incomeShownFils += wholeFilsAsShown(t.amountFils);
    } else if (isSpending(t, live, internal)) {
      expenseFils += t.amountFils;
      expenseShownFils += wholeFilsAsShown(t.amountFils);
      const allocations = allocationsOf(t);
      for (const a of allocations) {
        catTotals.set(a.category, (catTotals.get(a.category) ?? 0) + a.amountFils);
      }
      for (const allocation of categoryAllocationsAsShown(t, allocations)) {
        catShownTotals.set(
          allocation.category,
          (catShownTotals.get(allocation.category) ?? 0) + allocation.amountFils,
        );
      }
    }
  }

  const byCategory = [...catTotals.entries()]
    .map(([category, totalFils]) => ({
      category,
      totalFils,
      shownFils: catShownTotals.get(category) ?? 0,
      share: expenseFils > 0 ? totalFils / expenseFils : 0,
    }))
    .sort((a, b) => b.totalFils - a.totalFils);

  return { incomeFils, expenseFils, incomeShownFils, expenseShownFils, byCategory };
}

export function spentInMonthForCategory(
  transactions: Transaction[],
  period: PeriodLike,
  category: CategoryId,
  live?: Set<string>,
  internal?: Set<string>,
): number {
  let total = 0;
  for (const t of transactions) {
    // amountInCategory does the category match itself, and counts each part of
    // a split row separately — so the row's headline category is not consulted.
    if (inPeriod(t.date, period) && isSpending(t, live, internal)) {
      total += amountInCategory(t, category);
    }
  }
  return total;
}

export type InsightTone = 'positive' | 'warning' | 'neutral';

/**
 * Every screen an insight is allowed to send you to.
 *
 * A route name is just a string, and expo-router resolves one with no file
 * behind it to Unmatched Route — no compile error, no warning, nothing until
 * a user taps it. Two of these were wrong for months ("/budgets", "/stats"),
 * so the button on a budget warning could only ever fail. Naming them once
 * gives the typechecker something to hold, and a test checks each has a file.
 */
export const INSIGHT_DESTINATIONS = ['/flow', '/bills', '/transactions', '/wallet'] as const;

export type InsightDestination = (typeof INSIGHT_DESTINATIONS)[number];

/** A declared destination, optionally scoped by a query. */
export type InsightHref = InsightDestination | `${InsightDestination}?${string}`;

/**
 * Build a destination.
 *
 * Everything goes through here so the route half of an href is always a plain
 * literal from INSIGHT_DESTINATIONS — which is what routes.test.js scans for.
 * A template literal assembled at the call site would be invisible to it, and
 * invisible is exactly how "/budgets" survived for months.
 */
function dest(route: InsightDestination, query?: Record<string, string>): InsightHref {
  if (!query) return route;
  const q = Object.entries(query)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `${route}?${q}`;
}

export interface Insight {
  id: string;
  tone: InsightTone;
  icon: import('@/components/ui/icon').IconName;
  title: string;
  body: string;
  /** Where tapping the insight takes you (the screen to act on it). */
  href?: InsightHref;
}

/**
 * The analysis engine: turns the raw ledger into a ranked list of plain-language
 * observations about the selected month.
 */
export function buildInsights(
  transactions: Transaction[],
  budgets: Budget[],
  periodLike: PeriodLike,
  today: Date,
  notSubscriptions: string[] = [],
  liveAccounts?: Set<string>,
  internalTransfers?: Set<string>,
  prepared?: {
    current?: MonthSummary;
    categorySpend?: ReadonlyMap<CategoryId, number>;
  },
): Insight[] {
  const insights: Insight[] = [];
  const period = toPeriod(periodLike);
  const current = prepared?.current ??
    summarizeMonth(transactions, period, liveAccounts, internalTransfers);
  const prev = previousPeriod(period);
  const previous = prev
    ? summarizeMonth(transactions, prev, liveAccounts, internalTransfers)
    : {
        incomeFils: 0,
        expenseFils: 0,
        incomeShownFils: 0,
        expenseShownFils: 0,
        byCategory: [],
      };
  const live = isCurrentMonth(period, today);
  const isMonthMode = period.mode === 'month';
  const dayOfMonth = Math.max(1, elapsedDays(period, today, transactions));
  const totalDaysInPeriod =
    period.mode === 'month'
      ? Number(new Date(Number(period.key.slice(0, 4)), Number(period.key.slice(5, 7)), 0).getDate())
      : dayOfMonth;

  // Change vs the previous period (pace projection only mid-current-month)
  if (prev && previous.expenseFils > 0 && current.expenseFils > 0) {
    // A day-one or payday-heavy sample is not a trend. Wait for a full week
    // before annualising the current pace; otherwise rent and salary-day bills
    // can produce claims such as "1,511% higher" that no serious finance app
    // should present as an insight.
    if (live) {
      if (dayOfMonth >= 7) {
        const pace = current.expenseFils / dayOfMonth;
        const projected = pace * totalDaysInPeriod;
        const delta = (projected - previous.expenseFils) / previous.expenseFils;
        if (Math.abs(delta) >= 0.08) {
          const pct = Math.round(Math.abs(delta) * 100);
          insights.push({
            id: 'pace',
            tone: delta > 0 ? 'warning' : 'positive',
            icon: delta > 0 ? 'arrow-up-right' : 'arrow-down-right',
            title: tf(delta > 0 ? 'insightTrendingHigher' : 'insightTrendingLower', { percent: pct }),
            body: tf('insightPaceBody', {
              projected: formatAED(Math.round(projected), { decimals: false }),
              previous: formatAED(previous.expenseFils, { decimals: false }),
              period: periodLabel(prev),
            }),
            // The entries the pace is measured over. Not '/flow': this list is
            // DRAWN on Flow, so pushing Flow is a no-op and the card is inert.
            href: dest('/transactions'),
          });
        }
      }
    } else {
      const delta = (current.expenseFils - previous.expenseFils) / previous.expenseFils;
      if (Math.abs(delta) >= 0.05) {
        const pct = Math.round(Math.abs(delta) * 100);
        insights.push({
          id: 'mom',
          tone: delta > 0 ? 'warning' : 'positive',
          icon: delta > 0 ? 'arrow-up-right' : 'arrow-down-right',
          title: tf(delta > 0 ? 'insightSpentMore' : 'insightSpentLess', { percent: pct }),
          body: tf('insightComparisonBody', {
            current: formatAED(current.expenseFils, { decimals: false }),
            previous: formatAED(previous.expenseFils, { decimals: false }),
            period: periodLabel(prev),
          }),
          href: dest('/transactions'),
        });
      }
    }
  }

  // Budget alerts (budgets are monthly — skip in year/range/all views)
  for (const b of isMonthMode ? budgets : []) {
    const spent = prepared?.categorySpend?.get(b.category) ??
      spentInMonthForCategory(
        transactions,
        period,
        b.category,
        liveAccounts,
        internalTransfers,
      );
    if (b.limitFils <= 0) continue;
    const ratio = spent / b.limitFils;
    const cat = getCategory(b.category);
    if (ratio >= 1) {
      insights.push({
        id: `budget-over-${b.category}`,
        tone: 'warning',
        icon: 'alert',
        title: tf('insightBudgetExceeded', { category: categoryLabel(cat) }),
        body: tf('insightBudgetExceededBody', {
          spent: formatAED(spent, { decimals: false }),
          limit: formatAED(b.limitFils, { decimals: false }),
        }),
        // What blew the limit, not the screen the warning is printed on.
        href: dest('/transactions', { category: b.category }),
      });
    } else if (ratio >= 0.85 && live) {
      insights.push({
        id: `budget-near-${b.category}`,
        tone: 'warning',
        icon: 'alert',
        title: tf('insightBudgetNear', { category: categoryLabel(cat) }),
        body: tf('insightBudgetNearBody', {
          percent: Math.round(ratio * 100),
          left: formatAED(b.limitFils - spent, { decimals: false }),
        }),
        href: dest('/transactions', { category: b.category }),
      });
    }
  }

  // Top category concentration (rent and business costs aren't lifestyle spending)
  const top = current.byCategory.filter((c) => c.category !== 'rent' && c.category !== 'business')[0];
  if (top && top.share >= 0.15) {
    const cat = getCategory(top.category);
    insights.push({
      id: 'top-category',
      tone: 'neutral',
      icon: cat.icon,
      title: tf('insightCategoryLeads', { category: categoryLabel(cat) }),
      body: tf('insightCategoryLeadsBody', {
        amount: formatAED(top.totalFils, { decimals: false }),
        percent: Math.round(top.share * 100),
      }),
      href: dest('/transactions', { category: top.category }),
    });
  }

  // Savings rate
  if (current.incomeFils > 0) {
    const rate = (current.incomeFils - current.expenseFils) / current.incomeFils;
    if (rate >= 0.2) {
      insights.push({
        id: 'savings',
        tone: 'positive',
        icon: 'leaf',
        title: tf('insightSavingRate', { percent: Math.round(rate * 100) }),
        body: tf(live ? 'insightSavingBodyLive' : 'insightSavingBodyPeriod', {
          amount: formatAED(current.incomeFils - current.expenseFils, { decimals: false }),
        }),
        // Where money that was kept aside actually lives: balances and goals.
        href: dest('/wallet'),
      });
    } else if (rate < 0) {
      insights.push({
        id: 'overspend',
        tone: 'warning',
        icon: 'alert',
        title: t('insightSpendingExceeds'),
        body: tf(isMonthMode ? 'insightOverspendMonth' : 'insightOverspendPeriod', {
          amount: formatAED(current.expenseFils - current.incomeFils, { decimals: false }),
        }),
        href: dest('/transactions'),
      });
    }
  }

  // Largest single expense
  //
  // Every other figure on this card is derived from `current`, which applies
  // both exclusions. This loop applied neither, so the one insight that names
  // a specific row could name a row none of the other insights counted: a
  // purchase on a card the user had hidden, or the leaving side of a move
  // between their own accounts stored before transfers carried a flag. The
  // headline read "Biggest purchase — AED 19,000, Outgoing Transfer" over a
  // month whose Out was 3,000.
  let largest: Transaction | null = null;
  for (const t of transactions) {
    if (!isSpending(t, liveAccounts, internalTransfers)) continue;
    if (inPeriod(t.date, period) && t.category !== 'rent' && t.category !== 'business') {
      if (!largest || t.amountFils > largest.amountFils) largest = t;
    }
  }
  if (largest && largest.amountFils >= 20_000) {
    insights.push({
      id: 'largest',
      tone: 'neutral',
      icon: 'diamond',
      title: t('insightBiggestPurchase'),
      body: tf('insightBiggestPurchaseBody', {
        merchant: largest.title,
        amount: formatAED(largest.amountFils, { decimals: false }),
        date: shortDate(largest.date),
      }),
      // That merchant's own history, which is the question a biggest-purchase
      // line provokes: is this a one-off or do I do this every month?
      href: dest('/transactions', { merchant: largest.title }),
    });
  }

  // Subscription load + price increases (true subscriptions only — rent and
  // utilities are fixed commitments, not cancellable services)
  const subs = activeSubscriptions(
    trueSubscriptions(
      detectSubscriptions(transactions, notSubscriptions, today, liveAccounts, internalTransfers),
    ),
  );
  if (subs.length >= 2) {
    const monthly = subscriptionsMonthlyTotal(subs);
    if (isMonthMode && current.incomeFils > 0 && monthly / current.incomeFils >= 0.08) {
      insights.push({
        id: 'subs-load',
        tone: 'warning',
        icon: 'repeat',
        title: tf('insightSubscriptionsCost', {
          count: subs.length,
          amount: formatAED(monthly, { decimals: false }),
        }),
        body: tf('insightSubscriptionsShare', {
          percent: Math.round((monthly / current.incomeFils) * 100),
        }),
        href: dest('/bills'),
      });
    } else {
      insights.push({
        id: 'subs-total',
        tone: 'neutral',
        icon: 'repeat',
        title: tf('insightActiveSubscriptions', { count: subs.length }),
        body: tf('insightActiveSubscriptionsBody', {
          amount: formatAED(monthly, { decimals: false }),
        }),
        href: dest('/bills'),
      });
    }
  }
  // Rounded to whole dirhams for display, so a rise that survives the test
  // but not the rounding would print the same figure twice. If the user
  // cannot see the difference, there is nothing to tell them.
  const increased = subs.find(
    (s) =>
      s.priceIncreased &&
      Math.round(s.lastAmountFils / 100) !== Math.round(s.priorTypicalFils / 100),
  );
  if (increased) {
    insights.push({
      id: `price-up-${increased.title}`,
      tone: 'warning',
      icon: 'arrow-up-right',
      title: tf('insightGotPricier', { name: increased.title }),
      body: tf('insightGotPricierBody', {
        last: formatAED(increased.lastAmountFils, { decimals: false }),
        usual: formatAED(increased.priorTypicalFils, { decimals: false }),
      }),
      href: dest('/bills'),
    });
  }

  // Average daily spend
  if (current.expenseFils > 0 && dayOfMonth > 0) {
    insights.push({
      id: 'daily',
      tone: 'neutral',
      icon: 'sun',
      title: t('insightDailyAverage'),
      body: tf(isMonthMode ? 'insightDailyAverageMonth' : 'insightDailyAveragePeriod', {
        amount: formatAED(Math.round(current.expenseFils / dayOfMonth), { decimals: false }),
      }),
      href: dest('/transactions'),
    });
  }

  const toneRank: Record<InsightTone, number> = { warning: 0, positive: 1, neutral: 2 };
  insights.sort((a, b) => toneRank[a.tone] - toneRank[b.tone]);
  return insights;
}
