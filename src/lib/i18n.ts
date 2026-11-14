/**
 * UI language layer. Strings live here as en/ar pairs; screens call t(key).
 * The language is auto-detected from the device on first launch (Arabic
 * devices get Arabic) and can be switched in Settings. Arabic also flips
 * the app to RTL (applied on next app start — a React Native constraint).
 *
 * SMS parsing language is independent of UI language: the parser grammar
 * follows the market pack, not this setting.
 */

import { IMPORT_PROCESSING_DISCLOSURE, importProcessingDisclosure } from '@/lib/import-processing-disclosure';

export type Lang = 'en' | 'ar';

const S = {
  // Transaction list and details: concise visible labels, complete semantics.
  transactionSearchLabel: { en: 'Search transactions', ar: 'البحث في العمليات' },
  transactionSearchPlaceholder: { en: 'Merchant or category', ar: 'التاجر أو الفئة' },
  transactionDayTotal: { en: 'Day total', ar: 'إجمالي اليوم' },
  // Rows added automatically from an unverified bank-alert format.
  autoAddedCheck: { en: 'Auto-added — check', ar: 'أُضيفت تلقائيًا — راجِعها' },
  autoAddedExplain: {
    en: 'Wafra added this from a bank message format it has not verified yet. Check the amount, date and whether money left or arrived.',
    ar: 'أضاف وفرة هذه العملية من صيغة رسالة بنكية لم يتحقق منها بعد. راجِع المبلغ والتاريخ وهل خرج المال أم دخل.',
  },
  autoAddedSettingSaveFailed: {
    en: 'This setting could not be saved. Try again.',
    ar: 'تعذر حفظ هذا الإعداد. حاول مجدداً.',
  },
  autoAddedLooksRight: { en: 'Looks right', ar: 'صحيحة' },
  autoAddedUndo: { en: 'Undo — remove', ar: 'تراجع — احذفها' },
  autoAddedUndoConfirm: { en: 'Remove this auto-added entry?', ar: 'حذف هذه العملية المضافة تلقائيًا؟' },
  autoAddedUndoHint: {
    en: 'Removes this entry. This alert will not be added again.',
    ar: 'يحذف هذه العملية، ولن تُضاف هذه الرسالة مرة أخرى.',
  },
  autoAddedFilter: { en: 'Auto-added to check', ar: 'مضافة تلقائيًا للمراجعة' },
  autoAddedCount: {
    en: '{count} auto-added to check',
    ar: 'عمليات مضافة تلقائيًا للمراجعة: {count}',
  },
  autoAddedSettingTitle: {
    en: 'Auto-add alerts from unverified bank formats',
    ar: 'إضافة رسائل البنوك غير المُتحقَّق منها تلقائيًا',
  },
  autoAddedSettingBody: {
    en: 'On: completed payments in these formats are added, marked “Auto-added — check”. Off: they wait in Review.',
    ar: 'التشغيل: تُضاف الدفعات المكتملة من هذه الصيغ بعلامة «أُضيفت تلقائيًا — راجِعها». الإيقاف: تبقى للمراجعة.',
  },
  shareFormatsSettingTitle: {
    en: 'Help other Wafra users with this bank',
    ar: 'ساعد مستخدمي وفرة الآخرين مع هذا البنك',
  },
  shareFormatsSettingBody: {
    en: 'When you teach a bank format, or confirm a Review item for an alert Wafra did not recognise, only the bank\'s wording is shared, never the message itself: amounts, card numbers and dates are removed and names are screened out. A format is used only after 3 different people send identical wording, and unpublished wording is deleted from the relay within 30 days.',
    ar: 'عند تعليم صيغة بنك أو تأكيد عنصر مراجعة لتنبيه لم تتعرف عليه وفرة، تُشارك صياغة البنك فقط ولا تُشارك الرسالة نفسها أبداً: تُحذف المبالغ وأرقام البطاقات والتواريخ ويتم استبعاد الأسماء. لا تُستخدم الصيغة إلا بعد أن يرسل ثلاثة أشخاص مختلفين الصياغة نفسها تماماً، وتُحذف الصياغة غير المنشورة من الخادم خلال 30 يوماً.',
  },
  shareFormatsSaveFailed: {
    en: 'The sharing choice could not be saved. Try again.',
    ar: 'تعذّر حفظ خيار المشاركة. حاول مرة أخرى.',
  },
  sharedFormatsCount: {
    en: 'Formats shared by other users: {count}',
    ar: 'الصيغ المشاركة من مستخدمين آخرين: {count}',
  },
  sharedFormatsCountBody: {
    en: 'Public bank shapes downloaded to this phone. Clearing them is safe; they can be downloaded again.',
    ar: 'صيغ بنوك عامة نُزّلت إلى هذا الهاتف. يمكن مسحها بأمان، ويمكن تنزيلها مرة أخرى.',
  },
  sharedFormatsClear: { en: 'Clear', ar: 'مسح' },
  rememberThisBill: { en: 'Remember this bill?', ar: 'تذكّر هذه الفاتورة؟' },
  billAliasAlso: {
    en: 'Use {title} · {category} for {n} matching past payment{s} and future payments from this biller.',
    ar: 'استخدم {title} · {category} لعدد {n} من الدفعات السابقة المطابقة وللدفعات القادمة لهذا المفوتر.',
  },
  billAliasFuture: {
    en: 'Future matching payments from this biller will use {title} · {category}.',
    ar: 'ستستخدم الدفعات القادمة المطابقة لهذا المفوتر {title} · {category}.',
  },
  registeredBillPayment: { en: 'Bill payment', ar: 'دفعة فاتورة' },
  accountTransferHistory: { en: 'Transfers', ar: 'التحويلات' },
  transactionDateLabel: { en: 'Transaction date', ar: 'تاريخ العملية' },
  ledgerCurrencyTitle: { en: 'Ledger currency', ar: 'عملة السجل' },
  ledgerCurrencyBody: {
    en: 'Choose the currency your main ledger is recorded in. You can still track purchases made in other currencies.',
    ar: 'اختر العملة التي يُسجّل بها سجلك الرئيسي. يمكنك مع ذلك تتبع المشتريات بعملات أخرى.',
  },
  chooseLedgerCurrency: { en: 'Choose currency', ar: 'اختر العملة' },
  ledgerCurrencyRequiredHint: {
    en: 'Required before your first manual entry.',
    ar: 'مطلوبة قبل أول عملية يدوية.',
  },
  ledgerCurrencyPermanentHint: {
    en: 'Locked after money is recorded to protect historical amounts.',
    ar: 'تُثبّت بعد تسجيل المال لحماية المبالغ التاريخية.',
  },
  currencyPhoneSuggestion: {
    en: 'Your phone suggests {currency}. Confirm the currency you actually use.',
    ar: 'يقترح هاتفك {currency}. أكّد العملة التي تستخدمها فعلياً.',
  },
  currencySuggestedByPhone: { en: 'Suggested by your phone region', ar: 'مقترحة حسب منطقة الهاتف' },
  currencyDecimalPlaces: { en: '{count} decimal places', ar: '{count} منازل عشرية' },
  searchCurrency: { en: 'Search currency code', ar: 'ابحث عن رمز العملة' },
  currencyCodeExample: { en: 'USD, EUR, JPY…', ar: 'USD، EUR، JPY…' },
  currencyNotSupported: {
    en: 'That currency is not supported for a Wafra ledger yet.',
    ar: 'هذه العملة غير مدعومة لسجل وفرة حالياً.',
  },
  instantSmsDisclosureTitle: {
    en: 'Enable live bank SMS tracking?',
    ar: 'تفعيل تتبّع رسائل البنك فور وصولها؟',
  },
  instantSmsDisclosureBody: {
    en: 'Even when Wafra is closed, it checks incoming SMS on this phone for financial activity. Supported payments can update your ledger or appear in Review and can trigger an optional alert. This check stays on your device. You can skip it and still import SMS history.',
    ar: 'حتى عند إغلاق وفرة، يفحص التطبيق الرسائل النصية الواردة على هذا الهاتف بحثًا عن نشاط مالي. قد تُضاف الدفعات المدعومة إلى سجلك أو تظهر في المراجعة، ويمكن عرض تنبيه اختياري. يتم الفحص على جهازك. يمكنك تخطّي هذه الخطوة والاستمرار في استيراد سجل الرسائل.',
  },
  bankPushNoticeTitle: { en: 'Bank transaction added', ar: 'تمت إضافة عملية بنكية' },
  bankPushNoticeBody: {
    en: '{merchant} was added to Wafra.',
    ar: 'تمت إضافة {merchant} إلى وفرة.',
  },
  bankPushNoticeGroupTitle: {
    en: '{count} bank transactions added',
    ar: 'تمت إضافة {count} عمليات بنكية',
  },
  bankPushNoticeGroupBody: {
    en: 'Wafra updated your ledger automatically.',
    ar: 'حدّثت وفرة سجلك تلقائياً.',
  },
  liveTransactionAdded: { en: 'Transaction added to Wafra', ar: 'تمت إضافة العملية إلى وفرة' },
  liveTransactionsAdded: {
    en: '{count} transactions added to Wafra',
    ar: 'تمت إضافة {count} عمليات إلى وفرة',
  },
  testerDiagnosticsSend: { en: 'Send test diagnostics', ar: 'إرسال تشخيص الاختبار' },
  testerDiagnosticsCollecting: { en: 'Collecting diagnostics…', ar: 'جارٍ جمع التشخيص…' },
  testerDiagnosticsChecked: { en: '{count} messages checked', ar: 'تم فحص {count} رسالة' },
  testerDiagnosticsSending: { en: 'Sending diagnostics…', ar: 'جارٍ إرسال التشخيص…' },
  testerDiagnosticsDetail: {
    en: 'Sends one privacy-safe report to Wafra Cloudflare with performance, parser/category, SMS import and bank-notification health. Raw SMS, names, card/account numbers and exact amounts are not uploaded.',
    ar: 'يرسل تقريراً واحداً آمناً للخصوصية إلى Cloudflare يتضمن الأداء والمحلل والتصنيفات واستيراد SMS وحالة إشعارات البنوك. لا يتم رفع نص الرسائل أو الأسماء أو أرقام البطاقات/الحسابات أو المبالغ الدقيقة.',
  },
  testerDiagnosticsSentTitle: { en: 'Diagnostics sent', ar: 'تم إرسال التشخيص' },
  testerDiagnosticsSentBody: {
    en: 'Report ID: {id}\n\nKeep this ID so the report can be retrieved from Cloudflare.',
    ar: 'معرّف التقرير: {id}\n\nاحتفظ بهذا المعرّف لاسترجاع التقرير من Cloudflare.',
  },
  testerDiagnosticsFailedTitle: { en: 'Could not send diagnostics', ar: 'تعذر إرسال التشخيص' },
  testerDiagnosticsFailedBody: {
    en: 'Delivery could not be confirmed. Check your connection and try again.',
    ar: 'تعذر تأكيد وصول التقرير. تحقق من الاتصال وحاول مرة أخرى.',
  },
  filterUpdating: { en: 'Updating results…', ar: 'جارٍ تحديث النتائج…' },
  incomeAccountReview: { en: 'Account needs review', ar: 'الحساب بحاجة إلى مراجعة' },
  incomeAccountReviewBody: { en: 'This payment counts as income, but the message did not identify its bank account. Edit this entry to select the correct account. No bank balance has been inferred.', ar: 'تُحتسب هذه الدفعة ضمن الدخل، لكن الرسالة لم تحدد حسابها المصرفي. عدّل العملية لاختيار الحساب الصحيح. لم يتم افتراض أي رصيد مصرفي.' },
  // Tabs
  tabHome: { en: 'Home', ar: 'الرئيسية' },
  // Insights and Budgets were two views of the same month; Flow is the merge.
  tabFlow: { en: 'Spending', ar: 'الإنفاق' },
  tabBills: { en: 'Bills', ar: 'الفواتير' },
  tabWallet: { en: 'Accounts', ar: 'الحسابات' },

  // Common actions
  cancel: { en: 'Cancel', ar: 'إلغاء' },
  back: { en: 'Back', ar: 'رجوع' },
  close: { en: 'Close', ar: 'إغلاق' },
  delete: { en: 'Delete', ar: 'حذف' },
  save: { en: 'Save', ar: 'حفظ' },
  seeAll: { en: 'See all', ar: 'عرض الكل' },
  markPaid: { en: 'Record as paid', ar: 'تسجيل كمدفوعة' },
  remindMe: { en: 'Remind me', ar: 'ذكّرني' },
  report: { en: 'Report', ar: 'التقرير' },
  review: { en: 'Review', ar: 'مراجعة' },
  today: { en: 'Today', ar: 'اليوم' },
  yesterday: { en: 'Yesterday', ar: 'أمس' },
  reportingPeriod: {
    en: 'Reporting period: {period}. Tap to change.',
    ar: 'فترة التقرير: {period}. اضغط للتغيير.',
  },
  assistantCorrectionUpdatedTitle: {
    en: 'Updated · {title}',
    ar: 'تم التحديث · {title}',
  },
  assistantCorrectionMerchantCategoryIncome: {
    en: 'Updated {merchant} to {category} for matching income transactions.',
    ar: 'تم تحديث {merchant} إلى {category} لعمليات الدخل المطابقة.',
  },
  assistantCorrectionMerchantCategoryExpense: {
    en: 'Updated {merchant} to {category} for matching expense transactions.',
    ar: 'تم تحديث {merchant} إلى {category} لعمليات المصروفات المطابقة.',
  },
  assistantCorrectionTransactionCategory: {
    en: 'Updated that transaction to {category}.',
    ar: 'تم تحديث تلك العملية إلى {category}.',
  },
  assistantCorrectionNotSubscription: {
    en: 'Marked {merchant} as not a subscription.',
    ar: 'تم اعتبار {merchant} غير اشتراك.',
  },
  assistantCorrectionTargetMissing: {
    en: 'Correction target disappeared',
    ar: 'لم تعد العملية المستهدفة للتصحيح متاحة',
  },
  assistantCorrectionOwnTransfer: {
    en: 'Marked that transaction as a transfer involving your own accounts.',
    ar: 'تم اعتبار تلك العملية تحويلاً بين حساباتك.',
  },
  assistantCorrectionExternalTransfer: {
    en: 'Marked that transfer as involving an external party.',
    ar: 'تم اعتبار ذلك التحويل مع طرف خارجي.',
  },

  // Greetings
  goodMorning: { en: 'Good morning', ar: 'صباح الخير' },
  goodAfternoon: { en: 'Good afternoon', ar: 'مساء الخير' },
  goodEvening: { en: 'Good evening', ar: 'مساء الخير' },

  // Home
  inLabel: { en: 'In', ar: 'الدخل' },
  outLabel: { en: 'Spent', ar: 'الإنفاق' },
  cashOutBreakdown: {
    en: 'Card repayments {cards} · bank, debit and cash {accounts}',
    ar: 'سداد البطاقات {cards} · البنك والخصم والنقد {accounts}',
  },
  loadingLedger: { en: 'Loading your ledger', ar: 'جارٍ تحميل سجلك المالي' },
  manage: { en: 'Manage', ar: 'إدارة' },
  trialEndedBanner: { en: 'Free capture ended · automatic capture paused', ar: 'انتهى الالتقاط المجاني · الالتقاط التلقائي متوقف' },
  trialEndedBannerSub: { en: 'Subscribe to keep importing your bank SMS', ar: 'اشترك لمواصلة قراءة رسائل البنك' },
  turnOnTracking: { en: 'Turn on automatic tracking', ar: 'فعّل التتبع التلقائي' },
  trackingPrivacy: { en: 'Wafra reads bank SMS on this device only', ar: 'وفرة تقرأ رسائل البنك على هذا الجهاز فقط' },
  automaticCapture: { en: 'Automatic capture', ar: 'الالتقاط التلقائي' },
  captureAndroidOn: {
    en: 'Watching bank messages',
    ar: 'يراقب رسائل البنك',
  },
  captureAndroidPrivate: {
    en: 'Parsed here · nothing uploaded',
    ar: 'تُحلَّل هنا · لا يُرفع شيء',
  },
  captureIosNeedsAutomation: {
    en: 'Finish the one-time Message automation',
    ar: 'أكمل إعداد أتمتة الرسائل لمرة واحدة',
  },
  captureIosWaitingForAlert: {
    en: 'Ready — waiting for the first bank message',
    ar: 'جاهز — بانتظار أول تنبيه مصرفي',
  },
  captureIosFirstAlertCaptured: {
    en: 'First bank message captured locally',
    ar: 'تم التقاط أول تنبيه مصرفي محلياً',
  },
  captureIosQueueWarning: {
    en: 'Capture needs attention; open recovery',
    ar: 'يحتاج الالتقاط إلى انتباه؛ افتح الاسترداد',
  },
  captureIosMigrationRetry: {
    en: 'Local capture works; finish retiring the old Shortcut upload',
    ar: 'يعمل الالتقاط المحلي؛ أكمل إيقاف رفع الاختصار القديم',
  },
  captureIosLocalPrivacy: {
    en: 'The new bank-message capture path processes Messages on this iPhone and does not upload their text. An old Wafra Capture automation may still upload until removed or retired.',
    ar: 'يعالج مسار الالتقاط الجديد رسائل البنك على هذا الآيفون ولا يرفع نصوصها. وقد تستمر أتمتة Wafra Capture القديمة في الرفع حتى تحذفها أو يكتمل إيقافها.',
  },
  captureIosQueueWarningDetail: {
    en: 'This status shows only source-free counts. Accepted pending records may keep Message text and sender protected and encrypted on this iPhone; they expire after 30 days and are removed the next time capture runs or Wafra checks the queue.',
    ar: 'تعرض هذه الحالة أعداداً خالية من بيانات المصدر فقط. وقد تحتفظ السجلات المعلّقة المقبولة بنص الرسالة واسم المرسل محميَّين ومشفَّرين على هذا الآيفون؛ وتنتهي صلاحيتها بعد ٣٠ يوماً وتُزال عند تشغيل الالتقاط أو فحص وفرة للصف في المرة التالية.',
  },
  captureIosQueueCounts: {
    en: 'Pending {pending} · dropped {dropped} · corrupt {corrupt}',
    ar: 'قيد الانتظار {pending} · مفقودة {dropped} · تالفة {corrupt}',
  },
  captureIosRecoveryTitle: {
    en: 'Process pending alerts and finish recovery?',
    ar: 'معالجة التنبيهات المعلّقة وإكمال الاسترداد؟',
  },
  captureIosRecoveryBody: {
    en: 'Wafra will process the protected pending queue. If a dropped or corrupt warning exists, Wafra clears only that exact warning. Alerts already reported as dropped or corrupt cannot be restored; add any missing entries manually. Recovery works while tracking is paused and does not turn capture on.',
    ar: 'ستعالج وفرة صف الانتظار المحمي. وإذا وُجد تحذير عن تنبيهات مفقودة أو تالفة، فستمحو وفرة ذلك التحذير المحدد فقط. لا يمكن استعادة التنبيهات التي أُبلغ بأنها مفقودة أو تالفة؛ أضف أي عمليات ناقصة يدوياً. يعمل الاسترداد أثناء توقف التتبع ولا يفعّل الالتقاط.',
  },
  captureIosRecoveryAction: {
    en: 'Process & recover',
    ar: 'عالج واسترد',
  },
  captureIosRecoveryCompleteTitle: {
    en: 'Capture recovery complete',
    ar: 'اكتمل استرداد الالتقاط',
  },
  captureIosRecoveryCompleteBody: {
    en: 'Recoverable pending alerts were processed. Check the ledger and add any alert that was previously dropped or corrupt.',
    ar: 'تمت معالجة التنبيهات المعلّقة القابلة للاسترداد. تحقق من السجل وأضف يدوياً أي تنبيه كان مفقوداً أو تالفاً.',
  },
  captureIosRecoveryRetryTitle: {
    en: 'Recovery needs another try',
    ar: 'يحتاج الاسترداد إلى محاولة أخرى',
  },
  captureIosRecoveryRetryBody: {
    en: 'A new warning arrived or some pending alerts could not be saved. Nothing was cleared early. Keep Wafra open and try recovery again.',
    ar: 'وصل تحذير جديد أو تعذّر حفظ بعض التنبيهات المعلّقة. لم يُمسح شيء مبكراً. أبقِ وفرة مفتوحة وحاول الاسترداد مرة أخرى.',
  },
  captureIosMigrationRetryDetail: {
    en: 'The new capture path stays local, but the old Shortcut automation may keep uploading until cleanup succeeds or you remove it.',
    ar: 'يبقى مسار الالتقاط الجديد محلياً، لكن أتمتة الاختصار القديمة قد تستمر في الرفع حتى يكتمل إيقافها أو تحذفها.',
  },
  captureIosNeedsTest: {
    en: 'Connected · run the safe test',
    ar: 'متصل · شغّل الاختبار الآمن',
  },
  captureIosOff: { en: 'Set up bank messages', ar: 'إعداد رسائل البنك' },
  captureIosRevoked: {
    en: 'This iPhone was removed · capture stopped',
    ar: 'أُزيل هذا الآيفون · توقّف الالتقاط',
  },
  captureRefreshFailed: {
    en: 'Could not refresh. Pull down to try again.',
    ar: 'تعذّر التحديث. اسحب للأسفل للمحاولة مرة أخرى.',
  },
  capturePhoneOnly: { en: 'Bank messages need the phone app', ar: 'رسائل البنك تتطلب تطبيق الهاتف' },
  captureReady: { en: 'ON', ar: 'مفعّل' },
  captureFinish: { en: 'FINISH', ar: 'أكمل' },
  captureRecover: { en: 'RECOVER', ar: 'استرداد' },
  captureEnable: { en: 'ENABLE', ar: 'فعّل' },
  capturePaused: { en: 'Tracking paused', ar: 'توقف التتبع' },
  pausedBadge: { en: 'PAUSED', ar: 'متوقف' },
  captureChecking: { en: 'Checking capture…', ar: 'جارٍ التحقق من الالتقاط…' },
  captureIosSetupDetail: { en: 'Past and future messages', ar: 'الرسائل السابقة والجديدة' },
  captureLatest: { en: 'Latest filed {date}', ar: 'آخر عملية مسجّلة {date}' },
  emptyPeriodBody: { en: 'Pull down to check for new bank activity. One transaction is enough to start the month.', ar: 'اسحب للأسفل للتحقق من نشاط بنكي جديد. تكفي عملية واحدة لبدء الشهر.' },

  // Structured global-alert review. These items are deliberately described as
  // possible activity, never as parser failures, and none of this copy claims
  // an item has entered the ledger.
  genericUsePasteDate: { en: 'Use date added', ar: 'استخدم تاريخ الإضافة' },
  genericReviewCount: { en: 'Review {count} alert{s}', ar: 'راجع التنبيهات: {count}' },
  genericReviewSaveFailed: { en: 'Could not save these details for review. Try again.', ar: 'تعذر حفظ هذه التفاصيل للمراجعة. حاول مجدداً.' },
  genericReviewTitle: { en: 'Check bank message', ar: 'تحقق من رسالة البنك' },
  genericReviewDetails: { en: 'Review details', ar: 'راجع التفاصيل' },
  genericUnverifiedIssuer: { en: 'Issuer not verified', ar: 'الجهة المرسلة غير متحققة' },
  genericStatement: { en: 'Card statement', ar: 'كشف البطاقة' },
  genericBalanceUpdate: { en: 'Balance update', ar: 'تحديث الرصيد' },
  genericCardPayment: { en: 'Card payment', ar: 'سداد بطاقة' },
  genericBill: { en: 'Upcoming payment', ar: 'دفعة قادمة' },
  genericAmountNeedsReview: { en: 'Amount needs review', ar: 'المبلغ يحتاج إلى مراجعة' },
  genericTransactionDate: { en: 'Transaction date', ar: 'تاريخ العملية' },
  genericAmount: { en: 'Amount', ar: 'المبلغ' },
  genericChooseAmount: { en: 'Choose the transaction amount', ar: 'اختر مبلغ العملية' },
  genericMissingAmount: { en: 'The transaction amount needs checking.', ar: 'يحتاج مبلغ العملية إلى مراجعة.' },
  genericChooseInstrument: { en: 'Choose the card or account', ar: 'اختر البطاقة أو الحساب' },
  genericCard: { en: 'Card', ar: 'بطاقة' },
  genericAccount: { en: 'Account', ar: 'حساب' },
  genericWallet: { en: 'Wallet', ar: 'محفظة' },
  genericChooseDate: { en: 'Confirm the transaction date', ar: 'أكد تاريخ العملية' },
  genericUseMessageDate: { en: 'Use alert date', ar: 'استخدم تاريخ التنبيه' },
  genericConfirmPosted: { en: 'I confirm this money has moved.', ar: 'أؤكد أن هذه العملية المالية تمت.' },
  genericChooseDirection: { en: 'Choose money in or money out.', ar: 'اختر دخلاً أو مصروفاً.' },
  genericStatementTotal: { en: 'Statement total', ar: 'إجمالي الكشف' },
  genericMinimumDue: { en: 'Minimum payment', ar: 'الحد الأدنى للسداد' },
  genericBalance: { en: 'Balance', ar: 'الرصيد' },
  genericCreditLimit: { en: 'Credit limit', ar: 'الحد الائتماني' },
  genericStatementDate: { en: 'Statement date', ar: 'تاريخ الكشف' },
  genericDueDate: { en: 'Due date', ar: 'تاريخ الاستحقاق' },
  genericMissingStatementTotal: { en: 'The total balance is not stated. A minimum payment is not the full amount owed.', ar: 'لم يُذكر إجمالي المستحق. الحد الأدنى للسداد ليس كامل المبلغ المستحق.' },
  genericOpenCards: { en: 'Open cards', ar: 'افتح البطاقات' },
  genericOpenWallet: { en: 'Open wallet', ar: 'افتح المحفظة' },
  genericOpenBills: { en: 'Open bills', ar: 'افتح الفواتير' },
  genericConfirmAdd: { en: 'Confirm and add', ar: 'أكد وأضف' },
  shareFormatNotice: {
    en: 'If you confirm this reading unchanged, Wafra shares this bank\'s wording — names screened out — to help other users.',
    ar: 'إذا أكدت هذه القراءة دون تغيير، تُشارك وفرة صياغة هذا البنك — مع استبعاد الأسماء — لمساعدة المستخدمين الآخرين.',
  },
  shareFormatTurnOff: { en: 'Turn off sharing bank wording', ar: 'إيقاف مشاركة صياغة البنك' },
  shareFormatTurnedOff: { en: 'Sharing turned off', ar: 'تم إيقاف المشاركة' },
  genericCompleteFields: { en: 'Complete the missing detail before adding.', ar: 'أكمل المعلومة الناقصة قبل الإضافة.' },
  genericCurrencyMismatch: { en: 'Choose an amount in your ledger’s currency.', ar: 'اختر مبلغاً بعملة سجلك.' },
  foreignReviewConversionNote: {
    en: 'Added in {ledger}: the card’s own {ledger} amount when the alert states it, otherwise a dated reference rate. The original amount is kept.',
    ar: 'تُضاف بعملة {ledger}: بمبلغ البطاقة بعملة {ledger} إن ذكره التنبيه، وإلا بسعر مرجعي مؤرّخ. ويُحفظ المبلغ الأصلي.',
  },
  fxRateUnavailable: {
    en: 'No exchange rate for that day yet. Nothing was added. Try again when you are online.',
    ar: 'لا يتوفر سعر صرف لذلك اليوم بعد. لم تتم إضافة شيء. حاول مجدداً عند الاتصال بالإنترنت.',
  },
  amountInCurrency: { en: 'Amount in {currency}', ar: 'المبلغ بعملة {currency}' },
  spendCurrencyTitle: { en: 'Currency paid', ar: 'عملة الدفع' },
  spendCurrencyHint: {
    en: 'Paid in another currency? Choose it here.',
    ar: 'دفعت بعملة أخرى؟ اخترها هنا.',
  },
  spendCurrencyBody: {
    en: 'Choose the currency on the receipt. Wafra records it in {ledger} with the dated public reference rate for that day and keeps the original amount. Only the two currency codes and the date are sent to get the rate.',
    ar: 'اختر العملة المذكورة في الإيصال. يسجلها وفرة بعملة {ledger} بسعر مرجعي عام لذلك اليوم ويحتفظ بالمبلغ الأصلي. لا يُرسل للحصول على السعر إلا رمزا العملتين والتاريخ.',
  },
  foreignManualNote: {
    en: 'Saved in {ledger} at the reference rate for this day; the {currency} amount is kept.',
    ar: 'يُحفظ بعملة {ledger} بالسعر المرجعي لهذا اليوم، مع الاحتفاظ بالمبلغ بعملة {currency}.',
  },
  genericSourceChanged: { en: 'This alert changed or expired. Reopen it to review.', ar: 'تغير هذا التنبيه أو انتهت صلاحيته. افتحه مجدداً للمراجعة.' },
  reviewAlertsTitle: { en: 'Bank messages needing help', ar: 'رسائل بنكية تحتاج مساعدتك' },
  reviewAlertsHomeCount: {
    en: '{count} alert{s} to review',
    ar: '{count} تنبيه مالي للمراجعة',
  },
  reviewAlertsSettingsCount: {
    en: '{count} could not be added automatically',
    ar: 'تعذّرت إضافة {count} تلقائياً',
  },
  reviewAlertsPrivacy: {
    en: 'Only a structured summary is kept here. Message text is not stored.',
    ar: 'يُحفظ هنا ملخص منظّم فقط. لا يُحفظ نص الرسالة.',
  },
  reviewAlertsEmptyBody: {
    en: 'Captured alerts that need your review will appear here.',
    ar: 'ستظهر هنا التنبيهات الملتقطة التي تحتاج إلى مراجعتك.',
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
  reviewAlertObservedDate: { en: 'Alert date', ar: 'تاريخ التنبيه' },
  applePayReviewTitle: { en: 'Apple Pay purchase', ar: 'عملية Apple Pay' },
  applePayReviewSource: { en: 'Apple Pay via Shortcuts', ar: 'Apple Pay عبر الاختصارات' },
  applePayReviewHeader: { en: 'Check Apple Pay purchase', ar: 'تحقق من عملية Apple Pay' },
  applePayReviewObserved: { en: 'Apple Pay capture date', ar: 'تاريخ التقاط Apple Pay' },
  applePayReviewUseDate: { en: 'Use Apple Pay capture date', ar: 'استخدام تاريخ التقاط Apple Pay' },
  applePayReviewQuestion: { en: 'Is this purchase already recorded?', ar: 'هل هذه العملية مسجلة بالفعل؟' },
  applePayReviewBody: { en: 'A matching purchase is already in your transactions. Choose Already recorded if they are the same purchase. If this is a different purchase, keep it in Review while you check your transactions.', ar: 'توجد عملية مطابقة في معاملاتك. اختر مسجلة بالفعل إذا كانت العملية نفسها. إذا كانت عملية مختلفة، احتفظ بها في المراجعة حتى تتحقق من معاملاتك.' },
  applePayReviewKeep: { en: 'Keep in Review', ar: 'الاحتفاظ في المراجعة' },
  applePayReviewRecorded: { en: 'Already recorded', ar: 'مسجلة بالفعل' },
  applePayReviewRetry: { en: 'Retry saving', ar: 'إعادة محاولة الحفظ' },
  applePayReviewFailed: { en: 'The decision could not be saved. Retry to finish recording it securely.', ar: 'تعذر حفظ القرار. أعد المحاولة لإكمال حفظه بأمان.' },
  iosApplePayWalletHelp: { en: 'Card taps use the Transaction trigger in Shortcuts. Check the amount, account and payment date in Review. A permission check does not prove that a payment was received.', ar: 'تستخدم عمليات الدفع ببطاقتك مشغّل المعاملة في الاختصارات. تحقق من المبلغ والحساب وتاريخ الدفع في المراجعة. فحص الإذن لا يثبت وصول عملية دفع.' },
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
    en: "Fix only the detail Wafra couldn't determine, then add it.",
    ar: 'حدّد فقط المعلومة التي لم تستطع وفرة معرفتها، ثم أضف العملية.',
  },
  reviewAlertAddTitle: { en: 'Review transaction', ar: 'مراجعة العملية' },
  reviewAlertAdded: { en: 'Transaction added', ar: 'تمت إضافة العملية' },
  reviewAlertAddFailed: {
    en: 'Could not add this alert. Check its currency, account and date.',
    ar: 'تعذّرت إضافة هذا التنبيه. تحقق من العملة والحساب والتاريخ.',
  },
  reviewAlertMatchesApplePay: {
    en: 'A matching Apple Pay purchase is already in your transactions. Choose Already recorded if this alert is the same purchase. If you made two separate purchases, you can add it as a separate purchase.',
    ar: 'توجد عملية Apple Pay مطابقة في معاملاتك بالفعل. اختر مسجلة بالفعل إذا كان هذا التنبيه للعملية نفسها. إذا أجريت عمليتين منفصلتين، يمكنك إضافته كعملية منفصلة.',
  },
  duplicateAddSeparate: { en: 'Add as a separate purchase', ar: 'إضافة كعملية منفصلة' },
  duplicateSeparateConfirmTitle: { en: 'Add a second transaction?', ar: 'إضافة معاملة ثانية؟' },
  duplicateSeparateConfirmBody: {
    en: 'This adds a second transaction for the same amount, next to the matching one already recorded. Only continue if these were two separate purchases.',
    ar: 'سيؤدي هذا إلى إضافة معاملة ثانية بالمبلغ نفسه، إلى جانب المعاملة المطابقة المسجلة بالفعل. تابع فقط إذا كانت هاتان عمليتين منفصلتين.',
  },
  duplicateSeparateConfirm: { en: 'Add second transaction', ar: 'إضافة المعاملة الثانية' },
  duplicateSeparateFailed: {
    en: 'The purchase could not be saved. Check your transactions before trying again.',
    ar: 'تعذر حفظ العملية. تحقق من معاملاتك قبل المحاولة مرة أخرى.',
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

  // Foreign-currency activity
  foreignActivity: { en: 'Foreign activity', ar: 'العمليات بالعملات الأجنبية' },
  foreignSpending: { en: 'Foreign spending', ar: 'الإنفاق بالعملات الأجنبية' },
  searchForeignSpending: { en: 'Search merchant or currency', ar: 'ابحث عن تاجر أو عملة' },
  foreignActivityCaption: {
    en: '{count} charge{s} · {currencies} currenc{ending}',
    ar: '{count} عملية · {currencies} عملة',
  },
  foreignConvertedTotal: {
    en: 'Spent in foreign currencies',
    ar: 'الإنفاق بالعملات الأجنبية',
  },
  currencyBreakdown: { en: 'Currencies', ar: 'العملات' },
  foreignSeeAllCurrencies: { en: 'See all {count}', ar: 'عرض كل العملات · {count}' },
  foreignShowFewerCurrencies: { en: 'Show fewer currencies', ar: 'عرض عملات أقل' },
  conversionQuality: { en: 'Conversion quality', ar: 'جودة التحويل' },
  bankQuoted: { en: 'Bank quoted', ar: 'حسب البنك' },
  referenceRate: { en: 'Reference rate', ar: 'سعر مرجعي' },
  offlineEstimate: { en: 'Offline estimate', ar: 'تقدير دون اتصال' },
  foreignRecent: { en: 'Transactions', ar: 'العمليات' },
  noForeignActivity: {
    en: 'No foreign-currency charges in this period.',
    ar: 'لا توجد عمليات بعملة أجنبية في هذه الفترة.',
  },

  // Bills
  billsTitle: { en: 'Bills', ar: 'الفواتير' },
  billsCheckingRecurring: { en: 'Checking recurring payments…', ar: 'جارٍ التحقق من الدفعات المتكررة…' },
  billsSubscriptionsTotal: { en: 'Subscriptions due', ar: 'الاشتراكات المستحقة' },
  billsUtilitiesTotal: { en: 'Utilities due', ar: 'المرافق المستحقة' },
  billsCardsTotal: { en: 'Card payments due', ar: 'دفعات البطاقات المستحقة' },
  billsAllTotal: { en: 'Open total', ar: 'إجمالي المستحق المفتوح' },
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
    en: 'Card or account not stated in the bank message',
    ar: 'لم تحدد الرسالة البنكية البطاقة أو الحساب',
  },
  paymentInstrumentMissingCount: {
    en: '{count} payment{s} did not state a card or account',
    ar: '{count} دفعة لم يحدد تنبيهها البطاقة أو الحساب',
  },
  history: { en: 'History', ar: 'السجل' },
  paymentHistory: { en: 'Payment history', ar: 'سجل الدفعات' },
  notASubscription: { en: 'Not a subscription', ar: 'ليس اشتراكاً' },
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
  cadenceBiweekly: { en: 'Every 2 weeks', ar: 'كل أسبوعين' },
  cadenceMonthly: { en: 'Monthly', ar: 'شهري' },
  cadenceQuarterly: { en: 'Quarterly', ar: 'ربع سنوي' },
  cadenceYearly: { en: 'Yearly', ar: 'سنوي' },
  cadenceAsNeeded: { en: 'As needed', ar: 'عند الحاجة' },
  stoppedLast: { en: 'stopped · last {date}', ar: 'متوقف · آخر خصم {date}' },
  stoppedLastCharged: { en: 'stopped · last charged {date}', ar: 'متوقف · آخر خصم {date}' },
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
  recurringPaidObserved: {
    en: 'Paid {date} · {cadence}',
    ar: 'دُفع في {date} · {cadence}',
  },
  recurringLastPaidObserved: {
    en: 'Last paid {date} · {cadence}',
    ar: 'آخر دفع في {date} · {cadence}',
  },
  remindAboutA11y: { en: 'Remind me about {title}', ar: 'ذكّرني بـ {title}' },
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
  cadencePeriodTwoWeeks: { en: '2 weeks', ar: 'أسبوعين' },
  cadencePeriodMonth: { en: 'month', ar: 'شهر' },
  cadencePeriodQuarter: { en: 'quarter', ar: 'ثلاثة أشهر' },
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
  unknownAccount: { en: 'Unknown account', ar: 'حساب غير معروف' },
  paid: { en: 'Paid', ar: 'مدفوع' },
  daysShort: { en: '{days}d', ar: '{days} يوم' },
  dueToday: { en: 'Due today', ar: 'مستحق اليوم' },
  dueInDays: { en: 'Due in {days}d', ar: 'مستحق خلال {days} يوم' },

  // Wallet
  walletTitle: { en: 'Accounts', ar: 'الحسابات' },
  availableBalances: { en: 'Recorded balances', ar: 'الأرصدة المسجلة' },
  // Regular spending that is not a bill (a grocer, toll top-ups). Some show a
  // usual next date, so the heading says what they are, not that they have no
  // schedule; they stay out of the bills total either way.
  refUnscheduled: { en: 'Other regular spending', ar: 'مصروفات متكررة أخرى' },
  refStopped: { en: 'Stopped recurring payments', ar: 'الدفعات المتكررة المتوقفة' },
  refHideStopped: { en: 'Hide stopped payments', ar: 'إخفاء الدفعات المتوقفة' },
  refShowStopped: { en: 'Show stopped payments', ar: 'عرض الدفعات المتوقفة' },
  showMoreRecurring: { en: 'Show {count} more', ar: 'عرض {count} أخرى' },
  balanceCoverage: {
    en: '{known} of {total} balances recorded',
    ar: 'أرصدة مسجلة: {known} من {total}',
  },
  addAccountForBalances: {
    en: 'Add an account to see its latest reported balance.',
    ar: 'أضف حساباً لعرض أحدث رصيد وارد من البنك.',
  },
  paidFromAccounts: { en: 'Paid from accounts this month', ar: 'المدفوع من الحسابات هذا الشهر' },
  netWorth: { en: 'Net worth', ar: 'صافي الثروة' },
  estimatedNetWorth: { en: 'Estimated net worth', ar: 'صافي الثروة التقديري' },
  cardsHeader: { en: 'Payment cards', ar: 'بطاقات الدفع' },
  /** Paged long lists (Categorise, Improve accuracy); {count} is the next page, not the total. */
  showMoreRows: { en: 'Show {count} more', ar: 'عرض {count} أخرى' },
  goalsHeader: { en: 'Savings goals', ar: 'أهداف الادخار' },
  newGoal: { en: '+ New goal', ar: '+ هدف جديد' },
  outstanding: { en: 'outstanding', ar: 'مستحق' },
  owed: { en: 'owed', ar: 'المستحق عليك' },
  // A credit card's open statement, less what was paid on it: not the card's whole balance.
  statementLeftToPay: { en: 'statement left to pay', ar: 'المتبقي من الكشف' },
  perBankSms: { en: 'per bank message', ar: 'حسب رسالة البنك' },
  noBalanceYet: { en: 'no balance message yet', ar: 'لا رسالة رصيد بعد' },
  trackedManually: { en: 'Tracked manually', ar: 'يُتابع يدويًا' },
  // The other branch added a second `reminderSet` here, reading "Reminder on",
  // for the chip on a Bills row. There is already a `reminderSet` further down
  // ("Reminder set") used by the two confirmation alerts, and a duplicate key
  // in an object literal is not an error at runtime — the later one silently
  // wins — so the chip would have read the alert's wording anyway while `tsc`
  // failed the build with TS1117. One key, one string: "Reminder set" is right
  // on a row that has one and right as the title of the alert that sets it.
  improveAccuracy: { en: 'Improve accuracy', ar: 'تحسين الدقة' },
  // The permanent way into /categorise. Home's prompt has a floor under it, so
  // without this row a user who sorts down to two merchants is locked out of
  // the screen mid-job and left fixing rows one at a time — the exact chore
  // the screen exists to replace.
  sortShops: { en: 'Improve categories', ar: 'تحسين التصنيفات' },
  sortShopsSettingsDetail: {
    en: 'Review unclear merchant and bank-payment categories',
    ar: 'راجع تصنيفات المتاجر ودفعات البنك غير الواضحة',
  },
  improveAccuracyHint: {
    en: 'Messages still needing attention. Open an entry to review it. For a named shop, sort it once on this phone and Wafra remembers your choice for past and future entries. Long account numbers are masked.',
    ar: 'رسائل ما زالت تحتاج إلى مراجعة. افتح العملية لمراجعتها. أما المتجر المعروف فصنّفه مرة واحدة على هذا الهاتف، وستتذكر وفرة اختيارك للعمليات السابقة والقادمة. الأرقام الطويلة مخفية.',
  },
  improveAccuracySettingsDetail: {
    en: 'Review bank-message formats Wafra could not read confidently',
    ar: 'راجع صيغ الرسائل البنكية التي لم يقرأها وفرة بثقة',
  },
  couldNotRead: { en: 'Could not read', ar: 'تعذّرت القراءة' },
  noCategoryYet: { en: 'Read, but no category', ar: 'مقروءة بلا تصنيف' },
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
    en: 'Accuracy report · processed Message text is not retained in the ledger; protected pending records expire after 30 days and are removed on the next queue access',
    ar: 'تقرير الدقة · لا يُحتفظ بنص الرسالة المعالَجة في السجل؛ وتنتهي صلاحية السجلات المعلّقة المحمية بعد ٣٠ يوماً وتُزال عند الوصول التالي إلى الصف',
  },
  formatsNotKeptRelay: {
    en: 'Rows delivered by the old Wafra Capture relay never included Message text, so they cannot appear in this list and an empty list does not audit them.',
    ar: 'لم تتضمن العمليات التي سلّمها مُرحّل Wafra Capture القديم نص الرسالة، لذلك لا يمكن أن تظهر في هذه القائمة ولا يعني خلوّها أن تلك العمليات خضعت للتدقيق.',
  },
  formatsNotKeptIosLocal: {
    en: 'Local capture parses new bank messages on this iPhone. Successfully processed raw text is deleted before the ledger or accuracy report retains it; protected pending records expire after 30 days and are removed on the next queue access. Rows from the old Wafra Capture relay never included Message text, so this list cannot audit those legacy rows.',
    ar: 'يعالج الالتقاط المحلي رسائل البنك الجديدة على هذا الآيفون. يُحذف النص الخام بعد نجاح المعالجة قبل أن يحتفظ به السجل أو تقرير الدقة؛ وتنتهي صلاحية السجلات المعلّقة المحمية بعد ٣٠ يوماً وتُزال عند الوصول التالي إلى الصف. لم تتضمن عمليات مُرحّل Wafra Capture القديم نص الرسالة، لذلك لا تستطيع هذه القائمة تدقيق تلك العمليات القديمة.',
  },
  formatsNotKeptPrivate: {
    en: 'Private Mode removes diagnostic Message text from the ledger and prevents new ledger entries from retaining it, so this list cannot identify misread formats. Local capture still works; protected pending records expire after 30 days and are removed on the next queue access.',
    ar: 'يحذف الوضع الخاص نص الرسالة التشخيصي من السجل ويمنع العمليات الجديدة من الاحتفاظ به، لذلك لا تستطيع هذه القائمة تحديد الصيغ التي أسيءت قراءتها. ويستمر الالتقاط المحلي؛ وتنتهي صلاحية السجلات المعلّقة المحمية بعد ٣٠ يوماً وتُزال عند الوصول التالي إلى الصف.',
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
  categoriseMerchants: { en: 'Improve categories', ar: 'تحسين التصنيفات' },
  categoriseEntries: {
    en: '{count} entr{ending} · last {date}',
    ar: '{count} عملية · آخرها {date}',
  },
  categorisePaymentPurpose: {
    en: 'BANK PAYMENT · PURPOSE UNKNOWN',
    ar: 'دفعة بنكية · الغرض غير معروف',
  },
  categorisePaymentPurposeHint: {
    en: 'This is the name saved in your bank, not necessarily the real biller. Choose what the payment was for. Wafra remembers only this bill reference — not every transaction with this name.',
    ar: 'هذا هو الاسم المحفوظ في البنك وليس بالضرورة اسم المفوتر الحقيقي. اختر غرض الدفعة. سيتذكر وفرة مرجع هذه الفاتورة فقط، وليس كل عملية تحمل الاسم نفسه.',
  },
  categorisePurposeA11y: {
    en: 'Choose what the bank payment {merchant} was for',
    ar: 'اختر غرض الدفعة البنكية {merchant}',
  },
  categoriseShowAll: {
    en: 'Review all {count}',
    ar: 'عرض كل الحالات: {count}',
  },
  categoriseShowPriority: { en: 'Show priority items only', ar: 'عرض الحالات الأهم فقط' },
  categoriseChooseA11y: {
    en: 'Choose a category for {merchant}',
    ar: 'اختر تصنيفاً لـ {merchant}',
  },
  categoriseAiSuggestion: {
    en: 'On-device AI suggests: {category}',
    ar: 'يقترح الذكاء الاصطناعي على جهازك: {category}',
  },
  categoriseRuleSuggestion: {
    en: 'Suggested from the merchant name: {category}',
    ar: 'مقترح من اسم التاجر: {category}',
  },
  categoriseSuggestionChecking: { en: 'Checking the name on your device…', ar: 'جارٍ فحص الاسم على جهازك…' },
  categoriseDone: { en: 'Nothing needs your input', ar: 'لا توجد حالات تحتاج إدخالك' },
  categoriseDoneBody: {
    en: 'Confident matches are handled automatically. New unclear merchants or bank-payment nicknames will appear here only when Wafra cannot classify them safely.',
    ar: 'يتعامل وفرة تلقائياً مع الحالات الواضحة. لن تظهر هنا إلا المتاجر أو أسماء دفعات البنك التي لا يمكن تصنيفها بأمان.',
  },
  categoriseDoneCount: {
    en: 'You sorted {count} entr{ending} just now.',
    ar: 'صنّفت {count} عملية للتو.',
  },
  // The Home prompt. Same floor and the same reasoning as the unread-formats
  // row above it: below three merchants this says nothing at all.
  uncategorisedMerchantCount: {
    en: '{count} item{s} need your input',
    ar: '{count} حالات تحتاج إدخالك',
  },
  uncategorisedMerchantHint: {
    en: 'One tap files every entry from that shop, past and future.',
    ar: 'ضغطة واحدة تصنّف كل عمليات المتجر، السابقة والقادمة.',
  },
  categoriseMerchantsA11y: {
    en: 'Review {count} unclear categories',
    ar: 'راجع {count} تصنيفات غير واضحة',
  },
  cardDetail: { en: 'Card detail', ar: 'تفاصيل البطاقة' },
  credit: { en: 'Credit', ar: 'ائتمانية' },
  debit: { en: 'Debit', ar: 'خصم' },
  statements: { en: 'Statements', ar: 'كشوف الحساب' },
  dueDate: { en: 'Due {date}', ar: 'مستحق {date}' },
  settled: { en: 'Settled', ar: 'مسدّد' },
  percentPaid: { en: '{percent}% paid', ar: 'دُفع {percent}٪' },
  paymentsMade: { en: 'Payments made', ar: 'الدفعات المسددة' },
  reminderSet: { en: 'Reminder set', ar: 'تم ضبط التذكير' },
  reminderFailed: { en: 'Reminder not set', ar: 'لم يُضبط التذكير' },
  reminderFailedBody: {
    en: 'Your phone didn’t accept the reminder. Try again in a moment.',
    ar: 'لم يقبل هاتفك التذكير. حاول مرة أخرى بعد قليل.',
  },
  cardReminderBody: { en: 'You will be reminded three days before {date}, and again on the day.', ar: 'سنذكّرك قبل {date} بثلاثة أيام، ومرة أخرى في يوم الاستحقاق.' },
  fileCardPaymentBody: { en: 'Files a {amount} payment to {name} today.', ar: 'يسجّل دفعة بقيمة {amount} إلى {name} اليوم.' },
  paidOfTotal: { en: 'Paid {paid} of {total}', ar: 'دُفع {paid} من {total}' },
  minimumShort: { en: 'Min {amount}', ar: 'الحد الأدنى {amount}' },
  minimumDueLabel: { en: 'Minimum due', ar: 'الحد الأدنى' },
  statementMinimumUnconfirmed: { en: 'Minimum not confirmed in this alert', ar: 'الحد الأدنى غير مؤكد في هذا التنبيه' },
  card: { en: 'Card', ar: 'البطاقة' },
  matched: { en: 'Matched', ar: 'المطابقة' },
  chargesAcross: { en: '{amount} across {count} charge{s}', ar: '{amount} عبر {count} عملية' },
  matchedPayments: { en: '{count} payment{s} matched oldest-first to this card’s statements.', ar: 'طابقت {count} دفعة كشوف هذه البطاقة من الأقدم إلى الأحدث.' },

  // Settings
  settingsTitle: { en: 'Settings', ar: 'الإعدادات' },
  trustedTitle: { en: 'Trusted devices', ar: 'الأجهزة الموثوقة' },
  trustedSettingsRow: { en: 'Trusted devices & family', ar: 'الأجهزة الموثوقة والعائلة' },
  trustedAndroidTruth: {
    en: 'Bank SMS still parse only on this Android and are not uploaded. Trusted devices receive only future items delivered through the relay.',
    ar: 'تبقى رسائل البنك على هذا الأندرويد وتُحلَّل محلياً ولا تُرفع. تستقبل الأجهزة الموثوقة فقط العناصر المستقبلية المرسلة عبر المرحّل.',
  },
  trustedIosTruth: {
    en: 'Local iPhone Message captures stay on this iPhone. Only separately relay-delivered supplemental imports can reach trusted devices, and joining never backfills older transactions.',
    ar: 'تبقى التقاطات الرسائل المحلية على هذا الآيفون. لا تصل إلى الأجهزة الموثوقة إلا الواردات الإضافية المرسلة بشكل منفصل عبر المرحّل، ولا يسترجع الانضمام العمليات السابقة.',
  },
  trustedPreview: { en: 'SAMPLE HOUSEHOLD', ar: 'عائلة تجريبية' },
  // Relay-only: trusted phones receive new relayed items after they join;
  // nothing already in a ledger is copied, so there is no "one shared ledger".
  trustedPreviewBody: {
    en: 'See how a family’s trusted phones receive new relayed items. Older transactions are not copied. Invitations are disabled in this demo.',
    ar: 'شاهد كيف تستقبل هواتف العائلة الموثوقة العناصر الجديدة المرسلة عبر المرحّل. لا تُنسخ العمليات السابقة. الدعوات معطلة في هذا العرض التجريبي.',
  },
  trustedPreviewA11y: { en: 'Sample device, controls disabled', ar: 'جهاز تجريبي، عناصر التحكم معطلة' },
  trustedStartBody: {
    en: 'Create the first owner device, or paste a one-use invite from someone you trust. No bank or ledger data is stored in an invite.',
    ar: 'أنشئ جهاز المالك الأول، أو الصق دعوة للاستخدام مرة واحدة من شخص تثق به. لا تحتوي الدعوة على بيانات بنكية أو بيانات السجل.',
  },
  trustedPrivateModeBody: {
    en: 'Your saved local-only preference pauses online services. Review it in Settings → Privacy and data before connecting trusted devices.',
    ar: 'يوقف تفضيل المعالجة المحلية المحفوظ الخدمات المتصلة. راجعه في الإعدادات ← الخصوصية والبيانات قبل ربط الأجهزة الموثوقة.',
  },
  trustedConnecting: { en: 'Connecting…', ar: 'جارٍ الاتصال…' },
  trustedCreateVault: { en: 'Create trusted vault', ar: 'أنشئ خزنة موثوقة' },
  trustedJoinVault: { en: 'Join with an invite', ar: 'انضم بدعوة' },
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
  trustedInviteAction: { en: 'Create 10-minute invite', ar: 'أنشئ دعوة لمدة ١٠ دقائق' },
  trustedInviteCountdown: { en: 'Expires in {minutes}:{seconds}', ar: 'تنتهي خلال {minutes}:{seconds}' },
  trustedInviteExpired: { en: 'This invite has expired', ar: 'انتهت صلاحية هذه الدعوة' },
  // Relay-only: a phone that joins receives items relayed AFTER it joins.
  // Nothing already in the ledger is copied to it.
  trustedRelayOnly: {
    en: 'The phone that joins receives only new items relayed after it joins. Older transactions are not copied.',
    ar: 'يستقبل الهاتف المنضم فقط العناصر الجديدة المرسلة عبر المرحّل بعد انضمامه. لا تُنسخ العمليات السابقة.',
  },
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
  appearanceHeader: { en: 'Appearance', ar: 'المظهر' },
  themeSystem: { en: 'System', ar: 'النظام' },
  themeSystemDetail: { en: 'System · follows phone', ar: 'النظام · يتبع الهاتف' },
  themeLight: { en: 'Light', ar: 'فاتح' },
  themeDark: { en: 'Dark', ar: 'داكن' },
  privacyHeader: { en: 'Privacy', ar: 'الخصوصية' },
  appLockTitle: { en: 'App lock', ar: 'قفل التطبيق' },
  appLockDetail: {
    en: 'Fingerprint, face unlock, or your phone PIN',
    ar: 'البصمة أو التعرّف على الوجه أو رمز الهاتف',
  },
  readBankSms: { en: 'Read bank SMS', ar: 'قراءة رسائل البنك' },
  smsOffNoImport: {
    en: 'Off · nothing can import',
    ar: 'متوقف · لن تُستورد أي عملية',
  },
  turnSmsReadingOff: { en: 'Turn SMS reading off', ar: 'إيقاف قراءة الرسائل' },
  instantAlertsOn: {
    en: 'On · visible alert with sound and vibration',
    ar: 'مفعّل · تنبيه مرئي مع صوت واهتزاز',
  },
  instantAlertsOff: {
    en: 'Off · charges appear when Wafra next opens',
    ar: 'متوقف · تظهر العمليات عند فتح وفرة لاحقاً',
  },
  instantAlertsNeedBankSource: {
    en: 'Turn on bank SMS or bank app notifications first',
    ar: 'فعّل رسائل البنك أو إشعارات تطبيق البنك أولاً',
  },
  turnOnBankCaptureFirst: {
    en: 'Turn on bank capture first',
    ar: 'فعّل التقاط رسائل البنك أولاً',
  },
  turnOnBankCaptureFirstBody: {
    en: 'Enable bank SMS reading or bank app notifications, then turn on per-transaction alerts.',
    ar: 'فعّل قراءة رسائل البنك أو إشعارات تطبيق البنك، ثم فعّل تنبيهات كل عملية.',
  },
  instantAlertsSmsPermissionTitle: {
    en: 'Incoming SMS access was not allowed',
    ar: 'لم يُسمح بالوصول إلى الرسائل الواردة',
  },
  instantAlertsSmsPermissionBody: {
    en: 'Instant banners need Android’s incoming SMS permission. Bank-alert history import still works with the separate SMS-reading permission.',
    ar: 'تحتاج التنبيهات الفورية إذن أندرويد للرسائل الواردة. ويظل استيراد سجل رسائل البنك يعمل بإذن قراءة الرسائل المنفصل.',
  },
  instantAlertsLivePermissionPrompt: {
    en: 'Live purchase alerts need incoming SMS access and Wafra notification permission. Enable them so Wafra can alert you as soon as a bank SMS arrives.',
    ar: 'تحتاج تنبيهات المشتريات الفورية إلى إذن الرسائل الواردة وإذن إشعارات وفرة. فعّلهما ليصلك تنبيه وفرة فور وصول رسالة البنك.',
  },
  bankPushOn: {
    en: 'On · new bank notifications are added automatically',
    ar: 'مفعّل · تُضاف إشعارات البنك الجديدة تلقائياً',
  },
  parserPack: { en: 'Bank-message region', ar: 'منطقة رسائل البنك' },
  /**
   * Why a differently-denominated pack is greyed out.
   *
   * The honest sentence, because the dishonest one was the bug: switching
   * packs used to relabel every stored figure — the same 125,050 fils
   * printing "AED 1,250.50" and then "SAR 1,250.50" — with nothing converted
   * and no rate that could have converted it. So the pack is refused, and the
   * row says which currency the money is already in and what the way out is.
   */
  settingsViewOnboarding: { en: 'View onboarding', ar: 'عرض تجربة البداية' },
  settingsViewOnboardingDetail: {
    en: 'Replay the welcome flow without changing your data or settings',
    ar: 'أعد مشاهدة تجربة البداية دون تغيير بياناتك أو إعداداتك',
  },
  wafraPro: { en: 'Wafra Pro', ar: 'وفرة برو' },
  proActive: { en: 'Active', ar: 'مفعّل' },
  appLock: { en: 'App lock (biometric)', ar: 'قفل التطبيق (بصمة)' },
  privacyBuiltInDetail: {
    en: 'Protected on your phone. Sharing is your choice.',
    ar: 'بياناتك محمية على هاتفك، ومشاركتها باختيارك.',
  },
  privacyBuiltInBody: {
    en: 'Privacy is built into Wafra. Your ledger is encrypted on iPhone and Android. Local bank-message capture works without uploading your messages. App lock adds protection when someone else is using your unlocked phone.',
    ar: 'الخصوصية جزء أساسي من وفرة. سجلك مشفّر على آيفون وأندرويد، ويعمل الالتقاط المحلي لرسائل البنك دون رفع رسائلك. ويضيف قفل التطبيق حماية عندما يستخدم شخص آخر هاتفك المفتوح.',
  },
  onlineLogosTitle: { en: 'Online merchant logos', ar: 'شعارات التجار عبر الإنترنت' },
  onlineLogosDetail: { en: 'Off by default. When on, merchant and bank names are sent to Brandfetch, a logo service. It also sees your network address.', ar: 'متوقفة افتراضياً. عند تفعيلها تُرسل أسماء التجار والبنوك إلى خدمة الشعارات Brandfetch، التي ترى أيضاً عنوان اتصالك بالشبكة.' },
  onlineLogosPaused: { en: 'Paused by your local-only preference.', ar: 'متوقفة بسبب تفضيل المعالجة المحلية.' },
  hideLockedWidgetAmountsTitle: { en: 'Hide widget amounts with App Lock', ar: 'إخفاء مبالغ الودجات مع قفل التطبيق' },
  hideLockedWidgetAmountsDetail: { en: 'While App Lock is on, amounts stay hidden on Home Screen widgets, even after you unlock Wafra. Names and dates remain visible.', ar: 'عند تشغيل قفل التطبيق تبقى المبالغ مخفية في ودجات الشاشة الرئيسية حتى بعد فتح وفرة. تبقى الأسماء والتواريخ ظاهرة.' },
  privacyLogosBody: {
    en: 'Online logos are off by default. On iPhone you can turn them on in Settings to share names with Brandfetch; Android does not use online logos in this version. Bundled logos appear locally. Many merchant and bank identities ship with the app. For other merchants or banks, Wafra may send only a cleaned brand or institution name — not the amount, account/card number or bank message — to Brandfetch to find a confident match, then load its logo. Brandfetch can see that name lookup, the requested brand domain and your network address.',
    ar: 'الشعارات المتصلة متوقفة افتراضياً. على آيفون يمكنك تفعيلها في الإعدادات لمشاركة الأسماء مع Brandfetch، ولا يستخدمها أندرويد في هذا الإصدار. تظهر الشعارات المضمنة محلياً، ويأتي كثير من هويات التجّار والبنوك مع التطبيق. وللتجّار أو البنوك الأخرى قد ترسل وفرة اسم العلامة أو المؤسسة المنظّف فقط — دون المبلغ أو رقم الحساب أو البطاقة أو نص رسالة البنك — إلى Brandfetch للعثور على تطابق موثوق ثم تحميل شعاره. ويمكن لـ Brandfetch رؤية بحث الاسم ونطاق العلامة المطلوب وعنوان اتصالك بالشبكة.',
  },
  privacyLegacyTitle: { en: 'Your earlier local-only choice is saved', ar: 'اختيارك السابق للمعالجة المحلية محفوظ' },
  privacyLegacyBody: {
    en: 'Your earlier choice still pauses cloud imports, reference exchange rates and online logos, and prevents new diagnostic message text from being kept. Local capture still works. Wafra has not changed that choice.',
    ar: 'يبقى اختيارك السابق بإيقاف الاستيراد السحابي وأسعار الصرف المرجعية والشعارات المتصلة ومنع الاحتفاظ بنصوص رسائل تشخيصية جديدة محفوظاً. ويستمر الالتقاط المحلي. لم تغيّر وفرة هذا الاختيار.',
  },
  privacyLegacyReview: { en: 'Review online features', ar: 'مراجعة الميزات المتصلة' },
  privacyResumeTitle: { en: 'Resume optional online features?', ar: 'استئناف الميزات المتصلة الاختيارية؟' },
  privacyResumeBody: {
    en: 'This restores reference exchange-rate requests and online logos only if you separately enabled them, allows you to set up cloud imports, and lets unclear message text stay on this phone for correction. A previously connected relay can resume syncing. Creating a connection or uploading a statement still needs its own action. Previously removed message text cannot be recovered.',
    ar: 'يستأنف هذا طلبات أسعار الصرف المرجعية والشعارات المتصلة فقط إذا فعّلتها بشكل منفصل، ويتيح إعداد الاستيراد السحابي والاحتفاظ بنص الرسائل غير الواضحة على هذا الهاتف لتصحيحها. وقد تستأنف خدمة مربوطة سابقاً المزامنة. ويتطلب إنشاء اتصال أو رفع كشف إجراءً منفصلاً. ولا يمكن استعادة نصوص الرسائل المحذوفة سابقاً.',
  },
  privacyResumeAction: { en: 'Resume online features', ar: 'استئناف الميزات المتصلة' },
  privacyPreferenceFailed: { en: 'Wafra could not save this preference. Try again.', ar: 'تعذّر على وفرة حفظ هذا التفضيل. حاول مرة أخرى.' },
  privateMode: { en: 'Saved local-only preference', ar: 'تفضيل المعالجة المحلية المحفوظ' },
  capturePreferenceFailed: {
    en: 'Capture setting didn’t save. Try again.',
    ar: 'لم يُحفظ إعداد الالتقاط. حاول مجدداً.',
  },
  privacyRetentionExact: {
    en: 'The capture status and warning on this screen keep only source-free counts; they do not keep Message text or sender. Pending Message records wait in the protected local capture queue—a short-lived encrypted queue. They expire after 30 days and are removed the next time capture runs or Wafra checks the queue. Local capture works with your saved preferences.',
    ar: 'لا تحتفظ حالة الالتقاط والتنبيه في هذه الشاشة إلا بأعداد خالية من بيانات المصدر، ولا تحفظان نص الرسالة أو اسم المرسل. تبقى سجلات الرسائل المعلّقة في صف الالتقاط المحلي المحمي، وهو صف مشفّر قصير الأجل. وتنتهي صلاحيتها بعد ٣٠ يوماً وتُزال عند تشغيل الالتقاط أو فحص وفرة للصف في المرة التالية. ويستمر الالتقاط المحلي وفق تفضيلاتك المحفوظة.',
  },
  privacySecurityExact: {
    en: 'Automatic capture is optional. Android SMS alerts are processed on this phone, and local iPhone capture never uploads SMS content. However, an old Wafra Shortcut automation can continue uploading the bank messages you selected until you remove it or Wafra confirms retirement. On iPhone, Wafra cannot directly access the Messages inbox. Wafra cannot sign in to a bank, reply, approve a payment or move money. For separately connected email, PDF or CSV imports, the encrypted relay parses them, discards raw text immediately, and returns only structured rows.',
    ar: 'الالتقاط التلقائي اختياري. تُعالج تنبيهات رسائل أندرويد على هذا الهاتف، ولا يرفع الالتقاط المحلي على الآيفون محتوى الرسائل. لكن أتمتة الاختصار القديمة «Wafra Capture» قد تستمر في رفع رسائل البنوك التي اخترتها إلى أن تحذفها أو تؤكد وفرة اكتمال إيقافها. على الآيفون، لا تستطيع وفرة الوصول مباشرةً إلى صندوق الرسائل. ولا تستطيع وفرة تسجيل الدخول إلى بنك أو الرد أو الموافقة على دفعة أو نقل الأموال. أما واردات البريد أو PDF أو CSV المربوطة منفصلةً، فيحللها المرحّل المشفّر ويحذف النص فوراً ويعيد عمليات منظّمة فقط.',
  },
  country: { en: 'Country', ar: 'الدولة' },
  language: { en: 'Language', ar: 'اللغة' },
  backupJson: { en: 'Back up everything (JSON)', ar: 'نسخ احتياطي كامل (JSON)' },
  restoreBackup: { en: 'Restore from backup', ar: 'استعادة من نسخة احتياطية' },
  exportCsv: { en: 'Export transactions (CSV)', ar: 'تصدير العمليات (CSV)' },
  statementImportTitle: { en: 'Add bank statements', ar: 'أضف كشوف البنك' },
  statementImportSettingsDetail: {
    en: 'Add history from one or several PDF, CSV, or TSV statements',
    ar: 'أضف السجل من كشف واحد أو عدة كشوف PDF أو CSV أو TSV',
  },
  settingsAlertDeliveryHeader: { en: 'Bank messages', ar: 'رسائل البنك' },
  settingsAlertDeliveryTitle: { en: 'How your bank reaches you', ar: 'كيف يصلك بنكك' },
  settingsAlertDeliveryUnset: { en: 'Not set — this decides how far back Wafra can go', ar: 'غير محدد — هذا يحدد إلى أي مدى يستطيع وفرة الرجوع' },
  statementImportNoCaptureDetail: {
    en: 'Your bank sends nothing Wafra can read, so a statement is how this spending gets in',
    ar: 'بنكك لا يرسل شيئاً يمكن لوفرة قراءته، لذا فإن كشف الحساب هو طريقة إدخال هذه العمليات',
  },
  statementImportGapDetail: {
    en: 'Your bank leaves no history to read, so a statement is how earlier months get in',
    ar: 'بنكك لا يترك سجلاً يمكن قراءته، لذا فإن كشف الحساب هو طريقة إدخال الأشهر السابقة',
  },
  launchMetricsInternal: { en: 'Launch metrics (internal)', ar: 'مقاييس التشغيل (داخلية)' },
  launchMetricsDetail: {
    en: 'Fixed timings only · no ledger data',
    ar: 'أزمنة ثابتة فقط · بلا بيانات مالية',
  },
  launchMetricsDialog: { en: 'Export launch metrics', ar: 'تصدير مقاييس التشغيل' },
  launchMetricsExportFailed: {
    en: 'Launch metrics export failed',
    ar: 'تعذّر تصدير مقاييس التشغيل',
  },
  personalReviewExportTitle: {
    en: 'Export my data for review',
    ar: 'تصدير بياناتي للمراجعة',
  },
  personalReviewExportDetail: {
    en: 'Personal test build · full received SMS and Wafra backup in one file. Save it, then attach it to Codex yourself.',
    ar: 'نسخة اختبار شخصية · الرسائل المستلمة كاملة ونسخة وفرة الاحتياطية في ملف واحد. احفظه ثم أرفقه بنفسك في Codex.',
  },
  personalReviewExportConfirmTitle: {
    en: 'Export your messages and Wafra data?',
    ar: 'تصدير رسائلك وبيانات وفرة؟',
  },
  personalReviewExportConfirmBody: {
    en: 'This unencrypted JSON file contains every received SMS with its full sender, date and text, including personal messages and verification codes. It also includes your Wafra backup: transactions, account details, balances, saved categories and preferences. Nothing is redacted. Wafra does not upload it; you choose where to save or share it. Sent messages, deleted messages and other apps are not included.',
    ar: 'يحتوي ملف JSON غير المشفّر على كل رسالة مستلمة مع المرسل والتاريخ والنص الكامل، بما فيها الرسائل الشخصية ورموز التحقق. ويشمل أيضاً نسخة وفرة الاحتياطية: العمليات وتفاصيل الحسابات والأرصدة والتصنيفات المحفوظة والتفضيلات. لا تُحجب أي بيانات. لا يرفعه وفرة؛ أنت تختار أين تحفظه أو تشاركه. لا يشمل الرسائل المرسلة أو المحذوفة أو التطبيقات الأخرى.',
  },
  personalReviewExportConfirm: { en: 'Prepare my file', ar: 'تجهيز ملفي' },
  personalReviewExportPrivateMode: {
    en: 'Your saved preference excludes original message text. Review it in Settings → Privacy and data.',
    ar: 'يستبعد تفضيلك المحفوظ نص الرسائل الأصلية. راجعه في الإعدادات ← الخصوصية والبيانات.',
  },
  personalReviewExportFailed: { en: 'Could not export your data', ar: 'تعذّر تصدير بياناتك' },
  smsCorpusExportProgress: {
    en: 'Preparing {count} messages…',
    ar: 'جارٍ تجهيز {count} رسالة…',
  },
  smsCorpusPermissionTitle: {
    en: 'SMS permission is needed',
    ar: 'يلزم إذن الرسائل',
  },
  smsCorpusPermissionBody: {
    en: 'Allow SMS access, then try the temporary export again.',
    ar: 'اسمح بالوصول إلى الرسائل ثم أعد محاولة التصدير المؤقت.',
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
  bankNotificationSource: { en: 'Bank notification', ar: 'إشعار بنكي' },
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

  // Paywall
  proActiveThanks: { en: 'Active on this device. Thank you for supporting Wafra.', ar: 'مفعّل على هذا الجهاز. شكراً لدعمك وفرة.' },
  proOutcomeTitle: {
    en: 'Keep your ledger up to date, automatically.',
    ar: 'حافظ على تحديث سجلك تلقائياً.',
  },
  proBenefitsTitle: { en: 'Included with Pro', ar: 'مشمول مع برو' },
  proChoosePlan: { en: 'Choose your plan', ar: 'اختر خطتك' },
  proSavePercent: { en: 'Save {percent}%', ar: 'وفّر {percent}٪' },
  proChargeTimingYear: {
    en: 'Charged {price} when you confirm. Renews yearly until cancelled.',
    ar: 'يُخصم {price} عند التأكيد، ثم يتجدد سنوياً حتى الإلغاء.',
  },
  proChargeTimingWeek: {
    en: 'Charged {price} when you confirm. Renews weekly until cancelled.',
    ar: 'يُخصم {price} عند التأكيد، ثم يتجدد أسبوعياً حتى الإلغاء.',
  },
  proMostPopular: { en: 'Most popular', ar: 'الأكثر اختياراً' },
  proYearlyPerWeek: { en: 'Just {price} a week', ar: 'فقط {price} أسبوعياً' },
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
  getPro: { en: 'Get Wafra Pro', ar: 'اشترك في وفرة برو' },
  startPlanWithPrice: {
    en: 'Start {plan} — {price}',
    ar: 'ابدأ الاشتراك {plan} — {price}',
  },
  purchaseInProgress: { en: 'Opening the store…', ar: 'جارٍ فتح المتجر…' },
  restorePurchase: { en: 'Restore purchase', ar: 'استعادة الشراء' },
  yearly: { en: 'YEARLY', ar: 'سنوي' },
  weekly: { en: 'WEEKLY', ar: 'أسبوعي' },
  perWeek: { en: 'per week', ar: 'أسبوعياً' },
  transferLabel: { en: 'Transfer', ar: 'تحويل' },
  // ── strings screens used to write in English inline ──
  noScreenLock: { en: 'No screen lock set up', ar: 'لا يوجد قفل شاشة' },
  noScreenLockBody: { en: 'Set up a fingerprint, face unlock, or PIN in your phone settings first.', ar: 'أعدّ بصمة أو تعرّفاً على الوجه أو رمز PIN في إعدادات هاتفك أولاً.' },
  confirmAppLock: { en: 'Confirm to enable app lock', ar: 'أكّد لتفعيل قفل التطبيق' },
  smsRevokeHint: { en: 'Android only revokes this in its own settings: Settings → Apps → Wafra → Permissions → SMS.', ar: 'يُلغى هذا الإذن من إعدادات أندرويد فقط: الإعدادات ← التطبيقات ← وفرة ← الأذونات ← الرسائل.' },
  notificationsOff: { en: 'Notifications are off', ar: 'الإشعارات مغلقة' },
  notificationsOffBody: { en: 'Wafra needs notification permission to alert you. Turn it on in Settings → Apps → Wafra → Notifications.', ar: 'يحتاج وفرة إذن الإشعارات لتنبيهك. فعّله من الإعدادات ← التطبيقات ← وفرة ← الإشعارات.' },
  bankAppNotifsTitle: { en: 'Bank app notifications', ar: 'إشعارات تطبيقات البنوك' },
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
    en: 'All accounts, entries, bills, goals, and this iPhone’s relay queue will be permanently deleted. If you previously installed the old Wafra Capture automation, Wafra cannot delete it — Apple gives no app that power — so you will get a link to check Shortcuts straight afterwards.',
    ar: 'ستُحذف جميع الحسابات والعمليات والفواتير والأهداف وصف انتظار الترحيل لهذا الآيفون نهائياً. إذا سبق أن ثبّتَّ أتمتة Wafra Capture القديمة فلا تستطيع وفرة حذفها — لا تمنح آبل أي تطبيق هذه الصلاحية — لذلك ستحصل بعد ذلك مباشرةً على رابط للتحقق من تطبيق الاختصارات.',
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
  eraseCaptureDisableFailedBody: {
    en: 'Wafra could not stop new local alerts before erasing. Nothing was erased. Restart Wafra and try again.',
    ar: 'تعذّر على وفرة إيقاف التنبيهات المحلية الجديدة قبل المسح. لم يُمسح شيء. أعد تشغيل وفرة وحاول مرة أخرى.',
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
    en: 'Check for an old Shortcut',
    ar: 'تحقق من وجود اختصار قديم',
  },
  shortcutCleanupErased: {
    en: 'Everything on this phone is gone and the relay rejects this iPhone’s token from now on. If you previously installed the old “Wafra Capture” automation, it can remain in Shortcuts and keep sending selected bank messages over the network, where they are now refused. Check Shortcuts → Automation and My Shortcuts, and delete the old Wafra items if present.',
    ar: 'حُذف كل شيء على هذا الهاتف وأصبح المرحّل يرفض رمز هذا الآيفون من الآن. إذا سبق أن ثبّتَّ أتمتة «Wafra Capture» القديمة فقد تبقى في تطبيق الاختصارات وتواصل إرسال رسائل البنوك المحددة عبر الشبكة، حيث تُرفض الآن. تحقق من «الاختصارات» ← «الأتمتة» ومن «اختصاراتي»، واحذف عناصر Wafra القديمة إن وُجدت.',
  },
  shortcutCleanupLeft: {
    en: 'This iPhone’s relay token is revoked, so nothing it sends can be filed again. If you previously installed the old “Wafra Capture” automation, it can remain in Shortcuts and keep forwarding selected bank messages over the network, where they are now refused. Check Shortcuts → Automation and My Shortcuts, and delete the old Wafra items if present.',
    ar: 'أُلغي رمز ترحيل هذا الآيفون، فلن يُسجَّل أي شيء يرسله بعد الآن. إذا سبق أن ثبّتَّ أتمتة «Wafra Capture» القديمة فقد تبقى في تطبيق الاختصارات وتواصل تمرير رسائل البنوك المحددة عبر الشبكة، حيث تُرفض الآن. تحقق من «الاختصارات» ← «الأتمتة» ومن «اختصاراتي»، واحذف عناصر Wafra القديمة إن وُجدت.',
  },
  shortcutCleanupUncertain: {
    en: 'Wafra could not confirm that this iPhone’s relay token was revoked. Automatic capture is off in Wafra. If you previously installed the old “Wafra Capture” automation, it may still forward selected bank messages over the network. Delete the old Wafra items if present in Shortcuts → Automation or My Shortcuts, then retry disconnection when you are online.',
    ar: 'تعذّر على وفرة تأكيد إلغاء رمز ترحيل هذا الآيفون. الالتقاط التلقائي متوقف داخل وفرة. إذا سبق أن ثبّتَّ أتمتة «Wafra Capture» القديمة فقد تستمر في تمرير رسائل البنوك المحددة عبر الشبكة. احذف عناصر Wafra القديمة إن وُجدت من «الاختصارات» ← «الأتمتة» أو «اختصاراتي»، ثم أعد محاولة الفصل عند توفر الإنترنت.',
  },
  /**
   * Removing SOMEBODY ELSE'S iPhone. Their Shortcut is on their phone, which
   * this app cannot reach at all — so this is guidance to pass on, not a
   * button anyone here can press.
   */
  trustedRemoveShortcutNote: {
    en: 'If that device is an iPhone and its owner previously installed the old Wafra Capture automation, it can remain there and keep sending selected bank messages to the relay — refused from now on, but still leaving that phone. Ask its owner to check the Shortcuts app and delete the old Wafra items if present.',
    ar: 'إذا كان ذلك الجهاز آيفون وسبق لمالكه تثبيت أتمتة Wafra Capture القديمة، فقد تبقى هناك وتواصل إرسال رسائل البنوك المحددة إلى المرحّل — وهي مرفوضة من الآن، لكنها تغادر ذلك الهاتف فعلاً. اطلب من مالكه التحقق من تطبيق الاختصارات وحذف عناصر Wafra القديمة إن وُجدت.',
  },
  activeOnThisDevice: { en: 'Active on this device', ar: 'مفعّل على هذا الجهاز' },
  founderProActive: { en: 'Founder access · active on this device', ar: 'وصول المؤسس · مفعّل على هذا الجهاز' },
  founderProUnlockedTitle: { en: 'Founder Pro unlocked', ar: 'تم فتح وفرة برو للمؤسس' },
  founderProUnlockedBody: {
    en: 'Pro stays active on this test device, including after you erase the ledger.',
    ar: 'يبقى برو مفعّلاً على جهاز الاختبار هذا، حتى بعد مسح السجل.',
  },
  founderProFailedTitle: { en: 'Could not unlock Founder Pro', ar: 'تعذّر فتح وفرة برو للمؤسس' },
  founderProFailedBody: {
    en: 'The encrypted local grant could not be saved. Keep Wafra open and try five taps again.',
    ar: 'تعذّر حفظ المنحة المحلية المشفّرة. أبقِ وفرة مفتوحاً وحاول خمس ضغطات مجدداً.',
  },
  wafraLogo: { en: 'Wafra logo', ar: 'شعار وفرة' },
  alertEveryCharge: { en: 'Alert me on every charge', ar: 'نبّهني عند كل عملية' },
  unhide: { en: 'Unhide', ar: 'إظهار' },
  hideFromLists: { en: 'Hide from lists', ar: 'إخفاء من القوائم' },
  hidden: { en: 'Hidden', ar: 'مخفي' },
  noActivity90: { en: 'No activity for 90+ days', ar: 'لا نشاط منذ أكثر من 90 يوماً' },
  pasteBankMessage: { en: 'Paste a bank message', ar: 'ألصق رسالة بنكية' },
  inboxNotRead: { en: 'Inbox not read yet', ar: 'لم تُقرأ الرسائل بعد' },
  deleteCardAndEntries: { en: 'Delete card and its entries', ar: 'حذف البطاقة وعملياتها' },
  notASubscriptionQ: { en: 'Not a subscription?', ar: 'ليس اشتراكاً؟' },
  stillLoading: { en: 'Still loading your data — try again in a second.', ar: 'ما زال تحميل بياناتك جارياً — أعد المحاولة بعد لحظة.' },
  upToDateNoNew: { en: 'Up to date. No new bank messages.', ar: 'كل شيء محدّث. لا رسائل بنكية جديدة.' },
  pasteHint: {
    en: `Paste one or more bank messages below, separated by a blank line. ${IMPORT_PROCESSING_DISCLOSURE.en}`,
    ar: `ألصق رسالة بنكية أو أكثر بالأسفل، بينها سطر فارغ. ${IMPORT_PROCESSING_DISCLOSURE.ar}`,
  },
  pasteHintIos: {
    en: `Paste one or more bank messages below, separated by a blank line. ${importProcessingDisclosure('en', 'ios')}`,
    ar: `ألصق رسالة بنكية أو أكثر بالأسفل، بينها سطر فارغ. ${importProcessingDisclosure('ar', 'ios')}`,
  },
  pasteHintWeb: {
    en: `Paste one or more bank messages below, separated by a blank line. ${importProcessingDisclosure('en', 'web')}`,
    ar: `ألصق رسالة بنكية أو أكثر بالأسفل، بينها سطر فارغ. ${importProcessingDisclosure('ar', 'web')}`,
  },
  whereItWent: { en: 'Where it went', ar: 'أين ذهبت' },
  addedByHand: { en: 'Added by hand', ar: 'أُضيفت يدوياً' },
  appLockPhoneOnly: { en: 'App lock works on the phone app only.', ar: 'قفل التطبيق يعمل على تطبيق الهاتف فقط.' },
  notifsPhoneOnly: { en: 'Bank app notifications work on the phone app only.', ar: 'إشعارات تطبيقات البنوك تعمل على تطبيق الهاتف فقط.' },
  couldNotReadFile: { en: 'Could not read file', ar: 'تعذّرت قراءة الملف' },
  deleteThisEntry: { en: 'Delete this entry?', ar: 'حذف هذه العملية؟' },
  hiddenFromLists: { en: 'Hidden from lists.', ar: 'مخفي من القوائم.' },
  markStatementPaid: { en: 'Mark this statement paid?', ar: 'تعليم هذا الكشف كمدفوع؟' },
  noCardPaymentYet: { en: 'No payment to this card has been detected yet.', ar: 'لم تُكتشف أي دفعة لهذه البطاقة بعد.' },
  noBankPaymentMatched: { en: 'The paid amount was recorded in Wafra; no bank payment to this card is matched yet.', ar: 'سُجّل المبلغ المدفوع في وفرة، ولم تُطابَق بعد أي دفعة بنكية لهذه البطاقة.' },
  notRecurringQ: { en: 'Not a recurring charge?', ar: 'ليست عملية متكررة؟' },
  notifsAreOff: { en: 'Notifications are off', ar: 'الإشعارات مغلقة' },
  setCreditLimit: { en: 'Set credit limit', ar: 'تحديد حد الائتمان' },
  notAWafraBackup: { en: 'That does not look like a Wafra backup.', ar: 'لا يبدو هذا ملف نسخ احتياطي لوفرة.' },
  restoreReplacesAll: { en: 'This replaces everything currently in the app.', ar: 'سيستبدل هذا كل ما في التطبيق حالياً.' },
  upToDate: { en: 'Up to date', ar: 'كل شيء محدّث' },
  notifsForCardDue: { en: 'Wafra needs notification permission to remind you before a payment is due.', ar: 'يحتاج وفرة إذن الإشعارات لتذكيرك قبل موعد السداد.' },
  notifsForBill: { en: 'Wafra needs notification permission to warn you before a charge lands.', ar: 'يحتاج وفرة إذن الإشعارات لتنبيهك قبل خصم أي مبلغ.' },
  dataStillLoading: { en: 'Your data is still loading. Try again in a second.', ar: 'ما زال تحميل بياناتك جارياً. أعد المحاولة بعد لحظة.' },
  totalCreditLimit: { en: 'Total credit limit', ar: 'إجمالي حد الائتمان' },
  parsePastedText: { en: 'Parse pasted text', ar: 'تحليل النص الملصق' },
  billRemindersDetected: { en: 'Bill reminders detected', ar: 'تم اكتشاف تذكيرات فواتير' },
  searchMerchants: { en: 'Search merchants or categories', ar: 'ابحث في المتاجر أو التصنيفات' },
  searchAccounts: { en: 'Search accounts or last-four digits', ar: 'ابحث بالحساب أو آخر أربعة أرقام' },
  searchLabel: { en: 'Search', ar: 'بحث' },
  remindDayBefore: { en: 'Remind me the day before', ar: 'ذكّرني قبل يوم' },
  cardPaymentDue: { en: 'Card payment due', ar: 'دفعة بطاقة مستحقة' },
  openPhoneSettings: { en: 'Open settings', ar: 'افتح الإعدادات' },
  billRecordsExpense: { en: 'Records an expense of {amount} today.', ar: 'يسجّل مصروفاً بقيمة {amount} اليوم.' },
  merchantRuleOnly: { en: 'Future imports from {merchant} will use this category.', ar: 'ستستخدم العمليات القادمة من {merchant} هذا التصنيف.' },
  merchantRuleAlso: { en: 'Future imports from {merchant} will use this category. Also update {n} existing {entries}?', ar: 'ستستخدم العمليات القادمة من {merchant} هذا التصنيف. هل تحدّث أيضاً {n} من العمليات الحالية؟' },
  rememberForMerchant: { en: 'Remember for {merchant}?', ar: 'تذكّر لـ {merchant}؟' },
  notifAccessFull: { en: 'This works without SMS access. Android grants access to posted notifications even when Wafra is closed. Wafra filters them on this phone and skips SMS and chat apps. Eligible financial alerts are queued temporarily in encrypted storage, then checked for your ledger or Review.', ar: 'تعمل هذه الميزة من دون إذن الرسائل. يتيح أندرويد الوصول إلى الإشعارات المنشورة حتى عند إغلاق وفرة. يفرزها وفرة محلياً ويتجاهل تطبيقات الرسائل والمحادثة. تُحفظ التنبيهات المالية المؤهلة مؤقتاً في تخزين مشفّر ثم تُفحص لإضافتها إلى سجلك أو عرضها للمراجعة.' },
  notifAccessAutoPrompt: { en: 'Enable notification access to track bank-app payments even when Wafra is closed. Wafra filters posted notifications on this phone, skips SMS and chat apps, and checks financial alerts for your ledger or Review.', ar: 'يمكنك تفعيل الوصول إلى الإشعارات لتتبّع دفعات تطبيقات البنوك حتى عند إغلاق وفرة. يفرز وفرة الإشعارات على جهازك ويتجاهل تطبيقات الرسائل والمحادثة ويفحص التنبيهات المالية لسجلك أو للمراجعة.' },
  notifDiagnosticsTitle: { en: 'Bank notification diagnostics', ar: 'تشخيص إشعارات البنك' },
  notifDiagnosticsRefresh: { en: 'Refresh diagnostics', ar: 'تحديث التشخيص' },
  startWithSample: { en: 'Start with sample data', ar: 'ابدأ ببيانات تجريبية' },
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
    en: 'This destroys Wafra’s encrypted ledger and any captured messages waiting inside Wafra. It cannot be undone. Bank SMS remain in Messages. If this iPhone previously configured the old “Wafra Capture” automation, Wafra opens Shortcuts afterward so you can remove the old items.',
    ar: 'سيؤدي هذا إلى إتلاف سجل وفرة المشفّر وأي رسائل ملتقطة تنتظر داخل وفرة. لا يمكن التراجع. ستبقى رسائل البنك في تطبيق الرسائل. إذا سبق إعداد أتمتة «Wafra Capture» القديمة على هذا الآيفون، فستفتح وفرة تطبيق الاختصارات بعد ذلك كي تتمكن من حذف العناصر القديمة.',
  },
  storageRecoveryEraseConfirm: { en: 'Erase permanently', ar: 'محو نهائي' },
  storageRecoveryEraseKeep: { en: 'Keep my data', ar: 'احتفظ ببياناتي' },
  storageRecoveryEraseFailed: {
    en: 'The erase did not finish. Wafra is keeping recovery open and saving paused until you try again.',
    ar: 'لم تكتمل عملية المحو. ستُبقي وفرة شاشة الاسترداد مفتوحة والحفظ متوقفاً حتى تعيد المحاولة.',
  },
  appName: { en: 'Wafra', ar: 'وفرة' },
  importMoneyMismatchTitle: { en: 'Check the currency', ar: 'تحقّق من العملة' },
  importMoneyMismatchBody: {
    en: 'These alerts use a different currency from your ledger, or contain an amount Wafra cannot safely import. Nothing was added.',
    ar: 'تستخدم هذه التنبيهات عملة مختلفة عن سجلك، أو تتضمن مبلغاً لا يمكن لوفرة استيراده بأمان. لم تُضف أي عملية.',
  },
  recommended: { en: 'RECOMMENDED', ar: 'مقترح' },
  onboardRegionalExample: { en: 'Examples from your region', ar: 'أمثلة من منطقتك' },
  onboardRegionalBankGeneric: { en: 'Bank', ar: 'بنك' },
  onboardScenePurchase: { en: 'Card purchase', ar: 'شراء بالبطاقة' },
  onboardSceneBill: { en: 'Bill payment', ar: 'دفع فاتورة' },
  onboardSceneIncome: { en: 'Salary credited', ar: 'إيداع الراتب' },
  onboardSceneGroceries: { en: 'Groceries', ar: 'بقالة' },
  onboardSceneGroceryStore: { en: 'Grocery store', ar: 'متجر بقالة' },
  onboardSceneUtilities: { en: 'Utilities', ar: 'خدمات' },
  onboardSceneIncomeCategory: { en: 'Salary', ar: 'راتب' },
  onboardSceneDining: { en: 'Dining', ar: 'مطاعم' },
  onboardSceneTransport: { en: 'Transport', ar: 'مواصلات' },
  onboardSceneStatement: { en: 'Statement', ar: 'كشف' },
  onboardSceneTelecom: { en: 'Telecom', ar: 'اتصالات' },
  onboardSceneThisMonth: { en: 'THIS MONTH', ar: 'هذا الشهر' },
  onboardSceneDueBills: { en: 'due · 3 bills', ar: 'مستحق · ٣ فواتير' },
  onboardSceneElectricity: { en: 'Electricity', ar: 'الكهرباء' },
  onboardSceneCardDue: { en: 'Card due', ar: 'استحقاق البطاقة' },
  onboardSceneInternet: { en: 'Internet', ar: 'الإنترنت' },
  onboardSceneSpent: { en: 'Spent', ar: 'الإنفاق' },
  onboardSceneBills: { en: 'Bills', ar: 'الفواتير' },
  onboardSceneAccounts: { en: 'Accounts', ar: 'الحسابات' },
  onboardSceneNet: { en: 'net', ar: 'صافي' },
  onboardTrackingOneView: { en: 'Supported bank activity in one view.', ar: 'نشاط البنوك المدعوم في صورة واحدة.' },
  onboardTrackingSpreadsheetScene: { en: 'Wafra keeps new activity organized as it arrives.', ar: 'ينظّم وفرة النشاط الجديد عند وصوله.' },
  onboardTrackingFinanceScene: { en: 'Wafra does not need your bank login.', ar: 'لا يحتاج وفرة إلى تسجيل الدخول إلى بنكك.' },
  onboardTrackingFreshSceneTitle: { en: 'Start clean.', ar: 'ابدأ بصورة نظيفة.' },
  onboardTrackingFreshSceneBody: { en: 'Start with your first entry or a supported bank message.', ar: 'ابدأ بأول عملية أو برسالة بنك مدعومة.' },
  onboardCaptureSceneIncoming: { en: 'Bank activity arrives', ar: 'يصل نشاط البنك' },
  onboardCaptureSceneOrganized: { en: 'Wafra files supported activity into your ledger.', ar: 'ينظّم وفرة النشاط المدعوم في سجلك.' },
  onboardSceneAlertsToPicture: { en: '3 ALERTS ORGANIZED', ar: 'تم تنظيم 3 تنبيهات' },
  onboardSceneNetWeek: { en: 'net this week', ar: 'صافي هذا الأسبوع' },
  onboardNameSkip: { en: 'Skip for now', ar: 'تخطي الآن' },
  onboardNamePrivacy: { en: 'Used only to personalize Wafra on this device.', ar: 'يُستخدم فقط لتخصيص وفرة على هذا الجهاز.' },
  onboardFocusSpending: { en: 'Where my money goes', ar: 'أين تذهب أموالي' },
  onboardFocusSpendingDetail: { en: 'Categories, merchants, and the spending that adds up', ar: 'التصنيفات والتجار والمصروفات التي تتراكم' },
  onboardFocusBills: { en: 'Bills & subscriptions', ar: 'الفواتير والاشتراكات' },
  onboardFocusBillsDetail: { en: 'See what is due and separate utilities from subscriptions', ar: 'اعرف ما هو مستحق وافصل الخدمات عن الاشتراكات' },
  onboardFocusCashflow: { en: 'Money in vs money out', ar: 'الداخل مقابل الخارج' },
  onboardFocusCashflowDetail: { en: 'Understand income, spending, and your real net', ar: 'افهم الدخل والمصروف وصافي التدفق الحقيقي' },
  onboardFocusOverview: { en: 'Give me the full picture', ar: 'أعطني الصورة الكاملة' },
  onboardFocusOverviewDetail: { en: 'A simple overview across spending, bills, and accounts', ar: 'نظرة بسيطة على المصروفات والفواتير والحسابات' },
  onboardTrackingNone: { en: 'I don’t track it', ar: 'لا أتابعها حالياً' },
  onboardTrackingNoneDetail: { en: 'Start simple. Wafra will organize the picture for you.', ar: 'ابدأ ببساطة. سينظّم وفرة الصورة لك.' },
  onboardTrackingBankApps: { en: 'I check my bank apps', ar: 'أراجع تطبيقات البنك' },
  onboardTrackingBankAppsDetail: { en: 'Bring activity from different banks into one view.', ar: 'اجمع نشاط بنوك مختلفة في صورة واحدة.' },
  onboardTrackingSpreadsheet: { en: 'Spreadsheet or notes', ar: 'جدول أو ملاحظات' },
  onboardTrackingSpreadsheetDetail: { en: 'Less manual cleanup. Keep the useful structure.', ar: 'ترتيب يدوي أقل مع الاحتفاظ بالبنية المفيدة.' },
  onboardTrackingFinanceApp: { en: 'Another finance app', ar: 'تطبيق مالي آخر' },
  onboardTrackingFinanceAppDetail: { en: 'Keep the clarity, without connecting your bank login.', ar: 'احتفظ بالوضوح دون ربط تسجيل الدخول إلى البنك.' },
  onboardCountryAE: { en: 'United Arab Emirates', ar: 'الإمارات العربية المتحدة' },
  onboardCountrySA: { en: 'Saudi Arabia', ar: 'المملكة العربية السعودية' },
  onboardCountryQA: { en: 'Qatar', ar: 'قطر' },
  onboardCountryKW: { en: 'Kuwait', ar: 'الكويت' },
  onboardCountryBH: { en: 'Bahrain', ar: 'البحرين' },
  onboardCountryOM: { en: 'Oman', ar: 'عُمان' },
  onboardCountryEG: { en: 'Egypt', ar: 'مصر' },
  onboardCountryJO: { en: 'Jordan', ar: 'الأردن' },
  onboardCountryIN: { en: 'India', ar: 'الهند' },
  onboardCountryGB: { en: 'United Kingdom', ar: 'المملكة المتحدة' },
  onboardCountryUS: { en: 'United States', ar: 'الولايات المتحدة' },
  onboardCountryFR: { en: 'France', ar: 'فرنسا' },
  onboardCountryDE: { en: 'Germany', ar: 'ألمانيا' },
  onboardCountryES: { en: 'Spain', ar: 'إسبانيا' },
  onboardCountryIT: { en: 'Italy', ar: 'إيطاليا' },
  onboardCountryNL: { en: 'Netherlands', ar: 'هولندا' },
  onboardCountryElsewhere: { en: 'Somewhere else', ar: 'مكان آخر' },
  onboardCountrySheetTitle: { en: 'Where do you bank?', ar: 'أين تتعامل مصرفياً؟' },
  onboardCountrySheetBody: { en: 'This sets how dates in your bank messages and statements are read, and the example banks Wafra shows. Your own accounts still come from your alerts, whichever country they are in.', ar: 'يحدد هذا طريقة قراءة التواريخ في رسائل بنكك وكشوفه، وأمثلة البنوك التي يعرضها وفرة. أما حساباتك فتأتي دائماً من تنبيهاتك، في أي بلد كانت.' },
  onboardCountryShowing: { en: 'Country:', ar: 'البلد:' },
  settingsCountryTitle: { en: 'Country', ar: 'البلد' },
  settingsCountryDetail: { en: 'Date format for alerts and statements', ar: 'صيغة التاريخ في التنبيهات والكشوف' },
  settingsCountrySheetBody: { en: 'Wafra reads a date like 03/04 the way your country writes it. It does not change your ledger currency or which banks Wafra can read.', ar: 'يقرأ وفرة تاريخاً مثل 03/04 بالطريقة التي يكتبها بلدك. ولا يغيّر ذلك عملة سجلك ولا البنوك التي يستطيع وفرة قراءتها.' },
  countrySearch: { en: 'Search countries', ar: 'ابحث عن بلد' },
  countryNoMatch: { en: 'No country matches that search.', ar: 'لا يوجد بلد يطابق هذا البحث.' },
  onboardCountryUnknown: { en: 'Choose your country', ar: 'اختر بلدك' },
  onboardCountryChange: { en: 'Change', ar: 'تغيير' },
  onboardAlertsTitle: { en: 'How does your bank tell you about a payment?', ar: 'كيف يخبرك بنكك بعملية الدفع؟' },
  onboardAlertsBody: { en: 'This decides how far back Wafra can go. Pick what your main bank does.', ar: 'هذا يحدد إلى أي مدى يستطيع وفرة الرجوع في الماضي. اختر ما يفعله بنكك الرئيسي.' },
  onboardAlertsSms: { en: 'It texts me', ar: 'يرسل لي رسالة نصية' },
  onboardAlertsSmsDetail: { en: 'Your inbox keeps them, so Wafra can rebuild past months too.', ar: 'رسائلك محفوظة، لذا يستطيع وفرة إعادة بناء الأشهر السابقة أيضاً.' },
  onboardAlertsNotifications: { en: 'App notifications only', ar: 'إشعارات التطبيق فقط' },
  onboardAlertsNotificationsDetail: { en: 'Wafra can follow new ones. Older ones are already gone from the phone.', ar: 'يستطيع وفرة متابعة الجديد منها. أما القديمة فلم تعد موجودة على الهاتف.' },
  onboardAlertsNeither: { en: 'Neither — I check the app or a statement', ar: 'لا هذا ولا ذاك — أراجع التطبيق أو كشف الحساب' },
  onboardAlertsNeitherDetail: { en: 'A statement is the fastest way to bring that money in.', ar: 'كشف الحساب هو أسرع طريقة لإدخال تلك العمليات.' },
  onboardAlertsUnsure: { en: 'I’m not sure', ar: 'لست متأكداً' },
  onboardAlertsUnsureDetail: { en: 'Wafra will look, and show you what it could and could not find.', ar: 'سيبحث وفرة، ثم يعرض لك ما وجده وما لم يجده.' },
  onboardAlertsReachPast: { en: 'Earlier months', ar: 'الأشهر السابقة' },
  onboardAlertsReachFuture: { en: 'From now on', ar: 'من الآن فصاعداً' },
  onboardAlertsReachCovered: { en: 'Wafra reads these', ar: 'يقرأها وفرة' },
  onboardAlertsReachStatement: { en: 'Needs a statement', ar: 'تحتاج كشف حساب' },
  onboardAlertsReachManual: { en: 'You add these yourself', ar: 'تضيفها بنفسك' },
  onboardAlertsReachUnknown: { en: 'Wafra will check', ar: 'سيتحقق وفرة' },
  onboardHistoryGapTitle: { en: 'Your past months need a statement', ar: 'الأشهر السابقة تحتاج كشف حساب' },
  onboardHistoryGapBody: { en: 'Wafra will catch everything from here on its own. To get earlier months right, import a statement — it takes a minute and nothing leaves your phone.', ar: 'سيلتقط وفرة كل ما يأتي من الآن تلقائياً. وللحصول على الأشهر السابقة بدقة، استورد كشف حساب — يستغرق دقيقة ولا تغادر بياناتك هاتفك.' },
  onboardHistoryGapManualTitle: { en: 'This bank needs a statement', ar: 'هذا البنك يحتاج كشف حساب' },
  onboardHistoryGapManualBody: { en: 'A bank that sends nothing leaves Wafra nothing to read, now or later. Import a statement to bring this spending in — you can also add entries yourself. Nothing leaves your phone.', ar: 'البنك الذي لا يرسل شيئاً لا يترك لوفرة ما يقرأه، لا الآن ولا لاحقاً. استورد كشف حساب لإدخال هذه العمليات — ويمكنك أيضاً إضافتها بنفسك. ولا تغادر بياناتك هاتفك.' },
  onboardHistoryGapAction: { en: 'Import a statement', ar: 'استيراد كشف حساب' },
  onboardIntentionControl: { en: 'Feel more in control', ar: 'أشعر بسيطرة أكبر' },
  onboardIntentionSpend: { en: 'Spend more intentionally', ar: 'أنفق بوعي أكبر' },
  onboardIntentionAhead: { en: 'Stay ahead of bills', ar: 'أبقى متقدماً على الفواتير' },
  onboardIntentionBuffer: { en: 'Build a safety buffer', ar: 'أبني احتياطياً آمناً' },
  onboardIntentionControlScene: { en: 'Spending, bills, and accounts in one place.', ar: 'المصروفات والفواتير والحسابات في مكان واحد.' },
  onboardIntentionSpendScene: { en: 'Spot rising categories before month-end.', ar: 'لاحظ التصنيفات التي يرتفع إنفاقها قبل نهاية الشهر.' },
  onboardIntentionAheadScene: { en: 'See upcoming bills and due dates in one timeline.', ar: 'شاهد الفواتير القادمة ومواعيد الاستحقاق في مسار واحد.' },
  onboardIntentionBufferScene: { en: 'See what is left after money in and money out.', ar: 'شاهد ما يتبقى بعد الداخل والخارج.' },
  onboardPreviewFrom: { en: 'YOU TRACK TODAY', ar: 'طريقتك اليوم' },
  onboardPrivacyNoLoginTitle: { en: 'No bank login', ar: 'دون تسجيل دخول للبنك' },
  onboardPrivacyNoLoginBody: { en: 'Wafra never asks for your banking password.', ar: 'لا يطلب وفرة كلمة مرور حسابك البنكي.' },
  onboardPrivacyChoiceTitle: { en: 'You can change this later', ar: 'يمكنك تغيير هذا لاحقاً' },
  onboardPrivacyChoiceBody: { en: 'Automatic capture is optional. Manual tracking always remains available.', ar: 'الالتقاط التلقائي اختياري. ويظل الإدخال اليدوي متاحاً دائماً.' },
  onboardInsightSpendingTitle: { en: 'Start with where it went', ar: 'ابدأ من أين ذهبت أموالك' },
  onboardInsightSpendingBody: { en: 'Wafra will open Spending first, with categories and merchants ready as your activity arrives.', ar: 'سيفتح وفرة قسم المصروفات أولاً، مع التصنيفات والتجار كلما وصل نشاطك.' },
  onboardInsightBillsTitle: { en: 'Start with what is coming up', ar: 'ابدأ بما هو قادم' },
  onboardInsightBillsBody: { en: 'Wafra will open Bills first and keep subscriptions separate from utilities and telecom.', ar: 'سيفتح وفرة قسم الفواتير أولاً، ويفصل الاشتراكات عن الخدمات والاتصالات.' },
  onboardInsightCashflowTitle: { en: 'Start with your real flow', ar: 'ابدأ بتدفقك الحقيقي' },
  onboardInsightCashflowBody: { en: 'Home will put Money in, Money out, and Net together without counting matched internal transfers as spending.', ar: 'ستجمع الصفحة الرئيسية الداخل والخارج والصافي دون احتساب التحويلات الداخلية المتطابقة كمصروف.' },
  onboardInsightOverviewTitle: { en: 'Start with the whole picture', ar: 'ابدأ بالصورة الكاملة' },
  onboardInsightOverviewBody: { en: 'Home will give you the simplest overview first, then you can drill into spending, bills, and accounts.', ar: 'ستمنحك الصفحة الرئيسية أبسط نظرة أولاً، ثم يمكنك التعمق في المصروفات والفواتير والحسابات.' },
  onboardBillsFound: { en: 'bills recognised', ar: 'فواتير تم التعرف عليها' },
  onboardSampleBefore: { en: '01 / Bank message', ar: '01 / رسالة البنك' },
  onboardSampleAfter: { en: '02 / In your ledger', ar: '02 / في سجلك' },
  onboardSampleBankAlert: { en: 'A moment in your day', ar: 'لحظة من يومك' },
  onboardSampleInsight: { en: 'Organized by category. Easier to see where it went.', ar: 'مرتّبة حسب التصنيف، لترى أين أنفقتها بسهولة.' },
  onboardFinishSaveFailedTitle: { en: 'Your choice could not be saved.', ar: 'تعذّر حفظ اختيارك.' },
  onboardFinishSaveFailedBody: { en: 'Try again to save your setup. You can continue once it’s saved.', ar: 'حاول مجدداً لحفظ إعدادك. يمكنك المتابعة بعد حفظه.' },
  onboardSetupWorking: { en: 'Saving your choice…', ar: 'جارٍ حفظ اختيارك…' },
  onboardRetrySetup: { en: 'Back to setup choices', ar: 'العودة إلى خيارات الإعداد' },
  onboardPermissionChoiceTitle: { en: 'You’re in control.', ar: 'القرار لك.' },
  onboardPermissionChoiceBody: { en: 'SMS access is optional. Retry when you’re ready, or start with manual entries.', ar: 'الوصول للرسائل اختياري. أعد المحاولة عندما تكون مستعداً، أو ابدأ بإدخال يدوي.' },
  onboardPersonalizeOptional: { en: 'Make it yours', ar: 'خصّص تجربتك' },
  onboardSampleLabel: { en: 'INTERACTIVE EXAMPLE', ar: 'مثال تفاعلي' },
  onboardSampleMessage: { en: 'Card purchase at Coffee shop. Card ending 4582.', ar: 'شراء بالبطاقة من مقهى. البطاقة المنتهية بـ 4582.' },
  onboardSampleAction: { en: 'Organize this alert', ar: 'نظّم هذا التنبيه' },
  onboardSampleReset: { en: 'See the alert again', ar: 'شاهد التنبيه مجدداً' },
  onboardSampleMerchant: { en: 'Coffee shop', ar: 'مقهى' },
  onboardSampleCategory: { en: 'Dining · Card purchase', ar: 'مطاعم · شراء بالبطاقة' },
  onboardSampleNote: { en: 'Example only. Nothing is saved.', ar: 'مثال فقط. لا يُحفظ شيء.' },
  onboardResumeError: { en: 'Could not restore setup progress. Try again to continue safely.', ar: 'تعذّر استعادة تقدّم الإعداد. أعد المحاولة للمتابعة بأمان.' },
  onboardPersonalizeCta: { en: 'Get started', ar: 'ابدأ الآن' },
  onboardPreviewIncome: { en: 'Income received', ar: 'دخل مستلم' },
  onboardPreviewBill: { en: 'Upcoming bill', ar: 'فاتورة قادمة' },
  onboardStepOf: { en: 'Step {step} of {total}', ar: 'الخطوة {step} من {total}' },
  onboardBack: { en: 'Back', ar: 'رجوع' },
  onboardGoalEmergency: { en: 'Emergency fund', ar: 'صندوق الطوارئ' },
  onboardGoalEmergencyDetail: { en: 'A visible safety buffer', ar: 'احتياطي أمان واضح أمامك' },
  onboardGoalTravel: { en: 'A proper holiday', ar: 'إجازة تستحقها' },
  onboardGoalTravelDetail: { en: 'Flights, stays, and spending money', ar: 'رحلات وإقامة ومصروف' },
  onboardGoalHome: { en: 'A home deposit', ar: 'دفعة منزل أولى' },
  onboardGoalHomeDetail: { en: 'Make the first big milestone visible', ar: 'اجعل أول محطة كبيرة واضحة' },
  onboardBudgetEssentials: { en: 'Essentials first', ar: 'الأساسيات أولاً' },
  onboardBudgetEssentialsDetail: { en: 'A tighter plan for focused months', ar: 'خطة أدق للأشهر المنضبطة' },
  onboardBudgetBalanced: { en: 'Balanced', ar: 'متوازنة' },
  onboardBudgetBalancedDetail: { en: 'Comfort with clear guardrails', ar: 'راحة مع حدود واضحة' },
  onboardBudgetFlexible: { en: 'More flexible', ar: 'أكثر مرونة' },
  onboardBudgetFlexibleDetail: { en: 'More room for dining and shopping', ar: 'مساحة أكبر للمطاعم والتسوق' },
  onboardPlanPending: { en: 'Plan saved. Waiting for real income.', ar: 'حُفظت الخطة. بانتظار دخل حقيقي.' },
  onboardCaptureTitleIos: { en: 'Choose how to add activity', ar: 'اختر كيف تضيف نشاطك' },
  onboardCaptureBodyIos: { en: 'Connect supported bank messages, or start manually. You can change this later.', ar: 'اربط رسائل البنوك المدعومة أو ابدأ يدوياً. يمكنك تغيير ذلك لاحقاً.' },
  onboardAutomaticChoiceAndroidBody: { en: 'Import past SMS and capture new supported alerts. Needs SMS permission. Free for your first 3 app days, then Wafra Pro.', ar: 'استورد رسائل البنك السابقة والتقط التنبيهات المدعومة الجديدة. يتطلب إذن الرسائل. مجاني لأول ٣ أيام من استخدام التطبيق، ثم يتطلب وفرة برو.' },
  onboardAndroidSmsSourceTitle: { en: 'Bank SMS', ar: 'رسائل البنك' },
  onboardAndroidSmsSourceBody: { en: 'Bring in past messages and keep reading supported bank SMS on this phone.', ar: 'استورد الرسائل السابقة واستمر بقراءة رسائل البنوك المدعومة على هذا الهاتف.' },
  onboardAndroidPushSourceTitle: { en: 'Bank app alerts', ar: 'تنبيهات تطبيقات البنوك' },
  onboardAndroidPushSourceBody: { en: 'Android grants access to posted notifications even when Wafra is closed. Wafra filters them on this phone, skips SMS and chat apps, and checks financial alerts for your ledger or Review.', ar: 'يتيح أندرويد الوصول إلى الإشعارات المنشورة حتى عند إغلاق وفرة. يفرزها وفرة على جهازك ويتجاهل تطبيقات الرسائل والمحادثة ويفحص التنبيهات المالية لإضافتها إلى سجلك أو عرضها للمراجعة.' },
  onboardAndroidPushAwaiting: { en: 'Turn on Wafra in Android Notification access, then come back here.', ar: 'فعّل وفرة في وصول إشعارات أندرويد ثم عد إلى هنا.' },
  onboardSmsDeniedInline: { en: 'SMS access stayed off. You can retry it, use bank-app alerts instead, or continue manually.', ar: 'بقي وصول الرسائل متوقفاً. يمكنك إعادة المحاولة أو استخدام تنبيهات تطبيق البنك أو المتابعة يدوياً.' },
  onboardCaptureContinueBoth: { en: 'Continue with both connected', ar: 'متابعة بعد ربط المصدرين' },
  onboardCaptureContinueOne: { en: 'Continue with this source', ar: 'متابعة بهذا المصدر' },
  onboardAutomaticChoiceIos: { en: 'Connect bank messages', ar: 'ربط رسائل البنك' },
  onboardAutomaticChoiceIosBody: { en: 'Add one Wafra Shortcut, then turn on a Message automation. Past messages are optional.', ar: 'أضف اختصار وفرة مرة واحدة، ثم فعّل أتمتة الرسائل. استيراد الرسائل السابقة اختياري.' },
  onboardStatementChoice: { en: 'Import bank statements', ar: 'استيراد كشوف البنك' },
  onboardStatementChoiceBody: {
    en: 'Send PDF, CSV, or TSV through Wafra’s secure relay. Raw files are parsed in memory, then discarded.',
    ar: 'أرسل ملفات PDF أو CSV أو TSV عبر خدمة وفرة الآمنة. تُحلل الملفات الخام في الذاكرة ثم تُحذف.',
  },
  onboardStatementBack: { en: 'Back to setup', ar: 'العودة إلى الإعداد' },
  onboardPastTitle: {
    en: 'Bring in your past spending',
    ar: 'أضف مصروفاتك السابقة',
  },
  onboardPastBody: {
    en: 'Download a statement from your bank app and add it here.',
    ar: 'نزّل كشفاً من تطبيق بنكك وأضفه هنا.',
  },
  onboardPastAction: {
    en: 'Add a statement',
    ar: 'أضف كشفاً',
  },
  onboardLater: {
    en: 'Later',
    ar: 'لاحقاً',
  },
  onboardHowItWorks: {
    en: 'How it works',
    ar: 'كيف يعمل',
  },
  onboardLiveTitle: {
    en: 'Catch new transactions',
    ar: 'التقط العمليات الجديدة',
  },
  onboardLiveBody: {
    en: 'Bank texts or Apple Pay taps reach Wafra on this iPhone.',
    ar: 'تصل رسائل البنك أو مدفوعات Apple Pay إلى وفرة على هذا الآيفون.',
  },
  onboardLiveAction: {
    en: 'Set up',
    ar: 'إعداد',
  },
  // The same step on iOS 15, where automatic capture cannot be set up.
  onboardLiveUnsupportedTitle: {
    en: 'Start with your statements',
    ar: 'ابدأ بكشوف حسابك',
  },
  onboardLiveUnsupportedBody: {
    en: 'Automatic capture needs iOS 16 or later. Import a bank statement to bring in your transactions, or paste bank messages as they arrive.',
    ar: 'يتطلب الالتقاط التلقائي iOS 16 أو أحدث. استورد كشف حساب بنكي لإضافة عملياتك، أو الصق رسائل البنك عند وصولها.',
  },
  onboardPasteMessagesBody: {
    en: 'Paste a bank text into Wafra. Processed on this iPhone; no automatic access to Messages.',
    ar: 'الصق رسالة البنك في وفرة. تُعالج على هذا الآيفون؛ دون وصول تلقائي إلى الرسائل.',
  },
  // "I'll add by hand" on iOS 15, where capture cannot be turned on later.
  onboardManualIosUnsupportedBody: {
    en: 'Add entries yourself. Statements and pasting stay available.',
    ar: 'أضف العمليات بنفسك. يبقى استيراد الكشوف واللصق متاحاً.',
  },
  // The iOS 15 result once a statement or paste brought transactions in.
  onboardIosImportedTitle: { en: 'Your transactions are in.', ar: 'وصلت عملياتك إلى وفرة.' },
  onboardIosImportedBody: {
    en: 'Add more any time from Accounts: import another statement, or paste bank messages.',
    ar: 'أضف المزيد متى شئت من الحسابات: استورد كشف حساب آخر، أو الصق رسائل البنك.',
  },
  onboardNotNow: {
    en: 'Not now',
    ar: 'ليس الآن',
  },
  onboardManualChoiceBody: { en: 'Add entries yourself. No SMS access. Set up capture later.', ar: 'أضف العمليات بنفسك. دون وصول للرسائل. يمكنك إعداد الالتقاط لاحقاً.' },
  onboardManualChoiceIosBody: { en: 'Add entries yourself. No Messages access. Connect later.', ar: 'أضف العمليات بنفسك. دون وصول إلى الرسائل. يمكنك الربط لاحقاً.' },
  onboardEntryFound: { en: 'entry organised', ar: 'عملية تم تنظيمها' },
  onboardEntriesFound: { en: 'entries organised', ar: 'عمليات تم تنظيمها' },
  onboardAccountFound: { en: 'account recognised', ar: 'حساب تم التعرف عليه' },
  onboardAccountsFound: { en: 'accounts recognised', ar: 'حسابات تم التعرف عليها' },
  onboardCapturePrivacyIos: {
    en: 'Processed on this iPhone. Nothing uploaded.',
    ar: 'تتم المعالجة على هذا الآيفون. لا يُرفع شيء.',
  },
  onboardCaptureLocalAutomaticTitle: {
    en: 'Automatic alerts stay on your phone',
    ar: 'تبقى التنبيهات التلقائية على هاتفك',
  },
  onboardCaptureLocalAutomaticBody: {
    en: 'SMS/Message capture is local. Statement import uses the secure relay only when you choose it.',
    ar: 'يتم التقاط الرسائل محلياً. يستخدم استيراد الكشوف الخدمة الآمنة فقط عندما تختاره.',
  },
  onboardCaptureLearnMoreTitle: { en: 'About bank messages', ar: 'حول رسائل البنك' },
  onboardCaptureLearnMorePrivacy: {
    en: 'Wafra does not access your Messages inbox. An Apple automation you create passes new messages to Wafra, which keeps bank messages and discards the rest on this iPhone.',
    ar: 'لا يصل وفرة إلى صندوق الرسائل. تمرّر أتمتة Apple التي تنشئها الرسائل الجديدة إلى وفرة، الذي يحتفظ برسائل البنك ويتجاهل البقية على هذا الآيفون.',
  },
  onboardCaptureLearnMoreRetention: {
    en: 'Raw Message Content and Sender expire logically after 30 days. Physical deletion happens on the next capture or queue check, so protected bytes can remain longer.',
    ar: 'تنتهي صلاحية محتوى الرسالة الخام واسم المرسل منطقياً بعد ٣٠ يوماً. يحدث الحذف الفعلي عند تشغيل الالتقاط أو فحص الصف التالي، لذا قد تبقى البيانات المحمية مدة أطول.',
  },
  onboardCaptureLearnMoreLegacy: {
    en: 'An older Wafra Capture automation may continue uploading selected alerts until you remove or retire it.',
    ar: 'قد تستمر أتمتة Wafra Capture الأقدم في رفع التنبيهات المحددة حتى تزيلها أو توقفها نهائياً.',
  },
  onboardCaptureLearnMoreLimits: {
    en: 'Apple’s automation cannot select bank SMS IDs as senders, so it runs for every new message and Wafra filters on this iPhone. Past-alert import is separate and checks retained Messages only when you start it.',
    ar: 'لا تستطيع أتمتة Apple تحديد معرّفات رسائل البنوك كمرسلين، لذلك تعمل لكل رسالة جديدة ويقوم وفرة بالتصفية على هذا الآيفون. استيراد التنبيهات السابقة منفصل ويفحص الرسائل المحتفظ بها فقط عندما تبدأه.',
  },
  onboardSmsDenied: {
    en: 'SMS access was not granted. You can continue and enable capture later.',
    ar: 'لم يُمنح إذن الرسائل. يمكنك المتابعة وتفعيل الالتقاط لاحقاً.',
  },
  onboardCompleteManualBody: { en: 'A coffee, groceries, or your first income is enough to start.', ar: 'تكفي قهوة أو مشتريات أو أول دخل لتبدأ.' },
  onboardCompleteNeedsAttentionTitle: { en: 'Setup needs another look.', ar: 'الإعداد يحتاج إلى مراجعة.' },
  onboardCompleteNeedsAttentionBody: { en: 'Setup could not finish. Try again, or choose manual tracking to continue without message capture.', ar: 'لم يكتمل الإعداد. حاول مجدداً، أو اختر التتبع اليدوي للمتابعة دون التقاط الرسائل.' },
  openWafra: { en: 'Open Wafra', ar: 'افتح وفرة' },
  continueWord: { en: 'Continue', ar: 'متابعة' },
  noStatementYet: { en: 'No statement message has arrived for this card yet.', ar: 'لم تصل رسالة كشف حساب لهذه البطاقة بعد.' },
  // Not "none yet" — none ever. A debit card spends the money already in the
  // account, so it issues no statement and there is no bill to pay toward it.
  debitHasNoStatement: {
    en: 'A debit card has no statement and no bill to pay — it spends the balance in the account.',
    ar: 'بطاقة الخصم المباشر ليس لها كشف حساب ولا فاتورة تُسدَّد — فهي تنفق الرصيد الموجود في الحساب.',
  },
  underMinimumDue: { en: 'Still under the minimum due.', ar: 'ما زال أقل من الحد الأدنى المستحق.' },
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
  // Ask to Buy, or a Play payment the bank has not settled. Nothing is owed
  // yet and nothing failed: the store decides later, on its own.
  purchasePendingTitle: { en: 'Waiting on the store', ar: 'بانتظار المتجر' },
  purchasePendingBody: {
    en: 'The store has not completed this purchase yet. Wafra Pro switches on by itself once it does.',
    ar: 'لم يُكمل المتجر عملية الشراء بعد. سيُفعَّل وفرة برو تلقائياً بمجرد اكتمالها.',
  },
  // A cancelled answer from the store, or one the SDK gave without a reason. Calm and neutral: it says what
  // happened and what to do next, and promises nothing about charges (see the purchaseFailedBody contract).
  purchaseNotCompleted: {
    en: 'Purchase not completed. You can try again, or restore a previous purchase.',
    ar: 'لم تكتمل عملية الشراء. يمكنك المحاولة مجدداً أو استعادة عملية شراء سابقة.',
  },
  purchaseFailed: { en: 'Purchase not confirmed', ar: 'لم يتم تأكيد الشراء' },
  purchaseFailedBody: {
    en: 'The store could not confirm Pro yet. Check your connection, then restore purchases before trying to buy again.',
    ar: 'لم يتمكن المتجر من تأكيد وفرة برو بعد. تحقق من الاتصال، ثم استعد المشتريات قبل محاولة الشراء مجدداً.',
  },
  featAutoTracking: { en: 'Automatic tracking', ar: 'تتبع تلقائي' },
  featAutoTrackingText: { en: 'Bank SMS and app notifications become transactions, cards and dues by themselves.', ar: 'رسائل البنك والإشعارات تتحول تلقائياً إلى عمليات وبطاقات ومستحقات.' },
  // iPhone gets the same feature by a different road — Apple lets no app read
  // Messages, so a Shortcut forwards them. Describing it as "reads your SMS"
  // there would promise something the platform forbids.
  featAutoTrackingIosText: { en: 'Supported bank messages passed by your personal automation are processed locally into transactions, cards, dues, or review when needed. Set up once.', ar: 'تُعالج رسائل البنوك المدعومة التي تمررها أتمتتك الشخصية محلياً لتصبح عمليات أو بطاقات أو مستحقات، أو تُرسل للمراجعة عند الحاجة. إعداد مرة واحدة.' },
  featPasteFreeText: { en: 'Reading a bank message you hand over — and typing entries — never needs a subscription, on any phone.', ar: 'قراءة رسالة بنكية تلصقها بنفسك وإضافة العمليات يدوياً لا تحتاج اشتراكاً أبداً على أي هاتف.' },
  // Onboarding
  getStarted: { en: 'Get started', ar: 'ابدأ الآن' },

  // Hero caption
  saved: { en: 'Saved', ar: 'المدخر' },
  netAfterSpending: { en: 'Net after spending', ar: 'الصافي بعد الإنفاق' },

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
  allTime: { en: 'All time', ar: 'كل الفترات' },

  // Insights (stats) screen
  projected: { en: 'Projected', ar: 'متوقع' },
  spentLabel: { en: 'Spent', ar: 'المصروف' },
  totalOut: { en: 'Total spent', ar: 'إجمالي الإنفاق' },
  newLimit: { en: 'New limit', ar: 'حد جديد' },
  daysLeft: { en: '{count} day{s} left', ar: 'متبقي {count} يوم' },


  // Other screens
  transactionsTitle: { en: 'Transactions', ar: 'العمليات' },
  cardsTitle: { en: 'Payment cards', ar: 'بطاقات الدفع' },
  inactiveCards: { en: 'Inactive cards', ar: 'بطاقات غير نشطة' },
  lastUsed: { en: 'Last used', ar: 'آخر استخدام' },
  addTransactionTitle: { en: 'Add transaction', ar: 'إضافة عملية' },
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
  movementsExcluded: {
    en: '{count} money movement{s} not counted',
    ar: '{count} حركة أموال مستبعدة من الإجمالي',
  },
  cashWithdrawalsExcluded: { en: '{count} cash withdrawal{s} not counted', ar: '{count} سحب نقدي مستبعد من الإجمالي' },
  investingExcluded: { en: '{count} investment{s} not counted', ar: '{count} استثمار مستبعد من الإجمالي' },
  cashDepositsExcluded: { en: '{count} cash deposit{s} not counted', ar: '{count} إيداع نقدي مستبعد من الإجمالي' },
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
  recentActivity: { en: 'Recent activity', ar: 'أحدث العمليات' },
  allWord: { en: 'All', ar: 'الكل' },
  moneyPictureTitle: { en: 'Your money picture', ar: 'صورتك المالية' },
  moneyPictureBuilding: {
    en: 'Wafra is organizing real activity as it arrives.',
    ar: 'ينظّم وفرة نشاطك الحقيقي كلما وصل.',
  },
  moneyPictureSaved: {
    en: 'Progress is saved. Continue whenever you are ready.',
    ar: 'تم حفظ التقدّم. تابع متى كنت جاهزاً.',
  },
  moneyPictureAttention: {
    en: 'History import needs attention before it can continue.',
    ar: 'يحتاج استيراد السجل إلى مراجعة قبل أن يتابع.',
  },
  moneyPictureStarting: {
    en: 'Add or connect real activity and this picture will fill itself in.',
    ar: 'أضف أو اربط نشاطاً حقيقياً وستمتلئ هذه الصورة تلقائياً.',
  },
  moneyPictureContinue: { en: 'Continue', ar: 'متابعة' },
  moneyPictureMessagesChecked: { en: 'messages checked', ar: 'رسائل تم فحصها' },
  moneyPictureEntries: { en: 'entries organized', ar: 'عمليات تم تنظيمها' },
  moneyPictureAccounts: { en: 'accounts recognized', ar: 'حسابات تم التعرف عليها' },
  moneyPicturePayments: { en: 'bills & card dues', ar: 'فواتير ومستحقات بطاقات' },
  moneyPictureHistoryFound: {
    en: '{count} money entries found in history',
    ar: 'عُثر على {count} عملية مالية في السجل',
  },
  moneyPictureTruthNote: {
    en: 'Only activity already found in your ledger is shown here.',
    ar: 'يظهر هنا فقط النشاط الذي تم العثور عليه فعلاً في سجلك.',
  },

  // Import screen
  importTitle: { en: 'Import from SMS', ar: 'استيراد من الرسائل' },
  historyImportRunningTitle: {
    en: 'Reading your bank-message history',
    ar: 'جارٍ قراءة سجل رسائل البنك',
  },
  historyImportSavedTitle: {
    en: 'Inbox progress saved',
    ar: 'تم حفظ تقدّم قراءة الرسائل',
  },
  historyImportSavedBody: {
    en: 'Nothing was lost. Open Wafra and retry to continue from the last saved page.',
    ar: 'لم يُفقد شيء. افتح وفرة وأعد المحاولة للمتابعة من آخر صفحة محفوظة.',
  },
  historyImportAccessBody: {
    en: 'Android blocked inbox history access. Open phone settings, allow access, then return to continue safely.',
    ar: 'منع أندرويد الوصول إلى سجل الرسائل. افتح إعدادات الهاتف واسمح بالوصول ثم ارجع للمتابعة بأمان.',
  },
  historyImportLiveProgress: {
    en: '{scanned} messages checked · {found} money entries found. You can keep using Wafra.',
    ar: 'تم فحص {scanned} رسالة · عُثر على {found} قيد مالي. يمكنك متابعة استخدام وفرة.',
  },
  historyImportSettingsTitle: {
    en: 'First inbox import',
    ar: 'الاستيراد الأول من الرسائل',
  },
  retryHistoryImport: { en: 'Retry inbox import', ar: 'إعادة محاولة استيراد الرسائل' },
  choiceColor: { en: 'Color {count}', ar: 'اللون {count}' },
  choiceIcon: { en: 'Icon {count}', ar: 'الأيقونة {count}' },
  findBankAlerts: { en: 'Find bank messages', ar: 'ابحث عن الرسائل البنكية' },
  scanBankAlertsPrivacy: {
    en: 'Finds supported bank messages on this phone. They are parsed here; raw messages never leave.',
    ar: 'يبحث عن رسائل البنوك المدعومة على هذا الهاتف. تُحلّل هنا ولا تغادر الرسائل الخام الجهاز.',
  },
  pasteInstead: { en: 'Paste messages instead', ar: 'الصق الرسائل بدلاً من ذلك' },
  hideManualPaste: { en: 'Hide manual paste', ar: 'إخفاء اللصق اليدوي' },
  importBankActivity: { en: 'Import bank activity', ar: 'استيراد النشاط البنكي' },
  trySample: { en: 'Try sample', ar: 'جرّب مثالاً' },
  historyCardTitle: { en: 'Import past alerts', ar: 'استيراد التنبيهات السابقة' },
  historyLast30Days: { en: 'Last 30 days', ar: 'آخر ٣٠ يوماً' },
  historyThisYear: { en: 'This year', ar: 'هذا العام' },
  historyChooseDates: { en: 'Choose dates', ar: 'اختيار التواريخ' },
  historyChooseYear: { en: 'Choose a year', ar: 'اختيار عام' },
  historyAddAction: { en: 'Add history Shortcut', ar: 'إضافة اختصار السجل' },
  historyAddedAction: { en: 'Continue after adding', ar: 'متابعة بعد الإضافة' },
  historyStartAction: { en: 'Import history', ar: 'استيراد السجل' },
  historyContinueAction: { en: 'Open Shortcuts', ar: 'فتح الاختصارات' },
  historyReviewAction: { en: 'Review imported alerts', ar: 'مراجعة التنبيهات المستوردة' },
  historyTryAgain: { en: 'Try again', ar: 'حاول مرة أخرى' },
  historyReinstallAction: { en: 'Reinstall Shortcut', ar: 'إعادة تثبيت الاختصار' },
  historyPasteManually: { en: 'Paste messages manually', ar: 'لصق الرسائل يدوياً' },
  historyRequiresIos26: {
    en: 'Automatic retained-Message search requires iOS 26 or later. Manual paste stays free.',
    ar: 'يتطلب البحث التلقائي في الرسائل المحتفظ بها iOS 26 أو أحدث. يظل اللصق اليدوي مجانياً.',
  },
  historyInstallUnavailable: {
    en: 'History Import is unavailable in this build because its published Shortcut link is not configured.',
    ar: 'استيراد السجل غير متاح في هذه النسخة لأن رابط الاختصار المنشور غير مُعدّ.',
  },
  historyInstallUnavailableAction: {
    en: 'History Import unavailable',
    ar: 'استيراد السجل غير متاح',
  },
  historyLocalProcessing: { en: 'Reads saved Messages in smaller batches. Wafra processes and deduplicates them on this iPhone; nothing is uploaded.', ar: 'يقرأ الرسائل المحفوظة على دفعات أصغر. يعالجها وفرة ويمنع التكرار على هذا الآيفون؛ ولا يُرفع شيء.' },
  historyReadyCompact: {
    en: 'Choose Always Allow when Apple asks',
    ar: 'اختر «السماح دائماً» عندما تطلب Apple',
  },
  historyRunningCompact: {
    en: 'Shortcuts is still working. Keep the iPhone unlocked',
    ar: 'لا يزال تطبيق الاختصارات يعمل. أبقِ الآيفون مفتوح القفل',
  },
  historyReviewCompact: {
    en: 'Nothing is saved until you confirm',
    ar: 'لن يُحفظ شيء حتى تؤكد',
  },
  historyNoSupportedCompact: {
    en: 'No supported bank activity was saved.',
    ar: 'لم يُحفظ أي نشاط بنكي مدعوم.',
  },
  historyNoNewCompact: {
    en: 'Nothing new was saved.',
    ar: 'لم يُحفظ أي شيء جديد.',
  },
  historyLearnMore: { en: 'Learn more', ar: 'معرفة المزيد' },
  historyDetailsTitle: {
    en: 'Past alerts and privacy',
    ar: 'التنبيهات السابقة والخصوصية',
  },
  historyNoLiveProgressDetails: {
    en: 'Apple does not share live progress or a percentage with Wafra while the Shortcut runs.',
    ar: 'لا تشارك Apple تقدماً مباشراً أو نسبة مئوية مع وفرة أثناء تشغيل الاختصار.',
  },
  historyFirstRunGuidance: { en: 'Choose Always Allow. Keep the iPhone unlocked while Apple reads Messages. If the import stops, open it again to continue.', ar: 'اختر «السماح دائماً». أبقِ الآيفون مفتوح القفل أثناء قراءة Apple للرسائل. إذا توقف الاستيراد، افتحه مرة أخرى للمتابعة.' },
  historyContinueBody: { en: 'Continue in Shortcuts. Wafra keeps completed progress locally, so you can resume instead of starting over.', ar: 'تابع في الاختصارات. يحتفظ وفرة بالتقدم المكتمل محلياً، لذلك يمكنك الاستئناف بدلاً من البدء من جديد.' },
  historySourceCounts: {
    en: '{understood} understood · {alreadyFiled} already filed · {notAlreadyFiled} understood, not previously filed · {unread} unread or non-financial',
    ar: 'فُهمت {understood} · سُجّلت سابقاً {alreadyFiled} · فُهمت {notAlreadyFiled} ولم تُسجّل سابقاً · تعذّرت قراءة {unread} أو لم تكن مالية',
  },
  historySourceCountsRead: {
    en: '{understood} understood · {unread} unread or non-financial',
    ar: 'فُهمت {understood} · تعذّرت قراءة {unread} أو لم تكن مالية',
  },
  historySourceCountsFiled: {
    en: '{alreadyFiled} already filed · {notAlreadyFiled} not previously filed',
    ar: 'سُجّلت سابقاً {alreadyFiled} · لم تُسجّل سابقاً {notAlreadyFiled}',
  },
  historyImportNoNewSourceCounts: {
    en: '{read} messages checked · {alreadyFiled} already filed · {notAlreadyFiled} understood but needed no new entry · {unread} unread or non-financial',
    ar: 'فُحصت {read} رسالة · سُجّلت سابقاً {alreadyFiled} · فُهمت {notAlreadyFiled} ولم تحتج إلى قيد جديد · تعذّرت قراءة {unread} أو لم تكن مالية',
  },
  historyImportReviewSourceCounts: {
    en: '{understood} understood · {alreadyFiled} already filed · {notAlreadyFiled} understood, not previously filed · {unread} unread or non-financial',
    ar: 'فُهمت {understood} · سُجّلت سابقاً {alreadyFiled} · فُهمت {notAlreadyFiled} ولم تُسجّل سابقاً · تعذّرت قراءة {unread} أو لم تكن مالية',
  },
  historyImportPrivacy: { en: 'Nothing is uploaded. Wafra removes raw message and sender copies after saving or canceling completed imports. Unfinished copies expire and are removed on a later history check. Your Messages inbox is unchanged.', ar: 'لا يُرفع شيء. يحذف وفرة نسخ نص الرسالة والمرسل بعد حفظ الاستيراد المكتمل أو إلغائه. تنتهي صلاحية النسخ غير المكتملة وتُحذف عند فحص السجل لاحقاً. لا يتغير صندوق رسائلك.' },
  historyProgressPrivacy: {
    en: 'Reading protected local history batches. Message text and sender remain only in temporary protected staging until you save, cancel, or the staging expires; nothing is uploaded.',
    ar: 'تجري قراءة دفعات السجل المحلية المحمية. يبقى نص الرسالة والمرسل فقط في تخزين مؤقت محمي حتى تحفظ أو تلغي أو تنتهي صلاحيته؛ ولا يُرفع أي شيء.',
  },
  historyPreparingReview: { en: 'Preparing review…', ar: 'جارٍ إعداد المراجعة…' },
  retryHistoryRead: { en: 'Try reading again', ar: 'إعادة محاولة القراءة' },
  historyImportReviewReady: { en: 'Ready for review', ar: 'جاهز للمراجعة' },
  historyImportNoneFound: {
    en: 'No supported bank activity found',
    ar: 'لم يُعثر على نشاط بنكي مدعوم',
  },
  historyImportNoneFoundBody: {
    en: 'Wafra checked {read} distinct readable retained Messages; {skipped} did not match a supported bank message. Nothing was filed.',
    ar: 'فحص وفرة {read} رسالة محتفظاً بها ومميزة وقابلة للقراءة؛ لم تطابق {skipped} منها تنبيهاً بنكياً مدعوماً. لم يُسجّل شيء.',
  },
  historyImportMissing: { en: 'No staged messages found', ar: 'لم تُوجد رسائل مؤقتة' },
  historyImportMissingBody: {
    en: 'Run {shortcut} again and keep Wafra installed while the Shortcut finishes.',
    ar: 'شغّل «{shortcut}» مجدداً واترك وفرة مثبتاً حتى ينتهي الاختصار.',
  },
  historyImportInvalid: { en: 'This import link is invalid', ar: 'رابط الاستيراد غير صالح' },
  historyImportInvalidBody: {
    en: 'Nothing was read. Leave this screen and run {shortcut} again from Apple Shortcuts.',
    ar: 'لم تتم قراءة أي شيء. غادر هذه الشاشة وشغّل «{shortcut}» مجدداً من اختصارات Apple.',
  },
  historyImportFailed: { en: 'Could not finish the import', ar: 'تعذّر إكمال الاستيراد' },
  historyLeaveReviewTitle: { en: 'Discard this import?', ar: 'حذف هذا الاستيراد؟' },
  historyLeaveReviewBody: {
    en: 'This closes the review and deletes its temporary import. Transactions already saved and your Messages inbox stay unchanged.',
    ar: 'سيؤدي هذا إلى إغلاق المراجعة وحذف نسخة الاستيراد المؤقتة. لن تتغير العمليات المحفوظة سابقاً ولا صندوق رسائلك.',
  },
  historyKeepReviewing: { en: 'Keep reviewing', ar: 'متابعة المراجعة' },
  historyDiscardAndLeave: { en: 'Discard and leave', ar: 'حذف ومغادرة' },
  historyImportFailedBody: {
    en: 'The protected source session is still on this iPhone. Try reading it again or cancel to delete it.',
    ar: 'ما زالت جلسة المصدر المحمية على هذا الآيفون. أعد قراءتها أو ألغِ لحذفها.',
  },
  historySourceDiscarded: {
    en: 'The staged session was removed after the import could not be read. Run the Shortcut again to start a new import.',
    ar: 'حُذفت الجلسة المؤقتة بعد تعذّر قراءة الاستيراد. شغّل الاختصار مجدداً لبدء استيراد جديد.',
  },
  historySourceCleanupFailed: {
    en: 'The import could not be read, and Wafra could not delete its protected staged messages. Try deletion again, or leave them. They become eligible after one hour and are removed the next time Wafra checks history.',
    ar: 'تعذّرت قراءة الاستيراد ولم يتمكن وفرة من حذف الرسائل المؤقتة المحمية. أعد محاولة الحذف أو اتركها. تصبح مؤهلة للحذف بعد ساعة وتُزال في المرة التالية التي يفحص فيها وفرة سجل الاستيراد.',
  },
  historyCancelCleanupFailed: {
    en: 'Nothing was filed. Wafra could not delete the protected staged messages you cancelled. Try deletion again, or leave them. They become eligible after one hour and are removed the next time Wafra checks history.',
    ar: 'لم يُسجّل شيء. لم يتمكن وفرة من حذف الرسائل المؤقتة المحمية التي ألغيتها. أعد محاولة الحذف أو اتركها. تصبح مؤهلة للحذف بعد ساعة وتُزال في المرة التالية التي يفحص فيها وفرة سجل الاستيراد.',
  },
  iosSetupProgressReadFailed: {
    en: 'Saved setup progress couldn’t be read. Tap Try again.',
    ar: 'تعذّرت قراءة تقدّم الإعداد المحفوظ. اضغط «حاول مجدداً».',
  },
  iosHistoryRefreshFailed: {
    en: 'Past-message import couldn’t be checked. Tap Try again.',
    ar: 'تعذّر التحقق من استيراد الرسائل السابقة. اضغط «حاول مجدداً».',
  },
  historySetupStateFailed: {
    en: 'Setup progress didn’t save. Tap Try again.',
    ar: 'لم يُحفظ تقدّم الإعداد. اضغط «حاول مجدداً».',
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
  deleteStagedMessages: { en: 'Delete staged messages', ar: 'حذف الرسائل المؤقتة' },
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
  legacyCapturePrivacyWarning: { en: 'An old Shortcut may still upload bank messages. Review it in Shortcuts.', ar: 'قد يواصل اختصار قديم رفع الرسائل البنكية. راجعه في تطبيق الاختصارات.' },
  messagesPrivacy: { en: 'Privacy and data', ar: 'الخصوصية والبيانات' },
  iosSetupTitle: {
    en: 'Capture sources',
    ar: 'مصادر الالتقاط',
  },
  iosMessageSettingsDetail: {
    en: 'Set up and check capture',
    ar: 'إعداد الالتقاط والتحقق منه',
  },
  iosPastSmsTitle: {
    en: 'Import past SMS (experimental)',
    ar: 'استيراد الرسائل السابقة (تجريبي)',
  },
  iosPastSmsDetail: {
    en: 'Slow and experimental. Statements are faster.',
    ar: 'بطيء وتجريبي. الكشوف أسرع.',
  },
  iosMessageFutureTitle: {
    en: 'Automatic bank messages',
    ar: 'رسائل البنك التلقائية',
  },
  iosMessagePastTitle: { en: 'Past messages · Optional', ar: 'الرسائل السابقة · اختياري' },
  iosMessagePastDetail: {
    en: 'Checks retained Messages on this iPhone.',
    ar: 'يفحص الرسائل المحتفظ بها على هذا الآيفون.',
  },
  iosMessagePastTiming: { en: 'Resumes if interrupted', ar: 'يستأنف إذا توقف' },
  iosMessageGuideTitle: { en: 'In Shortcuts', ar: 'في الاختصارات' },
  iosNotificationSetupAction: { en: 'Set up bank app notifications', ar: 'إعداد إشعارات تطبيق البنك' },
  iosNotificationSetupSummary: { en: 'iOS 27 notification automation. Select your bank app in Shortcuts; Wafra will ask about unclear bank identities during review.', ar: 'أتمتة إشعارات iOS 27. اختر تطبيق البنك في الاختصارات؛ سيطلب وفرة توضيح هوية البنك غير الواضحة أثناء المراجعة.' },
  iosNotificationChooseSms: { en: 'Show SMS setup', ar: 'عرض إعداد الرسائل' },
  reviewAlertPossibleNotificationReplay: { en: 'Possible repeat notification. Compare it with your saved transactions before adding.', ar: 'قد يكون هذا إشعاراً مكرراً. قارنه بمعاملاتك المحفوظة قبل إضافته.' },
  reviewAlertNotificationSource: { en: 'Notification capture', ar: 'التقاط الإشعارات' },
  reviewAlertPossibleApplePayDuplicate: { en: 'Possible Apple Pay duplicate. A matching Apple Pay purchase is already in your transactions.', ar: 'قد تكون عملية Apple Pay مكررة. توجد عملية Apple Pay مطابقة في معاملاتك بالفعل.' },
  historyReviewCapacityBody: {
    en: 'Review is full. Review or dismiss saved alerts, then retry History. Existing expiry limits still apply.',
    ar: 'قائمة المراجعة ممتلئة. راجع التنبيهات المحفوظة أو تجاهلها، ثم أعد محاولة السجل. تبقى حدود انتهاء الصلاحية سارية.',
  },
  // iPhone History only: the completed native History session the hold keeps
  // expires one hour after the History Shortcut finishes (WafraMessageHistoryStore.sessionTTL).
  historyReviewCapacityBodyIos: {
    en: 'Review is full. Wafra keeps the messages this history run read for about 1 hour. Review or dismiss saved alerts and retry within that hour; after that, run the history Shortcut again. Existing expiry limits still apply.',
    ar: 'قائمة المراجعة ممتلئة. تحتفظ وفرة بالرسائل التي قرأها تشغيل السجل هذا لمدة ساعة تقريباً. راجع التنبيهات المحفوظة أو تجاهلها ثم أعد محاولة استيراد السجل خلال هذه الساعة، وبعدها شغّل اختصار السجل مرة أخرى. تبقى حدود انتهاء الصلاحية سارية.',
  },
  reviewAlertsFullWaiting: { en: 'Review is full — {count} alerts waiting. Add or dismiss alerts here to make room. Waiting alerts stay on this iPhone for up to 30 days; after that they are counted as expired.', ar: 'قائمة المراجعة ممتلئة — {count} من التنبيهات بالانتظار. أضف تنبيهات أو تجاهلها هنا لإفساح المجال. تبقى التنبيهات المنتظرة على هذا الآيفون لمدة تصل إلى 30 يوماً، وبعد ذلك تُحتسب كمنتهية الصلاحية.' },
  reviewAlertsExpiredCount: { en: 'Expired before review in the last 30 days: {count}', ar: 'انتهت صلاحيتها قبل المراجعة خلال آخر 30 يوماً: {count}' },
  reviewAlertsEvictedCount: { en: 'Alerts that could not be kept for review because Review was full, in the last 30 days: {count}', ar: 'تنبيهات تعذّر الاحتفاظ بها للمراجعة لأن قائمة المراجعة كانت ممتلئة خلال آخر 30 يوماً: {count}' },
  reviewAlertsCurrencyEvictedCount: { en: 'Other-currency alerts not kept for review in the last 30 days: {count}. Review keeps the newest 50 waiting for an exchange rate.', ar: 'تنبيهات بعملة أخرى لم يُحتفظ بها للمراجعة خلال آخر 30 يوماً: {count}. تحتفظ المراجعة بأحدث 50 تنبيهاً بانتظار سعر الصرف.' },
  reviewAlertsDuplicatePostedCount: { en: 'Possible Apple Pay duplicates posted because Review was full, in the last 30 days: {count}. Check the Transactions screen for a double entry.', ar: 'عمليات قد تكون مكررة لعمليات Apple Pay سُجّلت لأن قائمة المراجعة كانت ممتلئة خلال آخر 30 يوماً: {count}. راجع شاشة «العمليات» للتحقق من وجود قيد مكرر.' },
  reviewAlertsCurrencySkipped: { en: 'Statements and notices in another currency skipped: {count}. Purchases are converted into your ledger currency instead.', ar: 'كشوف وإشعارات بعملة أخرى تم تخطيها: {count}. أما المشتريات فتُحوَّل إلى عملة سجلك.' },
  reviewAlertExpiresIn: { en: 'Days left to review: {count}', ar: 'الأيام المتبقية للمراجعة: {count}' },
  iosNotificationHelpInput: { en: 'Pass notification text to Capture bank notification. Replace the setup test phrase with Shortcut Input before saving the automation.', ar: 'مرّر نص الإشعار إلى «التقاط إشعار بنكي». استبدل عبارة فحص الإعداد بمتغير إدخال الاختصار قبل حفظ الأتمتة.' },
  iosNotificationHelpStatus: { en: 'The permission check and your confirmation are separate from a real notification receipt. Check notification setup to see whether any text has arrived.', ar: 'فحص الأذونات وتأكيدك منفصلان عن استلام إشعار حقيقي. افحص إعداد الإشعارات لمعرفة ما إذا وصل نص فعلاً.' },
  iosNotificationPrivacyBody: { en: 'Only text passed by your Apple Shortcuts automation is saved to Wafra’s protected local queue. Wafra cannot inspect other apps or read old notifications. No raw notification text is uploaded by this capture path.', ar: 'يُحفظ فقط النص الذي تمرّره أتمتة اختصارات Apple في قائمة وفرة المحلية المحمية. لا يستطيع وفرة فحص التطبيقات الأخرى أو قراءة الإشعارات القديمة. لا يرفع مسار الالتقاط هذا نصوص الإشعارات.' },
  iosMessageGuideMessage: { en: 'Message', ar: 'رسالة' },
  iosMessageGuideEntry: {
    en: 'In New Automation, tap Message',
    ar: 'في «أتمتة جديدة»، اضغط «رسالة»',
  },
  iosMessageAddAgain: { en: 'Reinstall Shortcut', ar: 'إعادة تثبيت الاختصار' },
  iosMessageHelpReinstall: {
    en: 'App updates do not replace an installed Shortcut. Use Reinstall Shortcut, open it in Shortcuts, and choose Replace if asked. Keep your existing automation linked to the shortcut you installed.',
    ar: 'تحديث التطبيق لا يستبدل الاختصار المثبّت. استخدم «إعادة تثبيت الاختصار»، وافتحه في الاختصارات، واختر «استبدال» إذا طُلب منك. أبقِ الأتمتة الحالية مرتبطة بالاختصار الذي ثبّتّه.',
  },
  iosMessageReviewAutomation: { en: 'Automation steps', ar: 'خطوات الأتمتة' },
  iosMessageRetrySetup: { en: 'Try again', ar: 'حاول مجدداً' },
  iosMessageHistoryKeepOpen: { en: 'Keep Shortcuts open and iPhone unlocked.', ar: 'أبقِ الاختصارات مفتوحاً والآيفون دون قفل.' },
  iosMessageGuideSender: {
    en: "Sender: leave empty · Message Contains: one space",
    ar: "المرسل: اتركه فارغاً · تحتوي الرسالة على: مسافة واحدة",
  },
  iosMessageGuideNoFilter: {
    en: "Type a single space in “Message Contains” so Next turns on. Messages containing a space reach Wafra regardless of currency. Wafra checks them on this iPhone; this does not turn off Apple’s automation notifications.",
    ar: "اكتب مسافة واحدة في «تحتوي الرسالة على» لتفعيل «التالي». تصل الرسائل التي تحتوي على مسافة إلى وفرة بغض النظر عن العملة، ويفحصها وفرة على هذا الآيفون. هذا لا يوقف إشعارات أتمتة Apple.",
  },
  iosMessageFutureInstallHelp: {
    en: 'Tap Add Shortcut, then add {shortcut} in Shortcuts.',
    ar: 'اضغط «إضافة الاختصار»، ثم أضف {shortcut} في الاختصارات.',
  },
  iosMessageFutureReturnHelp: { en: 'Added {shortcut}?', ar: 'أضفت {shortcut}؟' },
  iosMessageRunPermissionCheck: {
    en: 'Run test',
    ar: 'تشغيل الاختبار',
  },
  iosMessagePermissionBody: { en: 'Run the setup check with this iPhone unlocked. Allow access to Wafra when Apple asks, then return here. The setup check tests the Shortcut; your first bank message confirms automatic delivery.', ar: 'شغّل فحص الإعداد والآيفون مفتوح. اسمح بالوصول إلى وفرة عندما تطلب Apple ذلك، ثم عد إلى هنا. يختبر فحص الإعداد الاختصار؛ وتؤكد أول رسالة بنكية وصول الرسائل تلقائياً.' },
  iosMessagePermissionLocked: { en: 'If a background run reports a permission error, open the Shortcut’s details → Privacy. Allow Wafra access and enable “Allow Running When Locked” if shown.', ar: 'إذا ظهر خطأ أذونات أثناء التشغيل في الخلفية، افتح تفاصيل الاختصار ← الخصوصية. اسمح بالوصول إلى وفرة وفعّل «السماح بالتشغيل عند القفل» إذا ظهر الخيار.' },
  iosMessageNextHistory: { en: 'Import past messages', ar: 'استيراد الرسائل السابقة' },
  iosMessageNextFuture: { en: 'Set up new alerts', ar: 'إعداد التنبيهات الجديدة' },
  iosMessageImportAgain: { en: 'Import again', ar: 'استيراد مجدداً' },
  iosMessageHistoryDone: { en: 'History imported', ar: 'تم استيراد السجل' },
  iosMessageContinue: { en: 'Finish setup', ar: 'إنهاء الإعداد' },
  iosMessageHistoryInstallHelp: { en: 'Add the Shortcut to import history.', ar: 'أضف الاختصار لاستيراد السجل.' },
  iosMessageHistoryReturnHelp: { en: 'Added {shortcut}?', ar: 'أضفت {shortcut}؟' },
  iosMessageHistoryStartHelp: { en: 'Shortcuts brings messages into Wafra in batches. Wafra processes them after transfer.', ar: 'يجلب تطبيق الاختصارات الرسائل إلى وفرة على دفعات، ثم يعالجها وفرة بعد النقل.' },
  iosMessageHistoryStartAfterAdding: { en: 'I added it · import', ar: 'أضفته · استيراد' },
  iosMessageHistoryUnavailableOnboarding: { en: 'History is optional. Continue to Wafra now and import past messages later from Settings.', ar: 'استيراد السجل اختياري. تابع إلى وفرة الآن واستورد الرسائل السابقة لاحقاً من الإعدادات.' },
  iosMessageHistoryUnavailableHelp: { en: 'You can continue to Wafra now and import past messages later from Settings.', ar: 'يمكنك متابعة استخدام وفرة الآن واستيراد الرسائل السابقة لاحقاً من الإعدادات.' },
  iosMessageSkipHistory: { en: 'Skip past messages for now', ar: 'تخطي الرسائل السابقة حالياً' },
  iosMessageSkipHistoryTitle: { en: 'Use future alerts only?', ar: 'استخدام التنبيهات الجديدة فقط؟' },
  iosMessageSkipHistoryBody: { en: 'Past messages will stay unimported. Any unfinished import will be cleared; saved entries stay. Import later from Settings. A real bank message is still separate evidence.', ar: 'ستبقى الرسائل السابقة دون استيراد. سيُزال أي استيراد غير مكتمل وتبقى العمليات المحفوظة. استورد لاحقاً من الإعدادات. تظل الرسالة البنكية الحقيقية دليلاً منفصلاً.' },
  iosMessageSkipStoppedHistoryBody: { en: 'Stop the history Shortcut first. This clears the unfinished import; saved entries stay. Past messages remain unimported. You can try again from Settings.', ar: 'أوقف اختصار السجل أولاً. سيُزال الاستيراد غير المكتمل وتبقى العمليات المحفوظة. ستبقى الرسائل السابقة دون استيراد. يمكنك المحاولة لاحقاً من الإعدادات.' },
  iosMessageFutureBeforeSkip: { en: 'Set up and confirm future alerts before skipping past messages.', ar: 'أعدّ التنبيهات الجديدة وأكّدها قبل تخطي الرسائل السابقة.' },
  iosMessageSkipHistoryChanged: { en: 'A history import has started. Stop it in Shortcuts, then try skipping again.', ar: 'بدأ استيراد السجل. أوقفه في الاختصارات، ثم حاول التخطي مجدداً.' },
  iosMessageHistoryDeferred: { en: 'Skipped for now · past messages not imported', ar: 'تم التخطي حالياً · لم تُستورد الرسائل السابقة' },
  iosMessageHistoryDeferredHelp: { en: 'Future alerts are separate from past-message coverage. Resume history here whenever you are ready.', ar: 'التنبيهات الجديدة منفصلة عن تغطية الرسائل السابقة. استأنف استيراد السجل هنا عندما تكون مستعداً.' },
  iosMessageResumeHistory: { en: 'Resume history import', ar: 'استئناف استيراد السجل' },
  iosMessageHistoryRunningHelp: { en: 'Keep the iPhone unlocked. If it stops, run it again; finished progress is kept.', ar: 'أبقِ الآيفون مفتوح القفل. إذا توقف، شغّله مرة أخرى؛ سيتم الاحتفاظ بالتقدم المكتمل.' },
  iosMessageResetHistory: { en: 'Reset import', ar: 'إعادة ضبط الاستيراد' },
  iosMessageResetHistoryTitle: { en: 'Stopped in Shortcuts?', ar: 'أوقفته في الاختصارات؟' },
  iosMessageResetHistoryBody: { en: 'Stop the Shortcut first. Reset this attempt; saved entries stay unchanged.', ar: 'أوقف الاختصار أولاً. أعد ضبط المحاولة؛ تبقى العمليات المحفوظة كما هي.' },
  iosMessageGuideImmediate: { en: 'Choose Run Immediately, turn off Notify When Run if shown, then Next', ar: 'اختر تشغيل فوراً، وأوقف الإشعار عند التشغيل إن ظهر، ثم اضغط التالي' },
  iosMessageGuideRunShortcut: { en: 'Pick {shortcut} from the list (not New Blank Automation). Tap Done if it appears.', ar: 'اختر {shortcut} من القائمة (وليس أتمتة جديدة فارغة). اضغط «تم» إن ظهر.' },
  iosMessageLearnMore: {
    en: 'How it works',
    ar: 'كيف يعمل',
  },
  iosMessageDone: { en: 'Done', ar: 'تم' },
  iosMessageStatusNotStarted: { en: 'Not started', ar: 'لم يبدأ' },
  iosMessageStatusInProgress: { en: 'In progress', ar: 'قيد الإعداد' },
  iosMessageStatusComplete: { en: 'Complete', ar: 'مكتمل' },
  iosMessageStatusSkipped: { en: 'Not finished', ar: 'غير مكتمل' },
  iosMessageFinishFailed: {
    en: 'Setup didn’t save. Try again.',
    ar: 'لم يُحفظ الإعداد. حاول مجدداً.',
  },
  iosMessageHelpLocal: { en: 'Processed on this iPhone.', ar: 'تُعالج على هذا الآيفون.' },
  iosMessageHelpReadable: { en: 'Only readable messages saved on this iPhone.', ar: 'الرسائل المحفوظة والقابلة للقراءة على هذا الآيفون فقط.' },
  iosMessageHelpCoverage: { en: 'History imports in smaller batches and can resume if interrupted.', ar: 'يُستورد السجل على دفعات أصغر ويمكن استئنافه إذا توقف.' },
  iosMessageHelpProof: { en: 'A real bank message confirms automatic capture.', ar: 'رسالة بنكية حقيقية تؤكد الالتقاط التلقائي.' },
  iosMessagePrivacyDetails: { en: 'Privacy details', ar: 'تفاصيل الخصوصية' },
  iosMessageDetailsTitle: { en: 'Setup help', ar: 'مساعدة الإعداد' },
  iosMessageSenderUnavailable: {
    en: "Leave Sender empty for alphanumeric bank SMS IDs. Use one space in Message Contains to avoid filtering by currency. Choose Run Immediately and turn off Notify When Run if shown. Wafra cannot change Apple’s notification settings.",
    ar: "اترك المرسل فارغاً لمعرّفات البنك النصية. استخدم مسافة واحدة في «تحتوي الرسالة على» لتجنب التصفية حسب العملة. اختر «تشغيل فوراً» وأوقف «الإشعار عند التشغيل» إن ظهر. لا يستطيع وفرة تغيير إعدادات إشعارات Apple.",
  },

  // Two-stage, device-local iPhone capture setup.
  iosLocalInstallShortcut: { en: 'Add Shortcut', ar: 'إضافة الاختصار' },
  iosLocalAlreadyAdded: { en: 'I added it', ar: 'أضفته' },
  iosLocalShortcutUnavailable: {
    en: 'This build can’t add the shortcut. Update Wafra.',
    ar: 'لا يمكن لهذا الإصدار إضافة الاختصار. حدّث وفرة.',
  },
  // iOS 15: no App Intents, so no automatic capture. Statements and pasted
  // messages remain available. Pasting is local; statement files use the import service.
  iosLocalUnsupported: { en: 'Automatic capture needs iOS 16 or later', ar: 'يتطلب الالتقاط التلقائي iOS 16 أو أحدث' },
  iosLocalUnsupportedBody: {
    en: importProcessingDisclosure('en', 'ios'),
    ar: importProcessingDisclosure('ar', 'ios'),
  },
  iosLocalUnsupportedStatement: { en: 'Import a statement', ar: 'استيراد كشف حساب' },
  iosLocalUnsupportedPaste: { en: 'Paste bank messages', ar: 'لصق رسائل البنك' },
  iosLocalUpdateRequired: {
    en: 'This version can’t capture messages. Update Wafra.',
    ar: 'هذا الإصدار لا يلتقط الرسائل. حدّث وفرة.',
  },
  iosLocalPrivacyBody: {
    en: 'Apple does not give Wafra access to your Messages inbox. A Message automation you create in Shortcuts passes each new Message to Wafra’s protected queue on this iPhone. Apple’s Sender picker lists Contacts only and bank SMS IDs are not Contacts, so the automation runs with an empty Sender for every new message. Wafra checks Content and Sender locally, keeps only supported structured financial results, and uploads no Message data. After a durable local result, Wafra deletes the raw Message. If processing cannot finish, raw Content and Sender stay protected for up to 30 days and are removed on the next capture or queue check.',
    ar: 'لا تمنح Apple وفرة وصولاً إلى صندوق رسائلك. تمرّر أتمتة الرسائل التي تنشئها في الاختصارات كل رسالة جديدة إلى صف وفرة المحمي على هذا الآيفون. تعرض قائمة المرسلين لدى Apple جهات الاتصال فقط ومعرّفات رسائل البنوك ليست جهات اتصال، لذلك تعمل الأتمتة بمرسل فارغ لكل رسالة جديدة. يفحص وفرة المحتوى واسم المرسل محلياً، ويحتفظ فقط بالنتائج المالية المنظمة والمدعومة، ولا يرفع بيانات الرسائل. بعد حفظ نتيجة محلية بشكل دائم، يحذف وفرة الرسالة الخام. وإذا تعذرت المعالجة، يبقى المحتوى الخام واسم المرسل محمياً لمدة تصل إلى ٣٠ يوماً ثم يُحذف عند تشغيل الالتقاط أو فحص الصف في المرة التالية.',
  },
  iosLocalMigrationBody: {
    en: 'If you still have the old “Wafra Capture” automation, it can continue uploading the bank messages you selected until you delete it or Wafra confirms retirement after the first local bank message.',
    ar: 'إذا كانت أتمتة «Wafra Capture» القديمة ما زالت موجودة، فقد تستمر في رفع رسائل البنوك التي اخترتها إلى أن تحذفها أو تؤكد وفرة إيقافها بعد أول رسالة بنكية محلية.',
  },
  iosMessageContinueManual: {
    en: 'Skip for now',
    ar: 'تخطَّ حالياً',
  },
  iosLocalOpenAutomation: { en: 'Open Shortcuts', ar: 'فتح الاختصارات' },
  iosLocalAutomationAdded: {
    en: 'I turned it on',
    ar: 'فعّلتها',
  },
  iosLocalWaitingTitle: { en: 'Waiting for first alert', ar: 'بانتظار أول تنبيه' },
  iosLocalWaitingBody: { en: 'A real bank message confirms the automation.', ar: 'رسالة بنكية حقيقية تؤكد عمل الأتمتة.' },
  iosLocalFirstAlertCaptured: { en: 'First alert received', ar: 'وصل أول تنبيه' },
  iosLocalFirstAlertBody: {
    en: 'Wafra durably processed the first qualifying alert on this iPhone. It may have been filed, reviewed, reconciled, or recognized as an existing entry.',
    ar: 'عالجت وفرة أول تنبيه مؤهل بشكل دائم على هذا الآيفون. ربما سُجّل أو أُرسل للمراجعة أو استُخدم للمطابقة أو تم التعرّف عليه كعملية موجودة.',
  },
  iosLocalShortcutInstallFailed: {
    en: 'Shortcuts didn’t open. Tap Add Shortcut to try again.',
    ar: 'لم تُفتح الاختصارات. اضغط «إضافة الاختصار» للمحاولة مجدداً.',
  },
  iosLocalShortcutRunFailed: {
    en: 'The test didn’t finish. Unlock your iPhone, then tap Run test.',
    ar: 'لم يكتمل الاختبار. افتح قفل الآيفون، ثم اضغط «تشغيل الاختبار».',
  },

  /** Retained for old screen snapshots; current setup uses iosLocalPrivacyBody. */

  iosBanksTitle: { en: 'Which banks text you?', ar: 'أي البنوك تراسلك؟' },
  accountSetBank: { en: 'Set bank', ar: 'تحديد البنك' },
  accountNoBank: { en: 'No bank', ar: 'بدون بنك' },
  accountBankQuestion: { en: 'Which bank is this account with?', ar: 'مع أي بنك هذا الحساب؟' },

  iosCopy: { en: 'COPY', ar: 'نسخ' },
  iosOpenShortcutsApp: { en: 'Open Shortcuts', ar: 'افتح تطبيق الاختصارات' },

  iosShortcutsMissing: {
    en: 'Apple Shortcuts isn’t installed. Install it, then try again.',
    ar: 'تطبيق «الاختصارات» من Apple غير مثبّت. ثبّته ثم حاول مجدداً.',
  },
  iosInstallShortcuts: {
    en: 'Install Apple Shortcuts',
    ar: 'ثبّت «الاختصارات» من Apple',
  },

  iosAutomationInput: {
    en: '5. Input: Received Message (not only Content)',
    ar: '٥. الإدخال: «الرسالة المستلمة» (وليس «المحتوى» فقط)',
  },

  iosTestLimit: {
    en: 'The Shortcut and private sync work. Create the Message automation next. The first supported bank message is the final check: it should appear under the correct bank or card.',
    ar: 'يعمل الاختصار والمزامنة الخاصة. أنشئ أتمتة «الرسالة» تالياً. الرسالة البنكية المدعومة الأولى هي الاختبار الأخير: يجب أن تظهر تحت البنك أو البطاقة الصحيحة.',
  },
  iosDone: { en: 'Done', ar: 'تم' },


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
  editEntry: { en: 'Edit transaction', ar: 'تعديل العملية' },
  entryDetail: { en: 'Transaction details', ar: 'تفاصيل العملية' },
  saveChanges: { en: 'Save changes', ar: 'حفظ التغييرات' },
  transfersNoCategory: {
    en: 'Transfers have no category — this moves money between your own accounts rather than spending it.',
    ar: 'لا تصنيف للتحويلات — فهي تنقل المال بين حساباتك بدلاً من إنفاقه.',
  },

  newTransaction: { en: 'New transaction', ar: 'عملية جديدة' },
  saveTransaction: { en: 'Save transaction', ar: 'حفظ العملية' },
  amountInLedgerCurrency: { en: 'Amount in your ledger currency', ar: 'المبلغ بعملة سجلك' },
  descriptionOptional: { en: 'Description (optional)', ar: 'الوصف (اختياري)' },
  descriptionOptionalA11y: { en: 'Description, optional', ar: 'الوصف، اختياري' },
  twoDaysAgo: { en: '2 days ago', ar: 'قبل يومين' },
  threeDaysAgo: { en: '3 days ago', ar: 'قبل ٣ أيام' },
  expenseExample: { en: 'e.g. Carrefour weekly shop', ar: 'مثال: مشتريات كارفور الأسبوعية' },
  incomeExample: { en: 'e.g. July salary', ar: 'مثال: راتب يوليو' },

  reportingPeriodTitle: { en: 'Reporting period', ar: 'فترة التقرير' },
  periodPreviousYear: { en: 'Previous year, {year}', ar: 'السنة السابقة، {year}' },
  periodNextYear: { en: 'Next year, {year}', ar: 'السنة التالية، {year}' },
  lastSevenDays: { en: 'Last 7 days', ar: 'آخر ٧ أيام' },
  lastThirtyDays: { en: 'Last 30 days', ar: 'آخر ٣٠ يوماً' },
  lastNinetyDays: { en: 'Last 90 days', ar: 'آخر ٩٠ يوماً' },
  thisYear: { en: 'This year', ar: 'هذا العام' },
  allTimeTitle: { en: 'All time', ar: 'كل الفترات' },
  customRange: { en: 'Custom range', ar: 'نطاق مخصص' },
  fromDate: { en: 'From date', ar: 'تاريخ البداية' },
  toDate: { en: 'To date', ar: 'تاريخ النهاية' },
  fromDatePlaceholder: { en: 'YYYY-MM-DD', ar: 'YYYY-MM-DD' },
  toDatePlaceholder: { en: 'YYYY-MM-DD', ar: 'YYYY-MM-DD' },
  applyRange: { en: 'Apply range', ar: 'تطبيق النطاق' },

  unlockWafra: { en: 'Unlock Wafra', ar: 'فتح وفرة' },
  phoneHasNoLock: { en: 'This phone has no screen lock', ar: 'لا يوجد قفل شاشة لهذا الهاتف' },
  setPhoneLockBody: {
    en: 'Set up a fingerprint, face unlock, or a PIN and Wafra can use it.',
    ar: 'أعدّ بصمة أو تعرّفاً على الوجه أو رمز PIN ليتمكن وفرة من استخدامه.',
  },

  newLimitTitle: { en: 'New limit', ar: 'حد جديد' },
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
    en: 'Set the credit limit for {name}.',
    ar: 'حدّد الحد الائتماني لـ {name}.',
  },
  recurringEstimatedCharge: { en: 'Estimated charge', ar: 'مبلغ متوقع' },
  recurringLastCharge: { en: 'Last charge', ar: 'آخر خصم' },
  homeUpcomingPayments: { en: 'Upcoming payments', ar: 'الدفعات القادمة' },
  homeDuePayments: { en: 'Due & overdue', ar: 'المستحق والمتأخر' },

  importOneMoment: { en: 'One moment', ar: 'لحظة واحدة' },
  inboxAlreadyFiled: { en: 'No new supported transactions.', ar: 'لا توجد معاملات جديدة مدعومة.' },
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
    en: 'SMS access is optional and used only for on-device bank-message import. Anything that is not supported financial activity is discarded before storage. You can keep access off and paste messages manually below.',
    ar: 'إذن الرسائل اختياري ويُستخدم فقط لاستيراد رسائل البنك على الجهاز. يُتخلص من أي محتوى لا يمثل نشاطاً مالياً مدعوماً قبل الحفظ. يمكنك إبقاء الإذن مغلقاً ولصق الرسائل يدوياً أدناه.',
  },
  matchedLabel: { en: 'Matched', ar: 'مطابقة' },
  unreadLabel: { en: 'Unread', ar: 'غير مقروءة' },
  newCard: { en: 'New card', ar: 'بطاقة جديدة' },
  tracked: { en: 'Tracked', ar: 'قيد المتابعة' },
  track: { en: 'Track', ar: 'متابعة' },
  dueDay: { en: 'due day {day}', ar: 'مستحق يوم {day}' },
  justFiled: { en: 'Just filed', ar: 'سُجّلت الآن' },
  fileEntries: { en: 'File {count} entr{ending}', ar: 'تسجيل {count} عملية' },
  fileCardDues: { en: 'File {count} card due{s}', ar: 'تسجيل {count} مستحق بطاقة' },
  fixEntries: { en: 'Fix {count} entr{ending}', ar: 'تصحيح {count} عملية' },

  noEntriesInMonth: { en: 'No entries in {month} yet', ar: 'لا عمليات في {month} بعد' },
  readInbox: { en: 'Read inbox', ar: 'قراءة الرسائل' },
  checkBankAlerts: { en: 'Check alerts', ar: 'تحقق من التنبيهات' },
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
  longPressInactive: { en: 'Long-press to unhide or delete', ar: 'اضغط مطولاً للإظهار أو الحذف' },
  setSavingsGoal: { en: 'Set a savings goal', ar: 'ضع هدفاً للادخار' },
  savingsGoalHint: {
    en: 'Umrah, a car, a rainy-day fund — track it here.',
    ar: 'عمرة أو سيارة أو صندوق للطوارئ — تابع هدفك هنا.',
  },
  newAccount: { en: 'New account', ar: 'حساب جديد' },
  accountNameLabel: { en: 'Account name', ar: 'اسم الحساب' },
  accountColorLabel: { en: 'Account color', ar: 'لون الحساب' },
  accountNamePlaceholder: { en: 'Account name (e.g. ADCB Savings)', ar: 'اسم الحساب (مثال: حساب ادخار ADCB)' },
  openingBalanceOptional: { en: 'Opening balance (optional)', ar: 'الرصيد الافتتاحي (اختياري)' },
  addAccount: { en: 'Add account', ar: 'إضافة حساب' },
  newGoalTitle: { en: 'New goal', ar: 'هدف جديد' },
  goalNameLabel: { en: 'Goal name', ar: 'اسم الهدف' },
  goalIconLabel: { en: 'Goal icon', ar: 'رمز الهدف' },
  goalPlaceholder: { en: 'Goal (e.g. Umrah trip, new car)', ar: 'الهدف (مثال: رحلة عمرة أو سيارة جديدة)' },
  targetAmount: { en: 'Target amount', ar: 'المبلغ المستهدف' },
  createGoal: { en: 'Create goal', ar: 'إنشاء الهدف' },
  deleteGoalTitle: { en: 'Delete goal?', ar: 'حذف الهدف؟' },
  walletSince: { en: 'since {date}', ar: 'منذ {date}' },
  removeAccountTitle: { en: 'Remove account?', ar: 'إزالة الحساب؟' },
  removeAccountBody: {
    en: '“{name}” and all its transactions will be deleted. This cannot be undone.',
    ar: 'سيُحذف «{name}» وجميع عملياته. لا يمكن التراجع عن ذلك.',
  },
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
  unreadMessageHint: {
    en: 'Send them over and they get recognised next release. Digits are masked.',
    ar: 'أرسلها لتصبح معروفة في الإصدار القادم. الأرقام مخفية.',
  },
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

  // Feedback. The register here is the same as the privacy section's: say what
  // leaves the phone, say it before it leaves, and never describe the feature
  // in terms of what it is FOR ("help us improve") when it can be described in
  // terms of what it DOES.
  sendFeedback: { en: 'Send feedback', ar: 'إرسال ملاحظة' },
  sendFeedbackDetail: {
    en: 'Send a note or improve the bank parser',
    ar: 'أرسل ملاحظة أو ساعد في تحسين محلّل البنك',
  },
  parserResearchTitle: { en: 'Parser samples', ar: 'عينات المحلّل' },
  parserResearchUnavailable: {
    en: 'This tester tool is not included in this build.',
    ar: 'أداة الاختبار هذه غير مضمّنة في هذه النسخة.',
  },
  parserResearchAndroidIntro: {
    en: 'Wafra checks the full Android inbox in memory, keeps likely financial alerts, and prepares redacted templates for messages it parsed and messages it could not parse.',
    ar: 'يفحص وفرة صندوق رسائل أندرويد كاملاً في الذاكرة، ويحتفظ بالتنبيهات المالية المحتملة، ثم يجهّز قوالب منقّحة للرسائل التي حلّلها والتي تعذّر عليه تحليلها.',
  },
  parserResearchIosIntro: {
    en: 'iPhone does not let Wafra read Messages. Copy bank messages with Apple Shortcuts, paste them here, then Wafra will filter and redact them on this phone.',
    ar: 'لا يسمح الآيفون لوفرة بقراءة الرسائل. انسخ رسائل البنك عبر اختصارات Apple والصقها هنا، ثم يرشّحها وفرة وينقّحها على هذا الهاتف.',
  },
  parserResearchPasteIntro: {
    en: 'This tester build cannot scan the inbox automatically. Paste bank messages here, then Wafra will filter and redact them on this device.',
    ar: 'لا تستطيع نسخة الاختبار هذه فحص صندوق الرسائل تلقائياً. ألصق رسائل البنك هنا، ثم يرشّحها وفرة وينقّحها على هذا الجهاز.',
  },
  parserResearchPrivacy: {
    en: 'Raw messages never upload. Every digit and timestamp is removed. Recipient and merchant spans, plus every word outside a strict financial grammar, become [text]. Only the redacted report can be copied or exported.',
    ar: 'لا تُرفع الرسائل الخام. تُحذف كل الأرقام والتوقيتات، وتُستبدل مواضع المستفيدين والمتاجر وكل كلمة خارج قواعد مالية محدودة بـ [text]. ولا يمكن نسخ أو تصدير سوى التقرير المنقّح.',
  },
  parserResearchPasteHeader: { en: 'PASTE BANK MESSAGES', ar: 'ألصق رسائل البنك' },
  parserResearchPasteHelp: {
    en: 'Put a blank line between messages. You may add “From: ADIB” as the first line of a message; unknown senders become aliases.',
    ar: 'ضع سطراً فارغاً بين الرسائل. يمكنك إضافة «From: ADIB» في أول سطر؛ ويستبدل وفرة المرسلين غير المعروفين بأسماء مستعارة.',
  },
  parserResearchPasteA11y: { en: 'Paste bank messages', ar: 'ألصق رسائل البنك' },
  parserResearchPastePlaceholder: {
    en: 'From: YOUR BANK\nYour card purchase alert…\n\nFrom: YOUR BANK\nYour transfer alert…',
    ar: 'From: YOUR BANK\nرسالة شراء بالبطاقة…\n\nFrom: YOUR BANK\nرسالة تحويل…',
  },
  parserResearchPrivateBlocked: {
    en: 'Private Mode is local-only. Turn it off before preparing or exporting parser samples.',
    ar: 'الوضع الخاص محلي فقط. أوقفه قبل تجهيز عينات المحلّل أو تصديرها.',
  },
  parserResearchPasteRequiredTitle: { en: 'Paste an alert first', ar: 'ألصق تنبيهاً أولاً' },
  parserResearchPasteRequired: {
    en: 'Paste at least one bank message above, then prepare the safe report.',
    ar: 'ألصق تنبيهاً بنكياً واحداً على الأقل أعلاه، ثم جهّز التقرير الآمن.',
  },
  parserResearchPrepareInbox: { en: 'Prepare safe inbox report', ar: 'تجهيز تقرير آمن من الرسائل' },
  parserResearchPreparePaste: { en: 'Prepare safe report', ar: 'تجهيز تقرير آمن' },
  parserResearchReading: { en: 'Reading {count} messages…', ar: 'جارٍ قراءة {count} رسالة…' },
  parserResearchPreparing: {
    en: 'Checking {count} of {total} messages…',
    ar: 'جارٍ فحص {count} من {total} رسالة…',
  },
  parserResearchFinalizing: {
    en: 'Finalizing safe report…',
    ar: 'جارٍ إنهاء التقرير الآمن…',
  },
  parserResearchPreviewNote: {
    en: 'The exact local JSON report is shown below in pages. Wafra uploads nothing. Copy it into Codex, or save the file and attach it yourself.',
    ar: 'يظهر تقرير JSON المحلي نفسه أدناه على صفحات. لا يرفع وفرة شيئاً. انسخه إلى Codex، أو احفظ الملف وأرفقه بنفسك.',
  },
  parserResearchReadySummary: {
    en: 'Checked {checked} inbox messages · {unparsed} unparsed formats · {parsed} parsed formats with assigned categories.',
    ar: 'تم فحص {checked} رسالة · {unparsed} قوالب غير محلّلة · {parsed} قوالب محلّلة مع التصنيفات المعيّنة.',
  },
  parserResearchPreviewPrevious: { en: 'Previous', ar: 'السابق' },
  parserResearchPreviewNext: { en: 'Next', ar: 'التالي' },
  parserResearchPreviewPage: {
    en: 'Page {current} of {total}',
    ar: 'الصفحة {current} من {total}',
  },
  parserResearchCopy: { en: 'Copy AI report', ar: 'نسخ تقرير الذكاء الاصطناعي' },
  parserResearchCopying: { en: 'Copying safe report…', ar: 'جارٍ نسخ التقرير الآمن…' },
  parserResearchCopiedTitle: { en: 'Safe report copied', ar: 'تم نسخ التقرير الآمن' },
  parserResearchCopiedBody: {
    en: 'Paste it into a Codex task for parser review. No raw messages were copied or uploaded.',
    ar: 'ألصقه في مهمة Codex لمراجعة المحلّل. لم تُنسخ أو تُرفع أي رسائل خام.',
  },
  parserResearchCopyFailedTitle: { en: 'Could not copy the report', ar: 'تعذّر نسخ التقرير' },
  parserResearchCopyFailedBody: {
    en: 'Nothing was uploaded. Save the JSON file instead, then attach it to Codex.',
    ar: 'لم يُرفع شيء. احفظ ملف JSON بدلاً من ذلك، ثم أرفقه في Codex.',
  },
  parserResearchCopyTooLargeTitle: { en: 'Report is too large to copy', ar: 'التقرير كبير جداً للنسخ' },
  parserResearchCopyTooLargeBody: {
    en: 'Use Export safe report instead. It saves the complete JSON without sending a large clipboard payload to Android.',
    ar: 'استخدم «تصدير التقرير الآمن» بدلاً من ذلك. فهو يحفظ ملف JSON كاملاً دون إرسال نص كبير إلى حافظة أندرويد.',
  },
  parserResearchExport: { en: 'Export safe report', ar: 'تصدير التقرير الآمن' },
  parserResearchExporting: { en: 'Opening share sheet…', ar: 'جارٍ فتح قائمة المشاركة…' },
  parserResearchExportHelp: {
    en: 'Save the JSON file, then attach it to Codex manually. Wafra does not choose or contact a recipient.',
    ar: 'احفظ ملف JSON ثم أرفقه يدوياً في Codex. لا يختار وفرة مستلماً ولا يتواصل مع أي جهة.',
  },
  parserResearchExportFailedTitle: { en: 'Could not export the file', ar: 'تعذّر تصدير الملف' },
  parserResearchExportFailedBody: {
    en: 'Nothing was uploaded. Try again, or check that this device can save and share files.',
    ar: 'لم يُرفع شيء. حاول مرة أخرى، أو تحقق من أن هذا الجهاز يستطيع حفظ الملفات ومشاركتها.',
  },
  parserResearchNoneTitle: { en: 'No safe samples found', ar: 'لم تُوجد عينات آمنة' },
  parserResearchNoneBody: {
    en: 'Wafra excluded OTPs, security messages and anything that did not look like posted financial activity. Nothing was prepared or uploaded.',
    ar: 'استبعد وفرة رموز التحقق ورسائل الأمان وكل ما لم يبدُ نشاطاً مالياً منفذاً. لم يُجهّز أو يُرفع شيء.',
  },
  parserResearchFailedTitle: { en: 'Could not prepare samples', ar: 'تعذّر تجهيز العينات' },
  parserResearchFailedBody: {
    en: 'Nothing was uploaded. Keep Wafra open and try again.',
    ar: 'لم يُرفع شيء. أبقِ وفرة مفتوحاً وحاول مرة أخرى.',
  },
  settingsStatusHeader: { en: 'Current state', ar: 'الحالة الحالية' },
  settingsImportsHeader: { en: 'Capture', ar: 'الالتقاط' },
  settingsNotificationsHeader: { en: 'Notifications', ar: 'الإشعارات' },
  insightsTitle: { en: 'Insight', ar: 'معلومة' },
  homeWidgetAssistantTitle: { en: 'Ask Wafra', ar: 'اسأل وفرة' },
  homeWidgetAssistantDetail: { en: 'Questions and quick financial analysis.', ar: 'أسئلة وتحليل مالي سريع.' },
  homeWidgetInsightTitle: { en: 'Insight', ar: 'معلومة' },
  homeWidgetDueTitle: { en: 'Due payments', ar: 'الدفعات المستحقة' },
  homeCustomizeTitle: { en: 'Customize Home', ar: 'تخصيص الرئيسية' },
  homeCustomizeDetail: { en: 'Choose and reorder Home sections', ar: 'اختر أقسام الرئيسية ورتّبها' },
  moveUp: { en: 'Move up', ar: 'نقل للأعلى' },
  moveDown: { en: 'Move down', ar: 'نقل للأسفل' },
  settingsPreferencesHeader: { en: 'Appearance', ar: 'المظهر' },
  settingsDangerHeader: { en: 'Danger zone', ar: 'منطقة الخطر' },
  supportWebsite: { en: 'Support', ar: 'الدعم' },
  publicLinkUnavailable: { en: 'Unavailable in this build', ar: 'غير متاح في هذا الإصدار' },
  settingStatusChecking: { en: 'Checking', ar: 'جارٍ التحقق' },
  settingStatusYes: { en: 'yes', ar: 'نعم' },
  settingStatusNo: { en: 'no', ar: 'لا' },
  feedbackParserTitle: { en: 'Improve the bank parser', ar: 'تحسين محلّل البنك' },
  feedbackParserDetail: {
    en: 'Prepare a redacted JSON file, then attach it to Codex yourself.',
    ar: 'جهّز ملف JSON منقّحاً، ثم أرفقه بنفسك في Codex.',
  },
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
  feedbackAttachRow: { en: 'Attached', ar: 'المرفق' },
  feedbackDetailFigures: { en: 'And the amounts behind your totals', ar: 'والمبالغ خلف مجاميعك' },
  feedbackPreviewHeader: { en: 'EXACTLY WHAT WILL BE SENT', ar: 'ما سيُرسل بالضبط' },
  // The preview carries more than the message: the chosen type and the build
  // lines (app version, platform, language, market and currency) travel too.
  feedbackPreviewNote: {
    en: 'This is everything sent to Wafra maintainers: your message, the type you picked, and the app version, platform, language, market and currency shown here. No ledger, bank message, amount, account, or merchant is attached.',
    ar: 'هذا كل ما يُرسل إلى مشرفي وفرة: رسالتك والنوع الذي اخترته وإصدار التطبيق والمنصة واللغة والسوق والعملة الظاهرة هنا. لا يُرفق سجل أو رسالة بنكية أو مبلغ أو حساب أو متجر.',
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
    en: 'This build has no direct feedback connection, so nothing was uploaded. Install a newer Wafra test build.',
    ar: 'لا تتضمن هذه النسخة اتصالاً مباشراً للملاحظات، لذا لم يُرفع شيء. ثبّت نسخة اختبار أحدث من وفرة.',
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
    en: 'The report did not leave the phone. Your text is still here; try again later.',
    ar: 'لم يغادر التقرير الهاتف. ما كتبته ما زال هنا؛ حاول مجدداً لاحقاً.',
  },
  /**
   * Not "try again later": this build shipped without a relay address
   * compiled into it, so it cannot send now and will not be able to send in
   * an hour. The only thing that fixes it is a newer build.
   */
  feedbackNoRelayBody: {
    en: 'This build has no server address, so waiting will not help. Install a newer Wafra test build to send directly.',
    ar: 'لا يحتوي هذا الإصدار على عنوان الخادم، لذا لن يفيد الانتظار. ثبّت نسخة اختبار أحدث من وفرة للإرسال المباشر.',
  },
  feedbackOfflineTitle: { en: 'Delivery unconfirmed', ar: 'لم يتأكد وصول التقرير' },
  feedbackOfflineBody: {
    en: 'Wafra could not confirm that the server received your report. Check your connection and try again.',
    ar: 'تعذّر على وفرة تأكيد استلام الخادم لتقريرك. تحقق من الاتصال وحاول مرة أخرى.',
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
  // Income minus spending, stated as such: no cheer, and no claim that the
  // difference was saved anywhere. Mirrors the overspend lines below.
  insightSavingRate: {
    en: '{percent}% of income not spent',
    ar: 'لم يُنفق \u2066{percent}٪\u2069 من الدخل',
  },
  insightSavingBodyLive: { en: 'Income is {amount} above expenses so far this month.', ar: 'يزيد الدخل على المصروفات بمقدار {amount} حتى الآن هذا الشهر.' },
  insightSavingBodyPeriod: { en: 'Income is {amount} above expenses in this period.', ar: 'يزيد الدخل على المصروفات بمقدار {amount} في هذه الفترة.' },
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
  notFoundTitle: { en: 'That page is not here.', ar: 'هذه الصفحة غير موجودة.' },
  notFoundBody: {
    en: 'The link may be old. Your ledger is fine.',
    ar: 'ربما الرابط قديم. سجلّك سليم.',
  },

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
  titleCreditReversal: { en: 'Credit reversal', ar: 'عكس قيد دائن' },
  titleInvoicePayment: { en: 'Invoice payment', ar: 'سداد فاتورة' },
  titleInwardRemittance: { en: 'Inward remittance', ar: 'حوالة واردة' },
  titleOutwardRemittance: { en: 'Outward remittance', ar: 'حوالة صادرة' },
  titleTelegraphicTransfer: { en: 'Telegraphic transfer', ar: 'حوالة برقية' },
  titleBankTransfer: { en: 'Bank transfer', ar: 'تحويل بنكي' },
  titleOwnAccountTransfer: { en: 'Own account transfer', ar: 'تحويل بين حساباتك' },
  titleSavingsTransfer: { en: 'Savings transfer', ar: 'تحويل إلى الادخار' },
  titleCardPayment: { en: 'Card payment', ar: 'دفعة بطاقة' },
  titlePayment: { en: 'Payment', ar: 'دفعة' },
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
  'Own account transfer': 'titleOwnAccountTransfer',
  'Savings transfer': 'titleSavingsTransfer',
  'Card payment': 'titleCardPayment',
  Payment: 'titlePayment',
  'Account debit': 'titleAccountDebit',
  'Mobile recharge': 'titleMobileRecharge',
  'Card statement': 'titleCardStatement',
  'Bill payment': 'titleBillPayment',
  'Credit reversal': 'titleCreditReversal',
  'Invoice payment': 'titleInvoicePayment',
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
