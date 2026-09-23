import { categoryLabel, getCategory } from '@/lib/categories';
import { monthKey, shiftMonthKey } from '@/lib/format';
import { countsInTotals, isMoneyMovementOnly } from '@/lib/ledger';
import type { Period } from '@/lib/period';
import { amountInCategories, touchesCategories } from '@/lib/splits';
import type { CategoryId, Transaction, TransactionType } from '@/lib/types';

export type DatePreset = 'selected' | 'all' | 'month' | 'lastMonth' | '3months' | 'custom';
export type SortMode = 'newest' | 'oldest' | 'largest';
export interface TransactionFilters {
  type: TransactionType | null; accountId: string | null; categories: Set<CategoryId>;
  datePreset: DatePreset; dateFrom: string | null; dateTo: string | null;
  minFils: number | null; sort: SortMode;
}
interface IndexedTransaction { row: Transaction; merchantKey: string; search: string; month: string }
type TransactionFilterOptions = {
  query: string;
  merchant: string | null;
  smsOnly: boolean;
  currentKey: string;
  period: Period;
  live: Set<string>;
  internal: Set<string>;
  corroborating: Set<string>;
  /** Confirmed transfer records have a separate browsing surface. Their
   * existing financial contribution still belongs in the matching total. */
  separateTransferIds?: ReadonlySet<string>;
};
type TransactionFilterProjection = {
  filtered: Transaction[];
  totalShown: number;
  excluded: { transfers: number; movements: number; hidden: number };
  separatedTransfers: { count: number; incomeFils: number; expenseFils: number };
  days: { date: string; totalFils: number; data: Transaction[] }[];
};

/** Owned by one mounted screen. Rebuild when ledger, language or salary day
 * changes; never cache personal strings globally or modify the source rows. */
export function createTransactionFilterIndex(rows: readonly Transaction[], language: string) {
  const labels = new Map<CategoryId, string>();
  const entries: IndexedTransaction[] = rows.map(row => {
    let category = labels.get(row.category);
    if (category === undefined) {
      category = getCategory(row.category).label.toLowerCase() + '\u0000' +
        categoryLabel(row.category, language === 'ar' ? 'ar' : 'en').toLowerCase();
      labels.set(row.category, category);
    }
    const title = row.title.toLowerCase();
    return { row, merchantKey: title.trim(), search: title + '\u0000' + category, month: monthKey(row.date) };
  });
  // Sorting changes no filter result and is needed at most once per ledger.
  // The expensive Date parse is computed once per row, not per comparison.
  const ordered = new Map<SortMode, IndexedTransaction[]>([['newest', entries]]);
  const newestDateOrdered = entries.every((item, index) =>
    index === 0 || entries[index - 1].row.date >= item.row.date);
  // The filter sheet previews the exact result count before Apply. Without a
  // per-index memo, tapping Apply immediately repeated the same complete-ledger
  // projection while Android was dismissing the sheet. Keep only one exact
  // projection and tie its lifetime to this screen-owned index; personal query
  // strings never escape the mounted Transactions screen.
  let lastProjection: {
    filters: TransactionFilters;
    options: TransactionFilterOptions;
    result: TransactionFilterProjection;
  } | null = null;
  return {
    size: rows.length,
    newestDateOrdered,
    ordered(sort: SortMode) {
      const prior = ordered.get(sort);
      if (prior) return prior;
      let result: IndexedTransaction[];
      if (sort === 'largest') result = [...entries].sort((a, b) => b.row.amountFils - a.row.amountFils);
      else {
        const times = new Map(entries.map(item => [item.row, item.row.ts ?? Date.parse(`${item.row.date}T12:00:00Z`)]));
        result = [...entries].sort((a, b) => (a.row.date < b.row.date ? -1 : a.row.date > b.row.date ? 1 : 0) ||
          times.get(a.row)! - times.get(b.row)!);
      }
      ordered.set(sort, result); return result;
    },
    cached(filters: TransactionFilters, options: TransactionFilterOptions) {
      return lastProjection?.filters === filters && lastProjection.options === options
        ? lastProjection.result
        : null;
    },
    remember(filters: TransactionFilters, options: TransactionFilterOptions, result: TransactionFilterProjection) {
      lastProjection = { filters, options, result };
    },
  };
}

/** Single filter/group/sum pass. Exact cents, split portions, hidden-account
 * and transfer exclusion rules stay identical to the canonical ledger. */
