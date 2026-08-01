import { getCategory, isFixedCommitment } from '@/lib/categories';
import { daysInMonth, formatAED, shortDate } from '@/lib/format';
import {
  elapsedDays,
  inPeriod,
  isCurrentMonth,
  periodLabel,
  previousPeriod,
  toPeriod,
  type PeriodLike,
} from '@/lib/period';
import type { AppRoute } from '@/lib/routes';
import {
  activeSubscriptions,
  detectSubscriptions,
  subscriptionsMonthlyTotal,
  trueSubscriptions,
} from '@/lib/subscriptions';
import type { Budget, CategoryId, Transaction } from '@/lib/types';

export interface MonthSummary {
  incomeFils: number;
  expenseFils: number;
  byCategory: { category: CategoryId; totalFils: number; share: number }[];
}

export function summarizeMonth(transactions: Transaction[], period: PeriodLike): MonthSummary {
  let incomeFils = 0;
  let expenseFils = 0;
  const catTotals = new Map<CategoryId, number>();

  for (const t of transactions) {
    if (t.isTransfer) continue; // card payments move money, they aren't income/spending
    if (!inPeriod(t.date, period)) continue;
    if (t.type === 'income') {
      incomeFils += t.amountFils;
    } else {
      expenseFils += t.amountFils;
      catTotals.set(t.category, (catTotals.get(t.category) ?? 0) + t.amountFils);
    }
  }

  const byCategory = [...catTotals.entries()]
    .map(([category, totalFils]) => ({
      category,
      totalFils,
      share: expenseFils > 0 ? totalFils / expenseFils : 0,
    }))
    .sort((a, b) => b.totalFils - a.totalFils);

  return { incomeFils, expenseFils, byCategory };
}

export function spentInMonthForCategory(
  transactions: Transaction[],
  period: PeriodLike,
  category: CategoryId,
): number {
  let total = 0;
  for (const t of transactions) {
    if (t.isTransfer) continue;
    if (t.type === 'expense' && t.category === category && inPeriod(t.date, period)) {
      total += t.amountFils;
    }
  }
  return total;
}

export type InsightTone = 'positive' | 'warning' | 'neutral';

