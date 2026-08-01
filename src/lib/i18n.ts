/**
 * UI language layer. Strings live here as en/ar pairs; screens call t(key).
 * The language is auto-detected from the device on first launch (Arabic
 * devices get Arabic) and can be switched in Settings. Arabic also flips
 * the app to RTL (applied on next app start — a React Native constraint).
 *
 * SMS parsing language is independent of UI language: the parser grammar
 * follows the market pack, not this setting.
 */

export type Lang = 'en' | 'ar';

const S = {
  // Tabs
  tabHome: { en: 'Home', ar: 'الرئيسية' },
  // Insights and Budgets were two views of the same month; Flow is the merge.
  tabFlow: { en: 'Flow', ar: 'التدفق' },
  tabBills: { en: 'Bills', ar: 'الفواتير' },
  tabWallet: { en: 'Wallet', ar: 'المحفظة' },
  tabAdd: { en: 'Add an entry', ar: 'إضافة عملية' },

  // Common actions
  cancel: { en: 'Cancel', ar: 'إلغاء' },
  delete: { en: 'Delete', ar: 'حذف' },
  save: { en: 'Save', ar: 'حفظ' },
  seeAll: { en: 'See all', ar: 'عرض الكل' },
  markPaid: { en: 'Mark paid', ar: 'تم الدفع' },
  remindMe: { en: 'Remind me', ar: 'ذكّرني' },
  report: { en: 'Report', ar: 'التقرير' },
  today: { en: 'Today', ar: 'اليوم' },
  yesterday: { en: 'Yesterday', ar: 'أمس' },

  // Greetings
  goodMorning: { en: 'Good morning', ar: 'صباح الخير' },
  goodAfternoon: { en: 'Good afternoon', ar: 'مساء الخير' },
  goodEvening: { en: 'Good evening', ar: 'مساء الخير' },

  // Home
  heroSavedCaption: { en: 'SAVED SO FAR THIS MONTH · IN MINUS OUT', ar: 'المدخر هذا الشهر · الدخل ناقص المصروف' },
  heroNetCaption: { en: 'NET FOR THIS PERIOD · IN MINUS OUT', ar: 'الصافي لهذه الفترة · الدخل ناقص المصروف' },
  inLabel: { en: 'In', ar: 'الدخل' },
  outLabel: { en: 'Out', ar: 'المصروف' },
  insightsHeader: { en: 'INSIGHTS', ar: 'ملاحظات' },
  budgetsHeader: { en: 'BUDGETS', ar: 'الميزانيات' },
  recentHeader: { en: 'RECENT ACTIVITY', ar: 'أحدث العمليات' },
  manage: { en: 'Manage', ar: 'إدارة' },
  cardPaymentsDue: { en: 'Card payments due', ar: 'دفعات البطاقات المستحقة' },
  trialEndedBanner: { en: 'Trial ended · tracking paused', ar: 'انتهت التجربة · توقف التتبع' },
  trialEndedBannerSub: { en: 'Subscribe to keep importing your bank SMS', ar: 'اشترك لمواصلة قراءة رسائل البنك' },
  turnOnTracking: { en: 'Turn on automatic tracking', ar: 'فعّل التتبع التلقائي' },
  trackingPrivacy: { en: 'Wafra reads bank SMS on this device only', ar: 'وفرة تقرأ رسائل البنك على هذا الجهاز فقط' },

  // Bills
  billsTitle: { en: 'Bills', ar: 'الفواتير' },
  billsSubtitle: { en: 'Dues, subscriptions and utilities', ar: 'مستحقات واشتراكات وفواتير' },
  subscriptionsSeg: { en: 'Subs', ar: 'اشتراكات' },
  remindersSeg: { en: 'Reminders', ar: 'التذكيرات' },
  cardsSeg: { en: 'Cards', ar: 'بطاقات' },
  seeAllCategoryTx: { en: 'See all transactions', ar: 'عرض كل العمليات' },
  utilitiesSeg: { en: 'Fixed', ar: 'ثابتة' },
  noCardDues: { en: 'No card payments due', ar: 'لا مستحقات على البطاقات' },
  noCardDuesText: {
    en: 'When your bank sends a statement SMS, the amount and pay-by date show up here.',
    ar: 'عند وصول رسالة كشف الحساب من البنك، يظهر المبلغ وتاريخ السداد هنا.',
  },
  monthlySpendOnly: { en: 'tracking spend only', ar: 'تتبع المصروف فقط' },
  detectedHint: { en: 'Detected from your charge history · tap one for details', ar: 'مكتشفة من سجل عملياتك · اضغط للتفاصيل' },
  stoppedSubs: { en: 'Stopped subscriptions', ar: 'اشتراكات متوقفة' },
  stoppedSubsHint: { en: 'No charges for over two cycles — most likely cancelled.', ar: 'لا توجد عمليات خصم لدورتين — على الأغلب ملغاة.' },
  utilitiesHeader: { en: 'Utilities & fixed bills', ar: 'المرافق والفواتير الثابتة' },
  loansHeader: { en: 'Loans & instalments', ar: 'القروض والأقساط' },
  loansHint: { en: 'Fixed repayments detected from your bank messages. Wafra shows what you have paid so far — it cannot see the loan term or balance.', ar: 'أقساط ثابتة مكتشفة من رسائل البنك. يعرض وفرة ما دفعته حتى الآن فقط — لا يمكنه معرفة مدة القرض أو رصيده.' },
  paidSoFar: { en: 'Paid so far', ar: 'المدفوع حتى الآن' },
  payingFor: { en: 'Paying for', ar: 'يُدفع منذ' },
  instalment: { en: 'Instalment', ar: 'القسط' },
  payments: { en: 'Payments', ar: 'عدد الدفعات' },
  utilitiesHint: { en: 'Electricity, internet, rent and other regular payments that recur every month.', ar: 'الكهرباء والإنترنت والإيجار ودفعات شهرية أخرى.' },
  subscribedFor: { en: 'Subscribed for', ar: 'مشترك منذ' },
  charges: { en: 'Charges', ar: 'عدد الدفعات' },
  totalPaid: { en: 'Total paid', ar: 'إجمالي المدفوع' },
  paidWith: { en: 'Paid with', ar: 'الدفع عبر' },
  history: { en: 'History', ar: 'السجل' },
  notASubscription: { en: 'Not a subscription', ar: 'ليس اشتراكاً' },

  // Wallet
  walletTitle: { en: 'Wallet', ar: 'المحفظة' },
  netWorth: { en: 'Net worth', ar: 'صافي الثروة' },
  cardsHeader: { en: 'Cards', ar: 'البطاقات' },
  accountsHeader: { en: 'Accounts', ar: 'الحسابات' },
  inactiveHeader: { en: 'Inactive', ar: 'غير نشطة' },
  goalsHeader: { en: 'Savings goals', ar: 'أهداف الادخار' },
  newGoal: { en: '+ New goal', ar: '+ هدف جديد' },
  outstanding: { en: 'outstanding', ar: 'مستحق' },
  perBankSms: { en: 'per bank SMS', ar: 'حسب رسالة البنك' },
  noBalanceYet: { en: 'no balance SMS yet', ar: 'لا رسالة رصيد بعد' },
  trackedManually: { en: 'Tracked manually', ar: 'يُتابع يدويًا' },
  reminderSet: { en: 'Reminder on', ar: 'التذكير مُفعّل' },
  recurringHint: {
    en: 'Tap a row for its charge history, or to set a reminder.',
    ar: 'اضغط على أي صف لعرض سجل الخصومات أو لضبط تذكير.',
  },
  improveAccuracy: { en: 'Improve accuracy', ar: 'تحسين الدقة' },
  improveAccuracyHint: {
    en: 'These bank messages could not be fully read — the merchant or category had to be guessed. Share the list with the developer and the next update will read them properly. Long account numbers are masked.',
    ar: 'تعذّرت قراءة هذه الرسائل بالكامل — تم تخمين المتجر أو التصنيف. شارك القائمة مع المطوّر وسيقرأها التحديث القادم بشكل صحيح. الأرقام الطويلة مخفية.',
  },
  shareUnrecognized: { en: 'Share formats', ar: 'مشاركة الصيغ' },
  readAs: { en: 'Read as', ar: 'قُرئت كـ' },
  noUnrecognized: { en: 'Everything reads clean', ar: 'كل الرسائل مقروءة' },
  noUnrecognizedText: {
    en: 'No unrecognized bank formats in your data. Rows appear here after a scan when the parser has to guess.',
    ar: 'لا توجد صيغ غير معروفة في بياناتك. تظهر الرسائل هنا بعد الفحص عندما يضطر التطبيق للتخمين.',
  },
  spentThisMonthCaption: { en: 'spent this month', ar: 'مصروف هذا الشهر' },
  longPressHint: { en: 'Long-press a card or account to hide or remove it', ar: 'اضغط مطولاً على بطاقة أو حساب لإخفائه أو حذفه' },

  // Settings
  settingsTitle: { en: 'Settings', ar: 'الإعدادات' },
  featuresHeader: { en: 'Features', ar: 'الميزات' },
  dataHeader: { en: 'Data', ar: 'البيانات' },
  wafraPro: { en: 'Wafra Pro', ar: 'وفرة برو' },
  proActive: { en: 'Active', ar: 'مفعّل' },
  billsAndSubs: { en: 'Bills and subscriptions', ar: 'الفواتير والاشتراكات' },
  importFromSms: { en: 'Import from bank SMS', ar: 'استيراد من رسائل البنك' },
  bankAppNotifs: { en: 'Bank app notifications (beta)', ar: 'إشعارات تطبيقات البنوك (تجريبي)' },
  appLock: { en: 'App lock (biometric)', ar: 'قفل التطبيق (بصمة)' },
  country: { en: 'Country', ar: 'الدولة' },
  language: { en: 'Language', ar: 'اللغة' },
  monthStartsOn: { en: 'Month starts on day', ar: 'يبدأ الشهر في يوم' },
  calendarMonths: { en: 'Calendar months (1st to end)', ar: 'أشهر ميلادية (من ١ حتى النهاية)' },
  backupJson: { en: 'Back up everything (JSON)', ar: 'نسخ احتياطي كامل (JSON)' },
  restoreBackup: { en: 'Restore from backup', ar: 'استعادة من نسخة احتياطية' },
  exportCsv: { en: 'Export transactions (CSV)', ar: 'تصدير العمليات (CSV)' },
  loadDemo: { en: 'Load demo data', ar: 'تحميل بيانات تجريبية' },
  eraseAll: { en: 'Erase all data', ar: 'مسح كل البيانات' },
  tapToChange: { en: 'tap to change', ar: 'اضغط للتغيير' },
  restartForLanguage: { en: 'Restart the app to apply the new language fully.', ar: 'أعد تشغيل التطبيق لتطبيق اللغة الجديدة بالكامل.' },

  // Paywall
  proTagline: { en: 'A few power features fund the app.', ar: 'ميزات إضافية تدعم استمرار التطبيق.' },
  proActiveThanks: { en: 'Active on this device. Thank you for supporting Wafra.', ar: 'مفعّل على هذا الجهاز. شكراً لدعمك وفرة.' },
  trialEndedPaywall: { en: 'Your free trial has ended and tracking is paused. Subscribe to keep Wafra working — your data never leaves your phone either way.', ar: 'انتهت تجربتك المجانية وتوقف التتبع. اشترك لمواصلة استخدام وفرة — بياناتك لا تغادر هاتفك في كل الأحوال.' },
  freeTrialActive: { en: 'FREE TRIAL ACTIVE', ar: 'التجربة المجانية مفعّلة' },
  getPro: { en: 'Get Wafra Pro', ar: 'اشترك في وفرة برو' },
  restorePurchase: { en: 'Restore purchase', ar: 'استعادة الشراء' },
  yearly: { en: 'YEARLY', ar: 'سنوي' },
  monthly: { en: 'MONTHLY', ar: 'شهري' },
  perMonth: { en: 'per month', ar: 'شهرياً' },
  perYear: { en: 'per year · 2 months free', ar: 'سنوياً · شهران مجاناً' },
  featAutoTracking: { en: 'Automatic tracking', ar: 'تتبع تلقائي' },
  featAutoTrackingText: { en: 'Bank SMS and app notifications become transactions, cards and dues by themselves.', ar: 'رسائل البنك والإشعارات تتحول تلقائياً إلى عمليات وبطاقات ومستحقات.' },
  featInsights: { en: 'Insights & subscriptions', ar: 'تحليلات واشتراكات' },
  featInsightsText: { en: 'Auto-detected subscriptions, due-date countdowns, plain-language insights.', ar: 'اكتشاف تلقائي للاشتراكات وتذكير بالمستحقات وتحليلات واضحة.' },
  featSalaryMonths: { en: 'Salary-day months', ar: 'الشهر يبدأ يوم الراتب' },
  featSalaryMonthsText: { en: 'Your money month starts on payday, not the 1st.', ar: 'شهرك المالي يبدأ يوم استلام راتبك.' },
  featBackup: { en: 'Backup & restore', ar: 'نسخ احتياطي واستعادة' },
  featBackupText: { en: 'Move your full history to a new phone with one file.', ar: 'انقل سجلك كاملاً إلى هاتف جديد بملف واحد.' },

  // Onboarding
  obTagline: { en: 'Know where it goes. Watch it grow.', ar: 'اعرف أين تذهب أموالك. وراقبها تنمو.' },
  obSubtitle: { en: 'Your money in AED, tracked automatically. Everything stays on this phone.', ar: 'أموالك تُتتبع تلقائياً. كل شيء يبقى على هاتفك.' },
  getStarted: { en: 'Get started', ar: 'ابدأ الآن' },
  exploreSample: { en: 'Explore with sample data', ar: 'جرّب ببيانات تجريبية' },

  // Hero caption
  saved: { en: 'Saved', ar: 'المدخر' },
  overspent: { en: 'Overspent', ar: 'تجاوزت' },
  soFarThisMonth: { en: 'so far this month', ar: 'حتى الآن هذا الشهر' },
  allTime: { en: 'all time', ar: 'كل الفترات' },
  inWord: { en: 'in', ar: 'في' },
  inMinusOut: { en: 'in minus out', ar: 'الدخل ناقص المصروف' },

  // Insights (stats) screen
  tapToChangePeriod: { en: 'Tap to change period', ar: 'اضغط لتغيير الفترة' },
  projected: { en: 'Projected', ar: 'متوقع' },
  spentLabel: { en: 'Spent', ar: 'المصروف' },
  biggestChangesVs: { en: 'Biggest changes vs', ar: 'أكبر التغيرات مقابل' },
  whereMoneyWent: { en: 'Where the money went', ar: 'أين ذهبت الأموال' },
  spendingByWeekday: { en: 'Spending by weekday', ar: 'الصرف حسب أيام الأسبوع' },
  netWorth6mo: { en: 'Net worth · 6 months', ar: 'صافي الثروة · ٦ أشهر' },
  cashflow6mo: { en: 'Cashflow · 6 months', ar: 'التدفق النقدي · ٦ أشهر' },
  whatNumbersSay: { en: 'What the numbers say', ar: 'ماذا تقول الأرقام' },
  tapMonthToOpen: { en: 'Tap a month to open it', ar: 'اضغط على شهر لفتحه' },

  // Other screens
  transactionsTitle: { en: 'Transactions', ar: 'العمليات' },
  budgetsTitle: { en: 'Budgets', ar: 'الميزانيات' },
  cardsTitle: { en: 'Cards', ar: 'البطاقات' },
  inactiveCards: { en: 'Inactive cards', ar: 'بطاقات غير نشطة' },
  lastUsed: { en: 'Last used', ar: 'آخر استخدام' },
  addTransactionTitle: { en: 'Add transaction', ar: 'إضافة عملية' },
  expenseLabel: { en: 'Expense', ar: 'مصروف' },
  incomeLabel: { en: 'Income', ar: 'دخل' },

  // Home sections
  cardPayments: { en: 'Card payments', ar: 'دفعات البطاقات' },
  upcomingBills: { en: 'Upcoming bills', ar: 'فواتير قادمة' },
  budgetsSection: { en: 'Budgets', ar: 'الميزانيات' },
  recentActivity: { en: 'Recent activity', ar: 'أحدث العمليات' },
  insightsSection: { en: 'Insights', ar: 'ملاحظات' },
  subscriptionWord: { en: 'subscription', ar: 'اشتراك' },
  subscriptionsWord: { en: 'subscriptions', ar: 'اشتراكات' },
  nextWord: { en: 'next', ar: 'التالي' },
  allWord: { en: 'All', ar: 'الكل' },

  // Import screen
  importTitle: { en: 'Import from SMS', ar: 'استيراد من الرسائل' },
  scanFullInbox: { en: 'Scan full inbox', ar: 'فحص كل الرسائل' },
  parsePasted: { en: 'Parse pasted text', ar: 'تحليل النص الملصق' },
  trySample: { en: 'Try sample', ar: 'جرّب مثالاً' },
} as const;

export type StringKey = keyof typeof S;

let lang: Lang = 'en';

export function getLanguage(): Lang {
  return lang;
}

export function setLanguage(l: Lang): void {
  lang = l === 'ar' ? 'ar' : 'en';
}

export function isRTL(): boolean {
  return lang === 'ar';
}

/** Device language → app language (Arabic devices get Arabic). */
export function detectLanguage(): Lang {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale ?? '';
    if (/^ar\b/i.test(locale)) return 'ar';
  } catch {
    // Intl unavailable — default to English.
  }
  return 'en';
}

export function t(key: StringKey): string {
  return S[key][lang] ?? S[key].en;
}
