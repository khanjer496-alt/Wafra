import { categoryLabel } from '@/lib/categories';
import { formatMinorUnits, formatMoneyText, type LedgerMoneySpec } from '@/lib/ledger-money';
import { motionAndroidCopy } from '@/lib/motion-android-copy';
import type { Transaction } from '@/lib/types';

export interface CaptureToastContent {
  /** "Starbucks added · Dining" */
  message: string;
  /** The amount, in the device's money pattern: "USD 6.75", "$6.75". */
  amount: string;
  /** One sentence for a screen reader, speaking the ISO code. */
  spoken: string;
}

/**
 * The live-capture toast for ONE known ledger row, or null when the fact is
 * not fully known — the caller then keeps the generic "Transaction added"
 * line rather than a half-filled one.
 *
 * Only what the stored row says is shown: its title, its category and its
 * ledger amount. Nothing is inferred and nothing raw from the message is
 * read (rows never carry the SMS/notification text).
 */
export function captureToastContent(
  row: Pick<Transaction, 'title' | 'category' | 'amountFils' | 'type'> | null | undefined,
  money: LedgerMoneySpec | null | undefined,
  language?: string,
): CaptureToastContent | null {
  if (!row || !money) return null;
  const merchant = row.title.trim();
  if (!merchant) return null;
  if (!Number.isSafeInteger(row.amountFils) || row.amountFils <= 0) return null;
  const copy = motionAndroidCopy(language);
  const category = categoryLabel(row.category, language === 'ar' ? 'ar' : language === undefined ? undefined : 'en');
  const sign = row.type === 'income' ? '+' : '';
  const visible = formatMoneyText(row.amountFils, money);
  const spokenAmount = `${sign}${money.currency} ${formatMinorUnits(row.amountFils, money)}`;
  return {
    message: copy.captureAdded(merchant, category),
    // Isolated left-to-right so an Arabic (RTL) toast cannot reorder the
    // sign, the currency and the digits.
    amount: `\u2066${sign}${visible}\u2069`,
    spoken: copy.captureAddedSpoken(merchant, category, spokenAmount),
  };
}
