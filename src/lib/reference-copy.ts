/** Localized presentation vocabulary shared by the approved redesign. */

export const paymentAgendaCopy = {
  en: { overdue: 'Past due', 'expected-earlier': 'Expected earlier', soon: 'Due soon', later: 'Coming up', paid: 'Recently paid',
    estimate: 'Estimated', recorded: 'Paid · due', statement: 'Statement due', empty: 'Nothing coming up',
    emptyBody: 'Add a bill reminder or import your bank alerts. Wafra will show the dates it can verify.',
    note: 'Reminders, not payments', noteBody: 'Wafra tracks what is due. Recording a payment does not move money.',
    today: 'Today', tomorrow: 'Tomorrow', paidStatement: 'Paid statement · due',
    subscriptions: 'Subscriptions', utilities: 'Utilities & telecom', cards: 'Card payments', loans: 'Loan repayments', other: 'Other bills',
    subscriptionsHint: 'Recurring memberships and services', utilitiesHint: 'Electricity, water, phone and internet',
    emptySubscriptions: 'No subscription renewals to show.', emptyUtilities: 'No utility bills to show.' },
  ar: { overdue: 'متأخرة', 'expected-earlier': 'كانت متوقعة سابقاً', soon: 'مستحقة قريباً', later: 'قادمة', paid: 'مدفوعة مؤخراً',
    estimate: 'تقديري', recorded: 'مدفوعة · استحقاقها', statement: 'استحقاق الكشف', empty: 'لا توجد دفعات قادمة',
    emptyBody: 'أضف تذكيراً بفاتورة أو استورد تنبيهات البنك لعرض التواريخ المعروفة.',
    note: 'تذكيرات وليست خدمة دفع', noteBody: 'تتابع وفرة الاستحقاقات. تسجيل الدفع لا ينقل الأموال.',
    today: 'اليوم', tomorrow: 'غداً', paidStatement: 'كشف مدفوع · استحقاقه',
    subscriptions: 'الاشتراكات', utilities: 'المرافق والاتصالات', cards: 'دفعات البطاقات', loans: 'أقساط القروض', other: 'فواتير أخرى',
    subscriptionsHint: 'العضويات والخدمات المتكررة', utilitiesHint: 'الكهرباء والمياه والهاتف والإنترنت',
    emptySubscriptions: 'لا توجد تجديدات اشتراكات لعرضها.', emptyUtilities: 'لا توجد فواتير مرافق لعرضها.' },
};

export const accountGroupsCopy = {
  en: { bank: 'Bank accounts', credit: 'Credit cards', debit: 'Other cards', cash: 'Cash',
    unknown: 'No recorded figure', manage: 'Manage account', empty: 'No accounts yet',
    sourceNote: 'Your accounts, clearly separated', sourceBody: 'Recorded balances are not a live bank connection. Credit-card dues are shown separately.' },
  ar: { bank: 'الحسابات المصرفية', credit: 'البطاقات الائتمانية', debit: 'بطاقات أخرى', cash: 'النقد',
    unknown: 'لا يوجد مبلغ مسجل', manage: 'إدارة الحساب', empty: 'لا توجد حسابات بعد',
    sourceNote: 'حساباتك بوضوح', sourceBody: 'الأرصدة المسجلة ليست اتصالاً مباشراً بالبنك. تظهر استحقاقات البطاقات الائتمانية منفصلة.' },
};

export const spendingCopy = {
  en: { categories: 'Categories', activity: 'Activity', trends: 'Trends', spent: 'Total spent',
    limited: 'Categories with limits', of: 'of', all: 'All', withLimits: 'With limits', noLimits: 'No limits',
    noLimit: 'No category limit', setLimit: 'Set a limit', manage: 'Edit limits', monthlyOnly: 'Category limits are monthly. Choose a month to view them.',
    empty: 'No spending in this period', emptyBody: 'Add an expense or import bank alerts to see your categories here.',
    emptyFilter: 'No categories match this filter', left: 'left', over: 'over limit',
    details: 'View activity', newLimit: 'New category limit', search: 'Search spending', allActivity: 'View all spending',
    noResults: 'No matching expenses', searchHint: 'Search by merchant or account',
    summaryNote: 'Only categories with a limit are included below.', used: 'used', month: 'This period',
    breakdown: 'Where it went', share: 'of spending', shareNote: 'Each category’s share of total spending', budgetUsed: 'of limit used' },
  ar: { categories: 'الفئات', activity: 'الحركات', trends: 'الاتجاهات', spent: 'إجمالي الإنفاق',
    limited: 'الفئات ذات الحدود', of: 'من', all: 'الكل', withLimits: 'بحد إنفاق', noLimits: 'بلا حد',
    noLimit: 'لا يوجد حد لهذه الفئة', setLimit: 'تحديد حد', manage: 'تعديل الحدود', monthlyOnly: 'حدود الفئات شهرية. اختر شهراً لعرضها.',
    empty: 'لا يوجد إنفاق في هذه الفترة', emptyBody: 'أضف مصروفاً أو استورد تنبيهات البنك لعرض الفئات هنا.',
    emptyFilter: 'لا توجد فئات مطابقة', left: 'متبقٍ', over: 'فوق الحد',
    details: 'عرض الحركات', newLimit: 'حد إنفاق جديد', search: 'البحث في المصروفات', allActivity: 'عرض كل المصروفات',
    noResults: 'لا توجد مصروفات مطابقة', searchHint: 'ابحث باسم التاجر أو الحساب',
    summaryNote: 'يشمل المؤشر أدناه الفئات التي لها حد فقط.', used: 'مستخدم', month: 'هذه الفترة',
    breakdown: 'أين أنفقت', share: 'من الإنفاق', shareNote: 'حصة كل فئة من إجمالي الإنفاق', budgetUsed: 'من الحد مستخدم' },
} as const;

