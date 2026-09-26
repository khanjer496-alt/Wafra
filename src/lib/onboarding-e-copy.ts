/**
 * Words for the design-language-E first run ("Your pattern"). English and
 * Arabic carry identical keys (onboarding-e-copy.test.cjs); counts are
 * functions so Arabic gets its singular, dual and plural forms.
 *
 * Truth rules this copy is held to:
 * - Reminders name only what Wafra actually sends: bills the day before and
 *   on the day, subscription renewals the day before, card statements three
 *   days before and on the day, and the daily summary at 21:00
 *   (notifications.ts SUMMARY_HOUR). There is no monthly recap notification.
 * - The trial is Wafra's own TRIAL_DAYS from first launch: no card, and when
 *   it ends automatic capture pauses, nothing is charged and the ledger stays.
 *   Wafra sends no trial-ending reminder, so nothing here promises one.
 * - The Watch step's "usual" is the Limit sheet's month average, which it
 *   shows once a month of spending is in the ledger.
 * - Nothing names a bank or claims which banks Wafra can read.
 */
import { arabicCount } from '@/lib/settings-copy';
import type { HomeWidgetId } from '@/lib/home-widget-preferences';
import type { GoalId } from '@/lib/types';

type Lang = 'en' | 'ar';

/** Home's own greeting (journal-home-screen): morning before noon, then afternoon/evening. */
function greetingEn(hour: number): string {
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}
function greetingAr(hour: number): string {
  return hour < 12 ? 'صباح الخير' : 'مساء الخير';
}

const en = {
  // Shared chrome
  stepOf: (step: number, total: number) => `Step ${step} of ${total}`,
  continue: 'Continue',
  notNow: 'Not now',
  // 1 · Welcome
  welcomeHeadline: 'Money, made yours.',
  welcomeBody: 'A few questions. Every answer shapes your Wafra, and your pattern.',
  exampleLabel: 'An example pattern',
  /** The example pattern's initial: a letter, not anyone's name. */
  exampleInitial: 'W',
  getStarted: 'Get started',
  restoreBackup: 'Restore from a backup',
  // 2 · Name
  nameTitle: 'First, what’s your name?',
  namePlaceholder: 'Your name',
  firstTile: 'Your first tile.',
  homeGreets: 'Home will greet you:',
  greeting: (hour: number, name: string | null) => name ? `${greetingEn(hour)}, ${name}` : greetingEn(hour),
  countryLabel: 'Country',
  currencyLabel: 'Currency',
  change: 'Change',
  notSet: 'Not set',
  countryChange: (value: string) => `Country, ${value}. Change`,
  currencyChange: (value: string) => `Currency, ${value}. Change`,
  // 3 · Goals
  goalsTitle: 'What should Wafra do?',
  goals: {
    salary: 'See where my salary goes',
    bills: 'Never miss a bill',
    subscriptions: 'Catch forgotten subscriptions',
    'spend-less': 'Spend less on something',
    'cash-cards': 'Keep cash and cards together',
  } satisfies Record<GoalId, string>,
  goalsHintNone: 'Pick any that fit. They set the order of your Home.',
  goalsHint: {
    due: 'Due payments go to the top of your Home.',
    upcoming: 'Upcoming payments go to the top of your Home.',
    insight: 'Your spending insight goes to the top of your Home.',
    activity: 'Your latest activity goes to the top of your Home.',
    assistant: 'Ask Wafra goes to the top of your Home.',
  } satisfies Record<HomeWidgetId, string>,
  // 4 · Watch
  watchTitle: 'Anything to keep an eye on?',
  watchBody: 'Pick a category, then turn the dial to a monthly limit.',
  watchUsual: 'Rough is fine. After a month, Wafra shows your usual next to it.',
  watchSetLimit: 'Turn the dial to set a limit',
  watchNoCurrency: 'Choose your currency to set a limit.',
  watchLimitSummary: (category: string, amount: string) => `${category} · ${amount}`,
  watchEditing: (category: string) => `Setting ${category}`,
  // 5 · Reminders
  remindersTitle: 'When should we nudge you?',
  remindersBody: 'Wafra reminds you before money leaves. You can change this in Settings.',
  remindBillsTitle: 'Bills and renewals',
  remindBillsWhen: 'The day before a bill or renewal, and on a bill’s due day',
  remindCardsTitle: 'Card payments',
  remindCardsWhen: 'Three days before the due date, and on the day',
  remindIncluded: 'With notifications on',
  remindDailyTitle: 'Daily summary',
  remindDailyWhen: 'What you spent today, at 9 pm',
  allowNotifications: 'Allow notifications',
  // 6 · First payment
  captureTitle: 'Your first payment',
  captureBodyAndroid: 'Let Wafra read your bank’s alerts on this phone, and each payment adds itself.',
  captureBodyWeb: 'Add entries yourself here. Automatic capture needs the Android or iPhone app.',
  waitingTitle: 'Waiting for your first bank alert',
  waitingBody: 'New bank alerts appear here as they arrive.',
  workingTitle: (name: string | null) => name ? `${name}, it’s working.` : 'It’s working.',
  addedByItself: 'Added by itself, from your bank’s alert.',
  ofLimit: (spent: string, limit: string) => `${spent} of ${limit}`,
  importStatements: 'Import statements',
  importStatementsBody: 'PDF or CSV from your bank, for the months before today',
  addByHand: 'I’ll add by hand',
  addByHandBody: 'No message access. You can turn capture on later.',
  manualTitle: 'You’ll add by hand.',
  // 7 · Pattern
  patternTitle: (name: string | null) => name ? `This is ${name}’s Wafra.` : 'This is your Wafra.',
  legendYou: 'You',
  legendGoals: 'Your goals',
  legendWatch: 'What you watch',
  legendRemind: 'Your reminders',
  patternNote: 'No two are the same. It sits at the top of your Home.',
  oneLastThing: 'One last thing',
  openWafra: 'Open Wafra',
  // 8 · Paywall
  paywallTitle: 'Keep it running on its own.',
  paywallBody: (category: string | null, reminders: boolean) => {
    const what = category && reminders ? `Your ${category} limit and your reminders only stay true`
      : category ? `Your ${category} limit only stays true`
        : reminders ? 'Your reminders only stay true'
          : 'Wafra only stays complete';
    return `${what} if every bank alert arrives. Pro adds each one by itself.`;
  },
  trialToday: 'Today',
  trialTodayBody: 'Automatic capture is on. No card needed.',
  trialEnd: (days: number) => days === 1 ? 'Within a day' : `In ${days} days`,
  trialEndBody: 'Automatic capture pauses. Nothing is charged, and your ledger stays.',
  continuePro: 'Continue with Pro',
  planYearly: 'Yearly',
  planMonthly: 'Monthly',
  startFree: (days: number) => days === 1 ? 'Start the free day' : `Start the free ${days} days`,
  continueFree: 'Continue without Pro',
  trialTimelineLabel: 'What happens during the free days',
};

