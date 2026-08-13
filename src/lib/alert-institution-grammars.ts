/**
 * Review-only institution and alert-template evidence for first-wave markets.
 *
 * This module does not parse money, classify transactions, or authorize an
 * import. It only answers which institution/template grammar a redacted alert
 * may belong to. Callers must keep ambiguous and unknown outcomes in review.
 * Neither the source nor sender is ever returned.
 */

export type InstitutionGrammarMarket =
  | 'US' | 'GB' | 'FR' | 'DE' | 'ES' | 'IT' | 'NL'
  | 'IN' | 'QA' | 'KW' | 'BH' | 'OM' | 'EG' | 'JO';

export type InstitutionEvidenceKind = 'sender' | 'body';
export type InstitutionGrammarStatus = 'experimental' | 'verified';

export interface InstitutionGrammarMetadata {
  id: string;
  version: number;
  channel: 'bank-alert';
  status: InstitutionGrammarStatus;
  provenance: 'synthetic-seed' | 'consented-redacted' | 'public-template';
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
  metadata?: InstitutionGrammarMetadata;
}

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
    { institution: 'citi-us', senders: ['citibank', 'citi'], body: /\b(?:citibank|citi bank)\b/iu },
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
    { institution: 'santander-es', senders: ['santander', 'bancosantander'], body: /\bbanco santander\b/iu },
    { institution: 'bbva-es', senders: ['bbva'], body: /\bbbva\b/iu },
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
  QA: [
    { institution: 'qnb-qatar', senders: ['qnb', 'qnbqatar'], body: /\bqnb(?: qatar)?\b|بنك قطر الوطني/iu },
    { institution: 'qatar-islamic-bank', senders: ['qib', 'qibbank'], body: /\bqatar islamic bank\b|مصرف قطر الإسلامي/iu },
    { institution: 'commercial-bank-qatar', senders: ['cbq', 'cbqbank'], body: /\bcommercial bank(?: of)? qatar\b|البنك التجاري القطري/iu },
  ],
  KW: [
    { institution: 'national-bank-of-kuwait', senders: ['nbk', 'nbkbank'], body: /\bnational bank of kuwait\b|بنك الكويت الوطني/iu },
    { institution: 'kuwait-finance-house', senders: ['kfh', 'kfhonline'], body: /\bkuwait finance house\b|بيت التمويل الكويتي/iu },
    { institution: 'boubyan-bank', senders: ['boubyan', 'boubyanbank'], body: /\bboubyan bank\b|بنك بوبيان/iu },
  ],
  BH: [
    { institution: 'national-bank-of-bahrain', senders: ['nbb', 'nbbonline'], body: /\bnational bank of bahrain\b|بنك البحرين الوطني/iu },
    { institution: 'bank-of-bahrain-and-kuwait', senders: ['bbk', 'bbkbank'], body: /\bbank of bahrain and kuwait\b|بنك البحرين والكويت/iu },
    { institution: 'bank-abc-bahrain', senders: ['bankabc', 'abcbahrain'], body: /\bbank abc\b|بنك\s+abc/iu },
  ],
  OM: [
    { institution: 'bank-muscat', senders: ['bankmuscat', 'bmuscat'], body: /\bbank muscat\b|بنك مسقط/iu },
    { institution: 'bank-dhofar', senders: ['bankdhofar', 'dhofarbank'], body: /\bbank dhofar\b|بنك ظفار/iu },
    { institution: 'sohar-international', senders: ['soharintl', 'soharinternational'], body: /\bsohar international\b|صحار الدولي/iu },
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
};

const TEMPLATE_RULES: readonly { template: AlertTemplateId; pattern: RegExp }[] = [
  { template: 'authentication', pattern: /\b(?:otp|one[ -]?time password|verification code|security code)\b|رمز (?:التحقق|التأكيد)/iu },
  { template: 'cash-withdrawal', pattern: /\b(?:cash withdrawal|atm withdrawal|geldautomat|retrait d['’]?espèces|retiro de efectivo|prelievo contanti|geldopname)\b|سحب نقدي|صراف آلي/iu },
  { template: 'recurring-debit', pattern: /\b(?:recurring|autopay|auto[ -]?debit|direct debit|standing order|prélèvement|lastschrift|domiciliación|addebito diretto|automatische incasso)\b|خصم (?:تلقائي|دوري)/iu },
  { template: 'card-activity', pattern: /\b(?:card (?:purchase|payment|charged|used)|paiement par carte|kartenzahlung|compra con tarjeta|pagamento con carta|pasbetaling|pinbetaling)\b|شراء[^.\n]{0,24}بطاقة|دفع بالبطاقة/iu },
  { template: 'fund-transfer', pattern: /\b(?:fund transfer|bank transfer|wire transfer|zelle|upi|imps|neft|rtgs|faster payments|sepa|virement|überweisung|transferencia|bonifico|overboeking)\b|تحويل/iu },
  { template: 'fee', pattern: /\b(?:annual fee|monthly fee|service charge|bank fee|frais|gebühr|comisión|commissione|kosten)\b|رسوم|عمولة/iu },
  { template: 'balance', pattern: /\b(?:available balance|current balance|account balance|solde|kontostand|saldo)\b|الرصيد (?:الحالي|المتاح)/iu },
  { template: 'account-debit', pattern: /\b(?:debited|charged|withdrawn|débité|belastet|abgebucht|cargado|addebitato|afgeschreven)\b|تم الخصم|خُصم/iu },
  { template: 'account-credit', pattern: /\b(?:credited|deposited|received|crédité|gutgeschrieben|abonado|accreditato|bijgeschreven)\b|تم الإيداع|أودع/iu },
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
    const evidence: InstitutionEvidenceKind[] = [];
    if (normalizedSender && grammar.senders.some(
      (alias) => senderMatches(market, boundedSender || normalizedSender, alias),
    )) {
      evidence.push('sender');
    }
    if (grammar.body.test(normalizedSource)) evidence.push('body');
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
