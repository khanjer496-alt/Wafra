import { categoryLabel } from '@/lib/categories';
import { summarizeCashOutflow } from '@/lib/cash-flow';
import { formatAED as formatLedgerMoney } from '@/lib/format';
import { internalTransferIds, isSpending, liveAccountIds } from '@/lib/ledger';
import { checkedMinorSum } from '@/lib/ledger-money';
import { leavingSoon, outgoingTotalFils } from '@/lib/leaving-soon';
import {
  currentMonthPeriod,
  daysInPeriod,
  elapsedDays,
  inPeriod,
  previousPeriod,
  type Period,
} from '@/lib/period';
import { allocationsOf, amountInCategory } from '@/lib/splits';
import { activeSubscriptions, detectSubscriptions, trueSubscriptions } from '@/lib/subscriptions';
import type { AppState, CategoryId, Transaction } from '@/lib/types';

export type AssistantTool =
  | 'spending-total'
  | 'income-total'
  | 'merchant-breakdown'
  | 'category-breakdown'
  | 'subscriptions'
  | 'compare-periods'
  | 'top-merchants'
  | 'top-categories'
  | 'upcoming-payments'
  | 'cash-outflow'
  | 'month-forecast';

/**
 * The deterministic contract the future AI layer is allowed to call.
 *
 * An LLM may eventually turn free-form language into one of these requests,
 * but it never receives authority to calculate a financial figure itself.
 * Every amount still comes from Wafra's local ledger through this executor.
 */
export type AssistantToolRequest =
  | { tool: 'spending-total'; period: Period }
  | { tool: 'income-total'; period: Period }
  | { tool: 'merchant-breakdown'; period: Period; merchant: string }
  | { tool: 'category-breakdown'; period: Period; category: CategoryId }
  | { tool: 'subscriptions' }
  | { tool: 'compare-periods'; period: Period }
  | { tool: 'top-merchants'; period: Period; limit?: number }
  | { tool: 'top-categories'; period: Period; limit?: number }
  | { tool: 'upcoming-payments'; withinDays?: number }
  | { tool: 'cash-outflow'; period: Period }
  | { tool: 'month-forecast'; period: Period };

export interface AssistantAnswer {
  tool: AssistantTool;
  title: string;
  body: string;
  facts?: { label: string; value: string }[];
  /** Structured, body-free numbers safe to pass to a future explanation model. */
  data?: Record<string, string | number | boolean | null>;
}

const normalize = (value: string) => value.trim().toLowerCase();

function ledgerScope(state: AppState) {
  const live = liveAccountIds(state.accounts);
  const internal = internalTransferIds(state.transactions, state.accounts);
  return { live, internal };
}

function spendingRows(state: AppState, period: Period): Transaction[] {
  const { live, internal } = ledgerScope(state);
  return state.transactions.filter((tx) => inPeriod(tx.date, period) && isSpending(tx, live, internal));
}

function incomeRows(state: AppState, period: Period): Transaction[] {
  const { live, internal } = ledgerScope(state);
  return state.transactions.filter((tx) =>
    inPeriod(tx.date, period) &&
    live.has(tx.accountId) &&
    !internal.has(tx.id) &&
    tx.type === 'income' &&
    !tx.isTransfer,
  );
}

function total(rows: Transaction[]): number {
  return checkedMinorSum(rows.map((tx) => tx.amountFils));
}

function selectedPeriod(question: string, now: Date): Period {
  const current = currentMonthPeriod(now);
  const currentYear = now.getFullYear();
  if (/all time|ever|since i started/.test(question)) {
    return { mode: 'all' };
  }
  if (/last year|previous year/.test(question)) {
    return { mode: 'year', year: currentYear - 1 };
  }
  if (/this year|current year/.test(question)) {
    return { mode: 'year', year: currentYear };
  }
  if (/last month|previous month/.test(question)) {
    return previousPeriod(current) ?? current;
  }
  return current;
}

