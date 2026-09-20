import { categoryLabel } from '@/lib/categories';
import { monthEndISO, monthKey, monthLabel, monthStartISO, shiftMonthKey, transactionTime } from '@/lib/format';
import { accountDisplayName, internalTransferIdsForState, isIncome, isSpending, liveAccountIds } from '@/lib/ledger';
import { merchantSpendingKey } from '@/lib/merchant-spending';
import { inPeriod, previousPeriod, type Period } from '@/lib/period';
import { allocationsOf, dominantCategory } from '@/lib/splits';
import type { Account, AppState, CategoryId, Transaction } from '@/lib/types';

export type RecapKind = 'month' | 'year';

export type RecapDescriptor =
  | { id: string; kind: 'month'; key: string; period: Period; label: string }
  | { id: string; kind: 'year'; year: number; period: Period; label: string };

export interface RecapMerchant {
  key: string;
  title: string;
  category: CategoryId;
  spendFils: number;
  count: number;
}

export interface RecapCategory {
  category: CategoryId;
  label: string;
  spendFils: number;
  percent: number;
}

export interface RecapAccount {
  account: Account;
  label: string;
  spendFils: number;
  count: number;
}

export interface RecapSnapshot {
  descriptor: RecapDescriptor;
  from: string;
  to: string;
  totalSpendFils: number;
  totalIncomeFils: number;
  netFils: number;
  spendingCount: number;
  merchantCount: number;
  averagePurchaseFils: number;
  noSpendDays: number;
  topMerchants: RecapMerchant[];
  topCategories: RecapCategory[];
  mostUsedAccount: RecapAccount | null;
  largestPurchase: { title: string; category: CategoryId; amountFils: number; date: string } | null;
  busiestWeekday: { day: number; spendFils: number; count: number } | null;
  favoriteTime: { bucket: 'morning' | 'afternoon' | 'evening' | 'night'; count: number } | null;
  previousSpendFils: number | null;
  spendChangeFils: number | null;
  spendChangePercent: number | null;
  monthlySeries: Array<{ key: string; label: string; spendFils: number }>;
}

export function recapDescriptor(kind: RecapKind, value: string | number): RecapDescriptor {
  if (kind === 'year') {
    const year = typeof value === 'number' ? value : Number(value);
    return { id: `year:${year}`, kind, year, period: { mode: 'year', year }, label: String(year) };
  }
  const key = String(value);
  return { id: `month:${key}`, kind, key, period: { mode: 'month', key }, label: monthLabel(key) };
}

/**
 * The completed recap the W on Home should surface now. In the first reporting
 * month of a new year the annual story gets the moment; otherwise it is the
 * month that just closed. Salary-day reporting stays aligned through monthKey.
 */
export function primaryRecapDescriptor(now = new Date()): RecapDescriptor {
  const current = monthKey(now);
  const month = Number(current.slice(5, 7));
  const year = Number(current.slice(0, 4));
  return month === 1
    ? recapDescriptor('year', year - 1)
    : recapDescriptor('month', shiftMonthKey(current, -1));
}

/**
 * Ordered stories for the Home W. January has two legitimate moments: the
 * annual story and the December story. Surface the annual one first, then let
 * the monthly recap take the ring after the year has been watched.
 */
export function recapCandidates(now = new Date()): RecapDescriptor[] {
  const current = monthKey(now);
  const month = Number(current.slice(5, 7));
  const year = Number(current.slice(0, 4));
  const monthly = recapDescriptor('month', shiftMonthKey(current, -1));
  return month === 1
    ? [recapDescriptor('year', year - 1), monthly]
    : [monthly];
}

