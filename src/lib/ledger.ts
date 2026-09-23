import type { Account, AppState, Transaction } from '@/lib/types';
import type { TransferReconciliationResult } from '@/lib/transfer-reconciliation-types';
import { bankIdentityForName } from '@/lib/markets';
import { historyImportIncomplete } from '@/lib/history-import';
import {
  isTransferEvidence,
  isTransferCandidate,
  isUnassignedTransferAccount,
  reconcileTransfers,
  reconciliationInternalIds,
  transferOwnership,
  TRANSFER_NORMALIZATION_VERSION,
} from '@/lib/transfer-reconciliation';

/**
 * Human-readable account label with its last-four bank identifier appended
 * as `·NNNN`, unless the name already ends with those four digits.
 *
 * Two identically-named cards ("FAB Credit Card") are only distinguishable by
 * their last four, so the label carries them wherever a picker or a details
 * row shows an account. Guards against double-appending — some entries store
 * the digits inside `name` already ("FAB ·4821") — by returning `name` as is
 * when it contains the full last-four sequence.
 */
export function accountDisplayName(account: Pick<Account, 'name' | 'last4'>): string {
  if (!account.last4) return account.name;
  return account.name.includes(account.last4) ? account.name : `${account.name} ·${account.last4}`;
}

/** A known business receipt with unknown bank attribution. Not a bank account
 * and never a balance/snapshot target. The user assigns it from entry details. */
export const UNASSIGNED_INCOME_ACCOUNT_ID = '__unassigned-income__';
/** A parsed money event can exist before any account has been discovered. This
 * is an unresolved attribution, not a bank/card and not balance evidence. */
export const UNASSIGNED_TRANSACTION_ACCOUNT_ID = '__unassigned-transaction__';
export const isUnassignedIncome = (transaction: Transaction): boolean =>
  transaction.accountId === UNASSIGNED_INCOME_ACCOUNT_ID && transaction.type === 'income';

/** Account visibility is applied to totals, never to transfer identity. */
let liveAccountIdsCache: { accounts: Account[]; value: Set<string> } | null = null;

export function liveAccountIds(accounts: Account[]): Set<string> {
  if (liveAccountIdsCache?.accounts === accounts) return liveAccountIdsCache.value;
  const value = new Set([UNASSIGNED_INCOME_ACCOUNT_ID, UNASSIGNED_TRANSACTION_ACCOUNT_ID,
    ...accounts.filter((account) => !account.archived).map((account) => account.id)]);
  liveAccountIdsCache = { accounts, value };
  return value;
}

export function isTransfer(transaction: Transaction): boolean {
  const ownership = transferOwnership(transaction);
  return ownership === 'own' || (ownership === null && transaction.isTransfer === true);
}

/**
 * Money that changed location or form without representing consumption or
 * earned income. Keep these rows in Activity/account cash-flow views, but do
 * not let them inflate Spending, Income, merchant analytics, or Net.
 */
export function isMoneyMovementOnly(transaction: Transaction): boolean {
  if (transaction.category === 'cash-withdrawal' || transaction.category === 'investing') return true;
  return transaction.type === 'income' && transaction.title?.trim().toLowerCase() === 'cash deposit';
}

export function countsInTotals(
  transaction: Transaction,
  live?: Set<string>,
  internal?: Set<string>,
): boolean {
  if (transaction.accountId === UNASSIGNED_INCOME_ACCOUNT_ID && transaction.type !== 'income') return false;
  if (isTransfer(transaction)) return false;
  // Uncertain ownership is displayed separately from confirmed totals.
  if (isTransferCandidate(transaction) && transferOwnership(transaction) === 'unknown') return false;
  if (isMoneyMovementOnly(transaction)) return false;
  if (live && !live.has(transaction.accountId) && !isUnassignedIncome(transaction) && !isUnassignedTransferAccount(transaction.accountId)) return false;
  if (internal?.has(transaction.id)) return false;
  return true;
}

/**
 * Cash-flow totals answer a different question from spending analytics.
 *
 * An unresolved bank transfer on a real visible account still moved money, so
 * it remains eligible for cash-movement views. Exact Income / Spending / Net
 * figures additionally exclude it through isUnresolvedTransferMovement() and
 * surface the uncertainty separately. Category, merchant, subscription and
 * budget analytics continue to use countsInTotals().
 */
