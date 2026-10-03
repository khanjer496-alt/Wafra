/**
 * Deterministic, multilingual evidence used to GATE model readings of bank
 * alerts (src/lib/ai-alert-extractor.ts). Nothing here reads an alert on its
 * own: a model proposes, these lexicons only confirm or veto.
 *
 *  - DIRECTION CUES: words that say money left (debit) or arrived (credit).
 *    A model direction is postable only when the text carries a cue of the
 *    same polarity and none of the opposite one. Bare "credit"/"crédito" is
 *    never a cue (credit card, available credit); only forms that describe a
 *    movement are listed. The language of the matched cue is also the
 *    language used by the per-language rollout gates (ai-alert-gates.ts).
 *  - BALANCE CONTEXT: labels that make a second money figure a balance,
 *    limit or due figure instead of a competing transaction amount.
 *  - LOCAL CURRENCY SPELLINGS: country-scoped aliases (درهم, Dhs, ريال, SR,
 *    TL, R, N, P …) applied ONLY for the user's own country, so a bare "R"
 *    means ZAR for a South African user and nothing for anyone else.
 */
import type { CurrencyAliasMap } from '@/lib/alert-draft';
import type { CurrencyCode } from '@/lib/currency-metadata';

export type AiCueLanguage = 'en' | 'ar' | 'es' | 'pt' | 'fr' | 'de' | 'it' | 'nl' | 'tr' | 'id' | 'hi-latn';

export const AI_CUE_LANGUAGES: readonly AiCueLanguage[] = Object.freeze([
  'en', 'ar', 'es', 'pt', 'fr', 'de', 'it', 'nl', 'tr', 'id', 'hi-latn',
]);

// Latin-script word boundaries that also work for accented letters.
const W0 = String.raw`(?<![\p{L}\p{M}\p{N}])`;
const W1 = String.raw`(?![\p{L}\p{M}\p{N}])`;
const words = (list: string): RegExp => new RegExp(`${W0}(?:${list})${W1}`, 'iu');
// Arabic cues may carry a proclitic (بـ / و / ف / لل) and are matched as substrings.
const arabic = (list: string): RegExp => new RegExp(`(?:${list})`, 'u');

interface CueSet { debit: RegExp; credit: RegExp }

const CUES: Readonly<Record<AiCueLanguage, CueSet>> = {
  en: {
    debit: words(String.raw`debited|debit(?!\s*card)|charged|spent|purchased?|purchase|paid(?!\s+you)|payment\s+(?:to|of|at)|withdrawn|withdrawal|withdraw|sent(?!\s+(?:you|to\s+you))|deducted|dr(?![\s.]*(?:card|crd|limit|lmt)\b)|used\s+(?:for|at|on)|transferred\s+to|money\s+out|pur|bought`),
    credit: words(String.raw`credited|cr(?![\s.]*(?:card|crd|limit|lmt)\b)|received|deposit(?:ed)?|refund(?:ed)?|paid\s+you|sent\s+(?:you|to\s+you)|added\s+to|money\s+in|salary|payroll|transferred\s+from`),
  },
  ar: {
    debit: arabic(String.raw`خصم|خُصم|مخصوم|شراء|سحب|دفع|سداد|تسديد|حوالة\s+صادرة|تحويل\s+صادر|مدين`),
    credit: arabic(String.raw`إيداع|ايداع|أودع|اودع|أضيف|اضيف|استرداد|استرجاع|حوالة\s+واردة|تحويل\s+وارد|دائن|راتب|استلام|مستلم`),
  },
  es: {
    debit: words(String.raw`cargo|cargad[oa]s?|compra|pag(?:o|ado|aste|ada)|retiro|retirad[oa]|retiraste|enviad[oa]|enviaste|cobrad[oa]|d[ée]bito|debitad[oa]|transferencia\s+(?:realizada|enviada)`),
    credit: words(String.raw`abono|abonad[oa]|recibid[oa]|recibiste|reembolso|devoluci[óo]n|dep[óo]sito|depositad[oa]|acreditad[oa]|n[óo]mina`),
  },
  pt: {
    debit: words(String.raw`debitad[oa]s?|d[ée]bito|compra|pag(?:o|a|amento)|saque|sacou|enviad[oa]|gastou|cobrad[oa]|efetuad[oa]`),
    credit: words(String.raw`creditad[oa]s?|recebid[oa]|recebeu|recebemos|estorno|reembolso|dep[óo]sito|sal[áa]rio`),
  },
  fr: {
    debit: words(String.raw`d[ée]bit[ée]e?s?|paiement|achat|retrait|pr[ée]lev[ée]e?s?|pr[ée]l[èe]vement|pay[ée]e?|[ée]mis|envoy[ée]e?`),
    credit: words(String.raw`cr[ée]dit[ée]e?s?|re[çc]ue?|remboursement|d[ée]p[ôo]t|salaire`),
  },
  de: {
    debit: words(String.raw`belastet|abgebucht|belastung|bezahlt|kartenzahlung|zahlung|abgehoben|abhebung|bargeldabhebung|gesendet|lastschrift`),
    credit: words(String.raw`gutgeschrieben|gutschrift|eingang|eingegangen|erhalten|erstattung|lohneingang|gehalt`),
  },
  it: {
    debit: words(String.raw`addebitat[oia]|addebito|pagamento|acquisto|prelievo|prelevat[oia]|inviat[oia]|pagat[oia]|speso`),
    credit: words(String.raw`accreditat[oia]|accredito|ricevut[oia]|rimborso|stipendio|bonifico\s+ricevuto`),
  },
  nl: {
    debit: words(String.raw`afgeschreven|betaald|betaling|opname|opgenomen|verstuurd|aankoop|afschrijving`),
    credit: words(String.raw`bijgeschreven|ontvangen|terugbetaling|terugbetaald|storting|salaris|bijschrijving`),
  },
  tr: {
    debit: words(String.raw`harcama(?:n[ıi]z)?|[öo]deme(?:niz)?|[çc]ekildi|[çc]ekim|bor[çc]|g[öo]nderildi|tahsil\s+edildi|al[ıi][şs]veri[şs]`),
    credit: words(String.raw`alacak|yat[ıi]r[ıi]ld[ıi]|gelen|iade|maa[şs]|hesab[ıi]n[ıi]za\s+ge[çc]ti`),
  },
  id: {
    debit: words(String.raw`didebet|debet|pembayaran|pembelian|tarik\s+tunai|ditarik|transfer\s+ke|dikirim|terpotong`),
    credit: words(String.raw`dikreditkan|diterima|dana\s+masuk|uang\s+masuk|pengembalian|gaji|transfer\s+dari`),
  },
  'hi-latn': {
    debit: words(String.raw`debit\s+(?:hue|hua|kiya)|kate|kaate|kat\s+gaye|nikale|nikasi|bhugtan|kharch|bheje|bheja`),
    credit: words(String.raw`credit\s+(?:hue|hua|ho\s+gay[ie])|jama|mile|prapt|wapas`),
  },
};