/** Cheap Home eligibility check. Full analytics wait until the story opens. */
export function hasRecapActivity(transactions: readonly Transaction[], descriptor: RecapDescriptor): boolean {
  const unbounded = descriptor.period.mode === 'all';
  let newestFirst = true;
  for (let index = 1; index < transactions.length; index += 1) {
    if (transactions[index - 1].date < transactions[index].date) {
      newestFirst = false;
      break;
    }
  }
  let seenInPeriod = false;
  for (const transaction of transactions) {
    const inside = inPeriod(transaction.date, descriptor.period);
    if (!inside) {
      if (seenInPeriod && newestFirst && !unbounded) return false;
      continue;
    }
    seenInPeriod = true;
    if (transaction.type === 'expense' || transaction.type === 'income') return true;
  }
  return false;
}

function bounds(descriptor: RecapDescriptor): { from: string; to: string } {
  if (descriptor.kind === 'month') {
    return { from: monthStartISO(descriptor.key), to: monthEndISO(descriptor.key) };
  }
  return {
    from: monthStartISO(`${descriptor.year}-01`),
    to: monthEndISO(`${descriptor.year}-12`),
  };
}

function inclusiveDays(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`).getTime();
  const b = new Date(`${to}T12:00:00`).getTime();
  return Math.max(0, Math.round((b - a) / 86_400_000) + 1);
}

function bucketFor(transaction: Transaction): 'morning' | 'afternoon' | 'evening' | 'night' | null {
  const time = transactionTime(transaction);
  if (!time) return null;
  const hour = time.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

type MerchantAccumulator = {
  title: string;
  spendFils: number;
  count: number;
  categories: Map<CategoryId, number>;
};

type AccountAccumulator = { account: Account; spendFils: number; count: number };

function top<T>(rows: Iterable<T>, score: (row: T) => number, count: number): T[] {
  return [...rows].sort((a, b) => score(b) - score(a)).slice(0, count);
}

/** One local projection for the whole story. Home never runs this projection. */
export function projectRecap(state: AppState, descriptor: RecapDescriptor): RecapSnapshot {
  const live = liveAccountIds(state.accounts);
  const internal = internalTransferIdsForState(state);
  const accountById = new Map(state.accounts.map((account) => [account.id, account] as const));
  const priorPeriod = previousPeriod(descriptor.period);
  const categorySpend = new Map<CategoryId, number>();
  const merchants = new Map<string, MerchantAccumulator>();
  const accounts = new Map<string, AccountAccumulator>();
  const spendDates = new Set<string>();
  const weekdaySpend = Array.from({ length: 7 }, () => ({ spendFils: 0, count: 0 }));
  const times: Record<'morning' | 'afternoon' | 'evening' | 'night', number> = {
    morning: 0,
    afternoon: 0,
    evening: 0,
    night: 0,
  };
  const monthlySeries = descriptor.kind === 'year'
    ? Array.from({ length: 12 }, (_, index) => {
        const key = `${descriptor.year}-${String(index + 1).padStart(2, '0')}`;
        return { key, label: monthLabel(key, true), spendFils: 0 };
      })
    : [];
  const seriesByKey = new Map(monthlySeries.map((point) => [point.key, point] as const));

  let totalSpendFils = 0;
  let totalIncomeFils = 0;
  let spendingCount = 0;
  let priorSpendFils = 0;
  let priorSpendingCount = 0;
  let largest: Transaction | null = null;

  for (const transaction of state.transactions) {
    const current = inPeriod(transaction.date, descriptor.period);
    const prior = priorPeriod ? inPeriod(transaction.date, priorPeriod) : false;
    if (!current && !prior) continue;

    if (prior && isSpending(transaction, live, internal)) {
      priorSpendFils += transaction.amountFils;
      priorSpendingCount += 1;
    }
    if (!current) continue;

    if (isIncome(transaction, live, internal)) {
      totalIncomeFils += transaction.amountFils;
      continue;
    }
    if (!isSpending(transaction, live, internal)) continue;

    totalSpendFils += transaction.amountFils;
    spendingCount += 1;
    spendDates.add(transaction.date);
    if (!largest || transaction.amountFils > largest.amountFils) largest = transaction;

    const day = new Date(`${transaction.date}T12:00:00`).getDay();
    weekdaySpend[day]!.spendFils += transaction.amountFils;
    weekdaySpend[day]!.count += 1;
    const bucket = bucketFor(transaction);
    if (bucket) times[bucket] += 1;

    for (const allocation of allocationsOf(transaction)) {
      categorySpend.set(allocation.category,
        (categorySpend.get(allocation.category) ?? 0) + allocation.amountFils);
    }

    const merchantKey = merchantSpendingKey(transaction.title);
    if (merchantKey) {
      let merchant = merchants.get(merchantKey);
      if (!merchant) {
        merchant = { title: transaction.title.trim(), spendFils: 0, count: 0, categories: new Map() };
        merchants.set(merchantKey, merchant);
      }
      merchant.spendFils += transaction.amountFils;
      merchant.count += 1;
      for (const allocation of allocationsOf(transaction)) {
        merchant.categories.set(allocation.category,
          (merchant.categories.get(allocation.category) ?? 0) + allocation.amountFils);
      }
    }

    const account = accountById.get(transaction.accountId);
    if (account && !account.archived) {
      const row = accounts.get(account.id) ?? { account, spendFils: 0, count: 0 };
      row.spendFils += transaction.amountFils;
      row.count += 1;
      accounts.set(account.id, row);
    }

    if (descriptor.kind === 'year') {
      const point = seriesByKey.get(monthKey(transaction.date));
      if (point) point.spendFils += transaction.amountFils;
    }
  }

  const topCategories = top(categorySpend.entries(), (entry) => entry[1], 5)
    .map(([category, spendFils]) => ({
      category,
      label: categoryLabel(category),
      spendFils,
      percent: totalSpendFils > 0 ? Math.round((spendFils / totalSpendFils) * 100) : 0,
    }));

  const topMerchants = top(merchants.entries(), (entry) => entry[1].spendFils, 3)
    .map(([key, merchant]) => ({
      key,
      title: merchant.title,
      category: top(merchant.categories.entries(), (entry) => entry[1], 1)[0]?.[0] ?? 'other',
      spendFils: merchant.spendFils,
      count: merchant.count,
    }));

  const usedAccounts = [...accounts.values()];
  const cards = usedAccounts.filter((row) => row.account.kind === 'card' || row.account.cardType);
  const mostUsed = top(cards.length ? cards : usedAccounts,
    (row) => row.count * 1_000_000_000 + row.spendFils, 1)[0] ?? null;

  const busiestWeekday = weekdaySpend
    .map((row, day) => ({ day, ...row }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || b.spendFils - a.spendFils)[0] ?? null;
  const favorite = (Object.entries(times) as Array<[keyof typeof times, number]>)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])[0];

  const { from, to } = bounds(descriptor);
  const previousSpendFils = priorSpendingCount > 0 ? priorSpendFils : null;
  const spendChangeFils = previousSpendFils === null ? null : totalSpendFils - previousSpendFils;
  const spendChangePercent = previousSpendFils && spendChangeFils !== null
    ? Math.round((spendChangeFils / previousSpendFils) * 100)
    : null;

  return {
    descriptor,
    from,
    to,
    totalSpendFils,
    totalIncomeFils,
    netFils: totalIncomeFils - totalSpendFils,
    spendingCount,
    merchantCount: merchants.size,
    averagePurchaseFils: spendingCount > 0 ? Math.round(totalSpendFils / spendingCount) : 0,
    noSpendDays: Math.max(0, inclusiveDays(from, to) - spendDates.size),
    topMerchants,
    topCategories,
    mostUsedAccount: mostUsed ? {
      account: mostUsed.account,
      label: accountDisplayName(mostUsed.account),
      spendFils: mostUsed.spendFils,
      count: mostUsed.count,
    } : null,
    largestPurchase: largest ? {
      title: largest.title,
      category: dominantCategory(largest),
      amountFils: largest.amountFils,
      date: largest.date,
    } : null,
    busiestWeekday,
    favoriteTime: favorite ? { bucket: favorite[0], count: favorite[1] } : null,
    previousSpendFils,
    spendChangeFils,
    spendChangePercent,
    monthlySeries,
  };
}
