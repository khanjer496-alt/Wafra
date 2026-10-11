/**
 * Review-only institution and alert-template evidence for the first- and
 * second-wave worldwide review markets.
 *
 * This module does not parse money, classify transactions, or authorize an
 * import. It only answers which institution/template grammar a redacted alert
 * may belong to. Callers must keep ambiguous and unknown outcomes in review.
 * Neither the source nor sender is ever returned.
 */

export type InstitutionGrammarMarket =
  | 'US' | 'GB' | 'FR' | 'DE' | 'ES' | 'IT' | 'NL'
  | 'IN' | 'QA' | 'KW' | 'BH' | 'OM' | 'EG' | 'JO'
  | 'CA' | 'AU' | 'BR' | 'MX' | 'SG'
  | 'CO' | 'PE';

export type InstitutionEvidenceKind = 'sender' | 'body';
export type InstitutionGrammarStatus = 'experimental' | 'verified';

export interface InstitutionGrammarMetadata {
  id: string;
  version: number;
  channel: 'bank-alert';
  status: InstitutionGrammarStatus;
  provenance: 'synthetic-seed' | 'consented-redacted' | 'public-template' | 'launch-registry';
}

export type AlertTemplateId =
  | 'authentication'
  | 'card-activity'
  | 'cash-withdrawal'
  | 'fund-transfer'
  | 'recurring-debit'
  | 'fee'
  | 'balance'
  | 'account-debit'
  | 'account-credit';

export interface InstitutionGrammarCandidate {
  institution: string;
  evidence: InstitutionEvidenceKind[];
  grammar: InstitutionGrammarMetadata;
}

export interface AlertTemplateEvidence {
  template: AlertTemplateId;
  evidence: 'source-pattern';
}

export interface AlertInstitutionGrammarReview {
  market: InstitutionGrammarMarket;
  decision: 'identified' | 'ambiguous' | 'unknown';
  institution: string | null;
  template: AlertTemplateEvidence | null;
  candidates: InstitutionGrammarCandidate[];
  reasons: string[];
}

interface InstitutionGrammar {
  institution: string;
  senders: readonly string[];
  body: RegExp;
  /**
   * Numeric short codes a bank sends from but does not own exclusively (a
   * carrier reassigns them, and one code can serve two banks). They count as
   * sender evidence only when the body names the same institution.
   */
  bodyBoundSenders?: readonly string[];
  metadata?: InstitutionGrammarMetadata;
  /**
   * Country qualifier for a brand that also banks in another country (QNB in
   * Egypt, NBK in Egypt, KFH in Bahrain and Turkey, BBK in Kuwait, HSBC
   * everywhere). When present, neither the sender nor the body counts as this
   * market's evidence unless the alert ALSO states the market's own currency
   * (or names the country next to the brand). The name alone never routes.
   */
  qualifier?: RegExp;
  /**
   * The reverse guard, for a brand routed by name in its home market: when
   * this matches, neither the sender nor the body counts as evidence. Citi
   * sends as "CITI" in the US and in the Gulf; a Citi alert stating Qatari,
   * Kuwaiti, Bahraini or Omani money (and no USD) is not a US alert.
   */
  disqualifier?: RegExp;
}

/*
 * Own-currency evidence for the Gulf neighbours: the ISO code, the unique
 * Arabic abbreviation, the spelled-out currency with its country adjective,
 * and the Latin abbreviation only directly beside a figure ("KD 12.500",
 * "12.500 KD"; "QR 150.00", never "QR code"). A bare ريال or دينار is shared
 * by several countries and is never evidence here.
 */
const beside = (token: string): string =>
  String.raw`(?<![\p{L}\p{N}])${token}\s{0,3}\d|\d\s{0,3}${token}(?![\p{L}\p{N}])`;
