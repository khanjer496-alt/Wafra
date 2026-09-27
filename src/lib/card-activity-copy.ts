import type { Lang } from '@/lib/i18n';

export function cardActivityWords(language: Lang) {
  return language === 'ar' ? {
    title: 'نشاط البطاقة', missing: 'هذه البطاقة غير متاحة.', loading: 'جارٍ تحميل البطاقة…',
    credit: 'بطاقة ائتمان', debit: 'بطاقة خصم', card: 'بطاقة',
    spending: 'الإنفاق المسجّل', credits: 'المبالغ الواردة والمستردّة', payments: 'دفعات البطاقة',
    statementRemaining: 'المتبقي من كشف الحساب', reportedOutstanding: 'المستحق حسب البنك', reportedBalance: 'الرصيد',
    unknown: 'لا يتوفر مبلغ مستحق أو رصيد مؤكّد لهذه البطاقة.',
    activity: 'النشاط المسجّل', empty: 'لا توجد معاملات مسجّلة لهذه البطاقة خلال الفترة المختارة.',
    note: 'هذه الأرقام تخص المعاملات المسجّلة في الفترة المختارة وقد لا تشمل كل نشاط البطاقة. دفعات البطاقة منفصلة عن الإنفاق، والمبالغ الواردة لا تُخصم منه.',
    all: 'كل المعاملات', statements: 'الكشوف والدفعات', details: 'تفاصيل البطاقة',
    issuer: 'البنك المُصدر', ending: 'آخر أرقام البطاقة', limit: 'الحد الذي أدخلته', available: 'الائتمان المتاح حسب البنك',
    asOf: 'آخر تحديث', choosePeriod: 'اختيار الفترة',
  } : {
    title: 'Card activity', missing: 'This card is no longer available.', loading: 'Loading card…',
    credit: 'Credit card', debit: 'Debit card', card: 'Card',
    spending: 'Captured spending', credits: 'Credits & refunds', payments: 'Card payments',
    statementRemaining: 'Statement remaining', reportedOutstanding: 'Bank-reported outstanding', reportedBalance: 'Balance',
    unknown: 'No confirmed outstanding amount or balance is available for this card.',
    activity: 'Recorded activity', empty: 'No transactions recorded on this card in the selected period.',
    note: 'These figures cover recorded transactions in the selected period and may not include all card activity. Card payments are separate from spending; credits are not deducted from it.',
    all: 'All transactions', statements: 'Statements & payments', details: 'Card details',
    issuer: 'Issuer', ending: 'Card ending', limit: 'Limit you entered', available: 'Bank-reported available credit',
    asOf: 'Last reported', choosePeriod: 'Choose period',
  };
}
