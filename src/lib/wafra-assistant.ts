import { categoryLabel } from '@/lib/categories';
import { summarizeCashOutflow } from '@/lib/cash-flow';
import { formatAED as formatLedgerMoney, toISODate } from '@/lib/format';
import { internalTransferIds, isSpending, liveAccountIds } from '@/lib/ledger';
import { checkedMinorSum } from '@/lib/ledger-money';
import { leavingSoon, outgoingTotalFils } from '@/lib/leaving-soon';
import {
  currentMonthPeriod,
  daysInPeriod,
  elapsedDays,
  inPeriod,
  periodLabel,
  previousPeriod,
  type Period,
} from '@/lib/period';
import { allocationsOf, amountInCategory } from '@/lib/splits';
import { activeSubscriptions, detectSubscriptions, trueSubscriptions } from '@/lib/subscriptions';
import type { AppState, CategoryId, Transaction } from '@/lib/types';

export type AssistantTool =
  | 'help'
  | 'spending-total'
  | 'income-total'
  | 'merchant-breakdown'
  | 'category-breakdown'
  | 'subscriptions'
  | 'compare-periods'
  | 'top-merchants'
  | 'top-categories'
  | 'largest-purchases'
  | 'daily-average'
  | 'net-income-spending'
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
  | { tool: 'help' }
  | { tool: 'spending-total'; period: Period }
  | { tool: 'income-total'; period: Period }
  | { tool: 'merchant-breakdown'; period: Period; merchant: string }
  | { tool: 'category-breakdown'; period: Period; category: CategoryId }
  | { tool: 'subscriptions' }
  | { tool: 'compare-periods'; period: Period }
  | { tool: 'top-merchants'; period: Period; limit?: number }
  | { tool: 'top-categories'; period: Period; limit?: number }
  | { tool: 'largest-purchases'; period: Period; limit?: number }
  | { tool: 'daily-average'; period: Period }
  | { tool: 'net-income-spending'; period: Period }
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

const normalizeMerchantText = (value: string) => value
  .normalize('NFKC')
  .toLocaleLowerCase('en-US')
  .replace(/[’'`]/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const MERCHANT_STOP_WORDS = new Set([
  'at', 'from', 'how', 'much', 'did', 'i', 'spend', 'spent', 'pay', 'paid', 'payment',
  'purchase', 'purchases', 'transaction', 'transactions', 'this', 'last', 'month', 'year',
  'today', 'yesterday', 'online', 'card', 'debit', 'credit',
]);

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
  const today = toISODate(now);
  const dayRange = (days: number): Period => {
    const from = new Date(now);
    from.setHours(12, 0, 0, 0);
    from.setDate(from.getDate() - Math.max(0, days - 1));
    return { mode: 'range', from: toISODate(from), to: today };
  };
  if (/\btoday\b/.test(question)) return { mode: 'range', from: today, to: today };
  if (/\byesterday\b/.test(question)) {
    const day = new Date(now);
    day.setDate(day.getDate() - 1);
    const iso = toISODate(day);
    return { mode: 'range', from: iso, to: iso };
  }
  const rollingDays = question.match(/(?:last|past)\s+(\d{1,2})\s+days?/);
  if (rollingDays) return dayRange(Math.max(1, Math.min(Number(rollingDays[1]), 90)));
  if (/\blast 7 days\b|\bpast week\b|\blast week\b/.test(question)) return dayRange(7);
  if (/\blast 30 days\b|\bpast 30 days\b/.test(question)) return dayRange(30);
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
  const months = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ];
  const namedMonth = months.findIndex((month) => new RegExp(`\\b${month}\\b`).test(question));
  if (namedMonth >= 0) {
    const yearMatch = question.match(/\b(20\d{2})\b/);
    const year = yearMatch ? Number(yearMatch[1]) : namedMonth > now.getMonth() ? currentYear - 1 : currentYear;
    return { mode: 'month', key: `${year}-${String(namedMonth + 1).padStart(2, '0')}` };
  }
  return current;
}

