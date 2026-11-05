const en = {
  title: 'Access code',
  body: 'If Wafra gave you a complimentary code, enter it to use Pro on this device. An internet connection keeps your access up to date.',
  active: 'Complimentary access is active.',
  privateMode: 'Private Mode pauses online verification.',
  activate: 'Activate access',
  invalid: 'This code could not be verified. Check it and try again.',
  removed: 'Code removed from this device.',
  unavailable: 'Could not finish the request. Try again.',
  remove: 'Remove code from this device',
};
const ar: typeof en = {
  title: 'رمز الوصول',
  body: 'إذا حصلت على رمز وصول من وفرة، أدخله لتفعيل مزايا برو على هذا الجهاز. يلزم اتصال بالإنترنت للتحقق من صلاحية الرمز.',
  active: 'الوصول المجاني مفعّل.',
  privateMode: 'وضع الخصوصية يوقف التحقق عبر الإنترنت.',
  activate: 'تفعيل الوصول',
  invalid: 'تعذّر التحقق من الرمز. راجعه وحاول مرة أخرى.',
  removed: 'أزيل الرمز من هذا الجهاز.',
  unavailable: 'تعذّر إكمال الطلب. حاول مرة أخرى.',
  remove: 'إزالة الرمز من الجهاز',
};
export const complimentaryCopy = (language: string | undefined) => language === 'ar' ? ar : en;
