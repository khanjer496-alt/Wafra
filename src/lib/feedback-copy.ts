/**
 * Copy for the feedback screen's type chips. English and Arabic keep
 * identical keys. The chip values are the wire's FEEDBACK_TOPICS.
 */
import type { FeedbackTopic } from '@/lib/feedback-wire';

type Lang = 'en' | 'ar';

const en = {
  typeHeader: 'What is it about?',
  typeOptional: 'Optional',
  topic: {
    idea: 'Idea',
    broken: 'Something broke',
    category: 'Wrong category',
  } satisfies Record<FeedbackTopic, string>,
};

type FeedbackCopy = typeof en;

const ar: FeedbackCopy = {
  typeHeader: 'عمّ تتحدث ملاحظتك؟',
  typeOptional: 'اختياري',
  topic: {
    idea: 'فكرة',
    broken: 'شيء لا يعمل',
    category: 'تصنيف خاطئ',
  },
};

export const FEEDBACK_COPY: Record<Lang, FeedbackCopy> = { en, ar };

export function feedbackCopy(language: string | null | undefined): FeedbackCopy {
  return language === 'ar' ? ar : en;
}