const QAR_EVIDENCE = new RegExp(String.raw`\bQAR\b|ر\.\s?ق|ريال\s+قطري|${beside('QR')}`, 'iu');
const KWD_EVIDENCE = new RegExp(String.raw`\bKWD\b|د\.\s?ك|دينار\s+كويتي|${beside('KD')}`, 'iu');
const BHD_EVIDENCE = new RegExp(String.raw`\bBHD\b|د\.\s?ب|دينار\s+بحريني|${beside('BD')}`, 'iu');
const OMR_EVIDENCE = new RegExp(String.raw`\bOMR\b|ر\.\s?ع|ريال\s+عماني|${beside(String.raw`R\.O\.?`)}|${beside('RO')}`, 'iu');
const or = (...patterns: RegExp[]): RegExp =>
  new RegExp(patterns.map((pattern) => pattern.source).join('|'), 'iu');
/** Gulf-neighbour own money with no US dollar anywhere in the alert. */
const NEIGHBOUR_MONEY_WITHOUT_USD = new RegExp(
  String.raw`^(?![\s\S]*(?:\bUSD\b|\$))[\s\S]*(?:${or(QAR_EVIDENCE, KWD_EVIDENCE, BHD_EVIDENCE, OMR_EVIDENCE).source})`, 'iu');

const experimentalGrammar = (institution: string): InstitutionGrammarMetadata => ({
  id: `${institution}-sms-v1`,
  version: 1,
  channel: 'bank-alert',
  status: 'experimental',
  provenance: 'synthetic-seed',
});

const grammar = (
  institution: string,
  senders: readonly string[],
  body: RegExp,
): InstitutionGrammar => ({
  institution,
  senders,
  body,
  metadata: experimentalGrammar(institution),
});

