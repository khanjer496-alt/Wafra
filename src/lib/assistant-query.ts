import { categoryLabel } from '@/lib/categories';
import { billsForMonth, type BillStatus } from '@/lib/bills';
import { summarizeCashOutflow } from '@/lib/cash-flow';
import { parseMajorToMinor } from '@/lib/ledger-money';
import { countsInTotals, internalTransferIds, liveAccountIds } from '@/lib/ledger';
import { monthKey, shiftMonthKey } from '@/lib/format';
import { inPeriod, type Period } from '@/lib/period';
import { activeSubscriptions, detectSubscriptions } from '@/lib/subscriptions';
import type { AppState, CategoryId, Transaction, TransactionType } from '@/lib/types';
import type { AssistantPlan, AssistantTool } from '@/lib/assistant-contract';

export interface AssistantTransactionEvidence {
  id: string;
  title: string;
  date: string;
  amountFils: number;
  type: TransactionType;
  category: CategoryId;
  accountName: string;
  transfer: boolean;
}

export interface AssistantBillEvidence {
  id: string;
  title: string;
  amountFils: number;
  dueISO: string;
  status: BillStatus;
}

export interface AssistantRecurringEvidence {
  title: string;
  amountFils: number;
  cadence: string;
  nextExpectedISO: string;
}

export interface AssistantQueryResult {
  tool: AssistantTool;
  period: Period;
  unsupportedReason: 'invalid-amount' | 'historical-bills' | 'ambiguous-query' | null;
  matchedCount: number;
  countedTotalFils: number;
  incomeFils: number;
  spendingFils: number;
  cashOutFils: number;
  cardPaymentsFils: number;
  accountOutflowFils: number;
  transactions: AssistantTransactionEvidence[];
  bills: AssistantBillEvidence[];
  recurring: AssistantRecurringEvidence[];
}

const normalized = (value: string): string =>
  value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const periodFor = (plan: AssistantPlan, now: Date): Period => {
  const current = monthKey(now);
  if (plan.period === 'previous-month') return { mode: 'month', key: shiftMonthKey(current, -1) };
  if (plan.period === 'current-year') return { mode: 'year', year: Number(current.slice(0, 4)) };
  if (plan.period === 'all-time') return { mode: 'all' };
  if (plan.period === 'range' && plan.from && plan.to) {
    return { mode: 'range', from: plan.from, to: plan.to };
  }
  return { mode: 'month', key: current };
};

const amountBound = (
  value: string | null,
  state: AppState,
): { valid: boolean; value: number | null } => {
  if (value === null) return { valid: true, value: null };
  if (!state.ledgerMoney) return { valid: false, value: null };
  const parsed = parseMajorToMinor(value, state.ledgerMoney);
  return { valid: parsed !== null, value: parsed };
};

const evidence = (
  rows: Transaction[],
  state: AppState,
  internal: ReadonlySet<string>,
): AssistantTransactionEvidence[] => {
  const accounts = new Map(state.accounts.map((account) => [account.id, account.name] as const));
  return rows.slice(0, 12).map((transaction) => ({
    id: transaction.id,
    title: transaction.title,
    date: transaction.date,
    amountFils: transaction.amountFils,
    type: transaction.type,
    category: transaction.category,
    accountName: accounts.get(transaction.accountId) ?? '',
    transfer: transaction.isTransfer === true || internal.has(transaction.id),
  }));
};

const search = (
  state: AppState,
  plan: AssistantPlan,
  period: Period,
  live: Set<string>,
  internal: Set<string>,
): { rows: Transaction[]; totalFils: number; invalidAmount: boolean } => {
  const query = normalized(plan.query ?? '');
  const account = normalized(plan.account ?? '');
  const accounts = new Map(state.accounts.map((row) => [row.id, normalized(row.name)] as const));
  const minimum = amountBound(plan.minimumMajor, state);
  const maximum = amountBound(plan.maximumMajor, state);
  if (!minimum.valid || !maximum.valid) {
    return { rows: [], totalFils: 0, invalidAmount: true };
  }
  const rows = state.transactions.filter((transaction) => {
    if (!inPeriod(transaction.date, period)) return false;
    const transfer = transaction.isTransfer === true || internal.has(transaction.id);
    if (plan.direction === 'transfer' && !transfer) return false;
    if (plan.direction === 'income' && (transaction.type !== 'income' || transfer)) return false;
    if (plan.direction === 'expense' && (transaction.type !== 'expense' || transfer)) return false;
    if (plan.category && transaction.category !== plan.category) return false;
    if (minimum.value !== null && transaction.amountFils < minimum.value) return false;
    if (maximum.value !== null && transaction.amountFils > maximum.value) return false;
    if (account && !(accounts.get(transaction.accountId) ?? '').includes(account)) return false;
    if (!query) return true;
    const haystack = normalized([
      transaction.title,
      categoryLabel(transaction.category, 'en'),
      categoryLabel(transaction.category, 'ar'),
      accounts.get(transaction.accountId) ?? '',
    ].join(' '));
    return query.split(' ').every((token) => haystack.includes(token));
  });
  const totalFils = rows.reduce((sum, transaction) => {
    if (!countsInTotals(transaction, live, internal)) return sum;
    return sum + (transaction.type === 'income' ? transaction.amountFils : -transaction.amountFils);
  }, 0);
  return { rows, totalFils, invalidAmount: false };
};

