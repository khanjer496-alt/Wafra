export const PARSER_RESEARCH_SCHEMA = 1;
export const PARSER_RESEARCH_SHAPES_MAX = 40;
export const PARSER_RESEARCH_TEMPLATE_MAX = 280;

export const PARSER_RESEARCH_REDACTION = {
  rawMessages: false,
  digits: 'masked',
  freeText: 'allowlist',
  senders: 'known-bank-or-alias',
  timestamps: false,
} as const;

const TEMPLATE_WORDS = new Set(`
  a about account acct ac at atm authentication available balance bank
  by card cash charged charge charges cheque completed credit credited current
  debit debited deposit deposited due ending fee for from has have in into is
  limit made minimum mobile movement of on one paid payment purchase purchased
  received ref reference refund refunded reversal reversed salary sent spent
  statement successful successfully thank the through to transaction transfer
  transferred using via was were withdrawal withdrawn with your
  adcb adib ajman alinma albilad aljazira alahli anb banque cbd cbi d dib d360
  emirates enbd fab fransi hsbc islamic liv mashreq nbf pay rajhi rakbank riyad
  sab saudi sharjah sib snb stc urpay wio
  aed sar usd eur gbp inr qar kwd bhd omr jod egp
  merchant party email url iban text sender
  حساب الحساب بطاقة بطاقتك البنك بنك شراء عملية معامله معاملة خصم خصمت سحب
  نقدي ايداع إيداع تحويل تم تمت الى إلى من لدى عند في على مبلغ بقيمة ريال
  درهم رصيد الرصيد المتاح الحالي حد الائتمان مستحق دفع دفعة فاتورة كشف راتب
  استرداد مرجع رقم باستخدام عبر بنجاح شكرا شكراً الخاص بك
`.trim().split(/\s+/u).map((word) => word.toLocaleLowerCase('en')));

const SAFE_BANK_SENDERS = new Set([
  'Emirates NBD', 'FAB', 'ADCB', 'ADIB', 'DIB', 'Mashreq', 'RAKBANK', 'CBD',
  'HSBC', 'Emirates Islamic', 'Sharjah Islamic', 'NBF', 'Wio', 'Liv',
  'Ajman Bank', 'CBI', 'Al Rajhi', 'SNB AlAhli', 'Riyad Bank', 'Alinma',
  'Bank Albilad', 'SAB', 'ANB', 'Banque Saudi Fransi', 'Bank AlJazira',
  'stc pay', 'urpay', 'D360',
]);

export const isParserResearchTemplateWord = (word: string): boolean =>
  TEMPLATE_WORDS.has(word.toLocaleLowerCase('en'));

export const isSafeParserResearchTemplate = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length < 1 || value.length > PARSER_RESEARCH_TEMPLATE_MAX ||
    /[\p{N}@]/u.test(value) || /\b(?:https?:\/\/|www\.)/iu.test(value) ||
    /[^\p{L}#\s.,:;!?\-\/()[\]*+'"•=₹$€£¥،؛]/u.test(value)) return false;
  return [...value.matchAll(/\p{L}+/gu)]
    .every((match) => isParserResearchTemplateWord(match[0]));
};

export const isSafeParserResearchSender = (value: unknown): value is string =>
  typeof value === 'string' &&
  (SAFE_BANK_SENDERS.has(value) || /^\[sender [A-Z]{1,3}\]$/.test(value));