type OnboardingECopy = typeof en;

const ar: OnboardingECopy = {
  stepOf: (step: number, total: number) => `الخطوة ${step} من ${total}`,
  continue: 'متابعة',
  notNow: 'ليس الآن',
  welcomeHeadline: 'مالك، على طريقتك.',
  welcomeBody: 'بضعة أسئلة. كل إجابة تشكّل وفرتك ونمطك.',
  exampleLabel: 'مثال على نمط',
  exampleInitial: 'و',
  getStarted: 'ابدأ',
  restoreBackup: 'الاستعادة من نسخة احتياطية',
  nameTitle: 'أولاً، ما اسمك؟',
  namePlaceholder: 'اسمك',
  firstTile: 'أول مربّع لك.',
  homeGreets: 'ستحيّيك الصفحة الرئيسية:',
  greeting: (hour: number, name: string | null) => name ? `${greetingAr(hour)}، ${name}` : greetingAr(hour),
  countryLabel: 'الدولة',
  currencyLabel: 'العملة',
  change: 'تغيير',
  notSet: 'غير محددة',
  countryChange: (value: string) => `الدولة، ${value}. تغيير`,
  currencyChange: (value: string) => `العملة، ${value}. تغيير`,
  goalsTitle: 'ماذا تريد من وفرة؟',
  goals: {
    salary: 'أن أرى أين يذهب راتبي',
    bills: 'ألا تفوتني أي فاتورة',
    subscriptions: 'أن أكتشف الاشتراكات المنسية',
    'spend-less': 'أن أنفق أقل على شيء ما',
    'cash-cards': 'النقد والبطاقات في مكان واحد',
  },
  goalsHintNone: 'اختر ما يناسبك. سترتّب صفحتك الرئيسية على أساسه.',
  goalsHint: {
    due: 'تظهر الدفعات المستحقة أعلى صفحتك الرئيسية.',
    upcoming: 'تظهر الدفعات القادمة أعلى صفحتك الرئيسية.',
    insight: 'تظهر ملاحظة إنفاقك أعلى صفحتك الرئيسية.',
    activity: 'تظهر أحدث عملياتك أعلى صفحتك الرئيسية.',
    assistant: 'يظهر «اسأل وفرة» أعلى صفحتك الرئيسية.',
  },
  watchTitle: 'هل هناك ما تريد مراقبته؟',
  watchBody: 'اختر فئة، ثم أدر القرص لتحديد حد شهري.',
  watchUsual: 'التقدير التقريبي يكفي. بعد شهر، يعرض وفرة معدلك المعتاد بجانبه.',
  watchSetLimit: 'أدر القرص لتحديد الحد',
  watchNoCurrency: 'اختر عملتك لتحديد حد.',
  watchLimitSummary: (category: string, amount: string) => `${category} · ${amount}`,
  watchEditing: (category: string) => `تحديد حد ${category}`,
  remindersTitle: 'متى نذكّرك؟',
  remindersBody: 'يذكّرك وفرة قبل أن يخرج المال. يمكنك تغيير ذلك من الإعدادات.',
  remindBillsTitle: 'الفواتير والتجديدات',
  remindBillsWhen: 'قبل الفاتورة أو التجديد بيوم، وفي يوم استحقاق الفاتورة',
  remindCardsTitle: 'دفعات البطاقات',
  remindCardsWhen: 'قبل موعد الاستحقاق بثلاثة أيام، وفي يومه',
  remindIncluded: 'مع تفعيل الإشعارات',
  remindDailyTitle: 'الملخص اليومي',
  remindDailyWhen: 'ما أنفقته اليوم، الساعة ٩ مساءً',
  allowNotifications: 'السماح بالإشعارات',
  captureTitle: 'أول دفعة لك',
  captureBodyAndroid: 'اسمح لوفرة بقراءة تنبيهات بنكك على هذا الهاتف، وستُضاف كل دفعة تلقائياً.',
  captureBodyWeb: 'أضف العمليات بنفسك هنا. يتطلب الالتقاط التلقائي تطبيق أندرويد أو آيفون.',
  waitingTitle: 'بانتظار أول تنبيه من بنكك',
  waitingBody: 'تظهر تنبيهات البنك الجديدة هنا فور وصولها.',
  workingTitle: (name: string | null) => name ? `${name}، كل شيء يعمل.` : 'كل شيء يعمل.',
  addedByItself: 'أُضيفت تلقائياً من تنبيه بنكك.',
  ofLimit: (spent: string, limit: string) => `${spent} من ${limit}`,
  importStatements: 'استيراد كشوف الحساب',
  importStatementsBody: 'ملف PDF أو CSV من بنكك، للأشهر التي سبقت اليوم',
  addByHand: 'سأضيف بنفسي',
  addByHandBody: 'دون وصول للرسائل. يمكنك تفعيل الالتقاط لاحقاً.',
  manualTitle: 'ستضيف عملياتك بنفسك.',
  patternTitle: (name: string | null) => name ? `هذه وفرة ${name}.` : 'هذه وفرتك.',
  legendYou: 'أنت',
  legendGoals: 'أهدافك',
  legendWatch: 'ما تراقبه',
  legendRemind: 'تذكيراتك',
  patternNote: 'لا يتشابه نمطان. سيظهر أعلى صفحتك الرئيسية.',
  oneLastThing: 'أمر أخير',
  openWafra: 'افتح وفرة',
  paywallTitle: 'دعه يعمل من تلقاء نفسه.',
  paywallBody: (category: string | null, reminders: boolean) => {
    const what = category && reminders ? `يبقى حد ${category} وتذكيراتك دقيقين`
      : category ? `يبقى حد ${category} دقيقاً`
        : reminders ? 'تبقى تذكيراتك دقيقة'
          : 'يبقى وفرة مكتملاً';
    return `${what} فقط إذا وصل كل تنبيه من البنك. يضيف Pro كل تنبيه تلقائياً.`;
  },
  trialToday: 'اليوم',
  trialTodayBody: 'الالتقاط التلقائي يعمل. دون بطاقة.',
  trialEnd: (days: number) => days === 1 ? 'خلال يوم'
    : `بعد ${arabicCount(days, { one: 'يوم', two: 'يومين', few: 'أيام', many: 'يوماً', hundreds: 'يوم' })}`,
  trialEndBody: 'يتوقف الالتقاط التلقائي مؤقتاً. لا يُخصم أي مبلغ، ويبقى سجلك كما هو.',
  continuePro: 'المتابعة مع Pro',
  planYearly: 'سنوي',
  planMonthly: 'شهري',
  startFree: (days: number) => days === 1 ? 'ابدأ اليوم المجاني'
    : days === 2 ? 'ابدأ اليومين المجانيين'
      : `ابدأ ${arabicCount(days, { one: 'يوماً مجانياً', two: 'يومين مجانيين', few: 'أيام مجانية', many: 'يوماً مجانياً', hundreds: 'يوم مجاني' })}`,
  continueFree: 'المتابعة دون Pro',
  trialTimelineLabel: 'ما يحدث خلال الأيام المجانية',
};

export const ONBOARDING_E_COPY: Record<Lang, OnboardingECopy> = { en, ar };

export function onboardingECopy(language: string): OnboardingECopy {
  return language === 'ar' ? ar : en;
}
