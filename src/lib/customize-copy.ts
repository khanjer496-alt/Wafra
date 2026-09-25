/**
 * Copy for Customize Home. English and Arabic keep identical keys (pinned by
 * a parity test).
 *
 * The Customize row titles are this screen's own names for the Home
 * sections; Home keeps its own section headings, so renaming a row here never
 * relabels Home.
 */
import type { HomeWidgetId } from '@/lib/home-widgets';

type Lang = 'en' | 'ar';

const en = {
  alwaysOnTop: 'Always on top',
  yourSections: 'Your sections',
  reorderHint: 'Use the arrows to change the order.',
  fixed: 'Fixed',
  moneyOverviewTitle: 'Money overview',
  moneyOverviewDetail: 'Your totals for the current period.',
  captureTitle: 'Automatic capture',
  captureDetail: 'Capture status and anything to check.',
  done: 'Done',
  widgetTitle: {
    due: 'Due soon',
    activity: 'Latest activity',
    insight: 'Insight',
    upcoming: 'Upcoming',
    assistant: 'Ask Wafra',
  } satisfies Record<HomeWidgetId, string>,
};

type CustomizeCopy = typeof en;

const ar: CustomizeCopy = {
  alwaysOnTop: 'دائمًا في الأعلى',
  yourSections: 'أقسامك',
  reorderHint: 'استخدم الأسهم لتغيير الترتيب.',
  fixed: 'ثابت',
  moneyOverviewTitle: 'ملخص أموالك',
  moneyOverviewDetail: 'مجاميعك للفترة الحالية.',
  captureTitle: 'الالتقاط التلقائي',
  captureDetail: 'حالة الالتقاط وأي شيء يحتاج مراجعة.',
  done: 'تم',
  widgetTitle: {
    due: 'مستحق قريبًا',
    activity: 'أحدث العمليات',
    insight: 'معلومة',
    upcoming: 'القادمة',
    assistant: 'اسأل وفرة',
  },
};

export const CUSTOMIZE_COPY: Record<Lang, CustomizeCopy> = { en, ar };

export function customizeCopy(language: string | null | undefined): CustomizeCopy {
  return language === 'ar' ? ar : en;
}