export function countsInCashflowTotals(
  transaction: Transaction,
  live?: ReadonlySet<string>,
  internal?: ReadonlySet<string>,
): boolean {
  if (transaction.accountId === UNASSIGNED_INCOME_ACCOUNT_ID && transaction.type !== 'income') return false;
  if (internal?.has(transaction.id)) return false;
  const ownership = transferOwnership(transaction);
  if (ownership === 'own') return false;
  // Settlement/funding rows are deliberately not transfer candidates. Preserve
  // their existing exclusion instead of re-labelling card payments as income.
  if (ownership === null && transaction.isTransfer === true) return false;
  // A holding transfer source is not a user's known account, so it cannot yet
  // establish cash flow for the ledger. Ordinary unassigned parsed activity is
  // still governed by the live-account set below.
  if (isUnassignedTransferAccount(transaction.accountId)) return false;
  if (live && !live.has(transaction.accountId) && !isUnassignedIncome(transaction)) return false;
  return true;
}

/**
 * A real bank movement that Wafra can see, but cannot yet prove was either an
 * external payment or a move between the user's own accounts.
 *
 * These rows stay visible in activity, but must not silently swing an exact
 * Income / Spending / Net figure in either direction. They are reported as one
 * aggregate uncertainty bucket instead of becoming thousands of review tasks.
 */
export function isUnresolvedTransferMovement(
  transaction: Transaction,
  live?: Set<string>,
  internal?: Set<string>,
): boolean {
  if (internal?.has(transaction.id) || isUnassignedIncome(transaction)) return false;
  return isTransferCandidate(transaction) && transferOwnership(transaction) === 'unknown' &&
    countsInCashflowTotals(transaction, live, internal);
}

export function isSpending(
  transaction: Transaction, live?: Set<string>, internal?: Set<string>,
): boolean {
  return transaction.type === 'expense' && countsInTotals(transaction, live, internal);
}

export function isIncome(
  transaction: Transaction, live?: Set<string>, internal?: Set<string>,
): boolean {
  return transaction.type === 'income' && countsInTotals(transaction, live, internal);
}

/** A payment arriving ON a card still counts towards settling its statement. */
export function isInboundTransfer(transaction: Transaction): boolean {
  return isTransfer(transaction) && transaction.type === 'income';
}

/** Ownership needs evidence from complete accounts, never just visible IDs.
 * Legacy Set callers can still exclude explicit/user-owned rows, but cannot
 * establish a bank identity. New callers should supply the full account list.
 */
let internalIdsCache: {
  transactions: Transaction[];
  accounts: Account[];
  value: Set<string>;
  /**
   * Provisional history receipts are intentionally cheap while import is
   * unfinished, but must never be reused once completion requires canonical
   * reconciliation. A computed/live reconciliation is safe to reuse for the
   * same immutable arrays even when no durable receipt exists yet.
   */
  canonical: boolean;
} | null = null;
let persistedInternalIdsCache: {
  transactions: Transaction[];
  accounts: Account[];
  ids: string[];
  value: Set<string>;
} | null = null;
let corroboratingDisplayIdsCache: {
  transactions: Transaction[];
  accounts: Account[];
  value: Set<string>;
} | null = null;

/**
 * Seed the analytics cache from the exact durable reconciliation receipt.
 * Store snapshots are immutable, so matching array identities make this cache
 * authoritative until a transaction/account mutation replaces either array.
 */
export function primeInternalTransferIds(
  transactions: Transaction[],
  accounts: Account[],
  ids: readonly string[],
  canonical = true,
): void {
  internalIdsCache = { transactions, accounts, value: new Set(ids), canonical };
}

export function internalTransferIds(
  transactions: Transaction[], accounts: Set<string> | Account[],
): Set<string> {
  if (Array.isArray(accounts) &&
      internalIdsCache?.transactions === transactions && internalIdsCache.accounts === accounts) {
    return internalIdsCache.value;
  }
  const accountRows = Array.isArray(accounts) ? accounts : [];
  const value = reconciliationInternalIds(reconcileTransfers(transactions, accountRows));
  if (Array.isArray(accounts)) internalIdsCache = { transactions, accounts, value, canonical: true };
  return value;
}

/**
 * Fast UI/analytics path for a complete AppState snapshot.
 *
 * The store persists the exact reconciliation result together with a semantic
 * version and primes the in-memory cache after every authoritative dispatch.
 * Rebuilding the complete transfer graph from a 10k-20k row ledger on a tab
 * press is therefore redundant work and can hold React Native's JS thread for
 * seconds. Use the durable receipt when it describes this snapshot; fall back
 * to full reconciliation only for old/restored states that do not have one.
 *
 * While an Android history import is running the store deliberately exposes a
 * provisional receipt for UI calculations. It is not stamped as final until
 * import completion, but it is the same snapshot the rest of the UI uses.
 */
