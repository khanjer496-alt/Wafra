import type { AlertMarketPack } from '@/lib/alert-market-pack-types';

export const INDIA_ME_ALERT_MARKET_PACKS = {
  IN: {
    market: 'IN', currencies: ['INR'], currencyAliases: { 'Rs.': ['INR'], Rs: ['INR'] },
    rails: ['upi', 'imps', 'neft', 'rtgs', 'nach', 'ecs', 'aeps', 'bbps', 'fastag'],
    transferTerms: ['fund transfer', 'transferred to', 'received from beneficiary'],
    utilityTerms: [
      'electricity bill', 'water bill', 'gas bill', 'mobile bill',
      'बिजली बिल', 'पानी बिल', 'गैस बिल', 'मोबाइल बिल',
    ],
    recurringTerms: ['upi autopay', 'auto debit', 'यूपीआई ऑटोपे', 'ई-मैंडेट'],
  },
  QA: {
    market: 'QA', currencies: ['QAR'], currencyAliases: { 'ر.ق': ['QAR'] },
    rails: ['fawran', 'tahweel', 'qmp', 'naps', 'qpay'],
    transferTerms: ['transfer', 'تحويل'],
    utilityTerms: ['electricity bill', 'water bill', 'telecom bill', 'فاتورة كهرباء', 'فاتورة مياه', 'فاتورة هاتف'],
    recurringTerms: ['recurring', 'متكرر'],
  },
  KW: {
    market: 'KW', currencies: ['KWD'], currencyAliases: { KD: ['KWD'], 'د.ك': ['KWD'] },
    rails: ['wamd', 'wamdh', 'knet'], transferTerms: ['transfer', 'تحويل'],
    utilityTerms: ['electricity bill', 'water bill', 'telecom bill', 'فاتورة كهرباء', 'فاتورة مياه', 'فاتورة هاتف'], recurringTerms: ['recurring', 'متكرر'],
  },
  BH: {
    market: 'BH', currencies: ['BHD'], currencyAliases: { BD: ['BHD'], 'د.ب': ['BHD'] },
    rails: ['fawri+', 'fawri', 'fawateer', 'benefitpay', 'efts'],
    transferTerms: ['transfer', 'تحويل'],
    utilityTerms: ['electricity bill', 'water bill', 'telecom bill', 'فاتورة كهرباء', 'فاتورة مياه', 'فاتورة هاتف'],
    recurringTerms: ['recurring', 'متكرر'],
  },
  OM: {
    market: 'OM', currencies: ['OMR'], currencyAliases: { RO: ['OMR'], 'R.O.': ['OMR'], 'ر.ع': ['OMR'] },
    rails: ['omannet', 'mp-clear', 'mpcss', 'ach'], transferTerms: ['transfer', 'تحويل'],
    utilityTerms: ['electricity bill', 'water bill', 'telecom bill', 'فاتورة كهرباء', 'فاتورة مياه', 'فاتورة هاتف'], recurringTerms: ['recurring', 'متكرر'],
  },
  EG: {
    market: 'EG', currencies: ['EGP'], currencyAliases: { LE: ['EGP'], 'L.E.': ['EGP'], 'ج.م': ['EGP'] },
    rails: ['instapay', 'ipn', 'meeza'], transferTerms: ['transfer', 'تحويل'],
    utilityTerms: ['electricity bill', 'water bill', 'gas bill', 'mobile bill', 'فاتورة كهرباء', 'فاتورة مياه', 'فاتورة غاز', 'فاتورة هاتف'], recurringTerms: ['recurring', 'متكرر'],
  },
  JO: {
    market: 'JO', currencies: ['JOD'], currencyAliases: { JD: ['JOD'], 'د.أ': ['JOD'] },
    rails: ['cliq', 'efawateercom', 'jomopay', 'ach'], transferTerms: ['transfer', 'تحويل'],
    utilityTerms: ['electricity bill', 'water bill', 'telecom bill', 'فاتورة كهرباء', 'فاتورة مياه', 'فاتورة هاتف'], recurringTerms: ['recurring', 'متكرر'],
  },
} as const satisfies Record<string, AlertMarketPack>;
