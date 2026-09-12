import { checkedMinorSum } from '@/lib/ledger-money';
import { allocationsOf } from '@/lib/splits';
import type { CategoryId, Transaction } from '@/lib/types';

export interface SpendingChangeDriver<Key extends string = string> {
  key: Key;
  /** A recorded spelling for a merchant; categories are named by their caller. */
  displayTitle?: string;
  currentFils: number;
  previousFils: number;
  deltaFils: number;
  currentCount: number;
  previousCount: number;
  currentTransactionIds: string[];
  previousTransactionIds: string[];
  /** The scoped contribution, which may be only part of a split purchase. */
  currentContributionsFils: Record<string, number>;
  previousContributionsFils: Record<string, number>;
}

export interface SpendingChangeAnalysis {
  currentFils: number;
  previousFils: number;
  deltaFils: number;
  currentCount: number;
  previousCount: number;
  /** Category and merchant drivers are alternate breakdowns of the same change. */
  categoryDrivers: SpendingChangeDriver<CategoryId>[];
  merchantDrivers: SpendingChangeDriver[];
}

interface Group {
  totalFils: number;
  contributions: Map<string, number>;
  displayTitle?: string;
}

const compareKeys = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

function addContribution<Key extends string>(
  groups: Map<Key, Group>,
  key: Key,
  id: string,
  amountFils: number,
  displayTitle?: string,
): void {
  if (amountFils === 0) return;
  const group = groups.get(key) ?? { totalFils: 0, contributions: new Map<string, number>() };
  group.totalFils = checkedMinorSum([group.totalFils, amountFils]);
  group.contributions.set(id, checkedMinorSum([group.contributions.get(id) ?? 0, amountFils]));
  if (displayTitle !== undefined &&
    (group.displayTitle === undefined || compareKeys(displayTitle, group.displayTitle) < 0)) {
    group.displayTitle = displayTitle;
  }
  groups.set(key, group);
}

function periodTotals(rows: readonly Transaction[]) {
  let totalFils = 0;
  const transactionIds = new Set<string>();
  const categories = new Map<CategoryId, Group>();
  const merchants = new Map<string, Group>();
  for (const row of rows) {
    const allocations = allocationsOf(row);
    const allocatedFils = checkedMinorSum(allocations.map(part => part.amountFils));
    totalFils = checkedMinorSum([totalFils, row.amountFils]);
    if (row.amountFils < 0 || allocations.some(part => part.amountFils < 0)) {
      throw new Error('Spending contributions must be non-negative');
    }
    if (allocatedFils !== row.amountFils) {
      throw new Error('Spending allocations must equal the scoped transaction amount');
    }
    if (row.amountFils === 0) continue;
    transactionIds.add(row.id);
    for (const part of allocations) {
      addContribution(categories, part.category, row.id, part.amountFils);
    }
    // Case and outside spacing are harmless variants; branch suffixes and
    // punctuation remain distinct, without guessing brand ownership.
    const title = row.title.trim();
    addContribution(merchants, title.toLowerCase(), row.id, row.amountFils, title || 'Unknown merchant');
  }
  return { totalFils, count: transactionIds.size, categories, merchants };
}

function drivers<Key extends string>(current: Map<Key, Group>, previous: Map<Key, Group>): SpendingChangeDriver<Key>[] {
  const keys = new Set([...current.keys(), ...previous.keys()]);
  return [...keys].map(key => {
    const currentGroup = current.get(key);
    const previousGroup = previous.get(key);
    const currentFils = currentGroup?.totalFils ?? 0;
    const previousFils = previousGroup?.totalFils ?? 0;
    const currentTransactionIds = [...currentGroup?.contributions.keys() ?? []].sort(compareKeys);
    const previousTransactionIds = [...previousGroup?.contributions.keys() ?? []].sort(compareKeys);
    const titles = [currentGroup?.displayTitle, previousGroup?.displayTitle]
      .filter((title): title is string => title !== undefined).sort(compareKeys);
    return {
      key,
      ...(titles.length ? { displayTitle: titles[0] } : {}),
      currentFils,
      previousFils,
      deltaFils: checkedMinorSum([currentFils, -previousFils]),
      currentCount: currentTransactionIds.length,
      previousCount: previousTransactionIds.length,
      currentTransactionIds,
      previousTransactionIds,
      currentContributionsFils: Object.fromEntries(currentTransactionIds.map(id => [id, currentGroup!.contributions.get(id)!])),
      previousContributionsFils: Object.fromEntries(previousTransactionIds.map(id => [id, previousGroup!.contributions.get(id)!])),
    };
  }).sort((a, b) => Math.abs(b.deltaFils) - Math.abs(a.deltaFils) || compareKeys(a.key, b.key));
}

/**
 * Explain changes in already-scoped spending. The caller owns ledger/live,
 * period and account/merchant/category filtering, including exclusions. A
 * weighted split row must retain just its selected allocations and their sum
 * as amountFils. Source fragments may share an ID; purchase counts and proof
 * count that source once while preserving every scoped contribution.
 *
 * All values stay in the caller's ledger minor units. No currency conversion,
 * threshold, average, or inferred missing purchase is introduced here.
 */
export function spendingChangeDrivers(
  current: readonly Transaction[],
  previous: readonly Transaction[],
): SpendingChangeAnalysis {
  const currentTotals = periodTotals(current);
  const previousTotals = periodTotals(previous);
  return {
    currentFils: currentTotals.totalFils,
    previousFils: previousTotals.totalFils,
    deltaFils: checkedMinorSum([currentTotals.totalFils, -previousTotals.totalFils]),
    currentCount: currentTotals.count,
    previousCount: previousTotals.count,
    categoryDrivers: drivers(currentTotals.categories, previousTotals.categories),
    merchantDrivers: drivers(currentTotals.merchants, previousTotals.merchants),
  };
}
