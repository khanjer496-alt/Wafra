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
  owed: { en: 'owed', ar: 'المستحق عليك' },
  nothingSpentThisMonth: { en: 'nothing spent this month', ar: 'لا مصروف هذا الشهر' },
  perBankSms: { en: 'per bank SMS', ar: 'حسب رسالة البنك' },
  noBalanceYet: { en: 'no balance SMS yet', ar: 'لا رسالة رصيد بعد' },
  improveAccuracy: { en: 'Improve accuracy', ar: 'تحسين الدقة' },
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
  languageChanged: { en: 'Language changed', ar: 'تم تغيير اللغة' },
  mirrorOnNextOpen: {
    en: 'The text has changed already. Android can only mirror the layout right-to-left when the app starts, so that part arrives next time you open Wafra.',
    ar: 'تغيّر النص بالفعل. لا يستطيع أندرويد عكس اتجاه الواجهة إلى اليمين إلا عند بدء التطبيق، لذا سيظهر ذلك في المرة القادمة التي تفتح فيها وفرة.',
  },

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
  transferLabel: { en: 'Transfer', ar: 'تحويل' },
  // ── strings screens used to write in English inline ──
  founderMode: { en: 'Founder mode', ar: 'وضع المؤسس' },
  founderModeOff: { en: 'Founder mode off', ar: 'تم إيقاف وضع المؤسس' },
  founderOn: { en: 'Wafra Pro unlocked on this device.', ar: 'تم تفعيل وفرة برو على هذا الجهاز.' },
  founderOff: { en: 'Wafra Pro disabled on this device.', ar: 'تم إيقاف وفرة برو على هذا الجهاز.' },
  noScreenLock: { en: 'No screen lock set up', ar: 'لا يوجد قفل شاشة' },
  noScreenLockBody: { en: 'Set up a fingerprint, face unlock, or PIN in your phone settings first.', ar: 'أعدّ بصمة أو تعرّفاً على الوجه أو رمز PIN في إعدادات هاتفك أولاً.' },
  confirmAppLock: { en: 'Confirm to enable app lock', ar: 'أكّد لتفعيل قفل التطبيق' },
  smsRevokeHint: { en: 'Android only revokes this in its own settings: Settings → Apps → Wafra → Permissions → SMS.', ar: 'يُلغى هذا الإذن من إعدادات أندرويد فقط: الإعدادات ← التطبيقات ← وفرة ← الأذونات ← الرسائل.' },
  notificationsOff: { en: 'Notifications are off', ar: 'الإشعارات مغلقة' },
  notificationsOffBody: { en: 'Wafra needs notification permission to alert you. Turn it on in Settings → Apps → Wafra → Notifications.', ar: 'يحتاج وفرة إذن الإشعارات لتنبيهك. فعّله من الإعدادات ← التطبيقات ← وفرة ← الإشعارات.' },
  bankAppNotifsTitle: { en: 'Bank app notifications', ar: 'إشعارات تطبيقات البنوك' },
  eraseEverythingQ: { en: 'Erase everything on this phone?', ar: 'حذف كل شيء من هذا الهاتف؟' },
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
  onboardPrivacyBody: { en: 'Only messages from your bank are opened; the rest are never touched', ar: 'تُفتح رسائل بنكك فقط؛ وما عداها لا يُمسّ أبداً' },
  readMyInbox: { en: 'Read my inbox', ar: 'اقرأ رسائلي' },
  setCreditLimit: { en: 'Set credit limit', ar: 'تحديد حد الائتمان' },
  notifAccessBody: { en: 'Some banks send push notifications instead of SMS. Grant Wafra notification access and ', ar: 'ترسل بعض البنوك إشعارات بدل الرسائل. امنح وفرة إذن قراءة الإشعارات و' },
  notAWafraBackup: { en: 'That does not look like a Wafra backup.', ar: 'لا يبدو هذا ملف نسخ احتياطي لوفرة.' },
  noServerTitle: { en: 'There is no server', ar: 'لا يوجد خادم' },
  restoreReplacesAll: { en: 'This replaces everything currently in the app.', ar: 'سيستبدل هذا كل ما في التطبيق حالياً.' },
  trySensorAgain: { en: 'Try the sensor again', ar: 'جرّب المستشعر مرة أخرى' },
  upToDate: { en: 'Up to date', ar: 'كل شيء محدّث' },
  notifsForCardDue: { en: 'Wafra needs notification permission to remind you before a payment is due.', ar: 'يحتاج وفرة إذن الإشعارات لتذكيرك قبل موعد السداد.' },
  notifsForBill: { en: 'Wafra needs notification permission to warn you before a charge lands.', ar: 'يحتاج وفرة إذن الإشعارات لتنبيهك قبل خصم أي مبلغ.' },
  warnsBeforeMoneyLeaves: { en: 'Warns before the money leaves', ar: 'ينبّهك قبل خروج المال' },
  readInboxLater: { en: 'You can read your inbox later from Wallet.', ar: 'يمكنك قراءة رسائلك لاحقاً من المحفظة.' },
  dataStillLoading: { en: 'Your data is still loading. Try again in a second.', ar: 'ما زال تحميل بياناتك جارياً. أعد المحاولة بعد لحظة.' },
  historyIsIn: { en: 'Your history is in.', ar: 'تم إدخال سجلّك.' },
  inVsOut6: { en: 'In vs out · 6 months', ar: 'الدخل مقابل المصروف · ٦ أشهر' },
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
  onboardHeadline: { en: 'Your bank already texts you. Wafra reads it.', ar: 'بنكك يراسلك أصلاً. وفرة يقرأ الرسائل.' },
  onboardSub: { en: 'Every ENBD, FAB, and du alert becomes a filed transaction. On device, in AED, with no account to create.', ar: 'كل تنبيه من بنك الإمارات دبي الوطني أو FAB أو دو يتحول إلى عملية مسجّلة. على جهازك، بالدرهم، دون إنشاء حساب.' },
  onboardReadsSms: { en: 'Reads SMS, files the spend', ar: 'يقرأ الرسائل ويسجّل المصروف' },
  onboardWarnsDetail: { en: 'Card dues, DEWA, rent, and quiet subscriptions', ar: 'مستحقات البطاقات وفواتير ديوا والإيجار والاشتراكات الصامتة' },
  onboardNoServerDetail: { en: 'Nothing to breach, nothing to sell, nothing to sync', ar: 'لا شيء يُخترق، ولا شيء يُباع، ولا شيء يُزامن' },
  readingInbox: { en: 'Reading your inbox.', ar: 'جارٍ قراءة رسائلك.' },
  openWafra: { en: 'Open Wafra', ar: 'افتح وفرة' },
  continueWord: { en: 'Continue', ar: 'متابعة' },
  notifNoteOnboard: { en: 'Some banks send a push notification instead of an SMS — ADCB and Emirates NBD do for many cards. Those charges cannot be read without notification access.', ar: 'ترسل بعض البنوك إشعاراً بدل الرسالة — كما تفعل بنك أبوظبي التجاري وبنك الإمارات دبي الوطني لكثير من البطاقات. لا يمكن قراءة تلك العمليات دون إذن الإشعارات.' },
  nothingOutYet: { en: 'Nothing has gone out in this period yet.', ar: 'لم يخرج أي مبلغ في هذه الفترة بعد.' },
  noAccountsYet: { en: 'No bank or cash accounts yet.', ar: 'لا حسابات بنكية أو نقدية بعد.' },
  noStatementYet: { en: 'No statement message has arrived for this card yet.', ar: 'لم تصل رسالة كشف حساب لهذه البطاقة بعد.' },
  underMinimumDue: { en: 'Still under the minimum due.', ar: 'ما زال أقل من الحد الأدنى المستحق.' },
  transferExplainer: { en: 'Kept in balances, excluded from income and spending', ar: 'يُحتسب في الأرصدة ويُستثنى من الدخل والمصروف' },
  perYear: { en: 'per year', ar: 'سنوياً' },
  playOnlyTitle: { en: 'Available with the Play Store release', ar: 'متاح مع إصدار متجر Play' },
  playOnlyBody: {
    en: 'Purchases go through Google Play billing, which only works when Wafra is installed from the Play Store. This build has every Pro feature unlockable from Settings.',
    ar: 'تتم عمليات الشراء عبر فوترة Google Play، وهي تعمل فقط عند تثبيت وفرة من متجر Play. في هذا الإصدار يمكن تفعيل كل ميزات برو من الإعدادات.',
  },
  nothingToRestore: { en: 'Nothing to restore', ar: 'لا شيء لاستعادته' },
  nothingToRestoreBody: { en: 'Purchases arrive with the Play Store release.', ar: 'ستتوفر عمليات الشراء مع إصدار متجر Play.' },
  noPurchaseFound: { en: 'No purchase found', ar: 'لم يُعثر على عملية شراء' },
  noPurchaseFoundBody: {
    en: 'No previous Wafra Pro purchase on this Google account.',
    ar: 'لا توجد عملية شراء سابقة لوفرة برو على حساب Google هذا.',
  },
  monthsFreeSuffix: { en: '· {months} months free', ar: '· {months} أشهر مجاناً' },
  trialDaysLeftPaywall: {
    en: 'Everything is free for your first {total} days — {left} day{s} left. Keep it going:',
    ar: 'كل شيء مجاني في أول {total} أيام — تبقّى {left} يوم. تابع الاستخدام:',
  },
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
