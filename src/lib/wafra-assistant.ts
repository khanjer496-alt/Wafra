import { categoryLabel } from '@/lib/categories';
import { cardPaymentRows } from '@/lib/cards';
import { summarizeCashOutflow } from '@/lib/cash-flow';
import { formatAED as formatLedgerMoney, getMonthStartDay, monthEndISO, toISODate } from '@/lib/format';
import { internalTransferIds, isIncome, isSpending, liveAccountIds } from '@/lib/ledger';
import { checkedMinorSum } from '@/lib/ledger-money';
import { leavingSoon, outgoingTotalFils } from '@/lib/leaving-soon';
import {
  currentMonthPeriod,
  comparablePreviousPeriod,
  isCurrentMonth,
  periodStartISO,
  periodEndISO,
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
export interface AssistantFilters {
  accountIds?: string[];
  merchant?: string;
  category?: CategoryId;
}

export type AssistantToolRequest =
  | { tool: 'help'; clarification?: string; suggestions?: string[] }
  | (AssistantFilters & (
  | { tool: 'spending-total'; period: Period }
  | { tool: 'income-total'; period: Period }
  | { tool: 'merchant-breakdown'; period: Period; merchant: string }
  | { tool: 'category-breakdown'; period: Period; category: CategoryId }
  | { tool: 'compare-periods'; period: Period; comparisonPeriod?: Period }
  | { tool: 'top-merchants'; period: Period; limit?: number }
  | { tool: 'top-categories'; period: Period; limit?: number }
  | { tool: 'largest-purchases'; period: Period; limit?: number }
  | { tool: 'daily-average'; period: Period }
  | { tool: 'net-income-spending'; period: Period }
  | { tool: 'cash-outflow'; period: Period }
  | { tool: 'month-forecast'; period: Period }))
  | { tool: 'subscriptions' }
  | { tool: 'upcoming-payments'; withinDays?: number };

export interface AssistantEvidence {
  label: string;
  /** Preserve executor ranking for a displayed subset such as largest purchases. */
  ordered?: boolean;
  from?: string;
  to?: string;
  transactionIds: string[];
  /** Exact included minor units, including split-category allocations. */
  contributions?: Record<string, number>;
  /** Cash movement attribution can differ from the stored card receipt. */
  effectiveDates?: Record<string, string>;
  effectiveAccountNames?: Record<string, string>;
  totalFils: number;
  accountNames: string[];
}

export interface AssistantAnswer {
  tool: AssistantTool;
  title: string;
  body: string;
  facts?: { label: string; value: string }[];
  evidence?: AssistantEvidence[];
  suggestions?: string[];
  destination?: '/bills';
  showEvidence?: boolean;
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
  return state.transactions.filter((tx) => inPeriod(tx.date, period) && isIncome(tx, live, internal));
}

function total(rows: Transaction[]): number {
  return checkedMinorSum(rows.map((tx) => tx.amountFils));
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_PATTERN = MONTHS.join('|');
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const containsPhrase = (text: string, phrase: string) =>
  (` ${normalizeMerchantText(text)} `).includes(` ${normalizeMerchantText(phrase)} `);

function clarification(body: string, suggestions?: string[]): AssistantToolRequest {
  return { tool: 'help', clarification: body, ...(suggestions?.length ? { suggestions } : {}) };
}

function validISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function calendarMonth(month: number, year: number): Period {
  const key = `${year}-${String(month + 1).padStart(2, '0')}`;
  if (getMonthStartDay() === 1) return { mode: 'month', key };
  // A named calendar month means those calendar dates, even when the user's
  // selected reporting period follows a different salary-day boundary.
  return { mode: 'range', from: `${key}-01`, to: toISODate(new Date(year, month + 1, 0, 12)) };
}

interface ParsedPeriods { periods: Period[]; rest: string; error?: string }
function parsePeriods(question: string, now: Date): ParsedPeriods {
  const found: { index: number; period: Period }[] = [];
  let rest = question;
  let error: string | undefined;
  const consume = (pattern: RegExp, parse: (match: RegExpExecArray) => Period | null) => {
    for (const match of [...rest.matchAll(pattern)]) {
      const period = parse(match);
      if (!period) error = 'I could not resolve that date range. Use exact dates such as 2026-08-01 to 2026-08-31.';
      else found.push({ index: match.index!, period });
      rest = rest.slice(0, match.index!) + ' '.repeat(match[0].length) + rest.slice(match.index! + match[0].length);
    }
  };
  const range = (from: string, to: string): Period | null => validISODate(from) && validISODate(to) && from <= to
    ? { mode: 'range', from, to } : null;
  consume(/\b(?:from\s+|between\s+)?(\d{4}-\d{2}-\d{2})\s+(?:to|through|until|and|[–—-])\s+(\d{4}-\d{2}-\d{2})\b/g,
    (m) => range(m[1], m[2]));
  consume(new RegExp(`\\b(?:from\\s+|between\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})(?:\\s+(\\d{4}))?\\s+(?:to|through|and|[–—-])\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})(?:\\s+(\\d{4}))?\\b`, 'g'), (m) => {
    const first = MONTHS.indexOf(m[2]), last = MONTHS.indexOf(m[5]);
    const year = m[6] ? +m[6] : m[3] ? +m[3] : now.getFullYear();
    return range(`${m[3] || year}-${String(first + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`,
      `${year}-${String(last + 1).padStart(2, '0')}-${m[4].padStart(2, '0')}`);
  });
  consume(new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:to|through|[–—-])\\s*(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'g'), (m) => {
    const month = MONTHS.indexOf(m[1]);
    const year = m[4] ? +m[4] : month > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear();
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
    return range(prefix + m[2].padStart(2, '0'), prefix + m[3].padStart(2, '0'));
  });
  consume(new RegExp(`\\b(?:from\\s+|between\\s+)?(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\s+(?:to|through|and|[–—-])\\s+(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'g'), (m) => {
    const first = MONTHS.indexOf(m[1]), last = MONTHS.indexOf(m[4]);
    const year = m[6] ? +m[6] : m[3] ? +m[3] : now.getFullYear();
    return range(`${m[3] || year}-${String(first + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`,
      `${year}-${String(last + 1).padStart(2, '0')}-${m[5].padStart(2, '0')}`);
  });
  consume(/\b\d{4}-\d{2}-\d{2}\b/g, (m) => range(m[0], m[0]));
  consume(new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'g'), (m) => {
    const month = MONTHS.indexOf(m[1]);
    const year = m[3] ? +m[3] : month > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear();
    const day = `${year}-${String(month + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    return range(day, day);
  });
  consume(/\b(?:last|past)\s+(\d+)\s+days?\b/g, (m) => {
    const days = Number(m[1]);
    if (days < 1 || days > 90) return null;
    const from = new Date(now); from.setDate(from.getDate() - days + 1);
    return range(toISODate(from), toISODate(now));
  });
  consume(/\b(?:today|yesterday|this month|current month|last month|previous month|this year|current year|last year|previous year|all time|ever|since i started|past week|last week)\b/g, (m) => {
    const phrase = m[0];
    if (/all time|ever|since/.test(phrase)) return { mode: 'all' };
    if (/year/.test(phrase)) return { mode: 'year', year: now.getFullYear() - (/last|previous/.test(phrase) ? 1 : 0) };
    if (/month/.test(phrase)) return /last|previous/.test(phrase)
      ? previousPeriod(currentMonthPeriod(now)) : currentMonthPeriod(now);
    if (phrase === 'last week') {
      const end = new Date(now); end.setDate(end.getDate() - ((end.getDay() + 6) % 7) - 1);
      const start = new Date(end); start.setDate(start.getDate() - 6);
      return range(toISODate(start), toISODate(end));
    }
    const start = new Date(now);
    start.setDate(start.getDate() - (phrase === 'past week' ? 6 : phrase === 'yesterday' ? 1 : 0));
    return range(toISODate(start), phrase === 'past week' ? toISODate(now) : toISODate(start));
  });
  consume(new RegExp(`\\b(${MONTH_PATTERN})(?:\\s+(\\d{4}))?\\b`, 'g'), (m) => {
    const month = MONTHS.indexOf(m[1]);
    const year = m[2] ? Number(m[2]) : month > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear();
    return calendarMonth(month, year);
  });
  if (/\b(?:before|after|since|until|between|quarter|fortnight|weekend|weeks|months|years|next|tomorrow|week|during)\b|\d[/-]\d|\b\d{4}\b/.test(rest)) {
    error = 'I need a clearer date range for that question. Try exact dates such as 2026-08-01 to 2026-08-31.';
  }
  return { periods: found.sort((a, b) => a.index - b.index).map((item) => item.period), rest, error };
}

function requestedLimit(question: string): number | undefined {
  const match = question.match(/\btop\s+(\d+)\b/);
  return match ? Number(match[1]) : undefined;
}

const CATEGORY_ALIASES: [RegExp, CategoryId][] = [
    [/\b(?:dining|restaurants?|food|eating out)\b/, 'dining'],
    [/\bother\b/, 'other'],
    [/\b(?:grocery|groceries|supermarkets?)\b/, 'groceries'],
    [/\b(?:transport|taxi)\b/, 'transport'], [/\bshopping\b/, 'shopping'],
    [/\b(?:software|apps)\b/, 'software'], [/\b(?:utilities|electricity|water)\b/, 'utilities'],
    [/\b(?:telecom|phone|mobile)\b/, 'telecom'], [/\brent\b/, 'rent'],
    [/\b(?:travel|flights?|hotels?)\b/, 'travel'], [/\b(?:entertainment|movies|gaming)\b/, 'entertainment'],
    [/\b(?:health|doctor|clinic|pharmacy|medical)\b/, 'health'],
    [/\b(?:personal care|salon|barber|spa|grooming)\b/, 'personal-care'],
    [/\b(?:home services?|cleaning|maintenance|maid)\b/, 'home-services'],
    [/\b(?:education|school|university|course)\b/, 'education'],
    [/\b(?:charity|donation)\b/, 'charity'], [/\b(?:government|visa|traffic fine)\b/, 'government'],
    [/\b(?:loan|instalment|installment)\b/, 'loan'],
    [/\b(?:investing|investment|broker|crypto)\b/, 'investing'],
    [/\b(?:cash withdrawal|atm)\b/, 'cash-withdrawal'],
  ];

function categoriesFromQuestion(question: string): CategoryId[] {
  return CATEGORY_ALIASES.filter(([pattern]) => pattern.test(question)).map(([, category]) => category);
}

/** A bounded grammar: every meaningful token must be consumed, not ignored. */
function hasUnsupportedRemainder(question: string): boolean {
  let rest = question;
  for (const [pattern] of CATEGORY_ALIASES) rest = rest.replace(new RegExp(pattern.source, 'g'), ' ');
  rest = rest.replace(/\bcash out\b|\bleft my accounts?\b|\bmoney out\b|\bactual outflow\b|\bon track\b|\bend of (?:the )?month\b|\bper day\b|\bdaily average\b|\baverage daily\b|\beach day\b|\b(?:spend|spending) daily\b/g, ' ');
  const grammar = new Set(('how much money did do does i my me we our you your the a an what which are is was were have has had am at from of for on in to with by about than this that these those all total recorded spending spend spent expense expenses purchase purchases transaction transactions pay paid payment payments cost costs net income salary business earned earn received receive more less minus forecast projected biggest largest most expensive top merchants merchant categories category why compare comparison versus vs increase increased decrease decreased change changed show previous period').split(' '));
  return normalizeMerchantText(rest).split(' ').some((token) => token && !grammar.has(token) && !/^\d+$/.test(token));
}

function resolveMerchant(phrase: string, rows: Transaction[]): { merchant?: string; candidates?: string[] } {
  const normalized = normalizeMerchantText(phrase);
  const titles = [...new Set(rows.map((tx) => tx.title.trim()).filter(Boolean))];
  const exact = titles.filter((title) => normalizeMerchantText(title) === normalized);
  if (exact.length === 1) return { merchant: exact[0] };
  const candidates = exact.length ? exact : titles.filter((title) => containsPhrase(title, phrase));
  return candidates.length === 1 ? { merchant: candidates[0] } : { candidates };
}

function filterRows(rows: Transaction[], filters: AssistantFilters): Transaction[] {
  return rows.filter((row) => (!filters.accountIds || filters.accountIds.includes(row.accountId)) &&
    (!filters.merchant || normalize(row.title) === normalize(filters.merchant)))
    .flatMap((row) => {
      if (!filters.category) return [row];
      const contribution = amountInCategory(row, filters.category);
      return contribution > 0 ? [{ ...row, amountFils: contribution, category: filters.category, splits: undefined }] : [];
    });
}

function scopeDates(period: Period, state: AppState, now: Date): { from?: string; to?: string } {
  const from = periodStartISO(period, state.transactions);
  const to = period.mode === 'month' ? monthEndISO(period.key)
    : period.mode === 'year' ? monthEndISO(`${period.year}-12`)
    : period.mode === 'range' ? period.to : periodEndISO(period, now);
  return { ...(from ? { from } : {}), to };
}

function comparisonPrimaryPeriod(request: AssistantToolRequest & { period: Period }, now: Date, state: AppState): Period {
  if (request.tool !== 'compare-periods' || request.comparisonPeriod) return request.period;
  const dates = scopeDates(request.period, state, now);
  const from = dates.from;
  const today = toISODate(now);
  const to = dates.to && dates.to < today ? dates.to : today;
  return from && from <= to ? { mode: 'range', from, to } : request.period;
}

function effectiveComparisonPeriod(request: AssistantToolRequest, now: Date, state: AppState): Period | null {
  return request.tool === 'compare-periods'
    ? request.comparisonPeriod ?? comparablePreviousPeriod(request.period, now, state.transactions) : null;
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

function executeAssistantToolResult(
  state: AppState,
  request: AssistantToolRequest,
  now = new Date(),
): AssistantAnswer {
  const period = 'period' in request ? comparisonPrimaryPeriod(request, now, state) : currentMonthPeriod(now);
  const scope = periodLabel(period);
  const filters = 'period' in request ? request : {};
  const spending = filterRows(spendingRows(state, period), filters);
  const income = filterRows(incomeRows(state, period), filters);

  switch (request.tool) {
    case 'help':
      return {
        tool: request.tool,
        title: request.clarification ? 'Let’s clarify that' : 'What you can ask',
        body: request.clarification ?? 'Ask Wafra about spending, income, merchants, categories, subscriptions, upcoming payments, cash outflow, period comparisons, daily averages, largest purchases, or a month forecast.',
        suggestions: request.suggestions ?? ['How much did I spend?', 'Why did my spending change?', 'What payments are due soon?'],
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
      const previous = effectiveComparisonPeriod(request, now, state);
      const previousScope = previous ? periodLabel(previous) : null;
      const prior = previous ? total(filterRows(spendingRows(state, previous), filters)) : 0;
      const current = total(spending);
      const delta = checkedMinorSum([current, -prior]);
      const pct = prior > 0 ? Math.round((Math.abs(delta) / prior) * 100) : null;
      const topCurrent = groupedCategoryTotals(spending);
      const topPrior = previous ? groupedCategoryTotals(filterRows(spendingRows(state, previous), filters)) : [];
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
          displayedPurchaseCount: rows.length,
          displayedTotalFils: total(rows),
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
      const summary = summarizeCashOutflow(state, period, { live: request.accountIds ? new Set(request.accountIds.filter((id) => live.has(id))) : live, internal });
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
      const dates = spending.map((row) => row.date).sort();
      const start = periodStartISO(period, state.transactions);
      const oldestRecorded = state.transactions.map((row) => row.date).sort()[0];
      const hasObservedSpan = new Set(dates).size >= 3 && oldestRecorded <= start && dates[dates.length - 1] >= toISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3, 12));
      const enoughData = isCurrentMonth(period, now) && elapsed >= 7 && elapsed * 2 >= days && hasObservedSpan;
      const projectedCandidate = enoughData && elapsed > 0 ? Math.round((spent / elapsed) * days) : null;
      const projected = projectedCandidate !== null && Number.isSafeInteger(projectedCandidate)
        ? projectedCandidate
        : null;
      return {
        tool: request.tool,
        title: 'Month forecast',
        body: projected === null
          ? `Recorded spending in ${scope} is ${formatLedgerMoney(spent)}. ${isCurrentMonth(period, now) ? "The recorded dates do not provide enough recent coverage for a useful pace estimate." : "A pace estimate is available only for the current reporting month."}`
          : `If the recorded pace continues, estimated spending for ${scope} is about ${formatLedgerMoney(projected)}. Missing transactions or one-off purchases can change this estimate.`,
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

/** Execute locally, then attach the exact rows used by that calculation. */
export function executeAssistantTool(state: AppState, request: AssistantToolRequest, now = new Date()): AssistantAnswer {
  if ('period' in request && request.accountIds) {
    const live = liveAccountIds(state.accounts);
    if (!request.accountIds.length || request.accountIds.some((id) => !live.has(id))) {
      return executeAssistantToolResult(state, clarification('I could not identify every requested account. Use its exact name from Accounts.'), now);
    }
  }
  if (request.tool === 'net-income-spending' && (request.category || request.merchant)) {
    return executeAssistantToolResult(state, clarification('Income and spending use different categories and sources. Ask for the overall difference, optionally for one account.'), now);
  }
  const answer = executeAssistantToolResult(state, request, now);
  if (request.tool === 'help') return answer;
  if (request.tool === 'subscriptions' || request.tool === 'upcoming-payments') return {
    ...answer,
    body: `${answer.body} ${request.tool === 'subscriptions' ? 'These are estimates from recurring recorded charges; actual renewals may differ.' : 'Includes recorded bills and predicted recurring charges; amounts or dates may change.'}`,
    destination: '/bills',
  };
  const period = comparisonPrimaryPeriod(request, now, state);
  const dates = scopeDates(period, state, now);
  const evidence = (label: string, rows: Transaction[], period = comparisonPrimaryPeriod(request, now, state)): AssistantEvidence => ({
    label, ...scopeDates(period, state, now), transactionIds: rows.map((row) => row.id),
    contributions: Object.fromEntries(rows.map((row) => [row.id, row.amountFils])),
    totalFils: total(rows),
    accountNames: [...new Set(rows.map((row) => state.accounts.find((account) => account.id === row.accountId)?.name ?? 'Unassigned'))],
  });
  const spending = filterRows(spendingRows(state, period), request);
  const income = filterRows(incomeRows(state, period), request);
  let groups: AssistantEvidence[];
  if (request.tool === 'cash-outflow') {
    const { live, internal } = ledgerScope(state);
    const summary = summarizeCashOutflow(state, request.period, { live: request.accountIds ? new Set(request.accountIds.filter((id) => live.has(id))) : live, internal });
    const canonical = new Map(cardPaymentRows(state).map((row) => [row.id, row]));
    const rows = state.transactions.filter((row) => summary.transactionIds.has(row.id)).map((row) => {
      const settlement = canonical.get(row.id);
      return settlement ? { ...settlement, accountId: settlement.cashOutAccountId ?? settlement.accountId } : row;
    });
    groups = [{
      ...evidence('Cash out', rows),
      effectiveDates: Object.fromEntries(rows.map((row) => [row.id, row.cashOutDate ?? row.date])),
      effectiveAccountNames: Object.fromEntries(rows.map((row) => [row.id, state.accounts.find((account) => account.id === row.accountId)?.name ?? 'Unassigned'])),
    }];
  } else if (request.tool === 'income-total') groups = [evidence('Income', income)];
  else if (request.tool === 'net-income-spending') groups = [evidence('Income', income), evidence('Spending', spending)];
  else if (request.tool === 'compare-periods') {
    const previous = effectiveComparisonPeriod(request, now, state);
    groups = [evidence('First period', spending), ...(previous ? [evidence('Comparison period', filterRows(spendingRows(state, previous), request), previous)] : [])];
  } else if (request.tool === 'largest-purchases') {
    const shown = [...spending].sort((a, b) => b.amountFils - a.amountFils || b.date.localeCompare(a.date))
      .slice(0, Math.max(1, Math.min(request.limit ?? 5, 10)));
    groups = [{ ...evidence('Largest purchases shown', shown), ordered: true }];
  } else groups = [evidence(request.tool === 'top-merchants' ? 'All spending used to rank merchants'
    : request.tool === 'top-categories' ? 'All spending used to rank categories'
      : request.category ? categoryLabel(request.category, 'en') : 'Spending', spending)];
  const qualifier = [request.merchant ? `Merchant: ${request.merchant}.` : '',
    request.category ? `Category: ${categoryLabel(request.category, 'en')}.` : '',
    request.accountIds ? `Accounts: ${state.accounts.filter((account) => request.accountIds!.includes(account.id)).map((account) => account.name).join(', ')}.` : '',
  ].filter(Boolean).join(' ');
  const scope = dates.from ? `${dates.from} to ${dates.to}` : `through ${dates.to}`;
  const previousDates = request.tool === 'compare-periods' ? groups[1] : undefined;
  const comparisonScope = previousDates ? ` Comparison: ${previousDates.from} to ${previousDates.to}.` : '';
  return { ...answer, body: `${answer.body} ${qualifier ? `${qualifier} ` : ''}Period: ${scope}.${comparisonScope} Based on recorded transactions; missing imports may change these figures.`, evidence: groups };
}

/** English-first planner. Unsupported restrictions never become broader totals. */
export function planAssistantQuestion(
  state: AppState,
  question: string,
  now = new Date(),
  previousRequest?: AssistantToolRequest | null,
  defaultPeriod?: Period,
): AssistantToolRequest {
  let q = normalize(question);
  if (!q || q.length > 1000) return clarification('Ask one short question about your recorded spending, income, or payments.');
  // Remove explicit merchant and account names before recognizing date/category
  // words, so "May Cafe", "Current Account" and "Rent a Car" remain identities.
  const quoted = q.match(/\b(?:at|from)\s+("(?:[^"\\]|\\.)*")/);
  let merchantPhrase: string | undefined;
  if (quoted) {
    try { merchantPhrase = JSON.parse(quoted[1]) as string; } catch { return clarification('Please check the merchant name.'); }
    q = q.replace(quoted[0], ' ');
  }
  if (/^(?:help|what can (?:you|wafra) do|what can i ask|how does this work)\??$/.test(q)) return { tool: 'help' };
  if (/\b(?:afford|should i|can i|budget left|safe to spend|balance|save|saving|recommend|refund|exclude|excluding|except|without|not including|over\s+\d|under\s+\d|above\s+\d|below\s+\d)\b/.test(q)) {
    return clarification('I can explain recorded spending and income, but cannot reliably answer that condition. Try a spending total or an income comparison.');
  }
  const limit = requestedLimit(q);
  if (limit !== undefined && (limit < 1 || limit > 10)) return clarification('Choose between 1 and 10 results.');
  if (/^show (?:me )?(?:(?:those|the|matching) )?transactions[?!.]?$/.test(q)) {
    return previousRequest && 'period' in previousRequest ? previousRequest : clarification('Ask about a spending or income period first, then show its matching transactions.');
  }
  const followUp = /^(?:and\b|what about\b|how about\b|compare with\b|top\b|show\b)/.test(q);
  const prior = previousRequest && 'period' in previousRequest ? previousRequest : undefined;
  let filters: AssistantFilters = followUp && prior ? {
    ...(prior.accountIds ? { accountIds: prior.accountIds } : {}),
    ...(prior.merchant ? { merchant: prior.merchant } : {}),
    ...(prior.category ? { category: prior.category } : {}),
  } : {};

  const isIncomeQuestion = /\b(?:income|salary|earned|received|receive|earn)\b/.test(q);
  const net = /income minus spending|spen[dt] more than i earned|more than i earn|what.*net|net spending|net cashflow/.test(q);
  const comparison = !net && /\b(?:compare|more than|less than|increase|decrease|change|changed|vs|versus)\b|why.*spend/.test(q);
  const live = liveAccountIds(state.accounts);
  const accountMatches = state.accounts.filter((account) => live.has(account.id) &&
    new RegExp(`\\b(?:from|in|on|using|with)\\s+(?:my\\s+)?${escapeRegExp(normalize(account.name))}(?:\\s+(?:account|card))?\\b|\\b${escapeRegExp(normalize(account.name))}\\s+(?:account|card)\\b`).test(q));
  if (accountMatches.length > 1) return clarification('Please name one account for this question.');
  if (accountMatches.length === 1) {
    const account = accountMatches[0];
    if (state.accounts.filter((candidate) => live.has(candidate.id) && normalize(candidate.name) === normalize(account.name)).length > 1) return clarification('More than one account has that name. Give those accounts distinct names before filtering by name.');
    filters.accountIds = [account.id];
    q = q.replace(new RegExp(`(?:from|in|on|using|with)\\s+(?:my\\s+)?${escapeRegExp(normalize(account.name))}(?:\\s+(?:account|card))?|${escapeRegExp(normalize(account.name))}\\s+(?:account|card)`, 'g'), ' ');
  }
  if (/\b(?:my|the|a|an)\s+(?:\w+\s+)?(?:account|card)\b|\b(?:account|card)\s+\d+\b/.test(q) && !/left my account/.test(q)) {
    return clarification('I could not identify that account. Use its exact name from Accounts.');
  }
  const upcoming = /\b(?:due|upcoming|bills?)\b/.test(q) && !/\b(?:paid|spent|did|last|previous)\b/.test(q);
  const subscriptions = /\b(?:subscriptions?|recurring charges?|renewals?)\b/.test(q) && !/\b(?:paid|spent|did|last|previous|change|changed|increase|decrease|compare)\b/.test(q);
  if (upcoming || subscriptions) {
    if (/\b(?:this week|next week|next month)\b/.test(q)) return clarification('Use a specific upcoming window, such as payments due within the next 7 days.');
    const windowless = q.replace(/\b(?:next|within)\s+\d+\s+days?\b/g, ' ');
    const futurePeriods = parsePeriods(windowless, now);
    if (futurePeriods.error || futurePeriods.periods.length || categoriesFromQuestion(q).length || Object.keys(filters).length || merchantPhrase || /\bat\b|\b(?:since|before|after|yesterday|today|this month|this year|last|past|in\s+\d|on\s+\d)\b/.test(q)) {
      return clarification('I can show the overall upcoming payments or active subscriptions. A filtered historical view is not supported for those estimates.');
    }
    const match = q.match(/\b(?:next|within)\s+(\d+)\s+days?\b/);
    const withinDays = match ? Number(match[1]) : /this week|next week/.test(q) ? 7 : 30;
    if (withinDays < 1 || withinDays > 90) return clarification('Use an upcoming window between 1 and 90 days.');
    if (subscriptions) {
      const remaining = q.replace(/\b(?:what|which|are|is|my|the|active|biggest|all|subscriptions|subscription|recurring|charges|charge|renewal|renewals|monthly|total|cost|how|much|do|i|pay|for|have)\b/g, '').replace(/[?!.\s]/g, '');
      if (remaining) return clarification('I can show all active subscription estimates. Filtering subscriptions by a specific service is not available yet.');
      return { tool: 'subscriptions' };
    }
    const remaining = q.replace(/\b(?:what|which|when|are|is|my|the|all|payments|payment|bills|bill|due|upcoming|soon|in|within|next|days|day|how|much|do|i|have|to|pay)\b/g, '').replace(/[?!.\s\d]/g, '');
    if (remaining) return clarification('I can show all upcoming payments within a number of days. Filtering those estimates by service is not available yet.');
    return { tool: 'upcoming-payments', withinDays };
  }
  if (/\bbills?\b/.test(q)) return clarification('I can show upcoming bills. For past spending, name a merchant or category and a date range.');
  if (/\b(?:subscriptions?|recurring charges?|renewals?)\b/.test(q)) return clarification('I can show active subscription estimates. Comparing changes in recurring charges is not available yet.');

  // Exact titles without an "at" phrase are useful for short merchant queries.
  // Income vocabulary is interpreted first so a Salary title cannot hijack it.
  if (!merchantPhrase) {
    const eligible = state.transactions.filter((row) => isIncomeQuestion && !net ? row.type === 'income' : row.type === 'expense');
    const titles = [...new Set(eligible.map((row) => row.title.trim()).filter(Boolean))]
      .filter((title) => !(isIncomeQuestion && /^(?:salary|income)$/i.test(title)))
      .sort((a, b) => b.length - a.length);
    const categoryQuestion = categoriesFromQuestion(q).length > 0 && !/\b(?:at|from)\b/.test(q);
    const matched = categoryQuestion ? [] : titles.filter((title) => containsPhrase(q, title));
    const exact = matched[0];
    if (exact && matched.some((title) => !containsPhrase(exact, title))) return clarification('Ask about one merchant at a time so I can preserve the exact match.');
    if (exact) { merchantPhrase = exact; q = q.replace(new RegExp(escapeRegExp(normalize(exact)), 'g'), ' '); }
  }
  const parsed = parsePeriods(q, now);
  if (parsed.error) return clarification(parsed.error);
  if (parsed.periods.length > (comparison ? 2 : 1)) return clarification('Ask about one date range, or compare two clearly named periods.');
  let period = parsed.periods[0] ?? prior?.period ?? defaultPeriod ?? currentMonthPeriod(now);
  const comparisonPeriod = parsed.periods[1];
  q = parsed.rest.replace(/\s+/g, ' ').trim();
  if (parsed.periods.length) q = q.replace(/\b(?:in|on|for|during)\s+(?:the\s*)?(?=[?!.]|$)/g, ' ');
  if (!merchantPhrase) {
    const phrase = q.match(/\b(?:at|from)\s+(.+?)(?=\s+(?:with|using|on|in|for|compared|versus|vs|change|changed|increase|decrease)\b|[?!.]|$)/)?.[1]?.trim();
    if (phrase) { merchantPhrase = phrase; q = q.replace(phrase, ' '); }
  }
  if (merchantPhrase) {
    const resolved = resolveMerchant(merchantPhrase, state.transactions);
    if (!resolved.merchant) {
      const candidates = resolved.candidates ?? [];
      return clarification(candidates.length ? `Several recorded merchants match “${merchantPhrase}”. Choose the exact merchant.` : `I could not find a recorded merchant matching “${merchantPhrase}”. Check the name in Transactions.`,
        candidates.slice(0, 4).map((candidate) => question.replace(new RegExp(escapeRegExp(quoted?.[1] ?? merchantPhrase!), 'i'), JSON.stringify(candidate))));
    }
    filters.merchant = resolved.merchant;
  }
  const categories = categoriesFromQuestion(q);
  if (categories.length > 1) return clarification('Ask about one category at a time.');
  const category = categories[0];
  if (category) filters.category = category;
  if (isIncomeQuestion && !net && /\bsalary\b/.test(q)) filters.category = 'salary';
  if (isIncomeQuestion && !net && /\bbusiness\b/.test(q)) filters.category = 'business';
  // Unsupported locations, amounts, dates, or an unmatched "on X" category
  // should produce a clarification, never an unfiltered spending total.
  if (/\b(?:and|or|including|vs|versus|compared to)\s+\S/.test(q.replace(/[?!.]/g, '')) || /\d/.test(q.replace(/\btop\s+\d+\b/g, '')) || /\b(?:in|during|before|after|since|between|with|using)\s+(?!(?:the )?previous period\b)\S|\b(?:over|under|above|below|more than|less than)\s+\d|\b(?:usd|eur|gbp|aed|sar|jpy|kwd)\b|[$€£]/.test(q) ||
    (!category && /\bon\s+(?!track\b)\S/.test(q)) || /\b(?:and|or)\s+(?:at|from)\b/.test(q)) {
    return clarification('I could not preserve every condition in that question. Try one merchant or category and an exact date range.');
  }
  if (followUp && prior && /^(?:and\s+)?(?:what about|how about)\s*[?!.]?$/.test(q.trim())) {
    return { ...prior, ...filters, period, ...(prior.tool === 'compare-periods' ? { comparisonPeriod: undefined } : {}) };
  }
  if (hasUnsupportedRemainder(q)) return clarification('I could not identify every condition in that question. Ask about recorded spending or income, optionally with one merchant, category, account, and date range.');
  if (net && (filters.category || filters.merchant)) return clarification('Income and spending use different categories and sources. Ask for the overall difference, optionally for one account.');
  const scoped = { period, ...filters };
  if ((isIncomeQuestion || net) && /\b(?:daily|per day|each day|average|largest|biggest|top|forecast|projected)\b|on track/.test(q)) {
    return clarification('I can total income for a period, but cannot calculate that income metric yet. Try asking how much income you received.');
  }
  if (/cash out|left my account|money out|actual outflow/.test(q)) {
    if (filters.merchant || filters.category) return clarification('Cash out includes repayments and transfers. Ask for cash out by account, or spending for a merchant or category.');
    return { tool: 'cash-outflow', ...scoped };
  }
  if (/forecast|on track|end of (the )?month|projected/.test(q)) return { tool: 'month-forecast', ...scoped };
  if (/biggest purchase|largest purchase|largest transaction|most expensive purchase/.test(q)) return { tool: 'largest-purchases', ...scoped, limit: limit ?? 5 };
  if (/per day|daily average|average daily|spend.*daily|spend.*each day/.test(q)) return { tool: 'daily-average', ...scoped };
  if (net) return { tool: 'net-income-spending', ...scoped };
  if (/top(?:\s+\d+)?(?: spending)? merchants?|biggest merchant|where.*spend most|merchant.*most/.test(q)) return { tool: 'top-merchants', ...scoped, ...(limit ? { limit } : {}) };
  if (/top(?:\s+\d+)?(?: spending)? categor|biggest categor|which categor/.test(q)) return { tool: 'top-categories', ...scoped, ...(limit ? { limit } : {}) };
  if (comparison) {
    if (isIncomeQuestion) return clarification('I can compare spending between periods. Ask for income in one period at a time.');
    if (period.mode === 'all') return clarification('Choose a month or date range to compare with another period.');
    return { tool: 'compare-periods', ...scoped, ...(comparisonPeriod ? { comparisonPeriod } : {}) };
  }
  if (isIncomeQuestion) return { tool: 'income-total', ...scoped };
  if (filters.merchant) return { tool: 'merchant-breakdown', ...scoped, merchant: filters.merchant };
  if (filters.category) return { tool: 'category-breakdown', ...scoped, category: filters.category };
  if (/\b(?:spend|spent|spending|expense|expenses|purchase|purchases|paid|pay)\b|cost me/.test(q)) return { tool: 'spending-total', ...scoped };
  return { tool: 'help' };
}

export function answerWafraQuestion(state: AppState, question: string, now = new Date(), previousRequest?: AssistantToolRequest | null, defaultPeriod?: Period): AssistantAnswer {
  return executeAssistantTool(state, planAssistantQuestion(state, question, now, previousRequest, defaultPeriod), now);
}

export function runWafraAssistant(state: AppState, question: string, now = new Date(), previousRequest?: AssistantToolRequest | null, defaultPeriod?: Period): { request: AssistantToolRequest; answer: AssistantAnswer } {
  const request = planAssistantQuestion(state, question, now, previousRequest, defaultPeriod);
  const answer = executeAssistantTool(state, request, now);
  return { request, answer: answer.evidence?.length && /^show (?:me )?(?:(?:those|the|matching) )?transactions[?!.]?$/i.test(question.trim()) ? { ...answer, showEvidence: true } : answer };
}

export function suggestedAssistantQuestions(state: AppState, period = currentMonthPeriod(), now = new Date()): string[] {
  const rows = spendingRows(state, period);
  const topCategory = groupedCategoryTotals(rows)[0]?.key;
  const suggestions = ['How much did I spend?', 'What are my largest purchases?'];
  if (period.mode !== 'all' && topCategory) suggestions.push(`Why did my ${categoryLabel(topCategory, 'en').toLowerCase()} spending change?`);
  const topMerchant = groupedTotals(rows, (row) => row.title)[0]?.key;
  if (topMerchant) suggestions.push(`How much did I spend at ${JSON.stringify(topMerchant)}?`);
  if (leavingSoon(state, now, { withinDays: 30 }).length) suggestions.push('What payments are due soon?');
  suggestions.push('What are my top spending categories?', 'How much income did I receive?');
  return suggestions.slice(0, 5);
}

/** Follow-ups preserve the active request's merchant, category, account and period. */
export function assistantFollowUpQuestions(request?: AssistantToolRequest): string[] {
  if (!request || request.tool === 'help') return ['How much did I spend?', 'What are my top spending categories?'];
  if (!('period' in request)) return ['What is due in the next 7 days?', 'How much did I spend?'];
  if (request.tool === 'income-total') return ['What about last month?', 'What about this month?'];
  return ['What about last month?', ...(request.period.mode !== 'all' ? ['Compare with the previous period'] : []),
    request.merchant ? 'Show my largest purchases' : 'Top 3 merchants'];
}
