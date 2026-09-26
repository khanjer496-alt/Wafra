/** Home's layout editor copy. Section names stay separate from their live headings. */
import type { HomeWidgetId } from '@/lib/home-widgets';
type Lang = 'en' | 'ar';

const en = {
  title: 'Customize Home',
  body: 'Choose what appears on Home and arrange it in the order that works for you.',
  previewTitle: 'Your Home layout',
  previewEmpty: 'All sections are hidden. The toolbar and Customize Home remain available.',
  fixedNote: 'The toolbar and important alerts always stay visible.',
  alwaysOnTop: 'Always available',
  yourSections: 'Your sections',
  reorderHint: 'Show or hide any section. Use the arrows to change its position.',
  fixed: 'Fixed',
  moneyOverviewTitle: 'Money overview',
  moneyOverviewDetail: 'Your totals for the selected period.',
  captureTitle: 'Automatic capture',
  captureDetail: 'Bank-alert capture status and setup.',
  shown: 'Shown',
  hidden: 'Hidden',
  resetLayout: 'Reset layout',
  saving: 'Saving…',
  saved: 'Saved on this device',
  saveError: 'Could not save this layout. Retry to keep your latest changes.',
  retry: 'Retry',
  leaveWithoutSaving: 'Leave without saving',
  done: 'Done',
  widgetTitle: {
    greeting: 'Greeting and pattern', overview: 'Money overview', today: 'Today', week: 'Last 7 days',
    due: 'Due soon', upcoming: 'Coming up', activity: 'Latest activity', assistant: 'Ask Wafra',
    insight: 'Spending insight', capture: 'Capture status',
  } satisfies Record<HomeWidgetId, string>,
  widgetDetail: {
    greeting: 'Your name, greeting and personal pattern.',
    overview: 'Spending, income and Net for the selected period.',
    today: 'Today’s spending and budget pace.',
    week: 'Daily amounts for the last seven days.',
    due: 'Payments due soon or already overdue.',
    upcoming: 'The next payments coming up.',
    activity: 'Your latest recorded transactions.',
    assistant: 'Questions about the figures on this phone.',
    insight: 'An observation from your recorded spending.',
    capture: 'Bank-alert capture status and setup.',
  } satisfies Record<HomeWidgetId, string>,
};

type CustomizeCopy = typeof en;
const ar: CustomizeCopy = {
  title: 'تخصيص الرئيسية',
  body: 'اختر ما يظهر في الرئيسية ورتّبه بالطريقة التي تناسبك.',
  previewTitle: 'ترتيب صفحتك الرئيسية',
  previewEmpty: 'كل الأقسام مخفية. يبقى شريط الأدوات وخيار تخصيص الرئيسية متاحين.',
  fixedNote: 'يبقى شريط الأدوات والتنبيهات المهمة ظاهرين دائمًا.',
  alwaysOnTop: 'متاح دائمًا',
  yourSections: 'أقسامك',
  reorderHint: 'أظهر أو أخفِ أي قسم. استخدم الأسهم لتغيير موضعه.',
  fixed: 'ثابت',
  moneyOverviewTitle: 'ملخص أموالك',
  moneyOverviewDetail: 'مجاميعك للفترة المختارة.',
  captureTitle: 'الالتقاط التلقائي',
  captureDetail: 'حالة التقاط تنبيهات البنك وإعداده.',
  shown: 'ظاهر',
  hidden: 'مخفي',
  resetLayout: 'إعادة الترتيب الافتراضي',
  saving: 'جارٍ الحفظ…',
  saved: 'محفوظ على هذا الجهاز',
  saveError: 'تعذّر حفظ الترتيب. حاول مجددًا للاحتفاظ بآخر تغييراتك.',
  retry: 'إعادة المحاولة',
  leaveWithoutSaving: 'الخروج دون حفظ',
  done: 'تم',
  widgetTitle: {
    greeting: 'التحية والنمط', overview: 'ملخص أموالك', today: 'اليوم', week: 'آخر 7 أيام',
    due: 'مستحق قريبًا', upcoming: 'القادم', activity: 'أحدث العمليات', assistant: 'اسأل وفرة',
    insight: 'معلومة عن الإنفاق', capture: 'حالة الالتقاط',
  },
  widgetDetail: {
    greeting: 'اسمك وتحيّتك ونمطك الشخصي.',
    overview: 'الإنفاق والدخل والصافي للفترة المختارة.',
    today: 'إنفاق اليوم ووتيرة ميزانيتك.',
    week: 'المبالغ اليومية خلال آخر سبعة أيام.',
    due: 'دفعات مستحقة قريبًا أو متأخرة.',
    upcoming: 'الدفعات القادمة التالية.',
    activity: 'آخر معاملاتك المسجّلة.',
    assistant: 'أسئلة عن الأرقام الموجودة على هذا الهاتف.',
    insight: 'ملاحظة من إنفاقك المسجّل.',
    capture: 'حالة التقاط تنبيهات البنك وإعداده.',
  },
};
export const CUSTOMIZE_COPY: Record<Lang, CustomizeCopy> = { en, ar };
export function customizeCopy(language: string | null | undefined): CustomizeCopy {
  return language === 'ar' ? ar : en;
}
