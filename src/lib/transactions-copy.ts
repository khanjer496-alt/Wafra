import type { TransactionSourceKind } from '@/lib/transaction-source';

/**
 * Transactions list, filter sheet and row actions, in English and Arabic.
 * Source labels follow transaction-source.ts. "Apple Pay" is a product name
 * and stays in Latin script in Arabic, as Apple writes it.
 */
type SourceLabels = Record<TransactionSourceKind, string>;

const en = {
  all: 'All', spending: 'Spending', income: 'Income', transfers: 'Transfers', review: 'Needs review', types: 'Transaction type',
  /** Lower-case, after the time on a row: "09:41 · bank message". */
  source: { 'bank-text': 'bank message', notification: 'app alert', 'apple-pay': 'Apple Pay', statement: 'statement', email: 'bank email', manual: 'by hand' } as SourceLabels,
  /** Filter chips. */
  sourceTitle: { 'bank-text': 'Bank message', notification: 'Bank app alert', 'apple-pay': 'Apple Pay', statement: 'Statement', email: 'Bank email', manual: 'By hand' } as SourceLabels,
  sourceFilter: 'Source', maxAmount: 'Maximum amount', noMax: 'Any',
  upTo: (amount: string) => `up to ${amount}`,
  category: 'Category', transfer: 'Transfer', delete: 'Delete', transferTag: 'Transfer',
  accountFilter: (name: string) => `Account: ${name}`,
  // The list's empty states: nothing recorded at all, nothing in this period,
  // and only then "nothing matches" (when a search or filter is narrowing it).
  emptyTitle: 'No transactions yet',
  emptyBody: 'They appear here when Wafra reads a bank message, or when you import a statement or add one by hand.',
  emptyImport: 'Import a statement',
  emptyAdd: 'Add by hand',
  emptyPeriod: (period: string) => `Nothing recorded in ${period}`,
  emptyPeriodBody: 'Choose another period to see other transactions.',
};

const ar: typeof en = {
  all: 'الكل', spending: 'الإنفاق', income: 'الدخل', transfers: 'التحويلات', review: 'بحاجة لمراجعة', types: 'نوع المعاملة',
  source: { 'bank-text': 'رسالة البنك', notification: 'تنبيه تطبيق البنك', 'apple-pay': 'Apple Pay', statement: 'كشف حساب', email: 'بريد البنك', manual: 'يدوياً' },
  sourceTitle: { 'bank-text': 'رسالة البنك', notification: 'تنبيه تطبيق البنك', 'apple-pay': 'Apple Pay', statement: 'كشف حساب', email: 'بريد البنك', manual: 'يدوياً' },
  sourceFilter: 'المصدر', maxAmount: 'الحد الأقصى للمبلغ', noMax: 'أي مبلغ',
  upTo: (amount: string) => `حتى ${amount}`,
  category: 'الفئة', transfer: 'تحويل', delete: 'حذف', transferTag: 'تحويل',
  accountFilter: (name: string) => `الحساب: ${name}`,
  emptyTitle: 'لا توجد عمليات بعد',
  emptyBody: 'تظهر هنا عندما تقرأ وفرة رسالة من البنك، أو عندما تستورد كشف حساب أو تضيف عملية يدوياً.',
  emptyImport: 'استيراد كشف حساب',
  emptyAdd: 'إضافة يدوياً',
  emptyPeriod: (period: string) => `لا شيء مسجّل في ${period}`,
  emptyPeriodBody: 'اختر فترة أخرى لعرض عمليات أخرى.',
};

export const transactionsCopy = { en, ar };

export function transactionsWords(language: string | null | undefined): typeof en {
  return language === 'ar' ? ar : en;
}