export function projectTransactionFilter(index: ReturnType<typeof createTransactionFilterIndex>, filters: TransactionFilters,
  options: TransactionFilterOptions): TransactionFilterProjection {
  const cached = index.cached(filters, options);
  if (cached) return cached;
  const query = options.query.trim().toLowerCase(); const merchant = options.merchant?.trim().toLowerCase();
  const last = shiftMonthKey(options.currentKey, -1); const three = shiftMonthKey(options.currentKey, -2);
  let dateFrom: string | null = null; let dateTo: string | null = null;
  let monthFrom: string | null = null; let monthTo: string | null = null;
  if (filters.datePreset === 'selected') {
    if (options.period.mode === 'month') monthFrom = monthTo = options.period.key;
    else if (options.period.mode === 'year') {
      monthFrom = `${options.period.year}-01`; monthTo = `${options.period.year}-12`;
    } else if (options.period.mode === 'range') {
      dateFrom = options.period.from; dateTo = options.period.to;
    }
  } else if (filters.datePreset === 'month') monthFrom = monthTo = options.currentKey;
  else if (filters.datePreset === 'lastMonth') monthFrom = monthTo = last;
  else if (filters.datePreset === '3months') { monthFrom = three; monthTo = options.currentKey; }
  else if (filters.datePreset === 'custom') { dateFrom = filters.dateFrom; dateTo = filters.dateTo; }
  const filtered: Transaction[] = []; const byDay = new Map<string, { date: string; totalFils: number; data: Transaction[] }>();
  let totalShown = 0; let transfers = 0; let movements = 0; let hidden = 0;
  const separatedTransfers = { count: 0, incomeFils: 0, expenseFils: 0 };
  const ordered = index.ordered(filters.sort);
  const ascending = filters.sort === 'oldest';
  const canStopAtDateBoundary = ascending || (filters.sort === 'newest' && index.newestDateOrdered);
  for (const { row, merchantKey, search, month } of ordered) {
    // Date filtering is normally the narrowest filter on a large ledger. The
    // source ledger is newest-first and the cached oldest view is explicitly
    // sorted, so once we cross the requested boundary there is no reason to
    // inspect the remaining 10k+ rows. `largest` stays a full scan because its
    // amount order deliberately destroys date locality.
    const belowDate = dateFrom !== null && row.date < dateFrom;
    const aboveDate = dateTo !== null && row.date > dateTo;
    const belowMonth = monthFrom !== null && month < monthFrom;
    const aboveMonth = monthTo !== null && month > monthTo;
    if (belowDate || belowMonth) {
      if (canStopAtDateBoundary && !ascending) break;
      continue;
    }
    if (aboveDate || aboveMonth) {
      if (canStopAtDateBoundary && ascending) break;
      continue;
    }
    if (options.smsOnly && row.source !== 'sms') continue;
    if (merchant && merchant !== merchantKey) continue;
    if (filters.type && row.type !== filters.type) continue;
    if (filters.accountId && row.accountId !== filters.accountId) continue;
    if (filters.categories.size > 0 && !touchesCategories(row, filters.categories)) continue;
    if (filters.minFils && row.amountFils < filters.minFils) continue;
    if (query && !search.includes(query)) continue;
    if (options.corroborating.has(row.id)) continue;
    const counts = countsInTotals(row, options.live, options.internal);
    const part = !counts ? 0 : filters.categories.size > 0 ? amountInCategories(row, filters.categories) : row.amountFils;
    const contribution = row.type === 'expense' ? -part : part;
    totalShown += contribution;
    if (options.separateTransferIds?.has(row.id)) {
      separatedTransfers.count++;
      if (row.type === 'income') separatedTransfers.incomeFils += part;
      else separatedTransfers.expenseFils += part;
      continue;
    }
    filtered.push(row);
    if (!counts) {
      if (!options.live.has(row.accountId)) hidden++;
      else if (isMoneyMovementOnly(row)) movements++;
      else transfers++;
    }
    if (filters.sort !== 'largest') {
      let day = byDay.get(row.date);
      if (!day) { day = { date: row.date, totalFils: 0, data: [] }; byDay.set(row.date, day); }
      day.data.push(row); day.totalFils += contribution;
    }
  }
  const result = { filtered, totalShown, excluded: { transfers, movements, hidden }, separatedTransfers, days: [...byDay.values()] };
  index.remember(filters, options, result);
  return result;
}