const INSTITUTIONS: Record<InstitutionGrammarMarket, readonly InstitutionGrammar[]> = {
  IN: [
    grammar('state-bank-of-india', ['sbi', 'sbibnk', 'sbiinb'], /\b(?:state bank of india|sbi)\b/iu),
    grammar('hdfc-bank', ['hdfcbk', 'hdfcbank'], /\bhdfc bank\b/iu),
    grammar('icici-bank', ['icicib', 'icicibank'], /\bicici bank\b/iu),
    grammar('axis-bank', ['axisbk', 'axisbank'], /\baxis bank\b/iu),
    grammar('kotak-mahindra-bank', ['kotakb', 'kotakbank'], /\bkotak(?: mahindra)? bank\b/iu),
    grammar('punjab-national-bank', ['pnb', 'pnbbank'], /\bpunjab national bank\b/iu),
  ],
  US: [
    { institution: 'jpmorgan-chase', senders: ['chase', 'chasebank'], body: /\b(?:jpmorgan chase|chase bank)\b/iu },
    { institution: 'bank-of-america', senders: ['bankofamerica', 'bofa'], body: /\bbank of america\b/iu },
    { institution: 'wells-fargo', senders: ['wellsfargo'], body: /\bwells fargo\b/iu },
    { institution: 'citi-us', senders: ['citibank', 'citi'], body: /\b(?:citibank|citi bank)\b/iu,
      disqualifier: NEIGHBOUR_MONEY_WITHOUT_USD },
    { institution: 'discover-card-us', senders: ['discover', 'discovercard'], body: /\bdiscover card\b/iu },
  ],
  GB: [
    { institution: 'barclays-uk', senders: ['barclays', 'barclaysuk'], body: /\bbarclays\b/iu },
    { institution: 'hsbc-uk', senders: ['hsbcuk', 'hsbc'], body: /\bhsbc(?: uk)?\b/iu },
    { institution: 'lloyds-bank', senders: ['lloyds', 'lloydsbank'], body: /\blloyds bank\b/iu },
    { institution: 'natwest', senders: ['natwest'], body: /\bnatwest\b/iu },
  ],
  FR: [
    { institution: 'bnp-paribas-fr', senders: ['bnpparibas', 'bnp'], body: /\bbnp paribas\b/iu },
    { institution: 'societe-generale-fr', senders: ['societegenerale', 'sg'], body: /\bsoci(?:é|e)té générale\b|\bsociete generale\b/iu },
    { institution: 'credit-agricole-fr', senders: ['creditagricole', 'ca'], body: /\bcrédit agricole\b|\bcredit agricole\b/iu },
  ],
  DE: [
    { institution: 'deutsche-bank-de', senders: ['deutschebank'], body: /\bdeutsche bank\b/iu },
    { institution: 'commerzbank-de', senders: ['commerzbank'], body: /\bcommerzbank\b/iu },
    { institution: 'sparkasse-de', senders: ['sparkasse'], body: /\bsparkasse\b/iu },
    { institution: 'n26-de', senders: ['n26'], body: /\bn26\b/iu },
  ],
  ES: [
    // Santander and BBVA are multinational. "Banco Santander México/Brasil",
    // "BBVA México" and "BBVA Perú" are those issuers' own brands and must not
    // be read as Spanish body evidence; plain "Banco Santander"/"BBVA" stays ES.
    { institution: 'santander-es', senders: ['santander', 'bancosantander'], body: /\bbanco santander\b(?!\s+(?:m[eé]xico|brasil)\b)/iu },
    { institution: 'bbva-es', senders: ['bbva'], body: /\bbbva\b(?!\s+(?:m[eé]xico|per[uú]|continental|colombia)(?=$|[^\p{L}\p{N}]))/iu },
    { institution: 'caixabank-es', senders: ['caixabank'], body: /\bcaixabank\b/iu },
  ],
  IT: [
    { institution: 'intesa-sanpaolo-it', senders: ['intesasanpaolo', 'intesa'], body: /\bintesa sanpaolo\b/iu },
    { institution: 'unicredit-it', senders: ['unicredit'], body: /\bunicredit\b/iu },
    { institution: 'banco-bpm-it', senders: ['bancobpm', 'bpm'], body: /\bbanco bpm\b/iu },
  ],
  NL: [
    { institution: 'ing-nl', senders: ['ingnl', 'ingbank'], body: /\b(?:ing nederland|ing bank)\b/iu },
    { institution: 'rabobank-nl', senders: ['rabobank', 'rabo'], body: /\brabobank\b/iu },
    { institution: 'abn-amro-nl', senders: ['abnamro'], body: /\babn amro\b/iu },
  ],
  // Gulf neighbours. Every brand here that also banks in another country
  // carries a currency qualifier (see InstitutionGrammar.qualifier). Sender
  // keys exist only where the spec's evidence names one; the rest are
  // body-only until a sender id is verified.
  QA: [
    { institution: 'qnb-qatar', senders: ['qnb', 'qnbqatar'], body: /\bqnb(?: qatar)?\b|بنك قطر الوطني/iu,
      qualifier: or(QAR_EVIDENCE, /\bqnb\s+qatar\b/iu) },
    { institution: 'commercial-bank-qatar', senders: ['cbq', 'cbqbank'], body: /\bcommercial bank(?: of)? qatar\b|البنك التجاري القطري/iu },
    { institution: 'doha-bank', senders: [], body: /\bdoha bank\b|بنك الدوحة/iu, qualifier: QAR_EVIDENCE },
    { institution: 'qatar-islamic-bank', senders: ['qib', 'qibbank'], body: /\bqatar islamic bank\b|مصرف قطر الإسلامي/iu,
      qualifier: QAR_EVIDENCE },
    { institution: 'masraf-al-rayan', senders: [], body: /\bmasraf al[ -]?rayan\b|مصرف الريان/iu },
    { institution: 'dukhan-bank', senders: [], body: /\bdukhan bank\b|بنك دخان/iu },
  ],
  KW: [
    { institution: 'national-bank-of-kuwait', senders: ['nbk', 'nbkbank'], body: /\bnational bank of kuwait\b|بنك الكويت الوطني/iu,
      qualifier: KWD_EVIDENCE },
    { institution: 'kuwait-finance-house', senders: ['kfh', 'kfhonline'], body: /\bkuwait finance house\b|بيت التمويل الكويتي/iu,
      qualifier: KWD_EVIDENCE },
    { institution: 'gulf-bank-kuwait', senders: [], body: /\bgulf bank\b|بنك الخليج/iu, qualifier: KWD_EVIDENCE },
    { institution: 'burgan-bank', senders: [], body: /\bburgan bank\b|بنك برقان/iu, qualifier: KWD_EVIDENCE },
    { institution: 'boubyan-bank', senders: ['boubyan', 'boubyanbank'], body: /\bboubyan bank\b|بنك بوبيان/iu },
    { institution: 'warba-bank', senders: [], body: /\bwarba bank\b|بنك وربة/iu },
    { institution: 'commercial-bank-of-kuwait', senders: [], body: /\bcommercial bank of kuwait\b|البنك التجاري الكويتي/iu },
  ],
  BH: [
    { institution: 'national-bank-of-bahrain', senders: ['nbb', 'nbbonline'], body: /\bnational bank of bahrain\b|بنك البحرين الوطني/iu },
    { institution: 'bank-of-bahrain-and-kuwait', senders: ['bbk', 'bbkbank'], body: /\bbank of bahrain and kuwait\b|بنك البحرين والكويت/iu,
      qualifier: BHD_EVIDENCE },
    { institution: 'ahli-united-bank', senders: [], body: /\bahli united bank\b|البنك الأهلي المتحد/iu, qualifier: BHD_EVIDENCE },
    { institution: 'bahrain-islamic-bank', senders: [], body: /\bbahrain islamic bank\b|بنك البحرين الإسلامي/iu },
    // The Bahraini KFH shares its name with the Kuwaiti one; only BHD decides.
    { institution: 'kuwait-finance-house-bahrain', senders: [], body: /\bkuwait finance house\b|بيت التمويل الكويتي/iu,
      qualifier: BHD_EVIDENCE },
    { institution: 'bank-abc-bahrain', senders: ['bankabc', 'abcbahrain'], body: /\bbank abc\b|بنك\s+abc/iu, qualifier: BHD_EVIDENCE },
  ],
  OM: [
    { institution: 'bank-muscat', senders: ['bankmuscat', 'bmuscat', 'bkmuscat'], body: /\bbank muscat\b|بنك مسقط/iu },
    { institution: 'bank-dhofar', senders: ['bankdhofar', 'dhofarbank'], body: /\bbank dhofar\b|بنك ظفار/iu },
    { institution: 'national-bank-of-oman', senders: [], body: /\bnational bank of oman\b|البنك الوطني العماني/iu },
    { institution: 'sohar-international', senders: ['soharintl', 'soharinternational'], body: /\bsohar international\b|صحار الدولي/iu },
    { institution: 'bank-nizwa', senders: [], body: /\bbank nizwa\b|بنك نزوى/iu },
    // HSBC sends as "HSBC" in the UAE and the UK: only body text naming
    // HSBC Oman, with OMR, is Omani evidence. No sender key.
    { institution: 'hsbc-oman', senders: [], body: /\bhsbc\s+oman\b/iu, qualifier: OMR_EVIDENCE },
  ],
  EG: [
    { institution: 'national-bank-of-egypt', senders: ['nbe', 'nbeegypt'], body: /\bnational bank of egypt\b|البنك الأهلي المصري/iu },
    { institution: 'banque-misr', senders: ['banquemisr', 'bmisr'], body: /\bbanque misr\b|بنك مصر/iu },
    { institution: 'cib-egypt', senders: ['cibegypt', 'cibeg'], body: /\b(?:commercial international bank|cib egypt)\b|البنك التجاري الدولي/iu },
  ],
  JO: [
    { institution: 'arab-bank-jordan', senders: ['arabbank', 'arabbankjo'], body: /\barab bank\b|البنك العربي/iu },
    { institution: 'bank-al-etihad', senders: ['bankaletihad', 'aletihad'], body: /\bbank al etihad\b|بنك الاتحاد/iu },
    { institution: 'housing-bank-jordan', senders: ['housingbank', 'hbtf'], body: /\b(?:housing bank|hbtf)\b|بنك الإسكان/iu },
  ],
  // Second-wave markets. A route to one of these markets lets a bare `$` mean
  // that market's dollar, so brands shared with another SUPPORTED market need
  // country-qualified evidence: TD and BMO also bank in the US, BBVA and
  // Santander in Spain, and Scotiabank in Mexico (left out entirely because
  // neither its sender nor its body names the country). Generic short senders
  // such as "BB" and "NU" are omitted for the same reason.
  CA: [
    { institution: 'royal-bank-of-canada', senders: ['rbc', 'rbcroyalbank'], body: /\b(?:rbc|royal bank of canada)\b/iu },
    { institution: 'td-canada-trust', senders: ['tdcanadatrust', 'tdcanada'], body: /\btd canada trust\b/iu },
    { institution: 'bmo-canada', senders: ['bmocanada', 'bankofmontreal'], body: /\bbank of montreal\b/iu },
  ],
  AU: [
    { institution: 'commonwealth-bank-australia', senders: ['commbank', 'cba'], body: /\b(?:commonwealth bank|commbank)\b/iu },
    { institution: 'anz-australia', senders: ['anz', 'anzbank'], body: /\banz(?: bank)?\b/iu },
    { institution: 'westpac-australia', senders: ['westpac'], body: /\bwestpac\b/iu },
    { institution: 'nab-australia', senders: ['nab', 'nationalaustraliabank'], body: /\bnational australia bank\b/iu },
  ],
  BR: [
    { institution: 'itau-brasil', senders: ['itau', 'itaubank'], body: /(?:^|[^\p{L}\p{N}])ita[uú](?:\s+unibanco)?(?=$|[^\p{L}\p{N}])/iu },
    { institution: 'bradesco-brasil', senders: ['bradesco'], body: /\bbradesco\b/iu },
    // Ourocard is Banco do Brasil's own card brand; a bare "BB" is not evidence.
    { institution: 'banco-do-brasil', senders: ['bancodobrasil'], body: /\bbanco do brasil\b|\bourocard\b/iu },
    { institution: 'nubank-brasil', senders: ['nubank'], body: /\bnubank\b/iu },
    // "Inter" alone is an ordinary word: only the bank's own prefix or names.
    { institution: 'inter-brasil', senders: ['bancointer'], body: /\bbanco\s+inter\b|^\s*inter\s*:|\binter\s+(?:mastercard|shop)\b/iu },
    { institution: 'c6-bank-brasil', senders: ['c6bank'], body: /\bc6\s*bank\b/iu },
    // "caixa eletrônico" is an ATM, not the bank.
    { institution: 'caixa-brasil', senders: ['caixa'], body: /^\s*caixa\s*:|\bcaixa\s+econ[oô]mica\b/iu },
    // Shared brands (Santander also banks in Spain and Mexico, Mercado Pago in
    // most of Latin America) are Brazilian only next to an R$ amount.
    { institution: 'santander-brasil', senders: ['santanderbrasil'], body: /\bsantander\s+brasil\b|\bsantander\b(?=[\s\S]{0,200}R\$)/iu },
    { institution: 'mercado-pago-brasil', senders: [], body: /\bmercado\s*pago\b(?=[\s\S]{0,240}R\$)|R\$[\s\S]{0,240}\bmercado\s*pago\b/iu },
    { institution: 'picpay-brasil', senders: ['picpay'], body: /\bpicpay\b/iu },
  ],
  MX: [
    { institution: 'bbva-mexico', senders: ['bbvamexico', 'bbvamx'], body: /\bbbva\s+m[eé]xico(?=$|[^\p{L}\p{N}])/iu },
    { institution: 'banorte-mexico', senders: ['banorte'], body: /\bbanorte\b/iu },
    { institution: 'santander-mexico', senders: ['santandermx', 'santandermexico'], body: /\bsantander\s+m[eé]xico(?=$|[^\p{L}\p{N}])/iu },
    { institution: 'citibanamex', senders: ['citibanamex', 'banamex'], body: /\b(?:citibanamex|banamex)\b/iu },
  ],
  // Colombia. Numeric short codes are shared between banks (87188 is used for
  // Davivienda and fits the Bancolombia range), so they only agree with a body
  // that names the bank. Nu's app package and brand also serve Brazil and
  // Mexico: only "Nu Colombia" is Colombian evidence.
  CO: [
    { institution: 'bancolombia', senders: ['bancolombia'], bodyBoundSenders: ['85540', '85784', '87400'], body: /\bbancolombia\b/iu },
    { institution: 'davivienda', senders: ['davivienda'], bodyBoundSenders: ['890077', '891000', '87188'], body: /\bdavivienda\b/iu },
    { institution: 'daviplata', senders: ['daviplata'], body: /\bdaviplata\b/iu },
    { institution: 'nequi', senders: ['nequi'], body: /\bnequi\b/iu },
    { institution: 'banco-de-bogota', senders: ['bancodebogota'], body: /\bbanco\s+de\s+bogot[aá](?=$|[^\p{L}\p{N}])/iu },
    { institution: 'nu-colombia', senders: ['nucolombia'], body: /\bnu\s+colombia\b/iu },
  ],
  // Peru. Plin is a wallet rail hosted by several banks; BBVA and Scotiabank
  // count only with "Perú" (or BBVA's former Continental brand).
  PE: [
    { institution: 'bcp', senders: ['bcp', 'viabcp'], bodyBoundSenders: ['19896'], body: /\bbcp\b|\bbanco\s+de\s+cr[eé]dito\s+del\s+per[uú](?=$|[^\p{L}\p{N}])/iu },
    { institution: 'yape', senders: ['yape'], body: /\byape\b/iu },
    // "Interbank transfer" is ordinary banking English: the Peruvian bank's
    // name counts as body evidence only next to soles, PEN or Perú.
    { institution: 'interbank', senders: ['interbank'], body: /\binterbank\b(?=[\s\S]{0,240}(?:S\/\.?\s?\d|\bPEN\b|\bper[uú](?![\p{L}])))|(?:S\/\.?\s?\d|\bPEN\b|\bper[uú](?![\p{L}]))[\s\S]{0,240}\binterbank\b/iu },
    { institution: 'plin', senders: ['plin'], body: /\bplin\b/iu },
    { institution: 'bbva-peru', senders: ['bbvaperu'], body: /\bbbva\s+(?:per[uú]|continental)(?=$|[^\p{L}\p{N}])/iu },
    { institution: 'scotiabank-peru', senders: ['scotiabankperu'], body: /\bscotiabank\s+per[uú](?=$|[^\p{L}\p{N}])/iu },
  ],
  SG: [
    { institution: 'dbs-singapore', senders: ['dbs', 'dbssg', 'posb'], body: /\b(?:dbs(?!\s+bank\s+(?:india|\(?hong\s+kong\)?|taiwan|indonesia|china)\b)|posb)(?: bank)?\b/iu },
    { institution: 'ocbc-singapore', senders: ['ocbc', 'ocbcsg'], body: /\bocbc(?: bank)?\b/iu },
    { institution: 'uob-singapore', senders: ['uob', 'uobsg'], body: /\buob(?: bank)?\b/iu },
  ],
};

