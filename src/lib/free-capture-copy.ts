import { TRIAL_DURATION_MS } from '@/lib/purchases';

/** Local free access has a saved deadline; it is not a storefront trial offer. */
export function freeCaptureCopy(startAtMs: number, language: 'en' | 'ar', nowMs = Date.now()) {
  const endAtMs = Number.isFinite(startAtMs) && startAtMs > 0 &&
    Number.isFinite(new Date(startAtMs + TRIAL_DURATION_MS).getTime()) ? startAtMs + TRIAL_DURATION_MS : null;
  const endLabel = endAtMs === null ? null : new Intl.DateTimeFormat(
    language === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB',
    { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false },
  ).format(new Date(endAtMs));
  const expired = endAtMs !== null && nowMs >= endAtMs;
  const status = language === 'ar'
    ? endLabel ? `${expired ? 'انتهى الالتقاط التلقائي المجاني في' : 'الالتقاط التلقائي مجاني حتى'} ${endLabel}.`
      : 'الالتقاط التلقائي مجاني لمدة 3 أيام من أول تشغيل.'
    : endLabel ? `${expired ? 'Free automatic capture ended' : 'Automatic capture is free until'} ${endLabel}.`
      : 'Automatic capture is free for 3 days from first launch.';
  const after = language === 'ar'
    ? 'بعد اليوم الثالث يحتاج الالتقاط التلقائي إلى برو. يبقى الإدخال اليدوي ولصق التنبيهات واستيراد الكشوف والنسخ الاحتياطي مجانياً.'
    : 'After day 3, automatic capture needs Pro. Manual entry, pasted alerts, statement imports and backup stay free.';
  return { endAtMs, endLabel, status, after };
}
