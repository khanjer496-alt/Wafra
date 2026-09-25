import type { TransactionSourceKind } from '@/lib/transaction-source';

/**
 * Transactions list, filter sheet and row actions, in English and Arabic.
 * Source labels follow transaction-source.ts. "Apple Pay" is a product name
 * and stays in Latin script in Arabic, as Apple writes it.
 */
type SourceLabels = Record<TransactionSourceKind, string>;

const en = {
  all: 'All', spending: 'Spending', income: 'Income', transfers: 'Transfers', review: 'Needs review', types: 'Transaction type',
  /** Lower-case, after the time on a row: "09:41 · bank text". */
  source: { 'bank-text': 'bank text', notification: 'app alert', 'apple-pay': 'Apple Pay', statement: 'statement', email: 'bank email', manual: 'by hand' } as SourceLabels,
  /** Filter chips. */
  sourceTitle: { 'bank-text': 'Bank text', notification: 'Bank app alert', 'apple-pay': 'Apple Pay', statement: 'Statement', email: 'Bank email', manual: 'By hand' } as SourceLabels,
  sourceFilter: 'Source', maxAmount: 'Maximum amount', noMax: 'Any',
  upTo: (amount: string) => `up to ${amount}`,
  category: 'Category', transfer: 'Transfer', delete: 'Delete', transferTag: 'Transfer',
  accountFilter: (name: string) => `Account: ${name}`,
};

const ar: typeof en = {
  all: 'الكل', spending: 'الإنفاق', income: 'الدخل', transfers: 'التحويلات', review: 'بحاجة لمراجعة', types: 'نوع المعاملة',
  source: { 'bank-text': 'رسالة البنك', notification: 'تنبيه تطبيق البنك', 'apple-pay': 'Apple Pay', statement: 'كشف حساب', email: 'بريد البنك', manual: 'يدوياً' },
  sourceTitle: { 'bank-text': 'رسالة البنك', notification: 'تنبيه تطبيق البنك', 'apple-pay': 'Apple Pay', statement: 'كشف حساب', email: 'بريد البنك', manual: 'يدوياً' },
  sourceFilter: 'المصدر', maxAmount: 'الحد الأقصى للمبلغ', noMax: 'أي مبلغ',
  upTo: (amount: string) => `حتى ${amount}`,
  category: 'الفئة', transfer: 'تحويل', delete: 'حذف', transferTag: 'تحويل',
  accountFilter: (name: string) => `الحساب: ${name}`,
};

export const transactionsCopy = { en, ar };

export function transactionsWords(language: string | null | undefined): typeof en {
  return language === 'ar' ? ar : en;
}