const TEMPLATE_RULES: readonly { template: AlertTemplateId; pattern: RegExp }[] = [
  { template: 'authentication', pattern: /\b(?:otp|one[ -]?time password|verification code|security code)\b|رمز (?:التحقق|التأكيد)/iu },
  { template: 'cash-withdrawal', pattern: /\b(?:cash withdrawal|atm withdrawal|geldautomat|retrait d['’]?espèces|retiro de efectivo|prelievo contanti|geldopname|saque(?: em)? caixa eletr[oô]nico)\b|سحب نقدي|صراف آلي/iu },
  { template: 'recurring-debit', pattern: /\b(?:recurring|autopay|auto[ -]?debit|direct debit|standing order|pre-authorized debit|payto|pix autom[aá]tico|d[eé]bito autom[aá]tico|prélèvement|lastschrift|domiciliación|addebito diretto|automatische incasso)\b|خصم (?:تلقائي|دوري)/iu },
  { template: 'card-activity', pattern: /\b(?:card (?:purchase|payment|charged|used)|paiement par carte|kartenzahlung|compra con tarjeta|compra com cart[aã]o|pagamento con carta|pagamento com cart[aã]o|pasbetaling|pinbetaling)\b|شراء[^.\n]{0,24}بطاقة|دفع بالبطاقة/iu },
  { template: 'fund-transfer', pattern: /\b(?:fund transfer|bank transfer|wire transfer|zelle|interac e-?transfer|osko|payid|pix|spei|paynow|upi|imps|neft|rtgs|faster payments|sepa|virement|überweisung|transferencia|bonifico|overboeking)\b|تحويل/iu },
  { template: 'fee', pattern: /\b(?:annual fee|monthly fee|service charge|bank fee|frais|gebühr|comisión|commissione|kosten)\b|رسوم|عمولة/iu },
  { template: 'balance', pattern: /\b(?:available balance|current balance|account balance|solde|kontostand|saldo)\b|الرصيد (?:الحالي|المتاح)/iu },
  { template: 'account-debit', pattern: /\b(?:debited|charged|withdrawn|débité|belastet|abgebucht|cargado|addebitato|afgeschreven|debitad[oa])\b|تم الخصم|خُصم/iu },
  { template: 'account-credit', pattern: /\b(?:credited|deposited|received|crédité|gutgeschrieben|abonado|accreditato|bijgeschreven|creditad[oa]|recebid[oa])\b|تم الإيداع|أودع/iu },
];

const senderKey = (sender: string): string =>
  sender.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, '');

interface IndiaSenderEnvelope {
  core: string;
  route: 'S' | 'T' | 'G' | 'P' | null;
}

const indiaSenderEnvelope = (sender: string): IndiaSenderEnvelope | null => {
  const normalized = sender.slice(0, 256).normalize('NFKC').trim().toUpperCase();
  const match = /^(?:[A-Z]{2}-)([A-Z0-9]+)(?:-([STGP]))?$/.exec(normalized);
  if (!match) return null;
  return { core: senderKey(match[1]), route: (match[2] as IndiaSenderEnvelope['route']) ?? null };
};

const senderMatches = (
  market: InstitutionGrammarMarket,
  sender: string,
  alias: string,
): boolean => {
  const expected = senderKey(alias);
  if (senderKey(sender) === expected) return true;
  if (market !== 'IN') return false;
  // Indian DLT headers may include a two-letter telecom prefix and an exact
  // S/T/G route suffix. P is promotional and is vetoed before matching.
  const envelope = indiaSenderEnvelope(sender);
  return !!envelope && envelope.route !== 'P' && envelope.core === expected;
};

const UNIVERSAL_SENDER_KEYS = new Set(
  Object.values(INSTITUTIONS).flatMap((institutions) =>
    institutions.flatMap((institution) => institution.senders.map(senderKey))),
);
const INDIA_SENDER_KEYS = new Set(
  INSTITUTIONS.IN.flatMap((institution) => institution.senders.map(senderKey)),
);

/**
 * Cheap sender-only guard for the Gulf launch fast path.
 *
 * A name such as HSBC is valid in the UAE registry and a worldwide registry.
 * Those senders must still run full market routing because the body may prove
 * that the alert belongs to the global institution. Exact non-overlapping
 * Gulf senders can safely avoid that work.
 */
export const hasUniversalInstitutionSender = (sender?: string | null): boolean => {
  const bounded = sender?.slice(0, 256) ?? '';
  if (!bounded) return false;
  if (UNIVERSAL_SENDER_KEYS.has(senderKey(bounded))) return true;
  const indiaEnvelope = indiaSenderEnvelope(bounded);
  return !!indiaEnvelope && indiaEnvelope.route !== 'P' && INDIA_SENDER_KEYS.has(indiaEnvelope.core);
};

const templateEvidence = (source: string): AlertTemplateEvidence | null => {
  const normalized = source.normalize('NFKC');
  const rule = TEMPLATE_RULES.find(({ pattern }) => pattern.test(normalized));
  return rule ? { template: rule.template, evidence: 'source-pattern' } : null;
};

/** Inspect one alert without retaining or returning its source or sender. */
export const inspectAlertInstitutionGrammar = (
  source: string,
  market: InstitutionGrammarMarket,
  sender?: string | null,
): AlertInstitutionGrammarReview => {
  const normalizedSource = source.slice(0, 4096).normalize('NFKC');
  const boundedSender = sender?.slice(0, 256) ?? '';
  const normalizedSender = boundedSender ? senderKey(boundedSender) : '';
  const indiaEnvelope = market === 'IN' && boundedSender
    ? indiaSenderEnvelope(boundedSender)
    : null;
  if (indiaEnvelope?.route === 'P') {
    return {
      market,
      decision: 'unknown',
      institution: null,
      template: templateEvidence(normalizedSource),
      candidates: [],
      reasons: ['promotional-sender-route'],
    };
  }
  const candidates = INSTITUTIONS[market].flatMap((grammar) => {
    // A shared brand without its country qualifier is not this market's evidence.
    if (grammar.qualifier && !grammar.qualifier.test(normalizedSource)) return [];
    if (grammar.disqualifier?.test(normalizedSource)) return [];
    const evidence: InstitutionEvidenceKind[] = [];
    const bodyMatches = grammar.body.test(normalizedSource);
    if (normalizedSender && (grammar.senders.some(
      (alias) => senderMatches(market, boundedSender || normalizedSender, alias),
    ) || (bodyMatches && grammar.bodyBoundSenders?.includes(normalizedSender)))) {
      evidence.push('sender');
    }
    if (bodyMatches) evidence.push('body');
    return evidence.length ? [{
      institution: grammar.institution,
      evidence,
      grammar: grammar.metadata ?? experimentalGrammar(grammar.institution),
    }] : [];
  });
  const template = templateEvidence(normalizedSource);

  if (candidates.length === 0) {
    return {
      market, decision: 'unknown', institution: null, template, candidates: [],
      reasons: [
        'no-institution-evidence',
        ...(source.length > 4096 ? ['input-too-long'] : []),
      ],
    };
  }
  if (candidates.length > 1) {
    const senderConflict = candidates.some(({ evidence }) => evidence.includes('sender'));
    return {
      market, decision: 'ambiguous', institution: null, template, candidates,
      reasons: [
        senderConflict ? 'sender-body-conflict' : 'multiple-institution-evidence',
        ...(source.length > 4096 ? ['input-too-long'] : []),
      ],
    };
  }
  return {
    market,
    decision: 'identified',
    institution: candidates[0].institution,
    template,
    candidates,
    reasons: [
      ...(template ? [] : ['no-template-evidence']),
      ...(source.length > 4096 ? ['input-too-long'] : []),
    ],
  };
};
