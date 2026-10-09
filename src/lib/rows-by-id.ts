import type { Transaction } from '@/lib/types';

/**
 * One id → row index per ledger snapshot, shared by every surface that needs
 * one.
 *
 * Eleven screens host the entry sheet, and each built its own `Map` over the
 * whole ledger when it mounted and again on every ledger change, open or not.
 * On a 15k-row Hermes ledger that was a full walk per mounted sheet per
 * capture or answer. Store arrays are immutable snapshots, so the array itself
 * is the key; the WeakMap never keeps a replaced ledger alive. Same contents
 * as `new Map(rows.map(row => [row.id, row]))`: a repeated id keeps its last row.
 */
const indexes = new WeakMap<readonly Transaction[], ReadonlyMap<string, Transaction>>();

export function rowsByIdFor(rows: readonly Transaction[]): ReadonlyMap<string, Transaction> {
  const cached = indexes.get(rows);
  if (cached) return cached;
  const index: ReadonlyMap<string, Transaction> = new Map(rows.map(row => [row.id, row] as const));
  indexes.set(rows, index);
  return index;
}