export const spendingTrendsCopy = {
  en: { cashflow: 'Income & spending', sixMonths: 'Six money months', income: 'Income', spending: 'Spending',
    merchants: 'Top merchants', change: 'What changed', fewer: 'Less', more: 'More', vs: 'Compared with',
    noMerchants: 'Merchant trends will appear after you add spending.', noChange: 'No material category change for this comparison.',
    missingComparison: 'Choose a shorter period for a comparable view.', patterns: 'Spending by weekday',
    patternsNote: 'Recorded spending, excluding fixed commitments. This is not a forecast.',
    noData: 'No recorded activity', records: 'transactions', partial: 'The selected month may be incomplete.' },
  ar: { cashflow: 'الدخل والإنفاق', sixMonths: 'ستة أشهر مالية', income: 'الدخل', spending: 'الإنفاق',
    merchants: 'أبرز التجار', change: 'ما الذي تغير', fewer: 'أقل', more: 'أكثر', vs: 'مقارنة مع',
    noMerchants: 'ستظهر اتجاهات التجار بعد إضافة المصروفات.', noChange: 'لا يوجد تغير كبير في الفئات لهذه المقارنة.',
    missingComparison: 'اختر فترة أقصر لعرض المقارنة.', patterns: 'الإنفاق حسب أيام الأسبوع',
    patternsNote: 'المصروفات المسجلة باستثناء الالتزامات الثابتة. ليست توقعات مستقبلية.',
    noData: 'لا توجد حركات مسجلة', records: 'حركات', partial: 'قد يكون الشهر المحدد غير مكتمل.' },
};

export const homeSummaryCopy = {
  en: { balance: 'Recorded balances', net: 'Net after spending', notBalance: 'Income minus spending · not your bank balance',
    moneyIn: 'Income', moneyOut: 'Spending', netLabel: 'Net', netUnavailable: 'Some transfers are excluded, so Net is not shown.',
    noIncome: 'No confirmed income recorded for this period.',
    transfersExcluded: (count: number) => `${count.toLocaleString('en-US')} transfer${count === 1 ? '' : 's'} excluded`,
    transfersToReview: (count: number) => `${count.toLocaleString('en-US')} to review`,
    add: 'Add', import: 'Import', accounts: 'Accounts', settings: 'Settings',
    spending: 'Spending', viewSpending: 'View money out', income: 'Income this period', period: 'This period', balanceDetail: 'View accounts',
    balanceNote: 'Latest known figures · not a live bank connection' },
  ar: { balance: 'الأرصدة المسجلة', net: 'الصافي بعد الإنفاق', notBalance: 'الدخل ناقص الإنفاق · ليس رصيد البنك',
    moneyIn: 'الدخل', moneyOut: 'الإنفاق', netLabel: 'الصافي', netUnavailable: 'بعض التحويلات مستبعدة، لذلك لا يظهر الصافي.',
    noIncome: 'لا يوجد دخل مؤكد مسجل لهذه الفترة.',
    transfersExcluded: (count: number) => `${count.toLocaleString('ar-AE')} تحويلات مستبعدة`,
    transfersToReview: (count: number) => `${count.toLocaleString('ar-AE')} للمراجعة`,
    add: 'إضافة', import: 'استيراد', accounts: 'الحسابات', settings: 'الإعدادات',
    spending: 'الإنفاق', viewSpending: 'عرض الأموال الخارجة', income: 'الدخل في هذه الفترة', period: 'هذه الفترة', balanceDetail: 'عرض الحسابات',
    balanceNote: 'آخر الأرصدة المعروفة · ليست بيانات مصرفية مباشرة' },
};
