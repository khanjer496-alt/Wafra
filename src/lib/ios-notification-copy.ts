/** Keep this phrase identical to WafraLiveCaptureStore.notificationSetupProbeText. */
export const IOS_NOTIFICATION_SETUP_TEXT = 'Wafra notification setup check';
export const IOS_NOTIFICATION_SHORTCUT_NAME = 'Wafra Notifications v1';
export function iosNotificationCheckUrl(fromOnboarding: boolean): string {
  const callback = (result: string) => encodeURIComponent(`wafra://ios-notification-setup?shortcutResult=${result}${fromOnboarding ? '&fromOnboarding=1' : ''}`);
  return `shortcuts://x-callback-url/run-shortcut?name=${encodeURIComponent(IOS_NOTIFICATION_SHORTCUT_NAME)}` +
    `&x-success=${callback('success')}&x-cancel=${callback('cancel')}&x-error=${callback('error')}`;
}

const COPY = {
  en: {
    title: 'Bank app notifications', subtitle: 'iOS 27 · One-time Shortcuts setup',
    intro: 'Choose your bank app in Apple Shortcuts. Only the notification text your automation passes to Wafra is saved on this iPhone. Wafra processes waiting alerts when you open it.',
    noBankQuestion: 'No bank-name selection is needed here. Alerts with an unclear bank or transaction need review; unsupported alerts are not posted automatically.',
    unsupported: 'Notification automations require iOS 27 or later. On this iPhone, use Message automation for bank SMS.',
    checking: 'Checking notification capture support…', update: 'Update Wafra to a build with the Capture bank notification action.',
    enable: 'Enable capture on this iPhone', inactive: 'Automatic capture access is inactive. Check your Wafra access before continuing.',
    action: 'Capture bank notification', copy: 'Copy setup check text', copied: 'Setup check text copied', open: 'Open Shortcuts', refresh: 'Check setup status',
    install: 'Add notification Shortcut', runCheck: 'Run permission check', manual: 'Build the Shortcut manually',
    bundle1: '1. Add Wafra Notifications v1. In the share sheet, choose Shortcuts and Add Shortcut. Choose Replace if prompted and keep its name.',
    bundle2: '2. Run permission check below. Keep your iPhone unlocked and allow access to Wafra when asked.',
    bundle3: '3. In Shortcuts, add a Notification automation, select your bank app and choose Wafra Notifications v1. Choose Run Immediately where shown and allow running when locked in Privacy if available. Return here to confirm.',
    checkFailed: 'The permission check did not finish. Add the Shortcut first, keep its original name, then run it again with the iPhone unlocked.',
    step1: '1. In Shortcuts, create a shortcut and add Wafra’s “Capture bank notification” action.',
    step2: '2. Paste the setup check text into the action’s Notification text field. Run it once with your iPhone unlocked and allow access to Wafra.',
    step3: '3. Replace the test text with the Shortcut Input variable. If needed, add Get Text from Input before the Wafra action and pass its Text result. Do not leave the test phrase in the action.',
    step4: '4. Add a Notification automation to that shortcut. Select only the banking or payment app you want to capture. Choose Run Immediately where shown. In the shortcut’s Privacy settings, allow running when locked if available.',
    step5: '5. Return here and confirm after saving the automation. Repeat the app-selection step for another bank app if needed.',
    waitingCheck: 'Permission check not received yet. Copy the test text and run the action once in Shortcuts.',
    waitingBundleCheck: 'Permission check not received yet. Add the notification Shortcut, then tap Run permission check.',
    checked: 'The native action check passed. This does not confirm that the Notification trigger delivers text.',
    waitingNotification: 'Waiting for the first notification. If nothing arrives, confirm that the action uses Shortcut Input, not the test phrase, and that the selected app can show notification content.',
    received: 'Notification text received on this iPhone. This is a queue receipt, not proof that a transaction was added.',
    last: 'Last notification received', confirm: 'I saved the notification automation', confirmed: 'Automation confirmed by you',
    reviewFull: 'Notification review is full. Review alerts labelled Notification capture to make room. Additional notifications stay in the protected queue for up to 30 days.',
    reviewFullOnboarding: 'Notification review is full. Finish setup, then review alerts labelled Notification capture in Wafra. Additional notifications stay queued for up to 30 days.',
    reviewAction: 'Review waiting alerts',
    error: 'Could not complete this step. Your existing transactions are unchanged. Try again.',
    missing: 'Shortcuts could not open. Install Apple Shortcuts, then try again.',
    back: 'Back to setup', privacy: 'Wafra cannot inspect or create Apple’s personal automation for you. Manage or disable existing automations in Shortcuts. This setup does not read old notifications or message history.',
  },
  ar: {
    title: 'إشعارات تطبيق البنك', subtitle: 'iOS 27 · إعداد الاختصارات لمرة واحدة',
    intro: 'اختر تطبيق البنك في اختصارات Apple. يُحفظ على هذا الآيفون فقط نص الإشعار الذي تمرّره الأتمتة إلى وفرة. يعالج وفرة التنبيهات المنتظرة عند فتحه.',
    noBankQuestion: 'لا تحتاج إلى اختيار اسم البنك هنا. تحتاج التنبيهات ذات البنك أو العملية غير الواضحة إلى مراجعة؛ ولا تُسجّل التنبيهات غير المدعومة تلقائياً.',
    unsupported: 'تتطلب أتمتة الإشعارات iOS 27 أو أحدث. استخدم أتمتة الرسائل لتنبيهات البنك النصية على هذا الآيفون.',
    checking: 'جارٍ فحص دعم التقاط الإشعارات…', update: 'حدّث وفرة إلى إصدار يتضمن إجراء «التقاط إشعار بنكي».',
    enable: 'تفعيل الالتقاط على هذا الآيفون', inactive: 'الوصول إلى الالتقاط التلقائي غير نشط. تحقّق من صلاحية الوصول في وفرة قبل المتابعة.',
    action: 'التقاط إشعار بنكي', copy: 'نسخ نص فحص الإعداد', copied: 'نُسخ نص فحص الإعداد', open: 'فتح الاختصارات', refresh: 'فحص حالة الإعداد',
    install: 'إضافة اختصار الإشعارات', runCheck: 'تشغيل فحص الأذونات', manual: 'إنشاء الاختصار يدوياً',
    bundle1: '١. أضف Wafra Notifications v1. اختر الاختصارات من قائمة المشاركة ثم إضافة الاختصار. اختر الاستبدال إذا طُلب واحتفظ باسمه.',
    bundle2: '٢. شغّل فحص الأذونات أدناه. أبقِ الآيفون مفتوحاً واسمح بالوصول إلى وفرة عند الطلب.',
    bundle3: '٣. أضف أتمتة إشعار في الاختصارات، واختر تطبيق البنك ثم Wafra Notifications v1. اختر تشغيل فوراً إن ظهر واسمح بالتشغيل عند القفل من الخصوصية إذا توفر. عد إلى هنا للتأكيد.',
    checkFailed: 'لم يكتمل فحص الأذونات. أضف الاختصار أولاً واحتفظ باسمه الأصلي ثم شغّله مجدداً والآيفون مفتوح.',
    step1: '١. أنشئ اختصاراً في تطبيق الاختصارات وأضف إجراء وفرة «التقاط إشعار بنكي».',
    step2: '٢. الصق نص فحص الإعداد في حقل «نص الإشعار». شغّله مرة والآيفون مفتوح، واسمح بالوصول إلى وفرة.',
    step3: '٣. استبدل نص الفحص بمتغير «إدخال الاختصار». أضف «الحصول على نص من الإدخال» قبل إجراء وفرة عند الحاجة ومرّر نتيجته النصية. لا تترك عبارة الفحص في الإجراء.',
    step4: '٤. أضف أتمتة «إشعار» إلى الاختصار. اختر فقط تطبيق البنك أو الدفع المطلوب. اختر «تشغيل فوراً» إن ظهر. فعّل التشغيل عند القفل من خصوصية الاختصار إذا كان متاحاً.',
    step5: '٥. عد إلى هنا وأكّد بعد حفظ الأتمتة. كرّر اختيار التطبيق لإضافة تطبيق بنك آخر عند الحاجة.',
    waitingCheck: 'لم يصل فحص الأذونات بعد. انسخ نص الفحص وشغّل الإجراء مرة واحدة في الاختصارات.',
    waitingBundleCheck: 'لم يصل فحص الأذونات بعد. أضف اختصار الإشعارات ثم اضغط تشغيل فحص الأذونات.',
    checked: 'نجح فحص الإجراء الأصلي. هذا لا يؤكد وصول النص عبر مشغّل الإشعارات.',
    waitingNotification: 'بانتظار أول إشعار. إذا لم يصل شيء، تأكّد من استخدام «إدخال الاختصار» بدلاً من عبارة الفحص ومن سماح التطبيق المختار بعرض محتوى الإشعار.',
    received: 'وصل نص إشعار إلى هذا الآيفون. هذا سجل استلام في قائمة الانتظار، وليس دليلاً على إضافة عملية.',
    last: 'آخر إشعار مستلم', confirm: 'حفظت أتمتة الإشعارات', confirmed: 'أكّدت حفظ الأتمتة',
    reviewFull: 'مراجعة الإشعارات ممتلئة. راجع التنبيهات الموسومة «التقاط الإشعارات» لإفساح المجال. تبقى الإشعارات الإضافية في القائمة المحمية لمدة تصل إلى ٣٠ يوماً.',
    reviewFullOnboarding: 'مراجعة الإشعارات ممتلئة. أكمل الإعداد ثم راجع التنبيهات الموسومة «التقاط الإشعارات» في وفرة. تبقى الإشعارات الإضافية منتظرة لمدة تصل إلى ٣٠ يوماً.',
    reviewAction: 'مراجعة التنبيهات المنتظرة',
    error: 'تعذّر إكمال الخطوة. لم تتغير معاملاتك الحالية. حاول مجدداً.',
    missing: 'تعذّر فتح الاختصارات. ثبّت تطبيق اختصارات Apple ثم أعد المحاولة.',
    back: 'العودة للإعداد', privacy: 'لا يستطيع وفرة إنشاء أتمتة Apple الشخصية أو فحصها بالنيابة عنك. أدِر الأتمتة الحالية أو أوقفها من الاختصارات. لا يقرأ هذا الإعداد الإشعارات القديمة أو سجل الرسائل.',
  },
} as const;
export const iosNotificationCopy = (language: string) => COPY[language === 'ar' ? 'ar' : 'en'];
