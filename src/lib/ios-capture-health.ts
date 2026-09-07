/** Local diagnostic projection. Never retain arbitrary native fields or source text. */
export interface IosCaptureHealth {
  enabled: boolean;
  entitled: boolean;
  pending: number;
  dropped: number;
  corrupt: boolean;
  lastReceivedAt: number | null;
  lastHandledAt: number | null;
  firstCapturedAt: number | null;
}

export function isCaptureTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) &&
    value >= 0 && value <= 8_640_000_000_000_000;
}

const timestamp = (value: unknown): number | null => isCaptureTimestamp(value) ? value : null;
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Missing new receipt fields on older binaries mean unknown, never zero-loss capture. */
export function readIosCaptureHealth(value: unknown): IosCaptureHealth | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const status = value as Record<string, unknown>;
  if (typeof status.enabled !== 'boolean' || typeof status.entitled !== 'boolean' ||
    typeof status.corrupt !== 'boolean' || !count(status.pending) || !count(status.dropped)) return null;
  return {
    enabled: status.enabled,
    entitled: status.entitled,
    pending: status.pending,
    dropped: status.dropped,
    corrupt: status.corrupt,
    lastReceivedAt: timestamp(status.lastReceivedAt),
    lastHandledAt: timestamp(status.lastHandledAt),
    firstCapturedAt: timestamp(status.firstCapturedAt),
  };
}

export type IosCaptureHealthMode = 'unknown' | 'off' | 'paused' | 'attention' | 'queued' | 'empty';
export function iosCaptureHealthMode(health: IosCaptureHealth | null): IosCaptureHealthMode {
  if (!health) return 'unknown';
  if (!health.enabled) return 'off';
  if (!health.entitled) return 'paused';
  if (health.corrupt || health.dropped > 0) return 'attention';
  if (health.pending > 0) return 'queued';
  return 'empty';
}

const COPY = {
  en: {
    title: 'Capture status', show: 'Show details', hide: 'Hide details',
    unknown: 'Status not available', off: 'Automatic capture is off',
    paused: 'Automatic capture is paused', attention: 'Some messages need attention',
    queued: 'Messages waiting to be processed', empty: 'No messages waiting in Wafra',
    pending: 'Waiting to process', dropped: 'Messages refused when the queue was full',
    corrupt: 'A queue problem was detected', received: 'Last message saved to the queue',
    handled: 'Last queue processing', first: 'First qualifying financial alert',
    missing: 'No receipt recorded',
    explanation: 'Queue processing includes duplicates and non-financial messages. An empty queue does not prove Apple delivered every bank alert. Older app versions may not have recorded receipt times.',
    receiptHelp: 'Dates are local activity records, not a promise that every purchase was captured.',
  },
  ar: {
    title: 'حالة التقاط التنبيهات', show: 'عرض التفاصيل', hide: 'إخفاء التفاصيل',
    unknown: 'الحالة غير متاحة', off: 'الالتقاط التلقائي متوقف',
    paused: 'الالتقاط التلقائي متوقف مؤقتاً', attention: 'بعض الرسائل تحتاج إلى انتباه',
    queued: 'رسائل بانتظار المعالجة', empty: 'لا توجد رسائل بانتظار المعالجة في وفرة',
    pending: 'بانتظار المعالجة', dropped: 'رسائل لم تُقبل بسبب امتلاء قائمة الانتظار',
    corrupt: 'اكتُشفت مشكلة في قائمة الانتظار', received: 'آخر رسالة حُفظت في قائمة الانتظار',
    handled: 'آخر معالجة لقائمة الانتظار', first: 'أول تنبيه مالي مؤهّل',
    missing: 'لا يوجد سجل استلام',
    explanation: 'تشمل المعالجة الرسائل المكررة وغير المالية. خلو قائمة الانتظار لا يثبت أن Apple أوصلت كل تنبيه بنكي. قد لا تسجّل إصدارات التطبيق الأقدم أوقات الاستلام.',
    receiptHelp: 'هذه التواريخ تسجّل النشاط المحلي ولا تعني التقاط كل عملية شراء.',
  },
} as const;
export function iosCaptureHealthCopy(language: string) { return language === 'ar' ? COPY.ar : COPY.en; }

export function formatCaptureReceipt(value: number | null, language: string): string {
  const copy = iosCaptureHealthCopy(language);
  if (!isCaptureTimestamp(value)) return copy.missing;
  try {
    return new Intl.DateTimeFormat(language === 'ar' ? 'ar-AE' : 'en-GB', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    }).format(new Date(value));
  } catch { return copy.missing; }
}
