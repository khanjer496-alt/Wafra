import { categorySupportsType } from '@/lib/categories';
import type { BillAlias, CategoryId, Transaction } from '@/lib/types';

const BILL_IDENTITY_RE = /^(?:account|consumer|party|customer|contract|service):[A-Z0-9]{4}$/i;

/**
 * A bank bill-pay nickname is not a merchant identity.
 *
 * FAB can call one registered consumer biller "Fishbasket" for years while a
 * real restaurant elsewhere is also Fish Basket. A merchant-wide override is
 * therefore too broad. Scope the user's correction to the bank's privacy-safe
 * bill identity plus the original nickname that produced it.
 */
export function billAliasKey(sourceTitle: string, billIdentity: string): string | null {
  const title = sourceTitle.normalize('NFKC').trim().toLocaleLowerCase();
  const identity = billIdentity.trim().toLocaleLowerCase();
  if (title.length < 2 || !BILL_IDENTITY_RE.test(identity)) return null;
  return `${identity}|${title}`;
}

export function readBillAlias(
  aliases: Readonly<Record<string, BillAlias>> | undefined,
  sourceTitle: string,
  billIdentity: string | undefined,
): BillAlias | undefined {
  if (!aliases || !billIdentity) return undefined;
  const key = billAliasKey(sourceTitle, billIdentity);
  if (!key || !Object.prototype.hasOwnProperty.call(aliases, key)) return undefined;
  const alias = aliases[key];
  if (!alias || typeof alias.title !== 'string' || !alias.title.trim() ||
    !categorySupportsType(alias.category, 'expense')) return undefined;
  return alias;
}

/** Exact historical rows a "past + future" bill correction is allowed to move. */
export function billAliasAppliesTo(
  transaction: Transaction,
  sourceTitle: string,
  billIdentity: string,
): boolean {
  const expected = billAliasKey(sourceTitle, billIdentity);
  const actual = transaction.billIdentity
    ? billAliasKey(transaction.title, transaction.billIdentity)
    : null;
  return expected !== null && expected === actual &&
    transaction.type === 'expense' &&
    transaction.paymentFlowSide === 'receipt' &&
    transaction.isTransfer !== true &&
    !transaction.userEdited &&
    (!transaction.splits || transaction.splits.length === 0);
}

export function applyBillAliasToTransactions(
  transactions: readonly Transaction[],
  sourceTitle: string,
  billIdentity: string,
  alias: BillAlias,
): Transaction[] {
  let changed = false;
  const result = transactions.map((transaction) => {
    if (!billAliasAppliesTo(transaction, sourceTitle, billIdentity)) return transaction;
    changed = true;
    return {
      ...transaction,
      title: alias.title,
      category: alias.category,
      // This is human-supplied naming evidence. Keep it visible to parser
      // coverage without setting userEdited, which would also freeze account
      // and transfer repairs unrelated to this bill identity.
      titleEdited: transaction.title !== alias.title || transaction.titleEdited || undefined,
    };
  });
  return changed ? result : transactions.slice();
}

export function validBillAlias(title: string, category: CategoryId): BillAlias | null {
  const cleaned = title.trim().replace(/\s{2,}/g, ' ');
  if (cleaned.length < 2 || !categorySupportsType(category, 'expense')) return null;
  return { title: cleaned, category };
}
