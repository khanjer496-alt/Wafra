import { missingUniversalField, type UniversalBankEvent, type UniversalParseContext } from '@/lib/universal-types';
import {
  accountMovementDirection, endsWithEuropeanFooterQuestion, englishNoticeOpenerWithdrawn, europeanHeadingMovement,
  europeanMessageDoubt, hasEuropeanPackWording, namesReaderAsPayee, worldStatusDoubt,
  inspectMarketAlert, withAlertSemanticsMemo,
} from '@/lib/alert-semantics';
import type { MoneyDirection, PostingStatus, UniversalMarket } from '@/lib/alert-market-pack-types';
import { findStatusWords, withPlainSpaces, type StatusConcept } from '@/lib/alert-status-lexicon';
import { extractUniversalFields } from '@/lib/universal-fields';
import { extractUniversalMoney, inspectUniversalMoneyDraft } from '@/lib/universal-money';
import {
  isReviewOnlyLatamInstitution,
  latamTemplateEvent,
  matchLatamTemplate,
} from '@/lib/latam-alert-templates';
import {
  endsWithFooterQuestion,
  isApplicationPurchaseOffer,
  isExpectedFutureMoneyNotice,
  isTransactionVerificationChallenge,
} from '@/lib/bank-alert-semantic-rules';

const emptyEvent = (issue: string): UniversalBankEvent => ({
    version: 1, decision: 'ignore', family: 'unknown', status: 'unknown', direction: 'unknown',
    amount: missingUniversalField(), statementTotal: missingUniversalField(), minimumDue: missingUniversalField(),
    balance: missingUniversalField(), creditLimit: missingUniversalField(), merchant: missingUniversalField(),
    transactionDate: missingUniversalField(), dueDate: missingUniversalField(), statementDate: missingUniversalField(),
    instrument: missingUniversalField(), observations: [], issues: [issue],
});