export interface DirectionCueEvidence {
  debit: boolean;
  credit: boolean;
  /** Languages whose cues matched, in AI_CUE_LANGUAGES order. */
  languages: AiCueLanguage[];
}

export function directionCueEvidence(source: string): DirectionCueEvidence {
  const text = typeof source === 'string' ? source.normalize('NFC') : '';
  let debit = false;
  let credit = false;
  const languages: AiCueLanguage[] = [];
  for (const language of AI_CUE_LANGUAGES) {
    const set = CUES[language];
    const d = set.debit.test(text);
    const c = set.credit.test(text);
    if (d || c) languages.push(language);
    debit ||= d;
    credit ||= c;
  }
  return { debit, credit, languages };
}

/** Which cue words matched (diagnostics/tests only; returns cue words, never other text). */
export function directionCueMatches(source: string): { language: AiCueLanguage; polarity: 'debit' | 'credit'; cue: string }[] {
  const text = typeof source === 'string' ? source.normalize('NFC') : '';
  const out: { language: AiCueLanguage; polarity: 'debit' | 'credit'; cue: string }[] = [];
  for (const language of AI_CUE_LANGUAGES) {
    for (const polarity of ['debit', 'credit'] as const) {
      const m = CUES[language][polarity].exec(text);
      if (m) out.push({ language, polarity, cue: m[0].toLowerCase() });
    }
  }
  return out;
}

/** The direction the text itself supports, or null when absent/contradictory. */
export function cueSupportedDirection(source: string): 'debit' | 'credit' | null {
  const evidence = directionCueEvidence(source);
  if (evidence.debit === evidence.credit) return null;
  return evidence.debit ? 'debit' : 'credit';
}

/**
 * A money figure preceded (same clause, ≤ 32 chars) or immediately followed
 * by one of these labels is a balance / limit / due figure, not a transaction.
 */
