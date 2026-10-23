import type { AlertMarketPack } from '@/lib/alert-market-pack-types';

/**
 * "Your Debit Card ending 1234 has been used for QAR 245.50 at …" (QNB, Bank
 * Muscat). The shared grammar reads the past tense "was used for"; this is the
 * perfect tense of the same completed card spend.
 *
 * These Gulf packs are also LANGUAGE packs: an alert with no single routed
 * market is read by every one of them, so a term here must mean the same thing
 * in any market. A completed-verb phrase does; a bare heading would not.
 */
const CARD_USED_FOR = {
  postedTerms: ['has been used for'],
  debitTerms: ['has been used for'],
  // A card "was used for" an amount is spending even when the alert puts the
  // merchant on its own line ("Debit Card **0055 / was used for QAR 25.70 /
  // at AMBER CENTER"), where the shared "was used for … at" phrase stops.
  // Family only: status and direction still need their own evidence.
  purchaseTerms: ['has been used for', 'was used for'],
} as const;

/**
 * A movement that has not happened, stated in the amount's OWN clause: a
 * condition ("If your Debit Card ending 1234 has been used for QAR 312.75 …
 * without your consent, call …", "إذا تم تنفيذ تحويل … دون علمكم", "في حال
 * تم …"), a question ("هل تم …") or a forecast ("… will be approved"). Read as
 * not-yet-posted. Clause-scoped by the shared reader, so a fraud footer in its
 * own sentence ("… at SHOP. If you did not make this, call us") never cancels
 * the completed movement before it. Added to every Middle East pack, which
 * also makes it apply to any alert no single market owns.
 */
/** Words naming a move between the person's own accounts; see the EG direction lists. */
const OWN_ACCOUNT_MOVE = [
  'حسابك الآخر', 'حسابك الاخر', 'حسابكم الآخر', 'حسابكم الاخر', 'بين حساباتك', 'بين حساباتكم', 'صادرة', 'صادره',
] as const;

const NOT_YET_POSTED = [
  'if your card', 'if your debit card', 'if your credit card', 'if your prepaid card', 'if your account',
  'if your a/c', 'in case your card', 'in case your account', 'should your card', 'should your account',
  'will be approved', 'will be used',
  'إذا تم', 'اذا تم', 'وإذا تم', 'واذا تم', 'إذا ما تم', 'اذا ما تم', 'إذا تمت', 'اذا تمت', 'في حال تم',
  'في حالة تم', 'في حاله تم', 'في حال تمت', 'لو تم', 'لو تمت', 'هل تم', 'هل تمت',
] as const;

/**
 * Figures that did not (or not yet) move, in the amount's own clause — the
 * round-2 shapes the launch grammar now refuses too (sms-parser
 * moneyNoticeKind), for the alerts the universal reader decides here: an
 * "example" ("على سبيل المثال، ستظهر عملية شراء بمبلغ …"), a hedge ("ربما تم
 * استخدام بطاقتك", "may have been used"), a challenge glued to the movement
 * ("…، ألست أنت؟", "… or was it not you?"), an approval or verification hold,
 * a limit notice, nothing charged ("لم يقم <shop> بخصم …"), a returned or
 * fraud-reported payment, money waiting to be accepted, a transfer still
 * being sent, the alert SETTING "إذا قمت بعملية شراء بأكثر من …", a move to
 * the person's own savings account, a bill that arrived, and a subscription
 * that renews later. Each is a phrase, read as
 * not-yet-posted; clause scoping keeps a footer from cancelling a completed
 * movement before it. Both hamza spellings: the reader does not fold them.
 */
