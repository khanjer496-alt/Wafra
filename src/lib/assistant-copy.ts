/**
 * Ask Wafra's words. The local tools read English questions, so the
 * `…Question` entries stay the English query in both packs (they are what is
 * asked); what the screen SHOWS for a question goes through
 * `assistantQuestionLabel`. English and Arabic keep identical keys.
 */
export const assistantCopy = {
  title: 'Ask Wafra',
  back: 'Back',
  heading: 'Understand your transactions',
  privacy: 'Answers are calculated on your device from the transactions you have recorded.',
  placeholder: 'Ask about your transactions',
  send: 'Send question',
  understanding: 'Understanding your question…',
  newChat: 'New chat',
  explain: 'Explain this',
  explainCategory: 'Explain this category',
  askMerchant: 'Ask about this merchant',
  askIncome: 'Ask about this income',
  spendingChangedQuestion: 'Why did my spending change?',
  categoryChangedQuestion: (category: string) => `Why did my ${category} spending change?`,
  merchantChangedQuestion: (merchant: string) => `Why did spending at ${JSON.stringify(merchant)} change?`,
  incomeQuestion: (source: string) => `How much income did I receive from ${JSON.stringify(source)}?`,
  recentQuestions: (count: number) => `Showing your last ${count} questions.`,
  includedPortion: (amount: string) => `Included portion of a ${amount} transaction`,
  originalCashRecord: (record: string) => `Cash funding shown above. Original record: ${record}.`,
  reviewFinding: 'Review transactions',
  exploreFinding: 'Explore this',
  dataUsed: 'Coverage',
  coverageCount: (records: number, accounts: number, totalAccounts: number) =>
    `${records} recorded transaction${records === 1 ? '' : 's'} · ${accounts} account${accounts === 1 ? '' : 's'} represented${totalAccounts ? ` · ${totalAccounts} available` : ''}`,
  observedDates: (first: string, last: string) => `Recorded activity: ${first} to ${last}.`,
  period: 'Change reporting period',
  local: 'Calculated on this device',
  localShort: 'On-device',
  onDeviceAiReadyApple: 'Apple Intelligence can help interpret questions on this device. Wafra calculates every amount.',
  onDeviceAiReadyGemini: 'Gemini Nano can help interpret questions on this device. Wafra calculates every amount.',
  onDeviceAiNotEnabled: 'Turn on Apple Intelligence in Settings to let on-device AI interpret more questions. Recorded-data questions still work.',
  onDeviceAiPreparing: 'The on-device model is not ready yet. Recorded-data questions still work.',
  onDeviceAiUnavailable: 'On-device AI is not available on this device. Recorded-data questions still work.',
  onDeviceAiPrepare: 'Download on-device model',
  onDeviceAiDownloading: 'Downloading…',
  onDeviceAiInterpreted: 'Question interpreted by on-device AI. Check the period and filters shown.',
  viewTransactions: 'View transactions',
  viewPayments: 'Review payments',
  evidenceTitle: 'Transactions behind this answer',
  recorded: 'Based on recorded transactions. Missing imports can affect totals and comparisons.',
  stale: 'Your ledger has changed since this answer.',
  refresh: 'Refresh answer',
  failed: 'This answer could not be calculated. Try a shorter question or review your transactions.',
  loading: 'Loading your transactions…',
  emptyTitle: 'Start with your transactions',
  emptyBody: 'Import your history or add a transaction, then ask about spending, income and changes.',
  import: 'Import transactions',
  add: 'Add a transaction',
  noRecords: 'No recorded transactions matched this answer.',
  previous: 'Previous page',
  next: 'Next page',
} as const;

type AssistantCopy = { [K in keyof typeof assistantCopy]: (typeof assistantCopy)[K] extends (...args: infer A) => string
  ? (...args: A) => string : string };

