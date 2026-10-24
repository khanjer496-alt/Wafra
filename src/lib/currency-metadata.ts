/**
 * ISO 4217 minor-unit metadata for the universal alert inspector.
 *
 * Source: SIX List One, published 2026-01-01. SIX is the ISO 4217
 * Maintenance Agency. This is deliberately a pinned build-time snapshot:
 * parsing money must not change because a device's ICU/CLDR version changed.
 * Non-currency entries whose minor unit is "N.A." (metals and test codes) are
 * excluded because an alert amount cannot be converted to integer minor units
 * without a defined exponent.
 *
 * https://www.six-group.com/dam/download/financial-information/data-center/
 * iso-currrency/lists/list-one.xml
 */

export const ISO_4217_SNAPSHOT_DATE = '2026-01-01';
export const ISO_4217_SOURCE_URL =
  'https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml';

export const CURRENCY_MINOR_UNITS = {
  AED: 2, AFN: 2, ALL: 2, AMD: 2, AOA: 2, ARS: 2, AUD: 2, AWG: 2, AZN: 2,
  BAM: 2, BBD: 2, BDT: 2, BHD: 3, BIF: 0, BMD: 2, BND: 2, BOB: 2, BOV: 2,
  BRL: 2, BSD: 2, BTN: 2, BWP: 2, BYN: 2, BZD: 2, CAD: 2, CDF: 2, CHE: 2,
  CHF: 2, CHW: 2, CLF: 4, CLP: 0, CNY: 2, COP: 2, COU: 2, CRC: 2, CUP: 2,
  CVE: 2, CZK: 2, DJF: 0, DKK: 2, DOP: 2, DZD: 2, EGP: 2, ERN: 2, ETB: 2,
  EUR: 2, FJD: 2, FKP: 2, GBP: 2, GEL: 2, GHS: 2, GIP: 2, GMD: 2, GNF: 0,
  GTQ: 2, GYD: 2, HKD: 2, HNL: 2, HTG: 2, HUF: 2, IDR: 2, ILS: 2, INR: 2,
  IQD: 3, IRR: 2, ISK: 0, JMD: 2, JOD: 3, JPY: 0, KES: 2, KGS: 2, KHR: 2,
  KMF: 0, KPW: 2, KRW: 0, KWD: 3, KYD: 2, KZT: 2, LAK: 2, LBP: 2, LKR: 2,
  LRD: 2, LSL: 2, LYD: 3, MAD: 2, MDL: 2, MGA: 2, MKD: 2, MMK: 2, MNT: 2,
  MOP: 2, MRU: 2, MUR: 2, MVR: 2, MWK: 2, MXN: 2, MXV: 2, MYR: 2, MZN: 2,
  NAD: 2, NGN: 2, NIO: 2, NOK: 2, NPR: 2, NZD: 2, OMR: 3, PAB: 2, PEN: 2,
  PGK: 2, PHP: 2, PKR: 2, PLN: 2, PYG: 0, QAR: 2, RON: 2, RSD: 2, RUB: 2,
  RWF: 0, SAR: 2, SBD: 2, SCR: 2, SDG: 2, SEK: 2, SGD: 2, SHP: 2, SLE: 2,
  SOS: 2, SRD: 2, SSP: 2, STN: 2, SVC: 2, SYP: 2, SZL: 2, THB: 2, TJS: 2,
  TMT: 2, TND: 3, TOP: 2, TRY: 2, TTD: 2, TWD: 2, TZS: 2, UAH: 2, UGX: 0,
  USD: 2, USN: 2, UYI: 0, UYU: 2, UYW: 4, UZS: 2, VED: 2, VES: 2, VND: 0,
  VUV: 0, WST: 2, XAD: 2, XAF: 0, XCD: 2, XCG: 2, XOF: 0, XPF: 0, YER: 2,
  ZAR: 2, ZMW: 2, ZWG: 2,
} as const;

export type CurrencyCode = keyof typeof CURRENCY_MINOR_UNITS;

export function currencyMinorUnits(code: string): number | null {
  const normalized = code.trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(CURRENCY_MINOR_UNITS, normalized)
    ? CURRENCY_MINOR_UNITS[normalized as CurrencyCode]
    : null;
}