export function internalTransferIdsForState(
  state: Pick<AppState,
    'transactions' | 'accounts' | 'transferInternalIds' | 'transferNormalizationVersion' | 'historyImport'>,
): Set<string> {
  const ids = state.transferInternalIds;
  const receiptUsable = Array.isArray(ids) && (
    state.transferNormalizationVersion === TRANSFER_NORMALIZATION_VERSION ||
    historyImportIncomplete(state.historyImport)
  );
  if (!receiptUsable) {
    // Do not route through internalTransferIds() here. A provisional history
    // receipt intentionally primes that legacy array-identity cache so every UI
    // caller sees the same cheap answer while import is unfinished. Once the
    // job completes (or the receipt otherwise becomes unusable), the same
    // immutable arrays may still be present; consulting the legacy cache would
    // then return the stale provisional ids instead of the required canonical
    // reconciliation. Reconcile explicitly and replace the cache with the live
    // result at this state-aware boundary.
    if (internalIdsCache?.transactions === state.transactions &&
        internalIdsCache.accounts === state.accounts &&
        internalIdsCache.canonical) {
      return internalIdsCache.value;
    }
    const value = reconciliationInternalIds(reconcileTransfers(state.transactions, state.accounts));
    internalIdsCache = {
      transactions: state.transactions,
      accounts: state.accounts,
      value,
      canonical: true,
    };
    return value;
  }
  if (persistedInternalIdsCache?.transactions === state.transactions &&
      persistedInternalIdsCache.accounts === state.accounts &&
      persistedInternalIdsCache.ids === ids) {
    return persistedInternalIdsCache.value;
  }
  const value = new Set(ids);
  persistedInternalIdsCache = {
    transactions: state.transactions,
    accounts: state.accounts,
    ids,
    value,
  };
  // Keep the legacy array-identity cache hot for callers that still only have
  // transactions/accounts. This makes mixed old/new call sites converge on the
  // same O(1) result instead of unexpectedly rebuilding the graph later.
  internalIdsCache = {
    transactions: state.transactions,
    accounts: state.accounts,
    value,
    canonical: state.transferNormalizationVersion === TRANSFER_NORMALIZATION_VERSION,
  };
  return value;
}

let receiptReconciliationCache: {
  receipt: readonly string[];
  accounts: Account[];
  result: TransferReconciliationResult;
} | null = null;

/**
 * Per-row transfer statuses for browsing surfaces (Transactions separation,
 * Transfers history) that must agree with `internalTransferIdsForState`.
 *
 * - Provisional history receipt (import unfinished, not stamped final):
 *   returns null. `internal` is the provisional id set, and a fresh graph over
 *   the half-imported rows could classify differently. Callers keep every row
 *   in its ordinary place until the final page reconciles once.
 * - Final receipt: the store replaces `transferInternalIds` whenever the
 *   transfer graph may have changed (any transfer-relevant row, any add or
 *   delete, any account change), and keeps the same array otherwise. That
 *   array plus the accounts array is therefore a cheap revision key: one
 *   reconciliation per receipt, not per ledger edit. Untouched rows keep their
 *   ids, so a status computed for the receipt's snapshot still describes them;
 *   callers look statuses up against the current rows.
 * - No receipt (legacy/restored state): the same array-identity memo the
 *   `internal` fallback above uses.
 */
export function transferReconciliationForState(
  state: Pick<AppState,
    'transactions' | 'accounts' | 'transferInternalIds' | 'transferNormalizationVersion' | 'historyImport'>,
): TransferReconciliationResult | null {
  const receipt = state.transferInternalIds;
  const final = Array.isArray(receipt) && state.transferNormalizationVersion === TRANSFER_NORMALIZATION_VERSION;
  if (!final && Array.isArray(receipt) && historyImportIncomplete(state.historyImport)) return null;
  if (!final) return reconcileTransfers(state.transactions, state.accounts);
  if (receiptReconciliationCache?.receipt === receipt && receiptReconciliationCache.accounts === state.accounts) {
    return receiptReconciliationCache.result;
  }
  const result = reconcileTransfers(state.transactions, state.accounts);
  receiptReconciliationCache = { receipt, accounts: state.accounts, result };
  return result;
}

/**
 * Secondary bank alerts that corroborate an already-recorded transfer.
 *
 * FAB can emit both a transfer-detail alert and an outward-remittance debit for
 * the same movement. The reconciliation engine intentionally keeps both source
 * rows so the ledger preserves the bank evidence, but rendering both makes one
 * transfer look like two transactions. Rebuilding the complete transfer graph
 * just to hide that confirmation would undo the large-ledger performance work,
 * so this is the same narrow issuer rule expressed as a cheap, cached display
 * projection: exact account + exact money + opposite posting forms + <=90 sec,
 * with reference contradictions and ambiguous multi-matches failing closed.
 */
