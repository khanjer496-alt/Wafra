import { categoryLabel, getCategory } from '@/lib/categories';
import { monthKey, shiftMonthKey } from '@/lib/format';
import { countsInTotals } from '@/lib/ledger';
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
  return {
    size: rows.length,
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
  };
}

/** Single filter/group/sum pass. Exact cents, split portions, hidden-account
 * and transfer exclusion rules stay identical to the canonical ledger. */
export function projectTransactionFilter(index: ReturnType<typeof createTransactionFilterIndex>, filters: TransactionFilters,
  options: { query: string; merchant: string | null; smsOnly: boolean; currentKey: string; period: Period;
    live: Set<string>; internal: Set<string> }) {
  const query = options.query.trim().toLowerCase(); const merchant = options.merchant?.trim().toLowerCase();
  const last = shiftMonthKey(options.currentKey, -1); const three = shiftMonthKey(options.currentKey, -2);
  const filtered: Transaction[] = []; const byDay = new Map<string, { date: string; totalFils: number; data: Transaction[] }>();
  let totalShown = 0; let transfers = 0; let hidden = 0;
  for (const { row, merchantKey, search, month } of index.ordered(filters.sort)) {
    if (options.smsOnly && row.source !== 'sms') continue;
    if (merchant && merchant !== merchantKey) continue;
    if (filters.type && row.type !== filters.type) continue;
    if (filters.accountId && row.accountId !== filters.accountId) continue;
    if (filters.categories.size > 0 && !touchesCategories(row, filters.categories)) continue;
    if (filters.minFils && row.amountFils < filters.minFils) continue;
    if (filters.datePreset === 'selected') {
      const period = options.period;
      if (period.mode === 'month' && month !== period.key) continue;
      if (period.mode === 'year' && Number(month.slice(0, 4)) !== period.year) continue;
      if (period.mode === 'range' && (row.date < period.from || row.date > period.to)) continue;
    }
    if (filters.datePreset === 'month' && month !== options.currentKey) continue;
    if (filters.datePreset === 'lastMonth' && month !== last) continue;
    if (filters.datePreset === '3months' && (month < three || month > options.currentKey)) continue;
    if (filters.datePreset === 'custom' && ((filters.dateFrom && row.date < filters.dateFrom) || (filters.dateTo && row.date > filters.dateTo))) continue;
    if (query && !search.includes(query)) continue;
    filtered.push(row);
    const counts = countsInTotals(row, options.live, options.internal);
    if (!counts) { if (options.live.has(row.accountId)) transfers++; else hidden++; }
    const part = !counts ? 0 : filters.categories.size > 0 ? amountInCategories(row, filters.categories) : row.amountFils;
    const contribution = row.type === 'expense' ? -part : part;
    totalShown += contribution;
    if (filters.sort !== 'largest') {
      let day = byDay.get(row.date);
      if (!day) { day = { date: row.date, totalFils: 0, data: [] }; byDay.set(row.date, day); }
      day.data.push(row); day.totalFils += contribution;
    }
  }
  return { filtered, totalShown, excluded: { transfers, hidden }, days: [...byDay.values()] };
}