/** Symbol evidence is intentionally many-to-many. Never turn "$" into USD by default. */
export const CURRENCY_SYMBOL_CANDIDATES: Readonly<Record<string, readonly CurrencyCode[]>> = {
  'R$': ['BRL'],
  KSh: ['KES'],
  RM: ['MYR'],
  Rp: ['IDR'],
  'د.إ': ['AED'],
  'د.ب': ['BHD'],
  'ج.م': ['EGP'],
  'د.أ': ['JOD'],
  'د.ك': ['KWD'],
  'ر.ع': ['OMR'],
  'ر.ق': ['QAR'],
  'ر.س': ['SAR'],
  '₹': ['INR'],
  '€': ['EUR'],
  '£': ['GBP'],
  '₩': ['KRW'],
  '₦': ['NGN'],
  '$': ['USD', 'AUD', 'CAD', 'NZD', 'SGD', 'HKD', 'MXN', 'ARS', 'CLP', 'COP'],
  // A QUALIFIED dollar names one currency. "NT$350.00" on a USD ledger was
  // read through the bare "$" and booked as USD 350.00; these spellings are
  // longer than "$", so they win at the same position. C$ is also the
  // Nicaraguan cordoba.
  'US$': ['USD'],
  'NT$': ['TWD'],
  'NZ$': ['NZD'],
  'AU$': ['AUD'],
  'A$': ['AUD'],
  'CA$': ['CAD'],
  'C$': ['CAD', 'NIO'],
  'S$': ['SGD'],
  'HK$': ['HKD'],
  'MX$': ['MXN'],
  '¥': ['JPY', 'CNY'],
  Rs: ['INR', 'PKR', 'LKR', 'NPR', 'MUR', 'SCR'],
  // The abbreviation with its full stop is how Indian, Pakistani and Sri
  // Lankan banks print it ("Rs.1,250.00 spent on HDFC Bank Card"). Without it
  // no amount was found at all and the alert was ignored, not even reviewed.
  'Rs.': ['INR', 'PKR', 'LKR', 'NPR', 'MUR', 'SCR'],
  // Turkish banks print the lira as TL ("456,75 TL"), never TRY.
  TL: ['TRY'],
  // Bangladesh taka as wallets print it ("Tk 1,000.00"); Japanese yen suffix.
  Tk: ['BDT'],
  'Tk.': ['BDT'],
  '৳': ['BDT'],
  '円': ['JPY'],
  // Devanagari rupee abbreviation (India and Nepal both write it).
  'रु': ['INR', 'NPR'],
  // Korean won and Chinese yuan as card SMS print them; the Peruvian sol.
  '원': ['KRW'],
  '元': ['CNY'],
  'S/': ['PEN'],
  'रू': ['INR', 'NPR'],
  // The Arabic word for pound, as Egyptian banks write it ("1,500.00 جنيه").
  'جنيه': ['EGP', 'SDG', 'SSP'],
  // The abbreviation Egyptian bank SMS print after the figure ("3,000.00 جم").
  'جم': ['EGP'],
  // Spellings a local bank prints instead of the ISO code. Each names the
  // currency of the country that writes it that way; "kr" is the one shared
  // by four krone/krona currencies, so it stays ambiguous until a country or
  // ledger currency settles it. The ASCII fallbacks (Kc, zl) exist because
  // 7-bit SMS drops the diacritics.
  kr: ['SEK', 'NOK', 'DKK', 'ISK'],
  'kr.': ['SEK', 'NOK', 'DKK', 'ISK'],
  Kr: ['SEK', 'NOK', 'DKK', 'ISK'],
  'Kč': ['CZK'],
  Kc: ['CZK'],
  'zł': ['PLN'],
  zl: ['PLN'],
  Ft: ['HUF'],
  '₺': ['TRY'],
  '฿': ['THB'],
  'บาท': ['THB'],
  '₫': ['VND'],
  'đ': ['VND'],
  'đồng': ['VND'],
  Ksh: ['KES'],
  Tsh: ['TZS'],
  TSh: ['TZS'],
  USh: ['UGX'],
  '₵': ['GHS'],
  'GH₵': ['GHS'],
  '₱': ['PHP'],
  'Rp.': ['IDR'],
  '₪': ['ILS'],
  '₡': ['CRC'],
  '₲': ['PYG'],
  '₭': ['LAK'],
  '₮': ['MNT'],
  '₽': ['RUB'],
  '₴': ['UAH'],
  '₸': ['KZT'],
  '₼': ['AZN'],
  '₾': ['GEL'],
  // Chinese-script currency NAMES. A name that qualifies the currency
  // ("新台幣", "港幣") is stronger evidence than the generic 元, which the
  // scanner drops when both read the same figure.
  '港幣': ['HKD'],
  '港币': ['HKD'],
  '港元': ['HKD'],
  '新台幣': ['TWD'],
  '新台币': ['TWD'],
  '台幣': ['TWD'],
  '台币': ['TWD'],
  '人民幣': ['CNY'],
  '人民币': ['CNY'],
  '日圓': ['JPY'],
  '日元': ['JPY'],
};

/**
 * Tokens printed only AFTER the figure. A prefix reading of these would take
 * the first digit of whatever follows an ordinary word ("đ 5", "Ft 12",
 * "Kc 5 kcal") as money. Czech and Polish banks print their symbol behind the
 * figure only.
 */
export const SUFFIX_ONLY_CURRENCY_TOKENS: ReadonlySet<string> = new Set([
  'đ', 'đồng', 'บาท', 'Ft', 'جم', 'Kč', 'Kc', 'zł', 'zl',
]);

/**
 * Tokens written in a script that has no spaces between words (Han, Hangul,
 * kana, Thai). The word-boundary test that protects Latin symbols would reject
 * the particle or character that normally follows them ("1,500円を",
 * "30,000원을", "500บาทผ่าน"); there only a glued Latin letter or digit makes
 * the token part of an identifier.
 */
export const UNSPACED_SCRIPT_CHAR = /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;
export const UNSPACED_CURRENCY_TOKEN = /^[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]+$/u;
