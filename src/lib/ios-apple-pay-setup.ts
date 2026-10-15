import type { WafraLiveCaptureStatus } from '../../modules/wafra-live-capture';
import { isCaptureTimestamp } from './ios-capture-health';

export const IOS_APPLE_PAY_SHORTCUT_NAME = 'Wafra Apple Pay v1';

export { iosSupportsApplePayAutomation } from './ios-setup-availability';

export function iosApplePayCheckUrl(fromOnboarding: boolean): string {
  const callback = (result: string) => encodeURIComponent(
    `wafra://ios-apple-pay-setup?shortcutResult=${result}${fromOnboarding ? '&fromOnboarding=1' : ''}`,
  );
  // No input: the bundled graph runs only the separate setup-proof action.
  return `shortcuts://x-callback-url/run-shortcut?name=${encodeURIComponent(IOS_APPLE_PAY_SHORTCUT_NAME)}` +
    `&x-success=${callback('success')}&x-cancel=${callback('cancel')}&x-error=${callback('error')}`;
}

export function isBundledApplePayShortcutUri(value: string): boolean {
  try {
    const uri = new URL(value);
    return uri.protocol === 'file:' && uri.hostname === '' && uri.search === '' && uri.hash === '' &&
      decodeURIComponent(uri.pathname).endsWith(`/WafraLiveCaptureResources.bundle/${IOS_APPLE_PAY_SHORTCUT_NAME}.shortcut`);
  } catch { return false; }
}

export function resolveApplePaySetupState(
  status: WafraLiveCaptureStatus | null,
  progress: { futureCaptureSource?: string; futureShortcutConfirmed?: boolean; futureAutomationConfirmed?: boolean } = {},
) {
  const active = status?.enabled === true && status.entitled === true;
  const installed = progress.futureCaptureSource === 'apple-pay' && progress.futureShortcutConfirmed === true;
  const checked = active && isCaptureTimestamp(status?.applePaySetupProofAt);
  const confirmed = progress.futureCaptureSource === 'apple-pay' && progress.futureAutomationConfirmed === true;
  const received = isCaptureTimestamp(status?.firstApplePayReceivedAt);
  const incomplete = isCaptureTimestamp(status?.lastApplePayIncompleteAt) &&
    (!isCaptureTimestamp(status?.lastApplePayReceivedAt) || status.lastApplePayIncompleteAt >= status.lastApplePayReceivedAt);
  const pending = typeof status?.applePayPending === 'number' && Number.isSafeInteger(status.applePayPending) && status.applePayPending >= 0
    ? status.applePayPending : 0;
  return { active, installed, checked, confirmed, received, incomplete, pending, canConfirm: active && installed && checked };
}

/** One recent Apple Pay receipt and the Wallet card text it carried (observe-only). */
export interface ApplePayCardObservation {
  receivedAt: number;
  /** null: the automation supplied no usable Card or Pass value. */
  cardOrPass: string | null;
}

const MAX_CARD_OBSERVATIONS = 5;
/** Mirrors WafraLiveCaptureStore.maxApplePayCardOrPassCharacters (UTF-16 units). */
export const MAX_APPLE_PAY_CARD_OR_PASS_LENGTH = 80;
const UNSAFE_CARD_RE = /[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/u;

/** Accepts exactly what the native sanitizer can emit: trimmed, bounded, no unsafe scalars. */
export const usableCardOrPass = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value === value.trim() &&
  value.length <= MAX_APPLE_PAY_CARD_OR_PASS_LENGTH && !UNSAFE_CARD_RE.test(value) &&
  Array.from(value).every(character => {
    const codePoint = character.codePointAt(0)!;
    return codePoint < 0xd800 || codePoint > 0xdfff;
  });

/**
 * Validate the native diagnostic rows, newest first. Anything malformed is
 * skipped: this list is for the owner to read, never an input to money.
 */
export function parseApplePayCardObservations(rows: unknown): ApplePayCardObservation[] {
  if (!Array.isArray(rows)) return [];
  const observations: ApplePayCardObservation[] = [];
  for (const row of rows.slice(-MAX_CARD_OBSERVATIONS)) {
    if (typeof row !== 'string' || row.length > 1024) continue;
    let value: unknown;
    try { value = JSON.parse(row); } catch { continue; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).some(key => key !== 'receivedAt' && key !== 'cardOrPass')) continue;
    if (!isCaptureTimestamp(record.receivedAt)) continue;
    if ('cardOrPass' in record && !usableCardOrPass(record.cardOrPass)) continue;
    observations.push({ receivedAt: record.receivedAt, cardOrPass: usableCardOrPass(record.cardOrPass) ? record.cardOrPass : null });
  }
  return observations.reverse();
}