const NOT_A_POSTING = [
  'على سبيل المثال', 'علي سبيل المثال', 'مثال:', 'for example', 'example:', 'sample alert',
  'مثلاً:', 'مثلا:', 'نموذج:', 'يرجى تأكيد', 'يرجي تاكيد', 'بالرد بنعم', 'هل تؤكد', 'هل أنت من قام', 'هل انت من قام',
  'ما تم خصم المبلغ', 'ما تم خصم مبلغ', 'لن يتم خصم المبلغ', 'لن يتم خصم مبلغ', 'تعذر خصم', 'قد يتم خصم المبلغ', 'قد يتم خصم مبلغ', 'يبدو أنه تم', 'يبدو انه تم', 'please verify', "couldn't be completed",
  'مثلاً -', 'مثلاً –', 'مثلا -', 'مثلا –', 'مثال |', 'مثال\n', 'نموذج |', 'نموذج\n', 'sample alert.', 'example: a',
  'verify at', 'secure your card:', 'قيد المعالجة',
  'ربما تم', 'قد يكون تم', 'may have been', 'might have been',
  'ألست أنت', 'الست انت', 'أم لم تكن أنت', 'ام لم تكن انت', 'or was it not you', 'or did you not make it',
  'بانتظار موافقتك', 'requires approval', 'waiting for your approval', 'may appear on your', 'for card verification',
  'خاضعة للتسوية', 'خاضعه للتسويه',
  'تم بلوغ الحد', 'limit reached', 'limit applies', 'are available with your new card',
  'charged nothing', 'nothing was charged', 'لم يتم خصم أي مبلغ', 'لم يتم خصم اي مبلغ',
  'ارتدت', 'sent back to you', 'bounced back', 'reported as fraud', 'كعملية احتيال', 'returned to sender',
  'enroll to receive', 'enrol to receive', 'accept within', 'هل تقبله',
  'is being sent', 'has not arrived', 'جارٍ إرسال', 'جار إرسال', 'جاري إرسال', 'جار ارسال', 'جاري ارسال', 'لم تصل حوالتك', 'لم تصل الحوالة', 'لم يصل المبلغ',
  'إذا قمت بعملية شراء بأكثر من', 'اذا قمت بعملية شراء باكثر من', 'إذا قمت بعملية شراء باكثر من',
  'تحويل بين حساباتك', 'from your savings account into your',
  'وصلتك فاتورة', 'new bill received', 'received a new bill',
  'renews tomorrow', 'your subscription will renew on', 'will be renewed on', 'free trial ends', 'تنتهي الفترة التجريبية',
  // A threshold in place of the amount, a payee that is a card issuer's
  // payment account, and the person's own ISA (alert-lab round 3).
  'تم خصم أكثر من', 'تم خصم اكثر من', 'عملية شراء بأكثر من', 'عملية شراء باكثر من', 'charged more than',
  'purchase of more than', 'transactions above',
  'visa card payment', 'mastercard card payment', 'credit card payment', 'mastercard abrechnung',
  'to your isa', 'from your isa', 'من savings account',
] as const;
/**
 * The PAYEE confirming it received the reader's money ("SAMPLE NAME has
 * received your QAR 500.00 transfer") is money OUT. In the debit list beside
 * the shared reader's credit "received", the direction stays unresolved
 * (never income) unless other words settle it.
 */
const PAYEE_RECEIVED_YOURS = ['has received your', 'have received your', 'received your transfer'] as const;
const ME_NOT_POSTED = [...NOT_YET_POSTED, ...NOT_A_POSTING] as const;

