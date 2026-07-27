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

/**
 * Fold a reissued card's predecessor into it, on the user's say-so.
 *
 * The survivor is the NEW number, because that is the card in their wallet
 * and the one the next statement will name. The old row's history moves
 * across, so the payments made under the old digits and the statement issued
 * under the new ones finally sit on the same card — which is the whole point:
 * until they do, the due can never be settled by any payment.
 *
 * Deliberately separate from `mergeDuplicateAccounts`. That one collapses
 * rows the app is CERTAIN describe one card (same bank, same digits) and runs
 * unattended on every load. This one acts on a guess the user confirmed, and
 * must never run by itself.
 */
export function mergeRenewedCard(state: AppState, oldId: string, newId: string): AppState {
  const older = state.accounts.find((a) => a.id === oldId);
  const newer = state.accounts.find((a) => a.id === newId);
  if (!older || !newer || oldId === newId) return state;

  const to = (id: string) => (id === oldId ? newId : id);
  return {
    ...state,
    accounts: state.accounts
      .filter((a) => a.id !== oldId)
      .map((a) =>
        a.id === newId
          ? {
              ...a,
              renewedFrom: oldId,
              // Keep whatever the older row knew that the new one does not:
              // the bank name comes from an SMS sender, and a brand-new card
              // may not have had one yet.
              bankName: a.bankName ?? older.bankName,
              openingFils: a.openingFils + older.openingFils,
              creditLimitFils: a.creditLimitFils ?? older.creditLimitFils,
            }
          : a,
      ),
    transactions: state.transactions.map((t) =>
      t.accountId === oldId ? { ...t, accountId: newId } : t,
    ),
    cardDues: state.cardDues.map((d) => (d.accountId === oldId ? { ...d, accountId: newId } : d)),
    accountHints: Object.fromEntries(
      Object.entries(state.accountHints).map(([last4, id]) => [last4, to(id)]),
    ),
  };
}

/** Record that these two are NOT the same card, so the app stops asking. */
export function markCardsDistinct(state: AppState, accountId: string): AppState {
  return {
    ...state,
    accounts: state.accounts.map((a) =>
      a.id === accountId ? { ...a, renewedFrom: a.id } : a,
    ),
  };
}
