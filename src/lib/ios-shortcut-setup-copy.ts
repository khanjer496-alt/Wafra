/** Setup guidance only; never store Apple's free-form error text or message input. */
const copy = {
  en: {
    add: '1 of 3 · Add the Shortcut', check: '2 of 3 · Check the connection', automate: '3 of 3 · Connect new messages',
    bundled: 'Choose Shortcuts in the share sheet, then Add Shortcut. Choose Replace if asked, and keep the name shown here.',
    checkBody: 'Run a quick check. Allow Wafra when Shortcuts asks, then return here.',
    checkNote: 'This checks the connection. A real bank alert will confirm automatic delivery.',
    failed: 'The Shortcut did not complete the check.',
    repair: 'Add the correct Shortcut',
    repairBody: 'First add the exact Shortcut shown below. If Apple showed an error, check the highlighted action in Shortcuts before trying again.',
    name: 'Shortcut name', retry: 'Run the check again',
    permissions: 'Permission help',
    addedCheck: 'I added it — check the connection', editExisting: 'Edit an existing automation',
    existing: 'Already have a Wafra Message automation? Edit it to use this Shortcut instead of creating a second automation.',
  },
  ar: {
    add: '١ من ٣ · أضف الاختصار', check: '٢ من ٣ · افحص الاتصال', automate: '٣ من ٣ · اربط الرسائل الجديدة',
    bundled: 'اختر «الاختصارات» من قائمة المشاركة، ثم أضف الاختصار. اختر «استبدال» إذا ظهر، وأبقِ الاسم الظاهر هنا.',
    checkBody: 'شغّل فحصاً سريعاً. اسمح بالوصول إلى وفرة عندما تطلب الاختصارات ذلك، ثم عد إلى هنا.',
    checkNote: 'هذا يفحص الاتصال. يؤكد تنبيه بنكي حقيقي وصول الرسائل تلقائياً.',
    failed: 'لم يُكمل الاختصار فحص الاتصال.',
    repair: 'إضافة الاختصار الصحيح',
    repairBody: 'أضف أولاً الاختصار بالاسم الظاهر أدناه. إذا عرضت Apple خطأً، افحص الإجراء المحدد في الاختصارات قبل إعادة المحاولة.',
    name: 'اسم الاختصار', retry: 'إعادة فحص الاتصال',
    permissions: 'مساعدة الأذونات',
    addedCheck: 'أضفته — افحص الاتصال', editExisting: 'تعديل أتمتة موجودة',
    existing: 'لديك أتمتة رسائل لوفرة؟ عدّلها لتستخدم هذا الاختصار بدلاً من إنشاء أتمتة ثانية.',
  },
};
export const iosShortcutSetupCopy = (language: string) => copy[language === 'ar' ? 'ar' : 'en'];
