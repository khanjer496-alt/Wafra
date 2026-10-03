/**
 * Copy for the detail and capture-health screens of the redesign: merchants,
 * one merchant, currencies, Review, transfers, Improve categories/accuracy,
 * capture status and Apple Pay setup.
 *
 * Counts go through `enCount` / `arCount` so English says "1 payment" and
 * Arabic uses its six plural categories (0, 1, 2, 3–10, 11–99, 100+) instead
 * of one fixed noun after every number.
 */

export interface ArabicForms {
  /** The whole phrase for exactly one, e.g. "دفعة واحدة". */
  one: string;
  /** The whole phrase for exactly two (dual), e.g. "دفعتان". */
  two: string;
  /** Noun after 3–10 (and 103–110…), plural, e.g. "دفعات". */
  few: string;
  /** Noun after 11–99, accusative singular, e.g. "دفعة" / "متجراً". */
  many: string;
  /** Noun after 0 and 100–102…, genitive singular. Defaults to `many`. */
  other?: string;
}

/** Arabic CLDR plural category for a non-negative integer. */
export function arabicPluralCategory(n: number): 'zero' | 'one' | 'two' | 'few' | 'many' | 'other' {
  const whole = Math.abs(Math.trunc(n));
  if (whole === 0) return 'zero';
  if (whole === 1) return 'one';
  if (whole === 2) return 'two';
  const mod100 = whole % 100;
  if (mod100 >= 3 && mod100 <= 10) return 'few';
  if (mod100 >= 11 && mod100 <= 99) return 'many';
  return 'other';
}

/** "دفعة واحدة", "دفعتان", "5 دفعات", "14 دفعة", "100 دفعة". */
export function arCount(n: number, forms: ArabicForms): string {
  switch (arabicPluralCategory(n)) {
    case 'one': return forms.one;
    case 'two': return forms.two;
    case 'few': return `${n} ${forms.few}`;
    case 'many': return `${n} ${forms.many}`;
    default: return `${n} ${forms.other ?? forms.many}`;
  }
}

