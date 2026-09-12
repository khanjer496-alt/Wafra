import { CATEGORIES, categoryLabel } from '@/lib/categories';
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
import { spendingChangeDrivers, type SpendingChangeDriver } from '@/lib/assistant-spending-analysis';
import { findRecurringChanges, findUnusualCharges, findPossibleDuplicates, patternAnalysisCoverage, type AssistantPattern } from '@/lib/assistant-patterns';
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
  | 'month-forecast'
  | 'recurring-changes'
  | 'unusual-charges'
  | 'possible-duplicates'
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
  | { tool: 'month-forecast'; period: Period }
  | { tool: 'recurring-changes' | 'unusual-charges' | 'possible-duplicates' | 'data-coverage'; period: Period }))
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
  facts?: { label: string; value: string }[];
  evidence?: AssistantEvidence[];
  findings?: AssistantFinding[];
  coverage?: AssistantCoverage;
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
  const grammar = new Set(('how much money did do does i my me we our you your the a an what which are is was were have has had am at from of for on in to with by about than this that these those all total recorded spending spend spent expense expenses purchase purchases transaction transactions pay paid payment payments cost costs net income salary business earned earn received receive more less minus forecast projected biggest largest most expensive top merchants merchant categories category why compare comparison versus vs increase increased decrease decreased change changed show previous period and or same dates charges charge recurring subscriptions subscription renewals renewal unusual unusually outlier outliers possible duplicate duplicates duplicated charged twice double coverage data gaps missing imports import status history recorded changes').split(' '));
  return normalizeMerchantText(rest).split(' ').some((token) => token && !grammar.has(token) && !/^\d+$/.test(token));
}

function resolveMerchant(phrase: string, rows: Transaction[]): { merchant?: string; candidates?: string[] } {
  const normalized = normalizeMerchantText(phrase);
  // Collapse exactly the same identity as filterRows and spending drivers:
  // outside whitespace and casing. Punctuation and branch suffixes stay distinct.
  const titles = [...new Map([...new Set(rows.map((tx) => tx.title.trim()).filter(Boolean))].sort()
    .map((title) => [normalize(title), title])).values()];
  const literal = titles.filter((title) => normalize(title) === normalize(phrase));
  if (literal.length === 1) return { merchant: literal[0] };
  const exact = titles.filter((title) => normalizeMerchantText(title) === normalized);
  if (exact.length === 1) return { merchant: exact[0] };
  const candidates = exact.length ? exact : titles.filter((title) => containsPhrase(title, phrase));
  return candidates.length === 1 ? { merchant: candidates[0] } : { candidates };
}

const filterFields = ['accountIds', 'merchant', 'category', 'merchants', 'categories',
  'excludedMerchants', 'excludedCategories', 'excludedAccountIds'] as const;