function merchantFromQuestion(question: string, rows: Transaction[]): string | null {
  const q = normalize(question);
  const titles = [...new Set(rows.map((tx) => tx.title.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  return titles.find((title) => q.includes(normalize(title))) ?? null;
}

function categoryFromQuestion(question: string): CategoryId | null {
  const q = normalize(question);
  const aliases: [RegExp, CategoryId][] = [
    [/dining|restaurant|food|eating out/, 'dining'],
    [/grocery|groceries|supermarket/, 'groceries'],
    [/transport|taxi|careem|uber/, 'transport'],
    [/shopping|shops/, 'shopping'],
    [/software|apps|subscriptions software/, 'software'],
    [/utilities|electricity|water/, 'utilities'],
    [/telecom|phone|mobile/, 'telecom'],
    [/rent/, 'rent'],
    [/travel|flight|hotel/, 'travel'],
    [/entertainment|movies|gaming/, 'entertainment'],
    [/health|doctor|clinic|pharmacy|medical/, 'health'],
    [/personal care|salon|barber|spa|grooming/, 'personal-care'],
    [/home service|cleaning|maintenance|maid/, 'home-services'],
    [/education|school|university|course/, 'education'],
    [/charity|donation/, 'charity'],
    [/government|visa|traffic fine|government fee/, 'government'],
    [/loan|finance instalment|installment/, 'loan'],
    [/invest|broker|crypto|investment/, 'investing'],
    [/cash withdrawal|atm/, 'cash-withdrawal'],
  ];
  return aliases.find(([pattern]) => pattern.test(q))?.[1] ?? null;
}

function groupedTotals<T extends string>(
  rows: Transaction[],
  key: (transaction: Transaction) => T,
): { key: T; totalFils: number; count: number }[] {
  const grouped = new Map<T, { totalFils: number; count: number }>();
  for (const transaction of rows) {
    const groupKey = key(transaction);
    const current = grouped.get(groupKey) ?? { totalFils: 0, count: 0 };
    current.totalFils = checkedMinorSum([current.totalFils, transaction.amountFils]);
    current.count += 1;
    grouped.set(groupKey, current);
  }
  return [...grouped.entries()]
    .map(([groupKey, value]) => ({ key: groupKey, ...value }))
    .sort((a, b) => b.totalFils - a.totalFils || b.count - a.count);
}

function groupedCategoryTotals(rows: Transaction[]): { key: CategoryId; totalFils: number; count: number }[] {
  const grouped = new Map<CategoryId, { totalFils: number; count: number }>();
  for (const transaction of rows) {
    for (const allocation of allocationsOf(transaction)) {
      const current = grouped.get(allocation.category) ?? { totalFils: 0, count: 0 };
      current.totalFils = checkedMinorSum([current.totalFils, allocation.amountFils]);
      current.count += 1;
      grouped.set(allocation.category, current);
    }
  }
  return [...grouped.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => b.totalFils - a.totalFils || b.count - a.count);
}

function groupedCategoryMerchants(
  rows: Transaction[],
  category: CategoryId,
): { key: string; totalFils: number; count: number }[] {
  const grouped = new Map<string, { totalFils: number; count: number }>();
  for (const transaction of rows) {
    const contribution = amountInCategory(transaction, category);
    if (contribution <= 0) continue;
    const key = transaction.title.trim() || 'Unknown';
    const current = grouped.get(key) ?? { totalFils: 0, count: 0 };
    current.totalFils = checkedMinorSum([current.totalFils, contribution]);
    current.count += 1;
    grouped.set(key, current);
  }
  return [...grouped.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => b.totalFils - a.totalFils || b.count - a.count);
}

export function executeAssistantTool(
  state: AppState,
  request: AssistantToolRequest,
  now = new Date(),
): AssistantAnswer {
  const period = 'period' in request ? request.period : currentMonthPeriod(now);
  const spending = spendingRows(state, period);
  const income = incomeRows(state, period);

  switch (request.tool) {
    case 'subscriptions': {
      const { live, internal } = ledgerScope(state);
      const subs = activeSubscriptions(trueSubscriptions(
        detectSubscriptions(state.transactions, state.notSubscriptions, now, live, internal),
      )).sort((a, b) => b.monthlyEquivalentFils - a.monthlyEquivalentFils);
      const monthly = checkedMinorSum(subs.map((item) => item.monthlyEquivalentFils));
      return {
        tool: request.tool,
        title: 'Subscriptions',
        body: subs.length
          ? `I found ${subs.length} active subscription${subs.length === 1 ? '' : 's'}, about ${formatLedgerMoney(monthly)} per month.`
          : 'I do not see any active subscriptions yet.',
        facts: subs.slice(0, 5).map((item) => ({
          label: item.title,
          value: formatLedgerMoney(item.monthlyEquivalentFils),
        })),
        data: { subscriptionCount: subs.length, monthlyEquivalentFils: monthly },
      };
    }

    case 'category-breakdown': {
      const rows = spending.filter((tx) => amountInCategory(tx, request.category) > 0);
      const amount = checkedMinorSum(rows.map((tx) => amountInCategory(tx, request.category)));
      return {
        tool: request.tool,
        title: categoryLabel(request.category),
        body: `You spent ${formatLedgerMoney(amount)} across ${rows.length} transaction${rows.length === 1 ? '' : 's'} in this category.`,
        facts: groupedCategoryMerchants(rows, request.category)
          .slice(0, 5)
          .map((item) => ({ label: item.key, value: formatLedgerMoney(item.totalFils) })),
        data: { totalFils: amount, transactionCount: rows.length, category: request.category },
      };
    }

    case 'merchant-breakdown': {
      const rows = spending.filter((tx) => normalize(tx.title) === normalize(request.merchant));
      const amount = total(rows);
      return {
        tool: request.tool,
        title: request.merchant,
        body: `You spent ${formatLedgerMoney(amount)} at ${request.merchant} across ${rows.length} transaction${rows.length === 1 ? '' : 's'}.`,
        data: { totalFils: amount, transactionCount: rows.length, merchant: request.merchant },
      };
    }

    case 'compare-periods': {
      const previous = previousPeriod(period);
      const prior = previous ? total(spendingRows(state, previous)) : 0;
      const current = total(spending);
      const delta = checkedMinorSum([current, -prior]);
      const pct = prior > 0 ? Math.round((Math.abs(delta) / prior) * 100) : null;
      const topCurrent = groupedCategoryTotals(spending);
      const topPrior = previous ? groupedCategoryTotals(spendingRows(state, previous)) : [];
      const priorByCategory = new Map(topPrior.map((item) => [item.key, item.totalFils] as const));
      const categoryChanges = topCurrent
        .map((item) => ({
          key: item.key,
          delta: checkedMinorSum([item.totalFils, -(priorByCategory.get(item.key) ?? 0)]),
        }))
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
      return {
        tool: request.tool,
        title: 'Spending change',
        body: prior === 0
          ? `You spent ${formatLedgerMoney(current)} this period. I do not have enough previous-period spending to make a reliable comparison.`
          : `You spent ${formatLedgerMoney(current)}, ${pct}% ${delta >= 0 ? 'more' : 'less'} than the previous period.`,
        facts: [
          { label: 'This period', value: formatLedgerMoney(current) },
          { label: 'Previous period', value: formatLedgerMoney(prior) },
          ...categoryChanges.slice(0, 3).map((item) => ({
            label: `${categoryLabel(item.key)} change`,
            value: `${item.delta >= 0 ? '+' : '−'}${formatLedgerMoney(Math.abs(item.delta))}`,
          })),
        ],
        data: { currentFils: current, previousFils: prior, deltaFils: delta, deltaPercent: pct },
      };
    }

    case 'top-merchants': {
      const groups = groupedTotals(spending, (tx) => tx.title.trim() || 'Unknown');
      const limit = Math.max(1, Math.min(request.limit ?? 5, 10));
      const top = groups.slice(0, limit);
      return {
        tool: request.tool,
        title: 'Top merchants',
        body: top.length
          ? `${top[0].key} is your biggest merchant in this period at ${formatLedgerMoney(top[0].totalFils)}.`
          : 'I do not see any spending in this period yet.',
        facts: top.map((item) => ({ label: item.key, value: formatLedgerMoney(item.totalFils) })),
        data: { merchantCount: groups.length, spendingFils: total(spending) },
      };
    }

    case 'top-categories': {
      const groups = groupedCategoryTotals(spending);
      const limit = Math.max(1, Math.min(request.limit ?? 5, 10));
      const top = groups.slice(0, limit);
      return {
        tool: request.tool,
        title: 'Top categories',
        body: top.length
          ? `${categoryLabel(top[0].key)} is your biggest spending category at ${formatLedgerMoney(top[0].totalFils)}.`
          : 'I do not see any spending in this period yet.',
        facts: top.map((item) => ({ label: categoryLabel(item.key), value: formatLedgerMoney(item.totalFils) })),
        data: { categoryCount: groups.length, spendingFils: total(spending) },
      };
    }

    case 'upcoming-payments': {
      const withinDays = Math.max(1, Math.min(request.withinDays ?? 30, 90));
      const items = leavingSoon(state, now, { withinDays });
      const amount = outgoingTotalFils(items);
      return {
        tool: request.tool,
        title: 'Upcoming payments',
        body: items.length
          ? `You have ${items.length} payment${items.length === 1 ? '' : 's'} due within ${withinDays} days, totaling ${formatLedgerMoney(amount)}.`
          : `I do not see any payments due within the next ${withinDays} days.`,
        facts: items.slice(0, 6).map((item) => ({ label: item.title, value: formatLedgerMoney(item.amountFils) })),
        data: { withinDays, paymentCount: items.length, totalFils: amount },
      };
    }

    case 'cash-outflow': {
      const { live, internal } = ledgerScope(state);
      const summary = summarizeCashOutflow(state, period, { live, internal });
      return {
        tool: request.tool,
        title: 'Cash out',
        body: `${formatLedgerMoney(summary.totalFils)} actually left your accounts in this period.`,
        facts: [
          { label: 'Card repayments', value: formatLedgerMoney(summary.cardPaymentsFils) },
          { label: 'Other account outflow', value: formatLedgerMoney(summary.accountOutflowFils) },
        ],
        data: {
          totalFils: summary.totalFils,
          cardPaymentsFils: summary.cardPaymentsFils,
          accountOutflowFils: summary.accountOutflowFils,
        },
      };
    }

    case 'month-forecast': {
      const spent = total(spending);
      const elapsed = elapsedDays(period, now, state.transactions);
      const days = daysInPeriod(period, now, state.transactions);
      const enoughData = period.mode === 'month' && elapsed >= 7 && elapsed * 2 >= days;
      const projectedCandidate = enoughData && elapsed > 0 ? Math.round((spent / elapsed) * days) : null;
      const projected = projectedCandidate !== null && Number.isSafeInteger(projectedCandidate)
        ? projectedCandidate
        : null;
      return {
        tool: request.tool,
        title: 'Month forecast',
        body: projected === null
          ? `You have spent ${formatLedgerMoney(spent)} so far. I need more of the month before a pace forecast is reliable.`
          : `At your current pace, you are on track to spend about ${formatLedgerMoney(projected)} this month.`,
        facts: [
          { label: 'Spent so far', value: formatLedgerMoney(spent) },
          ...(projected === null ? [] : [{ label: 'Projected total', value: formatLedgerMoney(projected) }]),
        ],
        data: { spentFils: spent, projectedFils: projected, elapsedDays: elapsed, periodDays: days },
      };
    }

    case 'income-total': {
      const amount = total(income);
      return {
        tool: request.tool,
        title: 'Income',
        body: `You received ${formatLedgerMoney(amount)} across ${income.length} income transaction${income.length === 1 ? '' : 's'}.`,
        data: { totalFils: amount, transactionCount: income.length },
      };
    }

    case 'spending-total':
    default: {
      const amount = total(spending);
      return {
        tool: 'spending-total',
        title: 'Spending',
        body: `You spent ${formatLedgerMoney(amount)} across ${spending.length} transaction${spending.length === 1 ? '' : 's'}.`,
        data: { totalFils: amount, transactionCount: spending.length },
      };
    }
  }
}

/**
 * Small English fallback parser used today. It is intentionally separate from
 * the deterministic executor: future language packs or a provider-neutral
 * interpreter replace only this planner and emit the same tool request union.
 * Language-specific vocabulary must not leak into financial calculations.
 */
export function planAssistantQuestion(
  state: AppState,
  question: string,
  now = new Date(),
): AssistantToolRequest {
  const q = normalize(question);
  const period = selectedPeriod(q, now);
  const spending = spendingRows(state, period);

  if (/subscription|subscriptions/.test(q)) return { tool: 'subscriptions' };
  if (/bill|bills|due|upcoming payment|what.*pay/.test(q)) {
    return { tool: 'upcoming-payments', withinDays: 30 };
  }
  if (/cash out|left my account|money out|actual outflow/.test(q)) {
    return { tool: 'cash-outflow', period };
  }
  if (/forecast|on track|end of (the )?month|projected/.test(q)) {
    return { tool: 'month-forecast', period };
  }
  if (/top(?: spending)? merchant|biggest merchant|where.*spend most|merchant.*most/.test(q)) {
    return { tool: 'top-merchants', period };
  }
  if (/top(?: spending)? categor|biggest categor|which categor/.test(q)) {
    return { tool: 'top-categories', period };
  }

  const category = categoryFromQuestion(q);
  if (category) return { tool: 'category-breakdown', period, category };

  const merchant = merchantFromQuestion(q, spending);
  if (merchant) return { tool: 'merchant-breakdown', period, merchant };

  if (/compare|more than|less than|increase|decrease|changed|why.*spend|vs|versus/.test(q)) {
    return { tool: 'compare-periods', period };
  }
  if (/income|salary|earned|received/.test(q)) {
    return { tool: 'income-total', period };
  }
  return { tool: 'spending-total', period };
}

export function answerWafraQuestion(
  state: AppState,
  question: string,
  now = new Date(),
): AssistantAnswer {
  return executeAssistantTool(state, planAssistantQuestion(state, question, now), now);
}

export function suggestedAssistantQuestions(state: AppState): string[] {
  const suggestions: string[] = [
    'How much did I spend this month?',
    'Why did my spending change?',
    'What are my top spending categories?',
  ];
  if (leavingSoon(state, new Date(), { withinDays: 30 }).length > 0) {
    suggestions.push('What payments are due soon?');
  }
  suggestions.push('What are my biggest subscriptions?');
  suggestions.push('What am I on track to spend this month?');
  const { live, internal } = ledgerScope(state);
  const topMerchant = state.transactions.find((tx) => isSpending(tx, live, internal))?.title;
  if (topMerchant) suggestions.splice(3, 0, `How much did I spend at ${topMerchant}?`);
  return suggestions.slice(0, 5);
}
