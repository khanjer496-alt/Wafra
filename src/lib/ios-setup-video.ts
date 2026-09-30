import content from './ios-setup-video-content.json';
import { iosSupportsApplePayAutomation } from './ios-setup-availability';
import { iosSetupRecordings } from './ios-setup-recordings';

export type IosSetupVideoKind = 'capture' | 'history' | 'apple-pay';

export const isIosSetupVideoSupported = (osVersion: unknown, kind: IosSetupVideoKind = 'capture'): boolean =>
  kind === 'apple-pay' ? iosSupportsApplePayAutomation(osVersion)
    : /^(?:26)(?:\.\d+)*$/.test(String(osVersion));

export const getIosSetupVideo = (kind: IosSetupVideoKind, language: string) => {
  const lang = language === 'ar' ? 'ar' : 'en';
  const guide = content.guides[kind][lang];
  const recording = iosSetupRecordings[kind]?.[lang] ?? null;
  return {
    title: recording?.title ?? guide.title,
    description: recording?.description ?? guide.description,
    recording,
    recordingNote: recording?.note ?? '',
    shortcutName: content.guides[kind].shortcutName,
    durationSeconds: recording?.durationSeconds ?? 0,
    transcript: guide.steps.map((step, index) => ({
      title: step.title, body: step.body,
      startSeconds: recording?.chapters.find(chapter => chapter.stepIndex === index)?.startSeconds ?? null,
    })),
  };
};

const copy = {
  en: {
    watch: 'Watch setup guide', close: 'Close guide', replay: 'Replay', loading: 'Loading video…',
    fullscreen: 'Watch full screen', fullscreenFailed: 'Full screen is unavailable here. You can keep watching below.',
    failed: 'The video could not play. You can follow the steps below.',
    readGuide: 'Read setup steps', readSteps: 'Written steps', videoUnavailable: 'Video playback needs a newer Wafra build. The written steps are available below.',
  },
  ar: {
    watch: 'شاهد دليل الإعداد', close: 'إغلاق الدليل', replay: 'إعادة المشاهدة', loading: 'جارٍ تحميل الفيديو…',
    fullscreen: 'شاهد بملء الشاشة', fullscreenFailed: 'ملء الشاشة غير متاح هنا. يمكنك متابعة المشاهدة أدناه.',
    failed: 'تعذّر تشغيل الفيديو. يمكنك اتباع الخطوات أدناه.',
    readGuide: 'اقرأ خطوات الإعداد', readSteps: 'الخطوات المكتوبة', videoUnavailable: 'يتطلب تشغيل الفيديو إصداراً أحدث من وفرة. يمكنك قراءة الخطوات أدناه.',
  },
};

export const iosSetupVideoCopy = (language: string) => copy[language === 'ar' ? 'ar' : 'en'];