export const runAssistantQuery = (
  state: AppState,
  plan: AssistantPlan,
  now = new Date(),
  preflightReason: AssistantQueryResult['unsupportedReason'] = null,
): AssistantQueryResult => {
  const implicitPreflight = preflightReason ?? (
    plan.tool === 'list-bills' && plan.period !== 'current-month'
      ? 'historical-bills'
      : null
  );
  // Saved bill status is a present-tense ledger fact, not a historical
  // transaction query. Do not label today's reminders as a model-requested
  // past period if the plan was imperfect.
  const period = plan.tool === 'list-bills'
    ? { mode: 'month' as const, key: monthKey(now) }
    : periodFor(plan, now);
  const live = liveAccountIds(state.accounts);
  const internal = internalTransferIds(state.transactions, state.accounts);
  const blank = {
    tool: plan.tool,
    period,
    unsupportedReason: null,
    matchedCount: 0,
    countedTotalFils: 0,
    incomeFils: 0,
    spendingFils: 0,
    cashOutFils: 0,
    cardPaymentsFils: 0,
    accountOutflowFils: 0,
    transactions: [],
    bills: [],
    recurring: [],
  } satisfies AssistantQueryResult;

  if (implicitPreflight !== null) return { ...blank, unsupportedReason: implicitPreflight };

  if (plan.tool === 'search-transactions') {
    const result = search(state, plan, period, live, internal);
    return {
      ...blank,
      unsupportedReason: result.invalidAmount ? 'invalid-amount' : null,
      matchedCount: result.rows.length,
      countedTotalFils: result.totalFils,
      transactions: evidence(result.rows, state, internal),
    };
  }

  if (plan.tool === 'summarize-period') {
    const rows = state.transactions.filter((row) => inPeriod(row.date, period));
    const countedRows = rows.filter((row) => countsInTotals(row, live, internal));
    let incomeFils = 0;
    let spendingFils = 0;
    for (const row of countedRows) {
      if (row.type === 'income') incomeFils += row.amountFils;
      else spendingFils += row.amountFils;
    }
    return {
      ...blank,
      matchedCount: countedRows.length,
      countedTotalFils: incomeFils - spendingFils,
      incomeFils,
      spendingFils,
      transactions: evidence(countedRows, state, internal),
    };
  }

  if (plan.tool === 'explain-cash-out') {
    const result = summarizeCashOutflow(state, period, { live, internal });
    const rows = state.transactions.filter((row) => result.transactionIds.has(row.id));
    return {
      ...blank,
      matchedCount: rows.length,
      cashOutFils: result.totalFils,
      cardPaymentsFils: result.cardPaymentsFils,
      accountOutflowFils: result.accountOutflowFils,
      transactions: evidence(rows, state, internal),
    };
  }

  if (plan.tool === 'list-bills') {
    const rows = billsForMonth(state.bills, state.transactions, now, live, internal);
    return {
      ...blank,
      matchedCount: rows.length,
      bills: rows.map(({ bill, dueISO, status }) => ({
        id: bill.id,
        title: bill.title,
        amountFils: bill.amountFils,
        dueISO,
        status,
      })),
    };
  }

  const recurring = activeSubscriptions(
    detectSubscriptions(state.transactions, state.notSubscriptions, now, live, internal),
  );
  return {
    ...blank,
    matchedCount: recurring.length,
    recurring: recurring.slice(0, 12).map((row) => ({
      title: row.title,
      amountFils: row.monthlyEquivalentFils,
      cadence: row.cadence,
      nextExpectedISO: row.nextExpectedISO,
    })),
  };
};
