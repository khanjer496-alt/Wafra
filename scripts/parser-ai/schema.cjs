'use strict';
/**
 * Labelled bank-alert evaluation row (parser-ai benchmark, phase 1).
 *
 * One row = one alert body plus the TRUE label, independent of what any parser
 * returns today. A field left `undefined` is UNLABELLED (not scored); `null`
 * is a labelled absence ("this alert states no merchant/date").
 *
 * {
 *   id: string,
 *   source: 'repo:<fixture>' | 'synthetic',
 *   country: ISO-3166 alpha-2 | 'ZZ',     // the user's (and alert's) country
 *   language: 'en' | 'ar' | 'es' | ... | 'mixed',
 *   bank: string | null,                  // institution label (fictional values)
 *   sender: string,                       // transport sender id ('' = none)
 *   template: string,                     // template family (split key)
 *   split: 'eval' | 'train' | 'dev' | 'test',
 *   body: string,
 *   label: {
 *     status: 'completed' | 'pending' | 'declined' | 'otp' | 'promo' |
 *             'informational' | 'future' | 'request' | 'unknown',
 *     shouldPost: boolean,                // one completed movement for the ledger
 *     family: 'purchase' | 'refund' | 'transfer' | 'salary' | 'fee' |
 *             'withdrawal' | 'card-payment' | 'bill-payment' | 'non-posting',
 *     direction: 'debit' | 'credit' | 'none',
 *     amount?: { minor: string, currency: string, exponent: 0|2|3 } | null,
 *     merchant?: string | null,           // payee/merchant as written
 *     date?: 'YYYY-MM-DD' | null,         // transaction date stated in the body
 *   },
 *   spans?: [{ label, start, end }],      // synthetic only: exact char offsets
 * }
 *
 * Span labels (synthetic): AMT, CUR, MER, DATE, BAL (a non-transaction figure),
 * CUE_DEBIT, CUE_CREDIT, CUE_NONPOST.
 */

const STATUSES = ['completed', 'pending', 'declined', 'otp', 'promo', 'informational', 'future', 'request', 'unknown'];
const FAMILIES = ['purchase', 'refund', 'transfer', 'salary', 'fee', 'withdrawal', 'card-payment', 'bill-payment', 'non-posting'];
const DIRECTIONS = ['debit', 'credit', 'none'];
const SPAN_LABELS = ['AMT', 'CUR', 'MER', 'DATE', 'BAL', 'CUE_DEBIT', 'CUE_CREDIT', 'CUE_NONPOST'];

/** The user's ledger currency in each benchmarked country. */
const COUNTRY_CURRENCY = Object.freeze({
  US: 'USD', CA: 'CAD', MX: 'MXN', BR: 'BRL', AR: 'ARS', CO: 'COP', CL: 'CLP',
  GB: 'GBP', IE: 'EUR', FR: 'EUR', BE: 'EUR', DE: 'EUR', AT: 'EUR', CH: 'CHF',
  ES: 'EUR', PT: 'EUR', IT: 'EUR', NL: 'EUR', TR: 'TRY',
  AE: 'AED', SA: 'SAR', QA: 'QAR', KW: 'KWD', BH: 'BHD', OM: 'OMR', EG: 'EGP', JO: 'JOD', MA: 'MAD',
  IN: 'INR', PK: 'PKR', ID: 'IDR', MY: 'MYR', PH: 'PHP', SG: 'SGD', HK: 'HKD',
  AU: 'AUD', NZ: 'NZD', PL: 'PLN', SE: 'SEK', KR: 'KRW', TH: 'THB', VN: 'VND', BD: 'BDT', LK: 'LKR', NP: 'NPR', RU: 'RUB', UA: 'UAH', DK: 'DKK', NO: 'NOK', CZ: 'CZK', HU: 'HUF', RO: 'RON', IL: 'ILS', GH: 'GHS', TW: 'TWD', NG: 'NGN', KE: 'KES', ZA: 'ZAR', JP: 'JPY', CN: 'CNY',
});

const normMerchant = (value) => (value ?? '')
  .normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Strict: equal after case/punctuation folding. Loose: >=50% token overlap. */
const merchantMatch = (predicted, expected) => {
  const a = normMerchant(predicted);
  const b = normMerchant(expected);
  if (!a || !b) return { strict: a === b, loose: a === b };
  if (a === b) return { strict: true, loose: true };
  const ta = new Set(a.split(' '));
  const tb = new Set(b.split(' '));
  const inter = [...ta].filter((t) => tb.has(t)).length;
  return { strict: false, loose: inter / Math.max(ta.size, tb.size) >= 0.5 };
};

module.exports = { STATUSES, FAMILIES, DIRECTIONS, SPAN_LABELS, COUNTRY_CURRENCY, normMerchant, merchantMatch };
