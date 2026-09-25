import { billsForMonth } from '@/lib/bills';
import { CATEGORIES, categoryLabel } from '@/lib/categories';
import { cardPaymentRows, duePayments, dueWithStatus } from '@/lib/cards';
import { summarizeCashOutflow } from '@/lib/cash-flow';
import { formatAED as formatLedgerMoney, getMonthStartDay, monthEndISO, toISODate } from '@/lib/format';
import { internalTransferIdsForState, isIncome, isSpending, liveAccountIds } from '@/lib/ledger';
import { checkedMinorSum } from '@/lib/ledger-money';
import { leavingSoon, outgoingTotalFils } from '@/lib/leaving-soon';
import { bankBrandForName } from '@/lib/markets';
import {
  measureRuntimeOperation,
  measureRuntimeOperationAsync,
  recordRuntimeOperation,
} from '@/lib/runtime-performance';
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
import { spendingChangeDrivers, type SpendingChangeDriver } from '@/lib/assistant-spending-analysis';
import { findRecurringChanges, findUnusualCharges, findPossibleDuplicates, patternAnalysisCoverage, type AssistantPattern } from '@/lib/assistant-patterns';
import { allocationsOf, amountInCategory } from '@/lib/splits';
import {
  activeSubscriptions,
  detectSubscriptions,
  detectSubscriptionsCooperatively,
  trueSubscriptions,
  type Subscription,
} from '@/lib/subscriptions';
import { isTransferCandidate } from '@/lib/transfer-reconciliation';
import type { Account, AppState, Bill, CategoryId, Transaction } from '@/lib/types';

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
  | 'month-forecast'
  | 'recurring-changes'
  | 'unusual-charges'
  | 'possible-duplicates'
  | 'money-review'
  | 'historical-baseline'
  | 'account-inventory'
  | 'top-accounts'
  | 'compare-accounts'
  | 'obligation-status'
  | 'credit-card-settlement-summary'
  | 'data-coverage';

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
  merchants?: string[];
  categories?: CategoryId[];
  excludedMerchants?: string[];
  excludedCategories?: CategoryId[];
  excludedAccountIds?: string[];
}

export type AssistantToolRequest =
  | {
      tool: 'help';
      clarification?: string;
      suggestions?: string[];
      /**
       * Set only when the deterministic planner recognised nothing in the
       * question. It is the one Help shape the optional on-device intent
       * fallback may act on; safety clarifications never carry it.
       */
      unrecognized?: true;
    }
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
  | { tool: 'month-forecast'; period: Period }
  | { tool: 'historical-baseline'; period: Period; baseline: 'highest-month' | 'typical-month' | 'closest-month' | 'last-similar-month' }
  | { tool: 'top-accounts'; period: Period; accountKind?: 'all' | 'bank' | 'card'; metric?: 'amount' | 'count'; limit?: number }
  | { tool: 'compare-accounts'; period: Period; leftAccountId: string; rightAccountId: string }
  | { tool: 'recurring-changes' | 'unusual-charges' | 'possible-duplicates' | 'money-review' | 'data-coverage'; period: Period }))
  | { tool: 'subscriptions' }
  | { tool: 'upcoming-payments'; withinDays?: number }
  | { tool: 'account-inventory'; accountKind?: 'all' | 'bank' | 'card' | 'credit-card' | 'debit-card'; bankName?: string }
  | { tool: 'obligation-status'; obligation: 'card' | 'bill'; accountId?: string; billId?: string; monthKey?: string;
    query: 'summary' | 'remaining' | 'payments' | 'paid-date' }
  | { tool: 'credit-card-settlement-summary'; monthKey?: string };

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

export interface AssistantFinding {
  id: string;
  title: string;
  body: string;
  evidence: AssistantEvidence[];
  question?: string;
  request?: AssistantToolRequest;
}

export interface AssistantCoverage {
  recordCount: number;
  firstDate?: string;
  lastDate?: string;
  accountCount: number;
  totalAccounts: number;
  notes: string[];
}

export interface AssistantAnswer {
  tool: AssistantTool;
  title: string;
  body: string;
  /** Compact UI-first value. The full body remains available for accessibility/explanation. */
  headline?: string;
  /** Short scope/context line rendered below a compact headline. */
  meta?: string;
  facts?: { label: string; value: string }[];
  evidence?: AssistantEvidence[];
  findings?: AssistantFinding[];
  coverage?: AssistantCoverage;
  suggestions?: string[];
  destination?: '/bills';
  showEvidence?: boolean;
  /** Structured, body-free numbers safe to pass to a future explanation model. */
  data?: Record<string, string | number | boolean | null>;
  /**
   * Upcoming-payments answers only: the rows behind `facts`, so the screen can
   * draw each one with its merchant logo. Additive; `facts` is unchanged.
   */
  payments?: AssistantPaymentRow[];
  /**
   * Recorded monthly spending totals the answer was computed from, oldest
   * first. Present only where the executor actually grouped the ledger by
   * month; months with no recorded spending are absent, never zero-filled.
   */
  monthlySeries?: AssistantMonthTotal[];
  /** The month in `monthlySeries` the answer names (highest month); absent when none is. */
  monthlySeriesHighlight?: string;
}

export interface AssistantPaymentRow {
  title: string;
  category: CategoryId;
  kind: 'card' | 'bill' | 'subscription';
  dateISO: string;
  daysLeft: number;
  amountFils: number;
}

export interface AssistantMonthTotal {
  /** YYYY-MM */
  month: string;
  totalFils: number;
}

/** At most this many recorded months are drawn beside a baseline answer. */
const MONTHLY_SERIES_LIMIT = 6;
/**
 * The most recent recorded months, oldest first. A month the answer names is
 * always kept, even when it is older than that window, so the bar the answer
 * points at is on the chart.
 */
const monthlySeriesOf = (
  months: readonly { key: string; totalFils: number }[],
  mustInclude?: string,
): AssistantMonthTotal[] => {
  let shown = months.slice(-MONTHLY_SERIES_LIMIT);
  if (mustInclude && !shown.some((month) => month.key === mustInclude)) {
    const named = months.find((month) => month.key === mustInclude);
    if (named) shown = [named, ...shown.slice(-(MONTHLY_SERIES_LIMIT - 1))];
  }
  return shown.map((month) => ({ month: month.key, totalFils: month.totalFils }));
};

export type AssistantCorrectionPlan =
  | { kind: 'merchant-category'; merchant: string; category: CategoryId; direction: 'income' | 'expense' }
  | { kind: 'transaction-category'; transactionId: string; category: CategoryId }
  | { kind: 'transfer-ownership'; transactionId: string; ownership: 'own' | 'external' }
  | { kind: 'not-subscription'; merchant: string }
  | { kind: 'clarification'; body: string; suggestions?: string[] };

const normalize = (value: string) => value.trim().toLowerCase();