/** "1 payment", "3 payments". */
export function enCount(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

const AR_PAYMENTS: ArabicForms = { one: 'دفعة واحدة', two: 'دفعتان', few: 'دفعات', many: 'دفعة' };
const AR_ENTRIES: ArabicForms = { one: 'عملية واحدة', two: 'عمليتان', few: 'عمليات', many: 'عملية' };
const AR_MERCHANTS: ArabicForms = { one: 'تاجر واحد', two: 'تاجران', few: 'تجار', many: 'تاجراً', other: 'تاجر' };
const AR_ANSWERS: ArabicForms = { one: 'إجابة واحدة', two: 'إجابتان', few: 'إجابات', many: 'إجابة' };
const AR_CURRENCIES: ArabicForms = { one: 'عملة واحدة', two: 'عملتان', few: 'عملات', many: 'عملة' };

/** How each converted payment got its ledger amount (the shape `summarizeForeignActivity` returns). */
export type FxQualityCounts = { bankQuotedCount: number; referenceCount: number; estimatedCount: number };

const en = {
  payments: (n: number) => enCount(n, 'payment', 'payments'),
  entries: (n: number) => enCount(n, 'entry', 'entries'),

  merchants: {
    count: (n: number) => enCount(n, 'merchant', 'merchants'),
    sortLabel: 'Sort merchants',
    byAmount: 'By amount',
    byVisits: 'By visits',
    newThisMonth: 'New this month',
    newInPeriod: 'New',
    meta: (category: string, n: number) => `${category} · ${enCount(n, 'payment', 'payments')}`,
    rank: (n: number) => `Rank ${n}`,
    newEmpty: 'No new merchants in this period',
    newNote: 'New means this ledger has no earlier entry with the same merchant name.',
    visitsNote: 'Ranked by number of payments.',
  },

  merchant: {
    monthByMonth: 'Month by month',
    seriesNote: 'Whole months. Months before your first recorded entry are not shown.',
    month: (month: string, amount: string, n: number) => `${month}: ${amount}, ${enCount(n, 'payment', 'payments')}`,
    always: (category: string) => `Always ${category}`,
    alwaysBody: (merchant: string) => `Future ${merchant} charges use this category`,
    noRule: 'No saved category',
    noRuleBody: 'Choose the category Wafra should use for this merchant',
    ruleTitle: 'Category for this merchant',
    ruleAction: 'Change category rule',
    ruleSaved: (category: string) => `Saved: always ${category}`,
  },

  currency: {
    ledgerTitle: 'Ledger currency',
    ledgerBody: (code: string) => `Everything adds up in ${code}`,
    caption: (n: number, currencies: number) =>
      `${enCount(n, 'payment', 'payments')} · ${enCount(currencies, 'currency', 'currencies')}`,
    meta: (amount: string, n: number) => `${amount} · ${enCount(n, 'payment', 'payments')}`,
    filter: (currency: string, n: number) => `${currency} · ${enCount(n, 'payment', 'payments')}`,
    footer: ({ bankQuotedCount: bank, referenceCount: reference, estimatedCount: estimated }: FxQualityCounts): string => {
      const total = (bank || 0) + (reference || 0) + (estimated || 0);
      if (total === 0) return '';
      if (reference === total) return 'Each payment is converted with the reference rate for its own date, and the original amount is kept.';
      if (bank === total) return 'Each payment uses the converted amount your bank reported, and the original amount is kept.';
      if (estimated === total) return 'These use an approximate rate until a reference rate for the payment date is available. The original amount is kept.';
      const parts = [
        bank ? `${enCount(bank, 'payment uses', 'payments use')} the amount your bank reported` : '',
        reference ? `${enCount(reference, 'payment uses', 'payments use')} a reference rate for its own date` : '',
        estimated ? `${enCount(estimated, 'payment uses', 'payments use')} an approximate rate for now` : '',
      ].filter(Boolean);
      return `${parts.join('; ')}. Original amounts are kept.`;
    },
  },

  review: {
    why: {
      currency: 'It is in a currency this ledger cannot hold, so it cannot be added.',
      'not-a-payment': 'This alert is a statement, balance, reminder or pending update, not a completed payment.',
      'amount-choice': 'The alert shows more than one amount.',
      'amount-missing': 'Wafra could not find the amount in this alert.',
      'merchant-unsure': 'Wafra wasn’t sure about the merchant.',
      'unfamiliar-app': 'It came from an app Wafra does not know as a bank.',
      confirm: 'Wafra adds this only after you confirm it.',
    },
    oneByOne: 'Check one at a time',
    showList: 'Show as a list',
    stepTitle: 'Check captures',
    position: (index: number, total: number) => `${index} of ${total}`,
    previous: 'Previous',
    next: 'Next',
    notPurchase: 'Not a purchase',
    looksRight: 'Looks right',
    looksRightHint: 'Opens the entry so you can choose the account and add it',
    amount: 'Amount',
    date: 'Date',
    merchant: 'Merchant',
    merchantMissing: 'Not stated in the alert',
    instrument: 'Card or account',
    original: 'Shown in the currency of the alert',
  },

  transfers: {
    pairsTitle: (n: number) => `${enCount(n, 'possible pair', 'possible pairs')}`,
    pairsBody: 'Same amount, close in time, on two different accounts. Matching keeps both out of spending and income.',
    out: 'Out',
    in: 'In',
    match: 'Match as transfer',
    notPair: 'Not a pair',
    matched: 'Transfer matched',
    notPairDone: 'Kept separate. Each entry stays in the list below.',
    matchedTitle: 'Matched pairs',
    matchedEmpty: 'No matched pairs in this period',
    pairsLink: (n: number) => `${enCount(n, 'possible pair', 'possible pairs')} to check`,
    pairA11y: (out: string, inAccount: string, amount: string) => `${out} to ${inAccount}, ${amount}`,
    showAll: (n: number) => `Show all ${n}`,
    showFewer: 'Show fewer',
  },

  categorise: {
    intro: 'Only merchants Wafra couldn’t place. Your answer also applies to their future charges.',
    choose: 'Choose…',
    staged: (category: string) => `Answer: ${category}`,
    clear: 'Clear answer',
    save: (n: number) => `Save ${enCount(n, 'answer', 'answers')}`,
    saved: (entries: number) => `${enCount(entries, 'entry', 'entries')} moved`,
    pending: (n: number) => `${enCount(n, 'answer', 'answers')} not saved yet`,
  },

  accuracy: {
    openEntry: 'Open entry',
    openEntryHint: 'Rename it or choose its category',
  },

  capture: {
    title: 'Automatic capture',
    working: 'Working',
    lastHandled: (time: string) => `Last handled ${time}`,
    quiet: 'No recent activity',
    quietBody: 'Nothing has been handled for a while. That is normal if you have not paid by card; otherwise check the automation.',
    never: 'Nothing handled yet',
    neverBody: 'Wafra has not handled a message from the automation yet.',
    notIphone: 'Capture status is only available on iPhone.',
    queue: 'in the queue',
    review: 'waiting for you in Review',
    added: 'added from bank alerts this month',
    banksTitle: 'Banks seen in your alerts',
    banksEmpty: 'No bank alerts recorded yet.',
    banksNote: 'The automation passes every message to Wafra; there is no per-bank switch.',
    alsoTitle: 'Also',
    applePay: 'Apple Pay purchases',
    applePayBody: 'Optional · for card taps with no bank text',
    statements: 'Import bank statements',
    statementsBody: 'For months before you set this up',
    troubleTitle: 'Something not arriving?',
    trouble: 'Check the automation step by step',
    openReview: 'Open Review',
    refresh: 'Check again',
    openStatus: 'Open capture status',
  },

  applePay: {
    step1: 'Add the Wafra Apple Pay shortcut',
    step1Body: 'Add it, confirm it, then run the permission check once.',
    step2: 'Create a Wallet automation',
    step2Body: 'Choose your cards, then Run Immediately.',
    example: 'Example',
    exampleMerchant: 'Coffee shop',
    exampleDestination: 'Goes to Review',
    exampleA11y: 'Example only. A card tap arrives with its merchant and amount and waits in Review for you to add it.',
    duplicate: 'If a bank alert looks like a purchase you already saved from Apple Pay, Wafra asks you in Review before adding it.',
    done: 'Done',
  },
};

type DetailsCopy = typeof en;

const ar: DetailsCopy = {
  payments: (n) => arCount(n, AR_PAYMENTS),
  entries: (n) => arCount(n, AR_ENTRIES),

  merchants: {
    count: (n) => arCount(n, AR_MERCHANTS),
    sortLabel: 'ترتيب التجار',
    byAmount: 'حسب المبلغ',
    byVisits: 'حسب عدد الدفعات',
    newThisMonth: 'جديد هذا الشهر',
    newInPeriod: 'جديد',
    meta: (category, n) => `${category} · ${arCount(n, AR_PAYMENTS)}`,
    rank: (n) => `المرتبة ${n}`,
    newEmpty: 'لا يوجد تجار جدد في هذه الفترة',
    newNote: 'الجديد يعني أن السجل لا يحتوي على عملية سابقة باسم التاجر نفسه.',
    visitsNote: 'الترتيب حسب عدد الدفعات.',
  },

  merchant: {
    monthByMonth: 'شهراً بشهر',
    seriesNote: 'أشهر كاملة. لا تظهر الأشهر السابقة لأول عملية مسجلة.',
    month: (month, amount, n) => `${month}: ${amount}، ${arCount(n, AR_PAYMENTS)}`,
    always: (category) => `دائماً ${category}`,
    alwaysBody: (merchant) => `تستخدم عمليات ${merchant} القادمة هذا التصنيف`,
    noRule: 'لا يوجد تصنيف محفوظ',
    noRuleBody: 'اختر التصنيف الذي يستخدمه وفرة لهذا التاجر',
    ruleTitle: 'تصنيف هذا التاجر',
    ruleAction: 'تغيير قاعدة التصنيف',
    ruleSaved: (category) => `حُفظ: دائماً ${category}`,
  },

  currency: {
    ledgerTitle: 'عملة السجل',
    ledgerBody: (code) => `كل المبالغ تُجمع بعملة ${code}`,
    caption: (n, currencies) => `${arCount(n, AR_PAYMENTS)} · ${arCount(currencies, AR_CURRENCIES)}`,
    meta: (amount, n) => `${amount} · ${arCount(n, AR_PAYMENTS)}`,
    filter: (currency, n) => `${currency} · ${arCount(n, AR_PAYMENTS)}`,
    footer: ({ bankQuotedCount: bank, referenceCount: reference, estimatedCount: estimated }) => {
      const total = (bank || 0) + (reference || 0) + (estimated || 0);
      if (total === 0) return '';
      if (reference === total) return 'تُحوَّل كل دفعة بالسعر المرجعي لتاريخها، ويُحتفظ بالمبلغ الأصلي.';
      if (bank === total) return 'تستخدم كل دفعة المبلغ المحوَّل الذي ذكره البنك، ويُحتفظ بالمبلغ الأصلي.';
      if (estimated === total) return 'تستخدم هذه الدفعات سعراً تقريبياً إلى أن يتوفر سعر مرجعي لتاريخها. يُحتفظ بالمبلغ الأصلي.';
      const parts = [
        bank ? `${arCount(bank, AR_PAYMENTS)} بالمبلغ الذي ذكره البنك` : '',
        reference ? `${arCount(reference, AR_PAYMENTS)} بالسعر المرجعي لتاريخها` : '',
        estimated ? `${arCount(estimated, AR_PAYMENTS)} بسعر تقريبي مؤقتاً` : '',
      ].filter(Boolean);
      return `${parts.join('؛ ')}. يُحتفظ بالمبالغ الأصلية.`;
    },
  },

  review: {
    why: {
      currency: 'العملة غير مدعومة في هذا السجل، لذلك لا يمكن إضافتها.',
      'not-a-payment': 'هذا التنبيه كشف حساب أو رصيد أو تذكير أو تحديث معلّق، وليس دفعة مكتملة.',
      'amount-choice': 'يذكر التنبيه أكثر من مبلغ.',
      'amount-missing': 'لم يجد وفرة المبلغ في هذا التنبيه.',
      'merchant-unsure': 'لم يكن وفرة متأكداً من التاجر.',
      'unfamiliar-app': 'وصل من تطبيق لا يعرفه وفرة كتطبيق بنك.',
      confirm: 'لا يضيف وفرة هذه العملية إلا بعد تأكيدك.',
    },
    oneByOne: 'راجعها واحدة تلو الأخرى',
    showList: 'العرض كقائمة',
    stepTitle: 'مراجعة الالتقاطات',
    position: (index, total) => `${index} من ${total}`,
    previous: 'السابق',
    next: 'التالي',
    notPurchase: 'ليست عملية شراء',
    looksRight: 'تبدو صحيحة',
    looksRightHint: 'تفتح العملية لتختار الحساب ثم تضيفها',
    amount: 'المبلغ',
    date: 'التاريخ',
    merchant: 'التاجر',
    merchantMissing: 'غير مذكور في التنبيه',
    instrument: 'البطاقة أو الحساب',
    original: 'بعملة التنبيه',
  },

  transfers: {
    pairsTitle: (n) => `أزواج محتملة: ${n}`,
    pairsBody: 'المبلغ نفسه وفي وقت متقارب على حسابين مختلفين. المطابقة تُبقي الطرفين خارج الإنفاق والدخل.',
    out: 'صادر',
    in: 'وارد',
    match: 'مطابقة كتحويل',
    notPair: 'ليسا زوجاً',
    matched: 'تمت مطابقة التحويل',
    notPairDone: 'بقيا منفصلين. تبقى كل عملية في القائمة أدناه.',
    matchedTitle: 'أزواج مطابقة',
    matchedEmpty: 'لا توجد أزواج مطابقة في هذه الفترة',
    pairsLink: (n) => `أزواج محتملة للمراجعة: ${n}`,
    pairA11y: (out, inAccount, amount) => `${out} إلى ${inAccount}، ${amount}`,
    showAll: (n) => `عرض الكل (${n})`,
    showFewer: 'عرض أقل',
  },

  categorise: {
    intro: 'تظهر هنا فقط المتاجر التي لم يتمكن وفرة من تصنيفها. تنطبق إجابتك على عملياتها القادمة أيضاً.',
    choose: 'اختر…',
    staged: (category) => `الإجابة: ${category}`,
    clear: 'مسح الإجابة',
    save: (n) => n === 1 ? 'حفظ الإجابة' : n === 2 ? 'حفظ الإجابتين' : `حفظ ${arCount(n, AR_ANSWERS)}`,
    saved: (entries) => `نُقلت ${arCount(entries, AR_ENTRIES)}`,
    pending: (n) => `${arCount(n, AR_ANSWERS)} لم تُحفظ بعد`,
  },

  accuracy: {
    openEntry: 'فتح العملية',
    openEntryHint: 'غيّر اسمها أو اختر تصنيفها',
  },

  capture: {
    title: 'الالتقاط التلقائي',
    working: 'يعمل',
    lastHandled: (time) => `آخر معالجة ${time}`,
    quiet: 'لا نشاط حديث',
    quietBody: 'لم تُعالج أي رسالة منذ فترة. هذا طبيعي إن لم تدفع بالبطاقة؛ وإلا فتحقّق من الأتمتة.',
    never: 'لم تُعالج أي رسالة بعد',
    neverBody: 'لم يعالج وفرة أي رسالة من الأتمتة حتى الآن.',
    notIphone: 'حالة الالتقاط متاحة على الآيفون فقط.',
    queue: 'في قائمة الانتظار',
    review: 'بانتظارك في المراجعة',
    added: 'أُضيفت من تنبيهات البنك هذا الشهر',
    banksTitle: 'بنوك ظهرت في تنبيهاتك',
    banksEmpty: 'لم تُسجَّل تنبيهات بنكية بعد.',
    banksNote: 'تمرّر الأتمتة كل رسالة إلى وفرة؛ لا يوجد مفتاح لكل بنك.',
    alsoTitle: 'أيضاً',
    applePay: 'مشتريات Apple Pay',
    applePayBody: 'اختياري · لعمليات البطاقة التي لا يصلها نص من البنك',
    statements: 'استيراد كشوف الحساب',
    statementsBody: 'للأشهر السابقة لهذا الإعداد',
    troubleTitle: 'هل هناك ما لا يصل؟',
    trouble: 'تحقّق من الأتمتة خطوة بخطوة',
    openReview: 'فتح المراجعة',
    refresh: 'تحقّق مجدداً',
    openStatus: 'فتح حالة الالتقاط',
  },

  applePay: {
    step1: 'أضف اختصار Wafra Apple Pay',
    step1Body: 'أضفه وأكّد إضافته ثم شغّل فحص الأذونات مرة واحدة.',
    step2: 'أنشئ أتمتة للمحفظة',
    step2Body: 'اختر بطاقاتك ثم تشغيل فوراً.',
    example: 'مثال',
    exampleMerchant: 'مقهى',
    exampleDestination: 'تنتقل إلى المراجعة',
    exampleA11y: 'مثال فقط. تصل عملية البطاقة مع التاجر والمبلغ وتنتظر في المراجعة حتى تضيفها.',
    duplicate: 'إذا بدا تنبيه البنك مطابقاً لعملية شراء حفظتها من Apple Pay، يسألك وفرة في المراجعة قبل إضافته.',
    done: 'تم',
  },
};

export const detailsCopy = { en, ar } as const;
export const detailsWords = (language: string | null | undefined): DetailsCopy => language === 'ar' ? ar : en;