function merchantFromQuestion(question: string, rows: Transaction[]): string | null {
  const q = normalizeMerchantText(question);
  const titles = [...new Set(rows.map((tx) => tx.title.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  const exact = titles.find((title) => q.includes(normalizeMerchantText(title)));
  if (exact) return exact;

  // Bank descriptors often append a branch, city or processor suffix. Permit a
  // shorter user phrase only when it identifies exactly one stored merchant;
  // ambiguity is safer than silently choosing the wrong shop.
  const qTokens = new Set(q.split(' ').filter((token) => token.length >= 4 && !MERCHANT_STOP_WORDS.has(token)));
  if (qTokens.size === 0) return null;
  const candidates = titles.filter((title) => {
    const tokens = normalizeMerchantText(title).split(' ')
      .filter((token) => token.length >= 4 && !MERCHANT_STOP_WORDS.has(token));
    return tokens.some((token) => qTokens.has(token));
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function requestedLimit(question: string): number | undefined {
  const match = question.match(/\btop\s+(\d{1,2})\b/);
  if (!match) return undefined;
  return Math.max(1, Math.min(Number(match[1]), 10));
}

function requestedUpcomingDays(question: string): number {
  const match = question.match(/(?:next|within)\s+(\d{1,2})\s+days?/);
  if (match) return Math.max(1, Math.min(Number(match[1]), 90));
  if (/\bthis week\b|\bnext week\b/.test(question)) return 7;
  if (/\bnext month\b/.test(question)) return 30;
  return 30;
}

function hasExplicitPeriod(question: string): boolean {
  return /\b(?:today|yesterday|this month|last month|previous month|this year|current year|last year|previous year|all time|ever|since i started|last \d{1,2} days|past \d{1,2} days|past week|last week)\b/.test(question) ||
    /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+20\d{2})?\b/.test(question);
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
  const scope = periodLabel(period);
  const spending = spendingRows(state, period);
  const income = incomeRows(state, period);

  switch (request.tool) {
    case 'help':
      return {
        tool: request.tool,
        title: 'What you can ask',
        body: 'Ask Wafra about spending, income, merchants, categories, subscriptions, upcoming payments, cash outflow, period comparisons, daily averages, largest purchases, or a month forecast.',
        facts: [
          { label: 'Example', value: 'Why did my spending change?' },
          { label: 'Example', value: 'What was my biggest purchase?' },
          { label: 'Example', value: 'What is due in the next 7 days?' },
        ],
        data: {},
      };

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
        body: `In ${scope}, you spent ${formatLedgerMoney(amount)} across ${rows.length} transaction${rows.length === 1 ? '' : 's'} in this category.`,
        facts: groupedCategoryMerchants(rows, request.category)
          .slice(0, 5)
          .map((item) => ({ label: item.key, value: formatLedgerMoney(item.totalFils) })),
        data: { totalFils: amount, transactionCount: rows.length, category: request.category },
      };
    }

    case 'merchant-breakdown': {
      const rows = spending.filter((tx) => normalize(tx.title) === normalize(request.merchant));
      const amount = total(rows);
      const average = rows.length > 0 ? Math.round(amount / rows.length) : 0;
      const largest = rows.reduce((max, row) => Math.max(max, row.amountFils), 0);
      return {
        tool: request.tool,
        title: request.merchant,
        body: `In ${scope}, you spent ${formatLedgerMoney(amount)} at ${request.merchant} across ${rows.length} transaction${rows.length === 1 ? '' : 's'}.`,
        facts: rows.length ? [
          { label: 'Average purchase', value: formatLedgerMoney(average) },
          { label: 'Largest purchase', value: formatLedgerMoney(largest) },
        ] : [],
        data: { totalFils: amount, transactionCount: rows.length, averageFils: average, largestFils: largest, merchant: request.merchant },
      };
    }

    case 'compare-periods': {
      const previous = previousPeriod(period);
      const previousScope = previous ? periodLabel(previous) : null;
      const prior = previous ? total(spendingRows(state, previous)) : 0;
      const current = total(spending);
      const delta = checkedMinorSum([current, -prior]);
      const pct = prior > 0 ? Math.round((Math.abs(delta) / prior) * 100) : null;
      const topCurrent = groupedCategoryTotals(spending);
      const topPrior = previous ? groupedCategoryTotals(spendingRows(state, previous)) : [];
      const currentByCategory = new Map(topCurrent.map((item) => [item.key, item.totalFils] as const));
      const priorByCategory = new Map(topPrior.map((item) => [item.key, item.totalFils] as const));
      const categoryChanges = [...new Set([...currentByCategory.keys(), ...priorByCategory.keys()])]
        .map((key) => ({
          key,
          delta: checkedMinorSum([(currentByCategory.get(key) ?? 0), -(priorByCategory.get(key) ?? 0)]),
        }))
        .filter((item) => item.delta !== 0)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
      return {
        tool: request.tool,
        title: 'Spending change',
        body: prior === 0
          ? `You spent ${formatLedgerMoney(current)} in ${scope}. I do not have enough earlier spending to make a reliable comparison.`
          : `You spent ${formatLedgerMoney(current)} in ${scope}, ${pct}% ${delta >= 0 ? 'more' : 'less'} than ${previousScope}.`,
        facts: [
          { label: scope, value: formatLedgerMoney(current) },
          { label: previousScope ?? 'Previous period', value: formatLedgerMoney(prior) },
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
          ? `${top[0].key} is your biggest merchant in ${scope} at ${formatLedgerMoney(top[0].totalFils)}.`
          : `I do not see any spending in ${scope} yet.`,
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
          ? `${categoryLabel(top[0].key)} is your biggest spending category in ${scope} at ${formatLedgerMoney(top[0].totalFils)}.`
          : `I do not see any spending in ${scope} yet.`,
        facts: top.map((item) => ({ label: categoryLabel(item.key), value: formatLedgerMoney(item.totalFils) })),
        data: { categoryCount: groups.length, spendingFils: total(spending) },
      };
    }

    case 'largest-purchases': {
      const limit = Math.max(1, Math.min(request.limit ?? 5, 10));
      const rows = [...spending]
        .sort((a, b) => b.amountFils - a.amountFils || b.date.localeCompare(a.date))
        .slice(0, limit);
      return {
        tool: request.tool,
        title: 'Largest purchases',
        body: rows.length
          ? `Your largest purchase in ${scope} was ${formatLedgerMoney(rows[0].amountFils)} at ${rows[0].title}.`
          : `I do not see any spending in ${scope} yet.`,
        facts: rows.map((row) => ({ label: row.title, value: formatLedgerMoney(row.amountFils) })),
        data: {
          purchaseCount: spending.length,
          largestFils: rows[0]?.amountFils ?? 0,
        },
      };
    }

    case 'daily-average': {
      const spent = total(spending);
      const elapsed = elapsedDays(period, now, state.transactions);
      const average = elapsed > 0 ? Math.round(spent / elapsed) : 0;
      return {
        tool: request.tool,
        title: 'Daily average',
        body: `In ${scope}, you averaged ${formatLedgerMoney(average)} of spending per day across ${elapsed} day${elapsed === 1 ? '' : 's'}.`,
        facts: [
          { label: 'Total spending', value: formatLedgerMoney(spent) },
          { label: 'Days counted', value: String(elapsed) },
        ],
        data: { totalFils: spent, elapsedDays: elapsed, dailyAverageFils: average },
      };
    }

    case 'net-income-spending': {
      const spent = total(spending);
      const received = total(income);
      const net = checkedMinorSum([received, -spent]);
      return {
        tool: request.tool,
        title: 'Income minus spending',
        body: net >= 0
          ? `In ${scope}, income was ${formatLedgerMoney(net)} higher than spending.`
          : `In ${scope}, spending was ${formatLedgerMoney(Math.abs(net))} higher than income.`,
        facts: [
          { label: 'Income', value: formatLedgerMoney(received) },
          { label: 'Spending', value: formatLedgerMoney(spent) },
          { label: 'Difference', value: `${net >= 0 ? '+' : '−'}${formatLedgerMoney(Math.abs(net))}` },
        ],
        data: { incomeFils: received, spendingFils: spent, netFils: net },
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
        facts: items.slice(0, 6).map((item) => ({
          label: `${item.title} · ${item.daysLeft < 0 ? `${Math.abs(item.daysLeft)}d late` : item.daysLeft === 0 ? 'today' : `in ${item.daysLeft}d`}`,
          value: formatLedgerMoney(item.amountFils),
        })),
        data: { withinDays, paymentCount: items.length, totalFils: amount },
      };
    }

    case 'cash-outflow': {
      const { live, internal } = ledgerScope(state);
      const summary = summarizeCashOutflow(state, period, { live, internal });
      return {
        tool: request.tool,
        title: 'Cash out',
        body: `${formatLedgerMoney(summary.totalFils)} actually left your accounts in ${scope}.`,
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
      const sources = groupedTotals(income, (tx) => tx.title.trim() || 'Unknown');
      return {
        tool: request.tool,
        title: 'Income',
        body: `In ${scope}, you received ${formatLedgerMoney(amount)} across ${income.length} income transaction${income.length === 1 ? '' : 's'}.`,
        facts: sources.slice(0, 3).map((item) => ({ label: item.key, value: formatLedgerMoney(item.totalFils) })),
        data: { totalFils: amount, transactionCount: income.length, sourceCount: sources.length },
      };
    }

    case 'spending-total':
    default: {
      const amount = total(spending);
      const categories = groupedCategoryTotals(spending);
      const average = spending.length > 0 ? Math.round(amount / spending.length) : 0;
      return {
        tool: 'spending-total',
        title: 'Spending',
        body: `In ${scope}, you spent ${formatLedgerMoney(amount)} across ${spending.length} transaction${spending.length === 1 ? '' : 's'}.`,
        facts: [
          ...(categories[0] ? [{ label: 'Top category', value: `${categoryLabel(categories[0].key)} · ${formatLedgerMoney(categories[0].totalFils)}` }] : []),
          ...(spending.length ? [{ label: 'Average transaction', value: formatLedgerMoney(average) }] : []),
        ],
        data: { totalFils: amount, transactionCount: spending.length, averageTransactionFils: average },
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
  previousRequest?: AssistantToolRequest | null,
): AssistantToolRequest {
  const q = normalize(question);
  const period = previousRequest && 'period' in previousRequest && !hasExplicitPeriod(q)
    ? previousRequest.period
    : selectedPeriod(q, now);
  const limit = requestedLimit(q);

  if (previousRequest && /^(?:and\s+)?(?:what about|how about)\s+(?:last month|previous month|this month|today|yesterday|last \d{1,2} days)\??$/.test(q)) {
    if ('period' in previousRequest) return { ...previousRequest, period };
  }

  if (/^(?:help|what can (?:you|wafra) do|what can i ask|how does this work)\??$/.test(q)) {
    return { tool: 'help' };
  }
  if (/subscription|subscriptions/.test(q)) return { tool: 'subscriptions' };
  if (/bill|bills|due|upcoming payment|what.*pay/.test(q)) {
    return { tool: 'upcoming-payments', withinDays: requestedUpcomingDays(q) };
  }
  if (/cash out|left my account|money out|actual outflow/.test(q)) {
    return { tool: 'cash-outflow', period };
  }
  if (/forecast|on track|end of (the )?month|projected/.test(q)) {
    return { tool: 'month-forecast', period };
  }
  if (/biggest purchase|largest purchase|largest transaction|most expensive purchase/.test(q)) {
    return { tool: 'largest-purchases', period, ...(limit ? { limit } : { limit: 5 }) };
  }
  if (/per day|daily average|average daily|spend.*daily|spend.*each day/.test(q)) {
    return { tool: 'daily-average', period };
  }
  if (/income minus spending|spend more than i earned|spent more than i earned|more than i earn|what.*net|net spending|net cashflow/.test(q)) {
    return { tool: 'net-income-spending', period };
  }
  if (/top(?:\s+\d{1,2})?(?: spending)? merchants?|biggest merchant|where.*spend most|merchant.*most/.test(q)) {
    return { tool: 'top-merchants', period, ...(limit ? { limit } : {}) };
  }
  if (/top(?:\s+\d{1,2})?(?: spending)? categor|biggest categor|which categor/.test(q)) {
    return { tool: 'top-categories', period, ...(limit ? { limit } : {}) };
  }

  // Search the whole ledger for a merchant name so "Talabat last month" still
  // answers Talabat=0 instead of falling back to total spending when Talabat
  // happened to have no rows in the selected month.
  const merchant = merchantFromQuestion(q, state.transactions);
  if (merchant) return { tool: 'merchant-breakdown', period, merchant };

  const category = categoryFromQuestion(q);
  if (category) return { tool: 'category-breakdown', period, category };

  if (/compare|more than|less than|increase|decrease|changed|why.*spend|vs|versus/.test(q)) {
    return { tool: 'compare-periods', period };
  }
  if (/income|salary|earned|received/.test(q)) {
    return { tool: 'income-total', period };
  }
  if (/spend|spent|spending|expense|expenses|purchase|purchases|paid|cost me/.test(q)) {
    return { tool: 'spending-total', period };
  }
  return { tool: 'help' };
}

export function answerWafraQuestion(
  state: AppState,
  question: string,
  now = new Date(),
  previousRequest?: AssistantToolRequest | null,
): AssistantAnswer {
  return executeAssistantTool(state, planAssistantQuestion(state, question, now, previousRequest), now);
}

export function runWafraAssistant(
  state: AppState,
  question: string,
  now = new Date(),
  previousRequest?: AssistantToolRequest | null,
): { request: AssistantToolRequest; answer: AssistantAnswer } {
  const request = planAssistantQuestion(state, question, now, previousRequest);
  return { request, answer: executeAssistantTool(state, request, now) };
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
  const current = currentMonthPeriod(new Date());
  const topMerchant = groupedTotals(spendingRows(state, current), (tx) => tx.title.trim() || 'Unknown')[0]?.key;
  if (topMerchant) suggestions.splice(3, 0, `How much did I spend at ${topMerchant}?`);
  return suggestions.slice(0, 5);
}

/** Lightweight local follow-ups; they carry no ledger data and need no model. */
export function assistantFollowUpQuestions(): string[] {
  return [
    'What about last month?',
    'Top 3 merchants',
    'What is due in the next 7 days?',
  ];
}
