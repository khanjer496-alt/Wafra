import type { Transaction } from '@/lib/types';
import { isTransfer } from '@/lib/ledger';
import { isTransferCandidate } from '@/lib/transfer-reconciliation';

const en = {
  repayment: 'Credit-card repayment', repaymentTag: 'Card repayment',
  repaymentNote: 'Not spending or income',
  repaymentBody: 'This payment goes towards a credit-card balance. It is excluded from spending and income so the card purchases are not counted again.',
  bankCredit: 'Bank credit', bankDebit: 'Bank debit',
  unclear: 'Purpose not confirmed',
  unclearBody: 'The saved bank description does not explain what this payment was for. Check the details before changing its category or marking it as a transfer.',
  received: 'Money received', refund: 'Refund', cashback: 'Cashback',
  recordedDescription: 'Recorded description', kind: 'Transaction type',
};
const ar: typeof en = {
  repayment: 'سداد بطاقة ائتمان', repaymentTag: 'سداد البطاقة',
  repaymentNote: 'لا يُحتسب ضمن الإنفاق أو الدخل',
  repaymentBody: 'هذه الدفعة لسداد رصيد بطاقة ائتمان. لا تُحتسب ضمن الإنفاق أو الدخل حتى لا تُحتسب مشتريات البطاقة مرة أخرى.',
  bankCredit: 'مبلغ وارد من البنك', bankDebit: 'خصم من الحساب',
  unclear: 'الغرض غير مؤكد',
  unclearBody: 'الوصف المحفوظ من البنك لا يوضح الغرض من هذه الدفعة. راجع التفاصيل قبل تغيير فئتها أو اعتبارها تحويلاً.',
  received: 'مبلغ مستلم', refund: 'مبلغ مسترد', cashback: 'استرداد نقدي',
  recordedDescription: 'الوصف المحفوظ', kind: 'نوع المعاملة',
};
export const transactionPresentationWords = (language: string) => language === 'ar' ? ar : en;

/** Mask account/card identifiers for display only. Never write this over evidence. */
export function maskLedgerIdentifiers(value: string): string {
  return value.normalize('NFKC')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/gi, match => `••${match.slice(-4)}`)
    .replace(/(?<![\d٠-٩۰-۹])(?:[\d٠-٩۰-۹][\s-]*){11,33}[\d٠-٩۰-۹](?![\d٠-٩۰-۹])/g,
      match => `••${match.replace(/[\s-]/g, '').slice(-4)}`);
}

const ACRONYMS = new Set(['AE', 'UAE', 'LLC', 'FZE', 'FZCO', 'BR', 'RTA', 'KFC', 'HSBC', 'ADCB', 'ENBD', 'FAB', 'ENOC', 'ADNOC', 'DEWA', 'NMC', 'ATM']);

/** Formatting, not entity resolution. Keep unknown trade names and branch numbers. */
export function readableBankDescription(value: string): string {
  const cleaned = maskLedgerIdentifiers(value).replace(/\s+/g, ' ').trim()
    .replace(/^(?:nfc|iap)\s*-\s*\(\s*g-pay\s*\)\s*-\s*/i, '')
    .replace(/^(?:qlub|paypal|gpay|pos|tap|ziina|mamo)\s*\*\s*/i, '')
    // Only the explicit city + country suffix, not a city inside a trade name.
    .replace(/\s+(?:dubai|sharjah|abu\s+dhabi|ajman)\s+(?:ae|uae)$/i, '')
    .trim();
  if (!cleaned) return maskLedgerIdentifiers(value).trim();
  if (/^urban\s*(?:clap|company)$/i.test(cleaned)) return 'Urban Company';
  // Don't respell mixed-case brands (iHerb, eBay) or complete truncated names.
  return cleaned.split(' ').map(word => {
    if (ACRONYMS.has(word.toUpperCase()) || /[A-Za-z]\d+[A-Za-z]/.test(word)) return word;
    return /^[A-Z][A-Z'-]*$/.test(word)
      ? word.toLowerCase().replace(/^[a-z]/, letter => letter.toUpperCase()) : word;
  }).join(' ');
}

const NAMED_REPAYMENT = /^(?:card(?:\s*[•·*]\s*\d{4})?\s+(?:payment|repayment|settlement)|credit[ -]card\s+(?:payment|repayment|settlement))$/i;
const BANK_ONLY_DESCRIPTION = /^(?:(?:(?:personal|business|corporate)\s+)?(?:internet|online|mobile|digital|telephone)\s+banking|account\s+(?:debit|credit)|(?:to|from)\s+[\d٠-٩۰-۹xX*•· -]+)$/i;

/** One read-only label for rows, details, accessibility and search. No parser, I/O or writes. */
export function transactionPresentation(row: Transaction, language = 'en', internal = false) {
  const words = transactionPresentationWords(language);
  const stored = maskLedgerIdentifiers(row.title);
  const imported = row.source === 'sms' || row.captureSource === 'pdf' || row.captureSource === 'csv' || row.captureSource === 'email';
  const protectedTitle = !imported || row.userEdited === true || row.titleEdited === true;
  const rowTransfer = isTransfer(row);
  const transfer = internal || rowTransfer;
  const candidate = isTransferCandidate(row);
  // Only explain a repayment after accounting already excludes it. A bare
  // TO <number>, ownership decision or bill receipt is not repayment proof.
  const repayment = rowTransfer && !candidate && row.paymentFlowSide === undefined &&
    (row.cardPaymentSide !== undefined || NAMED_REPAYMENT.test(row.title.trim()));
  const purposeUnclear = imported && !protectedTitle && !repayment && !transfer && !candidate &&
    BANK_ONLY_DESCRIPTION.test(stored.trim());
  const creditKind = !repayment && !transfer && !candidate && row.type === 'income'
    ? /^cash\s*back$/i.test(row.title.trim()) ? words.cashback
      : /^refund$/i.test(row.title.trim()) ? words.refund
        : row.category === 'other' ? words.received : null : null;
  const title = protectedTitle ? stored : repayment ? words.repayment
    : purposeUnclear ? row.type === 'income' ? words.bankCredit : words.bankDebit
      : creditKind === words.cashback || creditKind === words.refund ? creditKind
        : readableBankDescription(stored);
  return {
    title, repayment, purposeUnclear,
    tag: repayment ? words.repaymentTag : purposeUnclear ? words.unclear : creditKind,
    note: repayment ? words.repaymentNote : purposeUnclear ? words.unclear : null,
    explanation: repayment ? words.repaymentBody : purposeUnclear ? words.unclearBody : null,
    recordedDescription: title !== stored ? stored : null,
    // Repayments use a neutral unsigned amount; direction remains in the ledger.
    sign: repayment ? 'none' as const : row.type === 'income' ? 'plus' as const : 'minus' as const,
  };
}
