import { reliableBalanceFils } from '@/lib/balances';
import { cardActivityRows, cardStatementView, type CardState } from '@/lib/cards';
import { corroboratingTransferIdsForState, countsInTotals, internalTransferIdsForState, isSpending } from '@/lib/ledger';
import { inPeriod, type Period } from '@/lib/period';
import type { Account } from '@/lib/types';

/** Exact persisted account scope; matching issuer or last four never merges cards. */
type ActivityState = CardState & Parameters<typeof internalTransferIdsForState>[0];

export function projectCardActivity(state: ActivityState, account: Account, period: Period) {
  const duplicates = corroboratingTransferIdsForState(state);
  const internal = internalTransferIdsForState(state);
  const statements = cardStatementView(state, account.id);
  const rows = cardActivityRows(state, account.id).filter(row => !duplicates.has(row.id) && inPeriod(row.date, period))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.ts ?? 0) - (a.ts ?? 0));
  const payments = statements.payments.filter(row => row.accountId === account.id && inPeriod(row.date, period));
  const paymentIds = new Set(payments.map(row => row.id));
  let spendingFils = 0;
  let creditsFils = 0;
  for (const row of rows) {
    if (paymentIds.has(row.id)) continue;
    if (isSpending(row, undefined, internal)) spendingFils += row.amountFils;
    // Inbound credits include refunds and cashback; never infer a refund match
    // or subtract them from captured purchases.
    else if (row.type === 'income' && countsInTotals(row, undefined, internal)) creditsFils += row.amountFils;
  }
  // Statements and snapshot quotes retain their existing authority. With no
  // statement/quote there is no known debt figure, not proof that debt is zero.
  const figure = account.cardType === 'credit'
    ? statements.statements.length > 0
      ? { label: 'statementRemaining' as const, fils: statements.outstandingFils }
      : account.snapshotKind === 'outstanding' && account.snapshotFils !== undefined
        ? { label: 'reportedOutstanding' as const, fils: Math.abs(account.snapshotFils) }
        : null
    : (() => {
      const fils = reliableBalanceFils(state, account);
      return fils === null ? null : { label: 'reportedBalance' as const, fils };
    })();
  return { rows, internal, figure, spendingFils, creditsFils,
    paymentsFils: payments.reduce((sum, row) => sum + row.amountFils, 0), billable: statements.billable };
}