export const INDIA_ME_ALERT_MARKET_PACKS = {
  IN: {
    market: 'IN', currencies: ['INR'], currencyAliases: { 'Rs.': ['INR'], Rs: ['INR'] },
    rails: ['upi', 'imps', 'neft', 'rtgs', 'nach', 'ecs', 'aeps', 'bbps', 'fastag'],
    transferTerms: ['fund transfer', 'upi transfer', 'transferred to', 'received from beneficiary'],
    utilityTerms: [
      'electricity bill', 'water bill', 'gas bill', 'mobile bill',
      'बिजली बिल', 'पानी बिल', 'गैस बिल', 'मोबाइल बिल',
    ],
    recurringTerms: ['upi autopay', 'auto debit', 'यूपीआई ऑटोपे', 'ई-मैंडेट'],
    futureTerms: ['will be processed', 'डेबिट किया जाएगा', 'भुगतान देय'],
  },
  QA: {
    // QR is money only directly beside a figure ("QR 150.00"); "QR code"
    // carries no digits and is never read. Aliases apply only after routing.
    market: 'QA', currencies: ['QAR'], currencyAliases: { 'ر.ق': ['QAR'], 'ريال قطري': ['QAR'], QR: ['QAR'] },
    rails: ['fawran', 'tahweel', 'qmp', 'naps', 'qpay'],
    // The Gulf instant-payment rails (Fawran, WAMD, Fawri+, CliQ) are
    // person-to-person transfers. Naming one sets the transfer FAMILY only:
    // a request or pending payment is still not posted, and direction still
    // needs its own words.
    transferTerms: ['transfer', 'تحويل', 'fawran'],
    utilityTerms: ['electricity bill', 'water bill', 'telecom bill', 'فاتورة كهرباء', 'فاتورة مياه', 'فاتورة هاتف'],
    recurringTerms: ['recurring', 'متكرر', 'متكررة'],
    futureTerms: ME_NOT_POSTED,
    // QNB's card alert: "Your Debit Card ending 1234 has been used for QAR
    // 245.50 at LULU …". The shared grammar knows only "was used for"; the
    // perfect tense is the same completed card spend. Declined, pending and
    // OTP wording is still refused by the shared status controls first.
    ...CARD_USED_FOR,
    debitTerms: [...CARD_USED_FOR.debitTerms, ...PAYEE_RECEIVED_YOURS],
  },
  KW: {
    market: 'KW', currencies: ['KWD'], currencyAliases: { KD: ['KWD'], 'د.ك': ['KWD'], 'دينار كويتي': ['KWD'] },
    dotDecimalCurrencies: ['KWD'],
    rails: ['wamd', 'wamdh', 'knet'], transferTerms: ['transfer', 'تحويل', 'wamd'],
    utilityTerms: ['electricity bill', 'water bill', 'telecom bill', 'فاتورة كهرباء', 'فاتورة مياه', 'فاتورة هاتف'], recurringTerms: ['recurring', 'متكرر', 'متكررة'],
    // KFH: "تم إرجاع مبلغ 7.250 د.ك إلى حسابكم … (استرداد عملية شراء)" — money
    // RETURNED to the account is a refund. Direction is still left to the
    // readers: the purchase it reverses is named in the same sentence.
    refundTerms: ['تم إرجاع مبلغ', 'تم ارجاع مبلغ'],
    futureTerms: ME_NOT_POSTED,
    debitTerms: PAYEE_RECEIVED_YOURS,
  },
  BH: {
    market: 'BH', currencies: ['BHD'], currencyAliases: { BD: ['BHD'], 'د.ب': ['BHD'], 'دينار بحريني': ['BHD'] },
    dotDecimalCurrencies: ['BHD'],
    rails: ['fawri+', 'fawri', 'fawateer', 'benefitpay', 'efts'],
    transferTerms: ['transfer', 'تحويل', 'fawri'],
    utilityTerms: ['electricity bill', 'water bill', 'telecom bill', 'فاتورة كهرباء', 'فاتورة مياه', 'فاتورة هاتف'],
    recurringTerms: ['recurring', 'متكرر', 'متكررة'],
    futureTerms: ME_NOT_POSTED,
    debitTerms: PAYEE_RECEIVED_YOURS,
  },
  OM: {
    market: 'OM', currencies: ['OMR'], currencyAliases: { RO: ['OMR'], 'R.O.': ['OMR'], 'ر.ع': ['OMR'], 'ريال عماني': ['OMR'] },
    dotDecimalCurrencies: ['OMR'],
    rails: ['omannet', 'mp-clear', 'mpcss', 'ach'], transferTerms: ['transfer', 'تحويل'],
    utilityTerms: ['electricity bill', 'water bill', 'telecom bill', 'فاتورة كهرباء', 'فاتورة مياه', 'فاتورة هاتف'], recurringTerms: ['recurring', 'متكرر', 'متكررة'],
    // Bank Muscat's bilingual card alert: "Your Debit Card XXXX1234 has been
    // used for OMR 4.200 at …" with its Arabic twin "تم استخدام بطاقتكم …
    // بمبلغ 4.200 ر.ع لدى …". Both are the same completed card spend.
    postedTerms: [...CARD_USED_FOR.postedTerms, 'تم استخدام بطاقتكم', 'تم استخدام بطاقتك'],
    debitTerms: [...CARD_USED_FOR.debitTerms, 'تم استخدام بطاقتكم', 'تم استخدام بطاقتك', ...PAYEE_RECEIVED_YOURS],
    purchaseTerms: [...CARD_USED_FOR.purchaseTerms, 'تم استخدام بطاقتكم', 'تم استخدام بطاقتك'],
    futureTerms: ME_NOT_POSTED,
  },
  EG: {
    market: 'EG', currencies: ['EGP'], currencyAliases: { LE: ['EGP'], 'L.E.': ['EGP'], 'ج.م': ['EGP'] },
    rails: ['instapay', 'ipn', 'meeza'],
    // InstaPay: "You have successfully transferred EGP 750.00 to name@instapay".
    transferTerms: ['transfer', 'تحويل', 'successfully transferred'],
    utilityTerms: ['electricity bill', 'water bill', 'gas bill', 'mobile bill', 'فاتورة كهرباء', 'فاتورة مياه', 'فاتورة غاز', 'فاتورة هاتف'], recurringTerms: ['recurring', 'متكرر', 'متكررة'],
    // Completed Egyptian wording the shared grammar lacks: InstaPay's English
    // push, Vodafone Cash's "تم استلام مبلغ" (an amount was received) and the
    // banks' instant-transfer notices "تم تنفيذ تحويل لحظي" / "تم إضافة تحويل
    // لحظي". Each names a finished movement, never a request or forecast.
    postedTerms: [
      'successfully transferred', 'تم استلام مبلغ', 'تم تنفيذ تحويل', 'تم إضافة تحويل', 'تم اضافة تحويل',
      'تم اضافه تحويل',
    ],
    futureTerms: [...ME_NOT_POSTED, 'to be transferred', 'سيتم تحويل'],
    // Direction comes from WHOSE account the money left or reached ("من
    // حسابكم" = from your account; "إلى حسابكم" = into your account). A move
    // between the person's OWN accounts ("… إلى حسابك الآخر", "بين حساباتك",
    // an outgoing "صادرة" transfer) names both sides, so those words sit in
    // BOTH lists: the lists cancel and direction stays unresolved rather than
    // turning an own-account move into income. So does a deposit "من حسابك"
    // (from your other account): "تم إيداع" is money in.
    debitTerms: [
      'you have successfully transferred', 'you have transferred', 'من حسابك', 'من حسابكم', ...OWN_ACCOUNT_MOVE,
      // QNB Egypt: "Your Debit Card **2132 had a Successful transaction of EGP 16.79 @myfawry".
      'had a successful transaction of', ...PAYEE_RECEIVED_YOURS,
    ],
    creditTerms: [
      'تم استلام مبلغ', 'إلى حسابك', 'الى حسابك', 'إلى حسابكم', 'الى حسابكم', 'تم إضافة تحويل', 'تم اضافة تحويل',
      'تم اضافه تحويل', 'تم إيداع', 'تم ايداع', ...OWN_ACCOUNT_MOVE,
    ],
    // Banque Misr: "تم سحب مبلغ … من ماكينة الصراف الآلي" — the ATM, with its
    // article, which the shared "صراف آلي" phrase does not reach.
    cashTerms: ['الصراف الآلي', 'الصراف الالي'],
    purchaseTerms: ['had a successful transaction of'],
  },
  JO: {
    market: 'JO', currencies: ['JOD'], currencyAliases: { JD: ['JOD'], 'د.أ': ['JOD'], 'دينار': ['JOD'], 'دينار أردني': ['JOD'], 'دينار اردني': ['JOD'] },
    dotDecimalCurrencies: ['JOD'],
    rails: ['cliq', 'efawateercom', 'jomopay', 'ach'], transferTerms: ['transfer', 'تحويل', 'cliq'],
    utilityTerms: ['electricity bill', 'water bill', 'telecom bill', 'فاتورة كهرباء', 'فاتورة مياه', 'فاتورة هاتف'], recurringTerms: ['recurring', 'متكرر', 'متكررة'],
    futureTerms: ME_NOT_POSTED,
    debitTerms: PAYEE_RECEIVED_YOURS,
  },
} as const satisfies Record<string, AlertMarketPack>;
