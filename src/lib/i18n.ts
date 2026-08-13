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
  tabAddHint: {
    en: 'Opens the cash entry form',
    ar: 'يفتح نموذج إضافة عملية نقدية',
  },

  // Common actions
  cancel: { en: 'Cancel', ar: 'إلغاء' },
  back: { en: 'Back', ar: 'رجوع' },
  close: { en: 'Close', ar: 'إغلاق' },
  delete: { en: 'Delete', ar: 'حذف' },
  save: { en: 'Save', ar: 'حفظ' },
  seeAll: { en: 'See all', ar: 'عرض الكل' },
  markPaid: { en: 'Mark paid', ar: 'تم الدفع' },
  remindMe: { en: 'Remind me', ar: 'ذكّرني' },
  report: { en: 'Report', ar: 'التقرير' },
  review: { en: 'Review', ar: 'مراجعة' },
  today: { en: 'Today', ar: 'اليوم' },
  yesterday: { en: 'Yesterday', ar: 'أمس' },
  reportingPeriod: {
    en: 'Reporting period: {period}. Tap to change.',
    ar: 'فترة التقرير: {period}. اضغط للتغيير.',
  },

  // Greetings
  goodMorning: { en: 'Good morning', ar: 'صباح الخير' },
  goodAfternoon: { en: 'Good afternoon', ar: 'مساء الخير' },
  goodEvening: { en: 'Good evening', ar: 'مساء الخير' },

  // Home
  heroSavedCaption: { en: 'Saved so far this month', ar: 'المدخر هذا الشهر' },
  heroNetCaption: { en: 'Net for this period', ar: 'الصافي لهذه الفترة' },
  inLabel: { en: 'In', ar: 'الدخل' },
  outLabel: { en: 'Spent', ar: 'الإنفاق' },
  cashOutLabel: { en: 'Cash out', ar: 'النقد الخارج' },
  cashOutHint: {
    en: 'Money that actually left your accounts, including card payments once.',
    ar: 'الأموال التي خرجت فعلياً من حساباتك، بما فيها دفعات البطاقات مرة واحدة.',
  },
  cashOutBreakdown: {
    en: 'Card repayments {cards} · bank, debit and cash {accounts}',
    ar: 'سداد البطاقات {cards} · البنك والخصم والنقد {accounts}',
  },
  loadingLedger: { en: 'Loading your ledger', ar: 'جارٍ تحميل سجلك المالي' },
  insightsHeader: { en: 'INSIGHTS', ar: 'ملاحظات' },
  budgetsHeader: { en: 'BUDGETS', ar: 'الميزانيات' },
  recentHeader: { en: 'RECENT ACTIVITY', ar: 'أحدث العمليات' },
  manage: { en: 'Manage', ar: 'إدارة' },
  cardPaymentsDue: { en: 'Card payments due', ar: 'دفعات البطاقات المستحقة' },
  paidCardsRecently: { en: 'PAID RECENTLY', ar: 'دُفعت مؤخراً' },
  paidCardsRecentlyHint: {
    en: 'Statements Wafra matched to a card payment.',
    ar: 'كشوف طابقتها وفرة مع دفعة بطاقة.',
  },
  paidStatementDue: { en: 'Statement due {date} · paid', ar: 'كشف مستحق {date} · مدفوع' },
  trialEndedBanner: { en: 'Trial ended · tracking paused', ar: 'انتهت التجربة · توقف التتبع' },
  trialEndedBannerSub: { en: 'Subscribe to keep importing your bank SMS', ar: 'اشترك لمواصلة قراءة رسائل البنك' },
  turnOnTracking: { en: 'Turn on automatic tracking', ar: 'فعّل التتبع التلقائي' },
  trackingPrivacy: { en: 'Wafra reads bank SMS on this device only', ar: 'وفرة تقرأ رسائل البنك على هذا الجهاز فقط' },
  automaticCapture: { en: 'Automatic capture', ar: 'الالتقاط التلقائي' },
  captureAndroidOn: {
    en: 'Watching bank alerts',
    ar: 'يراقب تنبيهات البنك',
  },
  captureAndroidPrivate: {
    en: 'Parsed here · nothing uploaded',
    ar: 'تُحلَّل هنا · لا يُرفع شيء',
  },
  captureIosOn: {
    en: 'Shortcut connected · syncing silently',
    ar: 'الاختصار متصل · مزامنة صامتة',
  },
  captureIosNeedsTest: {
    en: 'Connected · finish the capture test',
    ar: 'متصل · أكمل اختبار الالتقاط',
  },
  captureIosPipeReady: {
    en: 'Private pipe ready · waiting for the first bank alert',
    ar: 'المسار الخاص جاهز · بانتظار أول تنبيه بنكي',
  },
  captureIosOff: {
    en: 'Connect your Shortcut once',
    ar: 'اربط الاختصار مرة واحدة',
  },
  captureIosRevoked: {
    en: 'This iPhone was removed · capture stopped',
    ar: 'أُزيل هذا الآيفون · توقّف الالتقاط',
  },
  captureIosRevokedDetail: {
    en: 'Another device removed it from your vault. Set it up again to resume.',
    ar: 'أزاله جهاز آخر من خزنتك. أعد الإعداد لاستئناف الالتقاط.',
  },
  captureRefreshFailed: {
    en: 'Could not refresh. Pull down to try again.',
    ar: 'تعذّر التحديث. اسحب للأسفل للمحاولة مرة أخرى.',
  },
  capturePhoneOnly: {
    en: 'Automatic capture runs in the phone app',
    ar: 'يعمل الالتقاط التلقائي في تطبيق الهاتف',
  },
  captureReady: { en: 'ON', ar: 'مفعّل' },
  captureFinish: { en: 'FINISH', ar: 'أكمل' },
  captureVerify: { en: 'VERIFY', ar: 'تحقق' },
  captureEnable: { en: 'ENABLE', ar: 'فعّل' },
  capturePaused: { en: 'Tracking paused', ar: 'توقف التتبع' },
  pausedBadge: { en: 'PAUSED', ar: 'متوقف' },
  captureChecking: { en: 'Checking capture…', ar: 'جارٍ التحقق من الالتقاط…' },
  captureSyncNow: { en: 'Up to date · new alerts file themselves', ar: 'محدّث · تُسجّل التنبيهات الجديدة تلقائياً' },
  captureIosSetupDetail: { en: 'One-time setup in Apple Shortcuts', ar: 'إعداد لمرة واحدة في اختصارات آبل' },
  captureLatest: { en: 'Latest filed {date}', ar: 'آخر عملية مسجّلة {date}' },
  emptyPeriodBody: { en: 'Pull down to check for new bank activity. One transaction is enough to start the month.', ar: 'اسحب للأسفل للتحقق من نشاط بنكي جديد. تكفي عملية واحدة لبدء الشهر.' },

  // Structured global-alert review. These items are deliberately described as
  // possible activity, never as parser failures, and none of this copy claims
  // an item has entered the ledger.
  reviewAlertsTitle: { en: 'Alerts to review', ar: 'تنبيهات للمراجعة' },
  reviewAlertsHomeCount: {
    en: '{count} possible transaction{s} need review',
    ar: '{count} تنبيه مالي للمراجعة',
  },
  reviewAlertsSettingsCount: {
    en: '{count} waiting for review',
    ar: '{count} تنبيه قيد المراجعة',
  },
  reviewAlertsNone: { en: 'Nothing waiting', ar: 'لا شيء قيد المراجعة' },
  reviewAlertsIntro: {
    en: 'Wafra found possible financial activity in bank alerts it cannot import automatically yet. Nothing here has been added to your ledger.',
    ar: 'وجدت وفرة نشاطاً مالياً محتملاً في تنبيهات بنكية لا يمكن استيرادها تلقائياً بعد. لم يُضف أي شيء هنا إلى سجلك.',
  },
  reviewAlertsPrivacy: {
    en: 'Only a structured summary is kept here. The bank-alert text is not stored.',
    ar: 'يُحفظ هنا ملخص منظّم فقط. لا يُحفظ نص التنبيه البنكي.',
  },
  reviewAlertsEmptyTitle: { en: 'All clear', ar: 'تمت مراجعة كل شيء' },
  reviewAlertsEmptyBody: {
    en: 'Possible transactions that need a decision will appear here.',
    ar: 'ستظهر هنا العمليات المحتملة التي تحتاج إلى قرارك.',
  },
  reviewAlertPossiblePurchase: { en: 'Possible purchase', ar: 'عملية شراء محتملة' },
  reviewAlertPossibleTransfer: { en: 'Possible transfer', ar: 'تحويل محتمل' },
  reviewAlertPossibleCash: { en: 'Possible cash withdrawal', ar: 'سحب نقدي محتمل' },
  reviewAlertPossibleRefund: { en: 'Possible refund', ar: 'استرداد محتمل' },
  reviewAlertPossibleFee: { en: 'Possible fee', ar: 'رسوم محتملة' },
  reviewAlertPossibleUtility: { en: 'Possible utility payment', ar: 'دفعة خدمات محتملة' },
  reviewAlertPossibleRecurring: { en: 'Possible recurring payment', ar: 'دفعة متكررة محتملة' },
  reviewAlertMoneyOut: { en: 'Money out', ar: 'مبلغ خارج' },
  reviewAlertMoneyIn: { en: 'Money in', ar: 'مبلغ داخل' },
  reviewAlertCardEnding: { en: 'Card ending {last4}', ar: 'بطاقة تنتهي بـ {last4}' },
  reviewAlertAccountEnding: { en: 'Account ending {last4}', ar: 'حساب ينتهي بـ {last4}' },
  reviewAlertWalletEnding: { en: 'Wallet ending {last4}', ar: 'محفظة تنتهي بـ {last4}' },
  reviewAlertDismissQuestion: { en: 'Dismiss this alert?', ar: 'تجاهل هذا التنبيه؟' },
  reviewAlertDismissBody: {
    en: 'It will remain outside your ledger and will not appear in this review list again.',
    ar: 'سيبقى خارج سجلك ولن يظهر في قائمة المراجعة مرة أخرى.',
  },
  reviewAlertDismissed: { en: 'Alert dismissed', ar: 'تم تجاهل التنبيه' },
  reviewAlertDismissFailed: {
    en: 'Could not save that change. The alert may return next time.',
    ar: 'تعذّر حفظ هذا التغيير. قد يعود التنبيه في المرة القادمة.',
  },
  reviewAlertReview: { en: 'Check & add', ar: 'تحقق وأضف' },
  reviewAlertAdd: { en: 'Add to Wafra', ar: 'أضف إلى وفرة' },
  reviewAlertAddHint: {
    en: 'Review the category, account, direction and date before adding it.',
    ar: 'راجع التصنيف والحساب والاتجاه والتاريخ قبل إضافتها.',
  },
  reviewAlertAddTitle: { en: 'Review transaction', ar: 'مراجعة العملية' },
  reviewAlertAdded: { en: 'Transaction added', ar: 'تمت إضافة العملية' },
  reviewAlertAddFailed: {
    en: 'Could not add this alert. Check its currency, account and date.',
    ar: 'تعذّرت إضافة هذا التنبيه. تحقق من العملة والحساب والتاريخ.',
  },
  reviewAlertChooseCategory: {
    en: 'Choose the category before adding this alert.',
    ar: 'اختر التصنيف قبل إضافة هذا التنبيه.',
  },
  reviewAlertChooseAccount: {
    en: 'Choose the account this alert belongs to.',
    ar: 'اختر الحساب الذي ينتمي إليه هذا التنبيه.',
  },
  reviewAlertCreateAccount: {
    en: 'Create an account in Wallet first',
    ar: 'أنشئ حساباً في المحفظة أولاً',
  },
  savingSecurely: { en: 'Saving securely…', ar: 'جارٍ الحفظ بأمان…' },
  reviewAlertOwnAccounts: {
    en: 'This moved money between my own accounts',
    ar: 'هذا تحويل بين حساباتي الشخصية',
  },
  reviewAlertDateA11y: {
    en: 'Transaction date in year month day format',
    ar: 'تاريخ العملية بصيغة سنة شهر يوم',
  },

  // Foreign-currency activity
  foreignActivity: { en: 'Foreign activity', ar: 'العمليات بالعملات الأجنبية' },
  foreignSpending: { en: 'Foreign spending', ar: 'الإنفاق بالعملات الأجنبية' },
  foreignSpendingSubtitle: {
    en: 'Review what you paid abroad in the original and ledger currencies.',
    ar: 'راجع ما دفعته خارج الدولة بالعملة الأصلية وعملة السجل.',
  },
  searchForeignSpending: { en: 'Search merchant or currency', ar: 'ابحث عن تاجر أو عملة' },
  foreignActivityCaption: {
    en: '{count} charge{s} · {currencies} currenc{ending}',
    ar: '{count} عملية · {currencies} عملة',
  },
  foreignConvertedTotal: {
    en: '{currency} total after conversion',
    ar: 'الإجمالي بعملة {currency} بعد التحويل',
  },
  foreignOriginalsKept: {
    en: 'Original amounts stay beside every {currency} conversion.',
    ar: 'يبقى المبلغ الأصلي بجانب كل تحويل إلى {currency}.',
  },
  currencyBreakdown: { en: 'Currency breakdown', ar: 'تفصيل العملات' },
  conversionQuality: { en: 'Conversion quality', ar: 'جودة التحويل' },
  bankQuoted: { en: 'Bank quoted', ar: 'حسب البنك' },
  referenceRate: { en: 'Reference rate', ar: 'سعر مرجعي' },
  offlineEstimate: { en: 'Offline estimate', ar: 'تقدير دون اتصال' },
  foreignRecent: { en: 'Recent foreign charges', ar: 'أحدث العمليات الأجنبية' },
  noForeignActivity: {
    en: 'No foreign-currency charges in this period.',
    ar: 'لا توجد عمليات بعملة أجنبية في هذه الفترة.',
  },

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
  dueAcrossCards: { en: 'Due across cards', ar: 'المستحق على البطاقات' },
  monthlySpendOnly: { en: 'tracking spend only', ar: 'تتبع المصروف فقط' },
  detectedHint: { en: 'Found automatically from your charges', ar: 'مكتشفة تلقائياً من عملياتك' },
  stoppedSubs: { en: 'Stopped subscriptions', ar: 'اشتراكات متوقفة' },
  stoppedSubsHint: { en: 'No charges for over two cycles — most likely cancelled.', ar: 'لا توجد عمليات خصم لدورتين — على الأغلب ملغاة.' },
  utilitiesHeader: { en: 'Utilities & fixed bills', ar: 'المرافق والفواتير الثابتة' },
  loansHeader: { en: 'Loans & instalments', ar: 'القروض والأقساط' },
  otherRecurringHeader: { en: 'Other repeat payments', ar: 'مدفوعات متكررة أخرى' },
  otherRecurringHint: {
    en: 'Places you pay on a regular cycle. Not bills — long-press one to stop tracking it.',
    ar: 'جهات تدفع لها بشكل منتظم. ليست فواتير — اضغط مطولاً لإيقاف تتبعها.',
  },
  loansHint: { en: 'Fixed repayments detected from your bank messages. Wafra shows what you have paid so far — it cannot see the loan term or balance.', ar: 'أقساط ثابتة مكتشفة من رسائل البنك. يعرض وفرة ما دفعته حتى الآن فقط — لا يمكنه معرفة مدة القرض أو رصيده.' },
  paidSoFar: { en: 'Paid so far', ar: 'المدفوع حتى الآن' },
  payingFor: { en: 'Paying for', ar: 'يُدفع منذ' },
  instalment: { en: 'Instalment', ar: 'القسط' },
  payments: { en: 'Payments', ar: 'عدد الدفعات' },
  utilitiesHint: { en: 'Electricity, internet, rent and other regular payments that recur every month.', ar: 'الكهرباء والإنترنت والإيجار ودفعات شهرية أخرى.' },
  subscribedFor: { en: 'Subscribed for', ar: 'مشترك منذ' },
  trackingSince: { en: 'Tracking since', ar: 'قيد المتابعة منذ' },
  charges: { en: 'Charges', ar: 'عدد الدفعات' },
  totalPaid: { en: 'Total paid', ar: 'إجمالي المدفوع' },
  paidWith: { en: 'Paid with', ar: 'الدفع عبر' },
  paymentInstrumentNotStated: {
    en: 'Card or account not stated in the bank alert',
    ar: 'لم يحدد التنبيه البنكي البطاقة أو الحساب',
  },
  paymentInstrumentMissingCount: {
    en: '{count} payment{s} did not state a card or account',
    ar: '{count} دفعة لم يحدد تنبيهها البطاقة أو الحساب',
  },
  history: { en: 'History', ar: 'السجل' },
  paymentHistory: { en: 'Payment history', ar: 'سجل الدفعات' },
  notASubscription: { en: 'Not a subscription', ar: 'ليس اشتراكاً' },
  noSubscriptionsTitle: { en: 'No subscriptions detected yet', ar: 'لم تُكتشف اشتراكات بعد' },
  noSubscriptionsBody: { en: 'Import bank activity and repeat charges will appear here.', ar: 'استورد نشاطك البنكي وستظهر العمليات المتكررة هنا.' },
  noUtilitiesTitle: { en: 'No utilities yet', ar: 'لا فواتير مرافق بعد' },
  noUtilitiesBody: { en: 'Tap + to track DEWA, rent, or any monthly payment. Detected charges appear automatically.', ar: 'اضغط + لتتبع ديوا أو الإيجار أو أي دفعة شهرية. تظهر العمليات المكتشفة تلقائياً.' },
  newReminder: { en: 'New reminder', ar: 'تذكير جديد' },
  reminderNamePlaceholder: { en: 'Name (e.g. DEWA, Netflix, Rent)', ar: 'الاسم (مثل ديوا أو نتفلكس أو الإيجار)' },
  amount: { en: 'Amount', ar: 'المبلغ' },
  day: { en: 'Day', ar: 'اليوم' },
  saveReminder: { en: 'Save reminder', ar: 'حفظ التذكير' },
  deleteReminderTitle: { en: 'Delete reminder?', ar: 'حذف التذكير؟' },
  deleteReminderBody: { en: '“{title}” will no longer be tracked.', ar: 'لن تتم متابعة «{title}» بعد الآن.' },
  remove: { en: 'Remove', ar: 'إزالة' },
  removeSubscriptionBody: { en: '“{title}” will leave subscriptions and the monthly total.', ar: 'سيُزال «{title}» من الاشتراكات والإجمالي الشهري.' },
  markBillPaidTitle: { en: 'Mark “{title}” as paid?', ar: 'تعليم «{title}» كمدفوع؟' },
  accountPaymentTitle: { en: '{name} payment', ar: 'دفعة {name}' },
  subscriptionUnderMonth: { en: 'under a month', ar: 'أقل من شهر' },
  subscriptionMonths: { en: '{count} month{s}', ar: '{count} شهر' },
  subscriptionYearsMonths: { en: '{years} yr {months} mo', ar: '{years} سنة و{months} شهر' },
  subscriptionYears: { en: '{count} year{s}', ar: '{count} سنة' },
  priceUp: { en: 'price up', ar: 'ارتفع السعر' },
  cadenceWeekly: { en: 'Weekly', ar: 'أسبوعي' },
  cadenceMonthly: { en: 'Monthly', ar: 'شهري' },
  cadenceYearly: { en: 'Yearly', ar: 'سنوي' },
  cadenceAsNeeded: { en: 'As needed', ar: 'عند الحاجة' },
  stoppedLast: { en: 'stopped · last {date}', ar: 'متوقف · آخر خصم {date}' },
  stoppedLastCharged: { en: 'stopped · last charged {date}', ar: 'متوقف · آخر خصم {date}' },
  cadenceNext: { en: '{cadence} · next {date} ({days}d)', ar: '{cadence} · التالي {date} (خلال {days} يوم)' },
  cadenceScheduleList: {
    en: '{cadence} · {date} · {when}',
    ar: '{cadence} · {date} · {when}',
  },
  asNeededScheduleList: {
    en: 'As needed · last paid {date}',
    ar: 'عند الحاجة · آخر دفعة {date}',
  },
  scheduleInTwoDays: { en: 'in 2 days', ar: 'خلال يومين' },
  scheduleInFewDays: { en: 'in {days} days', ar: 'خلال {days} أيام' },
  scheduleInManyDays: { en: 'in {days} days', ar: 'خلال {days} يوماً' },
  cadenceExpectedAgo: { en: '{cadence} · expected {days}d ago', ar: '{cadence} · كان متوقعاً قبل {days} يوم' },
  perMonthShort: { en: '/mo', ar: 'شهرياً' },
  monthlyTotal: {
    en: '{amount} / month',
    ar: '\u2066{amount}\u2069 · شهرياً',
  },
  perYearShort: { en: '/yr', ar: 'سنوياً' },
  perWeekShort: { en: '/wk', ar: 'أسبوعياً' },
  remindAboutA11y: { en: 'Remind me about {title}', ar: 'ذكّرني بـ {title}' },
  detailCadenceMonthly: { en: '{cadence} · {amount}/mo', ar: '{cadence} · {amount} شهرياً' },
  olderCharges: { en: '+ {count} older charges', ar: '+ {count} عمليات خصم أقدم' },
  recurringDetected: { en: 'Recurring · detected', ar: 'متكرر · مكتشف' },
  recurringMeta: { en: '{cadence} · next {date} · {when}', ar: '{cadence} · التالي {date} · {when}' },
  recurringStableVerdict: {
    en: '{amount} every {period}, {count} month{s} running — nothing to watch here.',
    ar: '{amount} كل {period}، مستمر منذ {count} شهر — لا شيء يستدعي المراقبة.',
  },
  recurringPriceUpVerdict: {
    en: 'The last charge was {last} against a usual {usual}. The price went up.',
    ar: 'آخر خصم كان {last} مقابل {usual} معتادة. ارتفع السعر.',
  },
  cadencePeriodWeek: { en: 'week', ar: 'أسبوع' },
  cadencePeriodMonth: { en: 'month', ar: 'شهر' },
  cadencePeriodYear: { en: 'year', ar: 'سنة' },
  reminderDayBeforeBody: {
    en: 'You’ll hear about this the day before {date}.',
    ar: 'سنذكّرك بها قبل {date} بيوم.',
  },
  stopRecurringBody: {
    en: '{title} will stop being tracked as one, and stops counting toward your monthly commitments.',
    ar: 'سيتوقف تتبع {title} كعملية متكررة، ولن تُحتسب ضمن الالتزامات الشهرية.',
  },
  notRecurring: { en: 'Not recurring', ar: 'ليست متكررة' },
  paidFrom: { en: 'Paid from', ar: 'الدفع من' },
  unknownAccount: { en: 'Unknown account', ar: 'حساب غير معروف' },
  paid: { en: 'Paid', ar: 'مدفوع' },
  overdueDays: { en: '{days}d overdue', ar: 'متأخر {days} يوم' },
  lateDays: { en: '{days}d late', ar: 'متأخر {days} يوم' },
  daysShort: { en: '{days}d', ar: '{days} يوم' },
  dueToday: { en: 'Due today', ar: 'مستحق اليوم' },
  dueInDays: { en: 'Due in {days}d', ar: 'مستحق خلال {days} يوم' },
  longPressDeleteReminder: { en: 'Long-press a reminder to delete it.', ar: 'اضغط مطولاً على التذكير لحذفه.' },

  // Wallet
  walletTitle: { en: 'Wallet', ar: 'المحفظة' },
  availableBalances: { en: 'Available across accounts', ar: 'المتاح في الحسابات' },
  balanceCoverage: {
    en: 'Reliable balances for {known} of {total} active accounts',
    ar: 'أرصدة موثوقة لـ {known} من أصل {total} حسابات نشطة',
  },
  addAccountForBalances: {
    en: 'Add an account to see its latest reported balance.',
    ar: 'أضف حساباً لعرض أحدث رصيد وارد من البنك.',
  },
  paidFromAccounts: { en: 'Paid from accounts this month', ar: 'المدفوع من الحسابات هذا الشهر' },
  netWorth: { en: 'Net worth', ar: 'صافي الثروة' },
  estimatedNetWorth: { en: 'Estimated net worth', ar: 'صافي الثروة التقديري' },
  partialEstimate: { en: 'Partial estimate', ar: 'تقدير جزئي' },
  allAccountsIncluded: { en: 'All active accounts included', ar: 'تم تضمين كل الحسابات النشطة' },
  noActiveAccounts: { en: 'No active accounts yet', ar: 'لا توجد حسابات نشطة بعد' },
  addAccountForEstimate: {
    en: 'Use + to add an account and start your estimate.',
    ar: 'استخدم + لإضافة حساب وبدء التقدير.',
  },
  knownBalances: { en: 'Known balances', ar: 'الأرصدة المعروفة' },
  amountsOwed: { en: 'Amounts owed', ar: 'المبالغ المستحقة' },
  netWorthCoverage: {
    en: '{known} of {total} active accounts included',
    ar: 'تم تضمين {known} من أصل {total} حسابات نشطة',
  },
  netWorthMissing: {
    en: 'Accounts excluded until a reliable balance arrives: {count}',
    ar: 'حسابات مستبعدة حتى يتوفر رصيد موثوق: {count}',
  },
  howNetWorthCalculated: { en: 'How this is calculated', ar: 'كيف يتم احتسابه' },
  netWorthExplanation: {
    en: 'Wafra adds the latest bank-reported balances and balances you track manually, then subtracts credit-card amounts owed. Inactive accounts and accounts without a reliable balance are left out.',
    ar: 'تجمع وفرة أحدث الأرصدة الواردة من البنك والأرصدة التي تتابعها يدوياً، ثم تطرح المبالغ المستحقة على البطاقات الائتمانية. لا تُحتسب الحسابات غير النشطة أو التي لا يتوفر لها رصيد موثوق.',
  },
  ledgerTrend6mo: { en: 'Recorded movement · 6 months', ar: 'حركة السجل · ٦ أشهر' },
  ledgerTrendExplanation: {
    en: 'From opening balances and filed activity—not the estimate above.',
    ar: 'استناداً إلى الأرصدة الافتتاحية والعمليات المسجلة، وليس التقدير أعلاه.',
  },
  moreCards: { en: 'View more cards · {count}', ar: 'عرض بطاقات أخرى · {count}' },
  cardsHeader: { en: 'Cards', ar: 'البطاقات' },
  accountsHeader: { en: 'Accounts', ar: 'الحسابات' },
  inactiveHeader: { en: 'Inactive', ar: 'غير نشطة' },
  goalsHeader: { en: 'Savings goals', ar: 'أهداف الادخار' },
  newGoal: { en: '+ New goal', ar: '+ هدف جديد' },
  outstanding: { en: 'outstanding', ar: 'مستحق' },
  owed: { en: 'owed', ar: 'المستحق عليك' },
  nothingSpentThisMonth: { en: 'nothing spent this month', ar: 'لا مصروف هذا الشهر' },
  perBankSms: { en: 'per bank SMS', ar: 'حسب رسالة البنك' },
  noBalanceYet: { en: 'no balance SMS yet', ar: 'لا رسالة رصيد بعد' },
  trackedManually: { en: 'Tracked manually', ar: 'يُتابع يدويًا' },
  // The other branch added a second `reminderSet` here, reading "Reminder on",
  // for the chip on a Bills row. There is already a `reminderSet` further down
  // ("Reminder set") used by the two confirmation alerts, and a duplicate key
  // in an object literal is not an error at runtime — the later one silently
  // wins — so the chip would have read the alert's wording anyway while `tsc`
  // failed the build with TS1117. One key, one string: "Reminder set" is right
  // on a row that has one and right as the title of the alert that sets it.
  recurringHint: {
    en: 'Tap a row for its charge history, or to set a reminder.',
    ar: 'اضغط على أي صف لعرض سجل الخصومات أو لضبط تذكير.',
  },
  improveAccuracy: { en: 'Improve accuracy', ar: 'تحسين الدقة' },
  // The permanent way into /categorise. Home's prompt has a floor under it, so
  // without this row a user who sorts down to two merchants is locked out of
  // the screen mid-job and left fixing rows one at a time — the exact chore
  // the screen exists to replace.
  sortShops: { en: 'Sort your shops', ar: 'صنّف متاجرك' },
  sortShopsCount: {
    en: '{count} shop{s} with no category yet',
    ar: '{count} متجر بلا تصنيف حتى الآن',
  },
  sortShopsNone: { en: 'Every shop has a category', ar: 'كل متجر له تصنيف' },
  improveAccuracyHint: {
    en: 'Bank messages the app is not reading well. Some have no merchant name at all; most read the name correctly but have no category yet. Share the list with the developer and the next update will handle them. Long account numbers are masked.',
    ar: 'رسائل بنكية لا يقرأها التطبيق جيداً. بعضها بلا اسم متجر إطلاقاً، ومعظمها يُقرأ الاسم فيه بشكل صحيح لكن بلا تصنيف بعد. شارك القائمة مع المطوّر وسيعالجها التحديث القادم. الأرقام الطويلة مخفية.',
  },
  couldNotRead: { en: 'Could not read', ar: 'تعذّرت القراءة' },
  noCategoryYet: { en: 'Read, but no category', ar: 'مقروءة بلا تصنيف' },
  shareUnrecognized: { en: 'Share formats', ar: 'مشاركة الصيغ' },
  readAs: { en: 'Read as', ar: 'قُرئت كـ' },
  noUnrecognized: { en: 'Everything reads clean', ar: 'كل الرسائل مقروءة' },
  noUnrecognizedText: {
    en: 'No unrecognized bank formats in your data. Rows appear here after a scan when the parser has to guess.',
    ar: 'لا توجد صيغ غير معروفة في بياناتك. تظهر الرسائل هنا بعد الفحص عندما يضطر التطبيق للتخمين.',
  },
  // Zero unread formats means two opposite things, and the app used to report
  // the good one either way. On iPhone the relay drops the message text before
  // the row reaches the phone, so the check can never find anything and
  // "Everything reads clean" was a verdict on a test that never ran. Private
  // mode does the same on Android, by the user's own choice. See
  // noFormatsReason() in lib/accuracy.ts.
  formatsNotKeptRow: {
    en: 'Card diagnostic · message text is not kept on this phone',
    ar: 'تشخيص البطاقات · لا يُحتفظ بنص الرسائل على هذا الهاتف',
  },
  formatsNotKeptRelay: {
    en: 'This iPhone never receives the text of a bank message. The relay reads each one, sends only the figures it parsed, and discards the rest — so the app cannot tell you which formats it is misreading, and an empty list here is not a clean bill of health. The card diagnostic below still works: it reports what the ledger did with every card row.',
    ar: 'لا يستقبل هذا الآيفون نص الرسالة البنكية إطلاقاً. يقرأ الوسيط كل رسالة ويرسل الأرقام التي استخرجها فقط ثم يتخلص من الباقي، لذا لا يستطيع التطبيق إخبارك بالصيغ التي يخطئ في قراءتها، وخلوّ هذه القائمة ليس دليلاً على سلامة القراءة. أما تشخيص البطاقات بالأسفل فيعمل: يعرض ما فعله السجل بكل عملية مرتبطة ببطاقة.',
  },
  formatsNotKeptPrivate: {
    en: 'Private mode removed the retained message text and keeps new imports from storing any, so the app cannot tell you which formats it is misreading. An empty list here is not a clean bill of health. The card diagnostic below still works: it reports what the ledger did with every card row.',
    ar: 'أزال الوضع الخاص نصوص الرسائل المحفوظة ويمنع عمليات الاستيراد الجديدة من حفظ أي منها، لذا لا يستطيع التطبيق إخبارك بالصيغ التي يخطئ في قراءتها، وخلوّ هذه القائمة ليس دليلاً على سلامة القراءة. أما تشخيص البطاقات بالأسفل فيعمل: يعرض ما فعله السجل بكل عملية مرتبطة ببطاقة.',
  },
  // ── the phone measuring its own parser ──
  //
  // The only way anyone ever learned the parser was failing was a user writing
  // in. Two did; a third never will. These are counts and not a percentage on
  // purpose: "492 of 505" can be checked and acted on, "97% accurate" can only
  // be believed or not. Every sentence names its own denominator, and
  // `coverageSkipped` says out loud what was kept out of it — a metric that
  // counts correct behaviour as failure gets dismissed once and is then worth
  // less than nothing. See parserCoverage() in lib/accuracy.ts.
  coverageHeading: {
    en: 'How much of your bank this reads',
    ar: 'ما تقرأه وفرة من رسائل بنكك',
  },
  coverageShops: {
    en: 'Wafra read {imported} bank message{s} into this ledger, and named the shop in {named} of the {measured} purchases that should carry a name.',
    ar: 'قرأت وفرة {imported} رسالة بنكية إلى هذا السجل، وتعرّفت على اسم المتجر في {named} من {measured} عملية شراء يُفترض أن تحمل اسماً.',
  },
  coverageNoShops: {
    en: 'Wafra read {imported} bank message{s} into this ledger, and none of them is a purchase with a shop to name — they are all transfers, card payments and the like.',
    ar: 'قرأت وفرة {imported} رسالة بنكية إلى هذا السجل، وليس بينها عملية شراء يُفترض أن تحمل اسم متجر — كلها تحويلات ودفعات بطاقات وما شابهها.',
  },
  coverageCategories: {
    en: 'Of the {categoryMeasured} purchases whose category it was actually asked for, it filed {categorised} under a real category.',
    ar: 'ومن بين {categoryMeasured} عملية شراء سُئلت وفرة عن تصنيفها فعلاً، وضعت {categorised} تحت تصنيف حقيقي.',
  },
  // Without this line the screen loses rows between two sentences: "named the
  // shop in 100 of 100" followed by "of the 60 it was asked about" reads as a
  // typo, and the 40 pinned merchants are never accounted for anywhere.
  //
  // It cannot say "the other" — `coverageSkipped` below already does, and once
  // every measured row is decided the categories line is hidden, leaving this
  // one to claim "the other 60" of a 60 it was never counting against. Two
  // sentences saying "the other N" about different sets is how 60 + 60 + 40
  // came to be read against 100 messages.
  coverageDecided: {
    en: 'You have already answered for {decided} of them yourself — a shop you pinned, or an entry you filed by hand — so Wafra is not scored on those.',
    ar: 'وقد أجبت بنفسك عن {decided} منها — متجر ثبّتّه أو عملية صنّفتها بيدك — فلا تُحاسَب وفرة عليها.',
  },
  coverageSkipped: {
    en: 'A further {skipped} messages are transfers, card payments, ATM withdrawals, fees and money coming in. These are not shop purchases whose merchant or category Wafra needs to infer, so they are left out of both counts rather than counted as failures.',
    ar: 'وهناك {skipped} رسالة أخرى هي تحويلات ودفعات بطاقات وسحوبات صراف ورسوم ومبالغ واردة. ليست هذه مشتريات من متجر تحتاج وفرة إلى استنتاج اسمه أو تصنيفه، لذا تُستثنى من العدّين بدل أن تُحسب أخطاءً.',
  },
  coverageNoText: {
    en: 'The misses are counted here, but the messages behind them were never kept on this phone, so they cannot be listed below or shared.',
    ar: 'الأخطاء محسوبة هنا، لكن الرسائل التي وراءها لم تُحفظ على هذا الهاتف إطلاقاً، فلا يمكن عرضها بالأسفل ولا مشاركتها.',
  },
  coverageNothingYet: {
    en: 'No bank message has been read into this ledger yet, so there is nothing to measure.',
    ar: 'لم تُقرأ أي رسالة بنكية إلى هذا السجل بعد، فلا يوجد ما يُقاس.',
  },
  // Sort merchants — the other half of the accuracy problem, and the half the
  // developer cannot fix from here. "Improve accuracy" above collects message
  // FORMATS the parser could not read and mails them to us. This one is for
  // rows the parser read perfectly: the shop's name is right, and no rule list
  // will ever know what "AL BAIT ALHAMAWI SUP" sells. Only the user knows, so
  // the app asks them once per shop instead of shipping another release.
  categoriseMerchants: { en: 'Sort merchants', ar: 'تصنيف المتاجر' },
  categoriseIntro: {
    en: 'Wafra reads the shop name off your bank alert but cannot know what it sells. Choose once and every entry from that shop moves with it — the ones already in your ledger, and the ones still to come.',
    ar: 'تقرأ وفرة اسم المتجر من تنبيه البنك لكنها لا تعرف ماذا يبيع. اختر التصنيف مرة واحدة وتنتقل معه كل عمليات هذا المتجر: الموجودة في سجلك والقادمة لاحقاً.',
  },
  categoriseRemaining: {
    en: '{count} merchant{s} · {rows} entr{ending}',
    ar: '{count} متجر · {rows} عملية',
  },
  categoriseEntries: {
    en: '{count} entr{ending} · last {date}',
    ar: '{count} عملية · آخرها {date}',
  },
  categoriseAssigned: {
    en: '{count} entr{ending} moved to {category}',
    ar: 'نُقلت {count} عملية إلى {category}',
  },
  categoriseChooseA11y: {
    en: 'Choose a category for {merchant}',
    ar: 'اختر تصنيفاً لـ {merchant}',
  },
  categoriseDone: { en: 'Every merchant is sorted', ar: 'تم تصنيف كل المتاجر' },
  categoriseDoneBody: {
    en: 'Nothing is sitting in Other with a shop name behind it. New shops turn up here as you spend at them.',
    ar: 'لم يبق شيء في «أخرى» خلفه اسم متجر. ستظهر المتاجر الجديدة هنا عند الإنفاق فيها.',
  },
  categoriseDoneCount: {
    en: 'You sorted {count} entr{ending} just now.',
    ar: 'صنّفت {count} عملية للتو.',
  },
  // The Home prompt. Same floor and the same reasoning as the unread-formats
  // row above it: below three merchants this says nothing at all.
  uncategorisedMerchantCount: {
    en: '{count} merchant{s} with no category',
    ar: '{count} متجر بلا تصنيف',
  },
  uncategorisedMerchantHint: {
    en: 'One tap files every entry from that shop, past and future.',
    ar: 'ضغطة واحدة تصنّف كل عمليات المتجر، السابقة والقادمة.',
  },
  categoriseMerchantsA11y: {
    en: 'Sort {count} merchants that have no category',
    ar: 'تصنيف {count} متجر بلا تصنيف',
  },
  spentThisMonthCaption: { en: 'spent this month', ar: 'مصروف هذا الشهر' },
  cardSpentThisMonth: {
    en: '{amount} spent this month',
    ar: 'مصروف الشهر \u2066{amount}\u2069',
  },
  longPressHint: { en: 'Long-press a card or account to hide or remove it', ar: 'اضغط مطولاً على بطاقة أو حساب لإخفائه أو حذفه' },
  walletCurrencies: { en: 'Currencies', ar: 'العملات' },
  currencyActivityTitle: { en: 'Foreign activity', ar: 'النشاط بالعملات الأجنبية' },
  currencyActivityDetail: { en: 'Original amounts kept with every charge', ar: 'يُحفظ المبلغ الأصلي مع كل عملية' },
  chargeWord: { en: 'charge', ar: 'عملية' },
  chargesWord: { en: 'charges', ar: 'عمليات' },
  cardDetail: { en: 'Card detail', ar: 'تفاصيل البطاقة' },
  credit: { en: 'Credit', ar: 'ائتمانية' },
  debit: { en: 'Debit', ar: 'خصم' },
  stillOwed: { en: 'Still owed', ar: 'المتبقي عليك' },
  openStatements: { en: '{count} open statement{s}', ar: '{count} كشف مفتوح' },
  statements: { en: 'Statements', ar: 'كشوف الحساب' },
  dueDate: { en: 'Due {date}', ar: 'مستحق {date}' },
  settled: { en: 'Settled', ar: 'مسدّد' },
  percentPaid: { en: '{percent}% paid', ar: 'دُفع {percent}٪' },
  paymentsMade: { en: 'Payments made', ar: 'الدفعات المسددة' },
  reminderSet: { en: 'Reminder set', ar: 'تم ضبط التذكير' },
  cardReminderBody: { en: 'You will be reminded three days before {date}, and again on the day.', ar: 'سنذكّرك قبل {date} بثلاثة أيام، ومرة أخرى في يوم الاستحقاق.' },
  fileCardPaymentBody: { en: 'Files a {amount} payment to {name} today.', ar: 'يسجّل دفعة بقيمة {amount} إلى {name} اليوم.' },
  paidOfTotal: { en: 'Paid {paid} of {total}', ar: 'دُفع {paid} من {total}' },
  minimumShort: { en: 'Min {amount}', ar: 'الحد الأدنى {amount}' },
  minimumDueLabel: { en: 'Minimum due', ar: 'الحد الأدنى' },
  card: { en: 'Card', ar: 'البطاقة' },
  matched: { en: 'Matched', ar: 'المطابقة' },
  chargesAcross: { en: '{amount} across {count} charge{s}', ar: '{amount} عبر {count} عملية' },
  matchedPayments: { en: '{count} payment{s} matched oldest-first to this card’s statements.', ar: 'طابقت {count} دفعة كشوف هذه البطاقة من الأقدم إلى الأحدث.' },

  // Settings
  settingsTitle: { en: 'Settings', ar: 'الإعدادات' },
  trustedTitle: { en: 'Trusted devices', ar: 'الأجهزة الموثوقة' },
  trustedSettingsRow: { en: 'Trusted devices & family', ar: 'الأجهزة الموثوقة والعائلة' },
  trustedSettingsDetail: {
    en: 'Share future relay captures with up to 8 devices',
    ar: 'شارك عمليات الالتقاط المستقبلية مع ما يصل إلى ٨ أجهزة',
  },
  trustedHeroTitle: { en: 'One vault. Your trusted phones.', ar: 'خزنة واحدة. لأجهزتك الموثوقة.' },
  trustedHeroBody: {
    en: 'New structured captures delivered through Wafra’s relay can reach every trusted device, sealed separately for each one. Your existing ledger is not copied.',
    ar: 'يمكن لعمليات الالتقاط المنظمة الجديدة المرسلة عبر مرحّل وفرة أن تصل إلى كل جهاز موثوق، مشفّرة لكل جهاز على حدة. لا يُنسخ سجلك الحالي.',
  },
  trustedAndroidTruth: {
    en: 'Bank SMS still parse only on this Android and are not uploaded. Trusted devices receive only future items delivered through the relay.',
    ar: 'تبقى رسائل البنك على هذا الأندرويد وتُحلَّل محلياً ولا تُرفع. تستقبل الأجهزة الموثوقة فقط العناصر المستقبلية المرسلة عبر المرحّل.',
  },
  trustedIosTruth: {
    en: 'Each future Shortcut capture is sealed to trusted devices. Joining never backfills older transactions.',
    ar: 'تُشفّر كل عملية التقاط مستقبلية من الاختصار للأجهزة الموثوقة. لا يسترجع الانضمام العمليات السابقة.',
  },
  trustedPreview: { en: 'SAMPLE HOUSEHOLD', ar: 'عائلة تجريبية' },
  trustedDisabled: { en: 'DEMO', ar: 'تجريبي' },
  trustedPreviewBody: {
    en: 'See how a family shares one encrypted ledger. Invitations are disabled in this demo.',
    ar: 'شاهد كيف تشارك العائلة سجلاً واحداً مشفّراً. الدعوات معطلة في هذا العرض التجريبي.',
  },
  trustedPreviewA11y: { en: 'Sample device, controls disabled', ar: 'جهاز تجريبي، عناصر التحكم معطلة' },
  trustedStartHeader: { en: 'START A TRUSTED VAULT', ar: 'ابدأ خزنة موثوقة' },
  trustedStartBody: {
    en: 'Create the first owner device, or paste a one-use invite from someone you trust. No bank or ledger data is stored in an invite.',
    ar: 'أنشئ جهاز المالك الأول، أو الصق دعوة للاستخدام مرة واحدة من شخص تثق به. لا تحتوي الدعوة على بيانات بنكية أو بيانات السجل.',
  },
  trustedPrivateModeBody: {
    en: 'Private Mode blocks relay enrollment. Turn it off in Settings before creating or joining a trusted vault.',
    ar: 'يمنع الوضع الخاص الانضمام إلى المرحّل. أوقفه في الإعدادات قبل إنشاء خزنة موثوقة أو الانضمام إليها.',
  },
  trustedConnecting: { en: 'Connecting…', ar: 'جارٍ الاتصال…' },
  trustedCreateVault: { en: 'Create trusted vault', ar: 'أنشئ خزنة موثوقة' },
  trustedJoinVault: { en: 'Join with an invite', ar: 'انضم بدعوة' },
  trustedDevicesHeader: { en: 'TRUSTED DEVICES', ar: 'الأجهزة الموثوقة' },
  trustedThisDevice: { en: 'THIS DEVICE', ar: 'هذا الجهاز' },
  trustedRoleOwner: { en: 'Owner', ar: 'المالك' },
  trustedRoleMember: { en: 'Member', ar: 'عضو' },
  trustedSeenNow: { en: 'seen now', ar: 'نشط الآن' },
  trustedSeenMinutes: { en: 'seen {count}m ago', ar: 'نشط قبل {count} د' },
  trustedSeenHours: { en: 'seen {count}h ago', ar: 'نشط قبل {count} س' },
  trustedUnnamed: { en: 'Unnamed device', ar: 'جهاز بلا اسم' },
  trustedManageA11y: { en: 'Opens device controls', ar: 'يفتح عناصر التحكم بالجهاز' },
  trustedOfflineBody: {
    en: 'Relay unavailable. Showing the last list on this screen; no changes were made.',
    ar: 'المرحّل غير متاح. تُعرض آخر قائمة في هذه الشاشة ولم تُجرَ أي تغييرات.',
  },
  trustedRetry: { en: 'RETRY', ar: 'أعد المحاولة' },
  trustedInviteHeader: { en: 'ADD SOMEONE YOU TRUST', ar: 'أضف شخصاً تثق به' },
  trustedInviteAction: { en: 'Create 10-minute invite', ar: 'أنشئ دعوة لمدة ١٠ دقائق' },
  trustedInviteReady: { en: 'One-use invite ready', ar: 'الدعوة صالحة لاستخدام واحد' },
  trustedInviteCountdown: { en: 'Expires in {minutes}:{seconds}', ar: 'تنتهي خلال {minutes}:{seconds}' },
  trustedInviteExpired: { en: 'This invite has expired', ar: 'انتهت صلاحية هذه الدعوة' },
  trustedInvitePrivacy: {
    en: 'The invite contains a short-lived enrollment token and relay address only—no balances, transactions, bank details, or device secrets.',
    ar: 'تحتوي الدعوة فقط على رمز انضمام قصير الصلاحية وعنوان المرحّل — بلا أرصدة أو عمليات أو بيانات بنكية أو أسرار الجهاز.',
  },
  trustedShareInvite: { en: 'Share secure invite', ar: 'شارك الدعوة الآمنة' },
  trustedNewInvite: { en: 'Create a new invite', ar: 'أنشئ دعوة جديدة' },
  trustedShareTitle: { en: 'Wafra trusted-device invite', ar: 'دعوة جهاز موثوق من وفرة' },
  trustedShareMessage: {
    en: 'Join my Wafra trusted vault. Open or paste this one-use link in Wafra within 10 minutes:',
    ar: 'انضم إلى خزنة وفرة الموثوقة. افتح أو الصق هذا الرابط الصالح لاستخدام واحد في وفرة خلال ١٠ دقائق:',
  },
  trustedVaultHeader: { en: 'TRUSTED VAULT', ar: 'الخزنة الموثوقة' },
  trustedVaultBody: {
    en: 'Deleting the vault revokes every device and removes queued relay captures. Transactions already saved on each phone stay local to that phone.',
    ar: 'حذف الخزنة يلغي وصول كل الأجهزة ويحذف عمليات الالتقاط المنتظرة في المرحّل. تبقى العمليات المحفوظة على كل هاتف محلياً فيه.',
  },
  trustedDeleteVaultTitle: { en: 'Delete the trusted vault?', ar: 'حذف الخزنة الموثوقة؟' },
  trustedDeleteVaultBody: {
    en: 'Every device will lose future relay delivery and all queued captures will be deleted. Local ledgers already saved on each device are not remotely erased.',
    ar: 'ستفقد جميع الأجهزة عمليات الترحيل المستقبلية وستُحذف كل العمليات المنتظرة. لن تُمسح السجلات المحلية المحفوظة على الأجهزة عن بُعد.',
  },
  trustedDeleteVaultAction: { en: 'Delete trusted vault', ar: 'احذف الخزنة الموثوقة' },
  trustedJoinSheetTitle: { en: 'JOIN TRUSTED VAULT', ar: 'الانضمام إلى خزنة موثوقة' },
  trustedJoinSheetBody: {
    en: 'Paste the one-use link shared by the owner. This phone creates its own encryption key; no private key is copied from another device.',
    ar: 'الصق رابط الاستخدام الواحد الذي شاركه المالك. ينشئ هذا الهاتف مفتاح تشفير خاصاً به؛ ولا يُنسخ أي مفتاح خاص من جهاز آخر.',
  },
  trustedDeviceName: { en: 'DEVICE NAME', ar: 'اسم الجهاز' },
  trustedInviteCode: { en: 'INVITE LINK OR CODE', ar: 'رابط الدعوة أو رمزها' },
  trustedInvitePlaceholder: { en: 'Paste the Wafra invite', ar: 'الصق دعوة وفرة' },
  trustedJoining: { en: 'Joining…', ar: 'جارٍ الانضمام…' },
  trustedJoinAction: { en: 'Join trusted vault', ar: 'انضم إلى الخزنة الموثوقة' },
  trustedManageDevice: { en: 'MANAGE DEVICE', ar: 'إدارة الجهاز' },
  trustedLeaveTitle: { en: 'Leave this trusted vault?', ar: 'مغادرة هذه الخزنة الموثوقة؟' },
  trustedLeaveBody: {
    en: 'This device will stop receiving future relay captures. Its local ledger stays on this phone.',
    ar: 'سيتوقف هذا الجهاز عن استقبال عمليات الالتقاط المستقبلية من المرحّل. يبقى سجله المحلي على هذا الهاتف.',
  },
  trustedLeaveAction: { en: 'Leave vault', ar: 'غادر الخزنة' },
  trustedRemoveTitle: { en: 'Remove this device?', ar: 'إزالة هذا الجهاز؟' },
  trustedRemoveBody: {
    en: '{name} will lose future relay access. Its already-saved local ledger cannot be erased remotely.',
    ar: 'سيفقد {name} الوصول المستقبلي إلى المرحّل. لا يمكن مسح سجله المحلي المحفوظ مسبقاً عن بُعد.',
  },
  trustedRemoveAction: { en: 'Remove access', ar: 'أزل الوصول' },
  trustedOwnerProtected: { en: 'Owner protected', ar: 'المالك محمي' },
  trustedOwnerProtectedBody: {
    en: 'The last owner cannot be removed. Use Delete trusted vault if you intend to end this vault for everyone.',
    ar: 'لا يمكن إزالة آخر مالك. استخدم «احذف الخزنة الموثوقة» إذا أردت إنهاء الخزنة للجميع.',
  },
  trustedOwnerOnly: { en: 'Owner approval needed', ar: 'تلزم موافقة المالك' },
  trustedOwnerOnlyBody: {
    en: 'Only the vault owner can invite or remove another device.',
    ar: 'يمكن لمالك الخزنة وحده دعوة جهاز آخر أو إزالته.',
  },
  trustedLimitTitle: { en: 'Vault is full', ar: 'الخزنة ممتلئة' },
  trustedLimitBody: {
    en: 'A trusted vault supports up to 8 devices. Remove one before creating another invite.',
    ar: 'تدعم الخزنة الموثوقة ما يصل إلى ٨ أجهزة. أزل جهازاً قبل إنشاء دعوة أخرى.',
  },
  trustedInviteExpiredTitle: { en: 'Invite did not work', ar: 'لم تنجح الدعوة' },
  trustedInviteExpiredBody: {
    en: 'It may be expired, already used, or incomplete. Ask the owner for a fresh invite.',
    ar: 'قد تكون منتهية أو مستخدمة مسبقاً أو غير مكتملة. اطلب من المالك دعوة جديدة.',
  },
  trustedAccessEnded: { en: 'Access ended', ar: 'انتهى الوصول' },
  trustedAccessEndedBody: {
    en: 'This device is no longer authorized for that vault.',
    ar: 'لم يعد هذا الجهاز مصرحاً له بالوصول إلى تلك الخزنة.',
  },
  trustedTryLater: { en: 'Try again shortly', ar: 'حاول مجدداً بعد قليل' },
  trustedTryLaterBody: {
    en: 'Too many enrollment attempts were made. Wait a moment before retrying.',
    ar: 'تمت محاولات انضمام كثيرة. انتظر قليلاً قبل إعادة المحاولة.',
  },
  trustedNameInvalid: { en: 'Check the device name', ar: 'تحقق من اسم الجهاز' },
  trustedNameInvalidBody: {
    en: 'Use between 1 and 40 characters, without control characters.',
    ar: 'استخدم من حرف واحد إلى ٤٠ حرفاً، من دون محارف تحكم.',
  },
  trustedUnavailableTitle: { en: 'Relay unavailable', ar: 'المرحّل غير متاح' },
  trustedUnavailableBody: {
    en: 'No change was made. Check your connection and try again.',
    ar: 'لم يُجرَ أي تغيير. تحقق من اتصالك وحاول مجدداً.',
  },
  notAvailable: { en: 'Not available', ar: 'غير متاح' },
  openSettings: { en: 'Open settings', ar: 'فتح الإعدادات' },
  enableAction: { en: 'Enable', ar: 'تفعيل' },
  restoreAction: { en: 'Restore', ar: 'استعادة' },
  restoreBackupQ: { en: 'Restore backup?', ar: 'استعادة النسخة الاحتياطية؟' },
  invalidFile: { en: 'Invalid file', ar: 'ملف غير صالح' },
  couldNotReadFileBody: {
    en: 'Try exporting a fresh backup and restoring that.',
    ar: 'جرّب تصدير نسخة احتياطية جديدة ثم استعادتها.',
  },
  featuresHeader: { en: 'Features', ar: 'الميزات' },
  dataHeader: { en: 'Data', ar: 'البيانات' },
  moneyMonthHeader: { en: 'Money month', ar: 'الشهر المالي' },
  moneyMonthStarts: { en: 'Starts on the {day}', ar: 'يبدأ في اليوم {day}' },
  moneyMonthDayA11y: {
    en: 'Money month starts on day {day}',
    ar: 'يبدأ الشهر المالي في اليوم {day}',
  },
  moneyMonthRange: {
    en: 'Your {month} month runs {from} – {to}, so salary and rent land in the same month.',
    ar: 'يمتد شهر {month} المالي من {from} إلى {to}، فيقع الراتب والإيجار في الشهر نفسه.',
  },
  calendarMonthHint: {
    en: 'Day 1 means calendar months. Next month starts {date}.',
    ar: 'اليوم ١ يعني الأشهر الميلادية. يبدأ الشهر التالي في {date}.',
  },
  appearanceHeader: { en: 'Appearance', ar: 'المظهر' },
  themeSystem: { en: 'System', ar: 'النظام' },
  themeLight: { en: 'Light', ar: 'فاتح' },
  themeDark: { en: 'Dark', ar: 'داكن' },
  pinnedTheme: {
    en: 'Pinned to {theme}, whatever your phone is set to.',
    ar: 'ثُبّت المظهر على {theme} بغض النظر عن إعداد الهاتف.',
  },
  privacyHeader: { en: 'Privacy', ar: 'الخصوصية' },
  appLockTitle: { en: 'App lock', ar: 'قفل التطبيق' },
  appLockDetail: {
    en: 'Fingerprint, face unlock, or your phone PIN',
    ar: 'البصمة أو التعرّف على الوجه أو رمز الهاتف',
  },
  readBankSms: { en: 'Read bank SMS', ar: 'قراءة رسائل البنك' },
  smsGrantedLocal: {
    en: 'Granted · nothing is uploaded',
    ar: 'مسموح · لا يُرفع أي شيء',
  },
  smsOffNoImport: {
    en: 'Off · nothing can import',
    ar: 'متوقف · لن تُستورد أي عملية',
  },
  turnSmsReadingOff: { en: 'Turn SMS reading off', ar: 'إيقاف قراءة الرسائل' },
  instantAlertsOn: {
    en: 'On · a quiet banner when the bank texts',
    ar: 'مفعّل · تنبيه هادئ عند وصول رسالة البنك',
  },
  instantAlertsOff: {
    en: 'Off · charges appear when Wafra next opens',
    ar: 'متوقف · تظهر العمليات عند فتح وفرة لاحقاً',
  },
  instantAlertsNeedSms: {
    en: 'Needs bank SMS reading above',
    ar: 'يحتاج تفعيل قراءة رسائل البنك أعلاه',
  },
  instantAlertsSmsPermissionTitle: {
    en: 'Incoming SMS access was not allowed',
    ar: 'لم يُسمح بالوصول إلى الرسائل الواردة',
  },
  instantAlertsSmsPermissionBody: {
    en: 'Instant banners need Android’s incoming SMS permission. Bank-alert history import still works with the separate SMS-reading permission.',
    ar: 'تحتاج التنبيهات الفورية إذن أندرويد للرسائل الواردة. ويظل استيراد سجل تنبيهات البنك يعمل بإذن قراءة الرسائل المنفصل.',
  },
  bankPushOn: {
    en: 'On · bank-app money alerts import automatically',
    ar: 'مفعّل · تُستورد تنبيهات المال من تطبيق البنك تلقائياً',
  },
  bankPushOff: {
    en: 'Off · for banks that push instead of SMS',
    ar: 'متوقف · للبنوك التي ترسل إشعارات بدلاً من الرسائل',
  },
  regionHeader: { en: 'Language & bank formats', ar: 'اللغة وتنسيقات البنوك' },
  countryPack: { en: 'Country pack', ar: 'حزمة الدولة' },
  parserPack: { en: 'Launch parser preference', ar: 'تفضيل محلل الإطلاق' },
  // What the pack changes, stated as what it changes: which banks and shops
  // are recognised in NEW messages. It does not restate the currency as
  // something the pack sets, because on a ledger that already holds money it
  // cannot — see marketPinned below.
  countryPackDetail: {
    en: '{country} · {currency} · bank and shop names in new messages',
    ar: '{country} · {currency} · أسماء البنوك والمتاجر في الرسائل الجديدة',
  },
  parserPackDetail: {
    en: '{country} · {currency} automatic import; Android can detect other supported formats for review',
    ar: '{country} · استيراد تلقائي بعملة {currency}؛ يستطيع أندرويد اكتشاف تنسيقات مدعومة أخرى للمراجعة',
  },
  globalParserPackDetail: {
    en: 'Android worldwide review · {currency} ledger; iPhone capture remains UAE/Saudi',
    ar: 'مراجعة عالمية على أندرويد · سجل بعملة {currency}؛ يبقى التقاط الآيفون للإمارات والسعودية',
  },
  parserPackPickerBody: {
    en: 'Choose the launch-tested UAE or Saudi automatic-import pack. Android detects other supported countries per alert and keeps them review-first; iPhone does not yet.',
    ar: 'اختر حزمة الاستيراد التلقائي المختبرة للإمارات أو السعودية. يكتشف أندرويد الدول المدعومة الأخرى لكل تنبيه ويعرضها للمراجعة أولاً؛ الآيفون لا يدعم ذلك بعد.',
  },
  /**
   * Why a differently-denominated pack is greyed out.
   *
   * The honest sentence, because the dishonest one was the bug: switching
   * packs used to relabel every stored figure — the same 125,050 fils
   * printing "AED 1,250.50" and then "SAR 1,250.50" — with nothing converted
   * and no rate that could have converted it. So the pack is refused, and the
   * row says which currency the money is already in and what the way out is.
   */
  marketPinned: {
    en: 'Your money is recorded in {currency}. Switching would relabel it, not convert it.',
    ar: 'أموالك مسجّلة بـ {currency}. التبديل سيغيّر التسمية فقط ولن يحوّل المبالغ.',
  },
  uaeName: { en: 'United Arab Emirates', ar: 'الإمارات العربية المتحدة' },
  saudiName: { en: 'Saudi Arabia', ar: 'المملكة العربية السعودية' },
  languageSettingDetail: {
    en: 'English · العربية is available instantly',
    ar: 'العربية · English متاحة فوراً',
  },
  unreadFormatsCount: {
    en: '{count} unread message format{s} · digits masked',
    ar: '{count} صيغة رسالة غير مقروءة · الأرقام مخفية',
  },
  settingsTagline: {
    en: 'Know where it goes. Watch it grow. Your retention choice is shown above.',
    ar: 'اعرف أين تذهب أموالك وراقبها تنمو. خيار الاحتفاظ ببياناتك موضح أعلاه.',
  },
  settingsTrialDays: {
    en: 'Free trial · {count} day{s} left',
    ar: 'تجربة مجانية · متبقٍ {count} يوم',
  },
  wafraPro: { en: 'Wafra Pro', ar: 'وفرة برو' },
  proActive: { en: 'Active', ar: 'مفعّل' },
  billsAndSubs: { en: 'Bills and subscriptions', ar: 'الفواتير والاشتراكات' },
  importFromSms: { en: 'Import from bank SMS', ar: 'استيراد من رسائل البنك' },
  bankAppNotifs: { en: 'Bank app notifications (beta)', ar: 'إشعارات تطبيقات البنوك (تجريبي)' },
  appLock: { en: 'App lock (biometric)', ar: 'قفل التطبيق (بصمة)' },
  privateMode: { en: 'Private Mode', ar: 'الوضع الخاص' },
  privateModeOn: {
    en: 'On · local structured data only; raw text is dropped',
    ar: 'مفعّل · بيانات منظّمة محلية فقط؛ يُحذف النص الخام',
  },
  privateModeOff: {
    en: 'Off · low-confidence text may stay on this phone for correction',
    ar: 'متوقف · قد يبقى نص العمليات غير الواضحة على الهاتف لتصحيحها',
  },
  privateModeEnableTitle: { en: 'Turn on Private Mode?', ar: 'تفعيل الوضع الخاص؟' },
  privateModeEnableIosBody: {
    en: 'This removes retained diagnostic message text and disconnects automatic Shortcuts capture. Structured entries already on this iPhone stay.',
    ar: 'سيحذف نصوص الرسائل التشخيصية المحفوظة ويفصل الالتقاط التلقائي عبر الاختصارات. ستبقى العمليات المنظّمة الموجودة على هذا الآيفون.',
  },
  privateModeEnable: { en: 'Turn on', ar: 'تفعيل' },
  privateModeFailed: {
    en: 'Private Mode could not disconnect the relay. Connect to the internet and try again.',
    ar: 'تعذّر على الوضع الخاص فصل المرحّل. اتصل بالإنترنت وحاول مرة أخرى.',
  },
  capturePreferenceFailed: {
    en: 'Wafra could not save the automatic capture setting. Try again.',
    ar: 'تعذّر على وفرة حفظ إعداد الالتقاط التلقائي. حاول مرة أخرى.',
  },
  privacyRetentionExact: {
    en: 'Android alerts are parsed on-device. On iPhone, your Shortcut sends selected bank alerts to Wafra’s relay; it deletes the raw text immediately and keeps only a device-sealed transaction for up to 30 days. Private Mode is local-only and disables iPhone Shortcut capture.',
    ar: 'تُحلَّل تنبيهات أندرويد على الجهاز. وعلى الآيفون يرسل الاختصار تنبيهات البنوك المحددة إلى مرحّل وفرة؛ فيحذف النص فوراً ولا يحتفظ إلا بعملية مشفّرة لهذا الجهاز لمدة أقصاها ٣٠ يوماً. الوضع الخاص محلي فقط ويوقف التقاط الاختصار على الآيفون.',
  },
  privacySecurityExact: {
    en: 'Automatic capture is optional. Android SMS alerts are processed on this phone; optional bank-app alerts wait only in a short-lived encrypted queue. iPhone uses your personal Shortcut and Wafra’s encrypted relay. Wafra cannot sign in to a bank, reply to messages, approve a payment or move money.',
    ar: 'الالتقاط التلقائي اختياري. تُعالج تنبيهات الرسائل على هذا الهاتف، وتنتظر تنبيهات تطبيقات البنوك الاختيارية فقط في طابور مشفر قصير المدة. ويستخدم الآيفون اختصارك الشخصي ومُرحّل وفرة المشفر. ولا يستطيع وفرة تسجيل الدخول إلى بنك أو الرد على الرسائل أو الموافقة على دفعة أو نقل الأموال.',
  },
  country: { en: 'Country', ar: 'الدولة' },
  language: { en: 'Language', ar: 'اللغة' },
  monthStartsOn: { en: 'Month starts on day', ar: 'يبدأ الشهر في يوم' },
  calendarMonths: { en: 'Calendar months (1st to end)', ar: 'أشهر ميلادية (من ١ حتى النهاية)' },
  backupJson: { en: 'Back up everything (JSON)', ar: 'نسخ احتياطي كامل (JSON)' },
  restoreBackup: { en: 'Restore from backup', ar: 'استعادة من نسخة احتياطية' },
  exportCsv: { en: 'Export transactions (CSV)', ar: 'تصدير العمليات (CSV)' },
  smsCorpusExportTitle: {
    en: 'Export parser corpus (temporary)',
    ar: 'تصدير مجموعة رسائل للمحلّل (مؤقت)',
  },
  smsCorpusExportDetail: {
    en: 'Share every received SMS from this Android phone',
    ar: 'مشاركة جميع الرسائل المستلمة من هاتف أندرويد هذا',
  },
  smsCorpusExportProgress: {
    en: 'Preparing {count} messages…',
    ar: 'جارٍ تجهيز {count} رسالة…',
  },
  smsCorpusConfirmTitle: {
    en: 'Export every received SMS?',
    ar: 'تصدير جميع الرسائل المستلمة؟',
  },
  smsCorpusConfirmBody: {
    en: 'This temporary diagnostic reads the full sender, date and text of every received SMS on this phone and prepares a local JSON file. Wafra does not upload it; you choose where to send it in the Android share sheet.',
    ar: 'تقرأ هذه الأداة التشخيصية المؤقتة اسم المرسل والتاريخ والنص الكامل لكل رسالة مستلمة على هذا الهاتف، ثم تُنشئ ملف JSON محلياً. لا يرفعه وفرة؛ أنت تختار وجهته من قائمة المشاركة في أندرويد.',
  },
  smsCorpusConfirmAction: { en: 'Prepare file', ar: 'تجهيز الملف' },
  smsCorpusPermissionTitle: {
    en: 'SMS permission is needed',
    ar: 'يلزم إذن الرسائل',
  },
  smsCorpusPermissionBody: {
    en: 'Allow SMS access, then try the temporary export again.',
    ar: 'اسمح بالوصول إلى الرسائل ثم أعد محاولة التصدير المؤقت.',
  },
  smsCorpusFailedTitle: {
    en: 'Corpus export failed',
    ar: 'تعذّر تصدير مجموعة الرسائل',
  },
  smsCorpusFailedBody: {
    en: 'No file was shared. Keep Wafra open and try again.',
    ar: 'لم تتم مشاركة أي ملف. أبقِ وفرة مفتوحاً وحاول مرة أخرى.',
  },
  exportExpensePdf: { en: 'Expense report (PDF)', ar: 'تقرير المصروفات (PDF)' },
  expenseReportPeriod: { en: 'Expense report period', ar: 'فترة تقرير المصروفات' },
  expenseReportPeriodBody: {
    en: 'Choose the expenses to include. Transfers and income are never included.',
    ar: 'اختر المصروفات التي تريد تضمينها. لا يشمل التقرير التحويلات أو الدخل.',
  },
  currentMoneyMonth: { en: 'Current money month', ar: 'الشهر المالي الحالي' },
  allExpenses: { en: 'All expenses', ar: 'كل المصروفات' },
  originalAmount: { en: 'Original amount', ar: 'المبلغ الأصلي' },
  exchangeRate: { en: 'Exchange rate', ar: 'سعر الصرف' },
  bankQuotedRate: { en: 'Bank-quoted {currency} equivalent', ar: 'ما يعادله بعملة {currency} حسب البنك' },
  datedReferenceRate: { en: 'Dated reference rate · {date}', ar: 'سعر مرجعي بتاريخ {date}' },
  offlineFxEstimate: {
    en: 'Offline estimate · updates when online',
    ar: 'تقدير دون اتصال · يُحدَّث عند الاتصال',
  },
  fxRateValue: {
    en: '1 {from} = {to} {rate} · {source}',
    ar: '١ {from} = {rate} {to} · {source}',
  },
  retainedBankMessage: { en: 'Bank message', ar: 'رسالة البنك' },
  bankSmsSource: { en: 'Bank SMS', ar: 'رسالة بنكية' },
  noExpensesToExport: {
    en: 'There are no expenses in that period.',
    ar: 'لا توجد مصروفات في هذه الفترة.',
  },
  reportShareUnavailable: {
    en: 'File sharing is not available on this device.',
    ar: 'مشاركة الملفات غير متاحة على هذا الجهاز.',
  },
  reportExportFailed: {
    en: 'The PDF could not be created. Try again.',
    ar: 'تعذّر إنشاء ملف PDF. حاول مرة أخرى.',
  },
  loadDemo: { en: 'Load demo data', ar: 'تحميل بيانات تجريبية' },
  eraseAll: { en: 'Erase all data', ar: 'مسح كل البيانات' },
  tapToChange: { en: 'tap to change', ar: 'اضغط للتغيير' },
  languageChanged: { en: 'Language changed', ar: 'تم تغيير اللغة' },
  mirrorOnNextOpen: {
    en: 'The text has changed already. Android can only mirror the layout right-to-left when the app starts, so that part arrives next time you open Wafra.',
    ar: 'تغيّر النص بالفعل. لا يستطيع أندرويد عكس اتجاه الواجهة إلى اليمين إلا عند بدء التطبيق، لذا سيظهر ذلك في المرة القادمة التي تفتح فيها وفرة.',
  },

  // Paywall
  proTagline: { en: 'A few power features fund the app.', ar: 'ميزات إضافية تدعم استمرار التطبيق.' },
  proActiveThanks: { en: 'Active on this device. Thank you for supporting Wafra.', ar: 'مفعّل على هذا الجهاز. شكراً لدعمك وفرة.' },
  proOutcomeTitle: {
    en: 'Keep your ledger up to date, automatically.',
    ar: 'حافظ على تحديث سجلك تلقائياً.',
  },
  proTrialActiveBody: {
    en: 'Automatic capture is included for {left} more day{s}.',
    ar: 'الالتقاط التلقائي مشمول لمدة {left} يوم إضافي.',
  },
  proTrialEndedBody: {
    en: 'Automatic bank-alert capture is paused. Your ledger and manual entries still work.',
    ar: 'توقف الالتقاط التلقائي لتنبيهات البنك. يظل سجلك والإدخال اليدوي متاحين.',
  },
  proBenefitsTitle: { en: 'Included with Pro', ar: 'مشمول مع برو' },
  proChoosePlan: { en: 'Choose your plan', ar: 'اختر خطتك' },
  proSavePercent: { en: 'Save {percent}%', ar: 'وفّر {percent}٪' },
  proChargeTimingYear: {
    en: 'Charged {price} when you confirm. Renews yearly until cancelled.',
    ar: 'يُخصم {price} عند التأكيد، ثم يتجدد سنوياً حتى الإلغاء.',
  },
  proChargeTimingMonth: {
    en: 'Charged {price} when you confirm. Renews monthly until cancelled.',
    ar: 'يُخصم {price} عند التأكيد، ثم يتجدد شهرياً حتى الإلغاء.',
  },
  proStoreConfirmsPrice: {
    en: 'Your store shows the exact charge and renewal details before you confirm.',
    ar: 'يعرض المتجر المبلغ الدقيق وتفاصيل التجديد قبل التأكيد.',
  },
  proPurchaseSuccessTitle: { en: 'Wafra Pro is active', ar: 'وفرة برو مفعّل' },
  proPurchaseSuccessBody: {
    en: 'Your subscription is confirmed. You can manage it anytime from Settings.',
    ar: 'تم تأكيد اشتراكك. يمكنك إدارته في أي وقت من الإعدادات.',
  },
  proRestoreSuccessTitle: { en: 'Purchase restored', ar: 'تمت استعادة الشراء' },
  proRestoreSuccessBody: {
    en: 'Wafra Pro is active again on this device.',
    ar: 'وفرة برو مفعّل مجدداً على هذا الجهاز.',
  },
  proContinue: { en: 'Continue to Wafra', ar: 'متابعة إلى وفرة' },
  trialEndedPaywall: { en: 'Your free trial has ended and tracking is paused. Subscribe to keep Wafra working — your data never leaves your phone either way.', ar: 'انتهت تجربتك المجانية وتوقف التتبع. اشترك لمواصلة استخدام وفرة — بياناتك لا تغادر هاتفك في كل الأحوال.' },
  freeTrialActive: { en: 'FREE TRIAL ACTIVE', ar: 'التجربة المجانية مفعّلة' },
  getPro: { en: 'Get Wafra Pro', ar: 'اشترك في وفرة برو' },
  startPlanWithPrice: {
    en: 'Start {plan} — {price}',
    ar: 'ابدأ الاشتراك {plan} — {price}',
  },
  purchaseInProgress: { en: 'Opening the store…', ar: 'جارٍ فتح المتجر…' },
  restorePurchase: { en: 'Restore purchase', ar: 'استعادة الشراء' },
  yearly: { en: 'YEARLY', ar: 'سنوي' },
  monthly: { en: 'MONTHLY', ar: 'شهري' },
  perMonth: { en: 'per month', ar: 'شهرياً' },
  transferLabel: { en: 'Transfer', ar: 'تحويل' },
  // ── strings screens used to write in English inline ──
  noScreenLock: { en: 'No screen lock set up', ar: 'لا يوجد قفل شاشة' },
  noScreenLockBody: { en: 'Set up a fingerprint, face unlock, or PIN in your phone settings first.', ar: 'أعدّ بصمة أو تعرّفاً على الوجه أو رمز PIN في إعدادات هاتفك أولاً.' },
  confirmAppLock: { en: 'Confirm to enable app lock', ar: 'أكّد لتفعيل قفل التطبيق' },
  smsRevokeHint: { en: 'Android only revokes this in its own settings: Settings → Apps → Wafra → Permissions → SMS.', ar: 'يُلغى هذا الإذن من إعدادات أندرويد فقط: الإعدادات ← التطبيقات ← وفرة ← الأذونات ← الرسائل.' },
  notificationsOff: { en: 'Notifications are off', ar: 'الإشعارات مغلقة' },
  notificationsOffBody: { en: 'Wafra needs notification permission to alert you. Turn it on in Settings → Apps → Wafra → Notifications.', ar: 'يحتاج وفرة إذن الإشعارات لتنبيهك. فعّله من الإعدادات ← التطبيقات ← وفرة ← الإشعارات.' },
  bankAppNotifsTitle: { en: 'Bank app notifications', ar: 'إشعارات تطبيقات البنوك' },
  eraseEverythingQ: { en: 'Erase everything on this phone?', ar: 'حذف كل شيء من هذا الهاتف؟' },
  eraseAction: { en: 'Erase', ar: 'مسح' },
  eraseEverythingBody: {
    en: 'All accounts, entries, bills, and goals will be permanently deleted.',
    ar: 'ستُحذف جميع الحسابات والعمليات والفواتير والأهداف نهائياً.',
  },
  // Android rebuilds its ledger from the inbox on the next scan, so the plain
  // sentence above is FALSE there: the entries come back, while the budgets,
  // bills, goals, categorisations and hand-edits do not. This is the one screen
  // where a privacy claim has to be exact, so the phone that rebuilds says so.
  // Not shown on iOS, where the relay is unpaired and the staged queue cleared
  // and nothing rebuilds — there the sentence would be a lie the other way.
  eraseEverythingSmsBody: {
    en: 'All accounts, entries, bills, and goals will be permanently deleted. Your bank messages stay in your phone’s inbox — Wafra cannot delete those — so the entries will be read in again the next time it scans. What you taught it will not come back.',
    ar: 'ستُحذف جميع الحسابات والعمليات والفواتير والأهداف نهائياً. أما رسائل بنكك فتبقى في صندوق رسائل هاتفك — ولا تستطيع وفرة حذفها — لذا ستُقرأ العمليات من جديد عند الفحص التالي. أما ما علّمته لوفرة فلن يعود.',
  },
  eraseEverythingIosBody: {
    en: 'All accounts, entries, bills, goals, and this iPhone’s relay queue will be permanently deleted. Wafra cannot delete your Capture Shortcut — Apple gives no app that power — so it will show you how to remove it yourself straight afterwards.',
    ar: 'ستُحذف جميع الحسابات والعمليات والفواتير والأهداف وصف انتظار الترحيل لهذا الآيفون نهائياً. لا تستطيع وفرة حذف اختصار الالتقاط — لا تمنح آبل أي تطبيق هذه الصلاحية — لذا ستوضّح لك بعد ذلك مباشرةً كيف تحذفه بنفسك.',
  },
  eraseRelayFailedTitle: {
    en: 'Could not erase everything',
    ar: 'تعذّر مسح كل شيء',
  },
  eraseRelayFailedBody: {
    en: 'The relay could not be reached, so nothing was erased. Connect to the internet and try again. Wafra kept this iPhone’s relay key so it can still delete the encrypted queue and revoke the token your Shortcut carries.',
    ar: 'تعذّر الوصول إلى المرحّل، لذا لم يُمسح أي شيء. اتصل بالإنترنت وحاول مجدداً. احتفظت وفرة بمفتاح ترحيل هذا الآيفون كي تتمكن من حذف صف الانتظار المشفّر وإلغاء الرمز الذي يحمله اختصارك.',
  },
  /**
   * The relay refuses to unpair an owner while other trusted devices still
   * depend on that vault, and it is right to: unpairing would strand them.
   * That is a 409, not a network fault, and retrying forever cannot fix it —
   * so it must not be reported as "try again".
   */
  eraseVaultOwnerTitle: {
    en: 'Other trusted devices depend on this iPhone',
    ar: 'أجهزة موثوقة أخرى تعتمد على هذا الآيفون',
  },
  eraseVaultOwnerBody: {
    en: 'This iPhone owns a trusted vault that other devices still use, so the relay will not release it and nothing has been erased. Remove the other devices, or delete the whole vault, then erase again.',
    ar: 'يملك هذا الآيفون خزنة موثوقة ما زالت أجهزة أخرى تستخدمها، لذا لن يحرّرها المرحّل ولم يُمسح أي شيء. أزل الأجهزة الأخرى أو احذف الخزنة بالكامل، ثم أعد المسح.',
  },
  /**
   * The relay half succeeded and the local half did not. Saying "try again"
   * here would be a second lie: the device row is already gone.
   */
  eraseLocalFailedTitle: {
    en: 'Your data is still on this phone',
    ar: 'بياناتك ما زالت على هذا الهاتف',
  },
  eraseLocalFailedBody: {
    en: 'Wafra disconnected the relay and revoked this iPhone’s tokens, but the encrypted ledger on this phone could not be deleted. Restart Wafra and erase again.',
    ar: 'فصلت وفرة المرحّل وألغت رموز هذا الآيفون، لكن تعذّر حذف السجل المشفّر الموجود على هذا الهاتف. أعد تشغيل وفرة ثم امسح مرة أخرى.',
  },
  eraseLocalInitializeFailedTitle: {
    en: 'Your data was erased',
    ar: 'تم محو بياناتك',
  },
  eraseLocalInitializeFailedBody: {
    en: 'The ledger was deleted, but Wafra could not restart secure storage. Saving is paused so new changes are not lost. Use Try again on the recovery screen.',
    ar: 'حُذف السجل، لكن تعذّر على وفرة إعادة تشغيل التخزين الآمن. أُوقف الحفظ كي لا تضيع تغييرات جديدة. استخدم «إعادة المحاولة» في شاشة الاسترداد.',
  },
  eraseQueueCleanupFailedTitle: {
    en: 'Your ledger was erased',
    ar: 'تم محو سجلك',
  },
  eraseQueueCleanupFailedBody: {
    en: 'Wafra erased the ledger, but could not delete encrypted captured messages still waiting on this phone. Import and saving are paused. Use Try again on the recovery screen.',
    ar: 'محَت وفرة السجل، لكن تعذّر حذف رسائل بنكية مشفّرة ما زالت بانتظار الاستيراد على هذا الهاتف. أُوقف الاستيراد والحفظ. استخدم «إعادة المحاولة» في شاشة الاسترداد.',
  },
  shortcutStillInstalledTitle: {
    en: 'One thing left: your Shortcut',
    ar: 'بقي شيء واحد: اختصارك',
  },
  shortcutCleanupErased: {
    en: 'Everything on this phone is gone and the relay rejects this iPhone’s token from now on. The Wafra Capture Shortcut is still installed, and it still sends each bank alert you pointed it at over the network, where it is now refused. Only you can delete it: Shortcuts → Automation → delete the Wafra automation, then My Shortcuts → delete Wafra Capture.',
    ar: 'حُذف كل شيء على هذا الهاتف وأصبح المرحّل يرفض رمز هذا الآيفون من الآن. لكن اختصار «Wafra Capture» ما زال مثبّتاً، وما زال يرسل كل تنبيه بنكي وجّهته إليه عبر الشبكة حيث يُرفض الآن. أنت وحدك من يستطيع حذفه: الاختصارات ← الأتمتة ← احذف أتمتة وفرة، ثم اختصاراتي ← احذف Wafra Capture.',
  },
  shortcutCleanupLeft: {
    en: 'This iPhone’s relay token is revoked, so nothing it sends can be filed again. The Wafra Capture Shortcut is still installed and still forwards each bank alert you pointed it at over the network, where it is now refused. Only you can delete it: Shortcuts → Automation → delete the Wafra automation, then My Shortcuts → delete Wafra Capture.',
    ar: 'أُلغي رمز ترحيل هذا الآيفون، فلن يُسجَّل أي شيء يرسله بعد الآن. لكن اختصار «Wafra Capture» ما زال مثبّتاً وما زال يمرّر كل تنبيه بنكي وجّهته إليه عبر الشبكة حيث يُرفض الآن. أنت وحدك من يستطيع حذفه: الاختصارات ← الأتمتة ← احذف أتمتة وفرة، ثم اختصاراتي ← احذف Wafra Capture.',
  },
  shortcutCleanupUncertain: {
    en: 'Wafra could not confirm that this iPhone’s relay token was revoked. Automatic capture is off in Wafra, but the installed Shortcut may still forward selected bank alerts over the network. Delete it now in Shortcuts → Automation, then My Shortcuts, and retry disconnection when you are online.',
    ar: 'تعذّر على وفرة تأكيد إلغاء رمز ترحيل هذا الآيفون. الالتقاط التلقائي متوقف داخل وفرة، لكن الاختصار المثبّت قد يستمر في تمرير تنبيهات البنوك المحددة عبر الشبكة. احذفه الآن من الاختصارات ← الأتمتة، ثم «اختصاراتي»، وأعد محاولة الفصل عند توفر الإنترنت.',
  },
  /**
   * Removing SOMEBODY ELSE'S iPhone. Their Shortcut is on their phone, which
   * this app cannot reach at all — so this is guidance to pass on, not a
   * button anyone here can press.
   */
  trustedRemoveShortcutNote: {
    en: 'If that device is an iPhone, its Wafra Capture Shortcut keeps sending bank alerts to the relay — refused from now on, but still leaving that phone. Only its owner can delete it, in the Shortcuts app.',
    ar: 'إذا كان ذلك الجهاز آيفون، فسيظل اختصار «Wafra Capture» فيه يرسل التنبيهات البنكية إلى المرحّل — مرفوضة من الآن، لكنها تغادر ذلك الهاتف فعلاً. مالك الجهاز وحده يستطيع حذفه من تطبيق الاختصارات.',
  },
  activeOnThisDevice: { en: 'Active on this device', ar: 'مفعّل على هذا الجهاز' },
  followingPhone: { en: 'Following your phone. Wafra turns over when it does.', ar: 'يتبع هاتفك. يتغيّر وفرة بتغيّره.' },
  alertEveryCharge: { en: 'Alert me on every charge', ar: 'نبّهني عند كل عملية' },
  turnOnSmsFirst: { en: 'Turn on bank SMS first', ar: 'فعّل قراءة رسائل البنك أولاً' },
  turnOnSmsFirstBody: { en: 'Wafra can only alert you about a charge it is allowed to read.', ar: 'لا يمكن لوفرة تنبيهك عن عملية لا يُسمح له بقراءتها.' },
  unhide: { en: 'Unhide', ar: 'إظهار' },
  hideFromLists: { en: 'Hide from lists', ar: 'إخفاء من القوائم' },
  hidden: { en: 'Hidden', ar: 'مخفي' },
  noActivity90: { en: 'No activity for 90+ days', ar: 'لا نشاط منذ أكثر من 90 يوماً' },
  pasteBankMessage: { en: 'Paste a bank message', ar: 'ألصق رسالة بنكية' },
  inboxNotRead: { en: 'Inbox not read yet', ar: 'لم تُقرأ الرسائل بعد' },
  inboxNeedsAndroid: { en: 'Reading the inbox needs the Android app; pasting works anywhere', ar: 'قراءة الرسائل تحتاج تطبيق أندرويد؛ اللصق يعمل في كل مكان' },
  deleteCardAndEntries: { en: 'Delete card and its entries', ar: 'حذف البطاقة وعملياتها' },
  notASubscriptionQ: { en: 'Not a subscription?', ar: 'ليس اشتراكاً؟' },
  stillLoading: { en: 'Still loading your data — try again in a second.', ar: 'ما زال تحميل بياناتك جارياً — أعد المحاولة بعد لحظة.' },
  upToDateNoNew: { en: 'Up to date. No new bank messages.', ar: 'كل شيء محدّث. لا رسائل بنكية جديدة.' },
  rescanHint: { en: 'Rescans your whole inbox and shows what would be filed. Cards are matched automatically and nothing imports twice. You can also paste messages below.', ar: 'يعيد فحص كل رسائلك ويعرض ما سيُسجَّل. تُطابَق البطاقات تلقائياً ولا يُستورد شيء مرتين. يمكنك أيضاً لصق رسائل بالأسفل.' },
  pasteHint: { en: 'Paste one or more bank alerts below, separated by a blank line. Everything is read on this device.', ar: 'ألصق رسالة بنكية أو أكثر بالأسفل، بينها سطر فارغ. تُقرأ كلها على هذا الجهاز.' },
  whereItWent: { en: 'Where it went', ar: 'أين ذهبت' },
  addedByHand: { en: 'Added by hand', ar: 'أُضيفت يدوياً' },
  appLockPhoneOnly: { en: 'App lock works on the phone app only.', ar: 'قفل التطبيق يعمل على تطبيق الهاتف فقط.' },
  notifsPhoneOnly: { en: 'Bank app notifications work on the phone app only.', ar: 'إشعارات تطبيقات البنوك تعمل على تطبيق الهاتف فقط.' },
  couldNotReadFile: { en: 'Could not read file', ar: 'تعذّرت قراءة الملف' },
  deleteThisEntry: { en: 'Delete this entry?', ar: 'حذف هذه العملية؟' },
  hiddenFromLists: { en: 'Hidden from lists.', ar: 'مخفي من القوائم.' },
  markStatementPaid: { en: 'Mark this statement paid?', ar: 'تعليم هذا الكشف كمدفوع؟' },
  noCardPaymentYet: { en: 'No payment to this card has been detected yet.', ar: 'لم تُكتشف أي دفعة لهذه البطاقة بعد.' },
  notRecurringQ: { en: 'Not a recurring charge?', ar: 'ليست عملية متكررة؟' },
  notifsAreOff: { en: 'Notifications are off', ar: 'الإشعارات مغلقة' },
  onboardPrivacyBody: {
    en: 'Add entries yourself or connect supported bank alerts',
    ar: 'أضف العمليات بنفسك أو اربط تنبيهات البنوك المدعومة',
  },
  readMyInbox: { en: 'Read my inbox', ar: 'اقرأ رسائلي' },
  setCreditLimit: { en: 'Set credit limit', ar: 'تحديد حد الائتمان' },
  notifAccessBody: { en: 'Some banks send push notifications instead of SMS. Grant Wafra notification access and ', ar: 'ترسل بعض البنوك إشعارات بدل الرسائل. امنح وفرة إذن قراءة الإشعارات و' },
  notAWafraBackup: { en: 'That does not look like a Wafra backup.', ar: 'لا يبدو هذا ملف نسخ احتياطي لوفرة.' },
  noServerTitle: { en: 'Processed on this phone', ar: 'تُعالَج على هذا الهاتف' },
  restoreReplacesAll: { en: 'This replaces everything currently in the app.', ar: 'سيستبدل هذا كل ما في التطبيق حالياً.' },
  trySensorAgain: { en: 'Try the sensor again', ar: 'جرّب المستشعر مرة أخرى' },
  upToDate: { en: 'Up to date', ar: 'كل شيء محدّث' },
  notifsForCardDue: { en: 'Wafra needs notification permission to remind you before a payment is due.', ar: 'يحتاج وفرة إذن الإشعارات لتذكيرك قبل موعد السداد.' },
  notifsForBill: { en: 'Wafra needs notification permission to warn you before a charge lands.', ar: 'يحتاج وفرة إذن الإشعارات لتنبيهك قبل خصم أي مبلغ.' },
  warnsBeforeMoneyLeaves: { en: 'Warns before the money leaves', ar: 'ينبّهك قبل خروج المال' },
  readInboxLater: { en: 'You can read your inbox later from Wallet.', ar: 'يمكنك قراءة رسائلك لاحقاً من المحفظة.' },
  dataStillLoading: { en: 'Your data is still loading. Try again in a second.', ar: 'ما زال تحميل بياناتك جارياً. أعد المحاولة بعد لحظة.' },
  historyIsIn: { en: 'Your history is in.', ar: 'تم إدخال سجلّك.' },
  inVsOut6: { en: 'Income vs spent · 6 months', ar: 'الدخل مقابل الإنفاق · ٦ أشهر' },
  noEntriesPeriod: { en: 'No entries in this period yet', ar: 'لا عمليات في هذه الفترة بعد' },
  totalCreditLimit: { en: 'Total credit limit', ar: 'إجمالي حد الائتمان' },
  parsePastedText: { en: 'Parse pasted text', ar: 'تحليل النص الملصق' },
  billRemindersDetected: { en: 'Bill reminders detected', ar: 'تم اكتشاف تذكيرات فواتير' },
  searchMerchants: { en: 'Search merchants or categories', ar: 'ابحث في المتاجر أو التصنيفات' },
  remindDayBefore: { en: 'Remind me the day before', ar: 'ذكّرني قبل يوم' },
  cardPaymentDue: { en: 'Card payment due', ar: 'دفعة بطاقة مستحقة' },
  transferBetweenMine: { en: 'Transfer between my accounts', ar: 'تحويل بين حساباتي' },
  openPhoneSettings: { en: 'Open phone settings', ar: 'افتح إعدادات الهاتف' },
  billRecordsExpense: { en: 'Records an expense of {amount} today.', ar: 'يسجّل مصروفاً بقيمة {amount} اليوم.' },
  overdueAndLeaving: { en: 'Overdue and leaving in {days} days', ar: 'متأخرة وتخرج خلال {days} أيام' },
  merchantRuleOnly: { en: 'Future imports from {merchant} will use this category.', ar: 'ستستخدم العمليات القادمة من {merchant} هذا التصنيف.' },
  merchantRuleAlso: { en: 'Future imports from {merchant} will use this category. Also update {n} existing {entries}?', ar: 'ستستخدم العمليات القادمة من {merchant} هذا التصنيف. هل تحدّث أيضاً {n} من العمليات الحالية؟' },
  leavingInDays: { en: 'Leaving in {days} days', ar: 'تخرج خلال {days} أيام' },
  rememberForMerchant: { en: 'Remember for {merchant}?', ar: 'تذكّر لـ {merchant}؟' },
  notifAccessFull: { en: 'Some banks send push notifications instead of SMS. Grant Wafra notification access and money alerts import automatically. Only alerts that mention an amount are kept, and they never leave this phone.', ar: 'ترسل بعض البنوك إشعارات بدل الرسائل. امنح وفرة إذن قراءة الإشعارات لتُستورد تنبيهات المال تلقائياً. تُحفظ فقط التنبيهات التي تذكر مبلغاً، ولا تغادر هذا الهاتف أبداً.' },
  startWithSample: { en: 'Start with sample data', ar: 'ابدأ ببيانات تجريبية' },
  alsoReadNotifs: { en: 'Also read bank notifications', ar: 'اقرأ أيضاً إشعارات البنوك' },
  // Storage recovery. Shown INSTEAD of onboarding when the encrypted ledger
  // could not be read: the app cannot tell a new phone from an unreadable one,
  // and offering a fresh start to the second is how the ledger gets destroyed.
  // The copy has one job — say that nothing has been lost yet — so it must not
  // hedge, and it must never carry a native error string.
  storageRecoveryTitle: { en: 'Your ledger could not be opened', ar: 'تعذّر فتح سجلك' },
  storageRecoveryBody: {
    en: 'Wafra could not read the encrypted ledger on this device. Nothing has been changed or deleted — your entries are still here, and saving is paused so nothing can write over them.',
    ar: 'تعذّر على وفرة قراءة السجل المشفّر على هذا الجهاز. لم يُغيَّر أو يُحذف أي شيء — عملياتك ما زالت موجودة، وأُوقف الحفظ مؤقتاً كي لا يُكتب فوقها شيء.',
  },
  storageRecoveryInitializeTitle: {
    en: 'Your data was erased',
    ar: 'تم محو بياناتك',
  },
  storageRecoveryInitializeBody: {
    en: 'Wafra deleted the old ledger, but secure storage did not restart. Saving is paused so new changes cannot appear successful and then disappear. Try again to finish creating the empty encrypted ledger.',
    ar: 'حذفت وفرة السجل القديم، لكن التخزين الآمن لم يُعَد تشغيله. أُوقف الحفظ كي لا تبدو التغييرات الجديدة ناجحة ثم تختفي. أعد المحاولة لإكمال إنشاء السجل المشفّر الفارغ.',
  },
  storageRecoveryCleanupBody: {
    en: 'The ledger was erased, but encrypted captured messages are still waiting on this phone. Import and saving are paused so those entries cannot return. Try again to delete them and durably create the empty ledger.',
    ar: 'تم محو السجل، لكن ما زالت رسائل بنكية مشفّرة بانتظار الاستيراد على هذا الهاتف. أُوقف الاستيراد والحفظ كي لا تعود تلك العمليات. أعد المحاولة لحذفها وإنشاء السجل الفارغ بشكل دائم.',
  },
  // The one failure where "try again" would be a lie: the file is intact and
  // the key that opens it is gone, so no number of retries can decrypt it.
  storageRecoveryKeyBody: {
    en: 'The encrypted ledger is still on this device, but the key that opens it is no longer in this phone’s secure storage. Nothing has been changed or deleted, and saving is paused. Trying again will not recover it.',
    ar: 'السجل المشفّر ما زال على هذا الجهاز، لكن المفتاح الذي يفتحه لم يعد في التخزين الآمن للهاتف. لم يُغيَّر أو يُحذف أي شيء، وأُوقف الحفظ مؤقتاً. إعادة المحاولة لن تستعيده.',
  },
  storageRecoveryHint: {
    en: 'Unlocking this phone and trying again resolves most cases.',
    ar: 'فتح قفل الهاتف ثم إعادة المحاولة يحلّ معظم الحالات.',
  },
  storageRecoveryRetry: { en: 'Try again', ar: 'إعادة المحاولة' },
  storageRecoveryRetrying: { en: 'Trying again…', ar: 'جارٍ إعادة المحاولة…' },
  storageRecoveryRetryFailed: {
    en: 'Still could not open your ledger. Nothing has been changed.',
    ar: 'ما زال تعذّر فتح سجلك. لم يُغيَّر أي شيء.',
  },
  storageRecoveryInitializeRetryFailed: {
    en: 'Secure storage still could not restart. Saving remains paused.',
    ar: 'ما زال تعذّر إعادة تشغيل التخزين الآمن. سيبقى الحفظ متوقفاً.',
  },
  storageRecoveryCleanupRetryFailed: {
    en: 'Captured messages still could not be deleted. Import and saving remain paused.',
    ar: 'ما زال تعذّر حذف الرسائل الملتقطة. سيبقى الاستيراد والحفظ متوقفين.',
  },
  storageRecoveryEraseCta: { en: 'Erase and start over', ar: 'محو والبدء من جديد' },
  storageRecoveryEraseTitle: { en: 'Erase everything on this device?', ar: 'محو كل شيء على هذا الجهاز؟' },
  storageRecoveryEraseBody: {
    en: 'This destroys Wafra’s encrypted ledger and any captured messages waiting inside Wafra. It cannot be undone. Bank SMS remain in Messages, and on iPhone you must separately delete the Wafra Shortcut automation.',
    ar: 'سيؤدي هذا إلى إتلاف سجل وفرة المشفّر وأي رسائل ملتقطة تنتظر داخل وفرة. لا يمكن التراجع. ستبقى رسائل البنك في تطبيق الرسائل، وعلى الآيفون يجب حذف أتمتة اختصار وفرة بشكل منفصل.',
  },
  storageRecoveryEraseConfirm: { en: 'Erase permanently', ar: 'محو نهائي' },
  storageRecoveryEraseKeep: { en: 'Keep my data', ar: 'احتفظ ببياناتي' },
  storageRecoveryEraseFailed: {
    en: 'The erase did not finish. Wafra is keeping recovery open and saving paused until you try again.',
    ar: 'لم تكتمل عملية المحو. ستُبقي وفرة شاشة الاسترداد مفتوحة والحفظ متوقفاً حتى تعيد المحاولة.',
  },
  appName: { en: 'Wafra', ar: 'وفرة' },
  recommended: { en: 'RECOMMENDED', ar: 'مقترح' },
  onboardEyebrow: { en: 'YOUR MONEY, MADE CLEAR', ar: 'أموالك، بصورة أوضح' },
  onboardHeadline: { en: 'Know where your money went—without the detective work.', ar: 'اعرف أين ذهبت أموالك، دون عناء البحث.' },
  onboardSub: {
    en: 'Wafra turns supported bank alerts into one clear story: what came in, what was spent, and what is due next.',
    ar: 'يحوّل وفرة تنبيهات البنوك المدعومة إلى صورة واضحة: ما دخل، وما صُرف، وما يستحق لاحقاً.',
  },
  onboardPersonalizeCta: { en: 'Get started', ar: 'ابدأ الآن' },
  onboardSetupTime: { en: 'No bank login required', ar: 'لا يتطلب تسجيل الدخول إلى البنك' },
  onboardPreviewOverline: { en: 'EXAMPLE MONEY STORY', ar: 'مثال لصورة مالية' },
  onboardPreviewLive: { en: 'WHAT WAFRA CAN ORGANISE', ar: 'ما يمكن لوفرة تنظيمه' },
  onboardPreviewIncome: { en: 'Talabat payout', ar: 'دفعة طلبات' },
  onboardPreviewIncomeDetail: { en: 'Income recognised', ar: 'تم التعرف عليها كدخل' },
  onboardPreviewBill: { en: 'SEWA bill', ar: 'فاتورة سيوا' },
  onboardPreviewBillDetail: { en: 'Due date brought forward', ar: 'موعد الاستحقاق أمامك' },
  onboardPreviewCard: { en: 'Card payment', ar: 'دفعة بطاقة' },
  onboardPreviewCardDetail: { en: 'Matched and counted once', ar: 'تمت مطابقتها واحتسابها مرة واحدة' },
  onboardPreviewFooter: { en: 'One timeline. No spreadsheet cleanup.', ar: 'مسار واحد، دون ترتيب جداول.' },
  onboardPreviewAccessibility: {
    en: 'Example: Wafra can recognise income, bring bills forward, and count matched card payments once.',
    ar: 'مثال: يمكن لوفرة التعرف على الدخل وعرض الفواتير واحتساب دفعات البطاقات المتطابقة مرة واحدة.',
  },
  onboardStepOf: { en: 'Step {step} of {total}', ar: 'الخطوة {step} من {total}' },
  onboardBack: { en: 'Back', ar: 'رجوع' },
  onboardMarketTitle: { en: 'Where does your money live?', ar: 'أين تعيش أموالك؟' },
  onboardMarketBody: {
    en: 'This sets the currency and local money calendar across Wafra.',
    ar: 'يحدّد هذا العملة وتقويمك المالي المحلي في وفرة.',
  },
  onboardMarketUae: { en: 'United Arab Emirates', ar: 'الإمارات العربية المتحدة' },
  onboardMarketUaeDetail: { en: 'AED · UAE bank coverage', ar: 'درهم · دعم البنوك الإماراتية' },
  onboardMarketSaudi: { en: 'Saudi Arabia', ar: 'المملكة العربية السعودية' },
  onboardMarketSaudiDetail: { en: 'SAR · Saudi money format', ar: 'ريال · تنسيق الأموال السعودي' },
  onboardGoalsTitle: { en: 'What are you building towards?', ar: 'نحو ماذا تدّخر؟' },
  onboardGoalsBody: {
    en: 'Choose up to two. Wafra will add them to your wallet now.',
    ar: 'اختر هدفين كحد أقصى. سيضيفهما وفرة إلى محفظتك الآن.',
  },
  onboardGoalMax: { en: 'Two goals is the limit for setup.', ar: 'يمكن اختيار هدفين أثناء الإعداد.' },
  onboardGoalEmergency: { en: 'Emergency fund', ar: 'صندوق الطوارئ' },
  onboardGoalEmergencyDetail: { en: 'A visible safety buffer', ar: 'احتياطي أمان واضح أمامك' },
  onboardGoalTravel: { en: 'A proper holiday', ar: 'إجازة تستحقها' },
  onboardGoalTravelDetail: { en: 'Flights, stays, and spending money', ar: 'رحلات وإقامة ومصروف' },
  onboardGoalHome: { en: 'A home deposit', ar: 'دفعة منزل أولى' },
  onboardGoalHomeDetail: { en: 'Make the first big milestone visible', ar: 'اجعل أول محطة كبيرة واضحة' },
  onboardBudgetTitle: { en: 'Choose your starting limits.', ar: 'اختر حدودك المبدئية.' },
  onboardBudgetBody: {
    en: 'Five real category budgets are ready now. Change any of them later.',
    ar: 'خمس ميزانيات فعلية جاهزة الآن. يمكنك تعديل أي منها لاحقاً.',
  },
  onboardBudgetEssentials: { en: 'Essentials first', ar: 'الأساسيات أولاً' },
  onboardBudgetEssentialsDetail: { en: 'A tighter plan for focused months', ar: 'خطة أدق للأشهر المنضبطة' },
  onboardBudgetBalanced: { en: 'Balanced', ar: 'متوازنة' },
  onboardBudgetBalancedDetail: { en: 'Comfort with clear guardrails', ar: 'راحة مع حدود واضحة' },
  onboardBudgetFlexible: { en: 'More flexible', ar: 'أكثر مرونة' },
  onboardBudgetFlexibleDetail: { en: 'More room for dining and shopping', ar: 'مساحة أكبر للمطاعم والتسوق' },
  onboardBudgetPreview: {
    en: '{count} limits · {amount} per month',
    ar: '{count} حدود · {amount} شهرياً',
  },
  onboardMoneyMonthTitle: { en: 'When does your money month begin?', ar: 'متى يبدأ شهرك المالي؟' },
  onboardMoneyMonthBody: {
    en: 'Charts, budgets, and insights will all follow this date.',
    ar: 'ستتبع الرسوم والميزانيات والرؤى هذا التاريخ.',
  },
  onboardCalendarMonth: { en: 'Calendar month', ar: 'الشهر الميلادي' },
  onboardCalendarMonthDetail: { en: 'Starts on day 1', ar: 'يبدأ في اليوم 1' },
  onboardSalaryDay: { en: 'Salary day', ar: 'يوم الراتب' },
  onboardDayNumber: { en: 'Day {day}', ar: 'اليوم \u2066{day}\u2069' },
  onboardCaptureTitleAndroid: { en: 'How should Wafra stay up to date?', ar: 'كيف تريد أن يبقى وفرة محدّثاً؟' },
  onboardCaptureBodyAndroid: {
    en: 'Automatic capture needs Android SMS permission. Manual entry needs no message access.',
    ar: 'يحتاج الالتقاط التلقائي إلى إذن رسائل أندرويد. لا يحتاج الإدخال اليدوي إلى الوصول للرسائل.',
  },
  onboardCaptureTitleIos: { en: 'How should Wafra stay up to date?', ar: 'كيف تريد أن يبقى وفرة محدّثاً؟' },
  onboardCaptureBodyIos: {
    en: 'Automatic capture uses a personal Apple Shortcut. Manual entry needs no Messages access.',
    ar: 'يستخدم الالتقاط التلقائي اختصاراً شخصياً من آبل. لا يحتاج الإدخال اليدوي إلى الوصول للرسائل.',
  },
  onboardCaptureTitleWeb: { en: 'Your plan is ready.', ar: 'خطتك جاهزة.' },
  onboardCaptureBodyWeb: {
    en: 'Automatic bank-message capture is available in the phone apps.',
    ar: 'التقاط رسائل البنك تلقائياً متاح في تطبيقات الهاتف.',
  },
  onboardCaptureAndroidCta: { en: 'Enable automatic SMS capture', ar: 'فعّل الالتقاط التلقائي للرسائل' },
  onboardCaptureIosCta: { en: 'Set up automatic capture', ar: 'إعداد الالتقاط التلقائي' },
  onboardAutomaticChoice: { en: 'Keep it automatic', ar: 'اجعله تلقائياً' },
  onboardAutomaticChoiceAndroidBody: {
    en: 'Build history now, then file supported bank SMS as they arrive.',
    ar: 'أنشئ السجل الآن، ثم صنّف رسائل البنوك المدعومة عند وصولها.',
  },
  onboardAutomaticChoiceIosBody: {
    en: 'Connect a personal Shortcut for the bank conversations you choose.',
    ar: 'اربط اختصاراً شخصياً لمحادثات البنوك التي تختارها.',
  },
  onboardManualChoice: { en: 'I’ll add things myself', ar: 'سأضيف العمليات بنفسي' },
  onboardManualChoiceBody: {
    en: 'Start with a private empty ledger. Automatic capture stays available later.',
    ar: 'ابدأ بسجل خاص وفارغ. ويمكنك تفعيل الالتقاط التلقائي لاحقاً.',
  },
  onboardAlertsChecked: { en: 'alerts checked', ar: 'تنبيهات تم فحصها' },
  onboardMoneyFound: { en: 'money entries found', ar: 'عمليات مالية وُجدت' },
  onboardEntryFound: { en: 'entry organised', ar: 'عملية تم تنظيمها' },
  onboardEntriesFound: { en: 'entries organised', ar: 'عمليات تم تنظيمها' },
  onboardAccountFound: { en: 'account recognised', ar: 'حساب تم التعرف عليه' },
  onboardAccountsFound: { en: 'accounts recognised', ar: 'حسابات تم التعرف عليها' },
  onboardCaptureSkip: { en: 'Finish without capture', ar: 'إنهاء دون التقاط' },
  onboardCaptureNoSms: { en: 'Maximum privacy · no SMS access', ar: 'أقصى خصوصية · دون وصول إلى الرسائل' },
  onboardCapturePrivacyAndroid: {
    en: 'Automatic SMS capture processes supported bank alerts only on this phone and never uploads SMS content. Anything else is discarded before app storage. Or choose maximum privacy for no SMS access.',
    ar: 'يعالج الالتقاط التلقائي تنبيهات البنوك المدعومة على هذا الهاتف فقط، ولا يرفع محتوى الرسائل. ويُتخلص من أي محتوى لا يمثل نشاطاً مالياً مدعوماً قبل تخزينه في وفرة. أو اختر أقصى خصوصية دون أي وصول إلى الرسائل.',
  },
  onboardCapturePrivacyIos: {
    en: 'Automatic capture forwards alerts only from bank conversations you select. Wafra’s encrypted relay parses them, discards raw text immediately, and queues only a device-sealed transaction. Or choose maximum privacy for no Messages access.',
    ar: 'يمرّر الالتقاط التلقائي التنبيهات فقط من محادثات البنوك التي تختارها. يحللها مُرحّل وفرة المشفر، ويتخلص فوراً من النص الخام، ولا يضع في الطابور إلا عملية مشفرة لجهازك. أو اختر أقصى خصوصية دون أي وصول إلى الرسائل.',
  },
  onboardSmsDenied: {
    en: 'SMS access was not granted. You can continue and enable capture later.',
    ar: 'لم يُمنح إذن الرسائل. يمكنك المتابعة وتفعيل الالتقاط لاحقاً.',
  },
  onboardCompleteTitle: { en: 'Wafra is yours.', ar: 'وفرة أصبح لك.' },
  onboardCompleteManualTitle: { en: 'Ready when you are.', ar: 'جاهز عندما تكون جاهزاً.' },
  onboardCompleteManualBody: {
    en: 'Start with a manual entry. You can turn on automatic bank-alert capture at any time.',
    ar: 'ابدأ بإدخال يدوي. ويمكنك تفعيل التقاط تنبيهات البنك تلقائياً في أي وقت.',
  },
  onboardCompleteNeedsAttentionTitle: { en: 'You can still continue.', ar: 'لا يزال بإمكانك المتابعة.' },
  onboardCompleteNeedsAttentionBody: {
    en: 'Wafra could not finish checking your inbox. Your ledger is ready, and you can try automatic capture again later.',
    ar: 'تعذّر على وفرة إكمال فحص الرسائل. سجلك جاهز، ويمكنك تجربة الالتقاط التلقائي لاحقاً.',
  },
  onboardCompleteBody: {
    en: '{goals} goal{s}, {budgets} live budgets, and a money month from day {day}.',
    ar: '{goals} أهداف و{budgets} ميزانيات مفعّلة، وشهر مالي يبدأ في اليوم \u2066{day}\u2069.',
  },
  onboardCompleteBodyAutomatic: {
    en: 'Wafra identifies each supported bank alert automatically. Your ledger currency is confirmed by the first transaction you choose to add—not by a country guess.',
    ar: 'يتعرّف وفرة تلقائياً على كل تنبيه بنكي مدعوم. تتحدد عملة سجلك بأول عملية تختار إضافتها، لا بتخمين الدولة.',
  },
  onboardSummaryGoals: { en: 'Savings goals', ar: 'أهداف الادخار' },
  onboardSummaryBudgets: { en: 'Category budgets', ar: 'ميزانيات التصنيفات' },
  onboardSummaryMonth: { en: 'Money month', ar: 'الشهر المالي' },
  onboardSummaryActive: { en: '{count} active', ar: '{count} مفعّلة' },
  onboardReadsSms: { en: 'Start your way', ar: 'ابدأ بطريقتك' },
  onboardWarnsDetail: { en: 'Card dues, utility bills, rent, and quiet subscriptions', ar: 'مستحقات البطاقات وفواتير الخدمات والإيجار والاشتراكات الصامتة' },
  onboardNoServerDetail: {
    en: 'Android bank-message text is never uploaded',
    ar: 'لا يُرفع نص رسائل البنك من أندرويد أبداً',
  },
  onboardStartTitle: { en: 'Start somewhere.', ar: 'ابدأ من نقطة ما.' },
  inboxChecked: { en: 'Inbox checked.', ar: 'تم فحص الرسائل.' },
  onboardStartEmpty: { en: 'Start empty', ar: 'ابدأ بسجل فارغ' },
  onboardWebChoice: {
    en: 'Reading SMS works in the Android app. Pick a starting point:',
    ar: 'قراءة الرسائل تعمل في تطبيق أندرويد. اختر نقطة البداية:',
  },
  iosOnboardHeadline: {
    en: 'Know where your money went—without the detective work.',
    ar: 'اعرف أين ذهبت أموالك، دون عناء البحث.',
  },
  iosOnboardSub: {
    en: 'Wafra turns supported bank alerts into one clear story: what came in, what was spent, and what is due next.',
    ar: 'يحوّل وفرة تنبيهات البنوك المدعومة إلى صورة واضحة: ما دخل، وما صُرف، وما يستحق لاحقاً.',
  },
  iosOnboardAutomatic: { en: 'Start your way', ar: 'ابدأ بطريقتك' },
  iosOnboardAutomaticBody: {
    en: 'Add entries yourself or connect supported bank alerts',
    ar: 'أضف العمليات بنفسك أو اربط تنبيهات البنوك المدعومة',
  },
  iosOnboardPrivate: { en: 'Raw messages are never kept', ar: 'نص الرسالة الخام لا يُحفظ أبداً' },
  iosOnboardPrivateBody: {
    en: 'The relay parses, discards the text, and seals the transaction to this iPhone',
    ar: 'يحلّل المرحّل الرسالة ثم يحذف نصها ويشفّر العملية لهذا الآيفون وحده',
  },
  iosOnboardSetupTitle: { en: 'Make it automatic.', ar: 'اجعله تلقائياً.' },
  iosOnboardSetupBody: {
    en: 'A guided setup connects the private relay. Your first real bank alert verifies Apple’s automation afterward.',
    ar: 'إعداد موجه يربط المرحّل الخاص. وبعده يتحقق أول تنبيه بنكي حقيقي من أتمتة آبل.',
  },
  iosOnboardSetupCta: { en: 'Set up automatic capture', ar: 'إعداد الالتقاط التلقائي' },
  readingInbox: { en: 'Reading your inbox.', ar: 'جارٍ قراءة رسائلك.' },
  openWafra: { en: 'Open Wafra', ar: 'افتح وفرة' },
  continueWord: { en: 'Continue', ar: 'متابعة' },
  notifNoteOnboard: {
    en: 'Android calls this broad “read, reply & control” access. Wafra only reads supported bank alerts; it never replies or changes a notification.',
    ar: 'يسمي أندرويد هذا الإذن الواسع «قراءة ورد وتحكم». وفرة يقرأ تنبيهات البنوك المدعومة فقط، ولا يرد على إشعار أو يغيّره.',
  },
  nothingOutYet: { en: 'No spending in this period yet.', ar: 'لا يوجد إنفاق في هذه الفترة بعد.' },
  noAccountsYet: { en: 'No bank or cash accounts yet.', ar: 'لا حسابات بنكية أو نقدية بعد.' },
  noStatementYet: { en: 'No statement message has arrived for this card yet.', ar: 'لم تصل رسالة كشف حساب لهذه البطاقة بعد.' },
  // Not "none yet" — none ever. A debit card spends the money already in the
  // account, so it issues no statement and there is no bill to pay toward it.
  debitHasNoStatement: {
    en: 'A debit card has no statement and no bill to pay — it spends the balance in the account.',
    ar: 'بطاقة الخصم المباشر ليس لها كشف حساب ولا فاتورة تُسدَّد — فهي تنفق الرصيد الموجود في الحساب.',
  },
  underMinimumDue: { en: 'Still under the minimum due.', ar: 'ما زال أقل من الحد الأدنى المستحق.' },
  transferExplainer: { en: 'Kept in balances, excluded from income and spending', ar: 'يُحتسب في الأرصدة ويُستثنى من الدخل والمصروف' },
  perYear: { en: 'per year', ar: 'سنوياً' },
  playOnlyTitle: { en: 'Purchases unavailable in this build', ar: 'الشراء غير متاح في هذا الإصدار' },
  playOnlyBody: {
    en: 'Install Wafra from the App Store or Google Play to purchase Pro.',
    ar: 'ثبّت وفرة من App Store أو Google Play لشراء برو.',
  },
  priceLoading: { en: 'Loading price…', ar: 'جارٍ تحميل السعر…' },
  priceUnavailable: { en: 'Price unavailable', ar: 'السعر غير متاح' },
  priceUnavailableBody: {
    en: 'The store did not return this plan. Check your connection and try loading prices again.',
    ar: 'لم يُرجع المتجر هذه الخطة. تحقّق من الاتصال وحاول تحميل الأسعار مجدداً.',
  },
  retryPrices: { en: 'Try loading prices again', ar: 'إعادة تحميل الأسعار' },
  manageSubscription: { en: 'Manage or cancel subscription', ar: 'إدارة الاشتراك أو إلغاؤه' },
  manageSubscriptionFailed: { en: 'Could not open subscriptions', ar: 'تعذّر فتح الاشتراكات' },
  manageSubscriptionFailedBody: {
    en: 'Open your App Store or Google Play account to manage the subscription.',
    ar: 'افتح حسابك في App Store أو Google Play لإدارة الاشتراك.',
  },
  subscriptionRenewalTermsIos: {
    en: 'Payment is charged to your store account. The subscription renews automatically unless cancelled at least 24 hours before the current period ends.',
    ar: 'يُخصم المبلغ من حساب المتجر. يتجدد الاشتراك تلقائياً ما لم يُلغَ قبل 24 ساعة على الأقل من نهاية الفترة الحالية.',
  },
  subscriptionRenewalTermsAndroid: {
    en: 'Payment is charged to Google Play. The subscription renews automatically unless cancelled in Google Play before the next renewal date; access continues through the paid period.',
    ar: 'يُخصم المبلغ من Google Play. يتجدد الاشتراك تلقائياً ما لم يُلغَ في Google Play قبل موعد التجديد التالي، ويستمر الوصول حتى نهاية المدة المدفوعة.',
  },
  privacyPolicy: { en: 'Privacy Policy', ar: 'سياسة الخصوصية' },
  termsOfUse: { en: 'Terms of Use', ar: 'شروط الاستخدام' },
  purchaseUnavailable: { en: 'Purchase unavailable', ar: 'الشراء غير متاح' },
  purchaseLegalMissingBody: {
    en: 'Purchases are temporarily unavailable because the required legal links are not configured.',
    ar: 'الشراء غير متاح مؤقتاً لأن الروابط القانونية المطلوبة غير مهيأة.',
  },
  legalLinkFailed: { en: 'Could not open the legal page', ar: 'تعذّر فتح الصفحة القانونية' },
  legalLinkFailedBody: {
    en: 'Check your connection and try the link again.',
    ar: 'تحقق من اتصالك وحاول فتح الرابط مرة أخرى.',
  },
  nothingToRestore: { en: 'Nothing to restore', ar: 'لا شيء لاستعادته' },
  nothingToRestoreBody: { en: 'Install Wafra from the App Store or Google Play to restore a purchase.', ar: 'ثبّت وفرة من App Store أو Google Play لاستعادة عملية شراء.' },
  noPurchaseFound: { en: 'No purchase found', ar: 'لم يُعثر على عملية شراء' },
  noPurchaseFoundBody: {
    en: 'No previous Wafra Pro purchase was found on this store account.',
    ar: 'لم يُعثر على عملية شراء سابقة لوفرة برو في حساب المتجر هذا.',
  },
  // Deliberately NOT noPurchaseFound: the store was never reached, so nothing
  // is known about what this account has bought.
  restoreFailed: { en: 'Could not reach the store', ar: 'تعذّر الوصول إلى المتجر' },
  restoreFailedBody: {
    en: 'Your purchase has not been checked yet. Check your connection and try again.',
    ar: 'لم يتم التحقق من عملية الشراء بعد. تحقق من الاتصال وحاول مرة أخرى.',
  },
  purchaseFailed: { en: 'Purchase not confirmed', ar: 'لم يتم تأكيد الشراء' },
  purchaseFailedBody: {
    en: 'The store could not confirm Pro yet. Check your connection, then restore purchases before trying to buy again.',
    ar: 'لم يتمكن المتجر من تأكيد وفرة برو بعد. تحقق من الاتصال، ثم استعد المشتريات قبل محاولة الشراء مجدداً.',
  },
  monthsFreeSuffix: { en: '· {months} months free', ar: '· {months} أشهر مجاناً' },
  trialDaysLeftPaywall: {
    en: 'Everything is free for your first {total} days — {left} day{s} left. Keep it going:',
    ar: 'كل شيء مجاني في أول {total} أيام — تبقّى {left} يوم. تابع الاستخدام:',
  },
  featAutoTracking: { en: 'Automatic tracking', ar: 'تتبع تلقائي' },
  featAutoTrackingText: { en: 'Bank SMS and app notifications become transactions, cards and dues by themselves.', ar: 'رسائل البنك والإشعارات تتحول تلقائياً إلى عمليات وبطاقات ومستحقات.' },
  // iPhone gets the same feature by a different road — Apple lets no app read
  // Messages, so a Shortcut forwards them. Describing it as "reads your SMS"
  // there would promise something the platform forbids.
  featAutoTrackingIosText: { en: 'Each bank alert your iPhone forwards becomes a transaction, card or due on its own. Set up once.', ar: 'كل رسالة بنكية يحوّلها هاتفك تتحول تلقائياً إلى عملية أو بطاقة أو مستحق. إعداد مرة واحدة.' },
  featPasteFree: { en: 'Pasting is always free', ar: 'لصق الرسائل مجاني دائماً' },
  featPasteFreeText: { en: 'Reading a bank message you hand over — and typing entries — never needs a subscription, on any phone.', ar: 'قراءة رسالة بنكية تلصقها بنفسك وإضافة العمليات يدوياً لا تحتاج اشتراكاً أبداً على أي هاتف.' },
  featInsights: { en: 'Insights & subscriptions', ar: 'تحليلات واشتراكات' },
  featInsightsText: { en: 'Auto-detected subscriptions, due-date countdowns, plain-language insights.', ar: 'اكتشاف تلقائي للاشتراكات وتذكير بالمستحقات وتحليلات واضحة.' },
  featSalaryMonths: { en: 'Salary-day months', ar: 'الشهر يبدأ يوم الراتب' },
  featSalaryMonthsText: { en: 'Your money month starts on payday, not the 1st.', ar: 'شهرك المالي يبدأ يوم استلام راتبك.' },
  featBackup: { en: 'Backup & restore', ar: 'نسخ احتياطي واستعادة' },
  featBackupText: { en: 'Move your full history to a new phone with one file.', ar: 'انقل سجلك كاملاً إلى هاتف جديد بملف واحد.' },

  // Onboarding
  obTagline: { en: 'Know where it goes. Watch it grow.', ar: 'اعرف أين تذهب أموالك. وراقبها تنمو.' },
  obSubtitle: { en: 'Track an AED or SAR ledger privately.', ar: 'تتبّع سجلاً بالدرهم أو الريال بخصوصية.' },
  getStarted: { en: 'Get started', ar: 'ابدأ الآن' },
  exploreSample: { en: 'Explore with sample data', ar: 'جرّب ببيانات تجريبية' },

  // Hero caption
  saved: { en: 'Saved', ar: 'المدخر' },
  overspent: { en: 'Overspent', ar: 'تجاوزت' },
  netAfterSpending: { en: 'Net after spending', ar: 'الصافي بعد الإنفاق' },
  spentAboveIncome: { en: 'Spent above income', ar: 'الإنفاق فوق الدخل' },
  soFarThisMonth: { en: 'so far this month', ar: 'حتى الآن هذا الشهر' },

  /**
   * The line under the hero figure — the same period before this one, over the
   * same number of days.
   *
   * Six strings rather than three plus a suffix, because a composed sentence
   * fragment does not survive translation into Arabic: the qualifier does not
   * attach where an English suffix would, and the result reads as two half
   * sentences. Each of these is a whole sentence in both languages.
   *
   * "at the same point" is doing real work. Mid-period this compares an equal
   * NUMBER OF DAYS, not an equal period, and saying so is the difference
   * between a fair comparison and a claim the reader would rightly dispute if
   * they checked it against last month's total.
   */
  homeVsMorePartial: {
    en: '{amount} more spent than {period} at the same point',
    ar: 'صرفت {amount} أكثر من {period} عند النقطة نفسها',
  },
  homeVsLessPartial: {
    en: '{amount} less spent than {period} at the same point',
    ar: 'صرفت {amount} أقل من {period} عند النقطة نفسها',
  },
  homeVsSamePartial: {
    en: 'The same spent as {period} at the same point',
    ar: 'الصرف نفسه مقارنةً بـ{period} عند النقطة نفسها',
  },
  homeVsMoreWhole: {
    en: '{amount} more spent than {period}',
    ar: 'صرفت {amount} أكثر من {period}',
  },
  homeVsLessWhole: {
    en: '{amount} less spent than {period}',
    ar: 'صرفت {amount} أقل من {period}',
  },
  homeVsSameWhole: {
    en: 'The same spent as {period}',
    ar: 'الصرف نفسه مقارنةً بـ{period}',
  },
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
  walletChangeSince: {
    en: '{amount} since {date}',
    ar: '\u2066{amount}\u2069 منذ {date}',
  },
  cashflow6mo: { en: 'Cashflow · 6 months', ar: 'التدفق النقدي · ٦ أشهر' },
  whatNumbersSay: { en: 'What the numbers say', ar: 'ماذا تقول الأرقام' },
  tapMonthToOpen: { en: 'Tap a month to open it', ar: 'اضغط على شهر لفتحه' },
  flowSummary: { en: 'Spent {total}', ar: 'الإنفاق {total}' },
  flowLimitSummary: {
    en: '{spent} of {limit} in limits',
    ar: '{spent} من {limit} ضمن الحدود',
  },
  ofWord: { en: 'of', ar: 'من' },
  inLimits: { en: 'in limits', ar: 'ضمن الحدود' },
  monthGone: { en: 'of the month gone', ar: 'من الشهر انقضى' },
  flowMonthGone: { en: '{percent}% of the month gone', ar: 'انقضى {percent}% من الشهر' },
  moreCategories: { en: '{count} more', ar: '{count} أخرى' },
  limitsHeader: { en: 'Limits', ar: 'الحدود' },
  totalOut: { en: 'Total spent', ar: 'إجمالي الإنفاق' },
  limitedSpend: { en: 'With limits', ar: 'ضمن الحدود' },
  periodProgress: { en: 'Period progress', ar: 'تقدّم الفترة' },
  fixedPayments: { en: 'Fixed payments', ar: 'الدفعات الثابتة' },
  itemsTracked: { en: '{count} tracked', ar: '{count} قيد التتبع' },
  newLimit: { en: 'New limit', ar: 'حد جديد' },
  setLimitCategory: { en: 'Set a limit on a category', ar: 'ضع حداً لتصنيف' },
  setLimitBody: {
    en: 'Wafra already knows what you spend. Give one category a number and it will tell you whether you are on pace, not just what you have left.',
    ar: 'يعرف وفرة مصروفك بالفعل. ضع رقماً لتصنيف واحد وسيخبرك إن كنت على المسار الصحيح، لا بما تبقّى فقط.',
  },
  overByAmount: { en: 'Over by {amount}', ar: 'تجاوزت بمقدار {amount}' },
  amountLeft: { en: '{amount} left', ar: 'متبقي {amount}' },
  daysLeft: { en: '{count} day{s} left', ar: 'متبقي {count} يوم' },
  fasterThanMonth: { en: 'faster than the month', ar: 'أسرع من وتيرة الشهر' },
  averageSuffix: { en: 'avg', ar: 'متوسط' },
  worthKnowing: { en: 'Worth knowing', ar: 'جدير بالمعرفة' },

  // ── The /stats screen ──
  //
  // This screen shipped with all of its copy written straight into the JSX and
  // not one call to t(), which is how it arrived at this merge as the last
  // failure of contracts.test.js's "no screen writes an English sentence of its
  // own". Every sentence it prints is here as a WHOLE sentence rather than as
  // fragments the screen joins: the trend line has four variants and the
  // heaviest-day line one, because Arabic cannot be assembled by concatenating
  // a translated "above" onto a translated ", the highest of the six".
  statsTitle: { en: 'Stats', ar: 'الإحصاءات' },
  statsEmptyTitle: {
    en: 'Nothing to measure in {period}',
    ar: 'لا يوجد ما يُقاس في {period}',
  },
  statsEmptyBody: {
    en: 'Stats reads the ledger you already have. Import a month of bank messages, or pick another period, and every section below fills itself in.',
    ar: 'تقرأ الإحصاءات سجلّك الحالي. استورد شهراً من رسائل البنك أو اختر فترة أخرى، وستمتلئ كل الأقسام أدناه تلقائياً.',
  },
  statsWhereItGoes: { en: 'Where it goes', ar: 'أين يذهب المال' },
  statsWhatChanged: { en: 'What changed', ar: 'ما الذي تغيّر' },
  statsMoversCaption: {
    en: 'Against the period before this one.',
    ar: 'مقارنةً بالفترة السابقة لهذه.',
  },
  statsMoverUp: { en: '{category}, up', ar: '{category}، ارتفع' },
  statsMoverDown: { en: '{category}, down', ar: '{category}، انخفض' },
  statsCategoryMonths: {
    en: '{category} · {count} months',
    ar: '{category} · {count} أشهر',
  },
  statsTrendFlat: {
    en: "{amount} every month for {count} months — it hasn't moved.",
    ar: '{amount} كل شهر على مدى {count} أشهر — لم يتغيّر إطلاقاً.',
  },
  statsTrendOnAverage: {
    en: '{amount} a month on average, and {month} lands right on it.',
    ar: '{amount} شهرياً في المتوسط، و{month} جاء مطابقاً له تماماً.',
  },
  statsTrendAbove: {
    en: '{amount} a month on average. {month} came to {latest} — {percent}% above.',
    ar: '{amount} شهرياً في المتوسط. بلغ {month} مقدار {latest} — أي {percent}% فوق المتوسط.',
  },
  statsTrendAboveHighest: {
    en: '{amount} a month on average. {month} came to {latest} — {percent}% above, the highest of the {count}.',
    ar: '{amount} شهرياً في المتوسط. بلغ {month} مقدار {latest} — أي {percent}% فوق المتوسط، وهو الأعلى بين الـ{count}.',
  },
  statsTrendBelow: {
    en: '{amount} a month on average. {month} came to {latest} — {percent}% below.',
    ar: '{amount} شهرياً في المتوسط. بلغ {month} مقدار {latest} — أي {percent}% دون المتوسط.',
  },
  statsTrendBelowLowest: {
    en: '{amount} a month on average. {month} came to {latest} — {percent}% below, the lowest of the {count}.',
    ar: '{amount} شهرياً في المتوسط. بلغ {month} مقدار {latest} — أي {percent}% دون المتوسط، وهو الأدنى بين الـ{count}.',
  },
  statsWhenItGoes: { en: 'When it goes', ar: 'متى يذهب المال' },
  statsWeekdayCaption: {
    en: 'Day-to-day spending only. Rent and other fixed commitments land on whichever weekday the standing order falls on, which is a calendar, not a habit.',
    ar: 'المصروف اليومي فقط. الإيجار وغيره من الالتزامات الثابتة يقع في اليوم الذي يصادفه الأمر المستديم، وهذا تقويم لا عادة.',
  },
  statsHeaviestDay: {
    en: '{day} is your heaviest day — {amount} of the {total} you chose to spend in {period}.',
    ar: '{day} هو أثقل أيامك — {amount} من أصل {total} اخترت صرفها في {period}.',
  },
  statsAlsoWorthALook: { en: 'Also worth a look', ar: 'يستحق النظر أيضاً' },
  statsNetWorthLink: {
    en: '{count} months of balance, on Wallet',
    ar: '{count} أشهر من الرصيد، في المحفظة',
  },
  statsNetWorthLinkA11y: {
    en: 'Net worth over {count} months, on Wallet',
    ar: 'صافي الثروة خلال {count} أشهر، في المحفظة',
  },
  statsInVsOut: { en: 'In vs out', ar: 'الدخل مقابل المصروف' },
  statsInVsOutLink: {
    en: '{count} months of earning and spending, on Flow',
    ar: '{count} أشهر من الدخل والصرف، في التدفق',
  },
  statsInVsOutLinkA11y: {
    en: 'In versus out over {count} months, on Flow',
    ar: 'الدخل مقابل المصروف خلال {count} أشهر، في التدفق',
  },

  // Other screens
  transactionsTitle: { en: 'Transactions', ar: 'العمليات' },
  budgetsTitle: { en: 'Budgets', ar: 'الميزانيات' },
  cardsTitle: { en: 'Cards', ar: 'البطاقات' },
  inactiveCards: { en: 'Inactive cards', ar: 'بطاقات غير نشطة' },
  lastUsed: { en: 'Last used', ar: 'آخر استخدام' },
  addTransactionTitle: { en: 'Add transaction', ar: 'إضافة عملية' },
  addCashEntry: { en: 'Add cash entry', ar: 'إضافة عملية نقدية' },
  expenseLabel: { en: 'Expense', ar: 'مصروف' },
  incomeLabel: { en: 'Income', ar: 'دخل' },
  filtersTitle: { en: 'Filters', ar: 'عوامل التصفية' },
  filtersButton: { en: 'Filter transactions', ar: 'تصفية العمليات' },
  clearSearch: { en: 'Clear search', ar: 'مسح البحث' },
  clearFilter: { en: 'Clear filter', ar: 'مسح التصفية' },
  clearAllFilters: { en: 'Clear all filters', ar: 'مسح كل عوامل التصفية' },
  typeFilter: { en: 'Type', ar: 'النوع' },
  periodFilter: { en: 'Period', ar: 'الفترة' },
  accountFilter: { en: 'Account', ar: 'الحساب' },
  categoriesFilter: { en: 'Categories', ar: 'التصنيفات' },
  minimumAmountFilter: { en: 'Minimum amount', ar: 'الحد الأدنى للمبلغ' },
  sortFilter: { en: 'Sort', ar: 'الترتيب' },
  selectedPeriod: { en: 'Selected period', ar: 'الفترة المختارة' },
  thisMonth: { en: 'This month', ar: 'هذا الشهر' },
  lastMonth: { en: 'Last month', ar: 'الشهر الماضي' },
  lastThreeMonths: { en: 'Last 3 months', ar: 'آخر ٣ أشهر' },
  dateRange: { en: 'Date range', ar: 'نطاق التاريخ' },
  fromLabel: { en: 'From', ar: 'من' },
  toLabel: { en: 'To', ar: 'إلى' },
  anyLabel: { en: 'Any', ar: 'أي مبلغ' },
  newest: { en: 'Newest', ar: 'الأحدث' },
  oldest: { en: 'Oldest', ar: 'الأقدم' },
  largest: { en: 'Largest', ar: 'الأكبر' },
  largestFirst: { en: 'Largest first', ar: 'الأكبر أولاً' },
  reset: { en: 'Reset', ar: 'إعادة ضبط' },
  transactionsCount: { en: '{count} transaction{s}', ar: '{count} عملية' },
  activeFiltersCount: { en: '{count} filter{s}', ar: '{count} عامل تصفية' },
  transfersExcluded: {
    en: '{count} transfer{s} not counted',
    ar: '{count} تحويل مستبعد من الإجمالي',
  },
  // Rows on a hidden account. They are still listed — they are real records
  // and searching for one should find it — but every other total in the app
  // leaves them out, so this one must too, and must say so.
  hiddenAccountsExcluded: {
    en: '{count} on hidden accounts',
    ar: '{count} في حسابات مخفية',
  },
  smsImportsOnly: { en: 'Imported messages', ar: 'الرسائل المستوردة' },
  showResults: { en: 'Show {count} result{s}', ar: 'عرض {count} نتيجة' },
  nothingMatches: {
    en: 'Nothing matches. Adjust search or filters.',
    ar: 'لا توجد نتائج. عدّل البحث أو عوامل التصفية.',
  },
  plusWord: { en: 'plus', ar: 'زائد' },
  minusWord: { en: 'minus', ar: 'ناقص' },

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
  findBankAlerts: { en: 'Find bank alerts', ar: 'ابحث عن التنبيهات البنكية' },
  scanBankAlertsPrivacy: {
    en: 'Finds supported bank alerts on this phone. They are parsed here; raw messages never leave.',
    ar: 'يبحث عن تنبيهات البنوك المدعومة على هذا الهاتف. تُحلّل هنا ولا تغادر الرسائل الخام الجهاز.',
  },
  pasteInstead: { en: 'Paste messages instead', ar: 'الصق الرسائل بدلاً من ذلك' },
  hideManualPaste: { en: 'Hide manual paste', ar: 'إخفاء اللصق اليدوي' },
  importBankActivity: { en: 'Import bank activity', ar: 'استيراد النشاط البنكي' },
  importBankActivityIosDetail: {
    en: 'Forwarded email, PDF statement, or your bank Shortcut',
    ar: 'بريد محوّل أو كشف PDF أو اختصار البنك',
  },
  parsePasted: { en: 'Parse pasted text', ar: 'تحليل النص الملصق' },
  trySample: { en: 'Try sample', ar: 'جرّب مثالاً' },
  importPastMessages: { en: 'Import past Messages', ar: 'استيراد الرسائل السابقة' },
  installHistoryShortcut: { en: 'Install history Shortcut', ar: 'تثبيت اختصار السجل' },
  historyImportPrivacy: {
    en: 'Apple Shortcuts searches all retained Messages in the date range you choose. Wafra checks them locally, keeps only financial matches, and uploads none of the text.',
    ar: 'يبحث تطبيق اختصارات Apple في كل الرسائل المحتفظ بها ضمن المدة التي تختارها. يفحصها وفرة محلياً، ويحتفظ بالمطابقات المالية فقط، ولا يرفع أي نص.',
  },
  historyReviewPrivacy: {
    en: 'Review only. The selected date range was checked on this iPhone; Message text is not uploaded and is removed from staging after a successful save or explicit cancel.',
    ar: 'للمراجعة فقط. فُحصت المدة المحددة على هذا الآيفون؛ لا يُرفع نص الرسائل ويُحذف من التخزين المؤقت بعد الحفظ الناجح أو الإلغاء الصريح.',
  },
  historyPreparingReview: { en: 'Preparing review…', ar: 'جارٍ إعداد المراجعة…' },
  retryHistoryRead: { en: 'Try reading again', ar: 'إعادة محاولة القراءة' },
  historyShortcutMissing: { en: 'History Shortcut not installed', ar: 'اختصار السجل غير مثبت' },
  historyShortcutMissingBody: {
    en: 'Install “Wafra History Import” in Apple Shortcuts, then try again.',
    ar: 'ثبّت «استيراد سجل وفرة» في تطبيق اختصارات Apple ثم أعد المحاولة.',
  },
  historyImportReviewReady: { en: 'Ready for review', ar: 'جاهز للمراجعة' },
  historyImportReviewCounts: {
    en: '{matched} matched · {skipped} unreadable or non-financial',
    ar: 'طابقت {matched} · تعذّر فهم {skipped} أو لم تكن مالية',
  },
  historyImportNoNew: {
    en: '{read} messages checked · {skipped} unreadable, repeated, or non-financial',
    ar: 'فُحصت {read} رسالة · {skipped} غير مفهومة أو مكررة أو غير مالية',
  },
  historyImportNoneFound: {
    en: 'No supported bank activity found',
    ar: 'لم يُعثر على نشاط بنكي مدعوم',
  },
  historyImportNoneFoundBody: {
    en: 'Wafra checked {read} retained messages; {skipped} were unreadable or did not match a supported bank alert. Nothing was filed. Try another date range after checking the Shortcut result count.',
    ar: 'فحص وفرة {read} رسالة محتفظاً بها؛ تعذّر فهم {skipped} منها أو لم تطابق تنبيهًا بنكيًا مدعومًا. لم يُسجّل شيء. جرّب مدة أخرى بعد التحقق من عدد نتائج الاختصار.',
  },
  historyImportMissing: { en: 'No staged messages found', ar: 'لم تُوجد رسائل مؤقتة' },
  historyImportMissingBody: {
    en: 'Run Wafra History Import again and keep Wafra installed while the Shortcut finishes.',
    ar: 'شغّل «استيراد سجل وفرة» مجدداً واترك وفرة مثبتاً حتى ينتهي الاختصار.',
  },
  historyImportInvalid: { en: 'This import link is invalid', ar: 'رابط الاستيراد غير صالح' },
  historyImportInvalidBody: {
    en: 'Nothing was read. Leave this screen and run Wafra History Import again from Apple Shortcuts.',
    ar: 'لم تتم قراءة أي شيء. غادر هذه الشاشة وشغّل «استيراد سجل وفرة» مجدداً من اختصارات Apple.',
  },
  historyImportFailed: { en: 'Could not finish the import', ar: 'تعذّر إكمال الاستيراد' },
  historyImportFailedBody: {
    en: 'The protected source session is still on this iPhone. Try reading it again or cancel to delete it.',
    ar: 'ما زالت جلسة المصدر المحمية على هذا الآيفون. أعد قراءتها أو ألغِ لحذفها.',
  },
  historyStorageFailed: { en: 'Secure save failed', ar: 'فشل الحفظ الآمن' },
  historyStorageFailedBody: {
    en: 'The review was applied in this open session but SQLCipher did not confirm the save. Retry the secure save, or leave; the protected source stays available for recovery and becomes eligible for cleanup after one hour.',
    ar: 'طُبقت المراجعة في هذه الجلسة المفتوحة لكن SQLCipher لم يؤكد الحفظ. أعد محاولة الحفظ الآمن أو غادر؛ سيبقى المصدر المحمي متاحاً للاسترداد ويصبح مؤهلاً للتنظيف بعد ساعة.',
  },
  importStorageFailedBody: {
    en: 'The entries were applied in this open session but encrypted storage did not confirm the save. Do not repeat this import now.',
    ar: 'طُبقت العمليات في هذه الجلسة المفتوحة لكن التخزين المشفر لم يؤكد الحفظ. لا تكرر الاستيراد الآن.',
  },
  notificationCleanupFailedTitle: {
    en: 'Saved, but notification cleanup needs attention',
    ar: 'تم الحفظ لكن تنظيف التنبيهات يحتاج إجراءً',
  },
  notificationCleanupFailedBody: {
    en: 'Your ledger is safe, but Wafra could not clear its encrypted notification queue. A later scan may see the same alert again; duplicate protection will ignore it.',
    ar: 'سجلك محفوظ، لكن تعذّر على وفرة مسح قائمة التنبيهات المشفرة. قد يرى الفحص اللاحق التنبيه نفسه مجدداً، وستتجاهله حماية التكرار.',
  },
  historyCleanupFailed: { en: 'Saved, but cleanup needs attention', ar: 'تم الحفظ لكن التنظيف يحتاج إجراءً' },
  historyCleanupFailedBody: {
    en: 'Your ledger is saved. Retry deletion, or leave; the protected staged Message text becomes eligible for cleanup after one hour.',
    ar: 'تم حفظ سجلك. أعد محاولة الحذف أو غادر؛ يصبح نص الرسائل المؤقت المحمي مؤهلاً للتنظيف بعد ساعة.',
  },
  deleteStagedMessages: { en: 'Delete staged Message text', ar: 'حذف نص الرسائل المؤقت' },
  retrySecureSave: { en: 'Retry secure save', ar: 'إعادة محاولة الحفظ الآمن' },
  leaveImportScreen: { en: 'Leave this screen', ar: 'مغادرة هذه الشاشة' },
  readyToFile: { en: 'Ready to file', ar: 'جاهز للتسجيل' },
  skippedLabel: { en: 'skipped', ar: 'تم تخطيها' },
  filesOnConfirm: { en: 'Files when you confirm', ar: 'يُسجَّل عند التأكيد' },
  fileBillReminders: {
    en: 'File {count} bill reminder{s}',
    ar: 'تسجيل {count} من تذكيرات الفواتير',
  },

  // iOS automatic capture setup.
  //
  // This is the screen that decides whether iPhone feels like the lesser
  // platform, so it is translated as carefully as anything in the app. The
  // Arabic is written as Arabic rather than transliterated from the English:
  // "Shortcut" is اختصار, the Apple term, not شورت‌كت.
  iosSetupTitle: { en: 'Automatic capture', ar: 'الالتقاط التلقائي' },
  iosStepConnect: { en: 'Connect', ar: 'الربط' },
  iosStepBanks: { en: 'Banks', ar: 'البنوك' },
  iosStepShortcut: { en: 'Shortcut', ar: 'الاختصار' },
  iosStepAutomation: { en: 'Automation', ar: 'الأتمتة' },
  iosStepTest: { en: 'Test', ar: 'الاختبار' },
  iosStepProgress: { en: 'Step {n} of {total}: {name}', ar: 'الخطوة {n} من {total}: {name}' },

  iosIntroTitle: { en: 'Set it once. Wafra keeps up.', ar: 'اضبطه مرة. ووفرة يتابع.' },
  iosIntroBody1: {
    en: 'Install Wafra Capture, choose your bank conversations, then let one safe test light up the private pipe.',
    ar: 'ثبّت «التقاط وفرة»، واختر محادثات بنوكك، ثم شغّل اختباراً آمناً لمسار الربط الخاص.',
  },
  iosIntroBody2: {
    en: 'After setup, alerts file themselves while Wafra is closed. After a restart or force-quit, open Wafra once to resume silent delivery.',
    ar: 'بعد الإعداد تُسجّل التنبيهات ووفرة مغلق. بعد إعادة التشغيل أو الإغلاق بالقوة، افتح وفرة مرة لاستئناف التسليم الصامت.',
  },
  iosPreviewTime: {
    en: 'ABOUT 3 MINUTES · APPLE SHORTCUTS OPENS NEXT',
    ar: 'نحو ٣ دقائق · سيفتح تطبيق الاختصارات تالياً',
  },
  iosPreviewInstall: { en: 'Install one private Shortcut', ar: 'ثبّت اختصاراً خاصاً واحداً' },
  iosPreviewInstallBody: {
    en: 'Paste this iPhone’s private setup code once.',
    ar: 'ألصق رمز الإعداد الخاص بهذا الآيفون مرة واحدة.',
  },
  iosPreviewAutomation: { en: 'Choose your bank conversations', ar: 'اختر محادثات بنوكك' },
  iosPreviewAutomationBody: {
    en: 'Apple’s sender picker limits exactly which alerts can run.',
    ar: 'تحدد قائمة مرسلي آبل التنبيهات المسموح بتشغيلها بدقة.',
  },
  iosPreviewProof: { en: 'See the private pipe answer', ar: 'شاهد استجابة المسار الخاص' },
  iosPreviewProofBody: {
    en: 'A safe probe checks the pipe; the first bank alert verifies the trigger.',
    ar: 'يفحص اختبار آمن المسار؛ ويتحقق أول تنبيه بنكي من المشغّل.',
  },
  /**
   * The sentence this note used to start with was "The relay discards raw
   * Message Content after parsing" — which is true, and which presupposes the
   * thing it never said: that the relay received the message in the first
   * place. Someone skimming the screen before tapping Connect could read the
   * whole note and not learn that their bank alert leaves the phone.
   *
   * That is the one way iPhone capture differs from Android, where parsing is
   * entirely on-device, and it is the difference a person is entitled to be
   * told before they agree to it rather than after. So it now leads, and the
   * retention detail follows it.
   */
  iosPrivacyNote: {
    en: 'Apple gives no app access to the Messages inbox, so on iPhone the alert text is sent to Wafra’s relay to be read. That is the one difference from Android, where it never leaves the phone. The relay discards raw Message Content after parsing. It keeps only the structured transaction and, when the Shortcut supplies it, the bank Sender label used to identify its card or account; both are sealed to this iPhone and queued for up to 30 days.',
    ar: 'لا تتيح آبل لأي تطبيق الوصول إلى صندوق الرسائل، لذلك يُرسَل نص التنبيه على الآيفون إلى خادم ترحيل وفرة ليُقرأ. وهذا هو الفارق الوحيد عن أندرويد، حيث لا يغادر النص الهاتف إطلاقاً. ويتخلّص خادم الترحيل من محتوى الرسالة الخام بعد تحليله. ولا يحتفظ إلا ببيانات العملية المنظمة، وباسم مرسل البنك عندما يرسله الاختصار، لتحديد البطاقة أو الحساب؛ وتُشفّر هذه البيانات لهذا الآيفون وقد تبقى في قائمة الانتظار حتى ٣٠ يوماً.',
  },
  iosConnecting: { en: 'Connecting…', ar: 'جارٍ الربط…' },
  iosConnectCta: { en: 'Connect this iPhone', ar: 'اربط هذا الآيفون' },
  iosConnectFailed: { en: 'Could not connect.', ar: 'تعذّر الربط.' },
  iosPushPermissionRequired: {
    en: 'Silent delivery is disabled in iPhone Settings. Enable Wafra notifications, then try again.',
    ar: 'التسليم الصامت معطل في إعدادات الآيفون. فعّل إشعارات وفرة ثم أعد المحاولة.',
  },
  iosPushSetupFailed: {
    en: 'Silent capture is not ready in this build. Check the project and push configuration, then try again.',
    ar: 'الالتقاط الصامت غير جاهز في هذا الإصدار. تحقق من إعدادات المشروع والإشعارات ثم حاول مجدداً.',
  },
  iosRelayUnavailable: {
    en: 'Automatic capture is not configured in this build.',
    ar: 'الالتقاط التلقائي غير مهيأ في هذا الإصدار.',
  },
  iosPrivateModeTitle: {
    en: 'Turn off Private Mode?',
    ar: 'إيقاف الوضع الخاص؟',
  },
  iosPrivateModeBody: {
    en: 'iPhone automatic capture needs the relay. Turning Private Mode off allows only bank senders you select to leave this phone; raw text is discarded immediately after parsing.',
    ar: 'يحتاج الالتقاط التلقائي على الآيفون إلى خادم الترحيل. يسمح إيقاف الوضع الخاص بمغادرة تنبيهات مرسلي البنوك الذين تحددهم فقط؛ ويُتخلص من النص الخام فور تحليله.',
  },
  iosTurnOffPrivateMode: {
    en: 'Turn off & connect',
    ar: 'أوقفه واتصل',
  },
  iosContinueManual: {
    en: 'Maximum privacy · no Messages access',
    ar: 'أقصى خصوصية · دون وصول إلى الرسائل',
  },

  iosBanksTitle: { en: 'Which banks text you?', ar: 'أي البنوك تراسلك؟' },
  iosBanksBody: {
    en: 'Pick the banks that send card or account alerts. In the next step, Shortcuts will ask you to select their existing message conversations as senders.',
    ar: 'اختر البنوك التي ترسل تنبيهات البطاقات أو الحسابات. في الخطوة التالية سيطلب منك تطبيق الاختصارات تحديد محادثاتها الحالية كمرسلين.',
  },
  iosSenderCaveat: {
    en: 'Sender names vary by carrier, and Apple owns the picker. Choose the existing bank conversation—not a typed guess. If it is missing, add that sender to Contacts first. A real future alert is the only complete trigger test.',
    ar: 'تختلف أسماء المرسلين حسب شركة الاتصالات، وتتحكم آبل في قائمة الاختيار. اختر محادثة البنك الموجودة، لا اسماً تخمينياً. إن لم تظهر فأضف المرسل إلى جهات الاتصال أولاً. التنبيه الحقيقي التالي هو الاختبار الكامل الوحيد للمشغّل.',
  },
  iosBanksSelected: { en: 'SELECTED · {n}', ar: 'المحدد · {n}' },
  iosBanksNext: { en: 'Next', ar: 'التالي' },
  iosBanksSkip: { en: 'Skip — I will pick later', ar: 'تخطَّ — سأختار لاحقاً' },
  iosBankSelected: { en: '{name}, selected', ar: '{name}، محدد' },

  iosShortcutTitle: { en: 'Install the Shortcut', ar: 'ثبّت الاختصار' },
  iosShortcutBody: {
    en: 'Tap below to copy this iPhone’s private setup code and open Shortcuts. Add Wafra Capture, run it once, and paste when Apple asks. Return here only after it says the Shortcut is ready.',
    ar: 'اضغط أدناه لنسخ رمز الإعداد الخاص بهذا الآيفون وفتح الاختصارات. أضف «Wafra Capture»، وشغّله مرة واحدة، ثم الصق الرمز عندما تطلبه Apple. عد إلى هنا فقط بعد أن يؤكد الاختصار أنه جاهز.',
  },
  iosShortcutReplaceNote: {
    en: 'Already installed Wafra Capture? Delete the old Shortcut before adding this version. Keeping both can make Apple run the broken copy.',
    ar: 'هل ثبّتَّ «Wafra Capture» من قبل؟ احذف الاختصار القديم قبل إضافة هذا الإصدار. وجود النسختين قد يجعل Apple تشغّل النسخة المعطلة.',
  },
  iosSetupCode: { en: 'THIS IPHONE’S SETUP CODE', ar: 'رمز إعداد هذا الآيفون' },
  iosYourAddress: { en: 'YOUR ADDRESS', ar: 'عنوانك' },
  iosCopy: { en: 'COPY', ar: 'نسخ' },
  iosCopied: { en: 'COPIED', ar: 'تم النسخ' },
  iosCopySetupCode: { en: 'Copy the private setup code', ar: 'انسخ رمز الإعداد الخاص' },
  iosCopyAddress: { en: 'Copy your Wafra address', ar: 'انسخ عنوان وفرة الخاص بك' },
  iosCopyToken: { en: 'Copy your secret key', ar: 'انسخ مفتاحك السري' },
  iosRunFor: { en: 'SET THE AUTOMATION TO RUN FOR', ar: 'اضبط الأتمتة لتعمل مع' },
  iosOpenShortcut: { en: 'Copy code & open latest Shortcut', ar: 'انسخ الرمز وافتح أحدث اختصار' },
  iosOpenShortcutsApp: { en: 'Open Shortcuts', ar: 'افتح تطبيق الاختصارات' },
  iosShortcutMissing: {
    en: 'This build has no published install link. You can still build “Wafra Capture” manually with the address and token below.',
    ar: 'لا يحتوي هذا الإصدار على رابط تثبيت منشور. ما زال بإمكانك إنشاء «Wafra Capture» يدوياً باستخدام العنوان والرمز أدناه.',
  },
  iosInstalledIt: {
    en: 'Shortcut is ready — clear code & continue',
    ar: 'الاختصار جاهز — امسح الرمز وتابع',
  },

  iosAutomationTitle: { en: 'Make it run by itself', ar: 'اجعله يعمل تلقائياً' },
  iosAutomationBody: {
    en: 'In Shortcuts → Automation, create a Message automation with these five choices:',
    ar: 'في الاختصارات ← الأتمتة، أنشئ أتمتة «رسالة» بهذه الخيارات الخمسة:',
  },
  iosAutomationTrigger: {
    en: '1. Trigger: Message',
    ar: '١. المشغّل: رسالة',
  },
  iosAutomationSenders: {
    en: '2. Sender: choose the bank conversations listed below',
    ar: '٢. المرسل: اختر محادثات البنوك المدرجة أدناه',
  },
  iosAutomationImmediate: {
    en: '3. Choose Run Immediately',
    ar: '٣. اختر «تشغيل فوراً»',
  },
  iosAutomationAction: {
    en: '4. Action: Run Shortcut → Wafra Capture',
    ar: '٤. الإجراء: تشغيل اختصار ← Wafra Capture',
  },
  iosAutomationInput: {
    en: '5. Input: Received Message (not only Content)',
    ar: '٥. الإدخال: «الرسالة المستلمة» (وليس «المحتوى» فقط)',
  },
  iosAutomationReady: {
    en: 'I chose Run Immediately',
    ar: 'اخترت «تشغيل فوراً»',
  },

  iosTestTitle: { en: 'Let us prove it works', ar: 'لنتأكد أنه يعمل' },
  iosTestBody: {
    en: 'Run one harmless test through the installed Shortcut, then return here. It will not add a fake purchase.',
    ar: 'شغّل اختباراً آمناً واحداً عبر الاختصار المثبّت ثم عد إلى هنا. لن يضيف عملية شراء وهمية.',
  },
  iosTestLimit: {
    en: 'The Shortcut and private sync work. The first real bank alert is the final check: it should appear under the correct bank or card.',
    ar: 'يعمل الاختصار والمزامنة الخاصة. التنبيه البنكي الحقيقي الأول هو الاختبار الأخير: يجب أن يظهر تحت البنك أو البطاقة الصحيحة.',
  },
  iosCaught: {
    en: 'Captured and filed through the same path future alerts use.',
    ar: 'التُقطت وسُجّلت عبر المسار نفسه الذي ستستخدمه التنبيهات لاحقاً.',
  },
  iosTestCaught: {
    en: 'Shortcut, relay and encrypted sync answered. The first real bank alert completes automation verification.',
    ar: 'استجاب الاختصار والترحيل والمزامنة المشفّرة. يُكمل أول تنبيه بنكي حقيقي التحقق من الأتمتة.',
  },
  iosListening: { en: 'Waiting for the Shortcut…', ar: 'في انتظار الاختصار…' },
  iosWaitingLabel: {
    en: 'Waiting for the Wafra Capture Shortcut',
    ar: 'في انتظار اختصار Wafra Capture',
  },
  iosTimedOut: {
    en: 'The Shortcut did not finish. If Shortcuts showed “Invalid file path,” delete the old Wafra Capture and install the latest version below. Otherwise, open the Shortcut once and allow network access, then try again.',
    ar: 'لم يكتمل تشغيل الاختصار. إذا عرض تطبيق الاختصارات «مسار ملف غير صالح»، فاحذف نسخة Wafra Capture القديمة وثبّت أحدث إصدار أدناه. وإلا فافتح الاختصار مرة واحدة واسمح له بالوصول إلى الشبكة ثم حاول مجدداً.',
  },
  iosTryAgain: { en: 'Try again', ar: 'حاول مرة أخرى' },
  iosStartListening: { en: 'Run capture test', ar: 'شغّل اختبار الالتقاط' },
  iosDone: { en: 'Done', ar: 'تم' },
  iosSkipForNow: {
    en: 'Finish for now — manual tracking still works',
    ar: 'إنهاء الآن — يظل التسجيل اليدوي متاحاً',
  },
  iosDisconnect: { en: 'Disconnect this iPhone', ar: 'افصل هذا الآيفون' },
  iosDisconnectFailed: {
    en: 'Could not disconnect. Stay online and try again so the relay copy can be erased.',
    ar: 'تعذّر الفصل. ابقَ متصلاً وحاول مجدداً حتى يمكن مسح نسخة الترحيل.',
  },

  // Recovery and back-navigation copy. Each of these exists because the setup
  // flow had a reachable state where the screen said nothing about what to do
  // next: a failure with no undo, a step with no way back to the one that
  // caused it, or a finished setup that still asked to be proved.
  iosAlreadyWorkingTitle: { en: 'Automatic capture is on', ar: 'الالتقاط التلقائي مُفعّل' },
  iosAlreadyWorkingBody: {
    en: 'This iPhone is connected and the private pipe has already answered. New bank alerts file themselves from here.',
    ar: 'هذا الآيفون مرتبط، وقد استجاب المسار الخاص فعلاً. تُسجّل تنبيهات البنوك الجديدة نفسها من الآن.',
  },
  iosRunTestAgain: { en: 'Run the test again', ar: 'أعد تشغيل الاختبار' },
  iosBackToShortcut: { en: 'Back to the setup code', ar: 'العودة إلى رمز الإعداد' },
  iosBackToAutomation: { en: 'Back to the automation steps', ar: 'العودة إلى خطوات الأتمتة' },
  iosReinstallShortcut: { en: 'Reinstall the Shortcut', ar: 'أعد تثبيت الاختصار' },
  iosAutomationReadyTest: { en: 'I built it — test it now', ar: 'أنشأتها — اختبرها الآن' },
  iosShortcutInstallFailed: {
    en: 'Could not open the install page. Check your connection and try again.',
    ar: 'تعذّر فتح صفحة التثبيت. تحقق من اتصالك ثم حاول مجدداً.',
  },
  iosShortcutsOpenFailed: {
    en: 'Could not open Shortcuts. If it was removed from this iPhone, reinstall it from the App Store, then try again.',
    ar: 'تعذّر فتح تطبيق الاختصارات. إن كان محذوفاً من هذا الآيفون فأعد تثبيته من App Store ثم حاول مجدداً.',
  },
  iosShortcutRunFailed: {
    en: 'Could not run Wafra Capture. Check that the Shortcut is installed and still named “Wafra Capture”, then try again.',
    ar: 'تعذّر تشغيل Wafra Capture. تأكد من تثبيت الاختصار ومن بقاء اسمه «Wafra Capture» ثم حاول مجدداً.',
  },

  // Remaining cross-screen UI. Keeping complete sentences here is
  // especially important for Arabic: word order and plural forms cannot be
  // reconstructed safely by joining translated English fragments in JSX.
  yes: { en: 'Yes', ar: 'نعم' },
  no: { en: 'No', ar: 'لا' },
  show: { en: 'Show', ar: 'إظهار' },
  hide: { en: 'Hide', ar: 'إخفاء' },
  remember: { en: 'Remember', ar: 'تذكّر' },
  justFuture: { en: 'Just future', ar: 'العمليات القادمة فقط' },
  yesUpdateAll: { en: 'Yes, update all', ar: 'نعم، حدّث الكل' },
  category: { en: 'Category', ar: 'التصنيف' },
  account: { en: 'Account', ar: 'الحساب' },
  source: { en: 'Source', ar: 'المصدر' },
  unassigned: { en: 'Unassigned', ar: 'غير معيّن' },
  date: { en: 'Date', ar: 'التاريخ' },
  description: { en: 'Description', ar: 'الوصف' },
  when: { en: 'When', ar: 'متى' },
  editEntry: { en: 'Edit entry', ar: 'تعديل العملية' },
  entryDetail: { en: 'Entry detail', ar: 'تفاصيل العملية' },
  saveChanges: { en: 'Save changes', ar: 'حفظ التغييرات' },
  filedOn: { en: 'filed {date}', ar: 'سُجّلت في {date}' },
  transfersNoCategory: {
    en: 'Transfers have no category — this moves money between your own accounts rather than spending it.',
    ar: 'لا تصنيف للتحويلات — فهي تنقل المال بين حساباتك بدلاً من إنفاقه.',
  },
  merchantCategoryRule: {
    en: 'This merchant is always {category} — change it once and the other {count} {merchant} charge{s} follow.',
    ar: 'يُصنّف هذا المتجر دائماً ضمن {category} — غيّره مرة واحدة وستتبع ذلك {count} من عمليات {merchant} الأخرى.',
  },

  newTransaction: { en: 'New transaction', ar: 'عملية جديدة' },
  saveTransaction: { en: 'Save transaction', ar: 'حفظ العملية' },
  amountInDirhams: { en: 'Amount', ar: 'المبلغ' },
  amountInLedgerCurrency: { en: 'Amount in your ledger currency', ar: 'المبلغ بعملة سجلك' },
  descriptionOptional: { en: 'Description (optional)', ar: 'الوصف (اختياري)' },
  descriptionOptionalA11y: { en: 'Description, optional', ar: 'الوصف، اختياري' },
  twoDaysAgo: { en: '2 days ago', ar: 'قبل يومين' },
  threeDaysAgo: { en: '3 days ago', ar: 'قبل ٣ أيام' },
  expenseExample: { en: 'e.g. Carrefour weekly shop', ar: 'مثال: مشتريات كارفور الأسبوعية' },
  incomeExample: { en: 'e.g. July salary', ar: 'مثال: راتب يوليو' },

  reportingPeriodTitle: { en: 'Reporting period', ar: 'فترة التقرير' },
  lastSevenDays: { en: 'Last 7 days', ar: 'آخر ٧ أيام' },
  lastThirtyDays: { en: 'Last 30 days', ar: 'آخر ٣٠ يوماً' },
  lastNinetyDays: { en: 'Last 90 days', ar: 'آخر ٩٠ يوماً' },
  thisYear: { en: 'This year', ar: 'هذا العام' },
  allTimeTitle: { en: 'All time', ar: 'كل الفترات' },
  customRange: { en: 'Custom range', ar: 'نطاق مخصص' },
  fromDate: { en: 'From date', ar: 'تاريخ البداية' },
  toDate: { en: 'To date', ar: 'تاريخ النهاية' },
  fromDatePlaceholder: { en: 'From YYYY-MM-DD', ar: 'من YYYY-MM-DD' },
  toDatePlaceholder: { en: 'To YYYY-MM-DD', ar: 'إلى YYYY-MM-DD' },
  applyRange: { en: 'Apply range', ar: 'تطبيق النطاق' },

  unlockWafra: { en: 'Unlock Wafra', ar: 'فتح وفرة' },
  locked: { en: 'Locked', ar: 'مقفل' },
  lockedPrivacyBody: {
    en: 'Your balances are hidden until the phone says it is you. Nothing left the phone while it was closed.',
    ar: 'أرصدتك مخفية حتى يتحقق الهاتف من هويتك. لم تغادر أي بيانات الهاتف أثناء إغلاق التطبيق.',
  },
  phoneHasNoLock: { en: 'This phone has no screen lock', ar: 'لا يوجد قفل شاشة لهذا الهاتف' },
  setPhoneLockBody: {
    en: 'Set up a fingerprint, face unlock, or a PIN and Wafra can use it.',
    ar: 'أعدّ بصمة أو تعرّفاً على الوجه أو رمز PIN ليتمكن وفرة من استخدامه.',
  },
  unlockFingerprintA11y: { en: 'Unlock with your fingerprint', ar: 'افتح باستخدام بصمتك' },
  touchSensor: { en: 'Touch the sensor to unlock', ar: 'المس المستشعر للفتح' },
  biometricOrPin: {
    en: 'Fingerprint, face unlock, or your phone PIN',
    ar: 'البصمة أو التعرّف على الوجه أو رمز هاتفك',
  },
  usePinInstead: { en: 'Use PIN instead', ar: 'استخدم رمز PIN بدلاً من ذلك' },

  newLimitTitle: { en: 'New limit', ar: 'حد جديد' },
  categoryLimit: { en: '{category} limit', ar: 'حد {category}' },
  spentThisMonth: { en: 'Spent this month', ar: 'المصروف هذا الشهر' },
  monthlyLimit: { en: 'Monthly limit', ar: 'الحد الشهري' },
  limitOverBy: { en: 'Over by {amount}', ar: 'تجاوزت بمقدار {amount}' },
  limitAmountLeft: { en: '{amount} left', ar: 'متبقي {amount}' },
  timeStillToGo: {
    en: ' with {days} day{s} still to go.',
    ar: ' مع بقاء {days} يوم.',
  },
  threeMonthAverageNote: { en: 'your 3-month average', ar: 'متوسطك لثلاثة أشهر' },
  tenPercentUnderMonth: { en: '10% under this month', ar: 'أقل ١٠٪ من هذا الشهر' },
  moreMerchants: { en: '{count} more merchant{s}', ar: '{count} متجر إضافي' },
  saveLimit: { en: 'Save limit', ar: 'حفظ الحد' },

  hideCard: { en: 'Hide card', ar: 'إخفاء البطاقة' },
  deleteCardTitle: { en: 'Delete card?', ar: 'حذف البطاقة؟' },
  deleteCardBody: {
    en: '“{name}” and all its entries will be removed.',
    ar: 'ستُحذف «{name}» وجميع عملياتها.',
  },
  cardOpenHistoryA11y: {
    en: '{name}, open statements and payments',
    ar: '{name}، افتح الكشوف والدفعات',
  },
  dueOn: { en: 'due {date}', ar: 'مستحق {date}' },
  outstandingTitle: { en: 'Outstanding', ar: 'المستحق' },
  creditLeft: { en: '{amount} left', ar: 'متاح {amount}' },
  setLimit: { en: 'Set limit', ar: 'تحديد الحد' },
  noCardsYet: {
    en: 'No cards yet. One appears here as soon as a bank message names a card number.',
    ar: 'لا توجد بطاقات بعد. ستظهر هنا بطاقة فور أن تذكر رسالة البنك رقم بطاقة.',
  },
  creditLimitTitle: { en: 'Credit limit', ar: 'حد الائتمان' },
  creditLimitBody: {
    en: 'Banks quote the headroom left, never the limit itself. Enter it once and every masked balance on {name} turns into a real figure.',
    ar: 'تذكر البنوك الرصيد الائتماني المتاح لا الحد نفسه. أدخله مرة واحدة ليصبح كل رصيد مخفي في {name} رقماً فعلياً.',
  },

  importOneMoment: { en: 'One moment', ar: 'لحظة واحدة' },
  inboxAlreadyFiled: { en: 'Everything in your inbox is already filed.', ar: 'كل ما في صندوق رسائلك مسجّل بالفعل.' },
  importProgress: { en: 'Progress', ar: 'التقدم' },
  importProgressCounts: { en: '{read} read · {matched} matched', ar: 'قُرئت {read} · طابقت {matched}' },
  importProgressPrivacy: {
    en: 'Reading backwards on this phone. Unsupported and private messages are discarded before storage; nothing is uploaded.',
    ar: 'تجري القراءة عكسياً على هذا الهاتف. يُتخلص من الرسائل غير المدعومة والخاصة قبل الحفظ، ولا يُرفع أي نص.',
  },
  pasteBankMessagesA11y: { en: 'Paste bank messages', ar: 'ألصق رسائل البنك' },
  bankMessageExample: {
    en: 'Purchase of AED 187.50 with Debit Card ending 1234 at CARREFOUR…',
    ar: 'شراء بقيمة 187.50 AED ببطاقة خصم تنتهي بـ 1234 لدى CARREFOUR…',
  },
  alreadyFiledSkipped: { en: 'already filed · skipped', ar: 'مسجّلة سابقاً · تم تخطيها' },
  improvedExistingEntries: {
    en: '{count} existing entr{ending} re-read better — renamed or recategorised in place.',
    ar: 'أُعيدت قراءة {count} من العمليات الحالية بدقة أفضل — وعُدّل الاسم أو التصنيف مباشرة.',
  },
  unknownMessageFormats: {
    en: '{count} message{s} in a format we do not know',
    ar: '{count} رسالة بصيغة لا نعرفها',
  },
  shareMaskedFormatsHint: {
    en: 'Send the shapes — digits masked — and they parse next release',
    ar: 'أرسل الصيغ — مع إخفاء الأرقام — لتصبح قابلة للتحليل في الإصدار القادم',
  },
  smsPermissionNeeded: { en: 'Permission needed', ar: 'الإذن مطلوب' },
  smsPermissionNeededBody: {
    en: 'SMS access is optional and used only for on-device bank-alert import. Anything that is not supported financial activity is discarded before storage. You can keep access off and paste messages manually below.',
    ar: 'إذن الرسائل اختياري ويُستخدم فقط لاستيراد تنبيهات البنك على الجهاز. يُتخلص من أي محتوى لا يمثل نشاطاً مالياً مدعوماً قبل الحفظ. يمكنك إبقاء الإذن مغلقاً ولصق الرسائل يدوياً أدناه.',
  },
  matchedLabel: { en: 'Matched', ar: 'مطابقة' },
  unreadLabel: { en: 'Unread', ar: 'غير مقروءة' },
  newCard: { en: 'New card', ar: 'بطاقة جديدة' },
  tracked: { en: 'Tracked', ar: 'قيد المتابعة' },
  track: { en: 'Track', ar: 'متابعة' },
  dueDay: { en: 'due day {day}', ar: 'مستحق يوم {day}' },
  justFiled: { en: 'Just filed', ar: 'سُجّلت الآن' },
  justFiledFirst: { en: 'Just filed · first {shown} of {total}', ar: 'سُجّلت الآن · أول {shown} من {total}' },
  fileEntries: { en: 'File {count} entr{ending}', ar: 'تسجيل {count} عملية' },
  fileCardDues: { en: 'File {count} card due{s}', ar: 'تسجيل {count} مستحق بطاقة' },
  fixEntries: { en: 'Fix {count} entr{ending}', ar: 'تصحيح {count} عملية' },

  noEntriesInMonth: { en: 'No entries in {month} yet', ar: 'لا عمليات في {month} بعد' },
  emptyMonthHelp: {
    en: 'Pull down to read your inbox, or add the last thing you paid for — one entry is enough to start the month.',
    ar: 'اسحب للأسفل لقراءة رسائلك، أو أضف آخر شيء دفعته — تكفي عملية واحدة لبدء الشهر.',
  },
  readInbox: { en: 'Read inbox', ar: 'قراءة الرسائل' },
  checkBankAlerts: { en: 'Check alerts', ar: 'تحقق من التنبيهات' },
  emptyMonthCaptureHelp: {
    en: 'No activity yet. Check for supported bank alerts or add one manually.',
    ar: 'لا توجد عمليات بعد. تحقق من تنبيهات البنك المدعومة أو أضف عملية يدوياً.',
  },
  addManually: { en: 'Add manually', ar: 'إضافة يدوية' },
  smsAccessOff: { en: 'SMS access is off, so nothing can import', ar: 'إذن الرسائل متوقف، لذا لا يمكن استيراد شيء' },
  smsPermissionPath: {
    en: 'Turn it back on at Settings → Apps → Wafra → Permissions → SMS.',
    ar: 'أعد تفعيله من الإعدادات ← التطبيقات ← وفرة ← الأذونات ← الرسائل.',
  },
  keepManual: { en: 'Keep manual', ar: 'المتابعة يدوياً' },
  noSpendingComposition: { en: 'No spending composition data', ar: 'لا توجد بيانات لتوزيع المصروفات' },
  compositionPercent: { en: '{label}, {percent} percent', ar: '{label}، {percent} بالمئة' },
  monthCashflowA11y: {
    en: '{month}, income {income}, spending {spending}',
    ar: '{month}، الدخل {income}، المصروف {spending}',
  },

  accountKindBank: { en: 'Bank', ar: 'حساب بنكي' },
  accountKindCard: { en: 'Card', ar: 'بطاقة' },
  accountKindCash: { en: 'Cash', ar: 'نقد' },
  justNow: { en: 'just now', ar: 'الآن' },
  minutesAgo: { en: '{count}m ago', ar: 'قبل {count} د' },
  hoursAgo: { en: '{count}h ago', ar: 'قبل {count} س' },
  differentCard: { en: 'Different card', ar: 'بطاقة مختلفة' },
  sameCardRenewed: { en: 'Same physical card?', ar: 'هل هذه البطاقة نفسها؟' },
  renewedCardBody: {
    en: 'Move entries from {old} to {next}. Link only when both rows are the same physical card.',
    ar: 'انقل العمليات من {old} إلى {next}. اربطهما فقط إذا كان السطران للبطاقة الفعلية نفسها.',
  },
  longPressInactive: { en: 'Long-press to unhide or delete', ar: 'اضغط مطولاً للإظهار أو الحذف' },
  setSavingsGoal: { en: 'Set a savings goal', ar: 'ضع هدفاً للادخار' },
  savingsGoalHint: {
    en: 'Umrah, a car, a rainy-day fund — track it here.',
    ar: 'عمرة أو سيارة أو صندوق للطوارئ — تابع هدفك هنا.',
  },
  newAccount: { en: 'New account', ar: 'حساب جديد' },
  accountNamePlaceholder: { en: 'Account name (e.g. ADCB Savings)', ar: 'اسم الحساب (مثال: حساب ادخار ADCB)' },
  openingBalanceOptional: { en: 'Opening balance (optional)', ar: 'الرصيد الافتتاحي (اختياري)' },
  addAccount: { en: 'Add account', ar: 'إضافة حساب' },
  newGoalTitle: { en: 'New goal', ar: 'هدف جديد' },
  goalPlaceholder: { en: 'Goal (e.g. Umrah trip, new car)', ar: 'الهدف (مثال: رحلة عمرة أو سيارة جديدة)' },
  targetAmount: { en: 'Target amount', ar: 'المبلغ المستهدف' },
  createGoal: { en: 'Create goal', ar: 'إنشاء الهدف' },
  deleteGoalTitle: { en: 'Delete goal?', ar: 'حذف الهدف؟' },
  walletSince: { en: 'since {date}', ar: 'منذ {date}' },
  addToGoal: { en: 'Add to {goal}', ar: 'أضف إلى {goal}' },
  amountInAed: { en: 'Amount', ar: 'المبلغ' },
  removeAccountTitle: { en: 'Remove account?', ar: 'إزالة الحساب؟' },
  removeAccountBody: {
    en: '“{name}” and all its transactions will be deleted. This cannot be undone.',
    ar: 'سيُحذف «{name}» وجميع عملياته. لا يمكن التراجع عن ذلك.',
  },
  payAccountTitle: { en: 'Pay {name}?', ar: 'سداد {name}؟' },
  payAccountBody: {
    en: 'Marks {amount} as paid and records the transfer.',
    ar: 'يسجّل {amount} كمدفوع ويسجّل التحويل.',
  },
  payByWithDays: { en: 'Pay by {date} · {days}d left', ar: 'السداد قبل {date} · متبقي {days} يوم' },
  minimumAmountShort: { en: 'min {amount}', ar: 'الحد الأدنى {amount}' },
  markAccountPaidA11y: { en: 'Mark {name} as paid', ar: 'علّم {name} كمدفوع' },
  totalSuffix: { en: '{amount} total', ar: 'الإجمالي {amount}' },
  renewedCardDetected: {
    en: 'Card •{last4} has a statement but its spending is under {name}. Link only if they are the same card; then payments can settle the right bill.',
    ar: 'للبطاقة •{last4} كشف حساب، لكن مصروفاتها ظهرت تحت {name}. اربطهما فقط إذا كانتا البطاقة نفسها؛ عندها تسوّي الدفعات الفاتورة الصحيحة.',
  },
  linkCardsA11y: { en: 'Link {old} to {next}', ar: 'اربط {old} بـ {next}' },
  sameAsCard: { en: 'Yes · same as •{last4}', ar: 'نعم · نفسها •{last4}' },
  keepCardSeparateA11y: { en: 'Keep {last4} separate', ar: 'أبقِ {last4} منفصلة' },
  daysAgo: { en: '{count} days ago', ar: 'قبل {count} يوم' },
  inboxScannedAgo: { en: 'Inbox scanned {time}', ar: 'فُحصت الرسائل {time}' },
  entriesReadLocally: {
    en: '{count} entr{ending} read on this device · nothing uploaded',
    ar: 'قُرئت {count} عملية على هذا الجهاز · لم يُرفع شيء',
  },

  moreItems: { en: '{count} more', ar: '{count} أخرى' },
  unreadMessageCount: { en: '{count} message{s} we could not read', ar: '{count} رسالة تعذّرت قراءتها' },
  unreadMessageHint: {
    en: 'Send them over and they get recognised next release. Digits are masked.',
    ar: 'أرسلها لتصبح معروفة في الإصدار القادم. الأرقام مخفية.',
  },
  seeBreakdown: { en: 'See the breakdown', ar: 'عرض التفاصيل' },
  dismiss: { en: 'Dismiss', ar: 'تجاهل' },
  seeUpcomingPaymentsA11y: {
    en: 'See all {count} upcoming payments',
    ar: 'عرض جميع الدفعات القادمة وعددها {count}',
  },
  reportUnreadFormatsA11y: {
    en: 'Report {count} unrecognised bank message formats',
    ar: 'الإبلاغ عن {count} من صيغ الرسائل البنكية غير المعروفة',
  },
  unreadFormatCount: {
    en: '{count} message format{s} we could not read',
    ar: '{count} من صيغ الرسائل التي تعذّرت قراءتها',
  },
  importedTransactions: {
    en: 'Imported {count} transaction{s}{bills}{cards}',
    ar: 'تم استيراد {count} عملية{bills}{cards}',
  },
  importedBills: { en: ' · {count} bill reminder{s}', ar: ' · {count} تذكير فواتير' },
  importedNewCards: { en: ' · {count} new card{s}', ar: ' · {count} بطاقة جديدة' },
  undo: { en: 'Undo', ar: 'تراجع' },
  allActivity: { en: 'All activity', ar: 'كل العمليات' },
  seenCount: { en: 'seen {count}×', ar: 'ظهرت {count}×' },
  // Card diagnostic. Offered even when nothing is unread, because the bugs it
  // answers — a payment counted twice, a statement filed against the wrong
  // card — happen to messages the parser read confidently and so never show up
  // in the unrecognised list.
  shareCardDiagnostic: { en: 'Share card diagnostic', ar: 'مشاركة تشخيص البطاقات' },
  shareCardDiagnosticHint: {
    en: 'Cards, statements, and every row filed against a card — with what each was counted as.',
    ar: 'البطاقات وكشوفها وكل عملية مرتبطة ببطاقة، مع كيفية احتسابها.',
  },
  accuracyShareTitle: {
    en: 'Wafra — bank SMS the app is not reading well:',
    ar: 'وفرة — رسائل بنكية لا يقرأها التطبيق جيداً:',
  },
  accuracyShareUnread: { en: 'COULD NOT READ — no merchant found', ar: 'تعذّرت القراءة — لم يُعثر على متجر' },
  accuracyShareUncategorized: {
    en: 'READ, BUT NO CATEGORY — merchant name is correct',
    ar: 'مقروءة بلا تصنيف — اسم المتجر صحيح',
  },
  accuracyShareRow: {
    en: '#{index} (seen {count}x, read as “{title}” / {category}):\n{raw}',
    ar: '#{index} (ظهرت {count}x، قُرئت كـ «{title}» / {category}):\n{raw}',
  },

  // Feedback. The register here is the same as the privacy section's: say what
  // leaves the phone, say it before it leaves, and never describe the feature
  // in terms of what it is FOR ("help us improve") when it can be described in
  // terms of what it DOES.
  sendFeedback: { en: 'Send feedback', ar: 'إرسال ملاحظة' },
  sendFeedbackDetail: {
    en: 'Report a bug, and choose what to attach',
    ar: 'أبلغ عن خلل، واختر ما تُرفقه',
  },
  feedbackIntro: {
    en: 'Say what went wrong. Nothing leaves this phone until you tap Send. The report is kept for at most 14 days for Wafra maintainers and is not sent to third-party AI.',
    ar: 'اكتب ما الذي حدث. لا يغادر شيء هذا الهاتف حتى تضغط إرسال. يُحتفظ بالتقرير لمدة أقصاها 14 يوماً لمشرفي وفرة ولا يُرسل إلى ذكاء اصطناعي خارجي.',
  },
  feedbackWriteHeader: { en: 'WHAT WENT WRONG', ar: 'ما الذي حدث' },
  feedbackPlaceholder: {
    en: 'Tuesday’s charge was filed twice.',
    ar: 'سُجّلت عملية الثلاثاء مرتين.',
  },
  feedbackInputA11y: { en: 'Describe what went wrong', ar: 'اكتب ما الذي حدث' },
  feedbackDigitsMasked: {
    en: 'Long numbers you type are masked before sending.',
    ar: 'تُخفى الأرقام الطويلة التي تكتبها قبل الإرسال.',
  },
  feedbackChars: { en: '{used} of {max}', ar: '{used} من {max}' },
  feedbackAttachHeader: { en: 'WHAT TO ATTACH', ar: 'ما الذي يُرفق' },
  feedbackAttachRow: { en: 'Attached', ar: 'المرفق' },
  feedbackDetailNone: { en: 'Just what you wrote', ar: 'ما كتبته فقط' },
  feedbackDetailNoneHint: { en: 'Nothing from your ledger.', ar: 'لا شيء من سجلك.' },
  feedbackDetailShapes: { en: 'And the message shapes', ar: 'وأشكال الرسائل' },
  feedbackDetailShapesHint: {
    en: 'Bank messages with every digit blanked and every name replaced. Send this if an entry was read wrong.',
    ar: 'رسائل البنك مع حذف كل رقم واستبدال كل اسم. أرسل هذا إذا قُرئت عملية بشكل خاطئ.',
  },
  feedbackDetailFigures: { en: 'And the amounts behind your totals', ar: 'والمبالغ خلف مجاميعك' },
  feedbackDetailFiguresHint: {
    en: 'Adds balances and statement figures. Still no names. Send this if a total looks wrong.',
    ar: 'يضيف الأرصدة وأرقام الكشوف. ولا أسماء أيضاً. أرسل هذا إذا بدا أحد المجاميع خاطئاً.',
  },
  feedbackPrivateOn: {
    en: 'Private Mode is on, so only your message can be sent.',
    ar: 'الوضع الخاص مفعّل، لذا لا يمكن إرسال سوى رسالتك.',
  },
  feedbackPrivateBlocked: {
    en: 'Private Mode keeps your ledger on this phone.',
    ar: 'الوضع الخاص يُبقي سجلك على هذا الهاتف.',
  },
  feedbackPreviewHeader: { en: 'EXACTLY WHAT WILL BE SENT', ar: 'ما سيُرسل بالضبط' },
  feedbackPreviewNote: {
    en: 'This is the whole report, not a summary. It is written in English for Wafra maintainers. Third-party AI review is off.',
    ar: 'هذا هو التقرير كاملاً، لا ملخص له. وهو مكتوب بالإنجليزية لمشرفي وفرة. مراجعة الذكاء الاصطناعي الخارجي متوقفة.',
  },
  feedbackSend: { en: 'Send report', ar: 'إرسال التقرير' },
  feedbackSending: { en: 'Sending…', ar: 'جارٍ الإرسال…' },
  feedbackSendQ: { en: 'Send this report?', ar: 'إرسال هذا التقرير؟' },
  feedbackSendBody: {
    en: 'The report above is what leaves this phone. It is kept for at most 14 days, read by Wafra maintainers, and not sent to third-party AI.',
    ar: 'التقرير أعلاه هو ما يغادر هذا الهاتف. يُحتفظ به لمدة أقصاها 14 يوماً ويقرأه مشرفو وفرة ولا يُرسل إلى ذكاء اصطناعي خارجي.',
  },
  feedbackSaveCopy: { en: 'Save a copy', ar: 'حفظ نسخة' },
  feedbackNeedsMessage: { en: 'Say what went wrong first.', ar: 'اكتب ما الذي حدث أولاً.' },
  feedbackSentTitle: { en: 'Report sent', ar: 'أُرسل التقرير' },
  feedbackSentBody: {
    en: 'Reference {id}. Wafra maintainers can review it for up to 14 days; no third-party AI receives it.',
    ar: 'المرجع {id}. يمكن لمشرفي وفرة مراجعته لمدة تصل إلى 14 يوماً، ولا يستلمه أي ذكاء اصطناعي خارجي.',
  },
  feedbackNoTransportTitle: { en: 'Sending is not connected yet', ar: 'الإرسال غير موصول بعد' },
  feedbackNoTransportBody: {
    en: 'This build has no way to deliver a report, so nothing was uploaded. Save a copy and send it yourself.',
    ar: 'لا توجد في هذه النسخة طريقة لتسليم التقرير، لذا لم يُرفع شيء. احفظ نسخة وأرسلها بنفسك.',
  },
  feedbackPreparing: {
    en: 'Preparing the attachment…',
    ar: 'جارٍ تجهيز المرفق…',
  },
  feedbackFailedTitle: { en: 'Could not send', ar: 'تعذّر الإرسال' },
  /**
   * The last resort, for a cause this screen does not recognise. Every cause
   * it DOES recognise gets its own line below, because "try again later" is
   * the wrong instruction for most of them: a build with no relay will fail
   * identically forever, an oversized report needs a smaller attachment, and
   * a report the server refused will be refused again unchanged.
   *
   * The transport already names five causes. Collapsing them here is the same
   * mistake the send handler's own comment warns about one level up —
   * "collapsing them is how a user ends up retrying a build that has no
   * transport in it at all" — and it was made anyway, one level down.
   */
  feedbackFailedBody: {
    en: 'The report did not leave the phone. Save a copy so it is not lost, and try again later.',
    ar: 'لم يغادر التقرير الهاتف. احفظ نسخة كي لا تضيع، وحاول لاحقاً.',
  },
  /**
   * Not "try again later": this build shipped without a relay address
   * compiled into it, so it cannot send now and will not be able to send in
   * an hour. The only thing that fixes it is a newer build.
   */
  feedbackNoRelayBody: {
    en: 'This build has no server address in it, so it can never send a report — waiting will not help. Save a copy, and install a newer build of Wafra.',
    ar: 'لا يحتوي هذا الإصدار على عنوان الخادم، لذا لا يمكنه إرسال أي تقرير مهما انتظرت. احفظ نسخة، وثبّت إصداراً أحدث من وفرة.',
  },
  feedbackOfflineTitle: { en: 'No connection', ar: 'لا يوجد اتصال' },
  feedbackOfflineBody: {
    en: 'The phone could not reach the server. Nothing was sent. This one is worth trying again once you are back online.',
    ar: 'تعذّر على الهاتف الوصول إلى الخادم، ولم يُرسل شيء. تستحق هذه المحاولة إعادةً عند عودة الاتصال.',
  },
  feedbackTooLargeTitle: { en: 'Too much attached', ar: 'المرفقات كبيرة جداً' },
  feedbackTooLargeBody: {
    en: 'The report is over the size the server accepts. Choose a smaller option under WHAT TO ATTACH, or shorten the message, then send again.',
    ar: 'حجم التقرير يتجاوز ما يقبله الخادم. اختر خياراً أصغر ضمن «ما الذي يُرفق»، أو اختصر الرسالة، ثم أعد الإرسال.',
  },
  feedbackRefusedTitle: { en: 'The server refused it', ar: 'رفضه الخادم' },
  feedbackRefusedBody: {
    en: 'The server would not take this report ({code}). Sending it again unchanged will get the same answer. Save a copy.',
    ar: 'لم يقبل الخادم هذا التقرير ({code}). إعادة إرساله كما هو ستعطي النتيجة نفسها. احفظ نسخة.',
  },
  feedbackBusyTitle: { en: 'Too many reports just now', ar: 'تقارير كثيرة الآن' },
  feedbackBusyBody: {
    en: 'The server is limiting how many reports it takes per hour. Save a copy and send it again in a while.',
    ar: 'يحدّ الخادم عدد التقارير المقبولة في الساعة. احفظ نسخة وأعد الإرسال بعد قليل.',
  },
  onboardImportResult: {
    en: '{entries} entr{ending} filed{cards}. Nothing left the phone.',
    ar: 'سُجّلت {entries} عملية{cards}. لم يغادر شيء الهاتف.',
  },
  onboardCardsFound: { en: ' · {count} card{s} found', ar: ' · عُثر على {count} بطاقة' },
  onboardScanProgress: {
    en: '{read} messages read · {matched} matched.',
    ar: 'قُرئت {read} رسالة · طابقت {matched}.',
  },
  seeCategoryEntriesA11y: { en: '{category}, see entries', ar: '{category}، عرض العمليات' },
  insightTrendingHigher: { en: 'Trending {percent}% higher', ar: 'يتجه للارتفاع {percent}٪' },
  insightTrendingLower: { en: 'Trending {percent}% lower', ar: 'يتجه للانخفاض {percent}٪' },
  insightPaceBody: {
    en: 'At today’s pace you will spend about {projected} this month, vs {previous} in {period}.',
    ar: 'بهذه الوتيرة ستنفق نحو {projected} هذا الشهر، مقابل {previous} في {period}.',
  },
  insightSpentMore: { en: 'Spent {percent}% more', ar: 'أنفقت أكثر بنسبة {percent}٪' },
  insightSpentLess: { en: 'Spent {percent}% less', ar: 'أنفقت أقل بنسبة {percent}٪' },
  insightComparisonBody: { en: '{current} vs {previous} in {period}.', ar: '{current} مقابل {previous} في {period}.' },
  insightBudgetExceeded: { en: '{category} budget exceeded', ar: 'تجاوزت ميزانية {category}' },
  insightBudgetExceededBody: { en: '{spent} spent of your {limit} limit.', ar: 'أنفقت {spent} من حدك البالغ {limit}.' },
  insightBudgetNear: { en: '{category} almost at limit', ar: 'اقترب {category} من الحد' },
  insightBudgetNearBody: { en: '{percent}% used — {left} left for the month.', ar: 'استخدمت {percent}٪ — متبقي {left} لهذا الشهر.' },
  insightCategoryLeads: { en: '{category} leads your spending', ar: '{category} يتصدر مصروفاتك' },
  insightCategoryLeadsBody: { en: '{amount} — {percent}% of this month’s expenses.', ar: '{amount} — {percent}٪ من مصروفات هذا الشهر.' },
  insightSavingRate: {
    en: 'Saving {percent}% of income',
    ar: 'تدخر \u2066{percent}٪\u2069 من الدخل',
  },
  insightSavingBodyLive: { en: '{amount} kept aside so far this month. Keep it up!', ar: 'ادخرت {amount} حتى الآن هذا الشهر. استمر!' },
  insightSavingBodyPeriod: { en: '{amount} kept aside. Keep it up!', ar: 'ادخرت {amount}. استمر!' },
  insightSpendingExceeds: { en: 'Spending exceeds income', ar: 'المصروف يتجاوز الدخل' },
  insightOverspendMonth: { en: 'Expenses are {amount} above income this month.', ar: 'تزيد المصروفات على الدخل بمقدار {amount} هذا الشهر.' },
  insightOverspendPeriod: { en: 'Expenses are {amount} above income in this period.', ar: 'تزيد المصروفات على الدخل بمقدار {amount} في هذه الفترة.' },
  insightBiggestPurchase: { en: 'Biggest purchase', ar: 'أكبر عملية شراء' },
  insightBiggestPurchaseBody: { en: '{merchant} — {amount} on {date}.', ar: '{merchant} — {amount} في {date}.' },
  insightSubscriptionsCost: { en: '{count} subscriptions cost {amount}/mo', ar: '{count} اشتراكاً تكلف {amount} شهرياً' },
  insightSubscriptionsShare: { en: 'That is {percent}% of this month’s income. Review them in Bills.', ar: 'يمثل ذلك {percent}٪ من دخل هذا الشهر. راجعها في الفواتير.' },
  insightActiveSubscriptions: { en: '{count} active subscriptions', ar: '{count} اشتراكات نشطة' },
  insightActiveSubscriptionsBody: { en: 'About {amount} per month combined.', ar: 'نحو {amount} شهرياً إجمالاً.' },
  insightGotPricier: { en: '{name} got pricier', ar: 'ارتفع سعر {name}' },
  insightGotPricierBody: { en: 'Last charge {last} vs the usual {usual}.', ar: 'آخر خصم {last} مقابل المعتاد {usual}.' },
  insightDailyAverage: { en: 'Daily average', ar: 'المتوسط اليومي' },
  insightDailyAverageMonth: { en: 'You spend about {amount} per day this month.', ar: 'تنفق نحو {amount} يومياً هذا الشهر.' },
  insightDailyAveragePeriod: { en: 'You spend about {amount} per day in this period.', ar: 'تنفق نحو {amount} يومياً في هذه الفترة.' },
  tomorrow: { en: 'tomorrow', ar: 'غداً' },
  inDaysPhrase: { en: 'in {days} days', ar: 'خلال {days} أيام' },
  daysLatePhrase: { en: '{days} day{s} late', ar: 'متأخر {days} يوم' },
  notificationChannelPayments: { en: 'Payment reminders', ar: 'تذكيرات الدفعات' },
  notificationChannelSummary: { en: 'Daily summary', ar: 'الملخص اليومي' },
  // "{amount} spent today · {count} transaction{s}" — the whole day in the
  // title, because a lock screen may never show the body.
  dailySummaryTitle: {
    en: '{amount} spent today · {count} transaction{s}',
    ar: 'صرفت {amount} اليوم · {count} عملية',
  },
  dailySummaryLine: { en: '{amount} — {merchant}', ar: '{amount} — {merchant}' },
  dailySummaryMore: { en: '+{count} more', ar: '+{count} أخرى' },
  dailySummaryBudget: {
    en: '{spent} of {limit} monthly limits ({percent}%)',
    ar: '{spent} من {limit} من حدودك الشهرية ({percent}%)',
  },
  // The iOS per-charge banner (charge-alert.ts). Android's equivalent cannot
  // read this table — it runs in a broadcast receiver with no JavaScript
  // engine — so its copy lives in modules/sms-reader/.../res/values*/strings.xml
  // and these deliberately mirror the wording there. Change one, change both.
  chargeAlertTitle: { en: '{amount} · {merchant}', ar: '{amount} · {merchant}' },
  chargeAlertTitlePlain: { en: '{amount} spent', ar: 'صُرف {amount}' },
  chargeAlertTitleCredit: { en: '{amount} received · {merchant}', ar: 'وصل {amount} · {merchant}' },
  chargeAlertTitleCreditPlain: { en: '{amount} received', ar: 'وصل {amount}' },
  // One wake can carry several charges. The headline counts and totals one
  // direction only — a total that netted a refund against two purchases would
  // be a number matching nothing the user can check.
  chargeAlertGroupTitle: {
    en: '{amount} spent · {count} charge{s}',
    ar: 'صُرف {amount} · {count} عملية',
  },
  chargeAlertGroupCreditTitle: {
    en: '{amount} received · {count} payment{s}',
    ar: 'وصل {amount} · {count} دفعة',
  },
  chargeAlertLineCredit: { en: '+{amount} — {merchant}', ar: '+{amount} — {merchant}' },
  // For the Settings row that switches the banner off. Off unless turned on,
  // as on Android: this is an interruption, not a default.
  chargeAlertsSetting: { en: 'Transaction alerts', ar: 'تنبيهات المعاملات' },
  chargeAlertsOn: {
    en: 'A silent note the moment a charge syncs',
    ar: 'تنبيه صامت فور مزامنة أي عملية',
  },
  dailySummarySetting: { en: 'Daily spend summary', ar: 'ملخص الصرف اليومي' },
  dailySummaryOn: {
    en: 'Every evening at 9pm, if you spent anything',
    ar: 'كل مساء الساعة ٩، إذا صرفت شيئاً',
  },
  dailySummaryOff: { en: 'Off', ar: 'متوقف' },
  notificationBillDue: { en: '{name} due {when}', ar: '{name} مستحق {when}' },
  notificationBillBody: { en: '{amount} · mark it paid in Wafra once done.', ar: '{amount} · علّمه كمدفوع في وفرة بعد السداد.' },
  creditCard: { en: 'Credit card', ar: 'بطاقة ائتمانية' },
  notificationCardDue: { en: '{name} payment due {when}', ar: 'دفعة {name} مستحقة {when}' },
  notificationOutstandingMinimum: { en: '{amount} outstanding · minimum {minimum}.', ar: 'المستحق {amount} · الحد الأدنى {minimum}.' },
  notificationOutstanding: { en: '{amount} outstanding.', ar: 'المستحق {amount}.' },
  notificationRenewsTomorrow: { en: '{name} renews tomorrow', ar: 'يتجدد {name} غداً' },
  notificationRenewalBody: { en: 'Around {amount} will be charged.', ar: 'سيُخصم نحو {amount}.' },
  creditCardWithDigits: { en: 'Credit Card •{last4}', ar: 'بطاقة ائتمانية •{last4}' },
  debitCardWithDigits: { en: 'Debit Card •{last4}', ar: 'بطاقة خصم •{last4}' },
  cardWithDigits: { en: 'Card •{last4}', ar: 'بطاقة •{last4}' },
  accountWithDigits: { en: 'Account •{last4}', ar: 'حساب •{last4}' },

  // The screen for a link that leads nowhere. It is the one place a person can
  // arrive at without having asked for it, which is exactly why it may not be
  // the one place that answers in the wrong language.
  notFoundTitle: { en: 'This page moved on', ar: 'هذه الصفحة لم تعد هنا' },
  notFoundBody: {
    en: 'Nothing lives at that link. Your entries are untouched — this is a signpost pointing at a room that isn’t there.',
    ar: 'لا شيء في هذا الرابط. عملياتك كما هي — هذه لافتة تشير إلى غرفة غير موجودة.',
  },
  goHome: { en: 'Go home', ar: 'إلى الرئيسية' },

  // ── Titles the PARSER mints ──
  //
  // A row the parser understood structurally has no merchant to show, so it is
  // given a title of its own: "ATM withdrawal", "Salary", "Card •3644 payment".
  // Those literals are the STORED value — `STRUCTURAL_TITLES.has(...)` in
  // sms-parser.ts, `NO_MERCHANT_TITLES` in accuracy.ts and the accuracy export
  // all match on them, and a translated ledger would break every one — so they
  // stay English on disk and are translated on the way to the screen, through
  // `structuralTitleLabel` at the bottom of this file.
  titleAtmWithdrawal: { en: 'ATM withdrawal', ar: 'سحب من الصراف' },
  titleBankFee: { en: 'Bank fee', ar: 'رسوم بنكية' },
  titleAnnualCardFee: { en: 'Annual card fee', ar: 'رسوم البطاقة السنوية' },
  titleAnnualBankFee: { en: 'Annual bank fee', ar: 'رسوم بنكية سنوية' },
  titleAccountMaintenanceFee: { en: 'Account maintenance fee', ar: 'رسوم صيانة الحساب' },
  titleServiceCharge: { en: 'Service charge', ar: 'رسوم خدمة' },
  titleOverlimitFee: { en: 'Overlimit fee', ar: 'رسوم تجاوز الحد' },
  titleInsufficientBalanceFee: { en: 'Insufficient balance fee', ar: 'رسوم عدم كفاية الرصيد' },
  titleLatePaymentFee: { en: 'Late payment fee', ar: 'رسوم تأخر السداد' },
  titleOverdraftFee: { en: 'Overdraft fee', ar: 'رسوم السحب على المكشوف' },
  titleVatFee: { en: 'VAT fee', ar: 'ضريبة القيمة المضافة' },
  titleCashDeposit: { en: 'Cash deposit', ar: 'إيداع نقدي' },
  titleCheque: { en: 'Cheque', ar: 'شيك' },
  titleParking: { en: 'Parking', ar: 'مواقف' },
  titleOutgoingTransfer: { en: 'Outgoing transfer', ar: 'تحويل صادر' },
  titleIncomingTransfer: { en: 'Incoming transfer', ar: 'تحويل وارد' },
  titleRefund: { en: 'Refund', ar: 'استرداد' },
  titleInwardRemittance: { en: 'Inward remittance', ar: 'حوالة واردة' },
  titleOutwardRemittance: { en: 'Outward remittance', ar: 'حوالة صادرة' },
  titleTelegraphicTransfer: { en: 'Telegraphic transfer', ar: 'حوالة برقية' },
  titleBankTransfer: { en: 'Bank transfer', ar: 'تحويل بنكي' },
  titleSavingsTransfer: { en: 'Savings transfer', ar: 'تحويل إلى الادخار' },
  titleCardPayment: { en: 'Card payment', ar: 'دفعة بطاقة' },
  titleAccountDebit: { en: 'Account debit', ar: 'خصم من الحساب' },
  titleMobileRecharge: { en: 'Mobile recharge', ar: 'شحن رصيد الهاتف' },
  titleCardStatement: { en: 'Card statement', ar: 'كشف حساب البطاقة' },
  titleBillPayment: { en: 'Bill payment', ar: 'دفع فاتورة' },
  titleSalary: { en: 'Salary', ar: 'راتب' },
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

