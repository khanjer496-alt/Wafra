import type { IconName } from '@/components/ui/icon.types';
import { getLanguage, type Lang } from '@/lib/i18n';
import type { CategoryId, TransactionType } from '@/lib/types';

/**
 * A category has a glyph, not a hue.
 *
 * Seventeen saturated colours used to fight each other on every list, and none
 * of them meant anything — you cannot learn that pink is Shopping when eleven
 * other pinks are also on screen. Colour is now reserved for meaning: money in,
 * money out, something needs attention. Identity comes from the glyph.
 */
export interface CategoryMeta {
  id: CategoryId;
  label: string;
  labelAr: string;
  icon: IconName;
  type: TransactionType;
}

export const CATEGORIES: CategoryMeta[] = [
  { id: 'groceries', label: 'Groceries', labelAr: 'البقالة', icon: 'cart', type: 'expense' },
  { id: 'dining', label: 'Dining', labelAr: 'المطاعم', icon: 'dining', type: 'expense' },
  { id: 'transport', label: 'Transport', labelAr: 'المواصلات', icon: 'car', type: 'expense' },
  { id: 'cash-withdrawal', label: 'Cash withdrawal', labelAr: 'سحب نقدي', icon: 'cash', type: 'expense' },
  { id: 'utilities', label: 'Utilities', labelAr: 'المرافق', icon: 'bolt', type: 'expense' },
  { id: 'telecom', label: 'Telecom', labelAr: 'الاتصالات', icon: 'phone', type: 'expense' },
  { id: 'rent', label: 'Rent', labelAr: 'الإيجار', icon: 'home', type: 'expense' },
  { id: 'shopping', label: 'Shopping', labelAr: 'التسوق', icon: 'bag', type: 'expense' },
  { id: 'health', label: 'Health', labelAr: 'الصحة', icon: 'heart', type: 'expense' },
  // Two categories the app had no home for. Running the accuracy corpus, 44 of
  // 94 message occurrences landed in "other", and the largest single block was
  // home and personal services — one cleaning company alone accounted for 15.
  // They are separate because they are separate habits: one is grooming, the
  // other is upkeep, and a limit on one says nothing about the other.
  { id: 'personal-care', label: 'Personal care', labelAr: 'العناية الشخصية', icon: 'scissors', type: 'expense' },
  { id: 'home-services', label: 'Home services', labelAr: 'خدمات المنزل', icon: 'tools', type: 'expense' },
  { id: 'education', label: 'Education', labelAr: 'التعليم', icon: 'cap', type: 'expense' },
  { id: 'travel', label: 'Travel', labelAr: 'السفر', icon: 'plane', type: 'expense' },
  { id: 'entertainment', label: 'Entertainment', labelAr: 'الترفيه', icon: 'play', type: 'expense' },
  // Two more the app had no home for, both read off the same accuracy corpus
  // that produced personal-care and home-services. 119 of 126 message families
  // parsed with the RIGHT merchant and landed in "other" — the ledger was
  // correct and useless, because nothing grouped.
  //
  // Software was already being collected, just under the wrong name: the
  // vocabulary had a whole developer/AI-tooling rule pointing at
  // `entertainment` with a comment admitting it. Investing is the opposite
  // case — it was mapped to `other` ON PURPOSE, to say "this is not spending",
  // but `other` is also the shrug, and on screen the two are the same word.
  { id: 'software', label: 'Software', labelAr: 'البرمجيات', icon: 'code', type: 'expense' },
  { id: 'investing', label: 'Investing', labelAr: 'الاستثمار', icon: 'trend', type: 'expense' },
  { id: 'charity', label: 'Charity', labelAr: 'الصدقة', icon: 'gift', type: 'expense' },
  { id: 'government', label: 'Government', labelAr: 'الخدمات الحكومية', icon: 'bank', type: 'expense' },
  { id: 'loan', label: 'Loan', labelAr: 'القروض', icon: 'bank', type: 'expense' },
  { id: 'other', label: 'Other', labelAr: 'أخرى', icon: 'receipt', type: 'expense' },
  { id: 'salary', label: 'Salary', labelAr: 'الراتب', icon: 'briefcase', type: 'income' },
  { id: 'business', label: 'Business', labelAr: 'الأعمال', icon: 'chart', type: 'income' },
];

const byId = new Map(CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id: CategoryId): CategoryMeta {
  return byId.get(id) ?? byId.get('other')!;
}

/** Validate a category without turning an unknown id into the display fallback. */
export function categorySupportsType(id: unknown, type: unknown): id is CategoryId {
  if (typeof id !== 'string' || (type !== 'income' && type !== 'expense')) return false;
  const category = byId.get(id as CategoryId);
  return Boolean(category && (category.id === 'other' || category.type === type));
}

/** Reserved rule namespace; keep the historical trim/lower merchant normalization. */
export function scopedMerchantOverrideKey(merchant: string, type: TransactionType): string {
  return `${type}:${merchant.trim().toLowerCase()}`;
}

export function readMerchantCategoryOverride(
  overrides: Readonly<Record<string, CategoryId>> | undefined,
  merchant: string,
  type: TransactionType,
): CategoryId | undefined {
  if (!overrides || (type !== 'income' && type !== 'expense')) return undefined;
  const scoped = scopedMerchantOverrideKey(merchant, type);
  if (Object.prototype.hasOwnProperty.call(overrides, scoped)) {
    const category = overrides[scoped];
    return categorySupportsType(category, type) ? category : undefined;
  }
  const legacy = merchant.trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(overrides, legacy)) return undefined;
  const category = overrides[legacy];
  // Before directional rules, Other was an expense rule. Reading it as an
  // income rule would silently widen an existing user's original choice.
  if (category === 'other' && type === 'income') return undefined;
  return categorySupportsType(category, type) ? category : undefined;
}

/** Localized category name without duplicating category dictionaries in UI. */
export function categoryLabel(category: CategoryMeta | CategoryId, language: Lang = getLanguage()): string {
  const meta = typeof category === 'string' ? getCategory(category) : category;
  return language === 'ar' ? meta.labelAr : meta.label;
}

export const EXPENSE_CATEGORIES = CATEGORIES.filter((c) => c.type === 'expense');
// Unknown credits, refunds and reimbursements are not automatically Salary or
// Business. Keep one persisted Other id while presenting it in either direction.
export const INCOME_CATEGORIES: CategoryMeta[] = [
  ...CATEGORIES.filter((c) => c.type === 'income'),
  { ...byId.get('other')!, type: 'income' },
];

/**
 * Money that leaves on a contract, not on a decision.
 *
 * Rent is one charge the size of forty grocery runs, and business costs are
 * somebody else's money passing through. Any statistic about *behaviour* —
 * which category leads, which purchase was biggest, which weekday is heaviest —
 * is answered by whichever bucket rent happened to land in unless these are
 * taken out first. The lesson was learned once in `buildInsights` and lived
 * there as two inline `!== 'rent' && !== 'business'` checks; it is a property
 * of the categories themselves, so it lives here now and every analysis reads
 * the same list.
 *
 * Totals are a different question — "what left the account this month" must
 * include the rent — so `summarizeMonth` and the ledger deliberately do NOT
 * use this.
 */
export const FIXED_COMMITMENT_CATEGORIES: readonly CategoryId[] = ['rent', 'business'];

export function isFixedCommitment(id: CategoryId): boolean {
  return FIXED_COMMITMENT_CATEGORIES.includes(id);
}