export const assistantCopyAr: AssistantCopy = {
  title: 'اسأل وفرة',
  back: 'رجوع',
  heading: 'افهم عملياتك',
  privacy: 'تُحسب الإجابات على جهازك من العمليات التي سجّلتها.',
  placeholder: 'اسأل عن عملياتك',
  send: 'إرسال السؤال',
  understanding: 'جارٍ فهم سؤالك…',
  newChat: 'محادثة جديدة',
  explain: 'اشرح هذا',
  explainCategory: 'اشرح هذه الفئة',
  askMerchant: 'اسأل عن هذا التاجر',
  askIncome: 'اسأل عن هذا الدخل',
  // Queries for the local tools: the same English question in both packs.
  spendingChangedQuestion: assistantCopy.spendingChangedQuestion,
  categoryChangedQuestion: assistantCopy.categoryChangedQuestion,
  merchantChangedQuestion: assistantCopy.merchantChangedQuestion,
  incomeQuestion: assistantCopy.incomeQuestion,
  recentQuestions: (count: number) => `تظهر آخر ${count} أسئلة.`,
  includedPortion: (amount: string) => `الجزء المحتسب من عملية بقيمة ${amount}`,
  originalCashRecord: (record: string) => `تمويل النقد ظاهر أعلاه. السجل الأصلي: ${record}.`,
  reviewFinding: 'مراجعة العمليات',
  exploreFinding: 'تعمّق في هذا',
  dataUsed: 'التغطية',
  coverageCount: (records: number, accounts: number, totalAccounts: number) =>
    `عمليات مسجّلة: ${records} · حسابات ممثّلة: ${accounts}${totalAccounts ? ` · المتاح: ${totalAccounts}` : ''}`,
  observedDates: (first: string, last: string) => `النشاط المسجّل: من ${first} إلى ${last}.`,
  period: 'تغيير الفترة',
  local: 'محسوب على هذا الجهاز',
  localShort: 'على الجهاز',
  onDeviceAiReadyApple: 'يمكن لـ Apple Intelligence المساعدة في فهم الأسئلة على هذا الجهاز. وفرة تحسب كل المبالغ.',
  onDeviceAiReadyGemini: 'يمكن لـ Gemini Nano المساعدة في فهم الأسئلة على هذا الجهاز. وفرة تحسب كل المبالغ.',
  onDeviceAiNotEnabled: 'فعّل Apple Intelligence من الإعدادات ليفهم الذكاء الاصطناعي على الجهاز مزيداً من الأسئلة. أسئلة البيانات المسجّلة تعمل كما هي.',
  onDeviceAiPreparing: 'نموذج الجهاز ليس جاهزاً بعد. أسئلة البيانات المسجّلة تعمل كما هي.',
  onDeviceAiUnavailable: 'الذكاء الاصطناعي على الجهاز غير متاح على هذا الجهاز. أسئلة البيانات المسجّلة تعمل كما هي.',
  onDeviceAiPrepare: 'تنزيل نموذج الجهاز',
  onDeviceAiDownloading: 'جارٍ التنزيل…',
  onDeviceAiInterpreted: 'فسّر الذكاء الاصطناعي على الجهاز السؤال. راجع الفترة والمرشحات الظاهرة.',
  viewTransactions: 'عرض العمليات',
  viewPayments: 'مراجعة الدفعات',
  evidenceTitle: 'العمليات وراء هذه الإجابة',
  recorded: 'مبنية على العمليات المسجّلة. قد تؤثر العمليات غير المستوردة في المجاميع والمقارنات.',
  stale: 'تغيّر سجلك منذ هذه الإجابة.',
  refresh: 'تحديث الإجابة',
  failed: 'تعذّر حساب هذه الإجابة. جرّب سؤالاً أقصر أو راجع عملياتك.',
  loading: 'جارٍ تحميل عملياتك…',
  emptyTitle: 'ابدأ بعملياتك',
  emptyBody: 'استورد سجلك أو أضف عملية، ثم اسأل عن الإنفاق والدخل والتغيّرات.',
  import: 'استيراد العمليات',
  add: 'إضافة عملية',
  noRecords: 'لا توجد عمليات مسجّلة تطابق هذه الإجابة.',
  previous: 'الصفحة السابقة',
  next: 'الصفحة التالية',
};

export function assistantCopyFor(language: string | null | undefined): AssistantCopy {
  return language === 'ar' ? assistantCopyAr : assistantCopy;
}

/** The suggestions the local tools offer, as an Arabic reader sees them. */
const AR_QUESTIONS: Record<string, string> = {
  'How much did I spend?': 'كم أنفقت؟',
  'Why did my spending change?': 'لماذا تغيّر إنفاقي؟',
  'What payments are due soon?': 'ما الدفعات المستحقة قريباً؟',
  'Anything unusual?': 'هل هناك شيء غير معتاد؟',
  'What are my largest purchases?': 'ما أكبر مشترياتي؟',
  'What is my recorded history?': 'ما الفترة التي يغطيها سجلي؟',
  'Which recurring charges changed?': 'أي الخصومات المتكررة تغيّرت؟',
  'What subscriptions do I have?': 'ما اشتراكاتي؟',
  'Which account did I use most?': 'أي حساب استخدمته أكثر؟',
  'What is due in the next 7 days?': 'ما المستحق خلال الأيام السبعة القادمة؟',
  'Show those transactions': 'اعرض تلك العمليات',
  'Compare the same dates': 'قارن التواريخ نفسها',
  'What about last month?': 'وماذا عن الشهر الماضي؟',
  'Why did it change?': 'لماذا تغيّر؟',
  'What is my highest month?': 'ما أعلى شهر لدي؟',
  'When did I last spend this much?': 'متى أنفقت هذا المبلغ آخر مرة؟',
  'Exclude rent': 'استبعد الإيجار',
  'How much did I spend excluding rent?': 'كم أنفقت دون الإيجار؟',
};

/** Left-to-right isolate: English inside an Arabic line keeps its own order ("How much?", not "?How much"). */
export const ltrIsolate = (text: string): string => `\u2066${text}\u2069`;

const ARABIC_LETTER = /[\u0600-\u06FF]/;

/**
 * What a question (or any English line from the local tools) looks like on
 * screen: the Arabic wording when Wafra has one, otherwise the English kept
 * in its own left-to-right run so its punctuation stays at its end.
 */
export function assistantQuestionLabel(question: string, language: string | null | undefined): string {
  if (language !== 'ar' || ARABIC_LETTER.test(question)) return question;
  const known = AR_QUESTIONS[question.trim()];
  if (known) return known;
  const category = /^Why did my (.+) spending change\?$/.exec(question.trim());
  if (category) return `لماذا تغيّر إنفاقي على ${ltrIsolate(category[1]!)}؟`;
  const excluding = /^How much did I spend excluding (.+)\?$/.exec(question.trim());
  if (excluding) return `كم أنفقت دون ${ltrIsolate(excluding[1]!)}؟`;
  const merchant = /^Why did spending at "(.+)" change\?$/.exec(question.trim());
  if (merchant) return `لماذا تغيّر الإنفاق لدى ${ltrIsolate(merchant[1]!)}؟`;
  const income = /^How much income did I receive from "(.+)"\?$/.exec(question.trim());
  if (income) return `كم دخلاً تلقيت من ${ltrIsolate(income[1]!)}؟`;
  return ltrIsolate(question);
}

/** An English answer line inside the Arabic screen, kept left-to-right. */
export function assistantText(text: string, language: string | null | undefined): string {
  return language === 'ar' && text && !ARABIC_LETTER.test(text) ? ltrIsolate(text) : text;
}