const COPY = {
  en: {
    title: 'Apple Pay purchases', subtitle: 'Wafra Apple Pay setup · iOS 17 or later',
    intro: 'Capture new card taps with Apple Pay. Each supported purchase goes to Review, where you choose the account before adding it.',
    scope: 'This covers positive purchase amounts. It does not import Wallet history, refunds, card numbers or payment status. No bank selection is needed here.',
    unsupported: 'Wafra Apple Pay setup needs iOS 17 or later, when Wallet automations arrived. Use regular bank-message setup on earlier versions.',
    checking: 'Checking Apple Pay capture support…', update: 'Update Wafra to a build with Apple Pay capture before continuing.',
    enable: 'Enable capture on this iPhone', inactive: 'Capture access is inactive. Check your Wafra access before continuing.',
    addTitle: '1. Add the Shortcut',
    addHelp: 'Choose Shortcuts in the share sheet, then Add Shortcut. If it says you already have it, tap Cancel: yours is ready. Keep the name Wafra Apple Pay v1.',
    add: 'Add Apple Pay Shortcut', installedButton: 'I added the Shortcut', installed: 'Shortcut installation confirmed by you', notInstalled: 'Installation has not been confirmed.',
    checkTitle: '2. Check permissions',
    checkHelp: 'Keep your iPhone unlocked. Run the permission check without input and allow access to Wafra if asked.',
    runCheck: 'Run permission check', checked: 'Permission check received. This does not prove that a card tap reaches Wafra.',
    waitingCheck: 'No Apple Pay permission check received yet. Run the check, then return here.',
    automationTitle: '3. Choose the card in Shortcuts',
    // iOS 17–26: a personal Transaction automation that runs the Shortcut.
    automationStepsLegacy: [
      'In Shortcuts, tap Automation, then +. Choose Transaction.',
      'Choose only the cards whose bank does not text you (bank texts already reach Wafra). Pick Run Immediately and keep Notify When Run off, then tap Next.',
      'Choose Wafra Apple Pay v1. Tap Done if it appears, then return here to confirm.',
    ],
    // iOS 27: shortcuts carry their own automations.
    automationSteps: [
      'Open Wafra Apple Pay v1 in the Shortcuts editor. In its Automation section, add a Transaction trigger.',
      'Choose the Wallet card you use with Apple Pay and Run Immediately. Keep Amount and Merchant bound to Shortcut Input in the existing actions.',
      'Save the automation, then return here to confirm. Repeat for another card if needed.',
    ],
    confirm: 'I saved the Apple Pay automation', confirmed: 'Automation confirmed by you',
    actualTitle: 'Purchase delivery', waiting: 'Waiting for the first Apple Pay purchase. No test purchase is required to finish setup.',
    received: 'An Apple Pay event reached this iPhone. Check Review to decide whether to add it; this is not a payment-settlement confirmation.',
    incomplete: 'Wallet reached Wafra without usable purchase details. No purchase was added from that event. Check that Amount and Merchant come from Shortcut Input.',
    pending: 'Apple Pay events waiting to be reviewed or processed', last: 'Last Apple Pay event received',
    cardTitle: 'Card or Pass from Wallet',
    cardHelp: 'Optional. What Wallet passed with each recent event, shown only so you can check it. It stays on this iPhone and is not used to choose an account. Older or manually built automations do not send it, and that is fine.',
    cardMissing: 'No card name sent (optional)',
    review: 'Open Review', reviewOnboarding: 'Finish setup to open Review and choose the account for captured purchases.',
    manual: 'Set up the action manually', manualHelp: [
      'In Shortcuts, run Wafra’s “Check Wafra Apple Pay setup” action once with your iPhone unlocked. Allow access when asked. This adds no purchase.',
      'Create a Transaction automation for your card and choose Run Immediately. Add “Capture Apple Pay purchase”.',
      'Bind Wallet amount to the Amount property of Shortcut Input. Keep the whole currency amount; do not convert it to text or a number. Bind Merchant to the Merchant property of Shortcut Input.',
      'Save the automation and return here. Use the installation confirmation button once the action is in place.',
    ],
    open: 'Open Shortcuts', refresh: 'Check setup status', back: 'Back to setup',
    failed: 'The permission check did not finish. Add the Shortcut first, keep its original name, then run it again with your iPhone unlocked.',
    missing: 'Could not open or share the Shortcut. Check that Apple Shortcuts is installed, or use the manual steps.',
    error: 'Could not complete this step. Try again. Your existing transactions are unchanged.',
    confirmNeeded: 'Confirm the Shortcut is installed and run its permission check before confirming the automation.',
    privacy: 'Only the amount, currency, merchant and card or pass name passed by your automation are saved on this iPhone. Wafra cannot inspect or create the card automation for you. Manage it in Shortcuts.',
  },
  ar: {
    title: 'مشتريات Apple Pay', subtitle: 'إعداد Apple Pay في وفرة · iOS 17 أو أحدث',
    intro: 'التقط عمليات الشراء الجديدة بالبطاقة عبر Apple Pay. تنتقل كل عملية مدعومة إلى المراجعة لتختار الحساب قبل إضافتها.',
    scope: 'يشمل هذا المبالغ الموجبة للمشتريات فقط. لا يستورد سجل المحفظة أو المبالغ المستردة أو أرقام البطاقات أو حالة الدفع. لا تحتاج إلى اختيار البنك هنا.',
    unsupported: 'يحتاج إعداد Apple Pay في وفرة إلى iOS 17 أو أحدث، حين وصلت أتمتة المحفظة. استخدم إعداد رسائل البنك المعتاد في الإصدارات الأقدم.',
    checking: 'جارٍ فحص دعم التقاط Apple Pay…', update: 'حدّث وفرة إلى إصدار يدعم التقاط Apple Pay قبل المتابعة.',
    enable: 'تفعيل الالتقاط على هذا الآيفون', inactive: 'الوصول إلى الالتقاط غير نشط. تحقّق من صلاحية الوصول في وفرة قبل المتابعة.',
    addTitle: '١. أضف الاختصار',
    addHelp: 'اختر الاختصارات من قائمة المشاركة ثم إضافة الاختصار. إذا ظهر أنه موجود لديك، اضغط «إلغاء»: اختصارك جاهز. احتفظ بالاسم Wafra Apple Pay v1.',
    add: 'إضافة اختصار Apple Pay', installedButton: 'أضفت الاختصار', installed: 'أكّدت تثبيت الاختصار', notInstalled: 'لم يُؤكّد تثبيت الاختصار بعد.',
    checkTitle: '٢. تحقّق من الأذونات',
    checkHelp: 'أبقِ الآيفون مفتوحاً. شغّل فحص الأذونات دون إدخال واسمح بالوصول إلى وفرة عند الطلب.',
    runCheck: 'تشغيل فحص الأذونات', checked: 'وصل فحص الأذونات. هذا لا يثبت وصول عمليات البطاقة إلى وفرة.',
    waitingCheck: 'لم يصل فحص أذونات Apple Pay بعد. شغّل الفحص ثم عد إلى هنا.',
    automationTitle: '٣. اختر البطاقة في الاختصارات',
    automationStepsLegacy: [
      'في الاختصارات، اضغط «الأتمتة» ثم +. اختر «المعاملة».',
      'اختر فقط البطاقات التي لا يرسل بنكها رسائل (رسائل البنك تصل وفرة أصلاً). اختر «تشغيل فوراً» وأبقِ «الإشعار عند التشغيل» متوقفاً، ثم «التالي».',
      'اختر Wafra Apple Pay v1. اضغط «تم» إن ظهر، ثم عد إلى هنا للتأكيد.',
    ],
    automationSteps: [
      'افتح Wafra Apple Pay v1 في محرّر الاختصارات. من قسم الأتمتة فيه، أضف مشغّل المعاملة.',
      'اختر بطاقة المحفظة التي تستخدمها مع Apple Pay و«تشغيل فوراً». أبقِ المبلغ والتاجر مرتبطَين بإدخال الاختصار في الإجراءات الموجودة.',
      'احفظ الأتمتة ثم عد إلى هنا للتأكيد. كرّر ذلك لبطاقة أخرى عند الحاجة.',
    ],
    confirm: 'حفظت أتمتة Apple Pay', confirmed: 'أكّدت حفظ الأتمتة',
    actualTitle: 'وصول المشتريات', waiting: 'بانتظار أول عملية شراء عبر Apple Pay. لا تحتاج إلى إجراء شراء تجريبي لإكمال الإعداد.',
    received: 'وصل حدث Apple Pay إلى هذا الآيفون. افتح المراجعة لتقرر إضافته؛ هذا ليس تأكيداً لتسوية الدفع.',
    incomplete: 'وصلت المحفظة إلى وفرة دون تفاصيل شراء صالحة. لم تُضف عملية من هذا الحدث. تحقّق من أن المبلغ والتاجر مأخوذان من إدخال الاختصار.',
    pending: 'أحداث Apple Pay بانتظار المراجعة أو المعالجة', last: 'آخر حدث Apple Pay وصل',
    cardTitle: 'البطاقة من المحفظة',
    cardHelp: 'اختياري. ما مرّرته المحفظة مع كل حدث حديث، يظهر هنا لتتحقق منه فقط. يبقى على هذا الآيفون ولا يُستخدم لاختيار الحساب. الأتمتة الأقدم أو المُعدّة يدوياً لا ترسله، وهذا طبيعي.',
    cardMissing: 'لم يُرسل اسم البطاقة (اختياري)',
    review: 'فتح المراجعة', reviewOnboarding: 'أكمل الإعداد لفتح المراجعة واختيار الحساب للمشتريات الملتقطة.',
    manual: 'إعداد الإجراء يدوياً', manualHelp: [
      'شغّل إجراء وفرة «التحقق من إعداد Apple Pay في وفرة» مرة في الاختصارات والآيفون مفتوح. اسمح بالوصول عند الطلب. لا يضيف ذلك عملية شراء.',
      'أنشئ أتمتة معاملة لبطاقتك واختر تشغيل فوراً. أضف إجراء «التقاط عملية Apple Pay».',
      'اربط مبلغ المحفظة بخاصية المبلغ في إدخال الاختصار. احتفظ بالمبلغ مع العملة ولا تحوّله إلى نص أو رقم. اربط التاجر بخاصية التاجر في إدخال الاختصار.',
      'احفظ الأتمتة ثم عد إلى هنا. استخدم زر تأكيد التثبيت بعد إضافة الإجراء.',
    ],
    open: 'فتح الاختصارات', refresh: 'فحص حالة الإعداد', back: 'العودة إلى الإعداد',
    failed: 'لم يكتمل فحص الأذونات. أضف الاختصار أولاً واحتفظ باسمه الأصلي ثم شغّله مجدداً والآيفون مفتوح.',
    missing: 'تعذّر فتح الاختصار أو مشاركته. تحقّق من تثبيت اختصارات Apple أو استخدم الخطوات اليدوية.',
    error: 'تعذّر إكمال هذه الخطوة. حاول مجدداً. عملياتك الحالية لم تتغير.',
    confirmNeeded: 'أكّد تثبيت الاختصار وشغّل فحص الأذونات قبل تأكيد الأتمتة.',
    privacy: 'يُحفظ على هذا الآيفون فقط المبلغ والعملة والتاجر واسم البطاقة التي تمرّرها الأتمتة. لا يستطيع وفرة فحص أتمتة البطاقة أو إنشاؤها نيابةً عنك. أدِرها من الاختصارات.',
  },
} as const;

export const iosApplePayCopy = (language: string) => COPY[language === 'ar' ? 'ar' : 'en'];
