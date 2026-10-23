import {
  FOLD_UNSAFE,
  inspectAlertDraft,
  rememberDuringInspection,
  withAlertInspectionMemo,
  type AlertDraft,
} from '@/lib/alert-draft';
import {
  inspectAlertEventEvidence,
  type AlertEventEvidence,
} from '@/lib/alert-event-evidence';
import {
  inspectAlertInstitutionGrammar,
  type AlertInstitutionGrammarReview,
} from '@/lib/alert-institution-grammars';
import { alertMarketPack } from '@/lib/alert-market-packs';
import { findStatusWords, hasStatusWord, transactionStatusWords, withoutNeutralPhrases, type StatusConcept } from '@/lib/alert-status-lexicon';
import { endsWithFooterQuestion, isTransactionVerificationChallenge } from '@/lib/bank-alert-semantic-rules';
import type {
  AlertFamily,
  MoneyDirection,
  PostingStatus,
  UniversalMarket,
} from '@/lib/alert-market-pack-types';

export interface MarketAlertReview {
  market: UniversalMarket;
  decision: 'review' | 'refuse';
  status: PostingStatus;
  family: AlertFamily;
  direction: MoneyDirection;
  rail: string | null;
  moneyRoles: MoneyCandidateRole[];
  primaryCandidateIndex: number | null;
  institution: AlertInstitutionGrammarReview;
  eventEvidence: AlertEventEvidence;
  reasons: string[];
  draft: AlertDraft;
}

export interface MarketAlertContext {
  sender?: string | null;
}

export type MoneyCandidateRole = 'transaction' | 'balance' | 'limit' | 'due' | 'fee' | 'unknown';

/**
 * ONE INSPECTION'S MEMO, never a cache across messages.
 *
 * The universal reader asks every language pack (20 of them) about the same
 * clause, and most of what each pack asks is not about the pack at all: the
 * English movement shapes, the pending/statement/conditional controls, the
 * money draft of a pack with the same currency aliases. Recomputing those per
 * pack was most of the parser's time. Inside `withAlertSemanticsMemo` each
 * such answer is computed once per text and reused by the other packs; the
 * memo is dropped when the outermost call returns (or throws), so nothing of
 * a message outlives its own inspection. Only pure functions of their
 * arguments are memoised, and only non-global regexes (a /g or /y regex's
 * `test` moves `lastIndex`, so it is always run).
 */
export const withAlertSemanticsMemo = withAlertInspectionMemo;
const remember = rememberDuringInspection;
const has = (pattern: RegExp, text: string): boolean =>
  pattern.global || pattern.sticky ? pattern.test(text) : remember(pattern, text, () => pattern.test(text));
// Packs that spell their currency aliases identically get the identical
// draft. The key is the aliases' CONTENT (insertion order included, which is
// the draft's own tie order), cached per pack object.
const draftContextKeys = new WeakMap<object, string>();
const memoDraft = (
  source: string,
  context: { currencyAliases?: Readonly<Record<string, readonly string[]>>; dotDecimalCurrencies?: readonly string[] },
): AlertDraft => {
  const aliases = context.currencyAliases ?? {};
  let aliasKey = draftContextKeys.get(aliases);
  if (aliasKey === undefined) draftContextKeys.set(aliases, aliasKey = JSON.stringify(aliases));
  const key = `${aliasKey}\u0000${JSON.stringify(context.dotDecimalCurrencies ?? null)}\u0000${source}`;
  return remember(inspectAlertDraft, key, () => inspectAlertDraft(source, context as Parameters<typeof inspectAlertDraft>[1]));
};

