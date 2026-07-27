import { cardIdentity } from '@/lib/cards';
import type { Account, AppState } from '@/lib/types';

/**
 * Collapse account rows that describe the same physical card.
 *
 * One card, two records: Home listed "FAB Credit Card •5793 · 15 Jun · 8,144"
 * twice, one directly above the other, and counted it twice in the total.
 * Reading past it, Wallet counts its balance twice too.
 *
 * Two rows are the same card only when they agree on the last four digits AND
 * the card type AND the bank — a person can hold a FAB and an ENBD card whose
 * digits happen to match, and those must stay apart. A row with no digits is
 * never merged, because there is nothing to compare.
 *
 * The survivor is the row with the most history, so the merge never costs the
 * user the record with more in it. Transactions, dues and the last-four hints
 * are repointed; nothing is deleted except the emptied duplicate.
 */
export function mergeDuplicateAccounts(state: AppState): AppState {
  // The same identity rule the DISPLAY uses, not a second spelling of it.
  //
  // This used to key on `${bankName ?? ''}|${last4}|${type}`, which splits
  // exactly the rows it exists to merge: a hand-added card has no bank name,
  // because only the SMS sender ID teaches the app the bank, so "FAB|5793"
  // and "|5793" were two different cards. `openDues` was taught that an
  // unknown bank is not a different bank; the data has to agree, or the
  // display keeps papering over twins that never merge underneath.
  const identify = cardIdentity(state.accounts);
  const groups = new Map<string, Account[]>();
  for (const a of state.accounts) {
    if (!a.last4) continue;
    groups.set(identify(a.id), [...(groups.get(identify(a.id)) ?? []), a]);
  }
  const dupes = [...groups.values()].filter((g) => g.length > 1);
  if (dupes.length === 0) return state;

  const weight = (id: string) =>
    state.transactions.reduce((n, t) => (t.accountId === id ? n + 1 : n), 0) +
    state.cardDues.reduce((n, d) => (d.accountId === id ? n + 1 : n), 0);

  /** old account id → surviving account id */
  const remap = new Map<string, string>();
  const dropped = new Set<string>();
  for (const group of dupes) {
    // Strictly greater, so a tie leaves the incumbent in place: the earliest
    // row is the one other state is likelier to already point at, and a
    // deterministic winner means the merge cannot flip between launches.
    const keep = group.reduce((best, a) => (weight(a.id) > weight(best.id) ? a : best));
    for (const a of group) {
      if (a.id === keep.id) continue;
      remap.set(a.id, keep.id);
      dropped.add(a.id);
    }
  }
  const to = (id: string) => remap.get(id) ?? id;

  return {
    ...state,
    accounts: state.accounts.filter((a) => !dropped.has(a.id)),
    transactions: state.transactions.map((t) =>
      remap.has(t.accountId) ? { ...t, accountId: to(t.accountId) } : t,
    ),
    cardDues: state.cardDues.map((d) =>
      remap.has(d.accountId) ? { ...d, accountId: to(d.accountId) } : d,
    ),
    accountHints: Object.fromEntries(
      Object.entries(state.accountHints).map(([last4, id]) => [last4, to(id)]),
    ),
  };
}
