import { cardPaymentRows } from '@/lib/cards';
import { internalTransferIds, liveAccountIds, UNASSIGNED_TRANSACTION_ACCOUNT_ID } from '@/lib/ledger';
import { inPeriod, type PeriodLike } from '@/lib/period';
import type { Account, AppState } from '@/lib/types';
import { transferOwnership } from '@/lib/transfer-reconciliation';

export interface CashOutflowSummary {
  /** Cash that actually left bank, debit-card, or cash accounts. */
  totalFils: number;
  /** Distinct credit-card settlements included once. */
  cardPaymentsFils: number;
  /** Purchases, withdrawals, fees and external transfers funded immediately. */
  accountOutflowFils: number;
  /** Canonical ledger rows behind the total, after settlement dedupe. */
  transactionIds: ReadonlySet<string>;
}

export interface CashOutflowScope {
  live?: ReadonlySet<string>;
  internal?: ReadonlySet<string>;
}

function isCreditCard(account: Account | undefined): boolean {
  return account?.kind === 'card' && account.cardType === 'credit';
}

/**
 * Cash leaving accounts, deliberately separate from economic spending.
 *
 * - A debit/cash purchase is both spending and cash out.
 * - A credit-card purchase is spending now, but not cash out yet.
 * - Paying that credit card is cash out once, but not spending again.
 * - A paired move between the user's own accounts is neither.
 *
 * This distinction prevents a card purchase and its later repayment from
 * being added together under one headline.
 */
export function summarizeCashOutflow(
  state: AppState,
  period: PeriodLike,
  scope: CashOutflowScope = {},
): CashOutflowSummary {
  const live = scope.live ?? liveAccountIds(state.accounts);
  const internal = scope.internal ?? internalTransferIds(state.transactions, state.accounts);
  const accountById = new Map(state.accounts.map((account) => [account.id, account] as const));
  // Keep the canonical ROW, not just its id. Legacy ledgers may still hold
  // both settlement sides; cardPaymentRows derives the debit-side cash date
  // without mutating either persisted row, and reducing that answer to ids
  // would throw the derived date away before period attribution.
  const settlements = new Map(
    cardPaymentRows(state).map((transaction) => [transaction.id, transaction] as const),
  );

  const transactionIds = new Set<string>();
  let totalFils = 0;
  let cardPaymentsFils = 0;
  let accountOutflowFils = 0;

  for (const transaction of state.transactions) {
    const settlement = settlements.get(transaction.id);
    const fundingAccountId = settlement?.cashOutAccountId ?? transaction.accountId;
    // No identified source means we cannot assert that a confirmed purchase
    // was paid immediately from cash rather than charged to a credit card.
    if (!settlement && fundingAccountId === UNASSIGNED_TRANSACTION_ACCOUNT_ID) continue;
    if (!live.has(fundingAccountId)) continue;
    // Manual repayments carry the legacy transfer flag. The card ledger's
    // confirmed settlement role takes precedence over that generic flag.
    if (!settlement && internal.has(transaction.id)) continue;
    // An explicitly owned destination is proof even when the other bank's
    // alert/account is absent from this device. Generic "Bank transfer" and
    // named-person transfers remain cash out; only parser-owned structural
    // titles that state self/own/savings movement qualify.
    if (!settlement && transferOwnership(transaction) === 'own') continue;
    const isSettlement = settlement !== undefined;
    const isAbsorbedSettlementObservation =
      transaction.isTransfer === true && transaction.cardPaymentSide !== undefined &&
      transferOwnership(transaction) === null;
    const leavesCashAccount =
      transaction.type === 'expense' && !isCreditCard(accountById.get(transaction.accountId));
    const movementDate = settlement?.cashOutDate ?? settlement?.date ?? transaction.date;
    if (!inPeriod(movementDate, period)) continue;
    if (!isSettlement && (isAbsorbedSettlementObservation || !leavesCashAccount)) continue;

    const amountFils = settlement?.amountFils ?? transaction.amountFils;
    transactionIds.add(transaction.id);
    totalFils += amountFils;
    if (isSettlement) cardPaymentsFils += amountFils;
    else accountOutflowFils += amountFils;
  }

  return { totalFils, cardPaymentsFils, accountOutflowFils, transactionIds };
}