const BALANCE_BEFORE = new RegExp([
  String.raw`${W0}(?:avl|avail|available|current|closing|new|ledger|remaining)?\.?\s*(?:bal(?:ance)?|lmt|limit)${W1}`,
  String.raw`${W0}(?:available|avail|avl|saldo|solde|kontostand|bakiye|plafond|disponible|dispon[ií]vel|disponibile|beschikbaar|verf[üu]gbar|limite?|l[ií]mite|kalan|tersedia|sisa|batas|kredit\s+limit|bal)${W1}`,
  String.raw`${W0}(?:minimum|min\.?|total|amount|statement)\s+(?:(?:amount|amt|payment)\s+)?due${W1}`,
  String.raw`${W0}(?:due|outstanding|m[ií]nimo|m[ií]nimum|verschuldigd|f[äa]llig)${W1}`,
  String.raw`الرصيد|رصيد|الحد|المتاح|المستحق|الحد\s+الأدنى`,
].join('|'), 'iu');
const BALANCE_AFTER = new RegExp(String.raw`^\s*(?:is\s+)?(?:available|avl|remaining|disponible|dispon[ií]vel|verf[üu]gbar|kalan|tersedia|متاح|المتاح)${W1}`, 'iu');

export function isBalanceContext(source: string, start: number, end: number): boolean {
  const before = source.slice(Math.max(0, start - 32), start);
  // Stop at a sentence/field boundary: a label in the previous clause does not own this figure.
  const clause = before.split(/[.!?;\n|]\s|[\n|]/u).pop() ?? before;
  if (BALANCE_BEFORE.test(clause)) return true;
  return BALANCE_AFTER.test(source.slice(end, end + 16));
}

/**
 * Local currency spellings, by the user's ISO country. Each maps only to
 * that country's own currency; they are never applied to anyone else.
 */
const LOCAL_CURRENCY_SPELLINGS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  AE: { 'درهم': 'AED', 'دراهم': 'AED', 'د.إ': 'AED', 'د.ا': 'AED', Dhs: 'AED', DHS: 'AED', 'Dhs.': 'AED', Dh: 'AED', DH: 'AED' },
  SA: { 'ريال': 'SAR', 'ر.س': 'SAR', 'رس': 'SAR', SR: 'SAR', 'S.R': 'SAR', 'S.R.': 'SAR' },
  QA: { 'ريال': 'QAR', 'ر.ق': 'QAR', QR: 'QAR' },
  OM: { 'ريال': 'OMR', 'ر.ع': 'OMR', RO: 'OMR', 'R.O.': 'OMR' },
  KW: { 'دينار': 'KWD', 'د.ك': 'KWD', KD: 'KWD' },
  BH: { 'دينار': 'BHD', 'د.ب': 'BHD', BD: 'BHD' },
  JO: { 'دينار': 'JOD', 'د.أ': 'JOD', JD: 'JOD' },
  EG: { 'جنيه': 'EGP', 'ج.م': 'EGP', LE: 'EGP', 'L.E.': 'EGP', 'L.E': 'EGP' },
  MA: { 'درهم': 'MAD', DH: 'MAD', Dhs: 'MAD', DHS: 'MAD' },
  IN: { Rs: 'INR', 'Rs.': 'INR', '₹': 'INR' },
  PK: { Rs: 'PKR', 'Rs.': 'PKR' },
  LK: { Rs: 'LKR', 'Rs.': 'LKR' },
  NP: { Rs: 'NPR', 'Rs.': 'NPR' },
  ZA: { R: 'ZAR' },
  NG: { N: 'NGN', '₦': 'NGN' },
  PH: { P: 'PHP', '₱': 'PHP', Php: 'PHP' },
  TR: { TL: 'TRY', '₺': 'TRY' },
  KE: { Ksh: 'KES', KSh: 'KES', Kshs: 'KES' },
  MY: { RM: 'MYR' },
  ID: { Rp: 'IDR', 'Rp.': 'IDR' },
  CH: { 'Fr.': 'CHF', SFr: 'CHF', 'SFr.': 'CHF' },
  PL: { 'zł': 'PLN' },
  BR: { 'R$': 'BRL' },
  US: { $: 'USD', US$: 'USD' },
  CA: { $: 'CAD', C$: 'CAD', CA$: 'CAD' },
  AU: { $: 'AUD', A$: 'AUD' },
  NZ: { $: 'NZD', NZ$: 'NZD' },
  SG: { $: 'SGD', S$: 'SGD' },
  HK: { $: 'HKD', HK$: 'HKD' },
  MX: { $: 'MXN', MN: 'MXN', MX$: 'MXN' },
  CO: { $: 'COP' },
  CL: { $: 'CLP' },
  AR: { $: 'ARS' },
  JP: { '¥': 'JPY', '円': 'JPY' },
  CN: { '¥': 'CNY', '元': 'CNY' },
};

export function localCurrencyAliases(country: string | null | undefined): CurrencyAliasMap {
  const map = country ? LOCAL_CURRENCY_SPELLINGS[country.toUpperCase()] : undefined;
  if (!map) return {};
  return Object.fromEntries(Object.entries(map).map(([alias, iso]) => [alias, [iso as CurrencyCode]]));
}