const AUTHENTICATION = /\b(?:otp|one[ -]?time password|3d secure|3ds|verification code|security code|sicherheitscode|c[óo]digo de (?:seguridad|verifica[cç][aã]o|verificaci[oó]n)|codice di sicurezza|beveiligingscode|approve (?:this )?(?:payment|purchase)|fraud (?:check|alert)|did you (?:make|recogni[sz]e|authori[sz]e) (?:this|the) (?:\w+ ){0,3}(?:purchase|transaction|charge|payment)|reconoces (?:esta|este|la|el) (?:compra|cargo|transacci[oó]n|operaci[oó]n)|reconhece (?:esta|essa|a|o) (?:compra|transa[cç][aã]o|opera[cç][aã]o))\b|code de s[ée]curit[ée]|رمز (?:التحقق|التأكيد)|كلمة المرور/i;
const FAILED = /\b(?:declined|failed|unsuccessful|rejected|not approved|insufficient funds|returned unpaid|recusad[oa]|rechazad[oa]|declinad[oa]|no aprobad[oa]|no autorizad[oa]|no procede|no aplicad[oa])\b|\bn[aã]o\s+(?:aprovad[oa]|autorizad[oa])\b|مرفوض(?:ة)?|فشل(?:ت)?|تعذر|असफल|अस्वीकृत/i;
const NEGATED_POSTING = [
  /(?:(?:\bne\s+|n['’])(?:[\p{L}\p{M}'’-]+\s+){0,4}pas\s+(?:[\p{L}\p{M}'’-]+\s+){0,2}|\bnon\s+)(?:payé|payée|paye|payee|débité|débitée|debite|debitee|crédité|créditée|credite|creditee|remboursé|remboursée|effectué|effectuée)(?=$|[^\p{L}\p{N}])/iu,
  /\bno\s+(?:[\p{L}\p{M}'’-]+\s+){0,4}(?:pagad[oa]s?|cargad[oa]s?|abonad[oa]s?|reembolsad[oa]s?)(?=$|[^\p{L}\p{N}])/iu,
  /\bnon\s+(?:[\p{L}\p{M}'’-]+\s+){0,4}(?:pagat[oa]|addebitat[oa]|accreditat[oa]|rimborsat[oa])(?=$|[^\p{L}\p{N}])/iu,
  /\bnicht\s+(?:[\p{L}\p{M}'’-]+\s+){0,3}(?:bezahlt|abgebucht|belastet|gutgeschrieben|erstattet)(?=$|[^\p{L}\p{N}])/iu,
  /\bniet\s+(?:[\p{L}\p{M}'’-]+\s+){0,3}(?:betaald|afgeschreven|bijgeschreven|terugbetaald)(?=$|[^\p{L}\p{N}])/iu,
  /(?:^|[^\p{L}\p{N}])n[aã]o\s+(?:[\p{L}\p{M}'’-]+\s+){0,4}(?:pag[oa]|debitad[oa]|creditad[oa]|cobrad[oa]|reembolsad[oa]|conclu[ií]d[oa])(?=$|[^\p{L}\p{N}])/iu,
  /\b(?:not|never|hasn['’]t|haven['’]t|didn['’]t)\s+(?:(?:yet|been|be)\s+){0,2}(?:received|credited|debited|deducted|deposited|charged|paid)\b/iu,
  // Czech negates the participle itself with "ne-": "neproběhla" (did not go
  // through), "neprovedena", "nepřipsáno", "nezaplacena", "neodepsáno".
  /(?:^|[^\p{L}\p{N}])ne(?:proběh|probeh|proveden|provedl|připsán|pripsan|zaplacen|odepsán|odepsan|stržen|strzen|uskutečn|uskutecn|realizován|realizovan)\p{L}*/iu,
  // The English completed shapes below ("… made", "… used for", "We've
  // taken …") are negated the same way: "ALEX has not made a $19.99
  // transaction", "Your card has not been used for …", "We haven't taken …".
  /\b(?:not|never|hasn['’]t|haven['’]t|didn['’]t|wasn['’]t|weren['’]t|couldn['’]t|can['’]t|cannot)\s+(?:(?:yet|been|be)\s+){0,2}(?:made|sent|used|approved|taken|withdrawn|posted|completed|processed)\b/i,
] as const;
/** "nothing was charged" / "no funds were debited" negate, not prove, settlement. */
const NEGATED_SETTLEMENT = /\b(?:nothing|no\s+(?:funds|amount|money|charges?|payment))\s+(?:(?:was|were|has|have)\s+)?(?:(?:yet|been)\s+){0,2}(?:debited|credited|charged|paid|transferred|deposited)\b/iu;
/**
 * Lifecycle controls, all fail-closed: each can only move an alert AWAY from a
 * completed posting, never towards one.
 *
 * Pending/authorization-hold alerts (English, Portuguese, Spanish) say money
 * may move later. Bare "authorized" is deliberately absent: many issuers use
 * it for an ordinary completed card purchase.
 */
const PENDING_OR_AUTHORIZED = /\b(?:pending(?:\s+(?:acceptance|review|authori[sz]ation|approval|processing|transaction|confirmation))?|awaiting\s+(?:acceptance|review|authori[sz]ation|approval|processing|confirmation)|authori[sz]ation\s+(?:only|hold|pending)|pre-?authori[sz]ation(?!\s+(?:debit|payment))|on\s+hold|being\s+(?:processed|authori[sz]ed|reviewed)|requires?\s+(?:your\s+)?(?:approval|authori[sz]ation|confirmation)|limit\s+(?:changed|set|updated|increased|reduced))\b|(?:^|[^\p{L}\p{N}])(?:pendente|pendiente|em\s+processamento|em\s+an[aá]lise|en\s+proceso|en\s+revisi[oó]n|aguardando\s+(?:aprova[cç][aã]o|confirma[cç][aã]o|autoriza[cç][aã]o)|aguarda\s+(?:aprova[cç][aã]o|confirma[cç][aã]o|autoriza[cç][aã]o)|pendiente\s+de\s+(?:autorizaci[oó]n|aprobaci[oó]n)|requiere\s+(?:tu\s+|su\s+)?(?:autorizaci[oó]n|aprobaci[oó]n|confirmaci[oó]n)|por\s+autorizar|retenid[oa]|bloquead[oa]|pr[eé]-?autoriza[cç][aã]o|preautorizaci[oó]n)(?=$|[^\p{L}\p{N}])/iu;
/**
 * A money REQUEST can be "received", "approved" or "sent" while no money has
 * moved (Interac Request Money, PayTo agreements, Pix/SPEI payment requests).
 */
const REQUEST_LIFECYCLE = /\b(?:(?:interac\s+e-?transfer|payto(?:\s+agreement)?|transfer|payment|purchase|money)\s+request)\b(?:[^.!?]|\.(?=\d)){0,140}\b(?:received|approved|accepted|created|sent|awaiting\s+approval|awaiting\s+confirmation)\b|(?:^|[^\p{L}\p{N}])(?:solicita[cç][aã]o\s+de\s+(?:pagamento|transfer[eê]ncia|pix)|pedido\s+de\s+(?:pagamento|pix)|solicitud\s+de\s+(?:pago|transferencia|cobro|dinero))(?=$|[^\p{L}\p{N}])/iu;
/**
 * Only an explicit completed-settlement statement may override the pending
 * and request controls above. A future "will be debited from" does not.
 */
const EXPLICIT_SETTLEMENT = /\b(?:was|has\s+been|have\s+been|were|successfully)\s+(?:debited|credited|charged|paid|transferred|deposited)\b|(?:^|[^\p{L}\p{N}])(?:foi\s+(?:debitad[oa]|creditad[oa]|pag[oa])|fue\s+(?:cargad[oa]|abonad[oa]|pagad[oa])|ha\s+sido\s+(?:cargad[oa]|abonad[oa]|pagad[oa]))(?=$|[^\p{L}\p{N}])/iu;
const FUTURE = /\b(?:will (?:be|have been) (?:debited|credited|deposited|refunded|charged|deducted|collected|posted|available|sent|taken|withdrawn|transferred)|will\s+(?:post|take)\b|will apply|pre[ -]?debit|collect request|payment request|scheduled|due on|payment due|upcoming|mandate (?:created|registered))\b|سيتم (?:خصم|سحب|تحصيل|إيداع|رد)|طلب تحصيل|مستحق|डेबिट किया जाएगा|क्रेडिट किया जाएगा|भुगतान देय/i;
const STATEMENT = /\b(?:statement|credit card bill|card bill|minimum (?:amount )?due|amount due|payment due date|kontoauszug|extracto|estratto conto|rekeningoverzicht)\b|relev[ée]|كشف حساب|الحد الأدنى المستحق/i;
const BALANCE = /\b(?:available balance|current balance|avl bal|available limit|credit limit|solde|kontostand|saldo)\b|الرصيد (?:الحالي|المتاح)|الحد (?:المتاح|الائتماني)/i;
const POSTED = /(?:^|[:.]\s*)payment\s+(?:of\s+)?(?:[a-z]{3}|[$€£₹])\s*[\d.,]+\s+at\b|\byou\s+made\s+an?\b(?:[^.;\n]|\.\d){0,40}?\btransaction\b|\bcharge\s+made\s+(?:online|by\s+phone|in\s+store)\b|\b(?:was|has\s+been|were|have\s+been)\s+deducted\b|\b(?:charge|transaction)\s+(?:of|with)\b(?:[^.;\n]|\.\w){0,80}?\bwas\s+made\b|\bwas\s+used\s+for\b|\bwas\s+charged\s+for\b|\byou\s+withdrew\b|\byou\s+(?:have\s+)?sent\b|\bsent\s+you\b|\b(?:spent|purchase(?:d)?|paid|debited|credited|received|sent|withdrawn|deposited|refund(?:ed)?|revers(?:al|ed)|completed|successful|charged|posted|débité|crédité|effectué|belastet|abgebucht|gutgeschrieben|bezahlt|cargado|abonado|pagado|addebitato|accreditato|afgeschreven|bijgeschreven|betaald)\b|تم (?:الخصم|الإيداع|الدفع|التحويل)|سحب|شراء|دفع|استرداد|डेबिट किया गया|क्रेडिट किया गया|जमा किया गया|भुगतान किया गया/i;
const CREDIT = /\bsent\s+you\b|\b(?:credited|received|deposit(?:ed)?|refund(?:ed)?|revers(?:al|ed)|credited back|crédité|gutschrift|gutgeschrieben|abonado|accredito|accreditato|bijgeschreven|terugbetaling)\b|تم (?:الإيداع|رد)|استرداد|क्रेडिट|जमा/i;
const DEBIT = /(?:^|[:.]\s*)payment\s+(?:of\s+)?(?:[a-z]{3}|[$€£₹])\s*[\d.,]+\s+at\b|\byou\s+made\s+an?\b(?:[^.;\n]|\.\d){0,40}?\btransaction\b|\bcharge\s+made\s+(?:online|by\s+phone|in\s+store)\b|\b(?:was|has\s+been|were|have\s+been)\s+deducted\b|\b(?:charge|transaction)\s+(?:of|with)\b(?:[^.;\n]|\.\w){0,80}?\bwas\s+made\b|\bcharge\s+of\b|\bwas\s+used\s+for\b|\bwas\s+charged\s+for\b|\bwithdrew\b|\byou\s+(?:have\s+)?sent\b|\b(?:spent|purchase(?:d)?|paid|debited|withdrawn|charged|débité|belastet|abgebucht|cargado|pagado|addebitato|afgeschreven|betaald)\b|تم (?:الخصم|الدفع)|سحب|شراء|دفع|डेबिट|निकासी|भुगतान/i;
const REFUND = /\b(?:refund(?:ed)?|revers(?:al|ed)|credited back|charged\s+back|charge-?backs?|remboursement|avoir|erstattung|devolución|reembolso|rimborso|storno|terugbetaling|correctieboeking)\b|استرداد|تم رد|धनवापसी|रिफंड/i;
const CASH = /\byou\s+withdrew\b|\b(?:atm|cash machine|cash withdrawal|geldautomat|bargeldabhebung|retrait|retirada|prelievo|geldopname|aeps cash withdrawal)\b|صراف آلي|سحب نقدي|नकद निकासी|एटीएम निकासी/i;
const FEE = /\b(?:bank fee|service charge|annual fee|annual card fee|monthly fee|monthly account maintenance fee|maintenance fee|commission|overdraft fee|nsf fee|frais|cotisation|gebühr|entgelt|comisión|commissione|canone|kosten)\b|رسوم|عمولة/i;
const PURCHASE = /(?:^|[:.]\s*)payment\s+(?:of\s+)?(?:[a-z]{3}|[$€£₹])\s*[\d.,]+\s+at\b|\bcard(?:\s+(?:ending\s+|-\s*)?\d{2,4})?\s+charge\s+made\b|\btransaction\s+(?:with|at)\b|\b(?:charge|transaction)\s+of\b(?:[^.;\n]|\.\d){0,80}?\bat\b|\bwas\s+(?:used|charged)\s+for\b(?:[^.;\n]|\.\d){0,60}?\bat\b|\b(?:debited|charged)\s+from\s+your\s+(?:a\/?c|account|card)\b(?:[^.;\n]|\.\d){0,40}?\bat\b|\b(?:purchase|card charged?|card(?:\s+(?:ending\s+)?\d{2,4})?\s+(?:was\s+)?charged|card payment|card used|paid|spent|paiement par carte|achat|kartenzahlung|kartenumsatz|compra con tarjeta|pagamento con carta|acquisto|pinbetaling|pasbetaling)\b|شراء|دفع بالبطاقة|कार्ड खरीद|कार्ड भुगतान|खरीद/i;

/**
 * ENGLISH COMPLETED-MOVEMENT SHAPES (US, Canada, UK, Ireland, and the English
 * alerts Gulf banks send). Each is a finished predicate or a clause-opening
 * notice noun phrase whose amount is stated in place; none is a bare keyword.
 * They only add posting/direction/family evidence: every declined, pending,
 * held, future, request, OTP, question and negation control above and in the
 * universal/policy layers still runs first and still wins.
 *
 * Classification text is lower-cased and merchant names are masked, so these
 * read wording only. `MONEY` is a currency-marked figure in either order
 * ("$36.00", "eur12.40", "qar 245.50", "4.200 omr"). These run once per
 * language pack per clause, so they use the plain `i` flag: none needs a
 * Unicode property class, and `iu` case folding measured about 4x slower.
 */
// Bounded on purpose: an unbounded digit run made a 4 KB run of digits
// quadratic (each start position rescanned the whole run).
const MONEY = String.raw`(?:(?:[a-z]{3}|[$€£₹¥])\s{0,2}\d[\d.,]{0,15}|(?<![\d.,])\d[\d.,]{0,15}\s{0,2}(?:[a-z]{3}\b|[$€£₹]))`;
const WORD = String.raw`[a-z-]{1,20}`;
const GAP = String.raw`(?:[^.;\n?]|\.\d)`;
/**
 * Debit card/cash/fee/bill movements that happened:
 *  - "You've made a debit card payment of £23.45 at …", "You made an ATM
 *    withdrawal of $200.00" (the existing transaction arm only knew "you made");
 *  - a notice that opens with the movement noun: "Debit card payment of £56.20
 *    at …", "Contactless payment of €4.80 at …", "A charge of $82.95 at …",
 *    "A transaction of $25.00 at …", "ATM withdrawal of €200.00 from your
 *    account" (the opener anchor keeps "If a charge of …" and prose out);
 *  - "A $132.87 transaction was made at …", "A withdrawal of $100.00 was made
 *    from your … account";
 *  - "A charge of $1,245.00 at … was approved", "Transaction for $19.15 was
 *    approved on credit card …": the issuer's approval of a card purchase.
 *    "Pending/awaiting/requires approval" and "not approved" stay controls;
 *    "authorized" is deliberately absent (a hold may still be released);
 *  - "Your Debit Card ending 1234 has been used for QAR 245.50 at …", "Card
 *    ending 4455 used for EUR12.40 at …", "Your card ending in 7224 was
 *    charged $36.00 at …";
 *  - "$176.16 transaction at T.J. MAXX", "Your $1.58 debit card transaction
 *    with AMAZON.COM", "A $625.48 debit transaction made on …";
 *  - "We've taken your … monthly fee of £3.00 from your account";
 *  - "Your $142.80 payment to PG&E was sent", "Your bill payment of $85.60 to
 *    HYDRO ONE was completed", "Online bill payment of $478.79 … was deducted";
 *  - a Chase threshold notice: "Your $178.82 external transfer to … was more
 *    than the $0.00 limit in your Alerts settings". The threshold figure is
 *    never the principal (universal-money marks it aggregate).
 */
const ENGLISH_DEBIT_MOVEMENT = new RegExp([
  String.raw`\byou(?:['’]ve|\s+have)?\s+made\s+an?\b${GAP}{0,40}?\b(?:transaction|purchase|payment|withdrawal)\b`,
  // The amount sits in the noun phrase itself, so "Your transaction limit of
  // $5,000 was made available/approved" is not a movement; "approved for
  // instalments/financing" re-describes an earlier purchase.
  String.raw`\b(?:transaction|charge|purchase|withdrawal)\s+(?:of|for)\s+${MONEY}${GAP}{0,80}?\b(?:was|has\s+been)\s+made\b(?!\s+available)`,
  String.raw`${MONEY}\s+(?:${WORD}\s+){0,4}?(?:transaction|charge|purchase|withdrawal)\s+(?:was|has\s+been)\s+made\b(?!\s+available)`,
  String.raw`\b(?:charge|transaction|purchase)\s+(?:of|for)\s+${MONEY}${GAP}{0,80}?\b(?:was|has\s+been)\s+approved\b(?!\s+for\b)`,
  String.raw`\b(?:has\s+been|was)\s+used\s+(?:for\s+${MONEY}|at\b)`,
  String.raw`\bcard\b${GAP}{0,30}?\bused\s+(?:for\s+${MONEY}|at\b)`,
  String.raw`\bcard\b${GAP}{0,40}?\b(?:was|has\s+been)\s+charged\b(?!\s+back\b)`,
  // Not after "made a": "SOMEONE made a $499.00 transaction with …" is the
  // fraud prompt the authorised-user grammar (universal-parser) refuses; nor
  // an invitation ("make a $50 purchase at …", "your first/next $50 …").
  String.raw`(?<!\b(?:made|make|makes|making|first|next|any|every|each|minimum)\s+(?:an?\s+)?)${MONEY}\s+(?:(?:debit|credit)\s+card\s+|debit\s+|card\s+(?:not\s+present\s+)?|online\s+|contactless\s+|pos\s+|international\s+)?(?:transaction|charge|purchase)\s+(?:at|with|made)\b`,
  // "from your account/card" is required: "We've taken £5 off your next
  // order" is a discount, not a debit.
  String.raw`\bwe(?:['’]ve|\s+have)\s+(?:taken|deducted|debited|charged|collected)\b${GAP}{0,80}?\bfrom\s+your\b`,
  // "We've charged a foreign transaction fee of 19.00 USD to your account",
  // "A service charge of $13.47 was taken from your account": a fee that left
  // the account (FEE gives the family; this gives the completed movement).
  String.raw`\bwe(?:['’]ve|\s+have)\s+charged\b(?!\s+(?:back|nothing)\b)${GAP}{0,80}?\b(?:to|on)\s+your\s+(?:${WORD}\s+){0,2}?(?:account|acct|card)\b`,
  String.raw`\b(?:fee|charge|commission)\s+of\s+${MONEY}${GAP}{0,60}?\b(?:was|has\s+been)\s+(?:taken|deducted|debited|charged)\s+(?:from|to)\s+your\b`,
  String.raw`\b(?:bill\s+)?payment\s+(?:of\s+${MONEY}\s+)?to\b${GAP}{1,60}?\b(?:was|has\s+been)\s+(?:sent|completed|made|processed|paid|successful)\b(?!\s+for\s+(?:approval|review|processing))`,
  String.raw`\bbill\s+payment\b${GAP}{0,80}?\b(?:was|has\s+been)\s+(?:sent|completed|made|processed|deducted|debited|paid)\b(?!\s+for\s+(?:approval|review|processing))`,
  // Not "Your $500.00 transaction limit was more than …": a limit or alert
  // threshold named in the noun phrase is the setting, not a movement.
  String.raw`\byour\s+(?:recent\s+)?${MONEY}\s+(?:(?!(?:limit|threshold|alert)\b)${WORD}\s+){0,3}?(?:transaction|transfer|payment|pmt|withdrawal)\b(?!\s+(?:limit|threshold))${GAP}{0,120}?\b(?:was|is)\s+(?:more|greater|higher|larger)\s+than\s+(?:the|your)\b`,
].join('|'), 'i');
/**
 * A notice that OPENS with the movement noun and its amount: "Debit card
 * payment of £56.20 at …", "A charge of $82.95 at …", "ATM withdrawal of
 * €200.00 from your account …". The noun phrase alone does not say the money
 * moved, so the rest of its clause must either be plain field material (date,
 * time, card/account tail, "made with your debit card") or state a completed
 * predicate ("was made/approved/posted/charged", a Chase threshold "is greater
 * than your …") with nothing that withdraws it. "… requires approval", "…
 * renews on 10/20", "… was reported as fraud", "… was returned", "… daily
 * limit applies" and "…: trial ends soon" are not movements.
 */
const ENGLISH_NOTICE_OPENER = new RegExp([
  String.raw`(?:^|[:.]\s*)(?:an?\s+)?(?:(?:debit|credit)\s+card\s+|contactless\s+|card\s+|online\s+|pos\s+)?(?:payment|purchase|transaction|charge)\s+of\s+${MONEY}\s+(?:at|with)\b`,
  String.raw`(?:^|[:.]\s*)(?:an?\s+)?(?:atm|cash)\s+withdrawal\s+of\s+${MONEY}`,
].join('|'), 'gi');
// Field material a notice may carry after its opener, checked token by token
// (a single alternation-with-repetition regex here backtracked exponentially
// on a long digit run).
const NOTICE_FIELD_WORD = /^(?:at|on|from|in|via|using|with|by|made|your|the|my|a|an|of|debit|credit|card|account|acct|a\/c|current|checking|chequing|ending|no|number|contactless|online|today|yesterday|local|time|visa|mastercard|am|pm|et|est|edt|ct|cst|cdt|pt|pst|pdt|gmt|bst|utc|cet|cest|ist|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december|mon|tue|wed|thu|fri|sat|sun)$/i;
const NOTICE_FIELD_NUMBER = /^[x*•·#]{0,16}\d[\d/:.-]{0,15}$/i;
const isNoticeFieldTail = (tail: string): boolean => tail.length <= 240 &&
  tail.split(/[\s,/-]+/u).every((token) => !token || NOTICE_FIELD_WORD.test(token) || NOTICE_FIELD_NUMBER.test(token));
const NOTICE_COMPLETED = /\b(?:(?:was|has\s+been|were)\s+(?:successfully\s+)?(?:made|approved|posted|charged|completed|processed|debited|deducted|paid)\b(?!\s+for\b)|(?:is|was)\s+(?:more|greater|higher|larger)\s+than\s+(?:the|your)\b)/i;
const NOTICE_WITHDRAWN = /\b(?:fraud|dispute[ds]?|returned|reversed|refunded|declined|hold|pending|approval|example|sample|limit|renews?|appear|scheduled|tomorrow|soon|upcoming|coming|will|may|might|could|would|should|needs?|requires?|waiting|test|available|trial)\b/i;
const clauseTailEnd = (text: string, from: number): number => {
  let end = from;
  while (end < text.length && end - from < 240 && !/[\n;!?]/u.test(text[end]) &&
    !(text[end] === '.' && !(/\d/u.test(text[end - 1] ?? '') && /\d/u.test(text[end + 1] ?? '')))) end += 1;
  return end;
};
const noticeOpenerPosted = (text: string): boolean => {
  for (const match of text.matchAll(ENGLISH_NOTICE_OPENER)) {
    const from = match.index! + match[0].length;
    const tail = text.slice(from, clauseTailEnd(text, from));
    if (isNoticeFieldTail(tail)) return true;
    if (NOTICE_COMPLETED.test(tail) && !NOTICE_WITHDRAWN.test(tail)) return true;
  }
  return false;
};
/**
 * The merchant reader can swallow the continuation into the shop name
 * ("A charge of $9.99 at NETFLIX renews on 10/20" → "NETFLIX renews"), which
 * the classifier then sees masked. Exported for the universal reader, which
 * checks the UNMASKED source: lower-case withdrawing words after a notice
 * opener veto it. Upper-case words are a shop descriptor ("PENDING GOODS").
 */
const NOTICE_WITHDRAWN_LOWER = /\b(?:fraud|disputed?|returned|reversed|refunded|declined|hold|pending|approval|limit|renews?|renewal|appear|scheduled|tomorrow|soon|upcoming|coming|will|may|might|could|would|should|needs?|requires?|waiting|trial|available|example|sample|test)\b/u;
export const englishNoticeOpenerWithdrawn = (source: string): boolean => {
  const text = source.replace(/\s+/gu, ' ');
  for (const match of text.matchAll(ENGLISH_NOTICE_OPENER)) {
    const from = match.index! + match[0].length;
    // A Chase threshold clause ("… is greater than your $3.00 limit in your
    // Alerts settings") names the person's setting, not a limit on this charge.
    const tail = text.slice(from, clauseTailEnd(text, from))
      .replace(/\b(?:is|was)\s+(?:more|greater|higher|larger)\s+than\s+(?:the|your)\b.{0,40}?\bin\s+your\s+alerts?\s+settings\b/giu, ' ');
    if (NOTICE_WITHDRAWN_LOWER.test(tail)) return true;
  }
  return false;
};
/** Every English debit-movement shape, including a qualifying notice opener. */
const englishDebitMovement = (text: string): boolean => remember(ENGLISH_DEBIT_MOVEMENT, text, () =>
  ENGLISH_DEBIT_MOVEMENT.test(text) || noticeOpenerPosted(text));
/**
 * Money that arrived: a deposit that posted, was made to the account, or "is
 * available" in it (Wells Fargo direct deposit). "Will be available" is a
 * future notice and never matches; "is available" with no deposit noun (a
 * refund lure) is not here either.
 */
const ENGLISH_CREDIT_MOVEMENT = new RegExp([
  String.raw`\bdeposit\s+of\s+${MONEY}${GAP}{0,80}?\b(?:was|has\s+been)\s+made\b(?!\s+available)`,
  String.raw`\bdeposit\s+of\s+${MONEY}${GAP}{0,80}?\bis\s+(?:now\s+)?available(?=\s*(?:[.;,!]|$)|\s+(?:in|to|on)\s+your\b)`,
  String.raw`\byour\s+(?:recent\s+)?${MONEY}\s+(?:${WORD}\s+){0,2}?deposit\b${GAP}{0,120}?\b(?:was|is)\s+(?:more|greater|higher|larger)\s+than\s+(?:the|your)\b`,
].join('|'), 'i');
/** "You've made an ATM withdrawal", "ATM withdrawal of €200.00": cash out. */
const ENGLISH_CASH = /\b(?:atm|cash)\s+withdrawal\b|\bwithdrawal\b(?:[^.;\n?]|\.\d){0,80}?\bat\s+an?\s+atm\b/i;
/** A cash keyword beside a deposit ("ATM deposit of $5,600.00") is money in, not a withdrawal. */
const DEPOSIT_WORD = /\bdeposit(?:ed|s)?\b/i;
/**
 * Person-to-person movement stated with the amount in place: "You've sent
 * £45.00 to J SMITH", "You have successfully transferred EGP 750.00 to …",
 * "You received £150.00 from TOM BAKER", "You've received £75.00 from … into
 * your account". "You received a refund/notification/request" has no amount
 * after the verb and does not match.
 */
const ENGLISH_PEER_TRANSFER = new RegExp(
  // Never to or from "your …": "You sent $150.00 to your Savings account" and
  // "You received $150.00 from your Savings account" move the reader's own
  // money, not a person's.
  String.raw`\byou(?:['’]ve|\s+have)?\s+(?:successfully\s+)?(?:sent|transferred)\s+${MONEY}\s+to\b(?!\s+(?:your|my)\b)|\byou(?:['’]ve|\s+have)?\s+(?:successfully\s+)?received\s+${MONEY}\s+(?:(?:from|into)\b(?!\s+(?:your|my)\b)|with\b|via\b)`,
  'i');
/** "Your $178.82 external transfer to …" (a threshold notice): money sent out. */
const ENGLISH_TRANSFER_OUT = new RegExp(
  String.raw`\byour\s+(?:recent\s+)?${MONEY}\s+(?:external\s+|outgoing\s+|wire\s+|online\s+)?transfer\s+to\b(?!\s+your\b)`, 'i');
/**
 * A clause that opens with a condition ("If a purchase of $120.00 was made
 * …, call us", "Should you make a payment of …") describes no movement. Only
 * the clause start counts (after an optional "Bank:" header), so a security
 * footer after a completed predicate cannot erase it.
 */
// Also "Once a purchase of … is made" and "Note - if a charge of …".
const CONDITIONAL_CLAUSE = /^\s*(?:[^:\n]{1,40}:\s*)?(?:note\s*[-:–]?\s*)?(?:if|unless|whether|in\s+case|should\s+you|suppose|imagine|once)\b/i;
/**
 * Other English clauses that quote a purchase amount without reporting one,
 * all fail-closed: an invitation that opens with an imperative ("Make a $50.00
 * purchase at …", "Spend $100 and earn …"), a first/next purchase in an offer
 * ("Your first $50.00 purchase at … earns a bonus"), and an existing purchase
 * re-described for instalments ("… was approved for instalments", "converted
 * to EMI"), which the original purchase alert already reported, an approved
 * (not yet credited) refund, and a card verification charge.
 */
const NOT_A_MOVEMENT_CLAUSE = new RegExp([
  String.raw`^\s*(?:[^:\n]{1,40}:\s*)?(?:make|spend|shop|buy|use|pay|get|earn|enjoy|try)\b`,
  String.raw`\b(?:your|a|the)\s+(?:first|next)\s+(?:${MONEY}\s+)?(?:purchase|transaction|payment|order|spend)\b`,
  String.raw`\bapproved\s+for\s+(?:instal{1,2}ments?|emi|financing|conversion|easy\s+payments?)\b|\bconverted\s+(?:to|into)\s+(?:an?\s+)?(?:instal|emi)`,
  // An approved refund has not been credited yet ("… was approved for a
  // refund", "Your refund request was approved"); a $1.00 card verification
  // charge is released, not spent.
  String.raw`\bapproved\s+for\s+(?:a\s+|your\s+)?refund\b|\brefund\s+(?:request\s+)?(?:has\s+been\s+|was\s+|is\s+)?approved\b`,
  String.raw`\b(?:verification|card\s+check|account\s+check)\b`,
  // A worked example, a hedge, and an explicit nothing: "Example: A charge
  // of … was approved", "Your card … may have been used for …", "We have
  // charged nothing from your account for $50.00".
  // Only as the clause's own lead-in: "Example Bank" and "SAMPLE PAYEE" are names.
  String.raw`^\s*(?:[^:\n]{1,40}:\s*)?(?:example|sample(?:\s+alert)?|e\.g\.)\s*[:.,]|\bfor\s+(?:example|instance)\b|\btest\s+charge\b`,
  String.raw`\bnothing\s+(?:was|has\s+been|were)\s+(?:charged|taken|debited|deducted)\b`,
  String.raw`\b(?:may|might|could)\s+have\s+been\b`,
  String.raw`\b(?:charged|taken|debited|deducted)\s+nothing\b`,
].join('|'), 'i');

/**
 * A third party paying the reader: "JORDAN LEE paid you $48.20" (Venmo). The
 * payer must open its own sentence (or follow a header colon): an advert
 * ("Earn $5 every time a friend has paid you"), a condition ("If JORDAN paid
 * you…"), a question ("Has JORDAN paid you…?") or a negation ("hasn't paid
 * you") is not money in.
 */
// "NAME sent you $265.34 for …" (Zelle/Monzo) has the same subject rule, but
// only with the amount right after it: "sent you a gift card" moved no money.
const PAID_YOU = /\bpaid\s+you\b|\bsent\s+you(?=\s+(?:[a-z]{3}\s?|[$€£₹¥])\d)/giu;
const NOT_A_PAYER = /\b(?:someone|somebody|anyone|anybody|a\s+friend|if|whether|when|whenever|once|unless|after|every\s+time|earn|get|has|have|had|did|does|do|not|never|hasn['’]t|haven['’]t|didn['’]t|who|that)\b/iu;
const peerPaidYou = (text: string): boolean => remember(PAID_YOU, text, () => [...text.matchAll(PAID_YOU)].some((match) => {
  const before = text.slice(0, match.index!);
  const start = Math.max(before.search(/[^.!?:\n]*$/u), 0);
  const subject = before.slice(start).trim();
  const sentenceEnd = text.slice(match.index!).search(/[.!\n](?!\d)|$/u);
  const sentence = text.slice(match.index!, match.index! + sentenceEnd);
  // "JORDAN sent you a request for $20" asks for money; nothing moved.
  return subject.length > 0 && subject.length <= 60 && !NOT_A_PAYER.test(subject) && !sentence.includes('?') &&
    !/\brequest/iu.test(sentence);
}));

/**
 * Resolve the account owner in an already selected principal-money clause.
 * Bare "paid" and the recipient's "deposited" describe opposite sides of
 * the same transfer. They cannot override the possessive account evidence.
 * Null leaves unrelated grammars alone; unknown explicitly withholds direction.
 */
export const accountMovementDirection = (text: string, qualificationPrefix = ''): MoneyDirection | null =>
  remember(accountMovementDirectionUnmemoized, `${qualificationPrefix}\u0000${text}`,
    () => accountMovementDirectionUnmemoized(text, qualificationPrefix));
const accountMovementDirectionUnmemoized = (text: string, qualificationPrefix: string): MoneyDirection | null => {
  const paidIntoOwnAccount = /\b(?:has\s+been|have\s+been|was|were)\s+paid\s+into\s+your\s+(?:[\p{L}-]+\s+){0,3}?(?:account|acct|acc|a\/?c)(?![\p{L}])/iu.exec(text);
  const ownTransferDeposited = /\byour\s+interac\s+e[ -]?transfer\s+of\b(?:[^;!?\n]|\.(?=\d)){0,120}?\bto\s+(?:[^;!?\n]|\.(?=\d)){1,80}?\b(?:was|has\s+been)\s+deposited\b(?=\s*(?:[.,;!?]|$)|\s+(?:on|into|in|at|by|and)\b)/iu.exec(text);
  const paidToUnownedAccount = /\bpaid\b(?:[^;!?\n]|\.(?=\d)){0,60}?\b(?:to|into)\s+(?!your\b)(?:[\p{L}-]+\s+){0,3}?(?:account|acct|a\/?c)\b/iu.exec(text);
  if (!paidIntoOwnAccount && !ownTransferDeposited && !paidToUnownedAccount) return null;
  const explicitDebit = /\b(?:debited|charged|deducted|withdrawn)\b|\byou\s+(?:have\s+)?sent\b/iu.test(text);
  const explicitCredit = /\b(?:credited|received|refunded)\b/iu.test(text);
  const movement = paidIntoOwnAccount ?? ownTransferDeposited ?? paidToUnownedAccount!;
  // A lead-in such as "Please notify us if ..." qualifies the movement just
  // as a leading "If" does. Advice after its completed predicate does not.
  const leadIn = (qualificationPrefix + text.slice(0, movement.index + movement[0].length))
    .split(/[;!?\n]|\.(?=\s|$)/u).at(-1) ?? '';
  const conditional = /\b(?:if|when|once|unless|whether|suppose|imagine)\b|\b(?:for\s+(?:example|instance)|as\s+an?\s+example|sample\s+(?:alert|message|transaction|transfer))\b|(?:^|:\s*)example\s*:/iu.test(leadIn);
  if (conditional || text.includes('?') || (paidIntoOwnAccount && ownTransferDeposited)) return 'unknown';
  if (paidIntoOwnAccount) {
    const nonDepositAccount = /\bpaid\s+into\s+your\s+(?:(?:credit|covered|charge)\s+card|loan|mortgage|merchant|trading|investment)\b/iu.test(text);
    return explicitDebit || nonDepositAccount ? 'unknown' : 'credit';
  }
  if (ownTransferDeposited) {
    // A deposit into an own account/internal pocket does not prove a distinct
    // counterparty outflow; another explicit credit clause is conflicting.
    const ownDestination = /\bto\s+your\b/iu.test(text);
    return explicitCredit || ownDestination ? 'unknown' : 'debit';
  }
  // Masking a payee must not turn an explicit own funding account into the
  // recipient. Its source role proves outflow, while a credit conflict waits.
  const ownFunding = /\bfrom\s+your\s+(?:[\p{L}-]+\s+){0,3}?(?:account|acct|a\/?c)\b/iu.test(text);
  if (ownFunding) return explicitCredit ? 'unknown' : 'debit';
  // "paid to Cheq a/c..123456" doesn't say whose account received it.
  // Retain an independent explicit posting verb, otherwise ask the person.
  return explicitDebit || explicitCredit ? null : 'unknown';
};
const NEAR_BALANCE = /(?:available|current|closing|remaining)\s+balance|avl\s+bal|solde(?: disponible)?|kontostand|الرصيد (?:الحالي|المتاح)/i;
const NEAR_LIMIT = /(?:available|credit)\s+limit|\bavl\.?\s*lmt\b|الحد (?:المتاح|الائتماني)/i;
const NEAR_DUE = /(?:minimum (?:amount )?due|amount due|payment due|statement total|outstanding balance)|الحد الأدنى المستحق|المبلغ المستحق/i;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// One precompiled alternation per pack vocabulary list, keyed by the list
// itself (pack lists are module constants), so only grammar vocabulary is
// ever compiled, never an alert or sender. Testing ~1,000 single-term
// expressions per alert, through a 1,024-entry cache the packs had outgrown,
// dominated the universal reader. The boundaries are those of a single term:
// a whole-word phrase, any run of whitespace between its words, any case.
// Longer terms are tried first at a position, and the term returned is the
// one whose text matched, so callers that report the term see the phrase.
//
// A term written "^verb" counts only where the clause or a header colon
// starts it (after at most a few symbols such as an emoji): Portuguese
// "Recebeu 20,00 EUR de ANA" / "MB WAY: enviou 20,00 EUR para ANA" have the
// reader as their unstated subject, while "ANA enviou …" names another one.
//
// A list's expression is only run when one of its terms is present at all:
// `needles` are the terms' own lower-case texts, and a term can only match
// where its text appears in the lower-cased, blank-collapsed alert. That is
// exact for every character whose lower case agrees with its /iu case
// folding; the few that do not (micro sign, long s, final and capital sigma,
// Greek symbol variants, old Cyrillic forms) skip the shortcut and run the
// expression, as does a list whose own terms contain one. Most lists never
// match a given alert (Polish terms on an English one), and compiling and
// running ~130 large case-folded alternations was the reader's largest cost.
interface TermMatcher { pattern: RegExp; byKey: Map<string, string>; needles: readonly string[] | null }
const termText = (text: string): string =>
  remember(termText, text, () => text.toLowerCase().replace(/\s+/gu, ' '));
const termMatchers = new WeakMap<readonly string[], TermMatcher>();
const termKey = (value: string): string => value.trim().toLocaleLowerCase('en-US').split(/\s+/u).join(' ');
const termAlternation = (keys: readonly string[]): string => [...keys].sort((a, b) => b.length - a.length)
  .map((key) => key.split(' ').map(escapeRegExp).join('\\s+')).join('|');
const termMatcher = (terms: readonly string[]): TermMatcher => {
  const cached = termMatchers.get(terms);
  if (cached) return cached;
  const byKey = new Map<string, string>();
  for (const term of terms) if (!byKey.has(termKey(term))) byKey.set(termKey(term), term);
  const free = [...byKey.keys()].filter((key) => !key.startsWith('^'));
  const anchored = [...byKey.keys()].filter((key) => key.startsWith('^')).map((key) => key.slice(1));
  const arms = [
    ...(free.length ? [`(?:^|[^\\p{L}\\p{N}])(${termAlternation(free)})`] : []),
    ...(anchored.length ? [`(?:^|[:!]\\s*|\\.\\s+|\\s[-–]\\s+)[^\\p{L}\\p{N}]{0,4}?(${termAlternation(anchored)})`] : []),
  ];
  const pattern = new RegExp(`(?:${arms.join('|')})(?=$|[^\\p{L}\\p{N}])`, 'iu');
  const needles = [...new Set([...free, ...anchored])];
  const matcher = { pattern, byKey, needles: needles.some((needle) => FOLD_UNSAFE.test(needle)) ? null : needles };
  termMatchers.set(terms, matcher);
  return matcher;
};

const findTerm = (text: string, terms: readonly string[]): string | null => {
  if (!terms.length) return null;
  return remember(terms, text, () => findTermUnmemoized(text, terms));
};
const findTermUnmemoized = (text: string, terms: readonly string[]): string | null => {
  const { pattern, byKey, needles } = termMatcher(terms);
  if (needles && !FOLD_UNSAFE.test(text)) {
    const folded = termText(text);
    if (!needles.some((needle) => folded.includes(needle))) return null;
  }
  const match = pattern.exec(text);
  if (!match) return null;
  const freeText = match[1];
  const key = freeText !== undefined && byKey.has(termKey(freeText)) ? termKey(freeText) : `^${termKey(match[2] ?? match[1] ?? '')}`;
  return byKey.get(key) ?? terms[0];
};

const isClauseBoundary = (text: string, index: number): boolean => {
  const character = text[index];
  if (character === '\n' || character === '\r' || character === ';') return true;
  if (character !== '.' && character !== '!' && character !== '?') return false;
  // Danish and Norwegian write the currency "kr." mid-sentence ("Køb på
  // 508,63 kr. hos DSB godkendt"): that point abbreviates, it ends nothing.
  if (character === '.' && /(?:^|[^\p{L}])kr$/iu.test(text.slice(Math.max(0, index - 3), index)) &&
    /^ \p{Ll}/u.test(text.slice(index + 1, index + 3))) return false;
  // A decimal/grouping point inside a money candidate is not a sentence end.
  return !/\d/u.test(text[index - 1] ?? '') || !/\d/u.test(text[index + 1] ?? '');
};

/**
 * Keep boilerplate in the source for issuer evidence and safety limits, but
 * classify posting status from the sentence that actually owns the selected
 * amount. Banks routinely append balance, due-date and OTP-safety sentences
 * to an already-posted transaction; those footers must not erase the posting.
 */
const semanticClause = (
  text: string,
  span: { start: number; end: number } | null,
): string => {
  if (!span) return text;
  let start = Math.max(0, Math.min(span.start, text.length));
  let end = Math.max(start, Math.min(span.end, text.length));
  while (start > 0 && !isClauseBoundary(text, start - 1)) start -= 1;
  while (end < text.length && !isClauseBoundary(text, end)) end += 1;
  return text.slice(start, end).trim() || text;
};

/**
 * The clause that owns the amount ends in a question mark: "Your card ending
 * 1234 was used for $45.00 at MAPLE MART?" asks; it does not report. The
 * clause splitter treats "?" as a boundary, so the posting predicate inside
 * it would otherwise read as a completed movement. A glued security footer
 * ("… at DMART Not You? To Block call …") is not such a question.
 */
/**
 * The European banks' own security footers, glued after the movement without
 * a full stop: "… bei REWE Unbekannte Zahlung? Sperr-Notruf …", "… chez SHOP
 * Ce n'est pas vous? Appelez …", "Niet herkend? Bel …", "Kender du ikke
 * købet? Ring …", "Nebyli jste to vy? Volejte …". Like the English footer
 * (bank-alert-semantic-rules.ts) it opens with a capital and is not joined to
 * the movement by a comma, so it does not question the movement before it.
 */
const EUROPEAN_FOOTER_QUESTION = /(?<!\p{L})(?:unbekannte\s+(?:zahlung|buchung|transaktion)|nicht\s+von\s+ihnen|ce\s+n['’]est\s+pas\s+vous|op[ée]ration\s+inconnue|vous\s+ne\s+reconnaissez\s+pas(?:\s+cette\s+op[ée]ration)?|niet\s+herkend|herkent\s+u\s+dit\s+niet|no\s+reconoces(?:\s+(?:esta|la)\s+operaci[oó]n)?|no\s+has\s+sido\s+t[uú]|non\s+riconosci(?:\s+l['’]operazione)?|n[aã]o\s+reconhece(?:\s+este\s+movimento)?|nie\s+rozpoznajesz(?:\s+transakcji)?|to\s+nie\s+ty|känner\s+du\s+inte\s+igen\s+(?:köpet|transaktionen|betalningen)|inte\s+du|kender\s+du\s+ikke\s+(?:købet|transaktionen|betalingen)|ikke\s+dig|ikke\s+deg|kjenner\s+du\s+ikke\s+igjen(?:\s+(?:kjøpet|transaksjonen))?|nebyli\s+jste\s+to\s+vy|nepoznáváte\s+platbu|abmelden|afmelden|afmeld)\s*$/iu;
export const endsWithEuropeanFooterQuestion = (textBeforeQuestionMark: string): boolean => {
  const match = EUROPEAN_FOOTER_QUESTION.exec(textBeforeQuestionMark);
  if (!match) return false;
  const before = textBeforeQuestionMark.slice(0, match.index);
  return /^\p{Lu}/u.test(match[0]) && !/[,;]\s*$/u.test(before);
};

const clauseEndsInQuestion = (text: string, span: { start: number; end: number }, originalCase = text): boolean => {
  let end = Math.max(0, Math.min(span.end, text.length));
  while (end < text.length && !isClauseBoundary(text, end)) end += 1;
  // A masked name right before the "?" may have swallowed a "Not you" footer;
  // the universal reader decides that one on the unmasked source.
  return text[end] === '?' && !/ {3}$/u.test(text.slice(0, end)) &&
    !endsWithFooterQuestion(originalCase.slice(Math.max(0, end - 48), end)) &&
    !endsWithEuropeanFooterQuestion(originalCase.slice(Math.max(0, end - 64), end));
};

const moneyCandidateRole = (
  text: string,
  span: { start: number; end: number },
  pack: ReturnType<typeof alertMarketPack>,
): MoneyCandidateRole => {
  const nearby = semanticClause(text, span).replace(/\s+/gu, ' ');
  if (has(NEAR_LIMIT, nearby)) return 'limit';
  if (has(NEAR_DUE, nearby)) return 'due';
  if (has(NEAR_BALANCE, nearby)) return 'balance';
  if (has(FEE, nearby)) return 'fee';
  if (has(DEBIT, nearby) || has(CREDIT, nearby) || has(PURCHASE, nearby) ||
    has(CASH, nearby) || has(REFUND, nearby) ||
    englishDebitMovement(nearby) || has(ENGLISH_CREDIT_MOVEMENT, nearby) ||
    has(ENGLISH_PEER_TRANSFER, nearby) ||
    findTerm(nearby, pack.purchaseTerms ?? []) ||
    findTerm(nearby, pack.refundTerms ?? []) ||
    findTerm(nearby, pack.cashTerms ?? []) ||
    findTerm(nearby, pack.postedTerms ?? []) ||
    findTerm(nearby, pack.debitTerms ?? []) ||
    findTerm(nearby, pack.creditTerms ?? [])) return 'transaction';
  return 'unknown';
};

const primaryCandidate = (roles: readonly MoneyCandidateRole[]): number | null => {
  const explicit = roles
    .map((role, index) => ({ role, index }))
    .filter(({ role }) => role === 'transaction' || role === 'fee');
  if (explicit.length === 1) return explicit[0].index;
  if (explicit.length > 1) return null;
  return roles.length === 1 && roles[0] === 'unknown' ? 0 : null;
};

const postingStatus = (
  text: string,
  postedTerms: readonly string[] = [],
  failedTerms: readonly string[] = [],
  futureTerms: readonly string[] = [],
): PostingStatus => {
  if (has(AUTHENTICATION, text)) return 'informational';
  if (has(FAILED, text) || NEGATED_POSTING.some((pattern) => has(pattern, text)) ||
    findTerm(text, failedTerms)) return 'failed';
  // The generic layer cannot separate a statement total from an individual
  // posting safely. Exact verified bank grammars may do that later; until
  // then every statement-shaped alert is informational and non-importable.
  if (has(STATEMENT, text)) return 'informational';
  if (has(CONDITIONAL_CLAUSE, text) || has(NOT_A_MOVEMENT_CLAUSE, text)) return 'informational';
  const hasTransactionEvidence = has(POSTED, text) || englishDebitMovement(text) ||
    has(ENGLISH_CREDIT_MOVEMENT, text) || has(ENGLISH_PEER_TRANSFER, text) || Boolean(findTerm(text, postedTerms));
  if (has(FUTURE, text) || findTerm(text, futureTerms)) return 'future';
  // A request that was "received"/"approved" moved no money; neither did a
  // pending or held authorization. Only explicit completed settlement wins.
  const settled = has(EXPLICIT_SETTLEMENT, text) && !has(NEGATED_SETTLEMENT, text);
  if (has(REQUEST_LIFECYCLE, text) && !settled) return 'informational';
  if (has(PENDING_OR_AUTHORIZED, text) && !settled) return 'future';
  if (has(BALANCE, text) && !hasTransactionEvidence) return 'informational';
  return hasTransactionEvidence ? 'posted' : 'unknown';
};

const moneyDirection = (
  text: string,
  debitTerms: readonly string[] = [],
  creditTerms: readonly string[] = [],
): MoneyDirection => {
  const accountMovement = accountMovementDirection(text);
  if (accountMovement !== null) return accountMovement;
  const accountCredit = /\bcredited to (?:your|the) (?:bank )?account\b/i.test(text);
  const accountDebit = /\bdebited from (?:your|the) (?:bank )?account\b/i.test(text);
  if (accountCredit !== accountDebit) return accountCredit ? 'credit' : 'debit';
  // Who did the paying decides, not the bare verb: "NAME paid you" is money in.
  if (peerPaidYou(text)) return 'credit';
  const credit = has(CREDIT, text) || has(ENGLISH_CREDIT_MOVEMENT, text) || Boolean(findTerm(text, creditTerms));
  const debit = has(DEBIT, text) || englishDebitMovement(text) || has(ENGLISH_CASH, text) ||
    /\byou(?:['’]ve|\s+have)?\s+(?:successfully\s+)?(?:sent|transferred)\b/i.test(text) ||
    Boolean(findTerm(text, debitTerms));
  if (credit === debit) return 'unknown';
  return credit ? 'credit' : 'debit';
};

export const inspectMarketAlert = (
  source: string,
  market: UniversalMarket,
  context: MarketAlertContext = {},
): MarketAlertReview => {
  const pack = alertMarketPack(market);
  const draftContext = { currencyAliases: pack.currencyAliases, dotDecimalCurrencies: pack.dotDecimalCurrencies };
  const draft = memoDraft(source, draftContext);
  const text = draft.normalizedText.toLowerCase();
  const moneyRoles = draft.candidates.map((candidate) =>
    moneyCandidateRole(text, candidate.span, pack));
  const primaryCandidateIndex = primaryCandidate(moneyRoles);
  const primarySpan = primaryCandidateIndex === null
    ? null
    : draft.candidates[primaryCandidateIndex]?.span ?? null;
  const semanticText = semanticClause(text, primarySpan);
  const semanticDraft = memoDraft(semanticText, draftContext);
  const classificationText = semanticText.replace(/\s+/gu, ' ');
  const initialStatus = postingStatus(
    classificationText,
    pack.postedTerms,
    pack.failedTerms,
    pack.futureTerms,
  );
  const rail = findTerm(classificationText, pack.rails);
  const transfer = findTerm(classificationText, pack.transferTerms);
  const utility = findTerm(classificationText, pack.utilityTerms);
  const recurring = findTerm(classificationText, pack.recurringTerms);
  const eventEvidence = remember(inspectAlertEventEvidence, `${JSON.stringify([recurring, utility, primaryCandidateIndex])}\u0000${text}`,
    () => inspectAlertEventEvidence(text, {
      recurringTerm: recurring,
      utilityTerm: utility,
      primaryCandidateIndex,
    }));
  const lifecycleOnly = eventEvidence.scheduledDebit && [
    'created', 'modified', 'paused', 'resumed', 'cancelled', 'funds-released',
  ].includes(eventEvidence.scheduledDebit.event);
  const ungroundedExecution = eventEvidence.scheduledDebit?.event === 'executed' &&
    initialStatus !== 'posted';
  // Lifecycle verbs describe the instruction, not movement of money. Words
  // such as "setup successful" must not let a created mandate masquerade as a
  // successfully posted debit.
  // A bank asking "did you attempt this?" has not said that you did. The
  // market path reached `posted` for a fraud-verification prompt because the
  // wording that withdraws it sits outside the clause holding the amount.
  // `unknown` rather than `informational`: some banks challenge a charge that
  // HAS posted, and `informational` would drop the row instead of reviewing it.
  const challenged = initialStatus === 'posted' && (remember(isTransactionVerificationChallenge, text, () => isTransactionVerificationChallenge(text)) ||
    (primarySpan !== null && clauseEndsInQuestion(text, primarySpan,
      draft.normalizedText.length === text.length ? draft.normalizedText : text)));
  const status = lifecycleOnly || ungroundedExecution
    ? 'informational'
    : challenged ? 'unknown' : initialStatus;
  const institution = inspectAlertInstitutionGrammar(
    draft.normalizedText,
    market,
    context.sender,
  );

  let family: AlertFamily = 'unknown';
  if (has(AUTHENTICATION, classificationText)) family = 'authentication';
  else if (status === 'informational' && has(STATEMENT, classificationText)) family = 'statement';
  else if (status === 'informational' && has(BALANCE, classificationText)) family = 'balance';
  else if (has(REFUND, classificationText) || findTerm(classificationText, pack.refundTerms ?? [])) family = 'refund';
  else if ((has(CASH, classificationText) || has(ENGLISH_CASH, classificationText) ||
    findTerm(classificationText, pack.cashTerms ?? [])) && !has(DEPOSIT_WORD, classificationText)) family = 'cash-withdrawal';
  else if (has(FEE, classificationText) || eventEvidence.fee ||
    findTerm(classificationText, pack.feeTerms ?? [])) family = 'fee';
  else if (status === 'posted' && utility) family = 'utility';
  else if (status === 'posted' && recurring) family = 'recurring-payment';
  else if (status === 'posted' && transfer) family = 'transfer';
  else if (status === 'posted' && accountMovementDirection(classificationText) !== null) family = 'transfer';
  // "NAME paid you $X" is a person-to-person transfer in, not a purchase.
  else if (status === 'posted' && peerPaidYou(classificationText)) family = 'transfer';
  else if (status === 'posted' && (has(ENGLISH_PEER_TRANSFER, classificationText) ||
    has(ENGLISH_TRANSFER_OUT, classificationText))) family = 'transfer';
  else if (has(PURCHASE, classificationText) || findTerm(classificationText, pack.purchaseTerms ?? []) ||
    (englishDebitMovement(classificationText) && !/\bwithdraw/i.test(classificationText))) family = 'purchase';

  const reasons = [
    ...semanticDraft.reasons,
    ...draft.reasons.filter((reason) =>
      reason === 'input-too-long' || reason === 'too-many-money-candidates'),
  ];
  if (status !== 'posted') reasons.push(`posting-status:${status}`);
  if (family === 'unknown') reasons.push('unknown-family');
  if (draft.candidates.length && primaryCandidateIndex === null) {
    reasons.push('no-unique-transaction-amount');
  }
  if (eventEvidence.scheduledDebit) {
    reasons.push(`scheduled-debit:${eventEvidence.scheduledDebit.event}`);
  }
  const fullMessageSafe = !draft.reasons.includes('input-too-long') &&
    !draft.reasons.includes('too-many-money-candidates');
  const decision = semanticDraft.decision === 'review' && fullMessageSafe && status === 'posted' &&
    primaryCandidateIndex !== null ? 'review' : 'refuse';
  return {
    market,
    decision,
    status,
    family,
    direction: status === 'posted'
      ? moneyDirection(classificationText, pack.debitTerms, pack.creditTerms)
      : 'none',
    rail,
    moneyRoles,
    primaryCandidateIndex,
    institution,
    eventEvidence,
    reasons: [...new Set(reasons)],
    draft,
  };
};

/* ── European notification headings ─────────────────────────────────────── */

const EUROPEAN_HEADING_MARKETS: readonly UniversalMarket[] = ['FR', 'DE', 'ES', 'IT', 'NL', 'PT', 'PL', 'SE', 'DK', 'NO', 'CZ'];
const EUROPEAN_HEADING_CURRENCIES = new Set(['EUR', 'CHF', 'PLN', 'SEK', 'DKK', 'NOK', 'CZK', 'ISK']);
/** A field line of a European notification layout: "Betrag: …", "Commerçant : …". */
const EUROPEAN_FIELD = /^(kto|rek|rach|cta|cpte|úč|c\/c|betrag|händler|haendler|datum|uhrzeit|konto|karte|kartennummer|ort|automat|geldautomat|auftraggeber|empfänger|an|von|verwendungszweck|buchung|buchungstag|valuta|referenz|montant|commerçant|commercant|carte|le|date|compte|de|à|bénéficiaire|beneficiaire|lieu|libellé|cantidad|importe|comercio|tarjeta|fecha(?:\s+(?:de\s+)?operaci[oó]n)?|cuenta|ubicaci[oó]n|beneficiario|concepto|importo(?:\s+operazione)?|esercente|carta|data(?:\s+(?:operazione|do\s+movimento|operacji))?|conto|da|a|causale|bedrag|bij|rekening|afzender|begunstigde|omschrijving|tegenrekening|montante|comerciante|conta|local|para|descritivo|kwota|sprzedawca|karta|od|do|tytuł|tytul|rachunek|summa|belopp|butik|till|från|bankomat|meddelande|beløb|forretning|bogført|pengeautomat|fra|til|tekst|beløp|butikk|bokført|minibank|částka(?:\s+transakce)?|obchodník|účet|pro|zpráva|místo)\.?\s*[:：]\s*\S/iu;
const EUROPEAN_AMOUNT_FIELD = /^(?:betrag|montant|cantidad|importe|importo(?:\s+operazione)?|bedrag|montante|kwota|summa|belopp|beløb|beløp|částka(?:\s+transakce)?)$/iu;
const EUROPEAN_FROM_FIELD = /^(?:von|auftraggeber|de|da|afzender|od|från|fra)$/iu;
const EUROPEAN_TO_FIELD = /^(?:an|empfänger|à|a|bénéficiaire|beneficiaire|beneficiario|para|begunstigde|do|till|til|pro)$/iu;
const EUROPEAN_BALANCE_LINE = /^(?:neuer\s+|nouveau\s+|new\s+)?(?:saldo|solde|kontostand|guthaben|verfügbar\p{L}*|disponib\p{L}*|plafond|l[ií]mite|limite|beschikba\p{L}*|tillgänglig|tilgjengelig|rådighed|dostępn\p{L}*|zůstatek|volný\s+limit)/iu;
const EUROPEAN_FOOTER_LINE = /^(?:unbekannte\s+zahlung|sperr-notruf|abmelden|details|mehr\s+info|niet\s+herkend|afmelden|meer\s+info|ce\s+n['’]est\s+pas\s+vous|pour\s+ne\s+plus\s+recevoir|plus\s+d['’]infos|op[ée]ration\s+inconnue|si\s+no\s+reconoces|para\s+darte\s+de\s+baja|m[áa]s\s+info|se\s+non\s+riconosci|gestisci\s+gli\s+avvisi|maggiori\s+informazioni|se\s+n[ãa]o\s+reconhece|pode\s+desativar|mais\s+informa[çc][ãa]o|nie\s+rozpoznajesz|aby\s+zrezygnowa[ćc]|więcej|känner\s+du\s+inte\s+igen|ändra\s+aviseringar|detaljer|kender\s+du\s+ikke|afmeld|ikke\s+deg|avslutt|mer\s+info|nebyli\s+jste\s+to\s+vy|více|https?:\/\/)/iu;
/** Connector words a heading line may carry after its amount; anything else is unknown wording. */
const EUROPEAN_HEADING_GLUE = new Set(`über bei am um uhr mit ihrer ihre ihr deiner deine der die dem den des karte debitkarte kreditkarte
girocard geldautomaten geldautomat an von auf ihrem konto girokonto endend online im in zu de du des le la les à a au avec votre
vos carte chez sur compte courant se terminant par en ligne dab espèces h del el las los con su tu tarjeta cajero terminada débito
crédito di della il lo alle ore presso tua sua carta allo sportello che termina da van bij op om met je uw betaalpas creditcard
eindigend aan naar do no na às as com o seu cartão cartao terminado final multibanco w kwotę kwote kartą karty nr dnia z od hos
på kort ditt dit som slutar slutter kl med der u kartou dne v vaší`.split(/\s+/u));

const EUROPEAN_NOTICE_PREFIX = /^(?:termin|dauerauftrag|entwurf|demo|retoure|vorabinformation|aankondiging|vooraankondiging|préavis|preaviso|avviso\s+di|zapowiedź|förhandsbesked|varsling|oznámení|erinnerung|hinweis|ankündigung|vorankündigung|aktion|angebot|monatsübersicht|übersicht|abrechnung|offre|promo|relevé|oferta|promoción|resumen|offerta|riepilogo|estratto|aanbieding|overzicht|promocja|zestawienie|erbjudande|översikt|tilbud|oversigt|oversikt|nabídka|akce|přehled|achtung|wichtig|info|information|beispiel|muster|rappel|avis|attention|exemple|recordatorio|aviso|importante|ejemplo|promemoria|avviso|esempio|herinnering|melding|let\s+op|voorbeeld|lembrete|exemplo|przypomnienie|uwaga|przykład|påminnelse|obs|exempel|påmindelse|eksempel|varsel|připomínka|upozornění|příklad)\b/iu;
const EUROPEAN_OWN_CARD = /(?<!\p{L})(?:carte\s+de\s+cr[ée]dit|kreditkart\p{L}*|credit\s*card|creditcard|tarjeta\s+de\s+cr[ée]dito|carta\s+di\s+credito|cart[ãa]o\s+de\s+cr[ée]dito|kart\p{L}*\s+kredytow\p{L}*|kreditkort\p{L}*|kredittkort\p{L}*|kreditní\s+kart\p{L}*)(?!\p{L})/iu;
const EUROPEAN_TO_READER = /(?<!\p{L})(?:an\s+dich|an\s+sie\b|für\s+dich|à\s+vous|à\s+votre\s+attention|pour\s+vous|para\s+ti|para\s+si|para\s+você|para\s+voce|te\s+ha\s+enviado|verso\s+di\s+te|a\s+te|per\s+te|naar\s+je|aan\s+je|naar\s+u|til\s+dig|til\s+deg|till\s+dig|dla\s+ciebie|pro\s+vás|pro\s+tebe)(?!\p{L})/iu;
/** The reader named as the payee ("… enviou … para si", "an dich", "til dig"): exported for the debit check. */
export const namesReaderAsPayee = (text: string): boolean => EUROPEAN_TO_READER.test(text);
// A sender after the heading: a lower-case "from" word then a capitalised name.
const EUROPEAN_FROM_NAME = /(?<!\p{L})(?:[Vv]on|[Pp]ar|[Pp]or|[Dd]a|[Dd]e|[Vv]an|[Ff]ra|[Ff]rån|[Oo]d|de\s+la\s+part\s+de)\s+(?![A-Z]{3}\b)(?:\p{Lu}{2,}|\p{Lu}\p{Ll}+\s+\p{Lu})/u;
// Words that qualify, postpone, sample or summarise a movement, as word
// prefixes in any case: "bei REWE Storno", "- Ausstehende Zahlung", "Datum:
// morgen", "Simulation:", "(3 Umsätze)". They are checked in the heading
// line, the bank-name line and every free-text field value, so a status the
// packs' exact word lists do not carry still keeps the alert in Review.
const EUROPEAN_DOUBT = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:` + [
  'storn', 'ablehn', 'abgelehn', 'autoris', 'autoriz', 'rückbuch', 'rücklast', 'abbruch', 'abgebroch', 'abgewies',
  'widerruf', 'verweiger', 'fehl', 'betrug', 'deckung', 'beispiel', 'muster', 'test', 'vorschau', 'versuch',
  'morgen', 'nicht', 'kein', 'ausstehend', 'vorgemerkt', 'vormerk', 'reserv', 'prüf', 'offen', 'simul', 'geplant',
  'demnächst', 'frage', 'sicherheit', 'warnung', 'umsätze', 'monatsumsatz', 'gesamt', 'summe', 'übersicht',
  'kostenlos', 'gratis', 'bonus', 'prämie', 'aktion', 'angebot', 'rabatt', 'gesperrt', 'blockiert', 'vorläufig',
  'annul', 'différ', 'differ', 'demain', 'exempl', 'prévi', 'previ', 'refus', 'rejet', 'bloqu', 'attente', 'offre',
  'gratuit', 'relevé', 'contest', 'fraud', 'prochain', 'mañana', 'manana', 'fondos', 'cancel', 'rechaz', 'deneg',
  'pendient', 'ejemplo', 'prueba', 'oferta', 'resumen', 'retenid', 'cativ', 'amanhã', 'amanha', 'recus',
  'pendent', 'domani', 'sospes', 'rifiut', 'attesa', 'esempio', 'prova', 'offerta', 'bloccat', 'riepilogo',
  'geweig', 'afgewez', 'geannul', 'geautoris', 'behandel', 'voorbeeld', 'aanbied', 'totaal', 'overzicht', 'geblokk',
  'wstrzym', 'toku', 'jutro', 'anulow', 'odrzuc', 'autoryz', 'oczekuj', 'symul', 'przykład', 'darmow', 'zablok',
  'imorgon', 'nekad', 'avbrut', 'preliminär', 'väntar', 'erbjud', 'totalt', 'spärr', 'afvist', 'avvist',
  'foreløb', 'foreløp', 'venter', 'eksempel', 'tilbud', 'samlet', 'blokeret', 'blokkert', 'blokov', 'gesperr', 'spärr', 'zítra', 'zruš', 'zamít',
  'čeká', 'rezerv', 'příklad', 'zdarma', 'nabíd', 'celkem', 'pending', 'declin', 'revers', 'sample', 'preview',
  'payout', 'cashback', 'referral', 'tomorrow', 'statement', 'hold', 'possib', 'tôt', 'sobald', 'asap',
].join('|') + String.raw`|(?:ej|inte|ikke|nie|non|not|niet|pas)(?![\p{L}\p{N}]))`, 'iu');
// Money coming back, refused under a debit or fee heading ("Entgelt … -
// RÜCKERSTATTUNG", "Kosten … Omschrijving: terugbetaling kosten").
// The same without the "example" words: fictional counterparties are often
// named so ("EXEMPEL AB"), and a sample is announced in the heading instead.
const EUROPEAN_NAME_DOUBT = new RegExp(EUROPEAN_DOUBT.source.replace(/'?(?:beispiel|muster|exempl|ejemplo|esempio|voorbeeld|przykład|eksempel|příklad|sample)\|/gu, ''), 'iu');
// A status anywhere in a heading's own text: the stems above, or any
// European status word, hedge, prompt or negation (EUROPEAN_STATUS below).
const europeanDoubt = (text: string): boolean => EUROPEAN_DOUBT.test(withoutNeutralPhrases(text)) || europeanStatus(text, true, [], true);
const EUROPEAN_BACK = /(?<![\p{L}\p{N}])(?:erstatt|rückerstatt|gutschrift|zurück|rembours|terug|devol|devuel|rimbors|zwrot|zwróc|vrác|vrat|återbet|tilbage|tilbake|refund|estorn|reembols|stornat|storno|revers)/iu;
const EUROPEAN_CARD_PURPOSE = /(?<![\p{L}\p{N}])(?:karten?abrechnung|kreditkart|carte|tarjeta|carta|cart[ãa]o|karta|kort|creditcard|credit\s*card|visa|mastercard|amex|nexi|cartasi)/iu;
const EUROPEAN_DATE_FIELD = /^(?:datum|date|le|fecha(?:\s+(?:de\s+)?operaci[oó]n)?|data(?:\s+(?:operazione|do\s+movimento|operacji))?|bogført|bokført|buchung|buchungstag|valuta|uhrzeit)$/iu;
const EUROPEAN_INSTRUMENT_FIELD = /^(?:kto|rek|rach|cta|cpte|úč|c\/c|konto|karte|kartennummer|carte|compte|tarjeta|cuenta|carta|conto|rekening|tegenrekening|conta|karta|rachunek|účet|referenz)$/iu;
const EUROPEAN_PURPOSE_FIELD = /^(?:verwendungszweck|libellé|concepto|causale|omschrijving|descritivo|tytuł|tytul|meddelande|tekst|zpráva)$/iu;
const EUROPEAN_DATE_VALUE = new RegExp(String.raw`^(?:[\d\s./:,h-]|kl\.?|uhr|um|à|a\s+las|alle(?:\s+ore)?|om|às|o|(?:${['jan', 'feb', 'mär', 'mar', 'apr', 'mai', 'may', 'jun', 'jul', 'aug', 'sep', 'okt', 'oct', 'nov', 'dez', 'dec', 'des', 'ene', 'gen', 'fév', 'fev', 'avr', 'juin', 'juil', 'août', 'ago', 'set', 'ott', 'dic', 'mei', 'maj', 'okt', 'lis', 'říj', 'zář', 'out', 'dez'].join('|')})\p{L}*\.?)+$`, 'iu');
const EUROPEAN_FOOTER_GLUE = new Set(`sperr-notruf sperrnotruf bel ons op ring appelez le la llama al chiama il ligue zadzwoń volejte stuur stop
stopp send envía envia baja répondez repondez wyślij wyslij an nach rufen sie uns call us at pour ne plus recevoir d'alertes alertes
d alerts para darte de gestisci gli avvisi nell'app nell app pode desativar alertas na app aby zrezygnować ändra aviseringar i appen
afmeld afmelden avslutt abmelden details mehr meer plus d'infos infos más mas info maggiori informazioni mais informação więcej více
detaljer ce n'est n est pas vous si no reconoces esta operación operacion se non riconosci l'operazione operazione não nao reconhece
este movimento nie rozpoznajesz transakcji känner du inte igen köpet kender ikke købet ikke deg nebyli jste to vy niet herkend
unbekannte zahlung opération inconnue contactez-nous au`.split(/\s+/u));

const EUROPEAN_BALANCE_GLUE = new Set(`neuer nouveau new saldo solde disponible kontostand guthaben verfügbarer verfügbar kreditrahmen
disponibilità residua disponibile plafond de paiement restant disponível disponivel límite limite beschikbaar beschikbare limiet
tillgänglig kredit disponibelt belopp disponibel rådighed på kortet tilgjengelig kreditt dostępne środki dostępny limit
disponibilní zůstatek volný karty available balance disp`.split(/\s+/u));
/** Footer or balance text in a line: only its own words, numbers, links and opt-out codes. */
/** One typing slip: a swapped, missing, extra or changed letter ("sadlo", "dsiponible"). */
const oneSlip = (word: string, known: string): boolean => {
  if (Math.abs(word.length - known.length) > 1 || word === known) return word === known;
  let i = 0;
  while (i < word.length && i < known.length && word[i] === known[i]) i += 1;
  if (word.length === known.length) {
    if (word.slice(i + 1) === known.slice(i + 1)) return true;
    return word[i] === known[i + 1] && word[i + 1] === known[i] && word.slice(i + 2) === known.slice(i + 2);
  }
  return word.length > known.length ? word.slice(i + 1) === known.slice(i) : word.slice(i) === known.slice(i + 1);
};
const GLUE_WORDS = [...new Set([...EUROPEAN_FOOTER_GLUE, ...EUROPEAN_BALANCE_GLUE])].filter((word) => word.length >= 5);
const glueWord = (lower: string): boolean => EUROPEAN_FOOTER_GLUE.has(lower) || EUROPEAN_BALANCE_GLUE.has(lower) ||
  (lower.length >= 5 && !europeanStatus(lower) && GLUE_WORDS.some((known) => oneSlip(lower, known)));
const onlyFooterOrBalance = (text: string): boolean =>
  (text.replace(/https?:\/\/\S+|\S+\.example\/\S*/gu, ' ').match(/[\p{L}\p{M}'’-]+/gu) ?? []).every((word) => {
    const lower = word.toLocaleLowerCase('de-DE');
    return glueWord(lower) || /^(?:[A-Z]{3}|kr|zł|Kč|Fr|STOPP?|BAJA)$/u.test(word);
  });
// Benign drift of a European layout, blanked to the same length so offsets
// still hold: a reference or authorisation number ("Referenz: 587316", "N°
// autorisation 116361", "ID transakcji 531158"), a date leading the message
// ("27.09.2026 08:44: Einkauf …"), a bank signature after a dash ("… -
// Rabobank"), a card mask on its own or in brackets ("\n*8373", "(xxxx3097)"),
// and a dash used as the colon after a bank name or a field label
// ("ING – Einkauf …", "Montant – 80,74 €").
const EUROPEAN_REFERENCE = /(?<![\p{L}\p{N}])(?:ref(?:erenz|erence|erens|eranse)?\.?|rif\.?|réf\.?|kenmerk|beleg-?nr\.?|bilagsnr\.?|vs|id\s+transakcji|nr\s+ref\.?|n[º°]\.?\s*(?:de\s+)?operaci[oó]n|n\.?\s*º\s*opera[cç][ãa]o|cod\.?\s+operazione|n[º°]\.?\s*(?:d['’])?autori[sz]ation|code\s+d['’]autori[sz]ation|auth(?:ori[sz]ation)?\s+code|terminal\s+id)\s*[:#.]?\s*[A-Z]{0,3}-?\d[\d-]{2,19}(?![\p{L}\p{N}])/giu;
const LEADING_DATE = /^\s*(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2}\.?\s+\p{L}{3,5}\.?)(?:\s+(?:à|a\s+las|às|om|kl\.?|um)?\s*\d{1,2}[:.h]\d{2})?\s*[-–:]?\s+(?=\p{L})/u;
const TRAILING_BANK = /[ \t]+[-–][ \t]+\p{Lu}[\p{L}&.'’]*(?:[ \t]+[\p{Lu}\p{N}][\p{L}\p{N}&.'’]*){0,2}[ \t]*$/u;
const LONE_MASK = /(?:^|(?<=\n))[ \t]*\(?(?:[x*•·]{2,}|\.{2,3}|\*)\d{2,6}\)?[ \t]*(?=\n|$)|[ \t]\((?:[x*•·]+|\.{2,3})\d{2,6}\)/giu;
const blank = (match: string) => ' '.repeat(match.length);
// A reference whose value is itself a status ("Ref: STORNO-4711") is kept.
const blankReference = (match: string) => europeanDoubt(match.replace(/^\S+\s*/u, '')) || EUROPEAN_BACK.test(match) ? match : blank(match);
// A bank's signature: a bank-like name, never a notice, return or status word.
const BANK_NAME = /(?<![\p{L}])(?:bank|banque|banca|banco|banka|sparkasse|kasse|kassa|spořitelna|raiffeisen|rabobank|nordea|belfius|intesa|sanpaolo|unicredit|crédit|credit\s+agricole|caixa|santander|bbva|ing|kbc|abn|commerzbank|postfinance|ubs|seb|dnb|swedbank|handelsbanken|danske|jyske|nykredit|millennium|novo\s+banco|cgd|pekao|pko|mbank|čsob|csob|erste|revolut|n26|bunq|vipps|mobilepay|swish|boursobank|lcl|bnp|société\s+générale|sparebank|nationale[-\s]nederlanden)(?![\p{L}])/iu;
// Decorative emoji a bank appends; a status pictograph (↩️ ✖️ ⚠️ ❌ ⏳) is wording.
const DECORATIVE_TAIL = /[ \t]*(?:✅|💳|🙂|😊|🔔|🎉|👍|✨|📱|💰|☺️|🛒|💸)[ \t]*$/u;
const normalizeEuropeanLayout = (source: string): string => {
  let text = source.replace(EUROPEAN_REFERENCE, blankReference).replace(LONE_MASK, blank).replace(LEADING_DATE, blank)
    .replace(DECORATIVE_TAIL, blank);
  // "Bank – Heading" / "Label – value": the dash after a leading name or a field label is a colon.
  text = text.replace(/(^|;[ \t]+|[ \t]\|[ \t]+)([ \t]*[^\p{L}\p{N}\n]*[\p{L}][\p{L}\p{N}&.'’ ]{0,30}?)[ \t]([-–])[ \t]/gmu, (match, lead: string, head: string) =>
    EUROPEAN_FIELD.test(`${head.trim().replace(/^[^\p{L}]+/u, '')}: x`) || (lead === '' && BANK_NAME.test(head) &&
      !head.trim().split(/\s+/u).some((word) => EUROPEAN_NOTICE_PREFIX.test(word)) && !europeanDoubt(head) && /^[ \t]*[^\p{L}\p{N}\n]*(?:[\p{Lu}\p{N}][\p{L}\p{N}&.'’-]*[ \t]*){1,4}$/u.test(head))
      ? `${lead}${head}: ${' '.repeat(match.length - lead.length - head.length - 2)}` : match);
  const signature = text.match(TRAILING_BANK);
  // A bank name, never a movement word ("- GUTSCHRIFT", "- REMBOURSÉE").
  if (signature && BANK_NAME.test(signature[0]) && !europeanDoubt(signature[0]) && !EUROPEAN_BACK.test(signature[0]) &&
    !EUROPEAN_NOTICE_PREFIX.test(signature[0].replace(/^[ \t]*[-–][ \t]*/u, '')) &&
    !hasEuropeanPackWording(signature[0], EUROPEAN_HEADING_MARKETS)) text = text.slice(0, signature.index) + blank(signature[0]);
  return text;
};
const EUROPEAN_TRAILER_START = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:` + EUROPEAN_FOOTER_LINE.source.slice(4, -1) +
  String.raw`|(?:neuer\s+|nouveau\s+)?(?:saldo|solde|kontostand|guthaben|verfügbar\p{L}*|disponib\p{L}*|plafond|l[ií]mite|beschikba\p{L}*|tillgänglig|tilgjengelig|rådighed|dostępn\p{L}*|zůstatek|volný\s+limit))`, 'iu');
const headingPatterns = new Map<UniversalMarket, RegExp | null>();
const headingPattern = (market: UniversalMarket): RegExp | null => {
  if (headingPatterns.has(market)) return headingPatterns.get(market)!;
  const terms = alertMarketPack(market).headingTerms ?? [];
  const pattern = terms.length ? new RegExp(`^(${termAlternation(terms.map(termKey))})(?=$|[^\\p{L}\\p{N}])`, 'iu') : null;
  headingPatterns.set(market, pattern);
  return pattern;
};

/** A name part of a heading line ("- Rewe Sagt Danke -"): all-caps, digits or several capitalised words. */
const nameLike = (part: string): boolean => {
  const words = part.match(/[\p{L}\p{M}'’&*.]+/gu) ?? [];
  if (!words.length || !words.every((word) => /^[\p{Lu}\p{N}*&]/u.test(word))) return false;
  return /\p{N}/u.test(part) || words.some((word) => /^[\p{Lu}&'’.*-]{2,}$/u.test(word)) || words.length >= 2 ||
    (words.length === 1 && /^\p{Lu}\p{Ll}{2,}$/u.test(words[0]) && !EUROPEAN_HEADING_GLUE.has(words[0].toLocaleLowerCase('de-DE')));
};

/**
 * A European notification that states its movement only as a heading:
 * "Kartenzahlung / Betrag: 27,15 EUR / Händler: REWE", "Einkauf 58,40 EUR -
 * BUCHLADEN NORD - 03.10.2026", "Compra de 18,45 EUR con su tarjeta …1234 en
 * SHOP el 03/10/2026". Positive evidence of that template is required, not
 * merely the absence of a known veto word:
 *  - the principal is a European currency (EUR, CHF, PLN, SEK, DKK, NOK, CZK);
 *  - the message opens (after an optional bank name) with a pack heading term;
 *  - after the amount, the heading line holds only known connectors, dates,
 *    times, card masks, the masked merchant and name-like parts;
 *  - every other line is a known field ("Betrag: …"), a balance line or a known
 *    footer, and the amount sits in the heading line or an amount field;
 *  - a "from" field cannot sit under a debit heading, nor "to" under a credit;
 *  - no language pack reads anything declined, pending, future, conditional,
 *    a request, a statement or a code anywhere in the unmasked message.
 * The universal reader's own controls (pending anywhere, questions, chat,
 * unclaimed money, statements) still run afterwards.
 */
export const europeanHeadingMovement = (
  source: string,
  maskedSource: string,
  principal: { start: number; end: number; currency: string },
  moneySpans: readonly { start: number; end: number }[],
  packs: readonly UniversalMarket[],
  sender?: string | null,
): { direction: MoneyDirection; family: AlertFamily } | null => {
  if (!EUROPEAN_HEADING_CURRENCIES.has(principal.currency) || source.length > 600) return null;
  source = normalizeEuropeanLayout(source);
  maskedSource = normalizeEuropeanLayout(maskedSource);
  const markets = EUROPEAN_HEADING_MARKETS.filter((market) => packs.includes(market));
  if (!markets.length) return null;
  // Lines with their offsets; " | " and "; " join fields on one line too.
  const lines: { start: number; text: string }[] = [];
  let from = 0;
  // Lines come from the unmasked source (a field's value is the masked
  // merchant); the heading tail below is read from the masked text.
  for (const match of source.matchAll(/\r?\n|\s+\|\s+|;\s+/gu)) {
    const text = source.slice(from, match.index);
    if (text.trim()) lines.push({ start: from, text });
    from = match.index! + match[0].length;
  }
  if (source.slice(from).trim()) lines.push({ start: from, text: source.slice(from) });
  if (!lines.length || lines.length > 12) return null;
  // An optional bank-name line or "Bank:" prefix before the heading.
  let index = 0;
  const clean = (text: string) => text.replace(/^[^\p{L}\p{N}]+/u, '');
  let headingText = clean(lines[0].text);
  let headingStart = lines[0].start + (lines[0].text.length - headingText.length);
  let hit: { market: UniversalMarket; term: string } | null = null;
  const find = (text: string) => {
    for (const market of markets) {
      const match = headingPattern(market)?.exec(text);
      if (match) return { market, term: match[1] };
    }
    return null;
  };
  hit = find(headingText);
  if (!hit) {
    // Only a bank name may stand before the heading: capitalised words, not a
    // notice word ("Erinnerung:", "Hinweis:", "Promemoria:") or a sentence.
    const prefix = headingText.match(/^(?:[\p{Lu}\p{N}][\p{L}\p{N}&.'’-]*\s*){1,4}:\s*/u);
    if (prefix && !EUROPEAN_NOTICE_PREFIX.test(prefix[0]) && !europeanDoubt(prefix[0]) &&
      find(clean(headingText.slice(prefix[0].length)))) {
      const rest = clean(headingText.slice(prefix[0].length));
      headingStart += headingText.length - rest.length;
      headingText = rest;
      hit = find(rest);
    } else if (lines.length > 1 && /^(?:[\p{Lu}\p{N}][\p{L}\p{N}&.'’-]*\s*){1,3}$/u.test(lines[0].text.trim()) &&
      !/\p{N}/u.test(lines[0].text) && !EUROPEAN_NOTICE_PREFIX.test(lines[0].text) && !europeanDoubt(lines[0].text)) {
      index = 1;
      headingText = clean(lines[1].text);
      headingStart = lines[1].start + (lines[1].text.length - headingText.length);
      hit = find(headingText);
    }
  }
  if (!hit) return null;
  const headingLine = lines[index];
  const headingEnd = headingLine.start + headingLine.text.length;
  // The amount belongs to the heading line or to an amount field.
  let amountOwned = principal.start >= headingStart && principal.end <= headingEnd;
  let fromField = false, toField = false, sign = '', purpose = '';
  for (const line of lines.slice(index + 1)) {
    const text = clean(line.text).trim();
    const field = EUROPEAN_FIELD.exec(text);
    if (field) {
      const label = field[1];
      const value = text.slice(text.search(/[:：]/u) + 1).trim();
      if (EUROPEAN_FROM_FIELD.test(label)) fromField = true;
      if (EUROPEAN_TO_FIELD.test(label)) toField = true;
      // A payment to the reader's own credit card settles a bill.
      if (EUROPEAN_OWN_CARD.test(text)) return null;
      const holdsPrincipal = principal.start >= line.start && principal.end <= line.start + line.text.length;
      if (holdsPrincipal) {
        if (!EUROPEAN_AMOUNT_FIELD.test(label)) return null;
        amountOwned = true;
      }
      // Each field value must look like its kind: an amount is only money, a
      // date only a date, a card or account only a mask; a name or a purpose
      // carries no qualifying word, no parenthesis and no lower-case prose.
      if (EUROPEAN_AMOUNT_FIELD.test(label)) {
        if (!holdsPrincipal || /\p{L}{4,}/u.test(value.replace(/\b[A-Z]{3}\b|kr\.?|zł|Kč|Fr\./gu, ''))) return null;
        sign = value.match(/^[+-]/u)?.[0] ?? sign;
      } else if (EUROPEAN_DATE_FIELD.test(label)) {
        if (!EUROPEAN_DATE_VALUE.test(value)) return null;
      } else if (EUROPEAN_INSTRUMENT_FIELD.test(label)) {
        // A card or account is a mask, a reference a code; never a word.
        if (/\p{Ll}/u.test(value) || (/^referenz$/iu.test(label) && /\p{L}{4,}/u.test(value))) return null;
      } else if (EUROPEAN_PURPOSE_FIELD.test(label)) {
        if (europeanDoubt(value)) return null;
        purpose += ` ${value}`;
      } else if (EUROPEAN_NAME_DOUBT.test(value) || EUROPEAN_STATUS.test(value) || /[()]/u.test(value) ||
        (EUROPEAN_TO_FIELD.test(label) && EUROPEAN_CARD_PURPOSE.test(value)) ||
        (value.match(/[\p{L}\p{M}'’]+/gu) ?? []).some((word) => /^\p{Ll}/u.test(word) && !EUROPEAN_HEADING_GLUE.has(word))) {
        return null;
      }
      continue;
    }
    if (EUROPEAN_BALANCE_LINE.test(text) && !(principal.start >= line.start && principal.end <= line.start + line.text.length) &&
      onlyFooterOrBalance(text)) continue;
    // A footer is only the bank's own template: its phrase, a phone number,
    // a link and opt-out words. Any other word may qualify the movement.
    if (EUROPEAN_FOOTER_LINE.test(text) && (text.match(/[?？]/gu) ?? []).length <= 1 &&
      !moneySpans.some((span) => span.start >= line.start && span.end <= line.start + line.text.length) &&
      onlyFooterOrBalance(text)) continue;
    return null;
  }
  if (!amountOwned || EUROPEAN_OWN_CARD.test(source.slice(headingStart, headingEnd))) return null;
  // Everything after the heading term on its line: amounts, dates, masks,
  // the masked merchant, connectors and name parts only.
  // Read from the unmasked text: a merchant name can swallow a trailing
  // status ("bei SHOP gesperrt"), and only capitalised name words or known
  // connectors may follow the amount.
  let tailEnd = headingEnd;
  const trailer = EUROPEAN_TRAILER_START.exec(source.slice(headingStart + hit.term.length, headingEnd));
  if (trailer) {
    tailEnd = headingStart + hit.term.length + trailer.index;
    // A balance or footer glued to the heading line ("… Neuer Saldo …
    // Unbekannte Zahlung? Sperr-Notruf …") carries nothing else.
    if (principal.end > tailEnd || (source.slice(tailEnd, headingEnd).match(/[?？]/gu) ?? []).length > 1 ||
      !onlyFooterOrBalance(source.slice(tailEnd, headingEnd))) return null;
  }
  let tail = source.slice(headingStart + hit.term.length, tailEnd);
  for (const span of moneySpans) {
    const a = Math.max(span.start, headingStart + hit.term.length), b = Math.min(span.end, tailEnd);
    if (b > a) tail = tail.slice(0, a - headingStart - hit.term.length) + ' '.repeat(b - a) + tail.slice(b - headingStart - hit.term.length);
  }
  // A code mixing letters and digits ("HM4KQ2", "Z1234") is part of a name.
  tail = tail.replace(/https?:\/\/\S+/gu, ' ').replace(/(?<![\p{L}\p{N}])\p{L}+\p{N}[\p{L}\p{N}]*(?![\p{L}\p{N}])/gu, ' ')
    .replace(/[\d][\d./:,'’-]*/gu, ' ').replace(/[*x•·]{2,}\S*/giu, ' ');
  if (europeanDoubt(tail) || /[()=]/u.test(tail)) return null;
  const parts = tail.split(/\s+[-–·]\s+|\s+·\s*/u);
  // After the amount only ONE name (the merchant) may stand, beside known
  // connectors, dates, times and card masks; a second unexplained part
  // ("bei REWE - Esito …", "- REWE - VOORLOPIG") sends the alert to Review.
  let names = 0;
  for (const [position, part] of parts.entries()) {
    const words = part.match(/[\p{L}\p{M}'’]+/gu) ?? [];
    if (words.every((word) => EUROPEAN_HEADING_GLUE.has(word.toLocaleLowerCase('de-DE')))) continue;
    if (position > 0) {
      // One title-case word ("- Rossmann -") names a shop only between
      // other parts; at the end it is as likely a notice ("- Entwurf").
      if (nameLike(part) && !(position === parts.length - 1 && words.length === 1 && /^\p{Lu}\p{Ll}+$/u.test(words[0]))) {
        names += 1;
        if (names > 1) return null;
        continue;
      }
      return null;
    }
    // Capitalised name words may follow a connector ("am Geldautomaten HBF
    // KOELN", "bei Rewe Sagt Danke"); lower-case unknown words never.
    if (words.every((word) => EUROPEAN_HEADING_GLUE.has(word.toLocaleLowerCase('de-DE')) || /^[\p{Lu}\p{N}]/u.test(word))) {
      names += 1;
      continue;
    }
    return null;
  }
  // Nothing anywhere in the unmasked message may qualify the movement.
  const flat = source.replace(/[\n\r;!?]|\.(?!\d)/gu, ' ');
  for (const market of packs) {
    const reading = inspectMarketAlert(flat, market, { sender });
    if (reading.status === 'failed' || reading.status === 'future' || reading.family === 'authentication' ||
      reading.family === 'statement' || (reading.status === 'informational' && reading.family !== 'balance')) return null;
  }
  const pack = alertMarketPack(hit.market);
  const debit = Boolean(findTerm(hit.term, pack.debitTerms ?? []));
  const credit = Boolean(findTerm(hit.term, pack.creditTerms ?? []));
  const direction: MoneyDirection = debit === credit ? 'unknown' : debit ? 'debit' : 'credit';
  if ((direction === 'debit' && fromField) || (direction === 'credit' && toField) || (fromField && toField)) return null;
  // A signed amount must agree with the heading; money coming back under a
  // debit or fee heading, or a card-bill purpose, is not new spending.
  const principalText = source.slice(Math.max(0, principal.start - 2), principal.end);
  if (/\+/u.test(principalText) || sign === '+') { if (direction !== 'credit') return null; }
  if ((/-\s*\d/u.test(principalText) || sign === '-') && direction !== 'debit') return null;
  if (direction !== 'credit' && (EUROPEAN_BACK.test(source.slice(headingStart + hit.term.length)) || EUROPEAN_CARD_PURPOSE.test(purpose))) return null;
  // "Gesendet von LUKAS … an dich", "Virement émis par CLAIRE … à votre
  // attention": a debit heading that names a sender or the reader as payee.
  if (direction !== 'credit' && (EUROPEAN_TO_READER.test(source) ||
    EUROPEAN_FROM_NAME.test(source.slice(headingStart, headingEnd)))) return null;
  const reading = inspectMarketAlert(hit.term, hit.market, { sender });
  const family: AlertFamily = reading.family !== 'unknown' ? reading.family
    : findTerm(hit.term, pack.transferTerms) ? 'transfer' : 'unknown';
  return { direction, family };
};

/* ── European whole-message refusal ─────────────────────────────────────── */

// The status words themselves (declined, held, pending, returned, …, in every
// language, every inflection) live in alert-status-lexicon.ts. This reader
// adds the function words, hedges and reply prompts below.
// Whole words ("wird", "sera", "vil"); a trailing * opens a stem ("möglich*").
const EUROPEAN_STATUS_WORDS = [
  // Future auxiliaries and "tomorrow": the movement has not happened yet.
  'wird', 'werden', 'sera', 'seront', 'será', 'serán', 'seran', 'sarà', 'sara', 'saranno', 'verrà', 'verra',
  'verranno', 'serao', 'serão', 'wordt', 'worden',
  'zal', 'zullen', 'zostanie', 'zostaną', 'będzie', 'bude', 'budou', 'kommer', 'blir', 'bliver', 'vil',
  'morgen', 'demain', 'mañana', 'manana', 'domani', 'amanhã', 'amanha', 'jutro', 'imorgon', 'zítra', 'zitra',
  'geplant', 'programad*', 'programmat*', 'agendad*', 'zaplanowan*', 'planlagt', 'schemalagd', 'naplánov*',
  'en cours', 'in corso', 'em curso', 'en curso', 'en proceso', 'em processamento', 'en trámite', 'en tramite',
  'w toku', 'w trakcie', 'in elaborazione', 'in lavorazione',
  // Hedges: the money may or may not have moved.
  'kan ha', 'kan vara', 'kan være', 'kan have', 'kan zijn', 'kann', 'könnte', 'möglicherweise', 'eventuell',
  'vielleicht', 'pourrait', 'peut-être', 'podría', 'podria', 'puede que', 'potrebbe', 'poderá', 'podera',
  'pode ter', 'mogelijk', 'misschien', 'może', 'mogł*', 'możliw*', 'možná', 'mozna', 'mohl*', 'pravděpodob*',
  'muligvis', 'muligens', 'kanskje', 'måske', 'kanske', 'sannolik*', 'probabil*', 'éventuel*',
  // A reply, tap or acceptance the reader still owes.
  // (A bare tap/click verb opens a receipt or the app; only receiving or
  // accepting the money, or replying, keeps it unsettled.)
  'for å motta', 'for at modtage', 'för att ta emot', 'odpovězte', 'odpovězte', 'odpowiedz', 'antworten', 'répondez', 'repondez', 'responda', 'responde',
  'rispondi', 'antwoord', 'svar', 'svara', 'acceptez', 'accepter', 'akzeptieren', 'aceptar', 'acepta', 'aceite',
  'aceitar', 'accettare', 'accetta', 'accepteer', 'accepteren', 'zaakceptuj', 'zaakceptować', 'přijmout',
  'přijměte', 'godkänn', 'godkend', 'godta', 'acceptere', 'akseptere', 'acceptera', 'modtage', 'ta emot',
  'ta imot', 'annehmen',
];
// Negations: "NO REALIZADA", "não efetuada", "ikke gennemført", "non riuscito".
// Spanish "no" counts only before a participle (Portuguese "no dia" is "on the").
// French "pas" only after "ne"/"n'" or before a participle (Dutch "pas" is a card).
const EUROPEAN_NEGATION = String.raw`nicht|kein(?:e[nrs]?)?|n(?:e|['’])\s*\p{L}+(?:\s+\p{L}+)?\s+pas|pas\s+(?:encore\s+)?(?:été\s+)?(?:effectu|abouti|valid|autoris|accept|r[ée]alis|d[ée]bit|cr[ée]dit|pass[ée]|trait|ex[ée]cut)\p{L}*|aucune?|non(?!-)|n[ãa]o|nenhuma?|niet|geen|nie|inte|ej|icke|ikke|ingen|nessun[oa]?|nebyl[aoi]?|(?<=[:：][ \t]{0,3})ne|ne(?=[ \t]*[.!]?[ \t]*(?:\n|$))|no\s+(?:se\s+|ha\s+(?:sido\s+)?|han\s+(?:sido\s+)?|fue\s+|pudo\s+|est[áa]\s+|es\s+)?\p{L}+(?:ad|id)[oa]s?`;
const stemSource = (stems: readonly string[]) => stems.map((stem) =>
  stem.replace(/\*$/u, '').split(' ').map(escapeRegExp).join('\\s+') + (stem.endsWith('*') ? '' : '(?![\\p{L}\\p{N}])')).join('|');
// Participles and phrases count in any case ("ABGELEHNT", "IN CORSO");
// single function words ("wird", "kann", "sera", "vil") only when not
// spelled in capitals, which is how a merchant name ("KANN BAR", "SERA
// PETCARE") is written. Word-start stems: "pendiente", "pendente".
const EUROPEAN_PHRASES = EUROPEAN_STATUS_WORDS.filter((word) => word.includes(' '));
const EUROPEAN_SINGLES = EUROPEAN_STATUS_WORDS.filter((word) => !word.includes(' '));
const EUROPEAN_STATUS_CORE = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:pendient|pendent|${stemSource(EUROPEAN_PHRASES)})|(?<![\p{L}\p{N}'’])(?:${EUROPEAN_NEGATION})(?![\p{L}\p{N}])`, 'iu');
const EUROPEAN_STATUS_SINGLE = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${stemSource(EUROPEAN_SINGLES)})`, 'giu');
// English loan words, counted only in European-language wording.
const EUROPEAN_STATUS_LOAN = /invalid|declin|pending|revers/iu;
// A capitalised name ("Sara García", "Vil Hansen") is not the function word.
const NAME_LIKE_WORDS = new Set(['sara', 'sera', 'vil', 'zal', 'svar', 'kommer']);
// A status pictograph: declined, pending, blocked, reversed, a warning.
const STATUS_PICTOGRAPH = /[❌❎✖⚠⏳⌛🚫⛔🔄🔁↩↪🔙❗❓⏰🕒🛑]/u;
// A warning sign that only heads the balance line ("⚠️ Saldo del Pocket EUR:
// 5,52 €", Revolut) flags a low balance, not the movement it follows.
const BALANCE_WARNING = /⚠\uFE0F?\s*(?=(?:saldo|balance|solde|kontostand|guthaben|available|disponible|beschikbaar)(?![\p{L}]))/giu;
const europeanStatus = (text: string, loanWords = true, ignoreConcepts: readonly StatusConcept[] = [], nameRun = false): boolean => {
  // (Only a status of the movement itself: never one in a conditional clause,
  // nor an English word inside a capitalised name run — "chez PAYMENT REQUEST
  // ACCEPTED CAFE". A European status word, or an English one these readers
  // always knew — EUROPEAN_STATUS_LOAN — counts in any name: "bei ABGELEHNT …".)
  if (transactionStatusWords(text, { nameRunWord: (match) => match.language === 'en' && !EUROPEAN_STATUS_LOAN.test(match.text) }).some((match) => match.concept === 'example' || match.concept === 'unreadable' ||
    ((loanWords || match.language !== 'en') && !ignoreConcepts.includes(match.concept)))) return true;
  if (EUROPEAN_STATUS_CORE.test(text) || (loanWords && EUROPEAN_STATUS_LOAN.test(text)) ||
    STATUS_PICTOGRAPH.test(text.replace(BALANCE_WARNING, ''))) return true;
  // In an all-capitals SMS ("BELASTUNG KANN ERFOLGEN") capitals are its wording.
  const letters = text.match(/\p{L}/gu) ?? [];
  const shouting = letters.length > 0 && letters.filter((letter) => /\p{Lu}/u.test(letter)).length / letters.length > 0.8;
  return [...text.matchAll(EUROPEAN_STATUS_SINGLE)].some((match) => {
    const word = match[0];
    const lower = word.toLocaleLowerCase('de-DE');
    if (word === lower) return true;
    // A capitalised word is a name part only beside the money ("bei KANN
    // BAR"); on a line or sentence of its own ("C'ÉTAIT VOUS ? RÉPONDEZ OUI")
    // it is wording.
    const from = Math.max(text.lastIndexOf('\n', match.index!), ...['.', '?', '!'].map((stop) => text.lastIndexOf(stop, match.index!)));
    const nextStop = text.slice(match.index!).search(/[\n.?!]/u);
    const segment = text.slice(from + 1, nextStop < 0 ? text.length : match.index! + nextStop);
    if (word === word.toLocaleUpperCase('de-DE')) return shouting || (!nameRun && !/\d/u.test(segment));
    return !NAME_LIKE_WORDS.has(lower);
  });
};
const EUROPEAN_STATUS = { test: (text: string): boolean => europeanStatus(text) };
/** A European status, hedge, claim prompt or negation in this text (exported for tests). */
export const hasEuropeanStatusWord = (text: string): boolean => europeanStatus(text);

// Template sentences that carry negations or prompts without qualifying the
// movement: the banks' fraud footers, "do not reply", "no action needed",
// opt-outs and PIN advice. They are blanked before the whole message is read.
// A footer phrase never reaches across a line ("Köpet godkändes inte\nDu har
// fått …" is a status, then the movement), and a footer QUESTION is one only
// with its question mark ("Var det inte du?").
const EUROPEAN_FOOTER_STRIP = new RegExp([
  `(?:${EUROPEAN_FOOTER_QUESTION.source.slice('(?<!\\p{L})(?:'.length, -')\\s*$'.length)})(?:[ \\t]*[?？]|(?<=abmelden|afmelden|afmeld))`,
  // "If you did not make this payment, call …"
  String.raw`(?:wenn|falls)\s+sie\s+(?:\p{L}+\s+){0,3}?nicht\s+(?:selbst\s+)?(?:getätigt|veranlasst|autorisiert|durchgeführt|vorgenommen|erkennen)`,
  String.raw`si\s+vous\s+(?:n['’][êe]tes\s+pas\s+[àa]\s+l['’]origine|ne\s+reconnaissez\s+pas)`,
  String.raw`si\s+no\s+(?:has|ha)\s+(?:realizado|sido\s+t[uú]|hecho)|si\s+no\s+reconoces?`,
  String.raw`se\s+non\s+(?:hai|ha)\s+(?:effettuato|eseguito|autorizzato)|se\s+non\s+riconosci`,
  String.raw`se\s+n[ãa]o\s+(?:reconhece|fez|efetuou|realizou)`,
  String.raw`als\s+(?:u|je)\s+(?:dit|deze\s+\p{L}+)\s+niet\s+(?:herkent|heeft\s+gedaan|hebt\s+gedaan)`,
  String.raw`je(?:śli|żeli|sli|zeli)\s+(?:to\s+nie\s+(?:ty|by[łl]e[śs])|nie\s+(?:dokona[łl]e[śs]|rozpoznajesz))`,
  String.raw`om\s+(?:det\s+inte\s+var\s+du|du\s+inte\s+(?:känner\s+igen|har\s+gjort))`,
  String.raw`hvis\s+(?:det\s+ikke\s+var\s+(?:dig|deg)|du\s+ikke\s+(?:kender|genkender|kjenner|gjenkjenner|har\s+(?:foretaget|gjort)))`,
  String.raw`pokud\s+(?:jste\s+(?:platbu\s+|transakci\s+)?neprovedli|platbu\s+nepozn[áa]v[áa]te|jste\s+to\s+nebyli\s+vy)`,
  String.raw`var\s+det\s+inte\s+du|var\s+det\s+ikke\s+(?:dig|deg)|waren\s+sie\s+das\s+nicht`,
  // The English fraud footer some European banks append ("Not you? Visit …").
  String.raw`not\s+you\s*\?|wasn['’]?t\s+you\s*\?|didn['’]?t\s+make\s+(?:this|it)\s*\?|unrecogni[sz]ed\s*\?|if\s+you\s+(?:did\s+not|didn['’]t|have\s+not|haven['’]t)\s+(?:make|made|authori[sz]ed?|recogni[sz]e)\s+this`,
  // "Do not reply", "no action needed".
  String.raw`(?:bitte\s+)?(?:nicht\s+antworten|antworten\s+sie\s+nicht)|ne\s+(?:pas\s+)?r[ée]pond(?:ez|re)(?:\s+pas)?|no\s+respond(?:as|a|er)|non\s+rispondere|n[ãa]o\s+respond(?:a|er)|niet\s+(?:beantwoorden|antwoorden)|nie\s+odpowiadaj|svara\s+inte|svar\s+ikke|ikke\s+svar|neodpov[íi]dejte`,
  String.raw`sie\s+m[üu]ssen\s+nichts|vous\s+n['’]avez\s+rien|no\s+(?:tienes|tiene|necesitas)\s+que|non\s+(?:devi|deve)\s+fare|n[ãa]o\s+(?:precisa|tem\s+de)|u\s+hoeft\s+niets|je\s+hoeft\s+niets|nie\s+musisz|du\s+beh[öo]ver\s+inte|du\s+skal\s+ikke|du\s+trenger\s+ikke|nemus[íi]te`,
  // Opt-outs.
  String.raw`pour\s+ne\s+plus\s+recevoir|para\s+(?:no|dejar\s+de)\s+recibir|per\s+non\s+ricevere|para\s+(?:n[ãa]o|deixar\s+de)\s+receber|(?:keine|nicht)\s+mehr\s+(?:erhalten|empfangen)|geen\s+\p{L}+\s+meer\s+ontvangen|svar(?:a)?\s+stopp?|send\s+stopp?|env[íi]a\s+baja|sms\s+stop`,
].map((arm) => `(?:${arm})`).join('|').replace(/\\s/gu, '[ \\t\\u00a0]'), 'giu');
const SECURITY_ADVICE = /(?<![\p{L}\p{N}])(?:pin|tan|passwort|kennwort|code|mot\s+de\s+passe|contraseña|clave|codice|senha|wachtwoord|hasło|haslo|lösenord|kode|adgangskode|passord|heslo)(?![\p{L}\p{N}])/iu;
const SECURITY_NEVER = /(?<![\p{L}\p{N}])(?:niemals|nie|nicht|jamais|nunca|mai|nooit|nigdy|aldrig|aldri|nikdy|nikomu|never)(?![\p{L}\p{N}])/iu;
const EUROPEAN_LANGUAGE_MARKETS: readonly UniversalMarket[] = EUROPEAN_HEADING_MARKETS;

/** The message without the banks' own template sentences, as one clause. */
// A footer phrase is blanked with the rest of ITS sentence ("Pour ne plus
// recevoir d'alertes, répondez STOP"), never past a "?" or a line or sentence
// end, and the rest is kept whenever it carries a status word ("Not you?
// Köpet nekades", "Du behöver inte göra något, köpet har nekats").
// (Linear in the text: each sentence's status words are found once.)
const SENTENCE_END = /[.!?？\n]/gu;
const blankFooters = (text: string): string => {
  const blanks: Array<[number, number]> = [];
  const statusBySentence = new Map<number, number[]>();
  for (const match of text.matchAll(EUROPEAN_FOOTER_STRIP)) {
    const start = match.index!, end = start + match[0].length;
    if (!match[0]) continue;
    let stop = end;
    if (!/[?？]\s*$/u.test(match[0])) {
      SENTENCE_END.lastIndex = end;
      const next = SENTENCE_END.exec(text);
      stop = next ? next.index + 1 : text.length;
      let starts = statusBySentence.get(stop);
      if (!starts) {
        const from = start;
        starts = findStatusWords(text.slice(from, stop)).map((word) => from + word.index);
        statusBySentence.set(stop, starts);
      }
      if (starts.some((at) => at >= end)) stop = end;
    }
    blanks.push([start, stop]);
  }
  if (blanks.length === 0) return text;
  let out = '';
  let at = 0;
  for (const [start, stop] of blanks) {
    if (stop <= at) continue;
    const from = Math.max(start, at);
    out += text.slice(at, from) + ' '.repeat(stop - from);
    at = stop;
  }
  return out + text.slice(at);
};
const withoutEuropeanTemplates = (source: string): string => blankFooters(withoutNeutralPhrases(source)
  .replace(EUROPEAN_REFERENCE, (reference) => ' '.repeat(reference.length))
  // A link is an address, not wording ("www.credit-agricole.fr/fraude").
  // (A domain starts only where no domain character precedes it, so the
  // reader never restarts inside "1.1.1.1…".)
  .replace(/(?:https?:\/\/|www\.)\S+|(?<![\p{L}\p{N}@.-])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,12}\/\S*/giu, (link) => ' '.repeat(link.length)))
  .split(/(?<=[.!?\n])/u)
  // PIN advice ("Geben Sie Ihre PIN niemals weiter") is blanked, a PIN failure
  // ("Pincode onjuist, nooit uitgevoerd") is not.
  .map((sentence) => SECURITY_ADVICE.test(sentence) && SECURITY_NEVER.test(sentence) && !hasStatusWord(sentence)
    ? ' '.repeat(sentence.length) : sentence)
  .join('');


/** A European pack's OWN vocabulary (not the shared English rules) occurs in the text. */
export const hasEuropeanPackWording = (text: string, packs: readonly UniversalMarket[]): boolean =>
  packs.some((market) => {
    if (!EUROPEAN_LANGUAGE_MARKETS.includes(market)) return false;
    const pack = alertMarketPack(market);
    return [pack.postedTerms, pack.failedTerms, pack.futureTerms, pack.debitTerms, pack.creditTerms,
      pack.purchaseTerms, pack.refundTerms, pack.cashTerms, pack.feeTerms, pack.headingTerms, pack.transferTerms]
      .some((terms) => terms && terms.length > 0 && findTerm(text, terms) !== null);
  });

/**
 * The whole-message counterpart of the clause reader for European wording,
 * mirroring the English whole-document refusal: once the amount's clause
 * reads as posted, the WHOLE message (without the bank's own fraud footers,
 * opt-outs and PIN advice) is read again by every pack in `packs`. Any
 * failed, future, informational, authentication or statement reading, or
 * any European status, hedge, claim prompt or negation anywhere, including
 * inside a merchant name, withdraws the posting. Returns the status to keep:
 * failed or future from a pack's own words, otherwise unknown (Review).
 */
export const europeanMessageDoubt = (
  source: string,
  maskedSource: string,
  packs: readonly UniversalMarket[],
  sender?: string | null,
  european = false,
  ignoreConcepts: readonly StatusConcept[] = [],
  principal: { start: number; end: number } | null = null,
): PostingStatus | null => {
  // A bank alert is short; a long text that reads as posted waits in Review.
  if (source.length > 1000) return 'unknown';
  // The status words are read in the unmasked text (a status can hide in a
  // merchant run: "bei REWE UNGÜLTIG"); the European packs read the text with
  // the merchant masked ("chez PAYMENT REQUEST CAFE" is a name).
  const text = withoutEuropeanTemplates(source);
  const flat = withoutEuropeanTemplates(maskedSource.length === source.length ? maskedSource : source)
    .replace(/[\n\r;!?]|\.(?!\d)/gu, ' ');
  // English wording in a European currency ("You spent €27.15 at REWE\nNICHT
  // GEBUCHT"): only the European status words themselves are read.
  // English wording in a European currency ("Card purchase of EUR 27.15 at
  // TESCO\nExpired", an Irish bank) is read with the English lexicon too.
  if (!european && !hasEuropeanPackWording(flat, packs)) {
    return europeanStatus(text, false, ignoreConcepts) || worldStatusDoubt(source, ignoreConcepts, principal) ? 'unknown' : null;
  }
  const readings = packs.filter((market) => EUROPEAN_LANGUAGE_MARKETS.includes(market))
    .map((market) => ({ market, reading: inspectMarketAlert(flat, market, { sender }) }));
  // Only wording in a European pack's own vocabulary is judged here; English
  // has its own whole-document refusal (universal-parser.ts ENGLISH_NOT_SETTLED).
  let doubt: PostingStatus | null = null;
  for (const { reading } of readings) {
    if (reading.status === 'failed') return 'failed';
    if (reading.status === 'future') doubt = 'future';
    else if (!doubt && (reading.family === 'authentication' || reading.family === 'statement' ||
      (reading.status === 'informational' && reading.family !== 'balance'))) doubt = 'unknown';
  }
  if (doubt) return doubt;
  // A one-time code ("Kod: 123456", "Código 482913"): a challenge, not a posting.
  if (/(?<![\p{L}])(?:kod|kód|kode|koden|koodi|código|codigo|codice|code|tan|passcode|clave|contraseña|senha|parola)\s*[:=]?\s*\d(?:[ -]?\d){3,7}(?![\d.,])/iu.test(text)) return 'unknown';
  if (europeanStatus(text, true, ignoreConcepts)) return 'unknown';
  // In capitals a status the lexicon does not know reads like a name. A short
  // capitalised sentence of its own after the movement ("… BEI REWE. UNTER
  // VORBEHALT") that is no sign-off, bank name or balance is unexplained: Review.
  // (Only a sentence after a stop: a capitalised LINE after the amount is the
  // merchant line many apps print — "Platba kartou 459,00 Kč\nALBERT HYPERMARKET PRAHA".)
  const sentences = text.split(/(?<=[.!?])[ \t]+|(?=\n)/u).map((sentence) => sentence.replace(/^[ \t]+|[ \t]+$/gu, '')).filter((sentence) => sentence.trim());
  if (sentences.some((sentence, index) => {
    if (sentence.startsWith('\n')) return false;
    // (A title's point does not end a sentence: "à M. DUPONT JEAN".)
    if (index === 0 || /(?:^|[\s(])(?:\p{Lu}|M{1,2}|Mme|Mlle|Mr|Mrs|Ms|Dr|Sr|Sra|Hr|Fr|Fa|Sig|St|Co|Ltd)\.$/u.test(sentences[index - 1].trim())) return false;
    const words = sentence.replace(/[.!?:;,]+$/u, '').split(/[ \t]+/u);
    return words.length >= 1 && words.length <= 4 && words.every((word) => /^\p{Lu}[\p{Lu}\p{M}'’-]*$/u.test(word)) &&
      words.join('').length >= 2 && !CAPS_SIGN_OFF.test(sentence) && !BANK_NAME.test(sentence);
  })) return 'unknown';
  return null;
};
// Sign-offs, bank and brand words, balance and account labels a capitalised SMS ends with.
const CAPS_SIGN_OFF = /(?<!\p{L})(?:BANK|BANCA|BANCO|BANQUE|BANKEN|SPARKASSE|VOLKSBANK|RAIFFEISEN|KASSE|DANKE|VIELEN|MERCI|GRACIAS|GRAZIE|OBRIGADO|BEDANKT|DANK|TACK|TAK|TAKK|DZIĘKUJEMY|DĚKUJEME|THANK|THANKS|IHRE|IHR|VOTRE|SU|TU|LA|IL|DIN|DIT|DITT|DEIN|DEINE|YOUR|TEAM|SERVICE|APP|ONLINE|INFO|SALDO|SOLDE|KONTO|COMPTE|CUENTA|CONTO|ACCOUNT|REWE|ICA|NETTO|CB|VISA|MASTERCARD|MAESTRO|GIROCARD|BLIK|SEPA|IBAN|SMS|EUR|SEK|DKK|NOK|PLN|CZK|CHF|KČ|KR|ZŁ)(?!\p{L})/u;

// English footers that name a status without qualifying the movement: "Not
// you?", "If you did not make this purchase, call …", "Report unauthorised
// activity", "To block your card …", "Reply STOP to cancel alerts".
const ENGLISH_FOOTER = /\bif[ \t]+(?:this[ \t]+(?:is|was)[ \t]+)?unauthori[sz]ed\b[^.!?\n]*|(?:not[ \t]+you|wasn['’]?t[ \t]+you|didn['’]?t[ \t]+make[ \t]+(?:this|it)|unrecogni[sz]ed[ \t]+(?:transaction|charge|payment))[ \t]*\?|\bif[ \t]+(?:you[ \t]+(?:did[ \t]+not|didn['’]t|have[ \t]+not|haven['’]t|do[ \t]+not|don['’]t)|this[ \t]+(?:was[ \t]+not|wasn['’]t|is[ \t]+not|isn['’]t))\b[^.!?\n]*|\breport[ \t]+(?:any[ \t]+)?(?:suspicious[ \t]+or[ \t]+)?unauthori[sz]ed[ \t]+(?:transactions?|activity|use|charges?)\b|\bto[ \t]+(?:cancel|stop|block|freeze|lock)\b[^.!?\n]*|\breply[ \t]+stop\b[^.!?\n]*|\b(?:lost|stolen)[ \t]+(?:or[ \t]+stolen[ \t]+)?card\b[^.!?\n]*|\bpending[ \t]+transactions?[ \t]+(?:are[ \t]+)?(?:not[ \t]+)?(?:included|shown)\b/giu;
/**
 * The same whole-message reading for every other alert: a status word of
 * any language (alert-status-lexicon.ts) that describes this movement,
 * outside the bank's own English footers, withdraws the posting ("You spent $45.00 at TARGET\nDECLINED").
 */
// (Only a status of the movement itself counts — alert-status-lexicon.ts
// transactionStatusWords: never inside a capitalised name run, "at DECLINED
// CAFE", "at ERROR 404 ARCADE", never in a conditional clause, and never in
// another English sentence about another money object or a promotion, "A fee
// of USD 5.00 has not been charged". A status ending the run, "at WALMART
// DENEGADA", or on its own line, "\nDECLINED", still counts.)
export const worldStatusDoubt = (
  source: string,
  ignoreConcepts: readonly StatusConcept[] = [],
  principal: { start: number; end: number } | null = null,
): boolean => {
  const text = withoutEuropeanTemplates(source).replace(ENGLISH_FOOTER, (match) => ' '.repeat(match.length));
  return transactionStatusWords(text, { principal }).some((match) => match.concept === 'example' || match.concept === 'unreadable' ||
    !ignoreConcepts.includes(match.concept));
};
