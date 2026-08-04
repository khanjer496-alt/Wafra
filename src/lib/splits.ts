/**
 * Splitting one charge across categories.
 *
 * A single Carrefour swipe is often mostly groceries and partly a phone
 * charger, and filing the whole thing under one heading is how a grocery
 * budget ends up looking broken. A split keeps the transaction — one charge,
 * one amount, one row in the ledger, still deduplicated by its SMS
 * fingerprint — and divides only how it is *counted*.
 *
 * The invariant is that the parts sum to the parent exactly. If it ever
 * slipped, spending totals would quietly stop matching the bank, which is the
 * one bug a money app cannot have. Every mutation goes through
 * `normalizeSplits`, and `allocationsOf` is the only way analytics should ever
 * read a category off a transaction.
 */
import type { CategoryId, Transaction, TransactionSplit } from '@/lib/types';

export interface Allocation {
  category: CategoryId;
  amountFils: number;
}

/**
 * How this transaction counts against categories: its splits when it has
 * them, otherwise the whole amount under its own category. Readers that use
 * this need no other knowledge of splitting.
 */
export function allocationsOf(t: Transaction): Allocation[] {
  if (!t.splits || t.splits.length === 0) {
    return [{ category: t.category, amountFils: t.amountFils }];
  }
  return t.splits.map((s) => ({ category: s.category, amountFils: s.amountFils }));
}

/** What this transaction contributes to one category. */
export function amountInCategory(t: Transaction, category: CategoryId): number {
  let total = 0;
  for (const a of allocationsOf(t)) if (a.category === category) total += a.amountFils;
  return total;
}

export function isSplit(t: Transaction): boolean {
  return !!t.splits && t.splits.length > 1;
}

/** Fils not yet assigned. Negative means the parts overshoot the charge. */
export function unallocatedFils(totalFils: number, splits: TransactionSplit[]): number {
  return totalFils - splits.reduce((sum, s) => sum + s.amountFils, 0);
}

/**
 * Force the parts to sum to the charge and fold duplicate categories together.
 *
 * Rounding is the reason this exists rather than a validity check: a three-way
 * split of 100.00 is 33.33 × 3, which is a fil short, and a user who splits by
 * percentage should not be asked to hunt for it. The remainder lands on the
 * largest part, where it is proportionally least visible.
 *
 * Returns undefined when the result is not a meaningful split — nothing left,
 * or everything in one category — so callers can store `splits: undefined`
 * rather than a one-element array that means the same as no split at all.
 */
export function normalizeSplits(
  totalFils: number,
  splits: TransactionSplit[],
): TransactionSplit[] | undefined {
  const merged = new Map<CategoryId, TransactionSplit>();
  for (const s of splits) {
    if (s.amountFils <= 0) continue;
    const prior = merged.get(s.category);
    if (prior) {
      prior.amountFils += s.amountFils;
      prior.note = prior.note ?? s.note;
    } else {
      merged.set(s.category, { ...s });
    }
  }

  const parts = [...merged.values()];
  if (parts.length <= 1) return undefined;

  const drift = unallocatedFils(totalFils, parts);
  if (drift !== 0) {
    let largest = parts[0];
    for (const p of parts) if (p.amountFils > largest.amountFils) largest = p;
    largest.amountFils += drift;
    // Absorbing the drift can wipe out or invert a part when the numbers were
    // nonsense to begin with. Falling back to a single allocation is safer
    // than storing a negative one.
    if (largest.amountFils <= 0) return undefined;
  }

  return parts;
}

/** Divide a charge into equal parts, giving the rounding remainder to the first. */
export function splitEvenly(totalFils: number, categories: CategoryId[]): TransactionSplit[] | undefined {
  if (categories.length < 2) return undefined;
  const each = Math.floor(totalFils / categories.length);
  return normalizeSplits(
    totalFils,
    categories.map((category) => ({ category, amountFils: each })),
  );
}

/**
 * The category a split row shows when there is only room for one — the
 * largest part, which is what the charge was mostly for.
 */
export function dominantCategory(t: Transaction): CategoryId {
  if (!t.splits || t.splits.length === 0) return t.category;
  let largest = t.splits[0];
  for (const s of t.splits) if (s.amountFils > largest.amountFils) largest = s;
  return largest.category;
}
