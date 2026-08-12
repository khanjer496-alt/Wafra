import { cardPaymentRows } from '@/lib/cards';
import { internalTransferIds, liveAccountIds } from '@/lib/ledger';
import { inPeriod, type PeriodLike } from '@/lib/period';
import type { Account, AppState } from '@/lib/types';

export interface CashOutflowSummary {
  /** Cash that actually left bank, debit-card, or cash accounts. */
  totalFils: number;
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

  for (const transaction of state.transactions) {
    const settlement = settlements.get(transaction.id);
    const fundingAccountId = settlement?.cashOutAccountId ?? transaction.accountId;
    if (!live.has(fundingAccountId)) continue;
    if (internal.has(transaction.id)) continue;
    const isSettlement = settlement !== undefined;
    const isAbsorbedSettlementObservation =
      transaction.isTransfer === true && transaction.cardPaymentSide !== undefined;
    const leavesCashAccount =
      transaction.type === 'expense' && !isCreditCard(accountById.get(transaction.accountId));
    const movementDate = settlement?.cashOutDate ?? settlement?.date ?? transaction.date;
    if (!inPeriod(movementDate, period)) continue;
    if (!isSettlement && (isAbsorbedSettlementObservation || !leavesCashAccount)) continue;

    transactionIds.add(transaction.id);
    totalFils += settlement?.amountFils ?? transaction.amountFils;
  }

  return { totalFils, transactionIds };
}
