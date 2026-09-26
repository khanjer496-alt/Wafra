/**
 * Words for the Widgets screen, its Settings row and the one Home hint that
 * points at it, plus the words the widget previews draw. The preview words
 * match the native widgets' own copy (targets/widget/WafraSnapshot.swift,
 * modules/wafra-widgets/android/src/main/res/values*), so a preview reads
 * exactly like the widget it stands for. English and Arabic carry identical
 * keys (scripts/test/repair/widgets-copy.test.cjs).
 *
 * `platform` is 'ios' or 'android': Apple says "Home Screen" and "Add
 * Widget"; Android launchers say "home screen" and "Widgets".
 */
type Platform = 'ios' | 'android';

/** Arabic count of payments, as the iOS widget and the Android plurals say it. */
function arabicPayments(count: number): string {
  if (count === 0) return 'لا دفعات بعد';
  if (count === 1) return 'دفعة واحدة';
  if (count === 2) return 'دفعتان';
  if (count >= 3 && count <= 10) return `${count} دفعات`;
  return `${count} دفعة`;
}

export const widgetsCopyTables = {
  en: {
    title: 'Widgets',
    preparing: 'Updating widget figures…',
    importPending: 'Widgets will update when the import finishes.',
    body: (platform: Platform): string => platform === 'ios'
      ? 'Today’s spending and your next bills on your Home Screen, from the figures on this phone.'
      : 'Today’s spending and your next bills on your home screen, from the figures on this phone.',
    todayName: 'Today',
    todayAbout: 'What you spent today, the last 7 days and what is left in budgets.',
    upcomingName: 'Coming up',
    upcomingAbout: 'Your next three bills and card payments, and when they are due.',
    /** The widget's size as the widget gallery or picker names it. */
    size: (platform: Platform, kind: 'today' | 'upcoming'): string => platform === 'ios'
      ? kind === 'today' ? 'Small' : 'Medium'
      : kind === 'today' ? '2 × 2' : '4 × 2',
    previewLabel: (name: string) => `${name} widget preview`,
    lockNote: 'On the Lock Screen and in StandBy the amounts are hidden; the words stay.',
    privateNote: 'Private mode keeps figures off your widgets, so they ask you to open Wafra instead.',
    howTitle: 'How to add a widget',
    steps: (platform: Platform): string[] => platform === 'ios'
      ? [
        'Touch and hold an empty area of your Home Screen until the apps jiggle.',
        'Tap Edit, then Add Widget.',
        'Search for Wafra, choose Today or Coming up, then tap Add Widget.',
      ]
      : [
        'Touch and hold an empty area of your home screen.',
        'Tap Widgets.',
        'Find Wafra, then touch and hold Today or Coming up and drag it into place.',
      ],
    step: (index: number) => `Step ${index}`,
    add: 'Add to home screen',
    addNamed: (name: string) => `Add ${name} to home screen`,
    addFailed: 'Your launcher did not open its add dialog. Add the widget with the steps below.',
    // Home hint
    hintTitle: (platform: Platform): string => platform === 'ios' ? 'Add Wafra to your Home Screen' : 'Add Wafra to your home screen',
    hintBody: 'See today’s spending and your next bills without opening the app.',
    hintDismiss: 'Dismiss',
    // Settings row
    settingsTitle: 'Widgets',
    settingsDetail: (platform: Platform): string => platform === 'ios'
      ? 'Today and Coming up on your Home Screen'
      : 'Today and Coming up on your home screen',
    // What the widgets themselves draw (native copy, mirrored)
    widgetToday: 'Today',
    widgetTomorrow: 'Tomorrow',
    widgetComingUp: 'Coming up',
    widgetNothingComingUp: (platform: Platform): string => platform === 'ios' ? 'Nothing coming up' : 'No upcoming bills',
    widgetOpenToUpdate: 'Open Wafra to update',
    widgetLeftInBudgets: (amount: string) => `${amount} left in budgets`,
    widgetOverBudgets: (amount: string) => `${amount} over budgets`,
    widgetPayments: (count: number): string => count === 0 ? 'No payments yet' : count === 1 ? '1 payment' : `${count} payments`,
    widgetAmountHidden: 'Amount hidden',
    widgetLast7Total: 'Last 7 days',
    widgetLast7: 'Spending over the last 7 days',
    weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  },
  ar: {
    title: 'الأدوات',
    preparing: 'جارٍ تحديث أرقام الأدوات…',
    importPending: 'ستُحدّث الأدوات عند اكتمال الاستيراد.',
    body: (_platform: Platform) => 'إنفاق اليوم وفواتيرك القادمة على الشاشة الرئيسية، من الأرقام المحفوظة على هذا الهاتف.',
    todayName: 'اليوم',
    todayAbout: 'ما أنفقته اليوم وخلال آخر 7 أيام، والمتبقي في الميزانيات.',
    upcomingName: 'القادم',
    upcomingAbout: 'فواتيرك ودفعات بطاقاتك الثلاث القادمة ومواعيد استحقاقها.',
    size: (platform: Platform, kind: 'today' | 'upcoming') => platform === 'ios'
      ? kind === 'today' ? 'صغيرة' : 'متوسطة'
      : kind === 'today' ? '2 × 2' : '4 × 2',
    previewLabel: (name: string) => `معاينة أداة ${name}`,
    lockNote: 'على شاشة القفل وفي وضع الاستعداد تُخفى المبالغ وتبقى الكلمات.',
    privateNote: 'الوضع الخاص يُبعد الأرقام عن الأدوات، فتطلب منك فتح وفرة بدلاً منها.',
    howTitle: 'طريقة إضافة أداة',
    steps: (platform: Platform) => platform === 'ios'
      ? [
        'المس مع الاستمرار مساحة فارغة في الشاشة الرئيسية حتى تهتز التطبيقات.',
        'اضغط على تعديل، ثم إضافة أداة.',
        'ابحث عن وفرة، واختر اليوم أو القادم، ثم اضغط إضافة أداة.',
      ]
      : [
        'المس مع الاستمرار مساحة فارغة في الشاشة الرئيسية.',
        'اضغط على التطبيقات المصغّرة.',
        'ابحث عن وفرة، ثم المس مع الاستمرار «اليوم» أو «القادم» واسحبه إلى مكانه.',
      ],
    step: (index: number) => `الخطوة ${index}`,
    add: 'إضافة إلى الشاشة الرئيسية',
    addNamed: (name: string) => `إضافة ${name} إلى الشاشة الرئيسية`,
    addFailed: 'لم يفتح المشغّل نافذة الإضافة. أضف الأداة بالخطوات أدناه.',
    hintTitle: (_platform: Platform) => 'أضف وفرة إلى شاشتك الرئيسية',
    hintBody: 'اطّلع على إنفاق اليوم وفواتيرك القادمة دون فتح التطبيق.',
    hintDismiss: 'إخفاء',
    settingsTitle: 'الأدوات',
    settingsDetail: (_platform: Platform) => 'اليوم والقادم على شاشتك الرئيسية',
    widgetToday: 'اليوم',
    widgetTomorrow: 'غداً',
    widgetComingUp: 'القادم',
    widgetNothingComingUp: (platform: Platform) => platform === 'ios' ? 'لا توجد دفعات قادمة' : 'لا توجد فواتير قادمة',
    widgetOpenToUpdate: 'افتح وفرة للتحديث',
    widgetLeftInBudgets: (amount: string) => `المتبقي في الميزانيات ${amount}`,
    widgetOverBudgets: (amount: string) => `تجاوز الميزانيات ${amount}`,
    widgetPayments: (count: number) => arabicPayments(count),
    widgetAmountHidden: 'المبلغ مخفي',
    widgetLast7Total: 'آخر 7 أيام',
    widgetLast7: 'الإنفاق خلال آخر 7 أيام',
    weekdays: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
    weekdaysShort: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
    monthsShort: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
  },
};

export type WidgetsCopy = (typeof widgetsCopyTables)['en'];

export function widgetsCopy(language: string): WidgetsCopy {
  return language === 'ar' ? widgetsCopyTables.ar : widgetsCopyTables.en;
}
