import type { LedgerMoneySpec } from '@/lib/ledger-money';
import type { Account, Transaction } from '@/lib/types';

const csvField = (value: string): string => /[",\r\n]/.test(value)
  ? `"${value.replace(/"/g, '""')}"` : value;

/** Decimal digits come from the stored integer, never floating-point division. */
function exactMajorUnits(amount: number, exponent: number): string {
  if (!Number.isSafeInteger(amount) || ![0, 2, 3].includes(exponent)) {
    throw new Error('Invalid export amount');
  }
  const digits = String(Math.abs(amount)).padStart(exponent + 1, '0');
  const sign = amount < 0 ? '-' : '';
  return exponent === 0 ? `${sign}${digits}`
    : `${sign}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

export function buildLedgerCsv(
  transactions: readonly Transaction[],
  accounts: readonly Account[],
  money: LedgerMoneySpec | null,
): string {
  const header = 'date,type,amount,currency,category,title,account,transfer';
  if (!transactions.length) return header;
  if (!money) throw new Error('Export requires an accounting currency');
  const names = new Map(accounts.map((account) => [account.id, account.name]));
  return [header, ...transactions.map((tx) => [
    tx.date, tx.type, exactMajorUnits(tx.amountFils, money.exponent), money.currency,
    tx.category, tx.title, names.get(tx.accountId) ?? '', tx.isTransfer ? '1' : '0',
  ].map(csvField).join(','))].join('\n');
}
