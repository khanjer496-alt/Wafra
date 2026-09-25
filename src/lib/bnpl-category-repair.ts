import { readMerchantCategoryOverride } from '@/lib/categories';
import { isBnplPayee, parseSms } from '@/lib/sms-parser';
import type { CategoryId, Transaction } from '@/lib/types';

/**
 * One-time repair of rows a body-wide BNPL keyword filed as Loan.
 *
 * For a while every payment to Tabby/Tamara/Postpay/Cashew — and every
 * purchase on a BNPL provider's own card at a named merchant — was stored as
 * `loan`. heal.ts only ever re-files rows in Other, so without this the rows
 * stay Loan forever (and Loan unlocks the relaxed recurring-bill path).
 *
 * Deliberately narrow. A row moves only when ALL of these hold:
 *  - the parser made it (source 'sms'), nobody edited it, it is an unsplit
 *    expense, not a transfer, and it is currently `loan`;
 *  - the user has no merchant rule for its title (their rule is their answer);
 *  - EITHER its payee title is exactly a BNPL provider → Shopping,
 *  - OR its retained SMS names a BNPL provider and today's parser reads that
 *    same SMS as the same amount at the same merchant with a non-Loan
 *    category → that category (a purchase on a BNPL card keeps the
 *    merchant's category). Rows without a retained body are left alone.
 * Only `category` ever changes; amounts, dates, accounts, titles and transfer
 * state are untouched. Genuine bank loans and finance houses are not BNPL
 * payees and keep Loan. Idempotent: a repaired row is no longer `loan`.
 */
export const BNPL_CATEGORY_REPAIR_VERSION = 1;

const BNPL_WORD_RE = /\b(?:tabby|tamara|postpay|cashew)\b/i;

export function bnplRepairedCategory(
  t: Transaction,
  overrides?: Readonly<Record<string, CategoryId>>,
): CategoryId | null {
  if (t.category !== 'loan' || t.type !== 'expense') return null;
  if (t.source !== 'sms' || t.userEdited || t.isTransfer || t.splits?.length) return null;
  if (readMerchantCategoryOverride(overrides, t.title, t.type) !== undefined) return null;
  if (isBnplPayee(t.title)) return 'shopping';
  if (typeof t.raw !== 'string' || !BNPL_WORD_RE.test(t.raw)) return null;
  let parsed: ReturnType<typeof parseSms>;
  try {
    parsed = parseSms(t.raw);
  } catch {
    return null;
  }
  if (
    !parsed || parsed.kind !== 'transaction' || parsed.type !== 'expense' ||
    parsed.amountFils !== t.amountFils || parsed.merchant !== t.title ||
    parsed.categoryGuess === 'loan'
  ) {
    return null;
  }
  return parsed.categoryGuess;
}

/** Will the repair re-read any retained SMS? (Then the ledger's pack must be live.) */
export function bnplRepairNeedsParser(transactions: readonly Transaction[]): boolean {
  return transactions.some((t) =>
    t.category === 'loan' && t.type === 'expense' && typeof t.raw === 'string' && BNPL_WORD_RE.test(t.raw));
}

/** Returns the same array when nothing moved, so callers can detect a no-op. */
export function repairBnplCategories(
  transactions: Transaction[],
  overrides?: Readonly<Record<string, CategoryId>>,
): Transaction[] {
  let changed = false;
  const next = transactions.map((t) => {
    const category = bnplRepairedCategory(t, overrides);
    if (!category || category === t.category) return t;
    changed = true;
    return { ...t, category };
  });
  return changed ? next : transactions;
}