const normalizeMerchantText = (value: string) => value
  .normalize('NFKC')
  .toLocaleLowerCase('en-US')
  .replace(/[’'`]/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .replace(/\s+/g, ' ');

interface AssistantLedgerCache {
  transactions: Transaction[];
  accounts: Account[];
  transferInternalIds?: string[];
  monthStartDay: number;
  live: Set<string>;
  internal: Set<string>;
  spendingAll?: Transaction[];
  incomeAll?: Transaction[];
  spendingByPeriod: Map<string, Transaction[]>;
  incomeByPeriod: Map<string, Transaction[]>;
}

let assistantLedgerCache: AssistantLedgerCache | null = null;

function cachedLedger(state: AppState): AssistantLedgerCache {
  if (assistantLedgerCache?.transactions === state.transactions &&
      assistantLedgerCache.accounts === state.accounts &&
      assistantLedgerCache.transferInternalIds === state.transferInternalIds &&
      assistantLedgerCache.monthStartDay === state.monthStartDay) {
    return assistantLedgerCache;
  }
  const live = liveAccountIds(state.accounts);
  const internal = measureRuntimeOperation('ask-transfer-scope', () => internalTransferIdsForState(state));
  assistantLedgerCache = {
    transactions: state.transactions,
    accounts: state.accounts,
    transferInternalIds: state.transferInternalIds,
    monthStartDay: state.monthStartDay,
    live,
    internal,
    spendingByPeriod: new Map(),
    incomeByPeriod: new Map(),
  };
  return assistantLedgerCache;
}

function ledgerScope(state: AppState) {
  const cached = cachedLedger(state);
  return { live: cached.live, internal: cached.internal };
}

function allSpendingRows(state: AppState): Transaction[] {
  const cached = cachedLedger(state);
  if (!cached.spendingAll) {
    cached.spendingAll = state.transactions.filter((tx) => isSpending(tx, cached.live, cached.internal));
  }
  return cached.spendingAll;
}

function allIncomeRows(state: AppState): Transaction[] {
  const cached = cachedLedger(state);
  if (!cached.incomeAll) {
    cached.incomeAll = state.transactions.filter((tx) => isIncome(tx, cached.live, cached.internal));
  }
  return cached.incomeAll;
}

const ASSISTANT_PREP_SLICE_MS = 4;

/**
 * Build the two whole-ledger projections Ask Wafra reuses without monopolising
 * Android's JS thread. The first question after a ledger mutation pays this
 * once in <=~4 ms slices; later questions reuse the immutable-array cache.
 */
async function prepareAssistantLedgerCooperatively(
  state: AppState,
  cancelled: () => boolean,
): Promise<boolean> {
  const cached = cachedLedger(state);
  const merchantReady = assistantMerchantIndex?.transactions === state.transactions;
  if (cached.spendingAll && cached.incomeAll && merchantReady) return !cancelled();

  const spending: Transaction[] = [];
  const income: Transaction[] = [];
  const uniqueTitles = new Set<string>();
  let sliceStartedAt = Date.now();
  for (let index = 0; index < state.transactions.length; index += 1) {
    if (cancelled()) return false;
    const row = state.transactions[index];
    if (isSpending(row, cached.live, cached.internal)) spending.push(row);
    if (isIncome(row, cached.live, cached.internal)) income.push(row);
    const title = row.title.trim();
    if (title) uniqueTitles.add(title);
    if (Date.now() - sliceStartedAt >= ASSISTANT_PREP_SLICE_MS) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      sliceStartedAt = Date.now();
    }
  }
  if (cancelled()) return false;
  cached.spendingAll = spending;
  cached.incomeAll = income;
  if (!merchantReady) assistantMerchantIndex = buildMerchantIndex(state.transactions, [...uniqueTitles]);
  return true;
}

function periodCacheKey(period: Period): string {
  return period.mode === 'all' ? 'all' : JSON.stringify(period);
}

function spendingRows(state: AppState, period: Period): Transaction[] {
  const cached = cachedLedger(state);
  const key = periodCacheKey(period);
  const existing = cached.spendingByPeriod.get(key);
  if (existing) return existing;
  const rows = period.mode === 'all'
    ? allSpendingRows(state)
    : allSpendingRows(state).filter((tx) => inPeriod(tx.date, period));
  cached.spendingByPeriod.set(key, rows);
  return rows;
}

function incomeRows(state: AppState, period: Period): Transaction[] {
  const cached = cachedLedger(state);
  const key = periodCacheKey(period);
  const existing = cached.incomeByPeriod.get(key);
  if (existing) return existing;
  const rows = period.mode === 'all'
    ? allIncomeRows(state)
    : allIncomeRows(state).filter((tx) => inPeriod(tx.date, period));
  cached.incomeByPeriod.set(key, rows);
  return rows;
}

function total(rows: Transaction[]): number {
  return checkedMinorSum(rows.map((tx) => tx.amountFils));
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_PATTERN = MONTHS.join('|');
const MONTH_ABBREVIATIONS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DATE_MONTH_PATTERN = [...MONTHS, ...MONTH_ABBREVIATIONS].join('|');
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const containsPhrase = (text: string, phrase: string) =>
  (` ${normalizeMerchantText(text)} `).includes(` ${normalizeMerchantText(phrase)} `);

function clarification(body: string, suggestions?: string[], unrecognized = false): AssistantToolRequest {
  return {
    tool: 'help', clarification: body,
    ...(suggestions?.length ? { suggestions } : {}),
    ...(unrecognized ? { unrecognized: true as const } : {}),
  };
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
function parsePeriods(question: string, now: Date, state?: AppState): ParsedPeriods {
  const found: { index: number; period: Period }[] = [];
  let rest = question;
  let error: string | undefined;
  const consume = (pattern: RegExp, parse: (match: RegExpExecArray) => Period | null) => {
    for (const match of [...rest.matchAll(pattern)]) {
      const period = parse(match);
      if (!period) error = 'I could not resolve that date range. Use exact dates such as 2026-08-01 to 2026-08-31.';
      else found.push({ index: match.index!, period });
      // A temporal preposition belongs to the resolved date, even when more
      // filters follow it. Leave unsupported operators (since/before/after)
      // untouched so they still require clarification.
      const prefix = rest.slice(0, match.index!).match(/\b(?:in|during|for|on)\s+$/);
      const start = prefix?.index ?? match.index!;
      const end = match.index! + match[0].length;
      rest = rest.slice(0, start) + ' '.repeat(end - start) + rest.slice(end);
    }
  };
  const range = (from: string, to: string): Period | null => validISODate(from) && validISODate(to) && from <= to
    ? { mode: 'range', from, to } : null;
  const monthIndex = (monthName: string): number => {
    const full = MONTHS.indexOf(monthName);
    if (full >= 0) return full;
    return MONTH_ABBREVIATIONS.indexOf(monthName.replace(/\.$/, ''));
  };
  const monthDay = (monthName: string, dayText: string, yearText?: string): string | null => {
    const month = monthIndex(monthName);
    if (month < 0) return null;
    const year = yearText ? Number(yearText) : month > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear();
    const value = `${year}-${String(month + 1).padStart(2, '0')}-${String(Number(dayText)).padStart(2, '0')}`;
    return validISODate(value) ? value : null;
  };
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
  consume(new RegExp(`\\b(since|after|before)\\s+(${DATE_MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'g'), (m) => {
    const date = monthDay(m[2], m[3], m[4]);
    if (!date) return null;
    if (m[1] === 'since') return range(date, toISODate(now));
    const boundary = new Date(`${date}T12:00:00Z`);
    if (m[1] === 'after') {
      boundary.setUTCDate(boundary.getUTCDate() + 1);
      return range(toISODate(boundary), toISODate(now));
    }
    boundary.setUTCDate(boundary.getUTCDate() - 1);
    const reporting = currentMonthPeriod(now);
    const start = state ? periodStartISO(reporting, state.transactions) : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    return start ? range(start, toISODate(boundary)) : null;
  });
  consume(new RegExp(`\\b(${DATE_MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'g'), (m) => {
    const day = monthDay(m[1], m[2], m[3]);
    return day ? range(day, day) : null;
  });
  consume(/\b(?:over\s+the\s+)?(?:last|past)\s+(\d+)\s+days?\b/g, (m) => {
    const days = Number(m[1]);
    if (days < 1 || days > 90) return null;
    const from = new Date(now); from.setDate(from.getDate() - days + 1);
    return range(toISODate(from), toISODate(now));
  });
  consume(/\b(?:over\s+the\s+)?(?:last|past)\s+(\d+)\s+weeks?\b/g, (m) => {
    const weeks = Number(m[1]);
    if (weeks < 1 || weeks > 12) return null;
    const from = new Date(now); from.setDate(from.getDate() - weeks * 7 + 1);
    return range(toISODate(from), toISODate(now));
  });
  consume(/\b(?:the\s+)?first half(?: of)? (?:this|the current) month\b/g, () => {
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return range(`${key}-01`, `${key}-15`);
  });
  consume(/\b(?:the\s+)?second half(?: of)? (?:this|the current) month\b/g, () => {
    if (now.getDate() < 16) return null;
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return range(`${key}-16`, toISODate(now));
  });
  consume(/\b(?:the\s+)?(?:past|last) fortnight\b/g, () => {
    const from = new Date(now); from.setDate(from.getDate() - 13);
    return range(toISODate(from), toISODate(now));
  });
  consume(/\bthis week\b/g, () => {
    const start = new Date(now);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return range(toISODate(start), toISODate(now));
  });
  consume(/\b(?:this|last) weekend\b/g, (m) => {
    // Spending questions about "this weekend" should never point at future
    // dates. Use the weekend that has most recently started; on Sat/Sun that is
    // the current weekend, otherwise it is the immediately preceding Sat/Sun.
    const day = now.getDay();
    const start = new Date(now);
    const daysBack = day === 6 ? 0 : day === 0 ? 1 : day + 1;
    start.setDate(start.getDate() - daysBack - (m[0] === 'last weekend' && day >= 6 ? 7 : 0));
    const end = new Date(start); end.setDate(end.getDate() + 1);
    const cappedEnd = end > now ? now : end;
    return range(toISODate(start), toISODate(cappedEnd));
  });
  consume(/\bmonth to date\b/g, () => {
    const reporting = currentMonthPeriod(now);
    const start = state ? periodStartISO(reporting, state.transactions) : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    return start ? range(start, toISODate(now)) : null;
  });
  consume(/\byear to date\b/g, () => range(`${now.getFullYear()}-01-01`, toISODate(now)));
  const paydayRange = (before: boolean): Period | null => {
    if (!state) return null;
    const reporting = currentMonthPeriod(now);
    const salaryDates = incomeRows(state, reporting)
      .filter((row) => row.category === 'salary' && row.date <= toISODate(now))
      .map((row) => row.date).sort();
    const payday = salaryDates.at(-1);
    if (!payday) return null;
    if (!before) return range(payday, toISODate(now));
    const start = periodStartISO(reporting, state.transactions);
    const endDate = new Date(`${payday}T12:00:00Z`); endDate.setUTCDate(endDate.getUTCDate() - 1);
    const end = toISODate(endDate);
    return start && start <= end ? range(start, end) : null;
  };
  const payWords = '(?:salary|payday|paycheck|pay cheque|pay)';
  consume(new RegExp(`\\b(?:since|after)\\s+(?:my\\s+)?(?:last\\s+)?${payWords}(?:\\s+(?:came in|arrived))?\\b`, 'g'), () => paydayRange(false));
  consume(new RegExp(`\\bbefore\\s+(?:my\\s+)?(?:last\\s+)?${payWords}(?:\\s+(?:came in|arrived))?\\b`, 'g'), () => paydayRange(true));
  consume(/\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+months?\s+ago\b/g, (m) => {
    const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
      seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
    const token = m[0].split(/\s+/)[0];
    const months = words[token] ?? Number(token);
    if (!Number.isInteger(months) || months < 1 || months > 24) return null;
    let period: Period = currentMonthPeriod(now);
    for (let index = 0; index < months; index++) period = previousPeriod(period) ?? period;
    return period;
  });
  consume(/\bsame month last year\b/g, () => {
    const current = currentMonthPeriod(now);
    return current.mode === 'month' ? { mode: 'month', key: `${Number(current.key.slice(0, 4)) - 1}${current.key.slice(4)}` } : null;
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
  // ISO calendar months are explicit calendar dates, unlike the selected
  // salary-day reporting month. Never consume a prefix of an ISO day/range.
  consume(/(?<![\d/-])\b(\d{4})-(\d{2})\b(?![\d/-])/g, (m) => {
    const year = Number(m[1]), month = Number(m[2]);
    return year >= 2000 && year <= 2200 && month >= 1 && month <= 12
      ? calendarMonth(month - 1, year) : null;
  });
  consume(/\b(?:in|during|for|year)\s+(\d{4})\b(?![\d/-])/g, (m) => {
    const year = Number(m[1]);
    if (year < 2000 || year > 2200) return null;
    return getMonthStartDay() === 1 ? { mode: 'year', year }
      : { mode: 'range', from: `${year}-01-01`, to: `${year}-12-31` };
  });
  if (/\b(?:before|after|since|until|between|quarter|fortnight|weekend|weeks|months|years|next|tomorrow|week|during|payday|paycheck)\b|\d[/-]\d|\b\d{4}\b/.test(rest)) {
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

// These words are useful for clarification, but are intentionally NOT aliases.
// A coffee purchase is a subset of Dining, fuel is a subset of Transport, etc.
// Mapping them directly to a whole category would manufacture a broader total
// than the user's question asked for.
const NARROW_CONCEPT_PARENTS: [RegExp, CategoryId][] = [
  [/\b(?:coffee|cafes?|takeaway|takeout|snacks?|lunch|dinner|breakfast|brunch|meals?)\b/, 'dining'],
  [/\b(?:fuel|petrol|parking|tolls?|car wash|commute|commuting|bus|metro|tram|ride hailing|ride hail|cabs?)\b/, 'transport'],
  [/\b(?:clothes|clothing|apparel|shoes|electronics|gadgets|malls?)\b/, 'shopping'],
  [/\b(?:saas|developer tools|dev tools|ai tools)\b/, 'software'],
  [/\b(?:internet|data plan|sim)\b/, 'telecom'],
  [/\b(?:cinema|theatre|theater|concerts?|events?|streaming|games)\b/, 'entertainment'],
  [/\b(?:dentist|dental|optician|prescription|medicine|therapy|physio)\b/, 'health'],
  [/\b(?:haircut|nails|manicure|pedicure|beauty|skincare|cosmetics|makeup)\b/, 'personal-care'],
  [/\b(?:plumber|electrician|handyman|nanny|gardener|carpenter|painter|repairs?)\b/, 'home-services'],
  [/\b(?:tuition|textbooks?|training|lessons|classes)\b/, 'education'],
];

function narrowConceptParent(question: string): { phrase: string; category: CategoryId } | undefined {
  for (const [pattern, category] of NARROW_CONCEPT_PARENTS) {
    const match = question.match(pattern);
    if (match) return { phrase: match[0], category };
  }
  return undefined;
}

function categoriesFromQuestion(question: string): CategoryId[] {
  return CATEGORY_ALIASES.filter(([pattern]) => pattern.test(question)).map(([, category]) => category);
}

/**
 * Normalize high-confidence conversational shorthand after recorded merchant/account
 * identities have been protected. This is intentionally conservative: it rewrites
 * language, never financial values or recorded names.
 */
function normalizeAssistantSemanticLanguage(question: string): string {
  let text = question;
  const cardinalWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
    eighteen: 18, nineteen: 19, twenty: 20 };
  const cardinal = `(?:${Object.keys(cardinalWords).join('|')}|\\d+)`;
  const count = (value: string): string => String(cardinalWords[value] ?? Number(value));
  // Only cardinal quantities immediately attached to ranking grammar are
  // normalized; account tails, amounts, dates and protected names stay intact.
  text = text
    .replace(new RegExp(`\\btop\\s+(${cardinal})\\b`, 'g'), (_, value: string) => `top ${count(value)}`)
    .replace(new RegExp(`\\b(${cardinal})\\s+(?:largest|biggest|most expensive)\\s+(purchases?|transactions?)\\b`, 'g'),
      (_, value: string, noun: string) => `top ${count(value)} ${noun}`)
    .replace(new RegExp(`\\b(?:which|what)\\s+(${cardinal})\\s+merchants?\\b`, 'g'),
      (_, value: string) => `top ${count(value)} merchants`)
    .replace(/\brank\s+(?:(?:my|the)\s+)?(?=top\b)/g, 'show ')
    .replace(/\b(top \d+ merchants?)\s+(?:took|received)\s+(?:the\s+)?most(?:\s+of)?\s+(?:my\s+)?money\b/g, '$1 by spending')
    .replace(/\b(top \d+ merchants?)\s+account for\s+(?:the\s+)?most\b/g, '$1 by');
  // This marker is resolved against the caller's selected UI period later;
  // removing the phrase alone could accidentally inherit a prior answer's date.
  text = text
    .replace(/\b(?:(?:in|for|during)\s+)?(?:(?:the|my)\s+)?(?:selected|chosen)\s+(?:reporting\s+)?(?:period|date range)\b/g, 'selectedreportingperiod')
    .replace(/\b(?:(?:in|for|during)\s+)?(?:the|my)\s+(?:reporting\s+)?(?:period|date range)\s+(?:that\s+)?i\s+(?:have\s+)?(?:selected|chosen)\b/g, 'selectedreportingperiod');
  if (/\bincome\b/.test(text) && /^(?:what|which|how much)\b/.test(text.trim())) {
    text = text.replace(/\barrived\b/g, 'received')
      .replace(/\b(did\s+i\s+)record\b/g, '$1receive')
      .replace(/\b(have\s+i\s+)recorded\b/g, '$1received')
      .replace(/\b(was|is)\s+recorded\b/g, '$1 received');
  }

  // Common chat contractions / politeness. These are semantically inert.
  text = text
    .replace(/\bwhat['’]?s\b|\bwhats\b/g, 'what is')
    .replace(/\b(?:pls|plz)\b/g, 'please')
    .replace(/\b(can|could|would|did|do|does|have|has|are|is|was|were)\s+u\b/g, '$1 you')
    .replace(/^\s*(?:hey\s+)?wafra[,:]?\s+/g, '')
    .replace(/^\s*(?:can|could|would)\s+you\s+(?:please\s+)?/g, '')
    .replace(/^\s*please\s+/g, '')
    .replace(/^\s*tell\s+me\s+/g, '');

  // Date shorthand users type naturally in chat.
  text = text
    .replace(/\bmtd\b/g, 'month to date')
    .replace(/\bytd\b/g, 'year to date')
    .replace(/\bthis\s+mo\b/g, 'this month')
    .replace(/\b(?:last|prev)\s+mo\b/g, 'last month')
    .replace(/\bthis\s+wk\b/g, 'this week')
    .replace(/\blast\s+wk\b/g, 'last week')
    .replace(/\bpast\s+wk\b/g, 'past week')
    .replace(/\bthis\s+yr\b/g, 'this year')
    .replace(/\b(?:last|prev)\s+yr\b/g, 'last year')
    .replace(/\byday\b/g, 'yesterday')
    .replace(/\balltime\b/g, 'all time')
    .replace(/\b(last|past)\s+(\d+)d\b/g, '$1 $2 days')
    .replace(/\b(last|past)\s+(\d+)w\b/g, '$1 $2 weeks')
    .replace(/\bthis month so far\b/g, 'month to date')
    .replace(/\bthis year so far\b|\byear so far\b/g, 'year to date');

  // Transaction / account abbreviations. Only rewrite the financial-language form.
  text = text
    .replace(/\b(?:txn|transction|transcation)\b/g, 'transaction')
    .replace(/\b(?:txns|transctions|transcations)\b/g, 'transactions')
    .replace(/\b(which|what)\s+cc\b/g, '$1 card')
    .replace(/\btop\s+ccs?\b/g, 'top cards')
    .replace(/\bcc\s+did\s+i\s+use\b/g, 'card did i use')
    .replace(/\b(which|what)\s+acct\b/g, '$1 account')
    .replace(/\btop\s+accts?\b/g, 'top accounts');

  // Subscription shorthand. Preserve an explicit merchant phrase such as "at Subs".
  if (!/\b(?:at|from|on)\s+subs?\b/.test(text)) {
    text = text
      .replace(/\bwhat am i subscribed to\b|\bwhat do i subscribe to\b/g, 'what subscriptions do i have')
      .replace(/\bwhat services am i paying for\b|\bwhat do i pay every month\b|\bwhat is charging me every month\b/g, 'what subscriptions do i have')
      .replace(/\banything renewing\b/g, 'what subscriptions do i have')
      .replace(/\b(?:subscriptons|subsciptions|subcriptions|subsriptions)\b/g, 'subscriptions')
      .replace(/\bwhat sub do i have\b/g, 'what subscription do i have')
      .replace(/\bshow my sub\b|\blist my sub\b/g, 'show my subscription')
      .replace(/\bsubs\b/g, 'subscriptions')
      .replace(/\b(?:memberships?)\b/g, 'subscriptions')
      .replace(/\bauto[ -]?renewals?\b/g, 'renewals')
      .replace(/\brecurring stuff\b/g, 'recurring charges');
  }

  // Very common finance-chat phrasing with one deterministic interpretation.
  text = text
    .replace(/\b(?:what needs paying|anything i need to pay|what payments are next)\b/g, 'what is due')
    .replace(/\b(?:where did my money go|where is my money going|what did i spend (?:the )?most on)\b/g, 'top categories')
    .replace(/\b(?:anything off|anything strange|anything fishy|anything look wrong|anything i should worry about)\b/g, 'anything unusual')
    .replace(/\b(?:weird|odd|strange) charges?\b/g, 'unusual charges')
    .replace(/\b(?:did i pay twice|double payment|double payments|same amount twice)\b/g, 'possible duplicate charges')
    .replace(/\b(?:biggest|top) spends?\b/g, 'largest purchases')
    .replace(/\btop shops?\b/g, 'top merchants')
    .replace(/\bwhich shop did i spend most at\b/g, 'which merchant did i spend most at')
    .replace(/\bmoney went out\b/g, 'money out')
    .replace(/\bhow much (?:did|have) i get paid\b/g, 'how much income did i receive')
    .replace(/\bhow much (?:salary|pay) came in\b/g, 'how much income did i receive')
    .replace(/\bhow much was my (?:paycheck|pay cheque|wage)\b/g, 'how much salary did i receive')
    .replace(/\b(?:paychecks?|pay cheques?|wages?)\b/g, 'salary');

  // Common category typos. These map only to existing deterministic categories.
  text = text
    .replace(/\b(?:grocreies|groceries|grocries)\b/g, 'groceries')
    .replace(/\b(?:resturants?|restaraunts?)\b/g, 'restaurants')
    .replace(/\butilites\b/g, 'utilities');

  return text.replace(/\s+/g, ' ').trim();
}

type ObligationQuery = 'summary' | 'remaining' | 'payments' | 'paid-date';

function obligationQueryFromQuestion(question: string): ObligationQuery | null {
  const q = normalizeAssistantSemanticLanguage(normalize(question));
  if (/\bwhen\b.*\b(?:pay|paid|payment|settle|settled|clear|cleared)\b|\bwhen did (?:that|it|this) get paid\b/.test(q)) {
    return 'paid-date';
  }
  if (/\b(?:how much|what amount)\b.*\b(?:paid|payment|payments|pay toward|pay towards|toward|towards)\b|\b(?:show|list) (?:the )?payments\b|\bpayments? (?:did|have) i (?:make|made)\b/.test(q)) {
    return 'payments';
  }
  if (/\b(?:how much|what)\b.*\b(?:left|remaining|outstanding|still owe|owed)\b|\b(?:remaining|outstanding) (?:amount|balance)\b|\bwhat do i still owe\b/.test(q)) {
    return 'remaining';
  }
  if (/\b(?:did|have) (?:i|you)\b.*\b(?:pay|paid|settle|settled|clear|cleared|pay off|paid off)\b|\b(?:is|was)\b.*\b(?:paid|settled|cleared|outstanding)\b|\b(?:payment|repayment)\b.*\b(?:go through|went through|received|posted|successful)\b|\b(?:settled|paid|cleared)\??$/.test(q)) {
    return 'summary';
  }
  return null;
}

function creditCards(state: AppState): Account[] {
  return state.accounts.filter((account) => account.cardType === 'credit' && !account.archived);
}

function accountInventoryRequest(question: string): AssistantToolRequest | undefined {
  const q = normalizeAssistantSemanticLanguage(normalize(question))
    .replace(/\bccs\b/g, 'credit cards')
    .replace(/\bcc\b/g, 'credit card');
  const countQuestion = /\bhow many\b[^?!.]{0,80}\b(?:accounts?|bank accounts?|cards?|credit cards?|debit cards?)\b[^?!.]{0,50}\b(?:do i have|i have|are there|have i got|have i)\b/.test(q)
    || /\bhow many\b[^?!.]{0,80}\b(?:accounts?|bank accounts?|cards?|credit cards?|debit cards?)\b/.test(q);
  const listQuestion = /\b(?:what|which|show|list)\b[^?!.]{0,40}\b(?:accounts?|bank accounts?|cards?|credit cards?|debit cards?)\b[^?!.]{0,50}\b(?:do i have|i have|are mine|my)\b/.test(q)
    || /\b(?:show|list)\s+(?:me\s+)?my\s+(?:accounts?|bank accounts?|cards?|credit cards?|debit cards?)\b/.test(q);
  if (!countQuestion && !listQuestion) return undefined;

  const accountKind: 'all' | 'bank' | 'card' | 'credit-card' | 'debit-card' = /\bcredit cards?\b/.test(q)
    ? 'credit-card'
    : /\bdebit cards?\b/.test(q)
      ? 'debit-card'
      : /\bcards?\b/.test(q)
        ? 'card'
        : /\bbank accounts?\b/.test(q)
          ? 'bank'
          : 'all';
  const bankName = bankBrandForName(question)?.name;
  return { tool: 'account-inventory', accountKind, ...(bankName ? { bankName } : {}) };
}

function accountChoiceLabel(account: Account): string {
  return account.last4 && !account.name.includes(account.last4) ? `${account.name} · ${account.last4}` : account.name;
}

function cardReferenceCandidates(state: AppState, question: string): Account[] {
  const cards = creditCards(state);
  const q = normalizeMerchantText(question);
  const queryBrand = bankBrandForName(question)?.name;
  const digits = new Set(question.match(/\b\d{4}\b/g) ?? []);
  const scored = cards.map((account) => {
    let score = 0;
    const name = normalizeMerchantText(account.name);
    if (name.length >= 3 && containsPhrase(q, name)) score = Math.max(score, 100);
    if (account.last4 && digits.has(account.last4)) score = Math.max(score, 110);
    for (const network of ['visa', 'mastercard', 'master card', 'amex', 'american express']) {
      if (containsPhrase(q, network) && containsPhrase(name, network)) score = Math.max(score, 75);
    }
    const accountBrand = bankBrandForName(account.bankName ?? account.name)?.name;
    if (queryBrand && accountBrand && normalize(queryBrand) === normalize(accountBrand)) score = Math.max(score, 90);
    if (account.bankName && containsPhrase(q, account.bankName)) score = Math.max(score, 95);
    return { account, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
  if (!scored.length) return [];
  const top = scored[0].score;
  return scored.filter((item) => item.score === top).map((item) => item.account);
}

function contextualCreditCardCandidate(
  state: AppState,
  previousRequest?: AssistantToolRequest | null,
): Account | null {
  if (!previousRequest) return null;
  if (previousRequest.tool === 'top-accounts' && previousRequest.accountKind === 'card') {
    const top = accountSpendingGroups(
      state,
      previousRequest.period,
      previousRequest,
      'card',
      previousRequest.metric ?? 'amount',
    )[0];
    const account = top ? state.accounts.find((item) => item.id === top.id) : undefined;
    return account?.cardType === 'credit' && !account.archived ? account : null;
  }
  if (previousRequest.tool === 'account-inventory') {
    const bankIdentity = previousRequest.bankName
      ? normalize(bankBrandForName(previousRequest.bankName)?.name ?? previousRequest.bankName)
      : null;
    const matches = creditCards(state).filter((account) => {
      if (previousRequest.accountKind === 'debit-card' || previousRequest.accountKind === 'bank') return false;
      if (!bankIdentity) return true;
      const accountBank = bankBrandForName(account.bankName ?? account.name)?.name ?? account.bankName;
      return !!accountBank && normalize(accountBank) === bankIdentity;
    });
    return matches.length === 1 ? matches[0] : null;
  }
  return null;
}

function obligationMonthKey(
  state: AppState,
  question: string,
  now: Date,
  previousRequest?: AssistantToolRequest | null,
): string | undefined {
  const q = normalizeAssistantSemanticLanguage(normalize(question));
  // Card statements are calendar obligations. A named month therefore stays a
  // calendar month even when the user's Spending period starts on a salary day.
  const namedMonth = q.match(new RegExp(`\\b(${MONTH_PATTERN})(?:\\s+(\\d{4}))?\\b`));
  if (namedMonth) {
    const month = MONTHS.indexOf(namedMonth[1]);
    const year = namedMonth[2]
      ? Number(namedMonth[2])
      : month > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear();
    return `${year}-${String(month + 1).padStart(2, '0')}`;
  }
  const parsed = parsePeriods(q, now, state);
  const explicit = parsed.periods.find((period) => period.mode === 'month');
  if (explicit?.mode === 'month') return explicit.key;
  if (previousRequest?.tool === 'obligation-status' && previousRequest.monthKey) return previousRequest.monthKey;
  return undefined;
}

function billReferenceCandidates(state: AppState, question: string): Bill[] {
  const q = normalizeMerchantText(question);
  return state.bills.filter((bill) => {
    const title = normalizeMerchantText(bill.title);
    return title.length >= 2 && containsPhrase(q, title);
  });
}

function planCreditCardSettlementSummaryQuestion(
  state: AppState,
  question: string,
  now = new Date(),
): AssistantToolRequest | undefined {
  const q = normalizeAssistantSemanticLanguage(normalize(question));
  // Collective card-settlement questions are a different question from a
  // single-card obligation. Resolve them locally so natural phrasing such as
  // “Have I paid all my credit cards this month?” never falls through to the
  // language model or asks the user to choose one card at a time.
  const pluralCards = /\b(?:all\s+|every\s+|each\s+)?(?:my\s+)?credit cards\b|\b(?:my\s+)?credit cards\b.*\bthem\b/.test(q);
  const settlementLanguage = /\b(?:paid|pay|settled|settle|cleared|clear|paid off|settle(?:d)?|unpaid|outstanding)\b/.test(q);
  const collectiveStatus = /\b(?:all|every|each|them|which|any)\b/.test(q) || /\bcredit cards\b/.test(q);
  // “Paid at X with my credit cards” is merchant spending, not statement status.
  const merchantPurchase = /\b(?:paid|pay)\b[^?!.]{0,80}\bat\b[^?!.]{0,80}\bwith\b/.test(q);
  if (!pluralCards || !settlementLanguage || !collectiveStatus || merchantPurchase) return undefined;
  const monthKey = obligationMonthKey(state, question, now);
  return { tool: 'credit-card-settlement-summary', ...(monthKey ? { monthKey } : {}) };
}

function planObligationQuestion(
  state: AppState,
  question: string,
  previousRequest?: AssistantToolRequest | null,
  now = new Date(),
): AssistantToolRequest | undefined {
  const query = obligationQueryFromQuestion(question);
  if (!query) return undefined;
  const prior = previousRequest?.tool === 'obligation-status' ? previousRequest : undefined;
  const q = normalizeAssistantSemanticLanguage(normalize(question));
  const monthKey = obligationMonthKey(state, question, now, previousRequest);

  const merchantCardPayment = /\b(?:pay|paid)\b[^?!.]{0,80}\bat\b[^?!.]{0,60}\b(?:with|using) (?:my )?(?:credit )?card\b/.test(q);
  const explicitCard = !merchantCardPayment && (
    /\b(?:credit\s+card|card\s+(?:bill|statement|payment)|cc\b|(?:my|the)\s+statement\b)\b/.test(q) ||
    /\b(?:settle|settled|clear|cleared|pay off|paid off|pay toward|pay towards|owe|left|remaining|outstanding)\b[^?!.]{0,48}\b(?:(?:my|the|this|that) )?(?:credit )?card\b/.test(q) ||
    /\b(?:(?:my|the|this|that) )?(?:credit )?card\b[^?!.]{0,48}\b(?:paid|settled|cleared|outstanding|remaining)\b/.test(q) ||
    /\bwhen did i pay (?:my |the )?(?:credit )?card\b/.test(q)
  );
  const cardMatches = cardReferenceCandidates(state, question);
  const contextualCard = /\b(?:this|that) card\b|\b(?:this|that) one\b/.test(q)
    ? contextualCreditCardCandidate(state, previousRequest)
    : null;
  const explicitBill = /\b(?:bill|utility|utilities)\b/.test(q);
  const billMatches = billReferenceCandidates(state, question);

  const usePriorCard = prior?.obligation === 'card' && !explicitBill && !cardMatches.length && !billMatches.length;
  const usePriorBill = prior?.obligation === 'bill' && !explicitCard && !cardMatches.length && !billMatches.length;

  if (explicitCard || cardMatches.length || usePriorCard) {
    if (usePriorCard && prior?.accountId) return { ...prior, query, ...(monthKey ? { monthKey } : {}) };
    const cards = creditCards(state);
    const candidates = cardMatches.length ? cardMatches
      : contextualCard ? [contextualCard]
        : explicitCard && cards.length === 1 ? cards : [];
    if (candidates.length === 1) return {
      tool: 'obligation-status', obligation: 'card', accountId: candidates[0].id, query,
      ...(monthKey ? { monthKey } : {}),
    };
    if (candidates.length > 1 || explicitCard && cards.length > 1) {
      const choices = (candidates.length ? candidates : cards).slice(0, 4);
      return clarification('I found more than one matching credit card. Which card do you mean?',
        choices.map((account) => `Is ${accountChoiceLabel(account)} settled?`));
    }
    if (explicitCard && cards.length === 0) {
      return clarification('I do not see a recorded credit card yet. Add or import the card first, then I can check its statement status.');
    }
  }

  if (explicitBill || billMatches.length || usePriorBill) {
    if (usePriorBill && prior?.billId) return { ...prior, query };
    const candidates = billMatches.length ? billMatches : explicitBill && state.bills.length === 1 ? state.bills : [];
    if (candidates.length === 1) return { tool: 'obligation-status', obligation: 'bill', billId: candidates[0].id, query };
    if (candidates.length > 1 || explicitBill && state.bills.length > 1) {
      const choices = (candidates.length ? candidates : state.bills).slice(0, 4);
      return clarification('I found more than one matching bill. Which one do you mean?',
        choices.map((bill) => `Did I pay ${bill.title}?`));
    }
  }
  return undefined;
}

/** A bounded grammar: every meaningful token must be consumed, not ignored. */
function hasUnsupportedRemainder(question: string): boolean {
  let rest = question;
  for (const [pattern] of CATEGORY_ALIASES) rest = rest.replace(new RegExp(pattern.source, 'g'), ' ');
  rest = rest.replace(/\bcash out\b|\bleft my accounts?\b|\bmoney out\b|\bactual outflow\b|\bon track\b|\bend of (?:the )?month\b|\bper day\b|\bdaily average\b|\baverage daily\b|\beach day\b|\b(?:spend|spending) daily\b/g, ' ');
  const grammar = new Set(('how much money did do does should i my me we our you your the a an what which are is was were have has had am at from of for on in to with by about than this that these those it all total recorded spending spend spent expense expenses purchase purchases transaction transactions pay paid payment payments cost costs net income salary business earned earn earning earnings received receive receives receiving more less higher lower difference different minus forecast projected biggest largest most expensive top merchants merchant categories category why compare comparison versus vs increase increased decrease decreased change changed show previous period and or same dates charges charge recurring subscriptions subscription renewals renewal unusual unusually outlier outliers weird odd suspicious review reviewing possible duplicate duplicates duplicated charged twice double coverage data gaps missing imports import status history recorded changes please kindly just actually really tell know see view look check let list find give roughly exactly overall altogether summary breakdown drilldown thanks bought buy buys buying went going gone go up down get got gets getting use used drop dropped blew blow burned burnt burn put many some any anything else then still ever').split(' '));
  return normalizeMerchantText(rest).split(' ').some((token) => token && !grammar.has(token) && !/^\d+$/.test(token));
}

/** Small Levenshtein for typo tolerance in short merchant names. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

interface AssistantMerchantIndex {
  transactions: Transaction[];
  /** Long names first, matching the previous extraction precedence. */
  titles: string[];
  /** Alphabetical/canonical order retained for fuzzy-resolution tie behaviour. */
  resolutionTitles: string[];
  rank: Map<string, number>;
  byToken: Map<string, string[]>;
}

let assistantMerchantIndex: AssistantMerchantIndex | null = null;

function buildMerchantIndex(rows: Transaction[], uniqueTitles: string[]): AssistantMerchantIndex {
  const titles = [...uniqueTitles]
    .sort((x, y) => y.length - x.length || x.localeCompare(y));
  const resolutionTitles = [...new Map([...uniqueTitles].sort()
    .map((title) => [normalize(title), title])).values()];
  const rank = new Map(titles.map((title, index) => [title, index] as const));
  const byToken = new Map<string, string[]>();
  for (const title of titles) {
    const tokens = new Set(normalizeMerchantText(title).split(' ').filter(Boolean));
    for (const token of tokens) {
      const bucket = byToken.get(token);
      if (bucket) bucket.push(title);
      else byToken.set(token, [title]);
    }
  }
  return { transactions: rows, titles, resolutionTitles, rank, byToken };
}

function merchantIndex(rows: Transaction[]): AssistantMerchantIndex {
  if (assistantMerchantIndex?.transactions === rows) return assistantMerchantIndex;
  const uniqueTitles = [...new Set(rows.map((row) => row.title.trim()).filter(Boolean))];
  assistantMerchantIndex = buildMerchantIndex(rows, uniqueTitles);
  return assistantMerchantIndex;
}

/**
 * Candidate recorded titles that could literally occur in this clause.
 *
 * `extractNamedClause` used to test EVERY distinct merchant against EVERY chat
 * message. On a 15k-row ledger, even "check" or "how much did I spend?" paid
 * for thousands of normalisations and regexes before the Send tap could clear
 * the composer. Literal phrase containment requires at least one shared token,
 * so this index removes impossible merchants without changing the matching
 * rule that makes the final decision.
 */
function merchantTitlesInText(rows: Transaction[], text: string): string[] {
  const index = merchantIndex(rows);
  const candidates = new Set<string>();
  for (const token of new Set(normalizeMerchantText(text).split(' ').filter(Boolean))) {
    for (const title of index.byToken.get(token) ?? []) candidates.add(title);
  }
  return [...candidates].sort((a, b) => (index.rank.get(a) ?? 0) - (index.rank.get(b) ?? 0));
}

function resolveMerchant(phrase: string, rows: Transaction[]): { merchant?: string; candidates?: string[] } {
  const normalized = normalizeMerchantText(phrase);
  // Collapse exactly the same identity as filterRows and spending drivers:
  // outside whitespace and casing. Punctuation and branch suffixes stay distinct.
  const titles = merchantIndex(rows).resolutionTitles;
  const literal = titles.filter((title) => normalize(title) === normalize(phrase));
  if (literal.length === 1) return { merchant: literal[0] };
  const exact = titles.filter((title) => normalizeMerchantText(title) === normalized);
  if (exact.length === 1) return { merchant: exact[0] };
  const containing = exact.length ? exact : titles.filter((title) => containsPhrase(title, phrase));
  if (containing.length === 1) return { merchant: containing[0] };
  if (containing.length > 1) return { candidates: containing };
  // Typo tolerance: only for phrases long enough that a small edit distance is
  // meaningful, and only when the top match is clearly ahead of the runner-up.
  if (normalized.length < 4) return { candidates: [] };
  const scored = titles.map((title) => {
    const ntitle = normalizeMerchantText(title);
    const distance = editDistance(normalized, ntitle);
    const denom = Math.max(normalized.length, ntitle.length);
    return { title, similarity: denom > 0 ? 1 - distance / denom : 0, distance };
  }).filter(({ similarity, distance }) => similarity >= 0.78 || distance <= 2)
    .sort((a, b) => b.similarity - a.similarity || a.distance - b.distance);
  if (!scored.length) return { candidates: [] };
  const [top, second] = scored;
  const confident = !second || top.similarity - second.similarity >= 0.12;
  if (confident && top.similarity >= 0.78) return { merchant: top.title };
  return { candidates: scored.slice(0, 4).map((entry) => entry.title) };
}

function correctionCategory(text: string): CategoryId | undefined {
  const normalized = normalize(text);
  const beforeNegation = normalized.split(/\b(?:not|instead of|rather than)\b/)[0];
  const before = categoriesFromQuestion(beforeNegation);
  if (before.length === 1) return before[0];
  const after = normalized.match(/\b(?:actually|instead|rather)\b[,:]?\s*(.*)$/)?.[1];
  const afterCategories = after ? categoriesFromQuestion(after) : [];
  return afterCategories.length === 1 ? afterCategories[0] : undefined;
}

function answerTransactionIds(answer?: AssistantAnswer): string[] {
  if (!answer?.evidence?.length) return [];
  return [...new Set(answer.evidence.flatMap((group) => group.transactionIds))];
}

function answerMerchantCandidates(state: AppState, answer?: AssistantAnswer): string[] {
  if (!answer) return [];
  const names = new Set<string>();
  if (answer.tool === 'merchant-breakdown' && answer.title.trim()) names.add(answer.title.trim());
  for (const id of answerTransactionIds(answer)) {
    const row = state.transactions.find((transaction) => transaction.id === id);
    if (row?.title.trim()) names.add(row.title.trim());
  }
  if (answer.tool === 'subscriptions' && answer.facts?.length === 1 && answer.facts[0].label.trim()) {
    names.add(answer.facts[0].label.trim());
  }
  return [...names];
}

/**
 * Parse only explicit, high-confidence ledger corrections. This deliberately
 * refuses ambiguous pronouns/multi-row evidence instead of guessing which row
 * the user intended to change.
 */
export function planAssistantCorrection(
  state: AppState,
  question: string,
  previousAnswer?: AssistantAnswer,
): AssistantCorrectionPlan | undefined {
  let q = normalize(question).replace(/[?!]+$/, '').trim();
  q = q.replace(/\bxfer\b/g, 'transfer');
  if (!q) return undefined;

  const contextualNotSubscription = /^(?:that|this|it)\s+(?:is|was)\s+not\s+(?:a\s+)?(?:subscription|sub|recurring charge)\.?$/.test(q);
  if (contextualNotSubscription) {
    const candidates = answerMerchantCandidates(state, previousAnswer);
    if (candidates.length === 1) return { kind: 'not-subscription', merchant: candidates[0] };
    return { kind: 'clarification',
      body: candidates.length
        ? 'That answer refers to more than one merchant. Choose which one is not a subscription.'
        : 'I cannot tell which recorded merchant “that” refers to. Name the merchant.',
      suggestions: candidates.slice(0, 4).map((merchant) => `${merchant} is not a subscription`) };
  }

  const applyAll = q.match(/^set all matching transactions to (.+)$/);
  if (applyAll) {
    const category = correctionCategory(applyAll[1]);
    const candidates = answerMerchantCandidates(state, previousAnswer);
    if (!category || candidates.length !== 1) return undefined;
    const merchant = candidates[0];
    const matchingRows = state.transactions.filter((row) => normalize(row.title) === normalize(merchant));
    const meta = CATEGORIES.find((item) => item.id === category);
    const recordedTypes = [...new Set(matchingRows.map((row) => row.type))];
    const direction = category === 'other' && recordedTypes.length === 1 ? recordedTypes[0] : meta?.type ?? 'expense';
    if (!matchingRows.some((row) => row.type === direction)) return { kind: 'clarification',
      body: `${merchant} is recorded as ${recordedTypes.join(' and ') || 'an unknown direction'}, so ${categoryLabel(category, 'en')} would not apply to those transactions.` };
    return { kind: 'merchant-category', merchant, category, direction };
  }

  const explicitNotSubscription = q.match(/^(.+?)\s+(?:is|was)\s+not\s+(?:a\s+)?(?:subscription|sub|recurring charge)\.?$/);
  if (explicitNotSubscription && !/^(?:that|this|it)$/.test(explicitNotSubscription[1].trim())) {
    const resolved = resolveMerchant(explicitNotSubscription[1].trim(), state.transactions);
    if (resolved.merchant) return { kind: 'not-subscription', merchant: resolved.merchant };
    return { kind: 'clarification', body: resolved.candidates?.length
      ? `Several recorded merchants match “${explicitNotSubscription[1].trim()}”. Name the exact merchant.`
      : `I could not find a recorded merchant matching “${explicitNotSubscription[1].trim()}”.` };
  }

  const evidenceIds = answerTransactionIds(previousAnswer);
  const transferExternal = /^(?:that|this|it)\s+(?:is|was)\s+(?:not\s+my|an?\s+external|someone else(?:'s)?)\s+transfer\.?$/.test(q);
  const transferOwn = /^(?:that|this|it)\s+(?:is|was)\s+(?:my\s+)?own\s+transfer\.?$|^(?:that|this|it)\s+(?:is|was)\s+(?:a\s+)?transfer\s+between\s+my\s+accounts\.?$/.test(q);
  if (transferExternal || transferOwn) {
    if (evidenceIds.length !== 1) return { kind: 'clarification',
      body: 'That answer contains more than one transaction. Open the transactions behind it and choose the transfer you want to correct.' };
    const row = state.transactions.find((transaction) => transaction.id === evidenceIds[0]);
    if (!row || !isTransferCandidate(row)) return { kind: 'clarification',
      body: 'The referenced transaction is not currently eligible for transfer ownership review.' };
    return { kind: 'transfer-ownership', transactionId: row.id, ownership: transferOwn ? 'own' : 'external' };
  }

  const demonstrative = q.match(/^(?:that|this|it)\s+(?:was|is|should be|belongs? (?:in|to))\s+(.+)$/);
  if (demonstrative) {
    const category = correctionCategory(demonstrative[1]);
    if (!category) return undefined;
    if (evidenceIds.length === 0) return { kind: 'clarification',
      body: 'That answer has no matching transaction to correct.' };
    if (evidenceIds.length !== 1) {
      const merchants = answerMerchantCandidates(state, previousAnswer);
      const label = categoryLabel(category, 'en');
      return { kind: 'clarification',
        body: merchants.length === 1
          ? `That answer contains more than one ${merchants[0]} transaction. Apply ${label} to all matching transactions, or choose one transaction.`
          : 'That answer contains more than one transaction. Choose the transaction you want to correct.',
        suggestions: merchants.length === 1
          ? [`Set all matching transactions to ${label}`, 'Choose one transaction']
          : ['Choose one transaction'] };
    }
    const row = state.transactions.find((transaction) => transaction.id === evidenceIds[0]);
    if (!row) return { kind: 'clarification', body: 'That transaction is no longer available.' };
    if (row.splits?.length) return { kind: 'clarification',
      body: 'That purchase is split across categories. Open the transaction to edit its split amounts rather than replacing the whole purchase category.' };
    const meta = CATEGORIES.find((item) => item.id === category);
    if (meta && meta.type !== row.type && category !== 'other') return { kind: 'clarification',
      body: `${categoryLabel(category, 'en')} is a ${meta.type} category, but that transaction is recorded as ${row.type}.` };
    return { kind: 'transaction-category', transactionId: row.id, category };
  }

  const merchantRule = q.match(/^(.+?)\s+(?:is|was|should be|belongs? (?:in|to))\s+(.+)$/);
  if (merchantRule && !/^(?:what|which|why|how|when|where|who)\b/.test(merchantRule[1])) {
    const category = correctionCategory(merchantRule[2]);
    if (!category) return undefined;
    const resolved = resolveMerchant(merchantRule[1].trim(), state.transactions);
    if (!resolved.merchant) return { kind: 'clarification', body: resolved.candidates?.length
      ? `Several recorded merchants match “${merchantRule[1].trim()}”. Name the exact merchant.`
      : `I could not find a recorded merchant matching “${merchantRule[1].trim()}”.` };
    const meta = CATEGORIES.find((item) => item.id === category);
    const matchingRows = state.transactions.filter((row) => normalize(row.title) === normalize(resolved.merchant!));
    const recordedTypes = [...new Set(matchingRows.map((row) => row.type))];
    const direction = category === 'other' && recordedTypes.length === 1 ? recordedTypes[0] : meta?.type ?? 'expense';
    if (!matchingRows.some((row) => row.type === direction)) return { kind: 'clarification',
      body: `${resolved.merchant} is recorded as ${recordedTypes.join(' and ') || 'an unknown direction'}, so ${categoryLabel(category, 'en')} would not apply to those transactions.` };
    return { kind: 'merchant-category', merchant: resolved.merchant, category, direction };
  }
  return undefined;
}

const filterFields = ['accountIds', 'merchant', 'category', 'merchants', 'categories',
  'excludedMerchants', 'excludedCategories', 'excludedAccountIds'] as const;

function copyFilters(source: AssistantFilters): AssistantFilters {
  return Object.fromEntries(filterFields.filter((key) => source[key] !== undefined)
    .map((key) => [key, Array.isArray(source[key]) ? [...source[key] as string[]] : source[key]]));
}

function clearIncludedContent(filters: AssistantFilters) {
  delete filters.merchant;
  delete filters.merchants;
  delete filters.category;
  delete filters.categories;
}

function accountClarification(state: AppState): AssistantToolRequest {
  const live = liveAccountIds(state.accounts);
  const names = state.accounts.filter((item) => live.has(item.id)).map((item) => item.name).slice(0, 4);
  return clarification('I could not identify that account. Choose its exact name from Accounts.',
    names.map((name) => `How much did I spend from ${name}${/\b(?:account|card)$/i.test(name) ? '' : ' account'}?`));
}

function includedMerchants(filters: AssistantFilters): string[] {
  return filters.merchants ?? (filters.merchant ? [filters.merchant] : []);
}
function includedCategories(filters: AssistantFilters): CategoryId[] {
  return filters.categories ?? (filters.category ? [filters.category] : []);
}
function hasCategoryFilter(filters: AssistantFilters): boolean {
  return !!(includedCategories(filters).length || filters.excludedCategories?.length);
}
function hasContentFilter(filters: AssistantFilters): boolean {
  return hasCategoryFilter(filters) || !!(includedMerchants(filters).length || filters.excludedMerchants?.length);
}

function filterRows(rows: Transaction[], filters: AssistantFilters): Transaction[] {
  const merchants = includedMerchants(filters).map(normalize);
  const excludedMerchants = (filters.excludedMerchants ?? []).map(normalize);
  const categories = includedCategories(filters);
  return rows.filter((row) => (!filters.accountIds || filters.accountIds.includes(row.accountId)) &&
    !filters.excludedAccountIds?.includes(row.accountId) &&
    (!merchants.length || merchants.includes(normalize(row.title))) &&
    !excludedMerchants.includes(normalize(row.title)))
    .flatMap((row) => {
      if (!hasCategoryFilter(filters)) return [row];
      const allocations = allocationsOf(row).filter((part) =>
        (!categories.length || categories.includes(part.category)) && !filters.excludedCategories?.includes(part.category));
      const contribution = checkedMinorSum(allocations.map((part) => part.amountFils));
      // Keep selected allocations, so category breakdowns and driver evidence
      // share the same exact portions without multiplying a split charge.
      return contribution > 0 ? [{ ...row, amountFils: contribution, category: allocations[0].category,
        splits: allocations.length > 1 ? allocations : undefined }] : [];
    });
}

function invalidFilters(state: AppState, filters: AssistantFilters): string | undefined {
  for (const key of filterFields) {
    const value = filters[key];
    if (value === undefined) continue;
    if (key === 'merchant' || key === 'category') {
      if (typeof value !== 'string' || !value.trim()) return 'Every filter needs a recorded name.';
    } else if (!Array.isArray(value) || !value.length || value.length > 20 || value.some((item) => typeof item !== 'string' || !item.trim())) {
      return 'Choose between 1 and 20 exact values for each filter.';
    }
  }
  if ((filters.merchant && filters.merchants) || (filters.category && filters.categories)) {
    return 'The single and multiple filters disagree. Ask with one clear set of values.';
  }
  const live = liveAccountIds(state.accounts);
  if ([...(filters.accountIds ?? []), ...(filters.excludedAccountIds ?? [])].some((id) => !live.has(id))) {
    return 'I could not identify every requested account. Use its exact name from Accounts.';
  }
  if ([...includedCategories(filters), ...(filters.excludedCategories ?? [])].some((id) => !CATEGORIES.some((item) => item.id === id))) {
    return 'I could not identify every category. Use a category name shown in Transactions.';
  }
  const merchantFilters = [...includedMerchants(filters), ...(filters.excludedMerchants ?? [])];
  if (merchantFilters.length > 0) {
    const titles = new Set(merchantIndex(state.transactions).titles.map(normalize));
    if (merchantFilters.some((name) => !titles.has(normalize(name)))) {
      return 'I could not identify every merchant. Use its exact name from Transactions.';
    }
  }
  return undefined;
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

function selectedAccountIds(state: AppState, filters: AssistantFilters): Set<string> {
  return new Set([...liveAccountIds(state.accounts)].filter((id) =>
    (!filters.accountIds || filters.accountIds.includes(id)) && !filters.excludedAccountIds?.includes(id)));
}

function evidenceFor(state: AppState, now: Date, label: string, rows: Transaction[], period?: Period): AssistantEvidence {
  const dates = rows.map((row) => row.date).sort();
  return {
    label,
    ...(period ? scopeDates(period, state, now) : dates.length ? { from: dates[0], to: dates[dates.length - 1] } : {}),
    transactionIds: rows.map((row) => row.id),
    contributions: Object.fromEntries(rows.map((row) => [row.id, row.amountFils])),
    totalFils: total(rows),
    accountNames: [...new Set(rows.map((row) => state.accounts.find((account) => account.id === row.accountId)?.name ?? 'Unassigned'))],
  };
}

function observedCoverage(state: AppState, rows: Transaction[], filters: AssistantFilters, extraNotes: string[] = []): AssistantCoverage {
  const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
  const dates = unique.map((row) => row.date).filter(validISODate).sort();
  const selectedAccounts = new Set(state.accounts.filter((account) => selectedAccountIds(state, filters).has(account.id)).map((account) => account.id));
  const unassignedCount = unique.filter((row) => !selectedAccounts.has(row.accountId)).length;
  const status = state.historyImport?.status;
  const importNote = status === 'complete'
    ? 'The last inbox import finished. This does not confirm that all financial activity is recorded.'
    : status === 'running' ? 'An inbox import is running; recorded totals may change as it continues.'
      : status === 'paused' ? 'An inbox import is paused; more records may remain to import.'
        : status === 'failed' ? 'The last inbox import did not finish; additional records may be unavailable.'
          : 'There is no completed inbox import status available for this view.';
  return {
    recordCount: unique.length,
    ...(dates.length ? { firstDate: dates[0], lastDate: dates[dates.length - 1] } : {}),
    accountCount: new Set(unique.filter((row) => selectedAccounts.has(row.accountId)).map((row) => row.accountId)).size,
    totalAccounts: selectedAccounts.size,
    notes: [...(unassignedCount ? [`${unassignedCount} record${unassignedCount === 1 ? '' : 's'} have no assigned account.`] : []), importNote, 'Recorded dates show observed activity. Days without transactions do not prove missing imports.', ...extraNotes],
  };
}

function driverFinding(state: AppState, now: Date, request: AssistantFilters & { period: Period },
  period: Period, previous: Period, driver: SpendingChangeDriver, dimension: 'category' | 'merchant'): AssistantFinding {
  const title = dimension === 'category' ? categoryLabel(driver.key as CategoryId, 'en') : driver.displayTitle ?? driver.key;
  const fromMap = (contributions: Record<string, number>) => state.transactions.filter((row) => Object.prototype.hasOwnProperty.call(contributions, row.id))
    .map((row) => ({ ...row, amountFils: contributions[row.id] }));
  const filter = copyFilters(request);
  if (dimension === 'category') { delete filter.categories; filter.category = driver.key as CategoryId; }
  else { delete filter.merchants; filter.merchant = title; }
  return {
    id: `${dimension}:${driver.key}`,
    title: `${title} · ${dimension}`,
    body: `${formatLedgerMoney(driver.currentFils)} across ${driver.currentCount} purchase${driver.currentCount === 1 ? '' : 's'}, compared with ${formatLedgerMoney(driver.previousFils)} across ${driver.previousCount}. ${formatLedgerMoney(Math.abs(driver.deltaFils))} ${driver.deltaFils >= 0 ? 'higher' : 'lower'} in recorded spending.`,
    evidence: [evidenceFor(state, now, 'Current contributions', fromMap(driver.currentContributionsFils), period),
      evidenceFor(state, now, 'Earlier contributions', fromMap(driver.previousContributionsFils), previous)],
    question: `Explore ${title}`,
    request: { tool: 'compare-periods', period, comparisonPeriod: previous, ...filter },
  };
}

function patternFinding(state: AppState, now: Date, pattern: AssistantPattern): AssistantFinding {
  const currentRows = state.transactions.filter((row) => pattern.transactionIds.includes(row.id));
  const earlierRows = state.transactions.filter((row) => pattern.baselineTransactionIds.includes(row.id));
  const current = evidenceFor(state, now, pattern.kind === 'possible-duplicate' ? 'Charges to review' : 'Recorded charge', currentRows);
  return {
    id: pattern.id, title: pattern.title,
    body: pattern.kind === 'possible-duplicate'
      ? `${currentRows.length} similar recorded charges are candidates for review. ${pattern.reason} They may be separate purchases; no transaction has been changed.`
      : `${formatLedgerMoney(pattern.amountFils)} recorded, compared with an earlier median of ${formatLedgerMoney(pattern.baselineFils ?? 0)} from ${earlierRows.length} charge${earlierRows.length === 1 ? '' : 's'}. ${pattern.reason}`,
    evidence: [current, ...(earlierRows.length ? [evidenceFor(state, now, 'Earlier charges used for the median', earlierRows)] : [])],
  };
}

function reviewPatternFinding(state: AppState, now: Date, pattern: AssistantPattern): AssistantFinding {
  const finding = patternFinding(state, now, pattern);
  const kind = pattern.kind === 'possible-duplicate' ? 'Possible duplicate'
    : pattern.kind === 'unusual-charge' ? 'Unusual purchase' : 'Recurring change';
  return { ...finding, title: `${kind} · ${finding.title}` };
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

function filtersWithoutAccounts(filters: AssistantFilters): AssistantFilters {
  const next = copyFilters(filters);
  delete next.accountIds;
  delete next.excludedAccountIds;
  return next;
}

interface MonthlySpendingGroup {
  key: string;
  rows: Transaction[];
  totalFils: number;
}

function monthlySpendingGroups(state: AppState, filters: AssistantFilters): MonthlySpendingGroup[] {
  const rows = filterRows(spendingRows(state, { mode: 'all' }), filters)
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date));
  const groups = new Map<string, Transaction[]>();
  for (const row of rows) {
    const key = row.date.slice(0, 7);
    const current = groups.get(key) ?? [];
    current.push(row);
    groups.set(key, current);
  }
  return [...groups.entries()].map(([key, monthRows]) => ({ key, rows: monthRows, totalFils: total(monthRows) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function medianInteger(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle];
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function accountName(state: AppState, id: string): string {
  return state.accounts.find((account) => account.id === id)?.name ?? 'Unknown account';
}

function answerScope(period: Period, now: Date): string {
  if (period.mode === 'month' && isCurrentMonth(period, now) && toISODate(now) < monthEndISO(period.key)) {
    return `${periodLabel(period)} so far`;
  }
  return periodLabel(period);
}

function displayISODate(value: string): string {
  if (!validISODate(value)) return value;
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

function fullMonthLabel(period: Period | null): string | null {
  if (!period || period.mode !== 'month') return null;
  const [year, month] = period.key.split('-').map(Number);
  return `${MONTHS[month - 1][0].toUpperCase()}${MONTHS[month - 1].slice(1)} ${year}`;
}

function previousScopeQuestion(period: Period): string | null {
  const previous = previousPeriod(period);
  const month = fullMonthLabel(previous);
  return month ? `What about ${month}?` : previous ? 'What about the previous period?' : null;
}

function accountSpendingGroups(
  state: AppState,
  period: Period,
  filters: AssistantFilters,
  kind: 'all' | 'bank' | 'card' = 'all',
  metric: 'amount' | 'count' = 'amount',
) {
  const contentFilters = filtersWithoutAccounts(filters);
  const live = liveAccountIds(state.accounts);
  const eligible = new Set(state.accounts.filter((account) => live.has(account.id) &&
    (kind === 'all' || kind === 'card' ? kind === 'all' || account.kind === 'card' : account.kind === 'bank'))
    .map((account) => account.id));
  const rows = filterRows(spendingRows(state, period), contentFilters).filter((row) => eligible.has(row.accountId));
  const groups = new Map<string, Transaction[]>();
  for (const row of rows) {
    const current = groups.get(row.accountId) ?? [];
    current.push(row); groups.set(row.accountId, current);
  }
  return [...groups.entries()].map(([id, accountRows]) => ({
    id, rows: accountRows, totalFils: total(accountRows), count: accountRows.length,
  })).sort((a, b) => metric === 'count'
    ? b.count - a.count || b.totalFils - a.totalFils || accountName(state, a.id).localeCompare(accountName(state, b.id))
    : b.totalFils - a.totalFils || b.count - a.count || accountName(state, a.id).localeCompare(accountName(state, b.id)));
}

function executeAssistantToolResult(
  state: AppState,
  request: AssistantToolRequest,
  now = new Date(),
  derived?: { detectedSubscriptions?: readonly Subscription[] },
): AssistantAnswer {
  const period = 'period' in request ? comparisonPrimaryPeriod(request, now, state) : currentMonthPeriod(now);
  const scope = answerScope(period, now);
  const filters = 'period' in request ? request : {};
  const noSpending = new Set<AssistantTool>([
    'help', 'account-inventory', 'credit-card-settlement-summary', 'obligation-status',
    'data-coverage', 'subscriptions', 'upcoming-payments', 'income-total', 'cash-outflow',
  ]);
  const spending = noSpending.has(request.tool) ? [] : filterRows(spendingRows(state, period), filters);
  const income = request.tool === 'income-total' || request.tool === 'net-income-spending'
    ? filterRows(incomeRows(state, period), filters)
    : [];

  switch (request.tool) {
    case 'help':
      return {
        tool: request.tool,
        title: request.clarification ? 'Let’s clarify that' : 'What you can ask',
        body: request.clarification ?? 'Ask Wafra about spending, income, merchants, categories, accounts/cards, card and bill status, historical monthly baselines, subscriptions, upcoming payments, cash outflow, period comparisons, daily averages, largest purchases, or a month forecast.',
        suggestions: request.suggestions ?? ['How much did I spend?', 'Why did my spending change?', 'What payments are due soon?'],
      };

    case 'account-inventory': {
      const live = liveAccountIds(state.accounts);
      const bankName = request.bankName;
      const bankIdentity = bankName ? normalize(bankBrandForName(bankName)?.name ?? bankName) : null;
      const matches = state.accounts.filter((account) => {
        if (!live.has(account.id)) return false;
        const kindMatches = request.accountKind === 'bank'
          ? account.kind === 'bank'
          : request.accountKind === 'card'
            ? account.kind === 'card'
            : request.accountKind === 'credit-card'
              ? account.kind === 'card' && account.cardType === 'credit'
              : request.accountKind === 'debit-card'
                ? account.kind === 'card' && account.cardType === 'debit'
                : true;
        if (!kindMatches) return false;
        if (!bankIdentity) return true;
        const accountBank = bankBrandForName(account.bankName ?? account.name)?.name ?? account.bankName;
        return !!accountBank && normalize(accountBank) === bankIdentity;
      });
      const singular = request.accountKind === 'credit-card' ? 'credit card'
        : request.accountKind === 'debit-card' ? 'debit card'
          : request.accountKind === 'card' ? 'card'
            : request.accountKind === 'bank' ? 'bank account' : 'account';
      const plural = `${singular}${singular.endsWith('account') ? 's' : 's'}`;
      const label = matches.length === 1 ? singular : plural;
      const bankPrefix = bankName ? `${bankName} ` : '';
      return {
        tool: request.tool,
        title: bankName ? `${bankName} ${matches.length === 1 ? singular : plural}` : `Recorded ${matches.length === 1 ? singular : plural}`,
        headline: `${matches.length} ${label}`,
        body: matches.length
          ? `I found ${matches.length} recorded ${bankPrefix}${label} in Wafra.`
          : `I do not see any recorded ${bankPrefix}${plural} in Wafra.`,
        facts: matches.slice(0, 10).map((account) => ({
          label: accountChoiceLabel(account),
          value: account.bankName ?? bankBrandForName(account.name)?.name ?? (account.kind === 'card' ? 'Card' : 'Account'),
        })),
        suggestions: matches.length > 1 && request.accountKind === 'credit-card'
          ? ['Which card did I use most?', 'Did I settle my credit card?']
          : ['Which account did I use most?', 'What payments are due soon?'],
        data: { accountCount: matches.length, accountKind: request.accountKind ?? 'all', bankName: bankName ?? null },
      };
    }

    case 'credit-card-settlement-summary': {
      const cards = creditCards(state);
      const statementMonth = request.monthKey
        ? fullMonthLabel({ mode: 'month', key: request.monthKey }) ?? request.monthKey
        : null;
      if (!cards.length) return {
        tool: request.tool, title: 'Credit card status', headline: 'No recorded credit cards',
        body: 'I do not see any active recorded credit cards in Wafra.', destination: '/bills',
        suggestions: ['Show me my credit cards', 'What payments are due soon?'],
        data: { cardCount: 0, statementCount: 0, settledCount: 0, unsettledCount: 0, unknownCount: 0, remainingFils: 0, allSettled: false },
      };
      const details = cards.map((account) => {
        const due = state.cardDues.filter((item) => item.accountId === account.id &&
          (!request.monthKey || item.dueDate.slice(0, 7) === request.monthKey))
          .slice().sort((a, b) => b.dueDate.localeCompare(a.dueDate))[0];
        if (!due || due.totalDueFils <= 0) return { account, due: null, settled: false, remainingFils: null as number | null };
        const status = dueWithStatus(state, due, now);
        return { account, due, settled: status.status === 'settled', remainingFils: status.remainingFils as number | null };
      });
      const known = details.filter((item) => item.due !== null);
      const settledCount = known.filter((item) => item.settled).length;
      const unsettledCount = known.length - settledCount;
      const unknownCount = details.length - known.length;
      const remainingFils = checkedMinorSum(known.map((item) => item.remainingFils ?? 0));
      const allSettled = details.length > 0 && unsettledCount === 0 && unknownCount === 0;
      const scopeText = statementMonth ? ` for ${statementMonth}` : '';
      const headline = allSettled
        ? `All ${details.length} settled`
        : unknownCount > 0
          ? `${settledCount} settled · ${unsettledCount} due · ${unknownCount} unconfirmed`
          : `${unsettledCount} of ${details.length} still due`;
      const body = allSettled
        ? `All ${details.length} recorded credit-card statements${scopeText} are settled based on Wafra's recorded statement totals and matched payments.`
        : `Across ${details.length} recorded credit cards${scopeText}, ${settledCount} ${settledCount === 1 ? 'is' : 'are'} settled, ${unsettledCount} ${unsettledCount === 1 ? 'still has' : 'still have'} an amount due${unknownCount ? `, and ${unknownCount} ${unknownCount === 1 ? 'does' : 'do'} not have a recorded statement total to confirm` : ''}.`;
      return {
        tool: request.tool, title: 'Credit card status', headline,
        meta: statementMonth ?? 'Latest recorded statements', body,
        facts: details.map((item) => ({
          label: accountChoiceLabel(item.account),
          value: item.due === null ? 'No statement recorded'
            : item.settled ? 'Settled' : `${formatLedgerMoney(item.remainingFils ?? 0)} remaining`,
        })),
        destination: '/bills',
        suggestions: ['What payments are due soon?', 'Which card did I use most?', 'Show me my credit cards'],
        data: { cardCount: details.length, statementCount: known.length, settledCount, unsettledCount, unknownCount, remainingFils, allSettled },
      };
    }

    case 'obligation-status': {
      if (request.obligation === 'card') {
        const account = state.accounts.find((item) => item.id === request.accountId && item.cardType === 'credit');
        if (!account) return { tool: 'help', title: 'Let’s clarify that',
          body: 'I cannot find that recorded credit card anymore. Choose a card from Accounts.' };
        const due = state.cardDues.filter((item) => item.accountId === account.id &&
          (!request.monthKey || item.dueDate.slice(0, 7) === request.monthKey))
          .slice().sort((a, b) => b.dueDate.localeCompare(a.dueDate))[0];
        const statementMonth = request.monthKey
          ? fullMonthLabel({ mode: 'month', key: request.monthKey }) ?? request.monthKey
          : null;
        const statementDescriptor = statementMonth ? `statement due in ${statementMonth}` : 'latest statement';
        if (!due || due.totalDueFils <= 0) {
          const snapshot = account.snapshotKind === 'outstanding' && account.snapshotFils !== undefined
            ? [{ label: 'Latest bank outstanding', value: formatLedgerMoney(account.snapshotFils) }] : [];
          return {
            tool: request.tool,
            title: 'Card status',
            headline: 'Can’t confirm settlement',
            meta: statementMonth ? `${account.name} · ${statementMonth}` : account.name,
            body: `I do not have a recorded statement total for ${account.name}${statementMonth ? ` for ${statementMonth}` : ''}, so I cannot confirm whether it is settled.${snapshot.length ? ' I do have a bank-reported outstanding snapshot, but that is not the same as a statement settlement.' : ''}`,
            facts: snapshot,
            destination: '/bills',
            suggestions: ['What payments are due soon?', 'What is my data coverage?'],
            data: { obligationKind: 'card', settled: false, statementAvailable: false },
          };
        }

        const status = dueWithStatus(state, due, now);
        const payments = duePayments(state, due);
        const paidFils = Math.max(0, due.totalDueFils - status.remainingFils);
        const latestMatchedPaymentDate = payments[0]?.date;
        const recordedSettlementDate = due.settledAt?.slice(0, 10) || undefined;
        const latestPaymentDate = latestMatchedPaymentDate ?? recordedSettlementDate;
        const settled = status.status === 'settled';
        const paymentEvidence = payments.length ? [evidenceFor(state, now, 'Matched card payments', payments)] : undefined;
        const dueLabel = displayISODate(due.dueDate);
        const commonFacts = [
          { label: 'Statement total', value: formatLedgerMoney(due.totalDueFils) },
          { label: 'Recorded paid', value: formatLedgerMoney(paidFils) },
          { label: 'Remaining', value: formatLedgerMoney(status.remainingFils) },
          { label: 'Due date', value: dueLabel },
          ...(latestPaymentDate ? [{ label: latestMatchedPaymentDate ? 'Latest matched payment' : 'Recorded payment date',
            value: displayISODate(latestPaymentDate) }] : []),
        ];

        if (request.query === 'paid-date') {
          return {
            tool: request.tool,
            title: 'Card payment timing',
            headline: latestPaymentDate ? displayISODate(latestPaymentDate) : 'Payment date unavailable',
            meta: `${account.name} · ${settled ? 'statement settled' : `${formatLedgerMoney(status.remainingFils)} remaining`}`,
            body: latestPaymentDate
              ? `${latestMatchedPaymentDate ? `The latest payment Wafra matched to ${account.name}'s ${statementDescriptor}` : `Wafra's recorded payment date for ${account.name}'s ${statementDescriptor}`} is ${displayISODate(latestPaymentDate)}. ${settled ? 'The recorded statement is settled.' : `${formatLedgerMoney(status.remainingFils)} is still remaining.`}`
              : `I do not have a dated payment transaction matched to ${account.name}'s ${statementDescriptor}.`,
            facts: commonFacts,
            evidence: paymentEvidence,
            destination: '/bills',
            suggestions: ['How much is left?', 'Show the payments'],
            data: { obligationKind: 'card', settled, statementAvailable: true, totalDueFils: due.totalDueFils,
              paidFils, remainingFils: status.remainingFils, paymentCount: payments.length,
              dueDate: due.dueDate, latestPaymentDate: latestPaymentDate ?? null },
          };
        }

        if (request.query === 'payments') {
          return {
            tool: request.tool,
            title: 'Card payments',
            headline: formatLedgerMoney(paidFils),
            meta: `${account.name} · ${payments.length} matched payment${payments.length === 1 ? '' : 's'} · ${statementDescriptor}`,
            body: `Wafra has ${formatLedgerMoney(paidFils)} recorded against ${account.name}'s ${statementDescriptor} of ${formatLedgerMoney(due.totalDueFils)}.${status.remainingFils ? ` ${formatLedgerMoney(status.remainingFils)} remains.` : ' The statement is settled.'}`,
            facts: commonFacts,
            evidence: paymentEvidence,
            destination: '/bills',
            suggestions: ['How much is left?', 'When did I pay it?'],
            data: { obligationKind: 'card', settled, statementAvailable: true, totalDueFils: due.totalDueFils,
              paidFils, remainingFils: status.remainingFils, paymentCount: payments.length,
              dueDate: due.dueDate, latestPaymentDate: latestPaymentDate ?? null },
          };
        }

        const headline = settled ? 'Settled' : `${formatLedgerMoney(status.remainingFils)} remaining`;
        return {
          tool: request.tool,
          title: request.query === 'remaining' ? 'Card balance due' : 'Card status',
          headline,
          meta: `${account.name} · ${formatLedgerMoney(paidFils)} recorded paid of ${formatLedgerMoney(due.totalDueFils)} · due ${dueLabel}`,
          body: settled
            ? `${account.name}'s ${statementDescriptor} is settled. Wafra records enough payment against the ${formatLedgerMoney(due.totalDueFils)} statement to bring its remaining amount to zero.`
            : `${account.name}'s ${statementDescriptor} is not fully settled. Wafra has ${formatLedgerMoney(paidFils)} recorded paid against ${formatLedgerMoney(due.totalDueFils)}, leaving ${formatLedgerMoney(status.remainingFils)} due.`,
          facts: commonFacts,
          evidence: paymentEvidence,
          destination: '/bills',
          suggestions: settled ? ['When did I pay it?', 'Show the payments'] : ['When did I last pay it?', 'Show the payments'],
          data: { obligationKind: 'card', settled, statementAvailable: true, totalDueFils: due.totalDueFils,
            paidFils, remainingFils: status.remainingFils, paymentCount: payments.length,
            dueDate: due.dueDate, latestPaymentDate: latestPaymentDate ?? null },
        };
      }

      const bill = state.bills.find((item) => item.id === request.billId);
      if (!bill) return { tool: 'help', title: 'Let’s clarify that',
        body: 'I cannot find that bill reminder anymore. Choose a bill from Bills.' };
      const { live, internal } = ledgerScope(state);
      const current = billsForMonth(state.bills, state.transactions, now, live, internal)
        .find((item) => item.bill.id === bill.id);
      if (!current) {
        return {
          tool: request.tool, title: 'Bill status', headline: 'Not due this month', meta: bill.title,
          body: `${bill.title} is not scheduled in the current Wafra month.`, destination: '/bills',
          suggestions: ['What payments are due soon?'],
          data: { obligationKind: 'bill', paid: false, dueThisMonth: false, amountFils: bill.amountFils },
        };
      }
      const paid = current.status === 'paid';
      const remaining = paid ? 0 : bill.amountFils;
      const dueDate = displayISODate(current.dueISO);
      const facts = [
        { label: 'Expected amount', value: formatLedgerMoney(bill.amountFils) },
        { label: 'Remaining', value: formatLedgerMoney(remaining) },
        { label: 'Due date', value: dueDate },
      ];
      if (request.query === 'paid-date') {
        return {
          tool: request.tool, title: 'Bill payment timing',
          headline: paid ? 'Paid this month' : 'No paid status recorded', meta: bill.title,
          body: paid
            ? `${bill.title} is marked paid for the current Wafra month${current.autoReconciled ? ' from a matching recorded transaction' : ''}, but this reminder does not store an exact payment date.`
            : `${bill.title} is not marked paid for the current Wafra month.`,
          facts, destination: '/bills', suggestions: ['How much is left?', 'What payments are due soon?'],
          data: { obligationKind: 'bill', paid, dueThisMonth: true, amountFils: bill.amountFils,
            remainingFils: remaining, dueDate: current.dueISO, autoReconciled: !!current.autoReconciled },
        };
      }
      return {
        tool: request.tool, title: 'Bill status',
        headline: paid ? 'Paid' : `${formatLedgerMoney(remaining)} due`,
        meta: `${bill.title} · due ${dueDate}`,
        body: paid
          ? `${bill.title} is marked paid for the current Wafra month${current.autoReconciled ? ' from a matching recorded transaction' : ''}.`
          : `${bill.title} is not marked paid for the current Wafra month. ${formatLedgerMoney(remaining)} is still due.`,
        facts, destination: '/bills',
        suggestions: paid ? ['When did I pay it?', 'What payments are due soon?'] : ['How much is left?', 'What payments are due soon?'],
        data: { obligationKind: 'bill', paid, dueThisMonth: true, amountFils: bill.amountFils,
          remainingFils: remaining, dueDate: current.dueISO, autoReconciled: !!current.autoReconciled },
      };
    }

    case 'data-coverage': {
      const accounts = selectedAccountIds(state, request);
      const rows = filterRows(state.transactions.filter((row) => accounts.has(row.accountId) && inPeriod(row.date, period)), request);
      const coverage = observedCoverage(state, rows, request);
      return { tool: request.tool, title: 'Recorded history',
        body: `${coverage.recordCount} recorded transaction${coverage.recordCount === 1 ? '' : 's'} match this view in ${scope}, across ${coverage.accountCount} account${coverage.accountCount === 1 ? '' : 's'} represented out of ${coverage.totalAccounts} available. This describes the records available to Wafra, not complete financial coverage.`,
        coverage, data: { recordCount: coverage.recordCount, accountCount: coverage.accountCount, totalAccounts: coverage.totalAccounts } };
    }
    case 'money-review': {
      const history = filterRows(spendingRows(state, { mode: 'all' }), request);
      const duplicatePatterns = findPossibleDuplicates(history, spending, now);
      const unusualPatterns = findUnusualCharges(history, spending, now);
      const recurringPatterns = findRecurringChanges(history, spending, now, state.notSubscriptions);
      const combined = [...duplicatePatterns, ...unusualPatterns, ...recurringPatterns];
      const seen = new Set<string>();
      const shown = combined.filter((pattern) => {
        const key = [...pattern.transactionIds].sort().join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 6);
      const coverage = patternAnalysisCoverage(spending, now);
      const counts = {
        duplicateCount: duplicatePatterns.length,
        unusualCount: unusualPatterns.length,
        recurringChangeCount: recurringPatterns.length,
      };
      return {
        tool: request.tool,
        title: 'Things to review',
        body: shown.length
          ? `I found ${shown.length} recorded pattern${shown.length === 1 ? '' : 's'} worth reviewing in ${scope}: ${counts.duplicateCount} possible duplicate group${counts.duplicateCount === 1 ? '' : 's'}, ${counts.unusualCount} unusual purchase${counts.unusualCount === 1 ? '' : 's'}, and ${counts.recurringChangeCount} recurring charge change${counts.recurringChangeCount === 1 ? '' : 's'}. These are conservative signals, not proof that anything is wrong.`
          : `I did not find a duplicate, unusual-purchase, or recurring-change candidate that met the conservative checks in ${scope}. That does not confirm every charge was expected or that the recorded history is complete.`,
        findings: shown.map((pattern) => reviewPatternFinding(state, now, pattern)),
        coverage: observedCoverage(state, spending, request, [
          'Combined review checks duplicates, unusually large same-merchant charges, and recurring amount changes only when enough comparable history exists.',
          'Split receipts and charges with conversion metadata may be excluded from pattern checks.',
        ]),
        suggestions: ['Show possible duplicate charges', 'Show unusual charges', 'Which recurring charges changed?'],
        data: { ...counts, candidateCount: shown.length, additionalCandidates: combined.length > shown.length,
          eligibleChargeCount: coverage.eligibleCount, skippedFxCount: coverage.skippedFxCount, skippedSplitCount: coverage.skippedSplitCount },
      };
    }
    case 'recurring-changes':
    case 'unusual-charges':
    case 'possible-duplicates': {
      const history = filterRows(spendingRows(state, { mode: 'all' }), request);
      const patterns = request.tool === 'recurring-changes' ? findRecurringChanges(history, spending, now, state.notSubscriptions)
        : request.tool === 'unusual-charges' ? findUnusualCharges(history, spending, now)
          : findPossibleDuplicates(history, spending, now);
      const shownPatterns = patterns.slice(0, 3);
      const coverage = patternAnalysisCoverage(spending, now);
      const notes = [
        'This view shows up to 3 recent candidates; additional candidates may not be shown.',
        'Pattern checks use comparable whole charges. Split receipts and charges with currency conversion metadata are excluded.',
        ...(coverage.skippedFxCount ? [`${coverage.skippedFxCount} charge${coverage.skippedFxCount === 1 ? '' : 's'} excluded because of currency conversion metadata.`] : []),
        ...(coverage.skippedSplitCount ? [`${coverage.skippedSplitCount} split receipt${coverage.skippedSplitCount === 1 ? '' : 's'} excluded.`] : []),
        ...(!patterns.length ? ['No candidate met the conservative checks. Missing candidates can reflect insufficient comparable earlier history.'] : []),
      ];
      return {
        tool: request.tool,
        title: request.tool === 'recurring-changes' ? 'Recurring charge changes' : request.tool === 'unusual-charges' ? 'Unusual purchases' : 'Possible duplicate charges',
        body: patterns.length ? `Showing ${shownPatterns.length} recent candidate${shownPatterns.length === 1 ? '' : 's'} in ${scope}. ${request.tool === 'possible-duplicates' ? 'Review the original records before deciding whether charges are duplicates.' : 'These patterns compare recorded charges; they do not establish fraud or a merchant price change.'}`
          : `No ${request.tool === 'possible-duplicates' ? 'possible duplicate' : request.tool === 'unusual-charges' ? 'unusual purchase' : 'recurring change'} candidates met the checks in ${scope}. This does not confirm that every charge was expected or that the imported history is complete.`,
        findings: shownPatterns.map((pattern) => patternFinding(state, now, pattern)),
        coverage: observedCoverage(state, spending, request, notes),
        data: { candidateCount: shownPatterns.length, additionalCandidates: patterns.length > shownPatterns.length, eligibleChargeCount: coverage.eligibleCount, skippedFxCount: coverage.skippedFxCount, skippedSplitCount: coverage.skippedSplitCount },
      };
    }

    case 'subscriptions': {
      const { live, internal } = ledgerScope(state);
      const subs = activeSubscriptions(trueSubscriptions(
        derived?.detectedSubscriptions
          ? [...derived.detectedSubscriptions]
          : detectSubscriptions(state.transactions, state.notSubscriptions, now, live, internal),
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
      const label = categoryLabel(request.category);
      const previous = previousScopeQuestion(period);
      return {
        tool: request.tool,
        title: label,
        body: rows.length
          ? `In ${scope}, you spent ${formatLedgerMoney(amount)} across ${rows.length} transaction${rows.length === 1 ? '' : 's'} in ${label}.`
          : `No recorded ${label.toLowerCase()} spending in ${scope}.`,
        headline: rows.length ? formatLedgerMoney(amount) : 'No recorded spending',
        meta: `${label} · ${rows.length} transaction${rows.length === 1 ? '' : 's'} · ${scope}`,
        facts: groupedCategoryMerchants(rows, request.category)
          .slice(0, 5)
          .map((item) => ({ label: item.key, value: formatLedgerMoney(item.totalFils) })),
        ...(rows.length ? {} : { suggestions: [previous, 'What is my data coverage?'].filter((value): value is string => !!value) }),
        data: { totalFils: amount, transactionCount: rows.length, category: request.category },
      };
    }

    case 'merchant-breakdown': {
      const rows = spending.filter((tx) => normalize(tx.title) === normalize(request.merchant));
      const amount = total(rows);
      const average = rows.length > 0 ? Math.round(amount / rows.length) : 0;
      const largest = rows.reduce((max, row) => Math.max(max, row.amountFils), 0);
      const previous = previousScopeQuestion(period);
      return {
        tool: request.tool,
        title: request.merchant,
        body: rows.length
          ? `In ${scope}, you spent ${formatLedgerMoney(amount)} at ${request.merchant} across ${rows.length} transaction${rows.length === 1 ? '' : 's'}.`
          : `No recorded ${request.merchant} transactions in ${scope}.`,
        headline: rows.length ? formatLedgerMoney(amount) : 'No recorded transactions',
        meta: `${request.merchant} · ${rows.length} transaction${rows.length === 1 ? '' : 's'} · ${scope}`,
        facts: rows.length ? [
          { label: 'Average purchase', value: formatLedgerMoney(average) },
          { label: 'Largest purchase', value: formatLedgerMoney(largest) },
        ] : [],
        ...(rows.length ? {} : { suggestions: [previous, 'What is my data coverage?'].filter((value): value is string => !!value) }),
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
      const priorRows = previous ? filterRows(spendingRows(state, previous), filters) : [];
      const analysis = spendingChangeDrivers(spending, priorRows);
      const categoryDrivers = analysis.categoryDrivers.filter((driver) => driver.deltaFils !== 0);
      const merchantDrivers = analysis.merchantDrivers.filter((driver) => driver.deltaFils !== 0);
      const categoryChanges = categoryDrivers.map((driver) => ({ key: driver.key, delta: driver.deltaFils }));
      const candidates: { driver: SpendingChangeDriver; dimension: 'category' | 'merchant' }[] = [
        ...categoryDrivers.map((driver) => ({ driver, dimension: 'category' as const })),
        ...merchantDrivers.map((driver) => ({ driver, dimension: 'merchant' as const })),
      ].sort((a, b) => Math.abs(b.driver.deltaFils) - Math.abs(a.driver.deltaFils));
      const featured = [candidates.find((candidate) => candidate.dimension === 'category'),
        candidates.find((candidate) => candidate.dimension === 'merchant')].filter((candidate) => candidate !== undefined);
      const next = candidates.find((candidate) => !featured.includes(candidate));
      if (next) featured.push(next);
      // Bound proof construction before scanning source rows. The full totals
      // and overall comparison proof still include every scoped contribution.
      const drivers = featured.slice(0, 3).map(({ driver, dimension }) =>
        driverFinding(state, now, request, period, previous ?? period, driver, dimension));
      const sameDirection = (driver: SpendingChangeDriver) => delta === 0 ? false : driver.deltaFils * delta > 0;
      const primaryCategory = categoryDrivers.find(sameDirection);
      const primaryMerchant = merchantDrivers.find(sameDirection);
      const largestCurrent = [...spending].sort((a, b) => b.amountFils - a.amountFils || b.date.localeCompare(a.date))[0];
      const purchaseDelta = analysis.currentCount - analysis.previousCount;
      const purchaseCountSummary = purchaseDelta === 0
        ? `There were ${analysis.currentCount} purchases in both periods.`
        : `There were ${analysis.currentCount} purchases, ${Math.abs(purchaseDelta)} ${purchaseDelta > 0 ? 'more' : 'fewer'} than before.`;
      const driverSummary = prior > 0 && delta !== 0
        ? [primaryCategory ? `${categoryLabel(primaryCategory.key, 'en')} was the biggest category driver (${primaryCategory.deltaFils >= 0 ? '+' : '−'}${formatLedgerMoney(Math.abs(primaryCategory.deltaFils))})` : '',
          primaryMerchant ? `${primaryMerchant.displayTitle ?? primaryMerchant.key} was the biggest merchant driver (${primaryMerchant.deltaFils >= 0 ? '+' : '−'}${formatLedgerMoney(Math.abs(primaryMerchant.deltaFils))})` : '']
          .filter(Boolean).join('; ')
        : '';
      return {
        tool: request.tool,
        title: 'Spending change',
        body: prior === 0
          ? `You spent ${formatLedgerMoney(current)} in ${scope}. I do not have enough earlier spending to make a reliable comparison.`
          : `You spent ${formatLedgerMoney(current)} in ${scope}, ${pct}% ${delta >= 0 ? 'more' : 'less'} than ${previousScope}. ${driverSummary ? `${driverSummary}. ` : ''}${purchaseCountSummary}${largestCurrent ? ` The largest recorded purchase was ${formatLedgerMoney(largestCurrent.amountFils)} at ${largestCurrent.title}.` : ''} Category and merchant drivers are two views of the same spending, so they should not be added together.`,
        facts: [
          { label: scope, value: formatLedgerMoney(current) },
          { label: previousScope ?? 'Previous period', value: formatLedgerMoney(prior) },
          { label: 'Purchase count change', value: `${purchaseDelta >= 0 ? '+' : '−'}${Math.abs(purchaseDelta)}` },
          ...(primaryMerchant ? [{ label: 'Top merchant driver', value: `${primaryMerchant.displayTitle ?? primaryMerchant.key} · ${primaryMerchant.deltaFils >= 0 ? '+' : '−'}${formatLedgerMoney(Math.abs(primaryMerchant.deltaFils))}` }] : []),
          ...(largestCurrent ? [{ label: 'Largest current purchase', value: `${largestCurrent.title} · ${formatLedgerMoney(largestCurrent.amountFils)}` }] : []),
          ...categoryChanges.slice(0, 3).map((item) => ({
            label: `${categoryLabel(item.key)} change`,
            value: `${item.delta >= 0 ? '+' : '−'}${formatLedgerMoney(Math.abs(item.delta))}`,
          })),
        ],
        findings: previous ? drivers : [],
        data: { currentFils: current, previousFils: prior, deltaFils: delta, deltaPercent: pct,
          currentCount: analysis.currentCount, previousCount: analysis.previousCount, purchaseCountDelta: purchaseDelta,
          largestPurchaseFils: largestCurrent?.amountFils ?? 0 },
      };
    }

    case 'historical-baseline': {
      const months = monthlySpendingGroups(state, request);
      const currentRows = filterRows(spendingRows(state, period), request);
      const currentTotal = total(currentRows);
      if (!months.length) return { tool: request.tool, title: 'Spending history',
        body: 'I do not have recorded spending history for that scope yet.', data: { monthsAnalyzed: 0, currentFils: currentTotal } };
      if (request.baseline === 'highest-month') {
        const highest = [...months].sort((a, b) => b.totalFils - a.totalFils || b.key.localeCompare(a.key))[0];
        const selectedKey = period.mode === 'month' ? period.key : (periodStartISO(period, state.transactions) ?? '').slice(0, 7);
        const selectedIsHighest = selectedKey === highest.key;
        const selectedMonth = months.find((month) => month.key === selectedKey);
        return {
          tool: request.tool, title: 'Highest recorded month',
          body: selectedIsHighest
            ? `Yes. ${scope} is the highest recorded monthly spending for this scope at ${formatLedgerMoney(highest.totalFils)} across ${months.length} month${months.length === 1 ? '' : 's'} with recorded spending. Months with no recorded transactions are not treated as zero.`
            : `No. ${scope} recorded ${formatLedgerMoney(selectedMonth?.totalFils ?? currentTotal)}. ${highest.key} is the highest recorded month at ${formatLedgerMoney(highest.totalFils)} across ${months.length} month${months.length === 1 ? '' : 's'} with recorded spending.`,
          facts: [{ label: 'Highest month', value: `${highest.key} · ${formatLedgerMoney(highest.totalFils)}` },
            { label: 'Current selection', value: formatLedgerMoney(currentTotal) }],
          data: { monthsAnalyzed: months.length, baselineFils: highest.totalFils, currentFils: currentTotal, monthKey: highest.key,
            selectedIsHighest },
          monthlySeries: monthlySeriesOf(months, highest.key),
          monthlySeriesHighlight: highest.key,
        };
      }
      if (request.baseline === 'typical-month') {
        const currentStart = periodStartISO(period, state.transactions) ?? toISODate(now);
        const priorMonths = months.filter((month) => month.key < currentStart.slice(0, 7)).slice(-12);
        if (priorMonths.length < 3) return { tool: request.tool, title: 'Typical recorded month',
          body: `I only have ${priorMonths.length} earlier month${priorMonths.length === 1 ? '' : 's'} with recorded spending for this scope. I need at least 3 earlier recorded months before calling a monthly level typical.`,
          data: { monthsAnalyzed: priorMonths.length, currentFils: currentTotal, baselineFils: null } };
        const typical = medianInteger(priorMonths.map((month) => month.totalFils));
        const delta = checkedMinorSum([currentTotal, -typical]);
        return {
          tool: request.tool, title: 'Typical recorded month',
          body: `The median across the ${priorMonths.length} most recent earlier months with recorded spending is ${formatLedgerMoney(typical)}. Your selected period is ${formatLedgerMoney(currentTotal)}, ${formatLedgerMoney(Math.abs(delta))} ${delta >= 0 ? 'above' : 'below'} that recorded median. Months with no recorded transactions are excluded rather than assumed to be zero.`,
          facts: [{ label: 'Recorded monthly median', value: formatLedgerMoney(typical) },
            { label: 'Selected period', value: formatLedgerMoney(currentTotal) }],
          data: { monthsAnalyzed: priorMonths.length, baselineFils: typical, currentFils: currentTotal, deltaFils: delta },
          monthlySeries: monthlySeriesOf(priorMonths),
        };
      }
      const currentStart = periodStartISO(period, state.transactions) ?? toISODate(now);
      const earlier = months.filter((month) => month.key < currentStart.slice(0, 7));
      if (!earlier.length) return { tool: request.tool, title: 'Closest earlier month',
        body: 'I do not have an earlier recorded month for that scope to compare with this amount.',
        data: { monthsAnalyzed: months.length, currentFils: currentTotal, baselineFils: null } };
      if (request.baseline === 'last-similar-month') {
        const tolerance = Math.max(1, Math.round(Math.abs(currentTotal) * 0.1));
        const recentFirst = [...earlier].sort((a, b) => b.key.localeCompare(a.key));
        const similar = currentTotal > 0
          ? recentFirst.find((month) => Math.abs(month.totalFils - currentTotal) <= tolerance)
          : undefined;
        if (similar) return {
          tool: request.tool, title: 'Last similar month',
          body: `${similar.key} is the most recent earlier recorded month within 10% of this amount: ${formatLedgerMoney(similar.totalFils)} versus ${formatLedgerMoney(currentTotal)} now.`,
          facts: [{ label: similar.key, value: formatLedgerMoney(similar.totalFils) },
            { label: 'Selected period', value: formatLedgerMoney(currentTotal) }],
          data: { monthsAnalyzed: earlier.length, baselineFils: similar.totalFils, currentFils: currentTotal,
            deltaFils: checkedMinorSum([currentTotal, -similar.totalFils]), monthKey: similar.key, similarFound: true },
        };
        const nearest = [...earlier].sort((a, b) => Math.abs(a.totalFils - currentTotal) - Math.abs(b.totalFils - currentTotal) || b.key.localeCompare(a.key))[0];
        return {
          tool: request.tool, title: 'No similar earlier month',
          body: `I do not see an earlier recorded month within 10% of ${formatLedgerMoney(currentTotal)}. The closest recorded month was ${nearest.key} at ${formatLedgerMoney(nearest.totalFils)}, so I am not calling it the last time you spent this much.`,
          facts: [{ label: 'Closest recorded month', value: `${nearest.key} · ${formatLedgerMoney(nearest.totalFils)}` },
            { label: 'Selected period', value: formatLedgerMoney(currentTotal) }],
          data: { monthsAnalyzed: earlier.length, baselineFils: null, currentFils: currentTotal,
            nearestFils: nearest.totalFils, nearestMonthKey: nearest.key, similarFound: false },
        };
      }
      const closest = [...earlier].sort((a, b) => Math.abs(a.totalFils - currentTotal) - Math.abs(b.totalFils - currentTotal) || b.key.localeCompare(a.key))[0];
      return {
        tool: request.tool, title: 'Closest earlier month',
        body: `${closest.key} is the earlier recorded month closest to your selected period: ${formatLedgerMoney(closest.totalFils)} versus ${formatLedgerMoney(currentTotal)} now. This is the nearest recorded monthly total, not a claim that the histories are complete.`,
        facts: [{ label: closest.key, value: formatLedgerMoney(closest.totalFils) },
          { label: 'Selected period', value: formatLedgerMoney(currentTotal) }],
        data: { monthsAnalyzed: earlier.length, baselineFils: closest.totalFils, currentFils: currentTotal,
          deltaFils: checkedMinorSum([currentTotal, -closest.totalFils]), monthKey: closest.key },
      };
    }

    case 'top-accounts': {
      const metric = request.metric ?? 'amount';
      const groups = accountSpendingGroups(state, period, request, request.accountKind ?? 'all', metric);
      const limit = Math.max(1, Math.min(request.limit ?? 5, 10));
      const shown = groups.slice(0, limit);
      const kind = request.accountKind === 'card' ? 'card' : request.accountKind === 'bank' ? 'account' : 'account/card';
      return {
        tool: request.tool, title: `Top ${kind}${kind === 'account/card' ? 's' : 's'}`,
        body: shown.length ? metric === 'count'
          ? `${accountName(state, shown[0].id)} was used for the most recorded purchases in ${scope}: ${shown[0].count} transaction${shown[0].count === 1 ? '' : 's'}, totaling ${formatLedgerMoney(shown[0].totalFils)}.`
          : `${accountName(state, shown[0].id)} has the most recorded spending in ${scope} at ${formatLedgerMoney(shown[0].totalFils)}.`
          : `I do not see recorded spending on matching ${kind}s in ${scope}.`,
        facts: shown.map((group) => ({ label: accountName(state, group.id),
          value: metric === 'count' ? `${group.count} · ${formatLedgerMoney(group.totalFils)}` : formatLedgerMoney(group.totalFils) })),
        data: { accountCount: groups.length, spendingFils: checkedMinorSum(groups.map((group) => group.totalFils)), metric },
      };
    }

    case 'compare-accounts': {
      const contentFilters = filtersWithoutAccounts(request);
      const rows = filterRows(spendingRows(state, period), contentFilters);
      const leftRows = rows.filter((row) => row.accountId === request.leftAccountId);
      const rightRows = rows.filter((row) => row.accountId === request.rightAccountId);
      const left = total(leftRows), right = total(rightRows);
      const delta = checkedMinorSum([left, -right]);
      const leftName = accountName(state, request.leftAccountId), rightName = accountName(state, request.rightAccountId);
      return {
        tool: request.tool, title: 'Account comparison',
        body: `${leftName} recorded ${formatLedgerMoney(left)} of spending in ${scope}; ${rightName} recorded ${formatLedgerMoney(right)}. ${delta === 0 ? 'They are equal in this view.' : `${delta > 0 ? leftName : rightName} is higher by ${formatLedgerMoney(Math.abs(delta))}.`}`,
        facts: [{ label: leftName, value: formatLedgerMoney(left) }, { label: rightName, value: formatLedgerMoney(right) }],
        data: { leftFils: left, rightFils: right, deltaFils: delta },
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
      const items = leavingSoon(state, now, {
        withinDays,
        ...(derived?.detectedSubscriptions
          ? { detectedSubscriptions: derived.detectedSubscriptions }
          : {}),
      });
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
        payments: items.slice(0, 6).map((item) => ({
          title: item.title,
          category: item.subscription?.category
            ?? (item.billId ? state.bills.find((bill) => bill.id === item.billId)?.category : undefined)
            ?? 'other',
          kind: item.kind,
          dateISO: item.dateISO,
          daysLeft: item.daysLeft,
          amountFils: item.amountFils,
        })),
        data: { withinDays, paymentCount: items.length, totalFils: amount },
      };
    }

    case 'cash-outflow': {
      const { internal } = ledgerScope(state);
      const summary = summarizeCashOutflow(state, period, { live: selectedAccountIds(state, request), internal });
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
      const previous = previousScopeQuestion(period);
      return {
        tool: request.tool,
        title: 'Income',
        body: income.length
          ? `In ${scope}, you received ${formatLedgerMoney(amount)} across ${income.length} income transaction${income.length === 1 ? '' : 's'}.`
          : `No recorded income in ${scope}.`,
        headline: income.length ? formatLedgerMoney(amount) : 'No recorded income',
        meta: `${income.length} transaction${income.length === 1 ? '' : 's'} · ${scope}`,
        facts: sources.slice(0, 3).map((item) => ({ label: item.key, value: formatLedgerMoney(item.totalFils) })),
        ...(income.length ? {} : { suggestions: [previous, 'What is my data coverage?'].filter((value): value is string => !!value) }),
        data: { totalFils: amount, transactionCount: income.length, sourceCount: sources.length },
      };
    }

    case 'spending-total':
    default: {
      const amount = total(spending);
      const categories = groupedCategoryTotals(spending);
      const average = spending.length > 0 ? Math.round(amount / spending.length) : 0;
      const previous = previousScopeQuestion(period);
      return {
        tool: 'spending-total',
        title: 'Spending',
        body: spending.length
          ? `In ${scope}, you spent ${formatLedgerMoney(amount)} across ${spending.length} transaction${spending.length === 1 ? '' : 's'}.`
          : `No recorded spending in ${scope}.`,
        headline: spending.length ? formatLedgerMoney(amount) : 'No recorded spending',
        meta: `${spending.length} transaction${spending.length === 1 ? '' : 's'} · ${scope}`,
        facts: [
          ...(categories[0] ? [{ label: 'Top category', value: `${categoryLabel(categories[0].key)} · ${formatLedgerMoney(categories[0].totalFils)}` }] : []),
          ...(spending.length ? [{ label: 'Average transaction', value: formatLedgerMoney(average) }] : []),
        ],
        ...(spending.length ? {} : { suggestions: [previous, 'What is my data coverage?'].filter((value): value is string => !!value) }),
        data: { totalFils: amount, transactionCount: spending.length, averageTransactionFils: average },
      };
    }
  }
}

/** Execute locally, then attach the exact rows used by that calculation. */
export function executeAssistantTool(
  state: AppState,
  request: AssistantToolRequest,
  now = new Date(),
  derived?: { detectedSubscriptions?: readonly Subscription[] },
): AssistantAnswer {
  if ('period' in request) {
    const error = invalidFilters(state, request);
    if (error) return executeAssistantToolResult(state, clarification(error), now, derived);
    if ((request.tool === 'net-income-spending' || request.tool === 'cash-outflow') && hasContentFilter(request)) {
      return executeAssistantToolResult(state, clarification('This calculation supports account filters. Ask for spending or income separately to filter categories or merchants.'), now, derived);
    }
    if (['recurring-changes', 'unusual-charges', 'possible-duplicates', 'money-review'].includes(request.tool) && hasCategoryFilter(request)) {
      return executeAssistantToolResult(state, clarification('Charge patterns need whole purchases. Ask by merchant or account without category filters.'), now, derived);
    }
  }
  const answer = measureRuntimeOperation('ask-execute', () =>
    executeAssistantToolResult(state, request, now, derived));
  if (request.tool === 'help' || request.tool === 'data-coverage' || request.tool === 'obligation-status' ||
      request.tool === 'credit-card-settlement-summary' || request.tool === 'account-inventory') return answer;
  if (request.tool === 'subscriptions' || request.tool === 'upcoming-payments') return {
    ...answer,
    body: `${answer.body} ${request.tool === 'subscriptions' ? 'These are estimates from recurring recorded charges; actual renewals may differ.' : 'Includes recorded bills and predicted recurring charges; amounts or dates may change.'}`,
    destination: '/bills',
  };
  const evidenceStartedAt = Date.now();
  const period = comparisonPrimaryPeriod(request, now, state);
  const evidence = (label: string, rows: Transaction[], value = period) => evidenceFor(state, now, label, rows, value);
  const spending = filterRows(spendingRows(state, period), request);
  const income = filterRows(incomeRows(state, period), request);
  let groups: AssistantEvidence[];
  if (request.tool === 'cash-outflow') {
    const { internal } = ledgerScope(state);
    const summary = summarizeCashOutflow(state, request.period, { live: selectedAccountIds(state, request), internal });
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
  } else if (request.tool === 'historical-baseline') {
    const history = filterRows(spendingRows(state, { mode: 'all' }), request);
    const monthKey = typeof answer.data?.monthKey === 'string' ? answer.data.monthKey : undefined;
    const typicalKeys = request.baseline === 'typical-month'
      ? new Set(monthlySpendingGroups(state, request)
        .filter((month) => month.key < (periodStartISO(period, state.transactions) ?? toISODate(now)).slice(0, 7))
        .slice(-12).map((month) => month.key)) : null;
    const proof = monthKey ? history.filter((row) => row.date.startsWith(monthKey))
      : typicalKeys ? history.filter((row) => typicalKeys.has(row.date.slice(0, 7))) : history;
    groups = [evidenceFor(state, now, monthKey ? `Recorded spending in ${monthKey}` : 'Recorded months used for baseline', proof)];
  } else if (request.tool === 'top-accounts') {
    const rankingRows = accountSpendingGroups(state, period, request, request.accountKind ?? 'all').flatMap((group) => group.rows);
    groups = [evidence('All spending used to rank accounts', rankingRows)];
  } else if (request.tool === 'compare-accounts') {
    const rows = filterRows(spendingRows(state, period), filtersWithoutAccounts(request));
    groups = [
      evidence(accountName(state, request.leftAccountId), rows.filter((row) => row.accountId === request.leftAccountId)),
      evidence(accountName(state, request.rightAccountId), rows.filter((row) => row.accountId === request.rightAccountId)),
    ];
  } else if (['recurring-changes', 'unusual-charges', 'possible-duplicates', 'money-review'].includes(request.tool)) {
    const ids = new Set((answer.findings ?? []).flatMap((finding) => finding.evidence[0]?.transactionIds ?? []));
    groups = [evidenceFor(state, now, 'Charges to review', state.transactions.filter((row) => ids.has(row.id)))];
  } else groups = [evidence(request.tool === 'top-merchants' ? 'All spending used to rank merchants'
    : request.tool === 'top-categories' ? 'All spending used to rank categories'
      : request.category ? categoryLabel(request.category, 'en') : 'Spending', spending)];
  const previousDates = request.tool === 'compare-periods' ? groups[1] : undefined;
  const coverageRows = request.tool === 'historical-baseline'
    ? filterRows(spendingRows(state, { mode: 'all' }), request)
    : request.tool === 'compare-accounts' ? groups.flatMap((group) => state.transactions.filter((row) => group.transactionIds.includes(row.id)))
      : request.tool === 'income-total' ? income : request.tool === 'net-income-spending' ? [...income, ...spending] : spending;
  const evidenceGroups = groups.filter((group) => group.transactionIds.length > 0);
  const result = {
    ...answer,
    ...(evidenceGroups.length ? { evidence: evidenceGroups } : {}),
    coverage: answer.coverage ?? observedCoverage(state, coverageRows, request,
      request.tool === 'compare-periods' && !previousDates?.transactionIds.length
        ? ['No earlier spending records match the comparison. A zero recorded baseline cannot establish a complete spending change.'] : []),
  };
  recordRuntimeOperation('ask-evidence', Date.now() - evidenceStartedAt);
  return result;
}

/**
 * Execute recurrence-backed chat tools without monopolising a foreground turn.
 * All other deterministic tools retain the normal synchronous path.
 */
export async function executeAssistantToolCooperatively(
  state: AppState,
  request: AssistantToolRequest,
  now = new Date(),
  cancelled: () => boolean = () => false,
): Promise<AssistantAnswer | null> {
  if (request.tool !== 'subscriptions' && request.tool !== 'upcoming-payments') {
    return executeAssistantTool(state, request, now);
  }
  const { live, internal } = ledgerScope(state);
  const detected = await detectSubscriptionsCooperatively(
    state.transactions,
    state.notSubscriptions,
    now,
    live,
    internal,
    cancelled,
  );
  if (detected === null || cancelled()) return null;
  return executeAssistantTool(state, request, now, { detectedSubscriptions: detected });
}

interface NamedClause { rest: string; merchants: string[]; accounts: string[]; error?: AssistantToolRequest }

/** Protect recorded identities before date/category vocabulary is interpreted. */
function extractNamedClause(state: AppState, text: string, question: string, excluded: boolean): NamedClause {
  let rest = text;
  const merchants: string[] = [], accounts: string[] = [];
  const failure = (phrase: string, token: string): AssistantToolRequest => {
    const resolved = resolveMerchant(phrase, state.transactions);
    const candidates = resolved.candidates ?? [];
    return clarification(candidates.length ? `Several recorded merchants match “${phrase}”. Choose the exact merchant.`
      : `I could not find a recorded merchant matching “${phrase}”. Check the name in Transactions.`,
    candidates.slice(0, 4).map((candidate) => question.replace(new RegExp(escapeRegExp(token), 'i'), JSON.stringify(candidate))));
  };
  for (const match of [...rest.matchAll(/"(?:[^"\\]|\\.)*"/g)]) {
    let phrase: string;
    try { phrase = JSON.parse(match[0]) as string; } catch { return { rest, merchants, accounts, error: clarification('Please check the merchant name.') }; }
    const resolved = resolveMerchant(phrase, state.transactions);
    if (!resolved.merchant) return { rest, merchants, accounts, error: failure(phrase, match[0]) };
    merchants.push(resolved.merchant);
    rest = rest.replace(match[0], ' ');
  }
  const live = liveAccountIds(state.accounts);
  const liveAccounts = state.accounts.filter((account) => live.has(account.id)).sort((x, y) => y.name.length - x.name.length);
  // Exact recorded account identities outrank category vocabulary in contexts
  // such as “Compare Visa with Mastercard” and “Same for Visa”. Preserve text
  // order so left/right comparisons match the user's wording rather than the
  // order accounts happened to be stored in.
  const bareAccountContext = excluded || /\b(?:compare|versus|vs|same for|what about|how about)\b|^\s*and\b/.test(rest) ||
    /\b(?:from|in|on|using|with)\b[^?!.]*\b(?:and|or)\b/.test(rest);
  const accountMatches: { id: string; start: number; end: number }[] = [];
  for (const account of liveAccounts) {
    const name = escapeRegExp(normalize(account.name));
    const patterns = [
      new RegExp(`\\b(?:from|in|on|using|with)\\s+(?:my\\s+)?${name}(?:\\s+(?:account|card))?(?=\\W|$)`, 'g'),
      new RegExp(`\\b${name}\\s+(?:account|card)\\b`, 'g'),
      ...(bareAccountContext ? [new RegExp(`(^|[^\\p{L}\\p{N}])${name}(?=$|[^\\p{L}\\p{N}])`, 'gu')] : []),
    ];
    for (const pattern of patterns) {
      for (const match of rest.matchAll(pattern)) {
        if (liveAccounts.filter((item) => normalize(item.name) === normalize(account.name)).length > 1) {
          return { rest, merchants, accounts, error: clarification('More than one account has that name. Give those accounts distinct names before filtering by name.') };
        }
        const prefix = match[1] && pattern.flags.includes('u') ? match[1].length : 0;
        accountMatches.push({ id: account.id, start: match.index! + prefix, end: match.index! + match[0].length });
      }
    }
  }
  const selectedAccountMatches = accountMatches
    .sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start))
    .filter((match, index, all) => !all.slice(0, index).some((prior) => match.start < prior.end && match.end > prior.start));
  for (const match of selectedAccountMatches) if (!accounts.includes(match.id)) accounts.push(match.id);
  for (const match of [...selectedAccountMatches].sort((a, b) => b.start - a.start)) {
    rest = `${rest.slice(0, match.start)} accountselection ${rest.slice(match.end)}`;
  }
  rest = rest.replace(/\baccountselection\b/g, ' ');
  // Most questions contain only Wafra's own grammar ("how much did I spend?",
  // "check", "what is due soon?"). None of those words can suddenly become a
  // recorded merchant, so building the 15k-row merchant index before answering
  // them is pure latency. Explicit merchant syntax still wins even when the
  // merchant itself is a common word (for example "spending at Pay"). Unknown
  // vocabulary also gets the identity lookup so bare follow-ups like
  // "What about Talabat?" retain their existing behaviour.
  const shouldScanMerchantTitles = /\b(?:at|from|on)\s+\S/.test(rest) || hasUnsupportedRemainder(rest);
  const titles = shouldScanMerchantTitles ? merchantTitlesInText(state.transactions, rest) : [];
  for (const title of titles) {
    if (!containsPhrase(rest, title)) continue;
    // Category/income words are semantic unless explicitly introduced as a merchant.
    const reserved = categoriesFromQuestion(normalize(title)).length > 0 || /^(?:salary|income|business)$/i.test(title);
    const explicit = new RegExp(`\\b(?:at|from|on)\\s+${escapeRegExp(normalize(title))}(?=\\W|$)`).test(rest);
    if (reserved && !explicit) continue;
    if (!excluded && !explicit && categoriesFromQuestion(rest).length && !/\b(?:at|from|on)\b/.test(rest)) continue;
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(normalize(title))}(?=$|[^\\p{L}\\p{N}])`, 'gu');
    if (!pattern.test(rest)) continue;
    merchants.push(title); rest = rest.replace(pattern, '$1 ');
  }
  return { rest, merchants: [...new Set(merchants)], accounts: [...new Set(accounts)] };
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
  if (/\bselectedreportingperiod\b/.test(q)) return clarification('Name the selected reporting period or an explicit date.');
  if (!q || q.length > 1000) return clarification('Ask one short question about your recorded spending, income, or payments.');
  if (/^(?:hi|hello|hey|hey wafra|help|what can (?:you|wafra) do|what can i ask|how does this work)[!?.]*$/.test(q)) return { tool: 'help' };
  const inventory = accountInventoryRequest(q);
  if (inventory) return inventory;
  const cardSettlementSummary = planCreditCardSettlementSummaryQuestion(state, q, now);
  if (cardSettlementSummary) return cardSettlementSummary;
  const obligation = planObligationQuestion(state, q, previousRequest, now);
  if (obligation) return obligation;
  const prior = previousRequest && 'period' in previousRequest ? previousRequest : undefined;
  if (/^(?:show (?:me )?(?:(?:those|the|matching) )?(?:transactions|txn|txns|them|those)|choose (?:one|a) transaction)[?!.]?$/.test(q)) {
    return prior ?? clarification('Ask about a spending or income period first, then show its matching transactions.');
  }
  const relativePreviousFollowUp = !!prior && /^(?:(?:what about|how about|and)\s+(?:the\s+)?)?(?:last|previous)\s+month[?!.]?$|^(?:and\s+)?before that[?!.]?$|^what about (?:the )?month before[?!.]?$|^how much (?:last|previous) month[?!.]?$/.test(q);
  const sameMonthLastYearFollowUp = !!prior && /^(?:(?:what about|how about|and)\s+)?(?:the\s+)?same month last year[?!.]?$/.test(q);
  const monthsAgoFollowUpMatch = prior ? q.match(/^(?:(?:what about|how about|and)\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+months?\s+ago[?!.]?$/) : null;
  const monthsAgoFollowUp = !!monthsAgoFollowUpMatch;
  const sameMonthLastYearOverride: Period | null = sameMonthLastYearFollowUp && prior
    ? prior.period.mode === 'month'
      ? { mode: 'month', key: `${Number(prior.period.key.slice(0, 4)) - 1}${prior.period.key.slice(4)}` }
      : prior.period.mode === 'range'
        ? { mode: 'range', from: `${Number(prior.period.from.slice(0, 4)) - 1}${prior.period.from.slice(4)}`,
          to: `${Number(prior.period.to.slice(0, 4)) - 1}${prior.period.to.slice(4)}` }
        : prior.period.mode === 'year' ? { mode: 'year', year: prior.period.year - 1 } : null
    : null;
  let monthsAgoOverride: Period | null = null;
  if (monthsAgoFollowUpMatch) {
    const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
      seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
    const count = words[monthsAgoFollowUpMatch[1]] ?? Number(monthsAgoFollowUpMatch[1]);
    if (!Number.isInteger(count) || count < 1 || count > 24) return clarification('Use between 1 and 24 months ago.');
    let cursor: Period = currentMonthPeriod(now);
    for (let index = 0; index < count; index++) cursor = previousPeriod(cursor) ?? cursor;
    monthsAgoOverride = cursor;
  }
  const relativePeriodOverride = relativePreviousFollowUp && prior ? previousPeriod(prior.period)
    : sameMonthLastYearOverride ?? monthsAgoOverride;
  const planningQuestion = relativePreviousFollowUp || sameMonthLastYearFollowUp || monthsAgoFollowUp
    ? (/^how much\b/.test(q) ? 'how much' : 'what about')
    : q;
  const contextualComparison = !!prior && /^(?:why\s*[?!.]?$|why did (?:it|that|this)\b|why (?:is|was) (?:it|that|this)\b|what changed\b|did (?:it|that|this)\b|was (?:it|that|this)\b|is (?:it|that|this)\b|how (?:does|did) (?:it|that|this) compare\b)/.test(q);
  const scopeOnlyAmount = new RegExp(`^how much(?:\\s+(?:today|yesterday|this month|current month|last month|previous month|this year|current year|last year|previous year|all time|ever|past week|last week|${MONTH_PATTERN}(?:\\s+\\d{4})?|(?:last|past)\\s+\\d+\\s+days?))?\\s*[?!.]?$`).test(q);
  const dateShorthandFollowUp = !!prior && /^(?:mtd|ytd|this mo|last mo|prev mo|this wk|last wk|past wk)[?!.]?$/.test(q);
  const scopeOnlyFollowUp = !!prior && (scopeOnlyAmount || dateShorthandFollowUp || /^same(?: thing)?(?: for)?\b/.test(q));
  const followUp = /^(?:and\b|what about\b|how about\b|compare\b|top\b|show\b|exclude\b|excluding\b|without\b|ignore\b)/.test(q)
    || contextualComparison || scopeOnlyFollowUp || relativePreviousFollowUp || sameMonthLastYearFollowUp || monthsAgoFollowUp;
  const filters = followUp && prior ? copyFilters(prior) : {};
  const quotedNames: string[] = [];
  const protectedQuestion = planningQuestion.replace(/"(?:[^"\\]|\\.)*"/g, (name) => { quotedNames.push(name); return `quotedmerchanttoken${quotedNames.length - 1}end`; });
  const rawClauses = protectedQuestion.split(/\b(?:exclude|excluding|except|without|not including|ignore|other than|minus(?!\s+spending\b))\b/)
    .map((clause) => clause.replace(/quotedmerchanttoken(\d+)end/g, (_, index: string) => quotedNames[Number(index)]));
  const exclusionOnly = rawClauses.length > 1 && !rawClauses[0].trim();
  if (exclusionOnly && !prior) return clarification('Ask about a spending or income period first, then exclude a category, merchant, or account.');
  const clauses = rawClauses.map((clause, index) => extractNamedClause(state, clause, question, index > 0));
  const failed = clauses.find((clause) => clause.error);
  if (failed?.error) return failed.error;
  for (const clause of clauses) clause.rest = normalizeAssistantSemanticLanguage(clause.rest);
  q = clauses.map((clause) => clause.rest).join(' ');
  const selectedPeriodMentions = [...q.matchAll(/\bselectedreportingperiod\b/g)].length;
  if (selectedPeriodMentions > 1) return clarification('Name two explicit date ranges to compare, or mention the selected reporting period once.');
  const explicitSelectedPeriod = selectedPeriodMentions === 1;
  for (const clause of clauses) clause.rest = clause.rest.replace(/\bselectedreportingperiod\b/g, ' ');
  q = clauses.map((clause) => clause.rest).join(' ');
  if (/\b(?:afford|should i|can i|budget left|safe to spend|balance|save|saving|recommend|refund|over\s+\d|under\s+\d|above\s+\d|below\s+\d)\b/.test(q)) {
    return clarification('I can explain recorded spending and income, but cannot reliably answer that condition. Try a spending total or an income comparison.');
  }
  if ([...q.matchAll(/\btop\s+\d+\b/g)].length > 1) return clarification('Ask for one ranking and one result count at a time.');
  const limit = requestedLimit(q);
  if (limit !== undefined && (limit < 1 || limit > 10)) return clarification('Choose between 1 and 10 results.');
  const intentText = clauses[0].rest.replace(/\b(?:since|before|after)\s+(?:my\s+)?(?:last\s+)?(?:salary|payday|paycheck|pay cheque|pay)(?:\s+(?:came in|arrived))?\b/g, ' ');
  const isIncomeQuestion = /\b(?:income|salary|earned|earning|earnings|received|receiving|receives|receive|earn|wage|wages|paycheck|paychecks)\b/.test(intentText)
    || /\b(?:got paid|get paid|pay came in)\b/.test(intentText);
  const net = /income minus spending|spen[dt] more than i earned|more than i earn|what.*net|net spending|net cashflow/.test(intentText);
  if (isIncomeQuestion && !net && /\b(?:spend|spent|spending|expenses?)\b/.test(intentText)) return clarification('Ask for income and spending separately, or ask for income minus spending.');
  const recurring = /\b(?:recurring|subscription|subscriptions|renewal|renewals)\b/.test(q) && /\b(?:change|changed|changes|increase|increased|decrease|decreased|compare)\b/.test(q);
  const unusual = /\b(?:unusual|unusually|outlier|outliers)\b/.test(q);
  const duplicates = /\b(?:duplicate|duplicates|duplicated|charged twice|charged me twice|double charged|double charge|double charges|same charge twice|same payment twice)\b/.test(q);
  const moneyReview = /\b(?:anything unusual|anything weird|anything odd|anything strange|anything suspicious|anything off|anything look wrong|anything i should review|anything i should worry about|what should i review|review my spending|review my transactions)\b/.test(q);
  const coverageQuestion = /\b(?:coverage|data gaps|missing imports|import status|import history|recorded history)\b/.test(q);
  const highestMonthQuestion = /\b(?:highest|biggest|most expensive)\s+(?:recorded\s+)?(?:spending\s+)?month\b|\bhighest monthly\b/.test(q);
  const typicalMonthQuestion = /\b(?:normal|typical|usual)\b.*\b(?:month|monthly|spend|spending)\b|\bmonthly median\b/.test(q);
  const lastSimilarMonthQuestion = /\bwhen did i last spend (?:about )?this much\b|\bwhen was the last time i spent (?:about )?this much\b|\blast time i spent (?:about )?this much\b/.test(q);
  const closestMonthQuestion = /\bclosest earlier month\b|\bwhich earlier month was closest to this\b/.test(q);
  const accountRankingQuestion = /\b(?:which|what)\s+(?:bank\s+)?(?:account|card)\b.*\b(?:most|highest)\b|\btop\s+(?:accounts?|cards?)\b/.test(q);
  const comparison = !net && !recurring && (contextualComparison || /\b(?:compare|more than|less than|higher|lower|increase|decrease|change|changed|difference|different|vs|versus)\b|why.*spend/.test(q));
  const conversationalUpcoming = /\b(?:what do i owe|anything due|payments? coming up|bills? coming up|what is coming up|stuff due)\b/.test(q);
  const upcoming = (conversationalUpcoming || /\b(?:due|upcoming|bills?)\b/.test(q)) && !/\b(?:paid|spent|did|last|previous)\b/.test(q);
  const subscriptions = !recurring && (/\b(?:subscriptions?|recurring charges?|recurring payments?|renewals?)\b/.test(q)
    || /\b(?:what am i subscribed to|what do i subscribe to)\b/.test(q))
    && !/\b(?:paid|spent|did|last|previous|change|changed|increase|decrease|compare)\b/.test(q);
  if (upcoming || subscriptions) {
    if (explicitSelectedPeriod) return clarification('Active subscriptions and upcoming payments do not use the selected reporting period. Ask without a historical period.');
    if (/\b(?:this week|next week|next month)\b/.test(q)) return clarification('Use a specific upcoming window, such as payments due within the next 7 days.');
    const windowless = q.replace(/\b(?:next|within)\s+\d+\s+days?\b/g, ' ');
    const futurePeriods = parsePeriods(windowless, now, state);
    if (rawClauses.length > 1 || clauses.some((clause) => clause.accounts.length || clause.merchants.length) ||
      futurePeriods.error || futurePeriods.periods.length || categoriesFromQuestion(q).length || Object.keys(filters).length || /\bat\b/.test(q)) {
      return clarification('I can show the overall upcoming payments or active subscriptions. A filtered historical view is not supported for those estimates.');
    }
    const match = q.match(/\b(?:next|within)\s+(\d+)\s+days?\b/);
    const withinDays = match ? Number(match[1]) : 30;
    if (withinDays < 1 || withinDays > 90) return clarification('Use an upcoming window between 1 and 90 days.');
    if (subscriptions) {
      const remaining = q.replace(/\b(?:what|which|are|is|am|my|the|active|biggest|all|any|show|list|please|subscriptions|subscription|subscribed|subscribe|recurring|payments|payment|charges|charge|renewal|renewals|monthly|total|cost|how|much|do|i|pay|for|have|to)\b/g, '').replace(/[?!.\s]/g, '');
      return remaining ? clarification('I can show all active subscription estimates. Try asking which recurring charges changed for a historical analysis.') : { tool: 'subscriptions' };
    }
    const remaining = q.replace(/\b(?:what|which|when|are|is|my|the|all|anything|stuff|payments|payment|bills|bill|due|upcoming|soon|coming|up|owe|in|within|next|days|day|how|much|do|i|have|to|pay)\b/g, '').replace(/[?!.\s\d]/g, '');
    return remaining ? clarification('I can show all upcoming payments within a number of days. Filtering those estimates by service is not available yet.') : { tool: 'upcoming-payments', withinDays };
  }
  if (/\bbills?\b/.test(q)) return clarification('I can show upcoming bills. For past spending, name a merchant or category and a date range.');
  if (!recurring && /\b(?:recurring|subscriptions?|renewals?)\b/.test(q)) return clarification('Ask which recurring charges changed, or show active subscription estimates.');
  const parsed = parsePeriods(q, now, state);
  if (parsed.error) return clarification(parsed.error);
  if (parsed.periods.length > (comparison ? 2 : 1)) return clarification('Ask about one date range, or compare two clearly named periods.');
  if (explicitSelectedPeriod && parsed.periods.length) return clarification('Choose the selected reporting period or an explicit date, rather than both.');
  let period = explicitSelectedPeriod ? defaultPeriod ?? currentMonthPeriod(now)
    : relativePeriodOverride ?? parsed.periods[0] ?? (followUp ? prior?.period : undefined) ?? defaultPeriod ?? currentMonthPeriod(now);
  let comparisonPeriod = parsed.periods[1];
  if (prior && comparison && parsed.periods.length === 1 && /^(?:compare(?: with)?\s+|how (?:does|did) (?:it|that|this) compare (?:with|to)\s+|did (?:it|that|this).*(?:increase|decrease|change).*(?:from|than)\s+)(?:last month|previous month|this month|[a-z]+\s+\d{4})[?!.]?$/i.test(question.trim())) {
    period = prior.period;
    const relativePrevious = /\b(?:last|previous) month\b/i.test(question);
    const earlier = prior.tool === 'compare-periods' ? prior.comparisonPeriod : undefined;
    const requestedDates = scopeDates(parsed.periods[0], state, now);
    const earlierDates = earlier ? scopeDates(earlier, state, now) : undefined;
    const reuseEarlier = earlier && earlierDates?.from && requestedDates.from && earlierDates.from >= requestedDates.from && earlierDates.to && requestedDates.to && earlierDates.to <= requestedDates.to;
    comparisonPeriod = relativePrevious ? reuseEarlier ? earlier : comparablePreviousPeriod(prior.period, now, state.transactions) ?? parsed.periods[0] : parsed.periods[0];
    if (relativePrevious) period = comparisonPrimaryPeriod({ tool: 'compare-periods', period: prior.period }, now, state);
  }
  const parsedClauses = clauses.map((clause) => ({ ...clause, rest: parsePeriods(clause.rest, now, state).rest }));
  for (let index = 0; index < parsedClauses.length; index++) {
    const clause = parsedClauses[index];
    // Remaining at/from phrases are unresolved merchant names, including partial
    // branch names. A mixed known/unknown list must clarify as a whole.
    const merchantPhrase = clause.rest.match(/\b(at|from|on)\s+([^\s?!.].*?)(?=\s+(?:with|using|on|in|for|compared|versus|vs|change|changed|increase|decrease)\b|[?!.]|$)/);
    const preposition = merchantPhrase?.[1];
    const phrase = merchantPhrase?.[2]?.trim().replace(/^(?:and|or)\s+/, '').trim();
    if (phrase && !/^(?:and|or)$/.test(phrase) && !/^(?:change|changed|increase|decrease|with|using|on|in|for|compared|versus|vs)\b/.test(phrase)) {
      if (/\b(?:account|card)\b/.test(phrase)) return accountClarification(state);
      const semanticOnSyntax = preposition === 'on' &&
        (categoriesFromQuestion(phrase).length > 0 || !!narrowConceptParent(phrase) || /^track\b/.test(phrase));
      if (!semanticOnSyntax) {
        const resolved = resolveMerchant(phrase, state.transactions);
        if (!resolved.merchant) {
          const candidates = resolved.candidates ?? [];
          return clarification(candidates.length ? `Several recorded merchants match “${phrase}”. Choose the exact merchant.` : `I could not find a recorded merchant matching “${phrase}”. Check the name in Transactions.`,
            candidates.slice(0, 4).map((candidate) => question.replace(new RegExp(escapeRegExp(phrase), 'i'), JSON.stringify(candidate))));
        }
        clause.merchants.push(resolved.merchant); clause.rest = clause.rest.replace(phrase, ' ');
      }
    }
    const categories = categoriesFromQuestion(clause.rest);
    if ((isIncomeQuestion && !net || index > 0) && /\bsalary\b/.test(clause.rest)) categories.push('salary');
    if ((isIncomeQuestion && !net || index > 0) && /\bbusiness\b/.test(clause.rest)) categories.push('business');
    if (index > 0 && clause.accounts.length && (categories.length || clause.merchants.length)) return clarification('Keep account selection before the exclusion, for example: spending from Everyday excluding rent. Name account exclusions separately.');
    if (index === 0) {
      if (clause.accounts.length) filters.accountIds = [...new Set(clause.accounts)];
      // Elliptical follow-ups such as “What about groceries?” or “And Talabat?”
      // mean “answer the same question for this new subject”, not “intersect the
      // previous merchant with a new category”. Explicitly naming both dimensions
      // in the same follow-up still keeps both.
      if (followUp && prior && ((clause.merchants.length > 0) !== (categories.length > 0))) {
        clearIncludedContent(filters);
      }
      if (clause.merchants.length) {
        delete filters.merchant; delete filters.merchants;
        const names = [...new Set(clause.merchants)];
        if (names.length === 1) filters.merchant = names[0]; else filters.merchants = names;
      }
      if (categories.length) {
        delete filters.category; delete filters.categories;
        if (categories.length === 1) filters.category = categories[0]; else filters.categories = [...new Set(categories)];
      }
    } else {
      if (!categories.length && !clause.merchants.length && !clause.accounts.length) return clarification('Name the exact category, merchant, or account to exclude.');
      if (categories.length) filters.excludedCategories = [...new Set([...(filters.excludedCategories ?? []), ...categories])];
      if (clause.merchants.length) filters.excludedMerchants = [...new Set([...(filters.excludedMerchants ?? []), ...clause.merchants])];
      if (clause.accounts.length) filters.excludedAccountIds = [...new Set([...(filters.excludedAccountIds ?? []), ...clause.accounts])];
    }
  }
  q = parsedClauses.map((clause) => clause.rest).join(' ').replace(/\s+/g, ' ').trim();
  if (parsed.periods.length) q = q.replace(/\b(?:in|on|for|during)\s+(?:the\s*)?(?=[?!.]|$)/g, ' ');
  q = q.replace(/\b(?:at|from|on|using|with)\s*(?=[?!.]|$)/g, ' ').replace(/\s+/g, ' ').trim();
  if (followUp && prior) {
    const subject = q.match(/^(?:what about|how about|and)\s+(.+?)[?!.]?$/)?.[1]?.trim();
    if (subject && !categoriesFromQuestion(subject).length) {
      const resolved = resolveMerchant(subject, state.transactions);
      if (resolved.merchant) {
        clearIncludedContent(filters);
        filters.merchant = resolved.merchant;
        q = 'what about';
      } else if (resolved.candidates?.length) {
        return clarification(`Several recorded merchants match “${subject}”. Choose the exact merchant.`,
          resolved.candidates.slice(0, 4).map((candidate) => `What about ${JSON.stringify(candidate)}?`));
      }
    }
  }
  let baselineText = q;
  for (const [pattern] of CATEGORY_ALIASES) baselineText = baselineText.replace(new RegExp(pattern.source, 'g'), ' ');
  baselineText = baselineText.replace(/\s+/g, ' ');
  const cleanedHighestMonthQuestion = highestMonthQuestion || /\b(?:highest|biggest|most expensive)\s+(?:recorded\s+)?(?:spending\s+)?month\b|\bhighest monthly\b/.test(baselineText);
  const cleanedTypicalMonthQuestion = typicalMonthQuestion || /\b(?:normal|typical|usual)\b.*\b(?:month|monthly|spend|spending)\b|\bmonthly median\b/.test(baselineText);
  if (cleanedHighestMonthQuestion || cleanedTypicalMonthQuestion || closestMonthQuestion || lastSimilarMonthQuestion) {
    const baseline = cleanedHighestMonthQuestion ? 'highest-month'
      : cleanedTypicalMonthQuestion ? 'typical-month'
        : lastSimilarMonthQuestion ? 'last-similar-month' : 'closest-month';
    return { tool: 'historical-baseline', period, ...filters, baseline };
  }
  if (comparison && filters.accountIds?.length === 2 && !includedMerchants(filters).length && !includedCategories(filters).length) {
    const [leftAccountId, rightAccountId] = filters.accountIds;
    const content = filtersWithoutAccounts(filters);
    return { tool: 'compare-accounts', period, ...content, leftAccountId, rightAccountId };
  }
  if (accountRankingQuestion) {
    const accountKind = /\bcards?\b/.test(q) ? 'card' : /\bbank\s+accounts?\b/.test(q) ? 'bank' : 'all';
    const metric = /\b(?:most often|most transactions?|used most)\b/.test(q) ? 'count' : 'amount';
    const content = filtersWithoutAccounts(filters);
    return { tool: 'top-accounts', period, ...content, accountKind, metric, ...(limit ? { limit } : {}) };
  }
  if (/\b(?:my|the|a|an)\s+(?:\w+\s+)?(?:account|card)\b|\b(?:account|card)\s+\d+\b/.test(q) && !/left my account/.test(q)) {
    return accountClarification(state);
  }
  const narrow = narrowConceptParent(q);
  if (narrow) {
    const parent = categoryLabel(narrow.category, 'en');
    return clarification(`I can’t reliably isolate “${narrow.phrase}” from the recorded data without guessing. I can show the broader ${parent} category, or you can name a merchant.`,
      [`How much did I spend on ${parent.toLowerCase()}?`, 'What are my top merchants?']);
  }
  if (/\d/.test(q.replace(/\btop\s+\d+\b/g, '')) ||
    /\b(?:in|during|before|after|since|between|with|using)\s+(?!(?:the )?previous period\b)\S|\b(?:usd|eur|gbp|aed|sar|jpy|kwd)\b|[$€£]/.test(q) ||
    (!hasCategoryFilter(filters) && /\bon\s+(?!track\b)\S/.test(q)) ||
    (includedMerchants(filters).length > 1 && /\b(?:vs|versus)\b/.test(q))) {
    return clarification('I understood part of that, but not enough to answer safely. Try a merchant, category, account, or clearer date.');
  }
  const scopeError = invalidFilters(state, filters);
  if (scopeError) return clarification(scopeError);
  if (hasUnsupportedRemainder(q)) return clarification('I didn’t quite understand that. Try asking about spending, income, a merchant, category, account, subscription, bill, or date.', undefined, true);
  const scoped = { period, ...filters };
  const multipleDimensions = includedCategories(filters).length > 1 || includedMerchants(filters).length > 1 || (filters.accountIds?.length ?? 0) > 1;
  if (comparison && multipleDimensions && !comparisonPeriod && parsed.periods.length < 2 && !/\b(?:why|change|changed|previous period|same dates)\b/.test(q)) return clarification('I can compare the combined spending for these filters over time. Name two periods or ask why their combined spending changed.');
  if (comparison && /\b(?:more than|less than|vs|versus)\b/.test(q) && multipleDimensions && parsed.periods.length < 2) return clarification('Name two periods to compare the combined spending. Comparing individual categories, merchants, or accounts against each other is not supported yet.');
  if (recurring && /\b(?:increased?|decreased?|higher|lower|more|less)\b/.test(intentText)) return clarification('I can show recorded recurring changes in both directions. Ask which recurring charges changed.');
  if (coverageQuestion) return { tool: 'data-coverage', ...scoped };
  if (moneyReview) {
    if (isIncomeQuestion || net) return clarification('The combined review checks recorded spending. Ask about income separately.');
    if (hasCategoryFilter(filters)) return clarification('The combined review needs whole purchases. Ask without a category filter, or review that category directly.');
    return { tool: 'money-review', ...scoped };
  }
  if (recurring || unusual || duplicates) {
    if ([recurring, unusual, duplicates].filter(Boolean).length > 1 || /\b(?:daily|average|forecast|projected|top|largest|biggest|net|cash out)\b/.test(q)) return clarification('Ask for one charge pattern at a time without a ranking, average, or forecast condition.');
    if (hasCategoryFilter(filters)) return clarification('Charge patterns need whole purchases. Ask by merchant or account without category filters.');
    if (isIncomeQuestion || net) return clarification('Charge patterns are available for recorded spending. Ask for income totals separately.');
    return { tool: recurring ? 'recurring-changes' : unusual ? 'unusual-charges' : 'possible-duplicates', ...scoped };
  }
  if (followUp && prior && (exclusionOnly || dateShorthandFollowUp || /^(?:(?:and\s+)?(?:what about|how about)|(?:and\s+)?how much|same(?: thing)?(?: for)?)\s*[?!.]?$/.test(q))) {
    const inherited = { ...prior, ...filters, period };
    // Replacing a plural dimension must remove the prior singular form, too.
    for (const field of ['merchant', 'merchants', 'category', 'categories'] as const) if (!(field in filters)) delete inherited[field];
    if (inherited.tool === 'compare-periods' && parsed.periods.length) delete inherited.comparisonPeriod;
    if (['merchant-breakdown', 'category-breakdown', 'spending-total'].includes(inherited.tool)) {
      if (filters.merchant && !filters.merchants) return { tool: 'merchant-breakdown', ...scoped, merchant: filters.merchant };
      if (filters.category && !filters.categories) return { tool: 'category-breakdown', ...scoped, category: filters.category };
      if (inherited.tool === 'merchant-breakdown' && !filters.merchant || inherited.tool === 'category-breakdown' && !filters.category) {
        return { tool: 'spending-total', ...scoped };
      }
    }
    return inherited;
  }
  if (net && hasContentFilter(filters)) return clarification('Income and spending use different categories and sources. Ask for the overall difference, optionally for accounts.');
  if ((isIncomeQuestion || net) && /\b(?:daily|per day|each day|average|largest|biggest|top|forecast|projected)\b|on track/.test(q)) return clarification('I can total income for a period, but cannot calculate that income metric yet. Try asking how much income you received.');
  if (/cash out|left my account|money out|actual outflow/.test(q)) {
    if (hasContentFilter(filters)) return clarification('Cash out includes repayments and transfers. Ask for cash out by account, or spending for merchants and categories.');
    return { tool: 'cash-outflow', ...scoped };
  }
  if (/forecast|on track|end of (the )?month|projected/.test(q)) return { tool: 'month-forecast', ...scoped };
  if (/\b(?:where did my money go|where is my money going|what did i spend (?:the )?most on)\b/.test(q)) return { tool: 'top-categories', ...scoped, ...(limit ? { limit } : {}) };
  if (/biggest purchase|largest purchase|largest transaction|most expensive purchase|top(?:\s+\d+)? (?:purchases?|transactions?)/.test(q)) return { tool: 'largest-purchases', ...scoped, limit: limit ?? 5 };
  if (/per day|daily average|average daily|spend.*daily|spend.*each day/.test(q)) return { tool: 'daily-average', ...scoped };
  if (net) return { tool: 'net-income-spending', ...scoped };
  if (/top(?:\s+\d+)?(?: spending)? merchants?|biggest merchant|where.*spend most|merchant.*most/.test(q)) return { tool: 'top-merchants', ...scoped, ...(limit ? { limit } : {}) };
  if (/top(?:\s+\d+)?(?: spending)? categor|biggest categor|which categor/.test(q)) return { tool: 'top-categories', ...scoped, ...(limit ? { limit } : {}) };
  if (comparison) {
    if (isIncomeQuestion || prior?.tool === 'income-total' && followUp) return clarification('I can compare spending between periods. Ask for income in one period at a time.');
    if (period.mode === 'all') return clarification('Choose a month or date range to compare with another period.');
    if (/same dates/.test(q) && prior?.tool === 'compare-periods' && prior.comparisonPeriod && !parsed.periods.length) return { ...scoped, tool: 'compare-periods', comparisonPeriod: prior.comparisonPeriod };
    return { tool: 'compare-periods', ...scoped, ...(comparisonPeriod ? { comparisonPeriod } : {}) };
  }
  if (isIncomeQuestion) return { tool: 'income-total', ...scoped };
  if (filters.merchant) return { tool: 'merchant-breakdown', ...scoped, merchant: filters.merchant };
  if (filters.category) return { tool: 'category-breakdown', ...scoped, category: filters.category };
  if (/\b(?:spend|spent|spending|expense|expenses|purchase|purchases|paid|pay|bought|buy|buying|drop|dropped|blew|blow|burn|burned|burnt)\b|cost me/.test(q)) return { tool: 'spending-total', ...scoped };
  return { tool: 'help' };
}

export function answerWafraQuestion(state: AppState, question: string, now = new Date(), previousRequest?: AssistantToolRequest | null, defaultPeriod?: Period): AssistantAnswer {
  return executeAssistantTool(state, planAssistantQuestion(state, question, now, previousRequest, defaultPeriod), now);
}

export function runWafraAssistant(state: AppState, question: string, now = new Date(), previousRequest?: AssistantToolRequest | null, defaultPeriod?: Period): { request: AssistantToolRequest; answer: AssistantAnswer } {
  return measureRuntimeOperation('ask-total', () => {
    const planned = measureRuntimeOperation('ask-plan', () =>
      planAssistantQuestion(state, question, now, previousRequest, defaultPeriod));
    const comparisonPeriod = effectiveComparisonPeriod(planned, now, state);
    const request: AssistantToolRequest = planned.tool === 'compare-periods' && comparisonPeriod
      ? { ...planned, period: comparisonPrimaryPeriod(planned, now, state), comparisonPeriod } : planned;
    const answer = executeAssistantTool(state, request, now);
    const revealEvidence = /^(?:show (?:me )?(?:(?:those|the|matching) )?(?:transactions|txn|txns|them|those)|choose (?:one|a) transaction)[?!.]?$/i.test(question.trim()) ||
      request.tool === 'obligation-status' && /^(?:show|list) (?:the )?payments[?!.]?$/i.test(question.trim());
    return { request, answer: answer.evidence?.length && revealEvidence ? { ...answer, showEvidence: true } : answer };
  });
}

/** Android interaction path: identical planning/presentation, cooperative only where recurrence is required. */
export async function runWafraAssistantCooperatively(
  state: AppState,
  question: string,
  now = new Date(),
  previousRequest?: AssistantToolRequest | null,
  defaultPeriod?: Period,
  cancelled: () => boolean = () => false,
): Promise<{ request: AssistantToolRequest; answer: AssistantAnswer } | null> {
  return measureRuntimeOperationAsync('ask-total', async () => {
    // Build the immutable snapshot index in short slices before planning. This
    // removes the last whole-ledger scans from the foreground interaction turn
    // while keeping every final calculation deterministic and local.
    if (!await prepareAssistantLedgerCooperatively(state, cancelled)) return null;
    const planned = measureRuntimeOperation('ask-plan', () =>
      planAssistantQuestion(state, question, now, previousRequest, defaultPeriod));
    const comparisonPeriod = effectiveComparisonPeriod(planned, now, state);
    const request: AssistantToolRequest = planned.tool === 'compare-periods' && comparisonPeriod
      ? { ...planned, period: comparisonPrimaryPeriod(planned, now, state), comparisonPeriod } : planned;
    const answer = await executeAssistantToolCooperatively(state, request, now, cancelled);
    if (answer === null || cancelled()) return null;
    const revealEvidence = /^(?:show (?:me )?(?:(?:those|the|matching) )?(?:transactions|txn|txns|them|those)|choose (?:one|a) transaction)[?!.]?$/i.test(question.trim()) ||
      request.tool === 'obligation-status' && /^(?:show|list) (?:the )?payments[?!.]?$/i.test(question.trim());
    return { request, answer: answer.evidence?.length && revealEvidence ? { ...answer, showEvidence: true } : answer };
  });
}

/**
 * Keep a clarification turn from erasing the last useful conversational scope.
 * The screen caps history at 12 turns, so this is a tiny bounded scan and runs
 * only while Ask Wafra is open.
 */
export function latestAssistantContext(requests: AssistantToolRequest[]): AssistantToolRequest | undefined {
  for (let index = requests.length - 1; index >= 0; index--) {
    if (requests[index].tool !== 'help') return requests[index];
  }
  return undefined;
}

export function suggestedAssistantQuestions(state: AppState, period = currentMonthPeriod(), now = new Date()): string[] {
  const rows = spendingRows(state, period);
  const topCategory = groupedCategoryTotals(rows)[0]?.key;
  const suggestions = ['How much did I spend?', 'Anything unusual?', 'What are my largest purchases?'];
  if (period.mode !== 'all' && topCategory) suggestions.push(`Why did my ${categoryLabel(topCategory, 'en').toLowerCase()} spending change?`);
  if (rows.some((row) => amountInCategory(row, 'rent') > 0)) suggestions.push('How much did I spend excluding rent?');
  if (rows.length >= 3) suggestions.push('Which recurring charges changed?');
  // Suggestions are navigation hints, not analysis. Never run subscription
  // detection merely to decide whether to display a question chip; that made
  // opening Ask Wafra itself compete with the first Send tap on large ledgers.
  if (suggestions.length < 5 && (state.bills.length > 0 || state.cardDues.length > 0)) {
    suggestions.push('What payments are due soon?');
  }
  suggestions.push('How much income did I receive?', 'What is my recorded history?');
  return suggestions.slice(0, 5);
}

/** Every suggested continuation retains the active scope and supported intent. */
export function assistantFollowUpQuestions(request?: AssistantToolRequest): string[] {
  if (!request || request.tool === 'help') return ['How much did I spend?', 'What is my recorded history?'];
  if (request.tool === 'subscriptions') return ['Which recurring charges changed?', 'What payments are due soon?', 'Anything unusual?'];
  if (request.tool === 'upcoming-payments') return ['What subscriptions do I have?', 'Anything unusual?', 'How much did I spend?'];
  if (request.tool === 'account-inventory') return request.accountKind === 'credit-card'
    ? ['Which card did I use most?', 'Did I settle my credit card?', 'What payments are due soon?']
    : ['Which account did I use most?', 'How much did I spend?', 'Anything unusual?'];
  if (request.tool === 'credit-card-settlement-summary') return ['What payments are due soon?', 'Which card did I use most?', 'Show me my credit cards'];
  if (request.tool === 'obligation-status') return request.obligation === 'card'
    ? ['How much is left?', 'When did I pay it?', 'Show the payments']
    : ['How much is left?', 'When did I pay it?', 'What payments are due soon?'];
  if (!('period' in request)) return ['What is due in the next 7 days?', 'How much did I spend?'];
  const previous = previousScopeQuestion(request.period) ?? 'What about the previous period?';
  if (request.tool === 'data-coverage') return [previous, 'Show my largest purchases'];
  if (request.tool === 'historical-baseline') return ['What is my highest month?', 'When did I last spend this much?', 'Show those transactions'];
  if (request.tool === 'top-accounts' || request.tool === 'compare-accounts') return ['Show those transactions', previous, 'Anything unusual?'];
  if (request.tool === 'income-total') return [previous, 'Show those transactions'];
  if (request.tool === 'money-review') return ['Show possible duplicate charges', 'Show unusual charges', 'Which recurring charges changed?'];
  if (['recurring-changes', 'unusual-charges', 'possible-duplicates'].includes(request.tool)) return [previous, 'Show those transactions'];
  if (request.tool === 'merchant-breakdown' || request.tool === 'category-breakdown') {
    return [previous, 'Why did it change?', 'Show those transactions'];
  }
  const excludeRent = !hasCategoryFilter(request) && !request.excludedCategories?.includes('rent') &&
    request.tool !== 'net-income-spending' && request.tool !== 'cash-outflow';
  return ['Show those transactions', ...(request.period.mode !== 'all' ? ['Compare the same dates'] : ['What about last month?']),
    excludeRent ? 'Exclude rent' : 'Show my largest purchases'];
}