function copyFilters(source: AssistantFilters): AssistantFilters {
  return Object.fromEntries(filterFields.filter((key) => source[key] !== undefined)
    .map((key) => [key, Array.isArray(source[key]) ? [...source[key] as string[]] : source[key]]));
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
  const titles = new Set(state.transactions.map((row) => normalize(row.title)));
  if ([...includedMerchants(filters), ...(filters.excludedMerchants ?? [])].some((name) => !titles.has(normalize(name)))) {
    return 'I could not identify every merchant. Use its exact name from Transactions.';
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

    case 'data-coverage': {
      const accounts = selectedAccountIds(state, request);
      const rows = filterRows(state.transactions.filter((row) => accounts.has(row.accountId) && inPeriod(row.date, period)), request);
      const coverage = observedCoverage(state, rows, request);
      return { tool: request.tool, title: 'Recorded history',
        body: `${coverage.recordCount} recorded transaction${coverage.recordCount === 1 ? '' : 's'} match this view in ${scope}, across ${coverage.accountCount} of ${coverage.totalAccounts} selected account${coverage.totalAccounts === 1 ? '' : 's'}. This describes the records available to Wafra, not complete financial coverage.`,
        coverage, data: { recordCount: coverage.recordCount, accountCount: coverage.accountCount, totalAccounts: coverage.totalAccounts } };
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
      return {
        tool: request.tool,
        title: 'Spending change',
        body: prior === 0
          ? `You spent ${formatLedgerMoney(current)} in ${scope}. I do not have enough earlier spending to make a reliable comparison.`
          : `You spent ${formatLedgerMoney(current)} in ${scope}, ${pct}% ${delta >= 0 ? 'more' : 'less'} than ${previousScope}. There were ${analysis.currentCount} purchases, compared with ${analysis.previousCount}. Category and merchant changes are two views of the same spending; do not add them together.`,
        facts: [
          { label: scope, value: formatLedgerMoney(current) },
          { label: previousScope ?? 'Previous period', value: formatLedgerMoney(prior) },
          ...categoryChanges.slice(0, 3).map((item) => ({
            label: `${categoryLabel(item.key)} change`,
            value: `${item.delta >= 0 ? '+' : '−'}${formatLedgerMoney(Math.abs(item.delta))}`,
          })),
        ],
        findings: previous ? drivers : [],
        data: { currentFils: current, previousFils: prior, deltaFils: delta, deltaPercent: pct,
          currentCount: analysis.currentCount, previousCount: analysis.previousCount },
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
  if ('period' in request) {
    const error = invalidFilters(state, request);
    if (error) return executeAssistantToolResult(state, clarification(error), now);
    if ((request.tool === 'net-income-spending' || request.tool === 'cash-outflow') && hasContentFilter(request)) {
      return executeAssistantToolResult(state, clarification('This calculation supports account filters. Ask for spending or income separately to filter categories or merchants.'), now);
    }
    if (['recurring-changes', 'unusual-charges', 'possible-duplicates'].includes(request.tool) && hasCategoryFilter(request)) {
      return executeAssistantToolResult(state, clarification('Charge patterns need whole purchases. Ask by merchant or account without category filters.'), now);
    }
  }
  const answer = executeAssistantToolResult(state, request, now);
  if (request.tool === 'help' || request.tool === 'data-coverage') return answer;
  if (request.tool === 'subscriptions' || request.tool === 'upcoming-payments') return {
    ...answer,
    body: `${answer.body} ${request.tool === 'subscriptions' ? 'These are estimates from recurring recorded charges; actual renewals may differ.' : 'Includes recorded bills and predicted recurring charges; amounts or dates may change.'}`,
    destination: '/bills',
  };
  const period = comparisonPrimaryPeriod(request, now, state);
  const dates = scopeDates(period, state, now);
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
  } else if (['recurring-changes', 'unusual-charges', 'possible-duplicates'].includes(request.tool)) {
    const ids = new Set((answer.findings ?? []).flatMap((finding) => finding.evidence[0]?.transactionIds ?? []));
    groups = [evidenceFor(state, now, 'Charges to review', state.transactions.filter((row) => ids.has(row.id)))];
  } else groups = [evidence(request.tool === 'top-merchants' ? 'All spending used to rank merchants'
    : request.tool === 'top-categories' ? 'All spending used to rank categories'
      : request.category ? categoryLabel(request.category, 'en') : 'Spending', spending)];
  const qualifier = [includedMerchants(request).length ? `Merchants: ${includedMerchants(request).join(', ')}.` : '',
    includedCategories(request).length ? `Categories: ${includedCategories(request).map((category) => categoryLabel(category, 'en')).join(', ')}.` : '',
    request.excludedMerchants?.length ? `Excluding merchants: ${request.excludedMerchants.join(', ')}.` : '',
    request.excludedCategories?.length ? `Excluding categories: ${request.excludedCategories.map((category) => categoryLabel(category, 'en')).join(', ')}.` : '',
    request.accountIds || request.excludedAccountIds ? `Accounts: ${state.accounts.filter((account) => selectedAccountIds(state, request).has(account.id)).map((account) => account.name).join(', ') || 'none'}.` : '',
  ].filter(Boolean).join(' ');
  const scope = dates.from ? `${dates.from} to ${dates.to}` : `through ${dates.to}`;
  const previousDates = request.tool === 'compare-periods' ? groups[1] : undefined;
  const comparisonScope = previousDates ? ` Comparison: ${previousDates.from} to ${previousDates.to}.` : '';
  return { ...answer, body: `${answer.body} ${qualifier ? `${qualifier} ` : ''}Period: ${scope}.${comparisonScope} Based on recorded transactions; missing imports may change these figures.`, evidence: groups, coverage: answer.coverage ?? observedCoverage(state, request.tool === 'income-total' ? income : request.tool === 'net-income-spending' ? [...income, ...spending] : spending, request, request.tool === 'compare-periods' && !groups[1]?.transactionIds.length ? ['No earlier spending records match the comparison. A zero recorded baseline cannot establish a complete spending change.'] : []) };
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
  // A conjunction after an explicitly named account continues its account list.
  let accountList = false;
  for (const account of liveAccounts) {
    const name = escapeRegExp(normalize(account.name));
    const bareAccount = excluded && !categoriesFromQuestion(normalize(account.name)).length && !state.transactions.some((row) => normalize(row.title) === normalize(account.name))
      ? `|\\b${name}(?:\\s+(?:account|card))?(?=\\W|$)` : '';
    const pattern = new RegExp(`(?:\\b(?:from|in|on|using|with)\\s+(?:my\\s+)?)${name}(?:\\s+(?:account|card))?(?=\\W|$)|\\b${name}\\s+(?:account|card)\\b${bareAccount}`, 'g');
    if (!pattern.test(rest)) continue;
    if (liveAccounts.filter((item) => normalize(item.name) === normalize(account.name)).length > 1) {
      return { rest, merchants, accounts, error: clarification('More than one account has that name. Give those accounts distinct names before filtering by name.') };
    }
    accounts.push(account.id); accountList = true;
    rest = rest.replace(pattern, ' accountselection ');
  }
  if (accountList) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const account of liveAccounts) {
        const pattern = new RegExp(`\\baccountselection\\s*(?:,|and|or)\\s*(?:my\\s+)?${escapeRegExp(normalize(account.name))}(?:\\s+(?:account|card))?(?=\\W|$)`, 'g');
        if (!pattern.test(rest)) continue;
        if (liveAccounts.filter((item) => normalize(item.name) === normalize(account.name)).length > 1) return { rest, merchants, accounts, error: clarification('More than one account has that name. Give those accounts distinct names before filtering by name.') };
        accounts.push(account.id); rest = rest.replace(pattern, ' accountselection '); changed = true;
      }
    }
  }
  rest = rest.replace(/\baccountselection\b/g, ' ');
  const titles = [...new Set(state.transactions.map((row) => row.title.trim()).filter(Boolean))].sort((x, y) => y.length - x.length);
  for (const title of titles) {
    if (!containsPhrase(rest, title)) continue;
    // Category/income words are semantic unless explicitly introduced as a merchant.
    const reserved = categoriesFromQuestion(normalize(title)).length > 0 || /^(?:salary|income|business)$/i.test(title);
    const explicit = new RegExp(`\\b(?:at|from)\\s+${escapeRegExp(normalize(title))}(?=\\W|$)`).test(rest);
    if (reserved && !explicit) continue;
    if (!excluded && !explicit && categoriesFromQuestion(rest).length && !/\b(?:at|from)\b/.test(rest)) continue;
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
  if (!q || q.length > 1000) return clarification('Ask one short question about your recorded spending, income, or payments.');
  if (/^(?:help|what can (?:you|wafra) do|what can i ask|how does this work)\??$/.test(q)) return { tool: 'help' };
  const prior = previousRequest && 'period' in previousRequest ? previousRequest : undefined;
  if (/^show (?:me )?(?:(?:those|the|matching) )?transactions[?!.]?$/.test(q)) {
    return prior ?? clarification('Ask about a spending or income period first, then show its matching transactions.');
  }
  const followUp = /^(?:and\b|what about\b|how about\b|compare\b|top\b|show\b|exclude\b|excluding\b|without\b|ignore\b)/.test(q);
  const filters = followUp && prior ? copyFilters(prior) : {};
  const quotedNames: string[] = [];
  const protectedQuestion = q.replace(/"(?:[^"\\]|\\.)*"/g, (name) => { quotedNames.push(name); return `quotedmerchanttoken${quotedNames.length - 1}end`; });
  const rawClauses = protectedQuestion.split(/\b(?:exclude|excluding|except|without|not including|ignore|other than|minus(?!\s+spending\b))\b/)
    .map((clause) => clause.replace(/quotedmerchanttoken(\d+)end/g, (_, index: string) => quotedNames[Number(index)]));
  const exclusionOnly = rawClauses.length > 1 && !rawClauses[0].trim();
  if (exclusionOnly && !prior) return clarification('Ask about a spending or income period first, then exclude a category, merchant, or account.');
  const clauses = rawClauses.map((clause, index) => extractNamedClause(state, clause, question, index > 0));
  const failed = clauses.find((clause) => clause.error);
  if (failed?.error) return failed.error;
  q = clauses.map((clause) => clause.rest).join(' ');
  if (/\b(?:afford|should i|can i|budget left|safe to spend|balance|save|saving|recommend|refund|over\s+\d|under\s+\d|above\s+\d|below\s+\d)\b/.test(q)) {
    return clarification('I can explain recorded spending and income, but cannot reliably answer that condition. Try a spending total or an income comparison.');
  }
  const limit = requestedLimit(q);
  if (limit !== undefined && (limit < 1 || limit > 10)) return clarification('Choose between 1 and 10 results.');
  const intentText = clauses[0].rest;
  const isIncomeQuestion = /\b(?:income|salary|earned|received|receive|earn)\b/.test(intentText);
  const net = /income minus spending|spen[dt] more than i earned|more than i earn|what.*net|net spending|net cashflow/.test(intentText);
  if (isIncomeQuestion && !net && /\b(?:spend|spent|spending|expenses?)\b/.test(intentText)) return clarification('Ask for income and spending separately, or ask for income minus spending.');
  const recurring = /\b(?:recurring|subscription|subscriptions|renewal|renewals)\b/.test(q) && /\b(?:change|changed|changes|increase|increased|decrease|decreased|compare)\b/.test(q);
  const unusual = /\b(?:unusual|unusually|outlier|outliers)\b/.test(q);
  const duplicates = /\b(?:duplicate|duplicates|duplicated|charged twice|double charged)\b/.test(q);
  const coverageQuestion = /\b(?:coverage|data gaps|missing imports|import status|import history|recorded history)\b/.test(q);
  const comparison = !net && !recurring && /\b(?:compare|more than|less than|increase|decrease|change|changed|vs|versus)\b|why.*spend/.test(q);
  const upcoming = /\b(?:due|upcoming|bills?)\b/.test(q) && !/\b(?:paid|spent|did|last|previous)\b/.test(q);
  const subscriptions = !recurring && /\b(?:subscriptions?|recurring charges?|renewals?)\b/.test(q) && !/\b(?:paid|spent|did|last|previous|change|changed|increase|decrease|compare)\b/.test(q);
  if (upcoming || subscriptions) {
    if (/\b(?:this week|next week|next month)\b/.test(q)) return clarification('Use a specific upcoming window, such as payments due within the next 7 days.');
    const windowless = q.replace(/\b(?:next|within)\s+\d+\s+days?\b/g, ' ');
    const futurePeriods = parsePeriods(windowless, now);
    if (rawClauses.length > 1 || clauses.some((clause) => clause.accounts.length || clause.merchants.length) ||
      futurePeriods.error || futurePeriods.periods.length || categoriesFromQuestion(q).length || Object.keys(filters).length || /\bat\b/.test(q)) {
      return clarification('I can show the overall upcoming payments or active subscriptions. A filtered historical view is not supported for those estimates.');
    }
    const match = q.match(/\b(?:next|within)\s+(\d+)\s+days?\b/);
    const withinDays = match ? Number(match[1]) : 30;
    if (withinDays < 1 || withinDays > 90) return clarification('Use an upcoming window between 1 and 90 days.');
    if (subscriptions) {
      const remaining = q.replace(/\b(?:what|which|are|is|my|the|active|biggest|all|subscriptions|subscription|recurring|charges|charge|renewal|renewals|monthly|total|cost|how|much|do|i|pay|for|have)\b/g, '').replace(/[?!.\s]/g, '');
      return remaining ? clarification('I can show all active subscription estimates. Try asking which recurring charges changed for a historical analysis.') : { tool: 'subscriptions' };
    }
    const remaining = q.replace(/\b(?:what|which|when|are|is|my|the|all|payments|payment|bills|bill|due|upcoming|soon|in|within|next|days|day|how|much|do|i|have|to|pay)\b/g, '').replace(/[?!.\s\d]/g, '');
    return remaining ? clarification('I can show all upcoming payments within a number of days. Filtering those estimates by service is not available yet.') : { tool: 'upcoming-payments', withinDays };
  }
  if (/\bbills?\b/.test(q)) return clarification('I can show upcoming bills. For past spending, name a merchant or category and a date range.');
  if (!recurring && /\b(?:recurring|subscriptions?|renewals?)\b/.test(q)) return clarification('Ask which recurring charges changed, or show active subscription estimates.');
  const parsed = parsePeriods(q, now);
  if (parsed.error) return clarification(parsed.error);
  if (parsed.periods.length > (comparison ? 2 : 1)) return clarification('Ask about one date range, or compare two clearly named periods.');
  let period = parsed.periods[0] ?? (followUp ? prior?.period : undefined) ?? defaultPeriod ?? currentMonthPeriod(now);
  let comparisonPeriod = parsed.periods[1];
  if (prior && comparison && parsed.periods.length === 1 && /^compare(?: with)?\s+(?:last month|previous month|this month|[a-z]+\s+\d{4})[?!.]?$/i.test(question.trim())) {
    period = prior.period;
    const relativePrevious = /\b(?:last|previous) month\b/i.test(question);
    const earlier = prior.tool === 'compare-periods' ? prior.comparisonPeriod : undefined;
    const requestedDates = scopeDates(parsed.periods[0], state, now);
    const earlierDates = earlier ? scopeDates(earlier, state, now) : undefined;
    const reuseEarlier = earlier && earlierDates?.from && requestedDates.from && earlierDates.from >= requestedDates.from && earlierDates.to && requestedDates.to && earlierDates.to <= requestedDates.to;
    comparisonPeriod = relativePrevious ? reuseEarlier ? earlier : comparablePreviousPeriod(prior.period, now, state.transactions) ?? parsed.periods[0] : parsed.periods[0];
    if (relativePrevious) period = comparisonPrimaryPeriod({ tool: 'compare-periods', period: prior.period }, now, state);
  }
  const parsedClauses = clauses.map((clause) => ({ ...clause, rest: parsePeriods(clause.rest, now).rest }));
  for (let index = 0; index < parsedClauses.length; index++) {
    const clause = parsedClauses[index];
    // Remaining at/from phrases are unresolved merchant names, including partial
    // branch names. A mixed known/unknown list must clarify as a whole.
    const phrase = clause.rest.match(/\b(?:at|from)\s+([^\s?!.].*?)(?=\s+(?:with|using|on|in|for|compared|versus|vs|change|changed|increase|decrease)\b|[?!.]|$)/)?.[1]?.trim().replace(/^(?:and|or)\s+/, '').trim();
    if (phrase && !/^(?:and|or)$/.test(phrase) && !/^(?:change|changed|increase|decrease|with|using|on|in|for|compared|versus|vs)\b/.test(phrase)) {
      const resolved = resolveMerchant(phrase, state.transactions);
      if (!resolved.merchant) {
        const candidates = resolved.candidates ?? [];
        return clarification(candidates.length ? `Several recorded merchants match “${phrase}”. Choose the exact merchant.` : `I could not find a recorded merchant matching “${phrase}”. Check the name in Transactions.`,
          candidates.slice(0, 4).map((candidate) => question.replace(new RegExp(escapeRegExp(phrase), 'i'), JSON.stringify(candidate))));
      }
      clause.merchants.push(resolved.merchant); clause.rest = clause.rest.replace(phrase, ' ');
    }
    const categories = categoriesFromQuestion(clause.rest);
    if ((isIncomeQuestion && !net || index > 0) && /\bsalary\b/.test(clause.rest)) categories.push('salary');
    if ((isIncomeQuestion && !net || index > 0) && /\bbusiness\b/.test(clause.rest)) categories.push('business');
    if (index > 0 && clause.accounts.length && (categories.length || clause.merchants.length)) return clarification('Keep account selection before the exclusion, for example: spending from Everyday excluding rent. Name account exclusions separately.');
    if (index === 0) {
      if (clause.accounts.length) filters.accountIds = [...new Set(clause.accounts)];
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
  if (/\b(?:my|the|a|an)\s+(?:\w+\s+)?(?:account|card)\b|\b(?:account|card)\s+\d+\b/.test(q) && !/left my account/.test(q)) return clarification('I could not identify that account. Use its exact name from Accounts.');
  if (/\d/.test(q.replace(/\btop\s+\d+\b/g, '')) ||
    /\b(?:in|during|before|after|since|between|with|using)\s+(?!(?:the )?previous period\b)\S|\b(?:usd|eur|gbp|aed|sar|jpy|kwd)\b|[$€£]/.test(q) ||
    (!hasCategoryFilter(filters) && /\bon\s+(?!track\b)\S/.test(q)) ||
    (includedMerchants(filters).length > 1 && /\b(?:vs|versus)\b/.test(q))) {
    return clarification('I could not preserve every condition in that question. Use exact merchants, categories, accounts, and date ranges.');
  }
  const scopeError = invalidFilters(state, filters);
  if (scopeError) return clarification(scopeError);
  if (hasUnsupportedRemainder(q)) return clarification('I could not identify every condition in that question. Ask about recorded spending or income with named filters and a date range.');
  const scoped = { period, ...filters };
  const multipleDimensions = includedCategories(filters).length > 1 || includedMerchants(filters).length > 1 || (filters.accountIds?.length ?? 0) > 1;
  if (comparison && multipleDimensions && !comparisonPeriod && parsed.periods.length < 2 && !/\b(?:why|change|changed|previous period|same dates)\b/.test(q)) return clarification('I can compare the combined spending for these filters over time. Name two periods or ask why their combined spending changed.');
  if (comparison && /\b(?:more than|less than|vs|versus)\b/.test(q) && multipleDimensions && parsed.periods.length < 2) return clarification('Name two periods to compare the combined spending. Comparing individual categories, merchants, or accounts against each other is not supported yet.');
  if (recurring && /\b(?:increased?|decreased?|higher|lower|more|less)\b/.test(intentText)) return clarification('I can show recorded recurring changes in both directions. Ask which recurring charges changed.');
  if (coverageQuestion) return { tool: 'data-coverage', ...scoped };
  if (recurring || unusual || duplicates) {
    if ([recurring, unusual, duplicates].filter(Boolean).length > 1 || /\b(?:daily|average|forecast|projected|top|largest|biggest|net|cash out)\b/.test(q)) return clarification('Ask for one charge pattern at a time without a ranking, average, or forecast condition.');
    if (hasCategoryFilter(filters)) return clarification('Charge patterns need whole purchases. Ask by merchant or account without category filters.');
    if (isIncomeQuestion || net) return clarification('Charge patterns are available for recorded spending. Ask for income totals separately.');
    return { tool: recurring ? 'recurring-changes' : unusual ? 'unusual-charges' : 'possible-duplicates', ...scoped };
  }
  if (followUp && prior && (exclusionOnly || /^(?:and\s+)?(?:what about|how about)\s*[?!.]?$/.test(q))) {
    const inherited = { ...prior, ...filters, period };
    // Replacing a plural dimension must remove the prior singular form, too.
    for (const field of ['merchant', 'merchants', 'category', 'categories'] as const) if (!(field in filters)) delete inherited[field];
    if (inherited.tool === 'compare-periods' && parsed.periods.length) delete inherited.comparisonPeriod;
    if (inherited.tool === 'merchant-breakdown' && !filters.merchant || inherited.tool === 'category-breakdown' && !filters.category) {
      return { tool: 'spending-total', ...scoped };
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
  if (/\b(?:spend|spent|spending|expense|expenses|purchase|purchases|paid|pay)\b|cost me/.test(q)) return { tool: 'spending-total', ...scoped };
  return { tool: 'help' };
}

export function answerWafraQuestion(state: AppState, question: string, now = new Date(), previousRequest?: AssistantToolRequest | null, defaultPeriod?: Period): AssistantAnswer {
  return executeAssistantTool(state, planAssistantQuestion(state, question, now, previousRequest, defaultPeriod), now);
}

export function runWafraAssistant(state: AppState, question: string, now = new Date(), previousRequest?: AssistantToolRequest | null, defaultPeriod?: Period): { request: AssistantToolRequest; answer: AssistantAnswer } {
  const planned = planAssistantQuestion(state, question, now, previousRequest, defaultPeriod);
  const comparisonPeriod = effectiveComparisonPeriod(planned, now, state);
  const request: AssistantToolRequest = planned.tool === 'compare-periods' && comparisonPeriod
    ? { ...planned, period: comparisonPrimaryPeriod(planned, now, state), comparisonPeriod } : planned;
  const answer = executeAssistantTool(state, request, now);
  return { request, answer: answer.evidence?.length && /^show (?:me )?(?:(?:those|the|matching) )?transactions[?!.]?$/i.test(question.trim()) ? { ...answer, showEvidence: true } : answer };
}

export function suggestedAssistantQuestions(state: AppState, period = currentMonthPeriod(), now = new Date()): string[] {
  const rows = spendingRows(state, period);
  const topCategory = groupedCategoryTotals(rows)[0]?.key;
  const suggestions = ['How much did I spend?', 'What are my largest purchases?'];
  if (period.mode !== 'all' && topCategory) suggestions.push(`Why did my ${categoryLabel(topCategory, 'en').toLowerCase()} spending change?`);
  if (rows.some((row) => amountInCategory(row, 'rent') > 0)) suggestions.push('How much did I spend excluding rent?');
  if (rows.length >= 3) suggestions.push('Which recurring charges changed?');
  if (suggestions.length < 5 && leavingSoon(state, now, { withinDays: 30 }).length) suggestions.push('What payments are due soon?');
  suggestions.push('How much income did I receive?', 'What is my recorded history?');
  return suggestions.slice(0, 5);
}

/** Every suggested continuation retains the active scope and supported intent. */
export function assistantFollowUpQuestions(request?: AssistantToolRequest): string[] {
  if (!request || request.tool === 'help') return ['How much did I spend?', 'What is my recorded history?'];
  if (!('period' in request)) return ['What is due in the next 7 days?', 'How much did I spend?'];
  if (request.tool === 'data-coverage') return ['What about last month?', 'Show my largest purchases'];
  if (request.tool === 'income-total') return ['What about last month?', 'Show those transactions'];
  if (['recurring-changes', 'unusual-charges', 'possible-duplicates'].includes(request.tool)) return ['What about last month?', 'Show those transactions'];
  const excludeRent = !hasCategoryFilter(request) && !request.excludedCategories?.includes('rent') &&
    request.tool !== 'net-income-spending' && request.tool !== 'cash-outflow';
  return ['Show those transactions', ...(request.period.mode !== 'all' ? ['Compare the same dates'] : ['What about last month?']),
    excludeRent ? 'Exclude rent' : 'Show my largest purchases'];
}
