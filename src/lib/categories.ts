import type { IconName } from '@/components/ui/icon';
import type { CategoryId, TransactionType } from '@/lib/types';

export interface CategoryMeta {
  id: CategoryId;
  label: string;
  icon: IconName;
  color: string;
  type: TransactionType;
}

export const CATEGORIES: CategoryMeta[] = [
  { id: 'groceries', label: 'Groceries', icon: 'cart', color: '#34D399', type: 'expense' },
  { id: 'dining', label: 'Dining', icon: 'dining', color: '#FB923C', type: 'expense' },
  { id: 'transport', label: 'Transport', icon: 'car', color: '#38BDF8', type: 'expense' },
  { id: 'utilities', label: 'Utilities', icon: 'bolt', color: '#FACC15', type: 'expense' },
  { id: 'telecom', label: 'Telecom', icon: 'phone', color: '#A78BFA', type: 'expense' },
  { id: 'rent', label: 'Rent', icon: 'home', color: '#F472B6', type: 'expense' },
  { id: 'shopping', label: 'Shopping', icon: 'bag', color: '#FB7185', type: 'expense' },
  { id: 'health', label: 'Health', icon: 'heart', color: '#4ADE80', type: 'expense' },
  { id: 'education', label: 'Education', icon: 'cap', color: '#60A5FA', type: 'expense' },
  { id: 'travel', label: 'Travel', icon: 'plane', color: '#22D3EE', type: 'expense' },
  { id: 'entertainment', label: 'Entertainment', icon: 'play', color: '#C084FC', type: 'expense' },
  { id: 'charity', label: 'Charity', icon: 'gift', color: '#2DD4A8', type: 'expense' },
  { id: 'government', label: 'Government', icon: 'bank', color: '#818CF8', type: 'expense' },
  { id: 'loan', label: 'Loan', icon: 'bank', color: '#F59E0B', type: 'expense' },
  { id: 'other', label: 'Other', icon: 'receipt', color: '#94A3B8', type: 'expense' },
  { id: 'salary', label: 'Salary', icon: 'briefcase', color: '#34D399', type: 'income' },
  { id: 'business', label: 'Business', icon: 'chart', color: '#2DD4A8', type: 'income' },
];

const byId = new Map(CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id: CategoryId): CategoryMeta {
  return byId.get(id) ?? byId.get('other')!;
}

export const EXPENSE_CATEGORIES = CATEGORIES.filter((c) => c.type === 'expense');
export const INCOME_CATEGORIES = CATEGORIES.filter((c) => c.type === 'income');
