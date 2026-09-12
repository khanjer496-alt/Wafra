import type { LedgerMoneySpec } from '@/lib/ledger-money';
import type { Account, Transaction } from '@/lib/types';

/** CSV quoting preserves cells; a leading apostrophe keeps risky text literal. */
function csvTextField(value: string): string {
  // Spreadsheet importers may ignore leading whitespace/control characters,
  // and some locales recognize full-width formula markers as well.
  const needsLiteral = /^[\s\p{Cc}\p{Cf}]*[=+\-@＝＋－＠]/u.test(value)
    || /^[\p{Cc}\p{Cf}]/u.test(value);
  const safeValue = needsLiteral ? `'${value}` : value;
  return needsLiteral || /[",\r\n]/.test(safeValue)
    ? `"${safeValue.replace(/"/g, '""')}"` : safeValue;
}

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
    csvTextField(tx.date), csvTextField(tx.type),
    exactMajorUnits(tx.amountFils, money.exponent), csvTextField(money.currency),
    csvTextField(tx.category), csvTextField(tx.title),
    csvTextField(names.get(tx.accountId) ?? ''), tx.isTransfer ? '1' : '0',
  ].join(','))].join('\n');
}
