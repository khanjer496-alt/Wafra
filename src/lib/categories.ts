import type { IconName } from '@/components/ui/icon';
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
  icon: IconName;
  type: TransactionType;
}

export const CATEGORIES: CategoryMeta[] = [
  { id: 'groceries', label: 'Groceries', icon: 'cart', type: 'expense' },
  { id: 'dining', label: 'Dining', icon: 'dining', type: 'expense' },
  { id: 'transport', label: 'Transport', icon: 'car', type: 'expense' },
  { id: 'utilities', label: 'Utilities', icon: 'bolt', type: 'expense' },
  { id: 'telecom', label: 'Telecom', icon: 'phone', type: 'expense' },
  { id: 'rent', label: 'Rent', icon: 'home', type: 'expense' },
  { id: 'shopping', label: 'Shopping', icon: 'bag', type: 'expense' },
  { id: 'health', label: 'Health', icon: 'heart', type: 'expense' },
  { id: 'education', label: 'Education', icon: 'cap', type: 'expense' },
  { id: 'travel', label: 'Travel', icon: 'plane', type: 'expense' },
  { id: 'entertainment', label: 'Entertainment', icon: 'play', type: 'expense' },
  { id: 'charity', label: 'Charity', icon: 'gift', type: 'expense' },
  { id: 'government', label: 'Government', icon: 'bank', type: 'expense' },
  { id: 'loan', label: 'Loan', icon: 'bank', type: 'expense' },
  { id: 'other', label: 'Other', icon: 'receipt', type: 'expense' },
  { id: 'salary', label: 'Salary', icon: 'briefcase', type: 'income' },
  { id: 'business', label: 'Business', icon: 'chart', type: 'income' },
];

const byId = new Map(CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id: CategoryId): CategoryMeta {
  return byId.get(id) ?? byId.get('other')!;
}

export const EXPENSE_CATEGORIES = CATEGORIES.filter((c) => c.type === 'expense');
export const INCOME_CATEGORIES = CATEGORIES.filter((c) => c.type === 'income');

/**
 * The one place several categories have to be told apart at a glance: the
 * composition bar and its legend. One hue at five lightnesses, so the ramp
 * still reads as a single quantity being divided rather than as a set of
 * unrelated things. Anything past the fifth slice is "everything else".
 */
export const CATEGORY_RAMP = {
  light: ['#1F6B52', '#3D8A72', '#63A791', '#8CBFAE', '#B2D4C7'],
  dark: ['#57B894', '#48A07F', '#3B826A', '#2F6754', '#264F41'],
} as const;

export function rampColor(index: number, dark: boolean): string {
  const ramp = CATEGORY_RAMP[dark ? 'dark' : 'light'];
  return ramp[Math.min(index, ramp.length - 1)];
}