/**
 * textAlign for a column of figures.
 *
 * They line up on the END of their column — the right in English, the left in
 * Arabic. React Native's textAlign has no 'end' value, only the physical
 * 'left' and 'right', so the direction has to be resolved here rather than
 * left to the layout engine.
 */
export function alignEnd(): 'left' | 'right' {
  return lang === 'ar' ? 'left' : 'right';
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

/**
 * A string in the current UI language.
 *
 * `in` is there for the one caller that cannot rely on "current": React
 * Compiler memoises a component's output on the values it can see going in,
 * and the module-level `lang` is not one of them. A component that reads the
 * language only through this function therefore keeps whatever labels it
 * rendered first until something else invalidates its memo — which is how the
 * tab bar kept five English labels under four Arabic screens. Passing the
 * language makes the dependency real rather than merely true.
 */
export function t(key: StringKey, override?: Lang): string {
  return S[key][override ?? lang] ?? S[key].en;
}

/**
 * A translated string with {placeholders} filled in.
 *
 * Sentences that carry a number used to be assembled in the screen by
 * concatenating English fragments, which meant they stayed English in Arabic
 * however well the rest of the screen was translated — the paywall's trial
 * line was doing exactly that. A whole sentence per language, with the number
 * dropped into it, is the only form a translator can actually work with.
 */
export function tf(
  key: StringKey,
  vars: Record<string, string | number>,
  override?: Lang,
): string {
  return t(key, override).replace(/\{(\w+)\}/g, (whole, name) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/**
 * Does this text contain Arabic script?
 *
 * The bundled Latin faces have NO Arabic coverage — every codepoint in the
 * block maps to .notdef in Geist — so a call site that pins `Fonts.sans*` over
 * an Arabic string does not merely look wrong, it renders nothing readable.
 * `ThemedText` asks this before it puts the Arabic face back; see the comment
 * there. The whole block is the test, digits and punctuation included, because
 * Geist cannot draw those either.
 */
export function hasArabicScript(text: string): boolean {
  // The Arabic block, the two supplements, Extended-A and both presentation
  // form blocks — the same literal-range style arabic-sms.ts uses, so the two
  // definitions of "this is Arabic" can be read side by side.
  return /[؀-ۿݐ-ݿࡰ-ࣿﭐ-﷿ﹰ-ﻼ]/.test(text);
}

/**
 * The English literal the parser stores → what to PRINT for it.
 *
 * A row the parser recognised structurally has no merchant to show, so it
 * carries a title the parser wrote itself. Those literals are load-bearing
 * identity — sms-parser's `STRUCTURAL_TITLES`, accuracy.ts's
 * `NO_MERCHANT_TITLES` / `CARD_PAYMENT_TITLE_RE`, and the format-report export
 * all match on the exact English — so the ledger keeps them in English and the
 * translation happens here, once, on the way to a screen.
 */
const STRUCTURAL_TITLE_KEYS: Record<string, StringKey> = {
  'ATM withdrawal': 'titleAtmWithdrawal',
  'Bank fee': 'titleBankFee',
  'Annual card fee': 'titleAnnualCardFee',
  'Annual bank fee': 'titleAnnualBankFee',
  'Account maintenance fee': 'titleAccountMaintenanceFee',
  'Service charge': 'titleServiceCharge',
  'Overlimit fee': 'titleOverlimitFee',
  'Insufficient balance fee': 'titleInsufficientBalanceFee',
  'Late payment fee': 'titleLatePaymentFee',
  'Overdraft fee': 'titleOverdraftFee',
  'VAT fee': 'titleVatFee',
  'Cash deposit': 'titleCashDeposit',
  Cheque: 'titleCheque',
  Parking: 'titleParking',
  'Outgoing transfer': 'titleOutgoingTransfer',
  'Incoming transfer': 'titleIncomingTransfer',
  Refund: 'titleRefund',
  'Inward remittance': 'titleInwardRemittance',
  'Outward remittance': 'titleOutwardRemittance',
  'Telegraphic transfer': 'titleTelegraphicTransfer',
  'Bank transfer': 'titleBankTransfer',
  'Savings transfer': 'titleSavingsTransfer',
  'Card payment': 'titleCardPayment',
  'Account debit': 'titleAccountDebit',
  'Mobile recharge': 'titleMobileRecharge',
  'Card statement': 'titleCardStatement',
  'Bill payment': 'titleBillPayment',
  Salary: 'titleSalary',
};

/** "Card •3644" and "Card •3644 payment" — a title with the digits inside it. */
const CARD_TITLE_RE = /^Card •([0-9Xx*]{2,6})( payment)?$/;

/**
 * A parser-minted title in the current UI language; anything else untouched.
 *
 * A merchant name is a proper noun and is never translated — passing one
 * through here returns it byte-for-byte, which is what lets a display layer
 * call this on every title without knowing which kind it holds.
 */
export function structuralTitleLabel(title: string, override?: Lang): string {
  const key = STRUCTURAL_TITLE_KEYS[title];
  if (key) return t(key, override);
  const card = CARD_TITLE_RE.exec(title);
  if (!card) return title;
  const name = tf('cardWithDigits', { last4: card[1] }, override);
  return card[2] ? tf('accountPaymentTitle', { name }, override) : name;
}
