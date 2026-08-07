import type { Account, Transaction } from '@/lib/types';
import { isUnassignedAccountRef } from '@/lib/ledger';

/**
 * CSV is a data format, not a string joined with commas. Titles, account names,
 * and notes can all contain commas, quotes, or line breaks, so every field is
 * escaped consistently. The UTF-8 BOM keeps Arabic readable when the file is
 * opened directly in spreadsheet apps that still guess legacy encodings.
 */
function csvCell(value: string | number | boolean | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value);
  // Titles originate in bank-controlled SMS and account names may come from
  // imports. Spreadsheet apps interpret these leading characters as formulas,
  // so neutralize them before applying normal RFC 4180 quote escaping.
  if (typeof value === 'string' && /^(?:[=+\-@\t\r]|\s+[=+\-@])/.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

export function transactionsCsv(
  transactions: Transaction[],
  accounts: Account[],
  localCurrency: string,
): string {
  const accountById = new Map(accounts.map((account) => [account.id, account] as const));
  const rows = transactions.map((transaction) =>
    transactionCsvRow(transaction, accountById.get(transaction.accountId), localCurrency));
  return finishCsv(rows);
}

const CSV_HEADER = [
  'date',
  'timestamp',
  'type',
  'amount_local',
  'local_currency',
  'original_amount',
  'original_currency',
  'category',
  'title',
  'account',
  'account_last4',
  'source',
  'transfer',
  'needs_review',
];

function transactionCsvRow(
  transaction: Transaction,
  account: Account | undefined,
  localCurrency: string,
): string {
  const originalAmount =
    transaction.originalAmountMinor === undefined
      ? ''
      : (transaction.originalAmountMinor / 100).toFixed(2);
  return [
    transaction.date,
    transaction.ts === undefined ? '' : new Date(transaction.ts).toISOString(),
    transaction.type,
    (transaction.amountFils / 100).toFixed(2),
    localCurrency,
    originalAmount,
    transaction.originalCurrency ?? '',
    transaction.category,
    transaction.title,
    account?.name ?? '',
    account?.last4 ?? '',
    transaction.source ?? 'manual',
    transaction.isTransfer === true,
    isUnassignedAccountRef(transaction.accountId),
  ].map(csvCell).join(',');
}

function finishCsv(rows: string[]): string {
  return `\uFEFF${[CSV_HEADER.map(csvCell).join(','), ...rows].join('\n')}\n`;
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Large SMS histories must not monopolize the JS thread while Settings says
 * nothing happened. Yield before the first row so the busy label paints, then
 * between bounded chunks so navigation and presses remain responsive.
 */
export async function transactionsCsvAsync(
  transactions: Transaction[],
  accounts: Account[],
  localCurrency: string,
  chunkSize = 500,
): Promise<string> {
  const accountById = new Map(accounts.map((account) => [account.id, account] as const));
  const rows: string[] = [];
  await yieldToUi();
  for (let index = 0; index < transactions.length; index += 1) {
    const transaction = transactions[index];
    rows.push(transactionCsvRow(transaction, accountById.get(transaction.accountId), localCurrency));
    if ((index + 1) % chunkSize === 0) await yieldToUi();
  }
  return finishCsv(rows);
}