export interface Insight {
  id: string;
  tone: InsightTone;
  icon: import('@/components/ui/icon').IconName;
  title: string;
  body: string;
  /**
   * Where tapping the insight takes you — the screen that lets you act on it.
   *
   * `AppRoute`, never `string`: a destination is chosen here, next to the
   * sentence that promises it, and it has to be a screen that exists. See
   * `@/lib/routes`. Leave it undefined when an observation genuinely has
   * nowhere to go; the row then renders without a chevron rather than
   * promising a journey it cannot make.
   */
  href?: AppRoute;
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
): Insight[] {
  const insights: Insight[] = [];
  const period = toPeriod(periodLike);
  const current = summarizeMonth(transactions, period);
  const prev = previousPeriod(period);
  const previous = prev ? summarizeMonth(transactions, prev) : { incomeFils: 0, expenseFils: 0, byCategory: [] };
  const live = isCurrentMonth(period, today);
  const isMonthMode = period.mode === 'month';
  const dayOfMonth = Math.max(1, elapsedDays(period, today, transactions));
  // `daysInMonth` is the report month's length whatever the month start day
  // is — the window [day D of M, day D-1 of M+1] holds exactly as many days
  // as M does. This used to be an inline re-implementation of it.
  const totalDaysInPeriod = period.mode === 'month' ? daysInMonth(period.key) : dayOfMonth;

  // Change vs the previous period (pace projection only mid-current-month)
  if (prev && previous.expenseFils > 0 && current.expenseFils > 0) {
    if (live) {
      const pace = current.expenseFils / dayOfMonth;
      const projected = pace * totalDaysInPeriod;
      const delta = (projected - previous.expenseFils) / previous.expenseFils;
      if (Math.abs(delta) >= 0.08) {
        const pct = Math.round(Math.abs(delta) * 100);
        insights.push({
          id: 'pace',
          tone: delta > 0 ? 'warning' : 'positive',
          icon: delta > 0 ? 'arrow-up-right' : 'arrow-down-right',
          title: delta > 0 ? `Trending ${pct}% higher` : `Trending ${pct}% lower`,
          body: `At today's pace you'll spend about ${formatAED(Math.round(projected), { decimals: false })} this month, vs ${formatAED(previous.expenseFils, { decimals: false })} in ${periodLabel(prev)}.`,
          href: '/stats',
        });
      }
    } else {
      const delta = (current.expenseFils - previous.expenseFils) / previous.expenseFils;
      if (Math.abs(delta) >= 0.05) {
        const pct = Math.round(Math.abs(delta) * 100);
        insights.push({
          id: 'mom',
          tone: delta > 0 ? 'warning' : 'positive',
          icon: delta > 0 ? 'arrow-up-right' : 'arrow-down-right',
          title: `Spent ${pct}% ${delta > 0 ? 'more' : 'less'}`,
          body: `${formatAED(current.expenseFils, { decimals: false })} vs ${formatAED(previous.expenseFils, { decimals: false })} in ${periodLabel(prev)}.`,
          href: '/stats',
        });
      }
    }
  }

  // Budget alerts (budgets are monthly — skip in year/range/all views)
  for (const b of isMonthMode ? budgets : []) {
    const spent = spentInMonthForCategory(transactions, period, b.category);
    if (b.limitFils <= 0) continue;
    const ratio = spent / b.limitFils;
    const cat = getCategory(b.category);
    if (ratio >= 1) {
      insights.push({
        id: `budget-over-${b.category}`,
        tone: 'warning',
        icon: 'alert',
        title: `${cat.label} budget exceeded`,
        body: `${formatAED(spent, { decimals: false })} spent of your ${formatAED(b.limitFils, { decimals: false })} limit.`,
        // Flow owns limits — it is the only screen where one can be changed.
        href: '/flow',
      });
    } else if (ratio >= 0.85 && live) {
      insights.push({
        id: `budget-near-${b.category}`,
        tone: 'warning',
        icon: 'alert',
        title: `${cat.label} almost at limit`,
        body: `${Math.round(ratio * 100)}% used — ${formatAED(b.limitFils - spent, { decimals: false })} left for the month.`,
        href: '/flow',
      });
    }
  }

  // Top category concentration (rent and business costs aren't lifestyle spending)
  const top = current.byCategory.filter((c) => !isFixedCommitment(c.category))[0];
  if (top && top.share >= 0.15) {
    const cat = getCategory(top.category);
    insights.push({
      id: 'top-category',
      tone: 'neutral',
      icon: cat.icon,
      title: `${cat.label} leads your spending`,
      body: `${formatAED(top.totalFils, { decimals: false })} — ${Math.round(top.share * 100)}% of this month's expenses.`,
      // The rows behind the number, already filtered to the category named.
      href: `/transactions?category=${top.category}`,
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
        title: `Saving ${Math.round(rate * 100)}% of income`,
        body: `${formatAED(current.incomeFils - current.expenseFils, { decimals: false })} kept aside${live ? ' so far this month' : ''}. Keep it up!`,
        href: '/stats',
      });
    } else if (rate < 0) {
      insights.push({
        id: 'overspend',
        tone: 'warning',
        icon: 'alert',
        title: 'Spending exceeds income',
        body: `Expenses are ${formatAED(current.expenseFils - current.incomeFils, { decimals: false })} above income${isMonthMode ? ' this month' : ' in this period'}.`,
        href: '/transactions?type=expense',
      });
    }
  }

  // Largest single expense
  let largest: Transaction | null = null;
  for (const t of transactions) {
    if (t.isTransfer) continue;
    if (t.type === 'expense' && inPeriod(t.date, period) && !isFixedCommitment(t.category)) {
      if (!largest || t.amountFils > largest.amountFils) largest = t;
    }
  }
  if (largest && largest.amountFils >= 20_000) {
    insights.push({
      id: 'largest',
      tone: 'neutral',
      // The glyph of what was bought, not a decoration. `diamond` used to sit
      // here, and `diamond` is the Wafra Pro mark on Settings, Home and /pro —
      // one glyph cannot mean both "premium" and "largest transaction".
      icon: getCategory(largest.category).icon,
      title: 'Biggest purchase',
      // `shortDate`, so this reads "23 Jul" like every other date in the app.
      // It used to hand-roll "23/07" and was the only DD/MM in the product.
      body: `${largest.title} — ${formatAED(largest.amountFils, { decimals: false })} on ${shortDate(largest.date)}.`,
      // Scoped to that merchant: "what else have I paid them?" is the next
      // question every time.
      href: `/transactions?merchant=${encodeURIComponent(largest.title)}`,
    });
  }

  // Subscription load + price increases (true subscriptions only — rent and
  // utilities are fixed commitments, not cancellable services)
  const subs = activeSubscriptions(
    trueSubscriptions(detectSubscriptions(transactions, notSubscriptions, today)),
  );
  if (subs.length >= 2) {
    const monthly = subscriptionsMonthlyTotal(subs);
    if (isMonthMode && current.incomeFils > 0 && monthly / current.incomeFils >= 0.08) {
      insights.push({
        id: 'subs-load',
        tone: 'warning',
        icon: 'repeat',
        title: `${subs.length} subscriptions cost ${formatAED(monthly, { decimals: false })}/mo`,
        body: `That's ${Math.round((monthly / current.incomeFils) * 100)}% of this month's income. Review them in Bills.`,
        href: '/bills',
      });
    } else {
      insights.push({
        id: 'subs-total',
        tone: 'neutral',
        icon: 'repeat',
        title: `${subs.length} active subscriptions`,
        body: `About ${formatAED(monthly, { decimals: false })} per month combined.`,
        href: '/bills',
      });
    }
  }
  const increased = subs.find((s) => s.priceIncreased);
  if (increased) {
    insights.push({
      id: `price-up-${increased.title}`,
      tone: 'warning',
      icon: 'arrow-up-right',
      title: `${increased.title} got pricier`,
      // Against what it USED to cost. avgAmountFils tracks the new price by
      // design, so comparing the last charge to it read "AED 56 vs the usual
      // AED 56" — a sentence that undermines the whole insight.
      body: `Now ${formatAED(increased.lastAmountFils, { decimals: false })} a month, up from ${formatAED(increased.previousAmountFils, { decimals: false })}.`,
      href: '/bills',
    });
  }

  // Average daily spend
  if (current.expenseFils > 0 && dayOfMonth > 0) {
    insights.push({
      id: 'daily',
      tone: 'neutral',
      icon: 'sun',
      title: 'Daily average',
      // Stats breaks the same figure down by weekday, which is the only way
      // an average like this becomes something you can act on.
      body: `You spend about ${formatAED(Math.round(current.expenseFils / dayOfMonth), { decimals: false })} per day${isMonthMode ? ' this month' : ' in this period'}.`,
      href: '/stats',
    });
  }

  const toneRank: Record<InsightTone, number> = { warning: 0, positive: 1, neutral: 2 };
  insights.sort((a, b) => toneRank[a.tone] - toneRank[b.tone]);
  return insights;
}