// These supply existing language vocabularies, not a claim about the source's
// country. ISO money remains inspectable outside this finite market registry.
const LANGUAGE_PACKS: readonly UniversalMarket[] = [
  'US', 'GB', 'FR', 'DE', 'ES', 'IT', 'NL',
  'IN', 'QA', 'KW', 'BH', 'OM', 'EG', 'JO',
  // Portuguese, Polish, Swedish, Danish, Norwegian and Czech wording. Their
  // terms are whole words of those languages (alert-market-packs.us-eu.ts).
  'PT', 'PL', 'SE', 'DK', 'NO', 'CZ',
];
const EUROPEAN_CURRENCY = /^(?:EUR|CHF|PLN|SEK|DKK|NOK|CZK|ISK)$/u;
/** A card issuer or card-bill collector named as a payee (universal-parser card settlement). */
const CARD_ISSUER_PAYEE = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${[
  String.raw`american\s+express|amex|barclaycard|barclays\s+bank\s+ireland|advanzia(?:\s+bank)?|hanseatic\s+bank|genialcard`,
  String.raw`credit\s+one(?:\s+bank)?|comenity(?:\s+bank)?|(?:[\p{L}&.-]{1,40}\s+)?store\s+card|bank\s+card|crd\s+pmt|card\s+pmt|cc\s+pmt|redcard`,
  String.raw`merrick\s+bank|mission\s+lane|petal\s+card|bread\s+financial|milestone\s+card|vanquis|aqua\s+card|resurs\s+bank|macy['’]?s\s+card`,
  String.raw`dkb\s+visa|(?:mastercard|visa|kreditkarten?)[\s-]*abrechnung|kreditkartenabrechnung|international\s+card\s+services`,
  String.raw`apple\s+card|gs\s+bank|goldman\s+sachs\s+bank|capital\s+one|synchrony(?:\s+bank)?|citi\s*cards?`,
  String.raw`chase\s+(?:card|sapphire|freedom|slate)|entercard|bank\s+norwegian|re:member|nexi|cartasi|cofidis|tf\s+bank`,
  String.raw`card\s+complete|paylife|cornercard|swisscard|viseca|cetelem|beobank|wizink|unibanco|agos|citi\s+handlowy`,
  String.raw`forbrugsforeningen|mbna|avant\s+money|amex\s+bank|landesbank\s+berlin|deutsche\s+kreditbank|santander\s+consumer(?:\s+bank)?`,
  String.raw`creditcards?|card\s+services|citi(?:bank)?|kreditkort\p{L}*|lbb|zinia|consors\s+finanz|dkb\s+ag|cap\s+one|syncb|td\s+bank\s+card|goldman\s+sachs`,
  String.raw`wells\s+fargo\s+card|credit\s+crd(?:\s+autopay)?|crd\s+autopay|card\s+autopay`,
].join('|')})(?![\p{L}\p{N}])`, 'giu');
/** Issuer names that are also words, in capitals only: "Incasso … ICS", "You paid Discover Card". */
// A payee spelled in capitals with a card word ("VISA CARD PAYMENT", "BANK OF
// IRELAND CREDIT CARD", "AIR BANK KREDITNI KARTA", "SEB KORT") is a card bill.
/** Multi-word card nouns in any case ("Visa Card Payment", "Kreditni Karta"). */
const CARD_PAYEE_WORDS = /(?<![\p{L}\p{N}])(?:card\s+payment|credit\s+card|kreditni\s+karta|karta\s+kredytowa|carte\s+de\s+cr[ée]dit|tarjeta\s+de\s+cr[ée]dito|carta\s+di\s+credito|cart[ãa]o\s+de\s+cr[ée]dito)(?![\p{L}\p{N}])/giu;
// Read in capitals; a caseless SMS ("Incasso 450,00 Eur Ics") is read in its capitalised copy.
const CARD_ISSUER_CODE = /(?<![\p{L}\p{N}])(?:ICS|BARCLAYS|DISCOVER(?:\s+CARD)?|Discover(?:\s+[Cc]ard)?|CARD\s+PAYMENT|CREDIT\s+CARD|KREDITKARTE|KREDITKORT|KREDITNI\s+KARTA|KARTA\s+KREDYTOWA|CARTE|CART[AÃ]O|CARTA|KORT|MASTERCARD|VISA)(?![\p{L}\p{N}])/gu;
/** The card named right after is the reader's instrument: "VISA ****1234", "VISA ending 1234". */
const INSTRUMENT_AFTER = /^[ \t]*(?:(?:debit|credit|card|karte|carte|kort|cart[ãa]o|tarjeta)\s*)?(?:(?:[x*•#]+|[·.]{2,})\s*\d|\d{4}(?!\d)|ending|endend|se\s+terminant|terminad|che\s+termina|eindigend|som\s+slut|ko[nń]c)/iu;
const TO_OWN_CARD = /(?<![\p{L}])(?:to|an|auf|à|a|aan|naar|til|till|para|per|do|na)\s+(?:your|ur|ihre[rnms]?|deine[rnms]?|votre|vos|tu|su|tua|sua|seu|uw|je|jouw|din|ditt|dit|dine|tw[oó]j\p{L}*|va[šs]\p{L}*)\s+(?:\p{L}+\s+){0,1}$/iu;
// (Only after a paying or transferring verb: "charged to your credit card" names the card paid WITH.)
const CREDIT_CARD_TARGET = new RegExp(String.raw`(?<!\p{L})(?:betalat|betalt|betalte|bezahlt|überwiesen|ueberwiesen|gezahlt|payé|versé|viré|pagado|pagato|versato|ingresado|betaald|overgemaakt|pago|pagou|transferiu|zapłacono|zapłaciłeś|zapłaciłaś|przelano|zaplatili|zaplaceno|overført|överfört|indbetalt|innbetalt|einbezahlt|transférés?|transferido|trasferito)\s+` +
  String.raw`(?:[^.!?\n]{0,60}?\s)?(?:till|an|auf|à|au|a|naar|aan|til|do|na|al|para|sur|pro|op|sul|sulla|en)\s+` +
  String.raw`(?:(?!(?:with|using|mit|avec|par|con|med|met|com|z|s|kartą|kartou)(?!\p{L}))[^\s\d.!?]+\s+){0,3}` +
  String.raw`(?:kreditkort\p{L}*|credit\s+card|kreditkarte\p{L}*|carte\s+(?:de\s+)?cr[ée]dit|tarjeta\s+de\s+cr[ée]dito|carta\s+di\s+credito|` +
  String.raw`creditcard|karta\s+kredytow\p{L}*|kart[ęy]\s+kredytow\p{L}*|kreditn[íi]\s+kart\p{L}*|cart[ãa]o\s+de\s+cr[ée]dito)(?!\p{L})`, 'iu');
const PAID_TO_CARD_OR_BANK = new RegExp(String.raw`(?<!\p{L})(?:paid|betalat|betalt|betalte|bezahlt|payé|pagado|pagato|betaald|pagou|zaplatili)\s+` +
  String.raw`(?:(?:[^.!?\n]|\.\d){0,40}?\s)?(?:to|till|til|an|à|a|aan|para|na|do)\s+(?:(?!(?:with|using|by|via|from|your|at|mit|avec|con|med|met|com)(?!\p{L}))[\p{L}&.'’-]{1,30}\s+){1,3}` +
  String.raw`(?:card|redcard|bank|financial|charge|cc\s+pmt|kort|karte|carte|tarjeta|carta|kreditkort)(?!\p{L})`, 'iu');
// Money sent ONTO a credit card, the verb last ("250,00 EUR wurden auf Ihre Kreditkarte überwiesen"),
// or paid "for your Citi card payment".
const ONTO_CREDIT_CARD = new RegExp(String.raw`(?<!\p{L})(?:auf|an|op|naar|på|til|till|na)\s+(?:[\p{L}&.'’-]{1,30}\s+){0,3}` +
  String.raw`(?:kreditkarte\p{L}*|creditcard|kreditkort\p{L}*|karta\s+kredytow\p{L}*|kart[ęy]\s+kredytow\p{L}*)\s+` +
  String.raw`(?:\p{L}+\s+){0,2}(?:überwiesen|ueberwiesen|eingezahlt|gezahlt|bezahlt|overgemaakt|betaald|överfört|overført|innbetalt|indbetalt|przelane|wpłacone)(?!\p{L})|` +
  String.raw`\bfor\s+(?:your\s+)?(?:[\p{L}&.'’-]{1,30}\s+){0,3}card\s+(?:payment|bill|pmt)\b`, 'iu');
// "will arrive tomorrow / in 2 days", "Funds available on Monday", "Expect it within 1-3 days", "Delivery by Friday".
const CREDIT_LATER = /\barriv(?:e|es|ing)\s+(?:by\s+|on\s+)?(?:tomorrow|later|soon|in\b|within|next|\p{L}+day)|\bavailable\s+(?:on|from|by|after)\s+(?:\p{L}+day|the\s+next|next|tomorrow)|\bexpect\s+(?:it|them|the\s+(?:money|funds|payment))\b|\bdelivery\s+(?:by|on|within|expected)\b|\bwithin\s+\d+(?:\s*[-–]\s*\d+)?\s+(?:business\s+|working\s+|bank\s+)?days\b|\bnext\s+business\s+day\b/iu;
const PAID_TO_READER = /\b(?:has\s+been|have\s+been|had\s+been|was|were|is|been)\s+(?:paid|sent|transferred|deposited|credited|added)\s+(?:in)?to\s+your\b/iu;
const PAID_BY_OTHER = new RegExp(String.raw`(?<!\p{L})(?:betaald\s+door|bezahlt\s+von|beglichen\s+von|pay[ée]e?s?\s+par|pagad[oa]\s+por|pagat[oa]\s+da|pag[oa]\s+por|betalt\s+av|betalt\s+af|betald\s+av|betalad\s+av|zap[łl]acon[aeoy]?\s+przez|zaplacen[ao]?\s+od|paid\s+by)\s+` +
  // (Not the card or wallet it was paid with: "paid by card", "payée par carte".)
  String.raw`(?!(?:your\s+|votre\s+|tu\s+|su\s+|la\s+|il\s+|de\s+)?(?:card|carte|cb|tarjeta|carta|kart|karte|kort|visa|master|maestro|debit|credit|apple|google|samsung|contactless|cheque|check|direct|ideal|bancontact|domiciliaci|addebito|bizum|swish|vipps|mobilepay|blik)(?!\p{L})|(?:your|votre)\s+(?:card|carte))`, 'iu');
const NEXT_FUNCTION_WORD = /^(?:WAS|IS|HAS|HAVE|HAD|WERE|WILL|BEEN|TO|FOR|ON|AT|IN|OF|WITH|FROM|AND|OR|BY|DUE|VIA|WURDE|IST|HAT|AM|AN|AUF|VON|FÜR|MIT|UND|EST|A|À|DE|ET|ES|FUE|HA|È|E|IS|ER|ÄR|BLEV|BLE|JE|BYLA|BYL|FOI|ZOSTAŁA|ZOSTAL)$/u;
const ISSUER_SUFFIX = /^(?:bank|banque|banca|banco|card|cards|carte|carta|cart[ãa]o|karta|kort|kredit\p{L}*|kreditkarte|creditcards?|credit|europe|ireland|canada|uk|us|usa|deutschland|danmark|norge|sverige|espa[ñn]a|france|carte-france|services?|payments?|visa|mastercard|ag|gmbh|plc|sa|nv|bv|ab|as|asa|spa|ltd|inc|n\.?a\.?|aecs|ducato|genialcard|abrechnung|finanz|e-?payments?|autopay|payment|pmt|bill|epay)$/iu;
const PAYEE_PREPOSITION = /(?<![\p{L}])(?:to|at|an|à|a|bei|aan|naar|til|till|hos|do|pro|para|per|su|sur|presso|chez|en|em|no|na|u|w|dla|bij|with|from|von|de|da|van|fra|från|od|of|door|by|لدى|عند|من|في|إلى|الى)\s+(?:the\s+)?$/iu;
/** A payee or merchant field ("Händler: MASTERCARD ABRECHNUNG"), a bill noun or a dash after the amount. */
const PAYEE_FIELD = /(?:(?<![\p{L}])(?:händler|haendler|empfänger|commerçant|commercant|bénéficiaire|beneficiaire|comercio|beneficiario|esercente|begunstigde|comerciante|sprzedawca|butik|butikk|forretning|obchodník|merchant|payee|beneficiary)\s*[:：]?\s*|(?<![\p{L}])(?:facture|factura|fatura|fattura|faktura|fakturu|regning|incasso|recibo|lastschrift|prélèvement|domiciliation|autogiro|avtalegiro|betalingsservice|لفاتورة|فاتورة)\s+(?:\p{L}+\s+){0,1}|[-–·]\s*)$/iu;
// (A currency code may be written "Eur" in a title-cased SMS.)
const AFTER_AMOUNT = /(?:\d[\d.,']*\s*(?:[A-Z]{3}|(?:Eur|Usd|Gbp|Chf|Sek|Nok|Dkk|Pln|Czk|eur|usd|gbp|chf|sek|nok|dkk|pln|czk)|[$€£¥₹]|kr\.?|KR\.?|zł|ZŁ|Kč|KČ)|(?:[A-Z]{3}|[A-Z]{0,2}[$€£¥₹])\s?\d[\d.,']*)\s*[-–·:|]?\s*$/u;
const LINE_SUBJECT = /(?:^|\n)\s*(?:[^\p{L}\p{N}\s]+\s*)?(?:[\p{L}][\p{L}\p{N} &'’.-]{0,30}:\s*)?$/u;
const COLLECTING_VERB = /^\s+(?:a\s+pr[ée]lev[ée]|te\s+ha\s+cobrado|ha\s+cobrado|(?:has\s+)?charged|hat\s+(?:\S+\s+){0,6}?(?:abgebucht|eingezogen)|heeft\s+(?:\S+\s+){0,6}?afgeschreven|ha\s+addebitato|cobrou|pobra[łl]|har\s+(?:dragit|trukket|hævet))/iu;
/** The reader's own instrument before an issuer name: "your", "Ihrer", "votre". */
const OWN_BEFORE = /(?<![\p{L}\p{N}])(?:your|ur|ihre[rnms]?|deine[rnms]?|votre|vos|tua|sua|seu|uw|jouw|din|ditt|dit|dine|tw[oó]j\p{L}*|va[šs]\p{L}*)\s+(?:\p{L}+\s+){0,1}$/iu;
/** A card word after a preposition or label is the card paid WITH: "mit VISA", "par CARTE", "Karte: VISA". */
const INSTRUMENT_BEFORE = /(?:(?<![\p{L}\p{N}])(?:ta|tu|su|je|with|using|via|by|on|mit|avec|con|com|met|med|par|por|z|s)\s+(?:\p{L}+\s+){0,1}|(?:card|karte|carte|tarjeta|carta|cart[ãa]o|kaart|karta|kort|kortet)\s*[:-]?\s*|بطاقت?ك?\s*)$/iu;
/** The amount is a threshold, not a movement: "more than $100.00", "$100.00 limit". */
const THRESHOLD_BEFORE = /(?:(?<![\p{L}\p{N}])(?:upwards\s+of|in\s+excess\s+of|(?:more|greater|higher|larger|less|lower)\s+than(?:\s+or\s+equal\s+to)?|at\s+or\s+above|ab|over|above|exceed(?:s|ed|ing)?|at\s+least|up\s+to|mehr\s+als|plus\s+de|m[áa]s\s+de|pi[uù]\s+di|mais\s+de|meer\s+dan|powy[żz]ej|mer\s+än|mere\s+end|mer\s+enn|v[íi]ce\s+ne[žz]|sup[ée]rieure?s?\s+[àa]|superiore\s+a|oltre|[öo]ver|ponad|superior\s+a|mayor\s+(?:de|que|a)|maior\s+(?:de|que)|acima\s+de|boven|groter\s+dan|st[öo]rre\s+[äa]n|st[øo]rre\s+end|h[øo]yere\s+enn|vy[šs][šs][íi]\s+ne[žz]|[أا]كثر\s+من|بأكثر\s+من|[أا]على\s+من|يتجاوز|تتجاوز)\s+|(?<![\p{L}\p{N}"'/=])(?:&gt;|[>≥])=?\s*)(?:the\s+|your\s+)?(?:\p{Lu}{1,3})?$/iu;
const THRESHOLD_AFTER = /^\s*(?:\(?\s*(?:alert\s+)?(?:limit|threshold|limite|límite|limiet)\b|(?:or|and)\s+(?:more|above|over|higher|greater|up)\b|\(?\s*(?:above|over|exceeding)\s+(?:your|the)\b|oder\s+mehr\b|ou\s+plus\b|o\s+m[áa]s\b|o\s+pi[uù]\b|ou\s+mais\b|of\s+meer\b|eller\s+mer\b|eller\s+mere\b|lub\s+wi[eę]cej\b|nebo\s+v[íi]ce\b)/iu;
/** Money between the reader's own accounts and savings spaces, in the launch languages. */
const OWN_ACCOUNT_MOVE = new RegExp([
  String.raw`\b(?:my|your|own)\s+(?:\p{L}+\s+){0,2}?(?:savings?|pot|vault|isa)\b|\byour\s+other\s+account\b|\bown\s+account\b|\bsavings\s+(?:account|pot|space|vault)\b`,
  String.raw`(?<![\p{L}])(?:livret|compte\s+(?:d['’])?[ée]pargne|plan\s+d['’][ée]pargne|entre\s+vos\s+comptes)(?![\p{L}])`,
  // ("…JEANLIVRETA": the savings book glued onto the name.)
  String.raw`(?<=\p{L})livret(?:\s*a)?(?![\p{L}])`,
  String.raw`(?<![\p{L}])(?:tagesgeld\p{L}*|festgeld\p{L}*|sparkonto|sparbuch|unterkonto|(?:n26|revolut|bunq)\s+spaces?|eigenes?\s+konto|umbuchung|wertpapierdepot|(?:ins|auf\s+(?:dein|ihr))\s+depot|trade\s+republic|scalable\s+capital)(?![\p{L}])`,
  String.raw`(?<![\p{L}])(?:cuenta\s+(?:de\s+)?ahorro|hucha|entre\s+(?:tus|sus)\s+cuentas|traspaso|conto\s+deposito|conto\s+risparmio|salvadanaio|giroconto|tra\s+i\s+tuoi\s+conti)(?![\p{L}])`,
  String.raw`(?<![\p{L}])(?:spaarrekening|spaarpot|spaardoel|eigen\s+rekening|tussen\s+(?:je|uw)\s+rekeningen|conta\s+poupan[çc]a|poupan[çc]a|mealheiro|entre\s+contas)(?![\p{L}])`,
  String.raw`(?<![\p{L}])(?:oszcz[eę]dno\p{L}*|skarbonk\p{L}*|przelew\s+w[łl]asny|mi[eę]dzy\s+(?:swoimi|w[łl]asnymi)|sparkonto|sparande|egna\s+konton|opsparing\p{L}*|egen\s+konto|sparekonto|spořicí\p{L}*|spoření|vlastní\s+účet|sporici\s+ucet|vlastni\s+ucet|eget\s+konto|moje\s+cele|savings|حساب\s+التوفير)(?![\p{L}])`,
  String.raw`(?<![\p{L}])(?:chip(?![ \t]+\p{L})|moneybox|raisin|ally\s+bank|premium\s+bonds|ns&i)(?![\p{L}])`,
].join('|'), 'giu');
const OWN_ACCOUNT_ABBREVIATION = /(?<![\p{L}\p{N}])(?:LEP|PEL|LDDS|CEL|PEA|ISA)(?![\p{L}\p{N}])/gu;
/** Money moved TO or FROM the destination: "to MY SAVINGS", "à LIVRET A", "von N26 SPACE", "into your savings account". */
const OWN_ACCOUNT_LEAD = /(?<![\p{L}])(?:to|into|from|à|vers|sur|an|auf|aufs|ins|von|naar|van|til|till|fra|från|para|a|de|da|do|na|od|z|paid|sent|transferred|moved|fakturu|zaplatili|betalt|pagaste|enviou|enviaste|من|إلى|الى)\s+(?:[^\s\d]+\s+){0,3}$|\(\s*$/iu;
const EUROPEAN_EXAMPLE_OR_BILL = /(?<!\p{L})(?:por\s+ejemplo|par\s+exemple|zum\s+beispiel|beispielsweise|muster-benachrichtigung|bijvoorbeeld|ad\s+esempio|per\s+esempio|por\s+exemplo|na\s+przykład|till\s+exempel|for\s+eksempel|například|nieuwe\s+rekening|nieuwe\s+factuur|nueva\s+factura|nouvelle\s+facture|neue\s+rechnung|nuova\s+fattura|nuova\s+bolletta|ny\s+r[äa]kning|nowy\s+rachunek|nova\s+fatura|nowa\s+faktura|ny\s+faktura|ny\s+regning|nová\s+faktura)(?!\p{L})/iu;
const EUROPEAN_UNCLAIMED = /(?<!\p{L})(?:(?:accepteren|accepter|akzeptieren|annehmen|aceitar|aceptar|accettare|zaakceptuj|zaakceptować|godkänna|acceptere|akseptere|přijmout)\s*\?|vil\s+du\s+(?:ta\s+imot|modtage|tage\s+imod)|vill\s+du\s+ta\s+emot|ta\s+imot\s+(?:pengene|beløpet|betalingen)|créez\s+votre\s+compte|pour\s+(?:le|la|les)\s+recevoir|ative\s+o\s+mb\s+way|para\s+(?:o\s+)?receber|um\s+(?:es|das\s+geld|den\s+betrag)\s+zu\s+erhalten|para\s+(?:recibirlo|cobrarlo|aceptarlo)|per\s+riceverl[oi]|om\s+het\s+te\s+ontvangen|aby\s+(?:odebrać|odebrac|przyjąć)|chcete\s+(?:přijmout|prijmout))(?!\p{L})/iu;
const commonDirection = (directions: MoneyDirection[]): MoneyDirection => {
  const known = [...new Set(directions.filter((value) => value === 'debit' || value === 'credit'))];
  return known.length === 1 ? known[0] : 'unknown';
};
const conservativeStatus = (statuses: PostingStatus[]): PostingStatus => {
  for (const value of ['failed', 'future', 'informational', 'posted'] as const) {
    if (statuses.includes(value)) return value;
  }
  return 'unknown';
};

// Callers supply only the fixed grammar strings below. Never cache message
// text, extracted values or parser results across people, messages or scans.
const phrasePatterns = new Map<string, RegExp>();
const phrase = (pattern: string): RegExp => {
  const cached = phrasePatterns.get(pattern);
  if (cached) return cached;
  const compiled = new RegExp(
    `(?:^|[^\\p{L}\\p{M}\\p{N}])(?:${pattern})(?=$|[^\\p{L}\\p{M}\\p{N}])`, 'iu');
  if (phrasePatterns.size >= 64) phrasePatterns.clear();
  phrasePatterns.set(pattern, compiled);
  return compiled;
};

const REVIEW_ONLY_ISSUER_HINT = /plin|interbank|bbva|scotiabank|santander|banamex/iu;

/** Completed movement predicates, independent of issuer/country selection. */
const completedMovement = (source: string): { status: PostingStatus; direction: 'debit' | 'credit'; family: UniversalBankEvent['family'] } | null => {
  const text = source.normalize('NFKC').replace(/\s+/gu, ' ');
  const debitPatterns = [
    phrase(String.raw`spend\s+at|sent\s+to`),
    phrase(String.raw`paiement(?:\s+par\s+carte)?\s+(?:effectué|réalisé|exécuté)`),
    phrase(String.raw`kartenzahlung\s+(?:erfolgreich|abgeschlossen)`),
    phrase(String.raw`compra\s+realizada(?:\s+con\s+tarjeta)?`),
    phrase(String.raw`(?:factura[\s\S]{0,100}pagada|pago\s+se\s+ha\s+completado)`),
    phrase(String.raw`compra\s+aprovada\s+no\s+cartão`),
    phrase(String.raw`mensalidade[\s\S]{0,100}paga|pagamento\s+concluído`),
    phrase(String.raw`pagamento\s+con\s+carta\s+eseguito`),
    phrase(String.raw`acquisto\s+completato`),
    phrase(String.raw`kaartbetaling\s+voltooid`),
    phrase(String.raw`afgeschreven\s+voor\s+(?:een\s+)?pasbetaling`),
    phrase(String.raw`overboeking\s+voltooid[\s\S]{0,100}afgeschreven`),
    phrase(String.raw`alışveriş(?:iniz)?\s+(?:gerçekleşmiştir|tamamlandı)`),
    phrase(String.raw`تم\s+(?:سداد|خصم)`),
    /भुगतान\s+सफल\s+हुआ/u,
    // Indonesian "transaksi ... berhasil" (transaction ... successful), a
    // card "charged to card ... at" shop, and Japan's card-usage notice.
    phrase(String.raw`transaksi[\s\S]{0,100}berhasil`),
    // Indian UPI account alerts: "A/C X1234 debited by 450.0 ... trf to ZOMATO".
    phrase(String.raw`debited\s+by[\s\S]{0,80}?\btrf\s+to`),
    // Spanish/Portuguese/Polish/Peruvian finished card charges, a Ghanaian
    // mobile-money payment, and the Korean card approval (승인, never 승인취소).
    phrase(String.raw`se\s+ha\s+realizado\s+un\s+cargo`),
    phrase(String.raw`compra\s+de[\s\S]{0,40}efetuad[ao]`),
    phrase(String.raw`transakcja[\s\S]{0,100}zrealizowana`),
    phrase(String.raw`realizaste\s+un\s+consumo`),
    phrase(String.raw`payment\s+made\s+for`),
    // A German direct debit that has been charged (a single one is not a
    // subscription by itself; recurrence is the subscription detector's call).
    phrase(String.raw`lastschrift[\s\S]{0,100}\b(?:belastet|abgebucht)`),
    // Only the approval line itself: "[신한카드] 승인 12,000원 ...". 승인거절,
    // 승인대기, limit notices and adverts are not purchases.
    /\[[^\]]{1,12}카드\]\s*(?:해외\s*)?승인\s+[\d,]+원/u,
    /डेबिट\s+(?:किया\s+गया|किए\s+गए)/u,
    phrase(String.raw`charged\s+to\s+(?:your\s+)?card[\s\S]{0,60}\bat`),
    // Chase's authorised-user alert: a header, then the cardholder's name in
    // capitals: "Prime Visa 1234: ALEX made a $19.99 transaction with CAFE".
    // Case-sensitive on purpose; "someone/SOMEONE made …" is a fraud prompt.
    /(?:^|:[ \t]*)(?!(?:SOMEONE|SOMEBODY|ANYONE|ANYBODY|UNKNOWN)\b)[A-Z][A-Z'.-]+(?:[ \t]+[A-Z][A-Z'.-]+){0,3}[ \t]+made[ \t]+an?[ \t]+(?!(?:[^.;\n?]|\.\d){0,40}?\b(?:return|refund|credit)\b)(?:[^.;\n?]|\.\d){0,40}?\btransaction[ \t]+with\b/u,
    /カード利用のお知らせ[\s\S]{0,40}ご利用金額/u,
    /(?:カード利用|購入)が完了しました/u,
    /(?:消费|支付|付款)(?:成功|已完成)/u,
  ];
  const refundPatterns = [
    phrase(String.raw`remboursement\s+(?:non\s+)?reçu`),
    phrase(String.raw`remboursement\s+de[\s\S]{0,100}reçu\s+de`),
    phrase(String.raw`reembolso\s+recibido`),
    phrase(String.raw`rimborso\s+accreditato`),
    /(?:रिफंड|धनवापसी)[\s\S]{0,140}जमा\s+हो\s+(?:गई|गया)\s+है/u,
    /退款到账|退款到賬|退款[^。]{0,90}已到账/u,
  ];
  const depositPattern = phrase(String.raw`deposit\s*\/\s*transfer\s+to\s+your\s+account|überweisung\s+eingegangen`);
  // A completed transfer stated in Arabic names its source or destination
  // account: "تم تحويل مبلغ ... من حسابك ... إلى أحمد" leaves the account,
  // "... إلى حسابك" arrives in it. Only the possessive account decides.
  // `تم` stands alone: "يتم" (is being) and "سيتم" (will be) are not done.
  const arabicTransferOut = /(?<!\p{L})تم\s+تحويل[\s\S]{0,80}?من\s+حسابك/u;
  const arabicTransferIn = /(?<!\p{L})تم\s+(?:تحويل|إيداع|ايداع)[\s\S]{0,80}?(?:إلى|الى|في)\s+حسابك/u;
  // Completed person-to-person transfers in other languages and wallets. Each
  // is a finished verb, never a heading: "Pix enviado", "Você recebeu um Pix",
  // "Virement reçu", "havale gelmiştir" (has arrived), "You have sent/received".
  // Venmo's own wording names the payee before the amount: "You paid Sarah
  // Lee $25.00 for …". Case-sensitive so "You paid the bill $25" or "You paid
  // your card" (a settlement) cannot pose as a named person.
  const namedPayeeOut = /(?:^|[:.!]\s*)You\s+paid\s+(?!(?:The|A|An|Your|Our|To)\b)[A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+){0,3}\s+(?:[$€£]|[A-Z]{3}\s?)\d/u;
  const transferOutWords = /(?<!\p{L})(?:pix\s+enviado|você\s+enviou\s+um\s+pix|you\s+have\s+(?:successfully\s+)?sent|money\s+sent\s+successfully\s+to|^\s*sent\s+(?:rs\.?|inr|₹)|has\s+enviado\s+un\s+bizum)(?!\p{L})/iu;
  const transferInWords = /(?<!\p{L})(?:virement\s+reçu|você\s+recebeu\s+um\s+pix|pix\s+recebido|havale\s+gelmiştir|eft\s+gelmiştir|you\s+have\s+(?:successfully\s+)?received|has\s+recibido\s+un\s+bizum|bizum\s+recibido)(?!\p{L})/iu;
  const statuses: PostingStatus[] = [];
  const matches = (pattern: RegExp): boolean => {
    let found = false;
    for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags + 'g'))) {
      found = true;
      const prefix = text.slice(Math.max(0, match.index! - 100), match.index!)
        .split(/[;!?。।]|\.(?=\s|$)/u).at(-1) ?? '';
      const suffix = text.slice(match.index! + match[0].length, match.index! + match[0].length + 70);
      const conditional = phrase(String.raw`if|unless|si|se|wenn|falls|als|indien|إذا|اذا|إن|هل`).test(prefix) || /如果|若|अगर|यदि/u.test(prefix) ||
        /^\s*(?:か|吗|嗎|m[ıiuü])(?=\s|[?,，]|$)/u.test(suffix) || /[?؟]/u.test(suffix);
      const future = phrase(String.raw`will|scheduled|upcoming|sera|será|wird`).test(prefix) ||
        phrase(String.raw`will|sera|será|wird`).test(match[0]);
      const negative = phrase(String.raw`no|not|never|cannot|(?:have|has|had|did|was|were|is|are|do|does|could|would|should|must|need|ought)n['’]t|can['’]t|won['’]t|pas|aucun|aucune|nessun|nessuna|geen|niet|nicht|kein(?:e[nmrs]?)?|não|nao|لم|لن|ليس|لا`).test(prefix) ||
        phrase(String.raw`non|pas|jamais|niet|nicht|não|geen`).test(match[0]) ||
        /\bno\s+(?:(?:está|ha\s+sido)\s+)?(?:pagad[oa]|realizad[oa]|completad[oa]|recibid[oa])\b/iu.test(match[0]) ||
        /\bremboursement\s+non\s+reçu\b/iu.test(match[0]) ||
        /^\s*(?:नहीं|नहि|失败|失敗|尚未|未完成)/u.test(suffix);
      statuses.push(conditional ? 'informational' : future ? 'future' : negative ? 'failed' : 'posted');
    }
    return found;
  };
  const debit = debitPatterns.map(matches).some(Boolean);
  const refund = refundPatterns.map(matches).some(Boolean);
  const deposit = matches(depositPattern);
  const transferOut = matches(arabicTransferOut) || matches(transferOutWords) || matches(namedPayeeOut);
  const transferIn = matches(arabicTransferIn) || matches(transferInWords);
  const cashWithdrawal = matches(phrase(String.raw`cash\s+out\s+of[\s\S]{0,140}?is\s+successful|processed\s+(?:a\s+)?debit\s+card\s+withdrawal\s*:|a\s+debit\s+transaction\s+from\s+withdrawal[\s\S]{0,140}?was\s+posted`));
  if (cashWithdrawal && !refund && !deposit && !transferIn) {
    const status = conservativeStatus(statuses);
    return { status, direction: 'debit', family: status === 'posted' ? 'cash-withdrawal' : 'unknown' };
  }
  if (transferOut !== transferIn && !debit && !refund && !deposit) {
    const status = conservativeStatus(statuses);
    return { status, direction: transferOut ? 'debit' : 'credit', family: status === 'posted' ? 'transfer' : 'unknown' };
  }
  const status = conservativeStatus(statuses);
  // Contradictory positive direction is unresolved; a negative qualification
  // still restricts posting even if another predicate appears in the clause.
  if (status !== 'posted' && statuses.length) return { status, direction: 'debit', family: 'unknown' };
  if (debit === (refund || deposit)) return null;
  return refund ? { status, direction: 'credit', family: 'refund' }
    : deposit ? { status, direction: 'credit', family: 'transfer' } : { status, direction: 'debit', family: 'purchase' };
};

const PERSONAL_CHAT = /(?<![\p{L}\p{N}])(?:lol|lmao|rofl|haha+|hehe+|omg|btw|ngl|tbh)(?![\p{L}\p{N}])|[\u{1F602}\u{1F923}\u{1F62D}]|(?<![\p{L}\p{N}'’])[Ii][ \t]+(?:just[ \t]+)?(?:spent|paid|bought|sent|transferred|withdrew)(?![\p{L}\p{N}])/u;
/**
 * The same first-person-singular payer in the European languages: "Ik heb
 * € 400,00 betaald bij COLRUYT, stuur je jouw deel?", "Ich habe 40 € bezahlt",
 * "J'ai payé …", "He pagado …", "Ho pagato …", "Paguei …", "Zapłaciłem …",
 * "Jeg har betalt …", "Jag har betalat …", "Zaplatil jsem …". Banks address
 * the customer in the second person or impersonally ("Du har betalt", "Du hast
 * … bezahlt", "Zapłaciłeś", "Vous avez payé"), so those still read as alerts.
 */
const FOREIGN_FIRST_PERSON_PAYER = new RegExp([
  String.raw`(?<!\p{L})ik\s+(?:heb|had)(?!\p{L})(?:[^.!?\n]|\.\d){0,60}?(?<!\p{L})(?:betaald|overgemaakt|uitgegeven|voorgeschoten)(?!\p{L})`,
  String.raw`(?<!\p{L})ik\s+(?:betaalde|maakte)(?!\p{L})`,
  String.raw`(?<!\p{L})(?:ich\s+(?:habe|hab)|^\s*hab|^\s*habe)(?!\p{L})(?:[^.!?\n]|\.\d){0,60}?(?<!\p{L})(?:bezahlt|gezahlt|überwiesen|ausgegeben|ausgelegt|geschickt|gesendet)(?!\p{L})`,
  String.raw`(?<!\p{L})j['’]ai\s+(?:payé|dépensé|envoyé|viré|réglé|avancé)(?!\p{L})`,
  String.raw`(?<!\p{L})he\s+(?:pagado|gastado|enviado|transferido|adelantado)(?!\p{L})`,
  String.raw`(?<!\p{L})ho\s+(?:pagato|speso|inviato|trasferito|anticipato)(?!\p{L})`,
  String.raw`(?<!\p{L})(?:paguei|gastei|enviei|transferi|adiantei)(?!\p{L})`,
  String.raw`(?<!\p{L})(?:zapłaciłem|zapłaciłam|zaplacilem|zaplacilam|wydałem|wydałam|przelałem|przelałam|wysłałem|wysłałam)(?!\p{L})`,
  String.raw`(?<!\p{L})jeg\s+(?:har\s+)?(?:betalt|betalte|overført|overførte|sendt|sendte|brugt|brukt|lagt\s+ud|lagt\s+ut)(?!\p{L})`,
  String.raw`(?<!\p{L})jag\s+(?:har\s+)?(?:betalat|betalade|swishat|swishade|skickat|skickade|överfört|lagt\s+ut)(?!\p{L})`,
  String.raw`(?<!\p{L})(?:(?:zaplatil|zaplatila|poslal|poslala|utratil|utratila)\s+jsem|jsem\s+(?:zaplatil|zaplatila|poslal|poslala|utratil|utratila))(?!\p{L})`,
  // Asking the reader for their share is chat, never a bank alert.
  String.raw`(?<!\p{L})(?:schick\s+mir|deinen\s+anteil|stuur\s+(?:je\s+)?(?:me|mij)|jouw\s+deel|envoie-moi|ta\s+part|m[áa]ndame|me\s+pasas|tu\s+parte|mandami|la\s+tua\s+parte|manda-me|a\s+tua\s+parte|oddaj\s+mi|oddasz\s+mi|twoją\s+część|send\s+mig|swisha\s+mig|vippse?r?\s+(?:du\s+)?meg|din\s+del|pošli\s+mi|svůj\s+díl)(?!\p{L})`,
].join('|'), 'imu');

/**
 * A state word inside an ALL-CAPS name ("… u REFUND SHOP dne …", "at REFUND
 * KINGS LTD") in an otherwise mixed-case alert. When the merchant reader could
 * not isolate that name, the word is the only refund evidence; the direction
 * then waits for the person instead of turning a purchase into income.
 */
const CAPS_NAME_RUN = /(?<![\p{L}\p{N}])\p{Lu}[\p{Lu}\p{N}&'’.*-]*(?:[ \t]+[\p{Lu}\p{N}][\p{Lu}\p{N}&'’.*-]*)+(?![\p{L}\p{N}])/gu;
/** A title-case name after a merchant separator: "… - Refund Shop", "hos Refund Shop". */
const TITLE_NAME_RUN = /(?<=(?:^|\s)(?:[-–·]|hos|u|bei|at|chez|en|presso|bij|w|i|da|na)[ \t]+)\p{Lu}\p{Ll}*(?:[ \t]+\p{Lu}[\p{L}\p{N}&'’.*-]*)+/gu;
const REFUND_WORD = /\b(?:refund(?:ed|s)?|reversal|reversed|storno|rimborso|remboursement|reembolso|erstattung|terugbetaling)\b/iu;
/**
 * The refund words that, opening an alert before its amount, make its own
 * "returned"/"reversed" wording the refund itself. "Storno" is not one: a
 * "Storno: Kartenzahlung 27,15 EUR bei REWE" may void an authorisation that
 * never moved money, and "Storno: Je hebt 450,00 EUR ontvangen" takes a
 * received credit back. Both wait in Review.
 */
const REFUND_LEAD_WORD = /\b(?:refund(?:ed|s)?|reversal|reversed|rimborso|remboursement|reembolso|erstattung|terugbetaling)\b/iu;
// (A capitalised hedge inside the merchant name before the amount is the
// name: "Card purchase at ROUND ABOUT £12.00". A function or field word
// breaks that run, in capitals too: "AT STARBUCKS FOR APPROX USD 45.00",
// "PURCHASE AMOUNT APPROX $45.00" — a hedge right after "for", "of",
// "amount" or "total" is always a hedge.)
const NAME_RUN_BEFORE = /(?<![\p{L}])(?:[Aa][Tt]|[Bb](?:ei|EI)|[Cc](?:hez|HEZ)|[Ee][Nn]|[Bb](?:ij|IJ)|[Pp](?:resso|RESSO)|[Hh](?:os|OS)|[Ff](?:rom|ROM)|[Tt][Oo]|@)[ \t]+((?:[\p{Lu}\p{N}&'’.*-]+[ \t]+)*)$/u;
const NAME_RUN_BREAK = /^(?:FOR|OF|IS|WAS|WERE|ARE|TOTAL|AMOUNT|AMT|AT|ON|WITH|BY|TO|FROM|IN|AND|PURCHASE|PAYMENT|CHARGE|TRANSACTION|SPENT|PAID|DEBITED|CREDITED|USING|VIA|CARD|OVER|UNDER|VALUE|SUM)$/u;
/**
 * A hedge right after the amount: "$45.00 (approx.)", "(estimated)",
 * "$45.00 approximately", "… or so", "$45.00~". A parenthesis that names the
 * currency or a tax — "(USD)", "(incl. VAT)" — is not one.
 */
const APPROXIMATE_AFTER = /^[ \t]*(?:\([ \t]*(?:approx(?:imately|imate|\.)?|est(?:imated|imate|\.)?|about|roughly|circa|ca\.|~)[ \t]*\)|[~≈]|(?:approximately|approx\.?|roughly|or[ \t]+so|or[ \t]+thereabouts|estimated|est\.)(?![\p{L}]))/iu;
const approximateAmount = (source: string, amountStart: number, amountEnd: number): boolean => {
  if (amountEnd > amountStart && APPROXIMATE_AFTER.test(source.slice(amountEnd, amountEnd + 40))) return true;
  const before = source.slice(Math.max(0, amountStart - 24), amountStart);
  const hedge = before.match(APPROXIMATE_AMOUNT);
  if (!hedge) return false;
  const word = hedge[0].match(/^[\p{L} \t.]+/u)?.[0].trim() ?? '';
  const hedgeStart = amountStart - before.length + hedge.index!;
  const run = source.slice(Math.max(0, hedgeStart - 80), hedgeStart).match(NAME_RUN_BEFORE);
  const nameWords = run ? run[1].trim().split(/[ \t]+/u).filter(Boolean) : [];
  return !(word && word === word.toLocaleUpperCase('en-US') && /\p{Lu}/u.test(word) && run &&
    !nameWords.some((name) => NAME_RUN_BREAK.test(name)));
};
/**
 * A sentence that says THIS movement is, was or will be taken back, in any
 * tense: "This payment was reclaimed by the sender", "The transfer is being
 * pulled back", "Payment pulled back by sender", "JOHN SMITH is recalling this
 * payment", "The payer recalled it". Either the movement is the subject of a
 * take-back participle, or the object of an active take-back verb. A sentence
 * with a modal or a condition ("Payments can be undone within 30 minutes",
 * "If the sender recalls it, …") states a rule, not this movement's fate.
 * ("Withdrawn" only with the payer as its agent: "Funds withdrawn from your
 * account" is a cash withdrawal.)
 */
const TAKE_BACK_MOVEMENT = String.raw`(?:payment|transfer|deposit|credit|money|funds|amount|transaction|remittance|zelle)`;
const TAKE_BACK_PARTICIPLE = String.raw`(?:recalled|reclaimed|reversed|reverted|retracted|undone|(?:pulled|clawed|taken|charged|debited)\s+back|withdrawn\s+by\s+(?:the\s+)?(?:sender|payer|remitter|originator))`;
// (Reported tenses only: a bare "reverse", "recall", "undo" is an imperative or
// an infinitive — "To reverse this payment, call us" — not this movement's fate.)
const TAKE_BACK_ACTIVE = String.raw`(?:recall(?:s|ed|ing)|reclaim(?:s|ed|ing)|revers(?:es|ed|ing)|revert(?:s|ed|ing)|retract(?:s|ed|ing)|undo(?:es|ing)|undid|(?:pull(?:s|ed|ing)|claw(?:s|ed|ing)|tak(?:es|ing)|took|charg(?:es|ed|ing))\s+back)`;
const TAKE_BACK_SENTENCE = new RegExp(String.raw`(?<![\p{L}])` + String.raw`(?:${TAKE_BACK_MOVEMENT}\s+(?:(?:has|have|had)\s+been\s+|(?:is|was|are|were)\s+(?:being\s+)?|will\s+be\s+|being\s+|got\s+)?${TAKE_BACK_PARTICIPLE}` +
  String.raw`|${TAKE_BACK_ACTIVE}\s+(?:it|(?:this|the|that|your|their|his|her|its)\s+(?:[\p{L}-]+\s+)?${TAKE_BACK_MOVEMENT}))(?![\p{L}])`, 'iu');
const TAKE_BACK_RULE = /(?<![\p{L}])(?:can|cannot|can['’]t|could|may|might|would|should|if|unless|whether)(?![\p{L}])/iu;
const takesMovementBack = (source: string): boolean => source.split(/[!?\n]+|\.(?=\s|$)/u)
  .some((sentence) => TAKE_BACK_SENTENCE.test(sentence) && !TAKE_BACK_RULE.test(sentence));
/**
 * A hedge right before the amount ("You spent about £45.00", "approximately
 * $45.00", "~$45.00", "ca. 27,15 EUR"): the figure is not the exact movement,
 * so the alert waits in Review. (Never the end of a name or domain: "AMAZON.CA $45.00".)
 */
const APPROXIMATE_AMOUNT = /(?:(?<![\p{L}\p{N}.*/-])(?:about|approx(?:imately|\.)?|around|roughly|nearly|almost|up\s+to|estimated|est\.|circa|ca\.|environ|ungef[äa]e?hr|etwa|aproximadamente|aprox\.?|ongeveer|ungef[äa]r|cirka|omkring|oko[łl]o|p[řr]ibli[žz]n[ěe])|[~≈])[ \t]*(?:[A-Z]{3}[ \t]*|[$€£¥₹][ \t]*)?$/iu;

/**
 * Money that settles LATER is not settled now: "… will be available tomorrow",
 * "We will debit your account on Oct 20", "Funds will be withdrawn on 10/20",
 * "It may take 2 days to post", "subject to final
 * settlement", "Final amount will be updated", "… each month starting next
 * month", "… made available for scheduling", "available in your account on
 * 10/20". Fail-closed: the alert waits in Review. "It will arrive in seconds"
 * after "You sent €121.31 to NAME" is the payee's side; the money has left.
 */
const SETTLES_LATER = /\b(?:will|should)\s+be\s+(?:made\s+)?available\b|\bwe\s+will\s+(?:debit|charge|deduct|take|collect)\b|\bwill\s+(?:be\s+)?(?:withdrawn|deducted|debited|charged|taken|posted|updated|post|settle)\b|\bmay\s+take\b[^.!?\n]{0,40}\b(?:post|appear|settle|reflect|clear)\b|\bsubject\s+to\s+final\b|\bfinal\s+amount\b|\bstarting\s+next\b|\bavailable\s+for\s+scheduling\b|\brenews\s+(?:tomorrow|today|on|in|next|soon|automatically)\b|\bavailable\s+(?:in\s+your\s+(?:\w+\s+)?account\s+)?on\s+\d/iu;
const ENGLISH_NOT_SETTLED = /\b(?:sent\s+back|bounced(?:\s+back)?|(?:was|been|were|is)\s+returned|returned\s+to\s+(?:the\s+)?(?:sender|you)|accept\s+(?:it|this|the\s+(?:payment|money|transfer)|within)|to\s+accept\b|waiting\s+for\s+you\s+to|enroll\s+to\s+(?:receive|accept|get)|on\s+(?:the|its)\s+way|(?:card|account)\s+verification\b(?!\s+code)|\bverification\s+(?:charge|hold|transaction|purchase|payment|amount)\b|\bfor\s+verification\b|\d\s+verification\b|not\s+enough\s+(?:funds|money|balance)|for\s+(?:example|instance)|\bnothing\s+(?:was|has\s+been|were)\s+(?:charged|taken|debited|deducted)\b|\bcharged\s+nothing\b|\brequires?\s+(?:your\s+)?(?:approval|authori[sz]ation|confirmation)\b|\bwaiting\s+for\s+(?:\p{L}+\s+){1,3}?to\s+(?:sign\s+up|join|enrol+|register|accept|claim)\b|\bwill\s+be\s+(?:approved|processed|completed|confirmed)\b|\b(?:approved|processed|completed)\s+shortly\b|\bunder\s+process(?:ing)?\b|\bbeing\s+processed\b|\bunclaimed\b|\b(?:has|have)(?:\s+not|n['’]?t)\s+(?:yet\s+)?(?:been\s+)?(?:accepted|claimed)\b|\bnot\s+(?:yet\s+)?(?:been\s+)?(?:accepted|claimed)\b|\b(?:will|may|might)\s+be\s+reviewed\b|\b(?:is|are)\s+being\s+reviewed\b|\bunder\s+review\b|\bdoes(?:\s+not|n['’]?t)\s+have\s+an?\s+\p{L}+\s+account\b|\baccept\s+(?:it\s+|this\s+|the\s+payment\s+)?now\b|\bis\s+how\s+(?:your\s+)?\p{L}+\s+(?:see|sees|will\s+see)\b)/iu;

/**
 * The same three withdrawals in the other launch languages, each phrase-shaped:
 * a worked-example lead-in ("Beispiel:", "Příklad:", "مثال:"), a payment still
 * to accept ("Acceptez-le ?", "Akzeptieren Sie", "Acéptalo", "Accettalo",
 * "Aceite", "Accepteer", "Zaakceptuj", "Godkänn", "Přijměte") and an Arabic
 * hedge ("ربما تم …", "قد يكون تم …": your card MAY have been used). They only
 * withhold posting; the alert waits in Review.
 */
// The separator arm never opens again at a newline an earlier separator's
// blanks already cover (that start reads the same lead-in); without it a long
// run of newlines was quadratic. Same matches (launch-perf.test.cjs).
const WORLD_EXAMPLE_LEAD = /(?:^|[:/\n](?<![:/\n.!?]\s*?\s)\s*|[.!?]\s+)(?:exemple|beispiel|ejemplo|esempio|voorbeeld|exemplo|przyk[łl]ad|exempel|eksempel|p[řr][íi]klad|مثال)\s*[.:]/iu;
const WORLD_NOT_SETTLED = /(?<![\p{L}\p{N}])(?:acceptez(?:-le|-la)?|accepter\s+(?:le|ce)\s+(?:paiement|virement)|akzeptieren\s+sie|annehmen\s+sie|acept(?:a(?:lo|la)?|e\s+(?:el|la)\s+(?:pago|transferencia))|accetta(?:lo|la)?|aceite(?:-o|-a)?|aceita(?:-o|-a)?|accepteer|zaakceptuj|godk[äa]nn|godkend|godta|p[řr]ijm[ěe]te|ربما|قد\s+يكون|من\s+المحتمل|يحتمل)(?![\p{L}\p{N}])/iu;

/** "Example: …", "Bank / Sample alert. You made …": a worked example, not an alert. */
const ENGLISH_EXAMPLE_LEAD = /(?:^|[:/\n](?<![:/\n.!?]\s*?\s)\s*|[.!?]\s+)(?:example|sample(?:\s+alert)?|tip|pro\s+tip|hint)\s*(?:[.:]|[-–—]\s|\n)/iu;

/** References are identifiers even when immediately followed by a currency. */
const referenceSpans = (text: string) => [...text.matchAll(
  /\b(?:ref(?:erence)?(?:\s+(?:id|no\.?|number))?|(?:transaction|txn|customer|mandate)\s+(?:id|no\.?|number)|iban)\s*[:#-]?\s*([A-Z0-9*._-]{1,40})/giu,
)].filter((match) => /\d/u.test(match[1])).map((match) => ({
  start: match.index! + match[0].length - match[1].length,
  end: match.index! + match[0].length,
}));

/**
 * Source-level non-posting facts cannot be discarded with an unfamiliar money
 * clause or swallowed by an overlong merchant extraction. These are complete
 * predicates/document labels from the independent evidence corpus, not bare
 * merchant keywords. They only restrict posting; they never establish it.
 */
const explicitNonPosting = (source: string, includeLifecycle = true): {
  status: PostingStatus;
  family?: UniversalBankEvent['family'];
} | null => {
  const text = source.normalize('NFKC').replace(/\s+/gu, ' ');
  const unconditional = (pattern: RegExp, excludeAdvice = false): boolean => [...text.matchAll(new RegExp(pattern.source, pattern.flags + 'g'))]
    .some((match) => {
      const prefix = text.slice(Math.max(0, match.index! - 160), match.index!)
        .split(/[.!?;](?=\s|$)/u).at(-1) ?? '';
      return !/\b(?:if|unless|wenn|falls|als|indien|si|se|eğer)\b|अगर|यदि/iu.test(prefix) &&
        !(excludeAdvice && /\b(?:never|avoid|do\s+not|don't)\b/iu.test(prefix));
    });
  if (unconditional(/\b(?:password|passcode)\s*[:=]\s*\d{4,8}\b/iu, true)) {
    return { status: 'informational', family: 'authentication' };
  }
  if (/\bauthori[sz]ation\s+approved\s*:/iu.test(text) && /\btemporary\s+hold\b/iu.test(text)) {
    return { status: 'informational' };
  }
  if (includeLifecycle && unconditional(/\b(?:transfer|payment|purchase)\s+request\s+(?:received|approved|accepted)\b/iu)) {
    return { status: 'informational' };
  }
  if (/^\s*(?:(?:tu|su)\s+)?estado\s+de\s+cuenta\b/iu.test(text)) {
    return { status: 'informational', family: 'statement' };
  }
  const declined = [
    // Explicit completed rejection, anchored to a clause so conditional advice
    // such as `إذا تم رفض السحب النقدي` cannot negate an unrelated purchase.
    /(?:^|[.!?;؟])\s*تم\s+رفض\s+(?:عملية\s+)?السحب\s+النقدي(?=\s|[.!?;؟]|$)/u,
    /(?:^|[.!?;])\s*(?:your\s+)?(?:card\s+)?(?:payment|transaction|purchase)\s+(?:(?:was|is|has\s+been)\s+)?(?:declined|failed|rejected|not\s+approved)(?=\s*(?:[.!?;]|$))/iu,
    /\b(?:kartenzahlung|zahlung)\b[^!?]{0,180}\babgelehnt(?=\s*(?:[.!?]|$))/iu,
    /\b(?:betaling|kaartbetaling)\b[^!?]{0,180}\bgeweigerd(?=\s*(?:op\b|[.!?]|$))/iu,
    /\b(?:kart\s+)?ödemeniz\s+reddedildi(?=\s*(?:[.!?]|$))/iu,
    /\bpago\b[^!?]{0,180}\brechazado(?=\s*(?:[.!?]|$))/iu,
    /(?:^|[。.!?])\s*(?:カード決済|カード支払い|決済|支払い)(?:が|は)?拒否されました/u,
  ];
  if (declined.some((pattern) => unconditional(pattern))) return { status: 'failed' };
  if (isExpectedFutureMoneyNotice(text)) {
    return { status: 'future' };
  }
  if (isApplicationPurchaseOffer(text)) return { status: 'informational' };
  if (!includeLifecycle) return null;
  if (unconditional(/\boverboeking\b[^!?]{0,180}\baangevraagd\b/iu)) return { status: 'informational' };
  if (unconditional(/\b(?:subscription|membership)\s+will\s+(?:renew|be\s+renewed)\b/iu) ||
    unconditional(/\bsubscrição\b[^.!?]{0,100}\bserá\s+renovada\b/iu) ||
    unconditional(/\bassinatura\b[^!?]{0,120}\bserá\s+cobrada\b/iu) ||
    unconditional(/定期購読[^。]{0,100}更新予定/u)) return { status: 'future' };
  if (/^\s*(?:votre\s+)?facture\b[^.!?]{0,100}/iu.test(text) &&
    /\b(?:montant\s+à\s+payer|date\s+limite\s+de\s+paiement)\b/iu.test(text)) {
    return { status: 'future', family: 'bill' };
  }
  if (/^\s*(?:la\s+)?bolletta\b/iu.test(text) && /\b(?:da\s+pagare|scadenza)\b/iu.test(text)) {
    return { status: 'future', family: 'bill' };
  }
  if (/^\s*(?:आपका\s+)?बिजली\s+बिल/u.test(text) && /देय\s+राशि|भुगतान\s+की\s+अंतिम\s+तिथि/u.test(text)) {
    return { status: 'future', family: 'bill' };
  }
  if (/電気料金[^。]{0,50}請求/u.test(text) && /未払い|支払期限/u.test(text)) {
    return { status: 'future', family: 'bill' };
  }
  return null;
};

/**
 * Extract reviewable facts for any explicit ISO currency without requiring a
 * registered bank. Reuse the established numerical and semantic engines; this
 * seam adds field ownership, completeness and a common source-free result.
 * It never grants automatic posting eligibility or substitutes a capture date.
 */
export function inspectUniversalBankEvent(source: string, context: UniversalParseContext = {}): UniversalBankEvent {
  // Every language pack reads the same clause; the memo shares their
  // pack-independent answers for THIS message only (see alert-draft.ts).
  return withAlertSemanticsMemo(() => inspectUniversalBankEventOnce(source, context));
}
function inspectUniversalBankEventOnce(input: string, context: UniversalParseContext): UniversalBankEvent {
  if (typeof input !== 'string' || !input.trim()) return emptyEvent('empty-input');
  // A no-break or other Unicode space reads as a space (same length, so every
  // evidence span still indexes the original text).
  const source = withPlainSpaces(input);
  if (source.length > 4096) return emptyEvent('input-too-long');
  // An exact Brazilian, Colombian, Mexican or Peruvian bank template owns its
  // whole message: its money, family, direction and posting decision come from
  // that template alone (src/lib/latam-alert-templates.ts).
  const latam = matchLatamTemplate(source, { market: context.market, sender: context.sender });
  if (latam) return latamTemplateEvent(source, latam);
  const draft = inspectUniversalMoneyDraft(source, context);
  const fields = extractUniversalFields(source, context, draft.candidates.map((candidate) => candidate.span));
  const money = extractUniversalMoney(source, context,
    fields.merchant.evidence === 'explicit' ? fields.merchant.spans : [],
    [...fields.instrument.spans, ...fields.transactionDate.spans, ...fields.dueDate.spans,
      ...fields.statementDate.spans, ...referenceSpans(draft.normalizedText)]);
  if (money.draft.reasons.includes('too-many-money-candidates')) return emptyEvent('too-many-money-candidates');
  const span = money.transactionSpan ?? { start: 0, end: source.length };
  const roleUnresolved = money.amount.issues.includes('amount-role-unresolved');
  let maskedSource = source;
  // A name such as DECLINED CAFE is not posting-state evidence. Offsets refer
  // to the original source, and replacing with spaces preserves their meaning.
  if (fields.merchant.evidence === 'explicit') {
    for (const merchant of fields.merchant.spans) {
      const start = merchant.start, end = merchant.end;
      // A generic "to NAME" extractor can include the recipient's terminal
      // deposit predicate. Preserve that predicate for an own INTERAC
      // transfer; its recipient name remains masked like every other name.
      const depositPredicate = /\byour\s+interac\s+e[ -]?transfer\s+of\b/iu.test(source.slice(span.start, start))
        ? source.slice(start, end).search(/\b(?:was|has\s+been)\s+deposited\b(?=\s*(?:[.,;!?]|$)|\s+(?:on|into|in|at|by|and)\b)/iu) : -1;
      const maskEnd = depositPredicate < 0 ? end : start + depositPredicate;
      if (maskEnd > start) maskedSource = maskedSource.slice(0, start) + ' '.repeat(maskEnd - start) + maskedSource.slice(maskEnd);
    }
  }
  const semanticSource = maskedSource.slice(span.start, span.end);
  const packs = context.market ? [context.market] : LANGUAGE_PACKS;
  const scopedReadings = packs.map((market) => inspectMarketAlert(semanticSource, market, { sender: context.sender }));
  // An unowned number has not earned a posting clause. Preserve negative and
  // informational context across line/sentence boundaries; flattened text is
  // for classification only, never the source of amounts or source spans.
  const wholeContext = maskedSource.replace(/[\n\r;!?]|\.(?!\d)/gu, ' ');
  const wholeReadings = roleUnresolved
    ? packs.map((market) => inspectMarketAlert(wholeContext, market, { sender: context.sender })) : [];
  const separateInfo = money.observations.some((observation) =>
    ['balance', 'credit-limit', 'statement-total', 'minimum-due'].includes(observation.role));
  const wholeNegative = wholeReadings.some((reading) =>
    reading.status === 'failed' || reading.status === 'future' || reading.family === 'authentication');
  const readings = roleUnresolved && (wholeNegative || !separateInfo) ? wholeReadings : scopedReadings;
  let status = conservativeStatus(readings.map((reading) => reading.status));
  const families = [...new Set(readings.map((reading) => reading.family).filter((family) => family !== 'unknown'))];
  let family: UniversalBankEvent['family'] = families.length === 1 ? families[0] : 'unknown';
  // Language classification consumes the clause already selected by monetary
  // ownership instead of asking another parser to select the amount again.
  // A leading document predicate may describe the first monetary field (for
  // example Japanese label/value layouts). It cannot qualify a later amount.
  const firstPrincipal = money.amount.spans[0]?.start === draft.candidates[0]?.span.start;
  const questionTail = maskedSource.slice(span.end).match(/^\s*[?？؟]/u)?.[0].length ?? 0;
  const movement = completedMovement(maskedSource.slice(firstPrincipal ? 0 : span.start, span.end + questionTail));
  // Unknown amount ownership may not establish a posting, but it cannot erase
  // a directly negated, questioned or scheduled movement predicate either.
  const completion = !roleUnresolved || movement?.status !== 'posted' ? movement : null;
  if (completion) {
    if (completion.status !== 'posted' || status === 'unknown') status = completion.status;
    if (family === 'unknown' || (completion.direction === 'credit' && family === 'cash-withdrawal')) family = completion.family;
  }
  // A European notification heading ("Kartenzahlung / Betrag: …"), proven by
  // its whole template (alert-semantics.ts europeanHeadingMovement).
  const principalMoney = money.amount.value ?? (money.amount.alternatives.length ? money.amount.alternatives[0] : null);
  const principalCurrencies = new Set(money.amount.value ? [money.amount.value.currency]
    : money.amount.alternatives.map((alternative) => alternative.currency));
  const europeanHeading = status === 'unknown' && !roleUnresolved && firstPrincipal && !context.market &&
    principalMoney && money.amount.spans.length === 1 &&
    [...principalCurrencies].every((currency) => /^(?:EUR|CHF|PLN|SEK|DKK|NOK|CZK)$/u.test(currency))
    ? europeanHeadingMovement(source, maskedSource, { ...money.amount.spans[0], currency: principalMoney.currency },
      draft.candidates.map((candidate) => candidate.span), packs, context.sender)
    : null;
  if (europeanHeading) {
    status = 'posted';
    if (family === 'unknown') family = europeanHeading.family;
  }
  // A proven purchase owns its clause: a later reminder about another bill
  // must not cancel it. Unresolved posting needs the whole document context.
  const sourceControl = explicitNonPosting(source, false) ??
    explicitNonPosting(status === 'posted' && !roleUnresolved ? maskedSource.slice(span.start, span.end) : maskedSource);
  // A numeric challenge before an amount remains a challenge across line or
  // sentence boundaries. A separate non-numeric safety footer is different.
  const challengeHeader = /\b(?:otp|verification\s+code|security\s+code)\s*(?:is\s*)?(?:[:=-]\s*)?\p{N}/iu.test(
    source.slice(0, span.start),
  );
  const challenge = sourceControl?.family === 'authentication' || challengeHeader || /\botp(?=\d)/iu.test(semanticSource) ||
    (roleUnresolved && (draft.reasons.includes('authentication-or-otp') ||
      /\botp(?=\d)/iu.test(draft.normalizedText)));
  const controlText = roleUnresolved ? wholeContext : semanticSource;
  const pending = /\b(?:pending|awaiting)\s+(?:authori[sz]ation|approval|confirmation|processing|clearance)\b/iu.test(controlText);
  const explicitlyUnsuccessful = [...controlText.matchAll(
    /\bnot\s+(?:(?:yet|been|be|successfully)\s+){0,2}(?:successful|completed|processed|posted|approved|paid|debited|deducted|credited)\b/giu,
  )].some((match) => !/\bif(?:\s+\w+){0,6}\s*$/iu.test(
    controlText.slice(Math.max(0, match.index! - 65), match.index!),
  ));
  if (challenge || pending) status = 'informational';
  if (explicitlyUnsuccessful) status = 'failed';
  // A bank ASKING whether you made a payment has not told you that you did.
  // "Did you attempt a USD 1,299.00 purchase at TECH OUTLET? Reply YES or NO."
  // read as a posted purchase because the disclaimer after it sits outside the
  // amount's clause; widening that scope would let a disclaimer about one
  // transaction hide a second one, so the question itself is the evidence.
  // `unknown` keeps it reviewable while making it unpostable.
  // The same holds when the amount's own clause ends in "?": "Your card
  // ending 1234 was used for $45.00 at MAPLE MART?" (money ownership stops at
  // the question mark, so the clause reader never sees it). A security footer
  // glued on without a full stop ("… Not You? To Block …") is not that.
  if (!challenge && (isTransactionVerificationChallenge(wholeContext) ||
    (questionTail > 0 && !endsWithFooterQuestion(source.slice(Math.max(span.start, span.end - 48), span.end)) &&
      !endsWithEuropeanFooterQuestion(source.slice(Math.max(span.start, span.end - 64), span.end)))) &&
    status === 'posted') {
    status = 'unknown';
  }
  if (sourceControl) {
    status = sourceControl.status;
    if (sourceControl.family) family = sourceControl.family;
  }
  if (challenge) family = 'authentication';
  // A personal conversation that mentions money is not a bank alert: "lol just
  // spent $65.00 at CHEVRON 😂", "I paid £20 at the pub". Banks never write chat
  // slang, laughing emoji or a first-person "I spent/paid". Lower-case slang
  // only, so a merchant descriptor such as "LOL CAFE" is not chat.
  const personalChat = PERSONAL_CHAT.test(source) || FOREIGN_FIRST_PERSON_PAYER.test(source);
  if (personalChat) {
    status = 'informational';
    family = 'unknown';
  }
  if (roleUnresolved && (status === 'posted' || status === 'unknown')) {
    status = 'unknown';
    family = 'unknown';
  }
  // "Pending" ANYWHERE in the message means the money has not settled yet
  // ("… received from JOHN, pending confirmation", "… recebido de JOAO,
  // pendente"). It is never a posting; the alert stays reviewable.
  const pendingAnywhere = /(?<!\p{L})(?:pending|pendente|pendiente|ausstehend|en\s+attente|in\s+attesa|in\s+behandeling|em\s+processamento|awaiting)(?!\p{L})|معلق/iu
    .test(source);
  if (pendingAnywhere && (status === 'posted' || status === 'unknown')) status = 'informational';
  // Money the reader must still accept or claim, in a sentence of its own:
  // "OLA har sendt deg kr 793,00. Vil du ta imot?", "… créez votre compte pour
  // le recevoir", "ative o MB WAY para receber". It has not arrived. Nor has
  // an example ("Por ejemplo, una compra de … aparecerá así") or a new bill
  // ("Je hebt een nieuwe rekening van … ontvangen").
  if ((EUROPEAN_UNCLAIMED.test(source) || EUROPEAN_EXAMPLE_OR_BILL.test(source)) &&
    (status === 'posted' || status === 'unknown')) status = 'informational';
  // Money the alert says becomes available, or will be debited, LATER is not
  // settled: "You've received $80.00 from JORDAN. It will be available
  // tomorrow", "Your bill payment … was completed. We will debit your account
  // on Oct 20." It waits in Review rather than posting.
  const settlesLater = SETTLES_LATER.test(source);
  // English wording elsewhere in the message that takes the movement back or
  // leaves it open: returned/bounced money, a P2P payment still to accept or
  // claim, a card verification charge, a worked example, too little money.
  const notSettled = ENGLISH_NOT_SETTLED.test(source) || ENGLISH_EXAMPLE_LEAD.test(source) ||
    WORLD_NOT_SETTLED.test(source) || WORLD_EXAMPLE_LEAD.test(source) || takesMovementBack(source);
  // The amount's sentence ends in a question joined to it ("… at MAPLE MART,
  // didn't make this?"), unless that question is a separate capitalised
  // footer ("… MAPLE MART Not you? Call …"). Read on the unmasked source.
  // Scan from the amount itself: the owned span can already end at the "?"
  // (Arabic "… لدى كارفور، ألست أنت؟" puts it inside the money clause).
  const questionFrom = money.amount.spans[0]?.end ?? span.end;
  const sentenceRest = source.slice(questionFrom);
  // A point inside a name or domain ("APPLE.COM/BILL") does not end the sentence.
  const sentenceStop = sentenceRest.search(/[!\n?？؟]|\.(?=\s|$)/u);
  const questionedSentence = sentenceStop >= 0 && /[?？؟]/u.test(sentenceRest[sentenceStop]) &&
    !endsWithFooterQuestion(source.slice(Math.max(span.start, questionFrom + sentenceStop - 48), questionFrom + sentenceStop)) &&
    !endsWithEuropeanFooterQuestion(source.slice(Math.max(span.start, questionFrom + sentenceStop - 64), questionFrom + sentenceStop));
  if ((settlesLater || notSettled || questionedSentence || englishNoticeOpenerWithdrawn(source)) &&
    status === 'posted') status = 'unknown';
  // European wording anywhere in the message, read whole like the English
  // checks above: a trailing "\nZAMÍTNUTO", "… kan ha dragits", "Tryk for at
  // modtage" or "REWE UNGÜLTIG" withdraws the posting in any pack language
  // (alert-semantics.ts europeanMessageDoubt).
  if (status === 'posted') {
    const europeanCurrency = [...principalCurrencies].some((currency) => EUROPEAN_CURRENCY.test(currency));
    const europeanWording = Boolean(europeanHeading) || hasEuropeanPackWording(semanticSource, packs);
    // A refund's own wording is the movement itself: a merchant's "erstattet",
    // "remboursé", "te ha devuelto" in any refund alert, and "returned" /
    // "reversed" when the refund word itself opens the alert before its amount.
    // (The refund wording must sit before the amount or in its own clause after
    // it — "EDEKA hat Ihnen 105,96 EUR erstattet" — not in a separate label:
    // "Has recibido … de JUAN PEREZ – devolución", "… (zwrot)".)
    const amountStart = money.amount.spans[0]?.start ?? 0;
    const amountEnd = money.amount.spans[0]?.end ?? 0;
    const refundInClause = findStatusWords(source).filter((word) => word.concept === 'refunded')
      .every((word) => word.index < amountStart || !/[\n\t|()[\]/:;–—]|\s-\s|-(?=\p{L})|\.\s/u.test(source.slice(amountEnd, word.index + 1)));
    // A German credit labelled "Rückerstattung" / "Erstattung" ("Gutschrift
    // +29,99 € AMAZON … Rückerstattung Bestellnr. …") is a merchant's refund
    // arriving: the noun names the credit itself. (Only that noun, only on a
    // credit: a participle — "Devuelto", "zwrot" — may say a transfer bounced.)
    const refundWords = findStatusWords(source).filter((word) => word.concept === 'refunded');
    const refundNounCredit = refundWords.length > 0 && commonDirection(readings.map((reading) => reading.direction)) === 'credit' &&
      refundWords.every((word) => /^(?:r[üu]e?ck)?erstattung$/iu.test(word.text) ||
        refundWords.some((other) => other !== word && /^(?:r[üu]e?ck)?erstattung$/iu.test(other.text) &&
          other.index <= word.index && word.index + word.text.length <= other.index + other.text.length));
    const ignore: StatusConcept[] = family !== 'refund' ? refundNounCredit ? ['refunded'] : []
      : REFUND_LEAD_WORD.test(source.slice(0, amountStart)) ? ['refunded', 'returned'] : refundInClause ? ['refunded'] : [];
    const doubt = europeanCurrency || europeanWording
      ? europeanMessageDoubt(source, maskedSource, packs, context.sender, europeanWording, ignore, money.amount.spans[0] ?? null)
      : worldStatusDoubt(source, ignore, money.amount.spans[0] ?? null) ? 'unknown' : null;
    if (doubt) status = doubt;
    if (status === 'posted' && approximateAmount(source, amountStart, amountEnd)) status = 'unknown';
  }
  // An invisible character inside a Latin word ("R\u200beply YES", "E\u200bCHEC")
  // is never a bank's own spelling: it can hide any wording from the readers.
  if (status === 'posted' && /\p{Script=Latin}[\u00ad\u200b\u200d\u2060\ufeff]+\p{Script=Latin}/u.test(source)) status = 'unknown';
  // "You have received a new bill from CITY POWER for $95.61" is an
  // obligation that arrived, never money that did.
  if (/\b(?:received|got)\s+(?:a|an|your)\s+(?:new\s+)?(?:e-?bill|bill|invoice|statement)\b/iu.test(source) &&
    (status === 'posted' || status === 'unknown')) {
    status = 'future';
    family = 'bill';
  }
  const hasStatement = money.statementTotal.evidence !== 'missing' || money.minimumDue.evidence !== 'missing';
  const hasBalance = money.balance.evidence !== 'missing' || money.creditLimit.evidence !== 'missing';
  const hasAmount = money.amount.evidence !== 'missing';
  // An amount's local clause cannot erase its containing document type.
  // "Last payment received" inside a statement is historical information.
  const firstMoney = draft.candidates[0]?.span.start ?? source.length;
  let header = source.slice(0, firstMoney);
  if (fields.merchant.evidence === 'explicit') {
    for (const merchant of fields.merchant.spans) {
      const start = merchant.start, end = Math.min(firstMoney, merchant.end);
      if (end > start) header = header.slice(0, start) + ' '.repeat(end - start) + header.slice(end);
    }
  }
  // ADCB's supplied billing alert has no word "statement". Its document
  // heading still proves an obligation when its total is masked/unreadable;
  // neither the minimum nor the threatened late fee is a purchase choice.
  // Anchor to the start and the card so a purchase's reminder footer loses.
  const cardBillingHeader = /^\s*cr\.\s*card\s+[x*•·]*\d{4}\s+billing\s+alert\s*:/iu.test(source);
  const statementHeader = cardBillingHeader || sourceControl?.family === 'statement' ||
    inspectMarketAlert(header, context.market ?? 'US').family === 'statement';
  if (statementHeader || (hasStatement && (!hasAmount || status !== 'posted'))) {
    family = 'statement';
    status = 'informational';
  } else if (!hasAmount && hasBalance) {
    family = 'balance';
    status = 'informational';
  } else if (money.observations.some((observation) => observation.role === 'bill-due') && status !== 'posted') {
    family = 'bill';
    status = 'future';
  }
  // A credit-card bill payment is not fresh spending or business revenue.
  // Preserve it as a distinct fact until a settlement-specific adapter can
  // reconcile its bank/card sides. Generic "card payment at SHOP" is excluded.
  // A bank or product name may sit before the card noun ("towards your HDFC
  // Bank Credit Card"), and "We received your payment of $X to your credit
  // card" states the receipt before the payment.
  const cardSettlement = /\bpayment\b[\s\S]{0,100}\b(?:towards?|against)\s+(?:your\s+)?(?:[\p{L}&.-]+\s+){0,3}?(?:(?:credit|covered|charge)\s+)?card\b|\bpayment\b[\s\S]{0,100}\b(?:received|credited)\s+(?:to|on|for)\s+(?:your\s+)?(?:[\p{L}&.-]+\s+){0,3}?(?:credit|covered|charge)\s+card\b|\breceived\s+your\s+payment\b[\s\S]{0,100}\b(?:to|towards?|for|on)\s+(?:your\s+)?(?:[\p{L}&.-]+\s+){0,3}?(?:credit|covered|charge)\s+card\b/iu.test(semanticSource);
  // The exact supplied ADCB receipt places the amount before "against";
  // money ownership can leave that completed receipt's clause unresolved.
  // It still cannot be offered as a new expense/income in ordinary Review.
  // US issuers word the same settlement without "towards": "A payment of
  // $500.00 posted to your Credit Card ending 0814", "Payment of $1,286.58
  // posted on 09/14 for credit card 1950", "You paid $4,493.74 to your Venture
  // X Card", "The $3,198.08 pmt made to CHASE CARD 8252", "We've received your
  // $2,009.07 payment". Read on the unmasked clause: the card is the payee, so
  // the merchant extractor may have masked it. A purchase "at SHOP with your
  // card" names no card as the destination and is untouched.
  const ownedClause = source.slice(span.start, span.end);
  const usCardSettlement = /\bpayment\b[\s\S]{0,60}\b(?:posted|received|applied)\b[\s\S]{0,40}\bfor\s+(?:your\s+)?(?:credit|covered|charge)\s+card\b|\b(?:payment|pmt)\b[\s\S]{0,60}?\bto\s+(?:(?!(?:with|using|by|on|via|from|your)\b)[\p{L}&.-]+\s+){0,2}card\s+(?:ending\s+(?:in\s+)?)?[x*•·.]*\d{4}\b|\bwe(?:['’]ve|\s+have)?\s+received\s+your\s+(?:[$€£]\s?[\d.,]+\s+)?payment\b/iu.test(ownedClause);
  // "You paid $4,493.74 to your Venture X Card": only a product name (capitalised)
  // or credit/charge may sit between "your" and "Card", exactly as the
  // policy's own-card guard reads it; "to your friend using your debit card" is
  // a payment to a person.
  // A bill payment, transfer or "sent" whose payee is a card issuer or a card
  // ("… to AMERICAN EXPRESS / CAPITAL ONE / CITI CARDS / DISCOVER CARD", "…
  // to CHASE CREDIT CRD AUTOPAY", "… to your Chase credit card", "… to AMEX
  // CARD 1234") settles a card bill: never ordinary spending.
  const payeeIsCard = /\b(?:payment|pmt|paid|sent|transferred)\b(?:[^.\n]|\.\d){0,60}?\bto\s+(?:your\s+)?(?:[\p{L}&.-]{1,20}\s+){0,3}?(?:credit\s+(?:card|crd)|card(?:\s+(?:ending|services|member|account))?\s*(?:[x*•·.]{0,8}\d{4})|american\s+express|amex|discover(?:\s+card)?|capital\s+one|citi(?:\s*cards?|bank\s+card)?|barclaycard|synchrony|card\s+services|visa|master\s?card|mbna)\b/iu.test(ownedClause) ||
    /\bpagad[oa]\b(?:[^.\n]|\.\d){0,40}?\ba\s+(?:tu|su)\s+tarjeta\s+de\s+cr[ée]dito\b/iu.test(ownedClause) ||
    /\b(?:payment|pmt|paid|sent|transferred)\b(?:[^.\n]|\.\d){0,60}?\bto\s+your\s+(?:[\p{L}&.-]{1,20}\s+){0,3}?(?:card|platinum|gold|visa|mastercard)\b/iu.test(ownedClause) ||
    // Money sent TO a credit card in any launch language, whatever the words
    // between ("till ditt SEB kreditkort", "till dtit SEB kreditkort", "sur
    // votre carte de crédit"); a card paid WITH ("avec", "med", "with") is not.
    CREDIT_CARD_TARGET.test(ownedClause) ||
    // "You paid $250.00 to <name> Card / Bank / CC PMT": a card or loan bill, whatever the issuer is called.
    PAID_TO_CARD_OR_BANK.test(ownedClause) || ONTO_CREDIT_CARD.test(source);
  const paidToOwnCard = payeeIsCard || /\b(?:[Pp]aid|[Pp]ayment|[Pp]mt)\b(?:[^.\n]|\.\d){0,60}?\bto\s+your\s+(?:(?:[A-Z][\p{L}\p{N}&.'’-]*|credit|charge|covered)\s+){0,4}?[Cc]ard\b/u.test(ownedClause) ||
    /\b[Pp]ayment\b(?:[^.\n]|\.\d){0,100}?\b(?:posted|applied)\s+(?:to|on)\s+your\s+(?:(?:[A-Z][\p{L}\p{N}&.'’-]*|credit|charge|covered)\s+){0,4}?[Cc]ard\b/u.test(ownedClause);
  const cardPaymentReceipt = /^\s*your\s+payment\b[^\n]{0,96}\bagainst\s+(?:your\s+)?(?:credit|covered)\s+card\b[^\n]{0,96}\bwas\s+received\b/iu.test(source);
  // A card issuer as the payee ("Lastschrift 450,00 EUR an AMERICAN EXPRESS
  // EUROPE", "Incasso 450,00 EUR ICS", "You paid CAPITAL ONE $250.00", "…
  // charged $15.70 at ADVANZIA BANK") settles a card bill. The issuer named
  // as the reader's own instrument ("with your Capital One card", "mit Ihrer
  // DKB VISA") is the card paid with, not the payee.
  // Only a name in PAYEE position counts: after a payee preposition ("an",
  // "at", "à", "hos", "su"), after "paid", right after the amount ("450,00
  // EUR ICS", "… EUR - VISA CARD PAYMENT"), or opening a line as the subject
  // that collected the money ("VISA CARD PAYMENT a prélevé …"). The issuer's
  // own brand in a header or signature ("Chase Sapphire: You made …",
  // "… ║ Amex", "Discover Card: Transaction of …") is the sender.
  const payeePosition = (match: RegExpMatchArray): boolean => {
    // The payee's own capitalised name may precede the card word ("at BANK OF
    // IRELAND CREDIT CARD", "u AIR BANK KREDITNI KARTA"); a caseless SMS is
    // read in its capitalised copy ("… Eur An Santander 1Plus Visa").
    const raw = codeSource.slice(Math.max(0, match.index! - 60), match.index!);
    // A purchase "charged to your credit card" / "made to your credit card" names the card paid WITH.
    if (/(?<!\p{L})(?:charged|made|billed|debited|placed|authori[sz]ed|added|posted)\s+(?:on\s+|to\s+)(?:your\s+)?(?:[\p{L}&.'’-]+\s+){0,2}$/iu.test(raw)) return false;
    const before = raw.replace(/(?:[\p{Lu}\p{N}&'’.-]+[ \t]+){0,4}$/u, '');
    const after = codeSource.slice(match.index! + match[0].length, match.index! + match[0].length + 40);
    let afterAmount = false;
    for (let words = 0, rest = raw; words <= 4 && !afterAmount; words += 1) {
      // (A capitalised copy also capitalises the preposition: "… KČ U AIR BANK KREDITNI KARTA".)
      afterAmount = AFTER_AMOUNT.test(rest) || ((caseless || shoutingText) && PAYEE_PREPOSITION.test(rest));
      rest = rest.replace(/[\p{Lu}\p{N}&'’.-]+[ \t]+$/u, '');
    }
    const verbAfter = after.replace(/^[ \t]*(?:[\p{Lu}\p{N}&'’.-]+[ \t]+){0,4}/u, ' ');
    // Strip a title-case payee name word by word ("An Visa Card Payment").
    let titled = false;
    for (let words = 0, rest = before; words <= 3 && !titled; words += 1) {
      titled = PAYEE_PREPOSITION.test(rest) || PAYEE_FIELD.test(rest);
      rest = rest.replace(/[\p{Lu}][\p{L}\p{N}&'’.-]*[ \t]+$/u, '');
    }
    return titled || PAYEE_PREPOSITION.test(before) || TO_OWN_CARD.test(before) || PAYEE_FIELD.test(raw) ||
      // (Read on the raw text too: in "YOU PAID BARCLAYS US" the capitalised verb is no name.)
      [before, raw].some((text) => /(?<![\p{L}])(?:paid|pagaste|pagou|betalt|betalte|betalat|zaplacono|zaplatili\s+jste|zaplatil[ao]?|pagato|bezahlt|pay[ée])\s+$/iu.test(text)) ||
      afterAmount || (LINE_SUBJECT.test(raw) && (COLLECTING_VERB.test(verbAfter) ||
        /^[ \t]+(?:[A-Z]{3}[ \t]?|[$€£¥₹][ \t]?)?\d/u.test(verbAfter)));
  };
  // Paying TO the reader's own card ("an Ihre Barclaycard", "to your AMEX")
  // is still a card bill; "with your …" names the card paid with.
  const sourceLetters = source.match(/\p{L}/gu) ?? [];
  const shoutingText = sourceLetters.length > 0 && sourceLetters.filter((letter) => /\p{Lu}/u.test(letter)).length / sourceLetters.length > 0.8;
  // An SMS without capitals, or with every word capitalised ("Incasso 450,00 Eur
  // Ics"), has lost the case that tells an issuer code from a word: its codes
  // are read in a capitalised copy of the same length.
  const sourceWords = source.match(/\p{L}+/gu) ?? [];
  const caseless = sourceLetters.length > 0 && (!/\p{Lu}/u.test(source) ||
    (sourceWords.length >= 3 && sourceWords.filter((word) => /^\p{Lu}\p{Ll}*$/u.test(word)).length / sourceWords.length >= 0.9));
  const codeSource = caseless
    ? source.replace(/\p{Ll}/gu, (letter) => { const upper = letter.toUpperCase(); return upper.length === letter.length ? upper : letter; })
    : source;
  const shoutingSegment = (at: number): boolean => {
    const from = Math.max(source.lastIndexOf('\n', at), source.lastIndexOf('. ', at)) + 1;
    const stops = [source.indexOf('\n', at), source.indexOf('. ', at)].filter((stop) => stop >= 0);
    const letters = source.slice(from, stops.length ? Math.min(...stops) : source.length).match(/\p{L}/gu) ?? [];
    return letters.length >= 8 && letters.filter((letter) => /\p{Lu}/u.test(letter)).length / letters.length > 0.8;
  };
  const ownCard = (match: RegExpMatchArray, generic: boolean): boolean => {
    const before = source.slice(Math.max(0, match.index! - 24), match.index!);
    // "CITI TRENDS", "CITI BIKE", "BARCLAYS CENTER": another business that
    // shares the issuer's first word. An issuer's own suffix ("AMERICAN
    // EXPRESS EUROPE", "ADVANZIA BANK", "CAPITAL ONE CANADA") does not count.
    const next = source.slice(match.index! + match[0].length).match(/^[ \t]+([\p{Lu}][\p{Lu}\p{N}&'’.-]*)(?![\p{Ll}])/u)?.[1]?.replace(/\.$/u, '');
    const currencyNext = next !== undefined && /^[A-Z]{3}$/u.test(next) &&
      /^[ \t]+[A-Z]{3}[ \t]?\d/u.test(source.slice(match.index! + match[0].length));
    // (In an all-capitals SMS or sentence every next word is capitalised, and
    // a verb or preposition — "APPLE CARD WAS SENT" — names no business.)
    if (!generic && next && !currencyNext && !ISSUER_SUFFIX.test(next) && !NEXT_FUNCTION_WORD.test(next) &&
      !shoutingText && !shoutingSegment(match.index!)) return true;
    // A domain ("at citi.com/…", "amex.com") is a footer link, not a payee.
    if (/^\.[a-z]/u.test(source.slice(match.index! + match[0].length)) || /[./@]$/u.test(before)) return true;
    if (TO_OWN_CARD.test(before)) return false;
    // A plain "Bank Card" with its mask ("Spent Rs.899 From HDFC Bank Card x1234
    // At …") is the card paid WITH, whatever bank precedes it.
    if (/^bank\s+card$/iu.test(match[0]) &&
      INSTRUMENT_AFTER.test(source.slice(match.index! + match[0].length, match.index! + match[0].length + 24))) return true;
    return OWN_BEFORE.test(before) || (generic && (INSTRUMENT_BEFORE.test(before) ||
      INSTRUMENT_AFTER.test(source.slice(match.index! + match[0].length, match.index! + match[0].length + 24))));
  };
  // A refund TO the issuer's card ("-$123.45 was refunded to Amex ••1234") is money back, not a bill.
  const issuerPayee = status === 'posted' && family !== 'refund' && ([...source.matchAll(CARD_ISSUER_PAYEE)].some((match) => payeePosition(match) && !ownCard(match, false)) ||
    [...codeSource.matchAll(CARD_ISSUER_CODE), ...source.matchAll(CARD_PAYEE_WORDS)]
      .some((match) => payeePosition(match) && !ownCard(match, !/^(?:ICS|BARCLAYS|DISCOVER)/iu.test(match[0]))));
  if (!statementHeader && (cardPaymentReceipt || ((cardSettlement || usCardSettlement || paidToOwnCard || issuerPayee) && status === 'posted'))) {
    family = 'card-payment';
    if (cardPaymentReceipt && status === 'unknown') status = 'posted';
  }
  // Multiple independently owned principal amounts are distinct movements or
  // unresolved event attribution, not alternative spellings of one amount.
  // A single candidate with multiple currency/decimal interpretations remains
  // explicitly selectable. A multi-principal document requires a split adapter.
  const multiplePostings = money.observations.filter((observation) => observation.role === 'transaction').length > 1;
  if (multiplePostings && status !== 'failed' && family !== 'statement' && family !== 'balance') {
    family = 'unknown';
    status = 'informational';
  }
  let refundOnlyInName = false;
  if (family === 'refund' && /\p{Ll}/u.test(semanticSource)) {
    const blanked = semanticSource.replace(CAPS_NAME_RUN, (run) => REFUND_WORD.test(run) ? ' '.repeat(run.length) : run)
      .replace(TITLE_NAME_RUN, (run) => REFUND_WORD.test(run) ? ' '.repeat(run.length) : run);
    refundOnlyInName = blanked !== semanticSource &&
      !packs.some((market) => inspectMarketAlert(blanked, market, { sender: context.sender }).family === 'refund');
    if (refundOnlyInName) family = 'unknown';
  }
  const knownDirection = commonDirection(readings.map((reading) => reading.direction));
  // Monetary ownership may start after a lead-in comma ("For example,").
  // For the first principal only, keep that prefix for negative qualification.
  // Positive ownership remains scoped to its own selected monetary clause.
  const accountDirection = accountMovementDirection(
    semanticSource,
    firstPrincipal ? maskedSource.slice(0, span.start) : '',
  );
  // A structured heading declares a movement's direction, not its settlement.
  // Keep noun-only layouts at unknown status; no country/sender trust is added.
  const structured = source.normalize('NFKC');
  const heading = structured.trimStart().split(/\r?\n/u, 1)[0].trim();
  let headingDirection: MoneyDirection = 'unknown';
  if (!roleUnresolved && money.amount.evidence !== 'missing') {
    if (/^(?:debit|credit)\s*!?$/iu.test(heading) &&
      /(?:^|\n)\s*(?:acct|acc|account|a\/?c)\s*:/iu.test(structured) &&
      /(?:^|\n)\s*(?:amt|amount)\s*:/iu.test(structured)) {
      headingDirection = /^credit/iu.test(heading) ? 'credit' : 'debit';
    } else if (/(?:^|\n(?<!\n\s*?\s))\s*مبلغ\s*:/u.test(structured)) {
      if (/^حوالة\s+واردة(?=$|[\s:؛])/u.test(heading)) headingDirection = 'credit';
      else if (/^(?:شراء|سحب\s*:\s*صراف\s+آلي|سداد\s+فاتورة|مدفوعات\s+وزارة\s+الداخلية)(?=$|[\s:؛])/u.test(heading)) headingDirection = 'debit';
    }
  }
  if (headingDirection === 'unknown' && europeanHeading) headingDirection = europeanHeading.direction;
  // Money stated as CREDITED INTO the user's own account, with no purchase,
  // refund or fee wording, is an incoming transfer ("£2,450.00 has been
  // credited to your account ending 5678. Ref: SALARY OCT"). Left familyless
  // it could never post, so every salary outside the Gulf waited in Review.
  if (family === 'unknown' && status === 'posted' && knownDirection === 'credit' && !roleUnresolved &&
    (/\b(?:credited|deposited)\s+(?:to|into|in)\s+(?:your\s+)?(?:\w+\s+){0,2}(?:a\/?c|acct|account)\b|\b(?:a\/?c|acct|account)\b[^.;\n]{0,30}?\b(?:has\s+been\s+|is\s+)?credited\s+(?:with|by)\b|\bdirect\s+deposit\b/iu.test(maskedSource) ||
    // "A mobile deposit of $1,500.00 has posted to your 360 Checking account",
    // "ATM deposit of $5,600.00 posted to your account", "A deposit of … was
    // made to your account ending 4321": a deposit INTO the reader's own
    // (possessive or tail-named) account, never "to JOHN SMITH account".
    /\bdeposit\b(?:[^.;\n]|\.\d){0,100}?\b(?:to|into|in)\s+(?:your\s+(?:[\p{L}\p{N}-]+\s+){0,3}?(?:a\/?c|acct|account)\b|(?:a\/?c|acct|account)\s+(?:ending|no\b|number|[x*•#]))/iu.test(maskedSource))) {
    family = 'transfer';
  }
  // "A withdrawal of $100.00 was made from your … account at an ATM", "$200.00
  // was withdrawn at an ATM using your card": the
  // field reader takes "an ATM" for the merchant and masks the very word that
  // makes it cash. Read the unmasked owned clause for that one shape.
  if (family === 'unknown' && status === 'posted' && knownDirection === 'debit' && !roleUnresolved &&
    /\bwithdraw(?:al|n)\b(?:[^.;\n?]|\.\d){0,100}?\bat\s+(?:an?\s+)?atm\b/iu.test(source.slice(span.start, span.end))) {
    family = 'cash-withdrawal';
  }
  // Commas separate money fields, but a following opposite posting verb can
  // still qualify this same amount. Inspect through its sentence, stopping
  // before the next amount; never treat a conflict as absent direction.
  const afterClause = maskedSource.slice(span.end);
  const sentenceTail = afterClause.search(/[;!?\n。।]|\.(?=\s|$)/u);
  const nextMoneyStart = draft.candidates.find((candidate) => candidate.span.start >= span.end)?.span.start ?? source.length;
  const directionEnd = Math.min(span.end + (sentenceTail < 0 ? afterClause.length : sentenceTail), nextMoneyStart);
  const directionText = maskedSource.slice(span.start, directionEnd);
  const explicitDebit = phrase(String.raw`debited|charged|débité|belastet|abgebucht|cargado|addebitato|afgeschreven`).test(directionText);
  const explicitCredit = phrase(String.raw`credited|crédité|gutgeschrieben|abonado|accreditato|bijgeschreven`).test(directionText);
  const directionConflict = (explicitDebit && (explicitCredit || completion?.direction === 'credit')) ||
    (explicitCredit && completion?.direction === 'debit') ||
    (headingDirection !== 'unknown' && knownDirection !== 'unknown' && headingDirection !== knownDirection) ||
    new Set(readings.map((reading) => reading.direction).filter((value) => value === 'debit' || value === 'credit')).size > 1;
  // "Your payment to Jane was received by her bank" is the RECIPIENT's
  // receipt: never money arriving here. Without an explicit outgoing verb the
  // direction is left for the person to decide.
  const counterpartyReceipt = /\b(?:received|credited|accepted)\s+(?:by|to|at|in(?:to)?)\s+(?:her|his|their|the\s+(?:recipient|payee|beneficiary|receiver)(?:['’]s)?)\s+(?:bank|account)\b/iu
    .test(source);
  const readDirection = status === 'posted' || status === 'unknown'
    ? roleUnresolved || directionConflict ? 'unknown' : accountDirection !== null ? accountDirection : knownDirection === 'unknown'
      ? completion?.direction ?? headingDirection : knownDirection : 'none';
  // "JAMIE ROE has received your bank transfer of €75" (N26) is the named
  // recipient acknowledging money that LEFT this account. Only a personal name
  // in capitals (2-4 words opening the message, no fintech or account noun)
  // proves that. "Trade Republic has received …" (a broker top-up), "Revolut
  // has received your transfer" (a top-up), "Your savings space has received
  // …", a mixed-case name and "Once JAMIE ROE has received …" leave the
  // direction to the person.
  // Also with the amount in the phrase: "TOM BAKER has received your $150.00
  // transfer" is the payee's receipt of money that left this account.
  const receivedYourTransfer = /\bhas\s+received\s+your\s+(?:(?:(?:[A-Z]{1,2}\$|[$€£]|[A-Z]{3})\s?[\d.,]{1,16}|[\d.,]{1,16}\s?(?:[A-Z]{3}|[$€£]))\s+)?(?:bank\s+)?transfer\b/iu.test(source);
  const personSubject = source.match(
    /^\s*([A-Z][A-Z'’-]+(?:[ \t]+[A-Z][A-Z'’-]+){1,3})[ \t]+has[ \t]+received[ \t]+your[ \t]+(?:(?:(?:[A-Z]{1,2}\$|[$€£]|[A-Z]{3})[ \t]?[\d.,]{1,16}|[\d.,]{1,16}[ \t]?(?:[A-Z]{3}|[$€£]))[ \t]+)?(?:bank[ \t]+)?transfer\b/u,
  )?.[1] ?? null;
  const personReceivedYourTransfer = personSubject !== null &&
    !/\b(?:revolut|n26|paypal|wise|monzo|starling|bunq|venmo|cash\s*app|zelle|klarna|ltd|limited|inc|gmbh|plc|llc|bank|account|space|pocket|vault|savings|wallet|card)\b/iu.test(personSubject);
  const direction = refundOnlyInName ? 'unknown'
    : counterpartyReceipt && readDirection === 'credit' ? 'unknown'
    : receivedYourTransfer && readDirection === 'credit' ? personReceivedYourTransfer ? 'debit' : 'unknown'
      : readDirection;
  // A debit that names the reader as its payee ("Saldo …\nANA SILVA enviou
  // EUR 20,00 por MB WAY para si", "… an dich") is someone else's payment to
  // the reader: never the reader's spending.
  if (status === 'posted' && direction === 'debit' && namesReaderAsPayee(source)) status = 'unknown';
  // …and so is money paid INTO the reader's account ("Your salary of £2,000.00
  // has been paid to your account") or paid BY someone else ("Je Tikkie van
  // 25,00 EUR is betaald door JAN"): never the reader's spending.
  if (status === 'posted' && direction === 'debit' && (PAID_TO_READER.test(source) || PAID_BY_OTHER.test(source))) status = 'unknown';
  // Money sent to the reader that "will arrive tomorrow" has not arrived (the
  // lexicon reads that phrase as neutral, for the payer's own debit).
  if (status === 'posted' && direction === 'credit' && CREDIT_LATER.test(source)) status = 'unknown';
  // A sign or German Soll/Haben marker that contradicts the direction
  // ("Deposit of -$500.00", "Kartenzahlung 27,15 EUR+", "… 27,15 EUR H bei
  // REWE", "Gutschrift / Betrag: 27,15 EUR S"), and a threshold amount ("was
  // charged more than $100.00", "Your $100.00 limit alert"): neither states
  // the movement, so it waits in Review.
  const principalSpan = money.amount.spans.length === 1 ? money.amount.spans[0] : null;
  if (principalSpan && status === 'posted') {
    const figure = source.slice(principalSpan.start, principalSpan.end);
    const before = source.slice(Math.max(0, principalSpan.start - 12), principalSpan.start);
    const after = source.slice(principalSpan.end, principalSpan.end + 12);
    // "-$500.00", "- $500.00", "($500.00)", "27,15 EUR-"; "+…", "27,15 EUR+",
    // "27,15 EUR +"; German Soll/Haben as "S"/"H"/"Soll"/"Haben" either side.
    // A spaced dash is a minus only after "of", a colon or "=" ("Deposit of - $500.00"),
    // never a separator ("Direct Deposit - $1,234.56").
    // A minus is "-", "−" (U+2212) or an en dash "–" written onto the figure.
    // (Every dash the alert may print as a minus: "-", "−", "–", "‑", "‒", "—", "﹣", "－".)
    const leadingMinus = /^[-−–‑‒—﹣－]/u.test(figure) || /(?:^|[\s:(])[-−–‑‒—﹣－]$/u.test(before) ||
      /(?:(?<![\p{L}])(?:of|von|de|di|van|av|af)|[:=(])[ \t]*[-−–‑‒—﹣－][ \t]+$/iu.test(before);
    const bracketed = /\($/u.test(before) && /^\)/u.test(after);
    const trailingMinus = /^\.?[-−–‑‒—﹣－](?!\d)/u.test(after) || bracketed;
    const minus = leadingMinus || trailingMinus;
    const plus = /^\+/u.test(figure) || /\+[ \t]?$/u.test(before) || /^\.?[ \t]?\+(?!\d)/u.test(after);
    // The marker stands alone, not glued to a name ("H&M", "H.MAYER", "S. MUELLER").
    // (After the figure an all-capitals "SOLL"/"HABEN" is the marker too; before
    // it a lower-case "haben" is the verb: "Sie haben 27,15 € bezahlt".)
    // (In an all-lower-case SMS a lone "s"/"h" ending its line is the marker.)
    const lowerOnly = !/\p{Lu}/u.test(source);
    const soll = /^[ \t]+(?:S|Soll|SOLL)(?![\p{L}\p{N}&.'’])/u.test(after) || /(?:^|[\s:])(?:S|Soll)[ \t]+$/u.test(before) ||
      (lowerOnly && /^[ \t]+(?:s|soll)[ \t]*(?:\n|$)/u.test(after));
    const haben = /^[ \t]+(?:H|Haben|HABEN)(?![\p{L}\p{N}&.'’])/u.test(after) || /(?:^|[\s:])(?:H|Haben)[ \t]+$/u.test(before) ||
      (lowerOnly && /^[ \t]+(?:h|haben)[ \t]*(?:\n|$)/u.test(after)) ||
      // "(H)", and the English credit marker "Cr"/"CR" after the figure.
      /^[ \t]*(?:[,;][ \t]*)?(?:[([]H[)\]]|\(Haben\)|\(HABEN\)|Cr\.?|CR)(?![\p{L}\p{N}])/u.test(after) ||
      /^[ \t]*[,;][ \t]*(?:H|Haben|HABEN)(?![\p{L}\p{N}&.'’])/u.test(after);
    const debitMarker = /^[ \t]*(?:[,;][ \t]*)?(?:[([]S[)\]]|\(Soll\)|\(SOLL\)|Dr\.?|DR)(?![\p{L}\p{N}])/u.test(after) ||
      /^[ \t]*[,;][ \t]*(?:S|Soll|SOLL)(?![\p{L}\p{N}&.'’])/u.test(after);
    // Even a refund written "-$123.45" waits in Review: the sign could be
    // the issuer's own (money back) or a debit; it does not decide.
    // In English wording a negative or bracketed figure ("charged -$45.00",
    // "Purchase of ($45.00)") says nothing certain about its direction.
    const englishNegative = (leadingMinus || bracketed) && !hasEuropeanPackWording(semanticSource, packs);
    const signConflict = (direction === 'credit' && (minus || soll || debitMarker)) || (direction === 'debit' && (plus || haben)) ||
      (plus && minus) || (soll && haben) || englishNegative;
    const threshold = THRESHOLD_BEFORE.test(source.slice(Math.max(0, principalSpan.start - 40), principalSpan.start)) ||
      THRESHOLD_AFTER.test(source.slice(principalSpan.end, principalSpan.end + 24));
    // "1,450 EUR" / "1,250 kr" where the comma is the decimal point: 1.45 or
    // 1,450? Neither reading is safe to book.
    const ambiguousThousands = /^\D*\d{1,3},\d{3}(?![\d.,])\D*$/u.test(figure) &&
      [...principalCurrencies].some((currency) => /^(?:SEK|DKK|NOK|PLN|CZK|ISK)$/u.test(currency) ||
        (currency === 'EUR' && hasEuropeanPackWording(maskedSource, packs)));
    if (signConflict || threshold || ambiguousThousands) status = 'unknown';
  }
  // Money between the reader's own accounts ("Virement émis … à LIVRET A",
  // "Gutschrift … von N26 SPACE", "£250.00 sent to MY SAVINGS", "… into your
  // savings account … from your checking account") is neither spending nor
  // income; it waits in Review.
  const ownAccountMove = status === 'posted' && ([...source.matchAll(OWN_ACCOUNT_MOVE), ...codeSource.matchAll(OWN_ACCOUNT_ABBREVIATION)]
    .some((match) => {
      // The lead is read before the whole token ("à M. #DUPONTJEANLIVRETA").
      const tokenStart = source.slice(0, match.index!).search(/\S*$/u);
      const lead = source.slice(Math.max(0, tokenStart - 40), tokenStart);
      const verbAfter = source.slice(match.index! + match[0].length, match.index! + match[0].length + 40)
        .replace(/^[ \t]*(?:[\p{Lu}\p{N}&'’.-]+[ \t]+){0,4}/u, ' ');
      const subject = lead.replace(/(?:[\p{Lu}\p{N}&'’.-]+[ \t]+){0,3}$/u, '');
      // (In capitals the verb itself is a capitalised word: read it unstripped too.)
      const verbRaw = source.slice(match.index! + match[0].length, match.index! + match[0].length + 40);
      return OWN_ACCOUNT_LEAD.test(lead) || PAYEE_FIELD.test(lead) ||
        (LINE_SUBJECT.test(subject) && (COLLECTING_VERB.test(verbAfter) || COLLECTING_VERB.test(verbRaw)));
    }) ||
    /\b(?:you\s+)?transferred\s+(?:\S+\s+){0,2}?to\s+(?:your\s+)?(?:\p{L}+\s+)?account\s+(?:ending|[x*•#])/iu.test(source) ||
    // "£500.00 sent to your Chase UK account": the reader's own account elsewhere.
    /(?:\byou\s+|\d\s+)(?:sent|transferred|moved)\s+(?:\S+\s+){0,2}?to\s+your\s+(?:[\p{L}&.'’-]+\s+){0,3}?(?:account|acct)\b/iu.test(source));
  // Every posting policy reads an unresolved status as Review.
  if (ownAccountMove) status = 'unknown';
  const authentication = challenge || readings.some((reading) => reading.family === 'authentication');
  const promotion = [...readings, ...wholeReadings].some((reading) => reading.draft.reasons.includes('promotion'));
  const reviewable = hasAmount || hasStatement || hasBalance;
  const decision = reviewable && status !== 'failed' && !authentication && !pending && !promotion && !personalChat
    ? 'review' : 'ignore';
  // Banks with synthetic-only evidence (Plin, Interbank, BBVA Perú, Santander
  // México, Citibanamex) are identified for Review but never post. Only with
  // that market's context: "Interbank transfer of $500.00" is a US alert.
  const reviewOnlyIssuer = status === 'posted' && REVIEW_ONLY_ISSUER_HINT.test(`${source} ${context.sender ?? ''}`) &&
    isReviewOnlyLatamInstitution(source, context.sender, context.market);
  if (reviewOnlyIssuer) status = 'unknown';
  const issues = [
    ...money.amount.issues,
    ...money.observations.flatMap((observation) => observation.field.issues),
    ...Object.values(fields).flatMap((field) => field.issues),
    ...(status === 'unknown' ? ['posting-status-unresolved'] : []),
    ...(reviewOnlyIssuer ? ['institution-review-only'] : []),
    ...(direction === 'unknown' ? ['direction-unresolved'] : []),
    ...(directionConflict ? ['direction-conflict'] : []),
    ...(multiplePostings ? ['multiple-event-adapter-required'] : []),
    ...(fields.merchant.evidence === 'missing' ? ['merchant-unresolved'] : []),
    ...(hasAmount && fields.transactionDate.evidence === 'missing' ? ['transaction-date-unresolved'] : []),
    ...(family === 'statement' && money.statementTotal.evidence === 'missing' ? ['statement-total-unresolved'] : []),
    ...(family === 'statement' && fields.dueDate.evidence === 'missing' ? ['due-date-unresolved'] : []),
    ...(authentication ? ['authentication-not-posting'] : []),
    ...(pending || pendingAnywhere ? ['pending-not-posting'] : []),
    ...(cardSettlement || usCardSettlement || paidToOwnCard || issuerPayee ? ['settlement-adapter-required'] : []),
    ...(ownAccountMove ? ['own-account-move'] : []),
    ...(status === 'failed' ? ['failed-not-posting'] : []),
    ...(promotion ? ['promotion-not-posting'] : []),
    ...(personalChat ? ['personal-message-not-posting'] : []),
  ];
  return {
    version: 1, decision, family, status, direction,
    amount: family === 'statement' || family === 'balance' ? missingUniversalField() : money.amount,
    statementTotal: money.statementTotal, minimumDue: money.minimumDue,
    balance: money.balance, creditLimit: money.creditLimit,
    ...fields, observations: money.observations, issues: [...new Set(issues)],
  };
}