export function corroboratingTransferIdsForState(
  state: Pick<AppState, 'transactions' | 'accounts'>,
): Set<string> {
  if (corroboratingDisplayIdsCache?.transactions === state.transactions &&
      corroboratingDisplayIdsCache.accounts === state.accounts) {
    return corroboratingDisplayIdsCache.value;
  }

  type Candidate = {
    id: string;
    at: number;
    form: 'transfer-detail' | 'remittance-debit';
    smsKey?: string;
    reference?: string;
  };
  const accounts = new Map(state.accounts.map((account) => [account.id, account] as const));
  const groups = new Map<string, Candidate[]>();
  const sourceTime = (transaction: Transaction): number | undefined => {
    if (typeof transaction.ts === 'number' && Number.isSafeInteger(transaction.ts) && transaction.ts >= 0) {
      return transaction.ts;
    }
    const match = typeof transaction.smsKey === 'string' ? /^s(\d{10,16})-/.exec(transaction.smsKey) : null;
    const parsed = match ? Number(match[1]) : NaN;
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
  };
  for (const transaction of state.transactions) {
    if (transaction.type !== 'expense' || transaction.userEdited ||
        !Number.isSafeInteger(transaction.amountFils) || transaction.amountFils <= 0) continue;
    const evidence = isTransferEvidence(transaction.transferEvidence) ? transaction.transferEvidence : undefined;
    const form = evidence?.postingForm;
    if (evidence?.attribution !== 'source' ||
        (form !== 'transfer-detail' && form !== 'remittance-debit')) continue;
    const account = accounts.get(transaction.accountId);
    if (!account || (account.kind !== 'bank' && !(account.kind === 'card' && account.cardType === 'debit'))) continue;
    const accountBank = account.bankName ? bankIdentityForName(account.bankName) : undefined;
    const sourceBank = evidence.sourceBank ? bankIdentityForName(evidence.sourceBank) : undefined;
    const captureBank = transaction.captureInstrument?.bankIdentity
      ? bankIdentityForName(transaction.captureInstrument.bankIdentity)
      : undefined;
    const banks = [accountBank, sourceBank, captureBank].filter((bank): bank is string => !!bank);
    if (!banks.length || banks.some((bank) => bank !== 'fab')) continue;
    if (transaction.captureInstrument?.kind === 'credit' ||
        (account.last4 && transaction.captureInstrument?.last4 &&
          account.last4 !== transaction.captureInstrument.last4)) continue;
    const at = sourceTime(transaction);
    if (at === undefined) continue;
    const key = JSON.stringify([
      transaction.accountId,
      transaction.amountFils,
      transaction.originalCurrency ?? null,
      transaction.originalAmountMinor ?? null,
    ]);
    const bucket = groups.get(key) ?? [];
    bucket.push({
      id: transaction.id,
      at,
      form,
      ...(transaction.smsKey ? { smsKey: transaction.smsKey } : {}),
      ...(evidence.reference ? { reference: evidence.reference } : {}),
    });
    groups.set(key, bucket);
  }

  const value = new Set<string>();
  const WINDOW_MS = 90_000;
  const MAX_SCAN = 64;
  for (const bucket of groups.values()) {
    bucket.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    const matches = new Map<string, string[]>();
    let left = 0;
    for (const entry of bucket) {
      while (left < bucket.length && bucket[left].at < entry.at - WINDOW_MS) left += 1;
      const candidates: string[] = [];
      let scanned = 0;
      for (let otherIndex = left;
        otherIndex < bucket.length && bucket[otherIndex].at <= entry.at + WINDOW_MS;
        otherIndex += 1) {
        const other = bucket[otherIndex];
        if (++scanned > MAX_SCAN) { candidates.length = 0; break; }
        if (entry.id === other.id || entry.form === other.form ||
            (entry.smsKey && other.smsKey && entry.smsKey === other.smsKey) ||
            (entry.reference && other.reference && entry.reference !== other.reference)) continue;
        candidates.push(other.id);
      }
      matches.set(entry.id, candidates);
    }
    for (const entry of bucket) {
      if (entry.form !== 'remittance-debit') continue;
      const candidates = matches.get(entry.id) ?? [];
      if (candidates.length === 1 && matches.get(candidates[0])?.length === 1) value.add(entry.id);
    }
  }
  corroboratingDisplayIdsCache = { transactions: state.transactions, accounts: state.accounts, value };
  return value;
}
