import { inspectAlertDraft, type AlertDraft } from '@/lib/alert-draft';
import {
  inspectAlertEventEvidence,
  type AlertEventEvidence,
} from '@/lib/alert-event-evidence';
import {
  inspectAlertInstitutionGrammar,
  type AlertInstitutionGrammarReview,
} from '@/lib/alert-institution-grammars';
import { alertMarketPack } from '@/lib/alert-market-packs';
import { isTransactionVerificationChallenge } from '@/lib/bank-alert-semantic-rules';
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
  /** Read with the worldwide completion vocabulary (universal reader only). */
  world?: boolean;
}

export type MoneyCandidateRole = 'transaction' | 'balance' | 'limit' | 'due' | 'fee' | 'unknown';

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
const FUTURE = /\b(?:will (?:be|have been) (?:debited|credited|deposited|refunded|charged|deducted|collected)|will apply|pre[ -]?debit|collect request|payment request|scheduled|due on|payment due|upcoming|mandate (?:created|registered))\b|سيتم (?:خصم|سحب|تحصيل|إيداع|رد)|طلب تحصيل|مستحق|डेबिट किया जाएगा|क्रेडिट किया जाएगा|भुगतान देय/i;
const STATEMENT = /\b(?:statement|credit card bill|card bill|minimum (?:amount )?due|amount due|payment due date|kontoauszug|extracto|estratto conto|rekeningoverzicht)\b|relev[ée]|كشف حساب|الحد الأدنى المستحق/i;
const BALANCE = /\b(?:available balance|current balance|avl bal|available limit|credit limit|solde|kontostand|saldo)\b|الرصيد (?:الحالي|المتاح)|الحد (?:المتاح|الائتماني)/i;
const POSTED = /(?:^|[:.]\s*)payment\s+(?:of\s+)?(?:[a-z]{3}|[$€£₹])\s*[\d.,]+\s+at\b|\byou\s+made\s+an?\b(?:[^.;\n]|\.\d){0,40}?\btransaction\b|\bcharge\s+made\s+(?:online|by\s+phone|in\s+store)\b|\b(?:was|has\s+been|were|have\s+been)\s+deducted\b|\b(?:charge|transaction)\s+(?:of|with)\b(?:[^.;\n]|\.\w){0,80}?\bwas\s+made\b|\bwas\s+used\s+for\b|\bwas\s+charged\s+for\b|\byou\s+withdrew\b|\byou\s+(?:have\s+)?sent\b|\bsent\s+you\b|\b(?:spent|purchase(?:d)?|paid|debited|credited|received|sent|withdrawn|deposited|refund(?:ed)?|revers(?:al|ed)|completed|successful|charged|posted|débité|crédité|effectué|belastet|abgebucht|gutgeschrieben|bezahlt|cargado|abonado|pagado|addebitato|accreditato|afgeschreven|bijgeschreven|betaald)\b|تم (?:الخصم|الإيداع|الدفع|التحويل)|سحب|شراء|دفع|استرداد|डेबिट किया गया|क्रेडिट किया गया|जमा किया गया|भुगतान किया गया/i;
const CREDIT = /\bsent\s+you\b|\b(?:credited|received|deposit(?:ed)?|refund(?:ed)?|revers(?:al|ed)|credited back|crédité|gutschrift|gutgeschrieben|abonado|accredito|accreditato|bijgeschreven|terugbetaling)\b|تم (?:الإيداع|رد)|استرداد|क्रेडिट|जमा/i;
const DEBIT = /(?:^|[:.]\s*)payment\s+(?:of\s+)?(?:[a-z]{3}|[$€£₹])\s*[\d.,]+\s+at\b|\byou\s+made\s+an?\b(?:[^.;\n]|\.\d){0,40}?\btransaction\b|\bcharge\s+made\s+(?:online|by\s+phone|in\s+store)\b|\b(?:was|has\s+been|were|have\s+been)\s+deducted\b|\b(?:charge|transaction)\s+(?:of|with)\b(?:[^.;\n]|\.\w){0,80}?\bwas\s+made\b|\bcharge\s+of\b|\bwas\s+used\s+for\b|\bwas\s+charged\s+for\b|\bwithdrew\b|\byou\s+(?:have\s+)?sent\b|\b(?:spent|purchase(?:d)?|paid|debited|withdrawn|charged|débité|belastet|abgebucht|cargado|pagado|addebitato|afgeschreven|betaald)\b|تم (?:الخصم|الدفع)|سحب|شراء|دفع|डेबिट|निकासी|भुगतान/i;
const REFUND = /\b(?:refund(?:ed)?|revers(?:al|ed)|credited back|remboursement|avoir|erstattung|devolución|reembolso|rimborso|storno|terugbetaling|correctieboeking)\b|استرداد|تم رد|धनवापसी|रिफंड/i;
const CASH = /\byou\s+withdrew\b|\b(?:atm|cash machine|cash withdrawal|geldautomat|bargeldabhebung|retrait|retirada|prelievo|geldopname|aeps cash withdrawal)\b|صراف آلي|سحب نقدي|नकद निकासी|एटीएम निकासी/i;
const FEE = /\b(?:bank fee|service charge|annual fee|annual card fee|monthly fee|monthly account maintenance fee|maintenance fee|commission|overdraft fee|nsf fee|frais|cotisation|gebühr|entgelt|comisión|commissione|canone|kosten)\b|رسوم|عمولة/i;
const PURCHASE = /(?:^|[:.]\s*)payment\s+(?:of\s+)?(?:[a-z]{3}|[$€£₹])\s*[\d.,]+\s+at\b|\bcard(?:\s+(?:ending\s+|-\s*)?\d{2,4})?\s+charge\s+made\b|\btransaction\s+(?:with|at)\b|\b(?:charge|transaction)\s+of\b(?:[^.;\n]|\.\d){0,80}?\bat\b|\bwas\s+(?:used|charged)\s+for\b(?:[^.;\n]|\.\d){0,60}?\bat\b|\b(?:debited|charged)\s+from\s+your\s+(?:a\/?c|account|card)\b(?:[^.;\n]|\.\d){0,40}?\bat\b|\b(?:purchase|card charged?|card(?:\s+(?:ending\s+)?\d{2,4})?\s+(?:was\s+)?charged|card payment|card used|paid|spent|paiement par carte|achat|kartenzahlung|kartenumsatz|compra con tarjeta|pagamento con carta|acquisto|pinbetaling|pasbetaling)\b|شراء|دفع بالبطاقة|कार्ड खरीद|कार्ड भुगतान|खरीद/i;

/**
 * A third party paying the reader: "JORDAN LEE paid you $48.20" (Venmo). The
 * payer must open its own sentence (or follow a header colon): an advert
 * ("Earn $5 every time a friend has paid you"), a condition ("If JORDAN paid
 * you…"), a question ("Has JORDAN paid you…?") or a negation ("hasn't paid
 * you") is not money in.
 */
const PAID_YOU = /\bpaid\s+you\b/giu;
const NOT_A_PAYER = /\b(?:someone|somebody|anyone|anybody|a\s+friend|if|whether|when|whenever|once|unless|after|every\s+time|earn|get|has|have|had|did|does|do|not|never|hasn['’]t|haven['’]t|didn['’]t|who|that)\b/iu;
const peerPaidYou = (text: string): boolean => [...text.matchAll(PAID_YOU)].some((match) => {
  const before = text.slice(0, match.index!);
  const start = Math.max(before.search(/[^.!?:\n]*$/u), 0);
  const subject = before.slice(start).trim();
  const sentenceEnd = text.slice(match.index!).search(/[.!\n](?!\d)|$/u);
  const sentence = text.slice(match.index!, match.index! + sentenceEnd);
  return subject.length > 0 && subject.length <= 60 && !NOT_A_PAYER.test(subject) && !sentence.includes('?');
});

/**
 * Worldwide completion vocabulary, used ONLY by the universal reader
 * (`context.world`). The shipped market/Gulf readers keep their exact
 * behaviour. Every pattern uses Unicode-aware boundaries (ASCII \b treats an
 * accented letter as a separator, so "débité" or "recibió" never matched) and
 * every positive shape is predicate-form: a completed verb, or a booked noun
 * that is directly followed by a money token. Bare headings ("Compra
 * aprobada") are deliberately NOT here; they state approval, not completion.
 * Negative lifecycle words are listed per language beside them: a verb family
 * is only added together with its decline, pending, scheduled, request and
 * conditional counterparts.
 */
const WB = String.raw`(?<![\p{L}\p{M}\p{N}_])`;
const WE = String.raw`(?![\p{L}\p{M}\p{N}_])`;
const wordsOf = (...alternatives: string[]): RegExp =>
  new RegExp(`${WB}(?:${alternatives.join('|')})${WE}`, 'iu');
/** An optional currency token and then digits: a money figure's start. */
const NUM = String.raw`(?:[^\s\d]{1,6}\s?)?\d[\d.,]*`;
/** Clause characters: stops at sentence ends but not at a decimal point. */
const GAP = String.raw`(?:[^.;\n]|\.\d)`;
const NOT_A_REQUEST = String.raw`(?!\s+(?:request|reminder|link|instructions?|plan|method|details?|limit|alert)\b)`;

interface Tester { test(text: string): boolean }
// One message is read once per language pack (14 packs) and these tests do not
// depend on the pack. While a universal reading runs, answers for the clauses
// being read are remembered in tables that exist only for that synchronous
// call: runWithClauseMemo clears every table on exit, so no message text or
// result survives the call or reaches another message.
const dirtyTables: Map<string, boolean>[] = [];
let memoDepth = 0;
export const runWithClauseMemo = <T,>(read: () => T): T => {
  memoDepth += 1;
  try { return read(); } finally {
    memoDepth -= 1;
    if (memoDepth === 0) { for (const table of dirtyTables) table.clear(); dirtyTables.length = 0; }
  }
};
const anyOf = (...patterns: readonly Tester[]): Tester => {
  const table = new Map<string, boolean>();
  return {
    test: (text) => {
      if (memoDepth === 0) return patterns.some((pattern) => pattern.test(text));
      const known = table.get(text);
      if (known !== undefined) return known;
      const result = patterns.some((pattern) => pattern.test(text));
      if (table.size === 0) dirtyTables.push(table);
      table.set(text, result);
      return result;
    },
  };
};
const NEVER: Tester = { test: () => false };

interface AlertVocabulary {
  posted: Tester; credit: Tester; debit: Tester; purchase: Tester; cash: Tester;
  fee: Tester; refund: Tester; transfer: Tester;
  failed: Tester; future: Tester; pending: Tester; request: Tester; authentication: Tester;
  /** Advice or a hypothetical ("If a deposit was made ..."): nothing was stated as done. */
  conditional: Tester;
}

// ── Completed debits (money left the account) ────────────────────────────────
// A bare "$" send to a named person ("Enviaste $57.000 a NAME") is shared by
// many banks and currencies: it counts as completed only when the message also
// names the payment rail that identifies where it was made.
const P2P_RAIL = String.raw`(?=[^\n]{0,160}?(?<![\p{L}\p{N}])(?:spei|pix|nequi|daviplata|transfiya|bre-?b|bizum|yape|plin|sinpe|ted|transfer[eê]ncia|transferencia)(?![\p{L}\p{N}]))`;
// A booked noun heading is only a completed charge when the same sentence also
// names the reader's own card tail and carries no approval or hold wording.
const CARD_TAIL = String.raw`(?:carte|tarjeta|cart[aã]o|card|t\.\s?(?:deb|cre)\p{L}*)\s*(?:[\p{L}]+\s+){0,3}?(?:(?:se\s+terminant\s+par|terminad[ao]\s+en|terminaci[oó]n|final|ending(?:\s+in)?|no\.?)\s*)?[*xX•]*\s*\d{4}(?!\d)`;
const NOT_HELD = String.raw`(?![^;\n]*(?:aprob|autoriz|aprov|approuv|approv|pre-?auto|r[ée]serv|hold|solicit))`;
const BOOKED_CARD_NOUN = String.raw`paiement\s+par\s+carte\s*[*xX•]*\d{3,4}\s+d['’]un\s+montant\s+de\s+${NUM}${NOT_HELD}|(?:achat|paiement|retrait|cargo|consumo|retiro)\s+(?:de|por|d['’]un\s+montant\s+de)\s+${NUM}${NOT_HELD}[^;\n]{1,120}?${CARD_TAIL}`;
const WORLD_DEBIT = wordsOf(
  BOOKED_CARD_NOUN,
  // English: contractions, a booked noun before the amount, "A $X transaction
  // was made", card "used for", and payee payments that end in a state word.
  String.raw`(?:you|we)(?:['’]ve|\s+have)?\s+(?:made|taken|charged|deducted)\s+(?:an?\s+|your\s+)?(?:[\p{L}-]+\s+){0,3}?(?:payment|purchase|transaction|txn|withdrawal|transfer|fee|charge)${NOT_A_REQUEST}`,
  String.raw`(?:debit\s+card|credit\s+card|card|contactless|pos|online|atm|cash)\s+(?:payment|purchase|transaction|txn|withdrawal)s?\s+(?:of\s+)?${NUM}`,
  String.raw`(?:charge|transaction|txn|withdrawal|payment|purchase|debit|deduction)s?\s+(?:of\s+|for\s+)?${NUM}${GAP}{0,80}?\b(?:was|has\s+been|were|have\s+been|has)\s+(?:made|posted|completed|processed|taken|deducted|debited)`,
  String.raw`an?\s+${NUM}\s*(?:\w+\s+)?(?:transaction|purchase|charge|payment|withdrawal|debit)\s+(?:was|has\s+been)\s+(?:made|posted|completed|processed)`,
  String.raw`(?<!(?:can|may|will|could|would|should|must|to|be|not|never)\s)(?:(?:has|have)\s+been\s+|was\s+)?used\s+for\s+${NUM}`,
  String.raw`(?:charge|purchase)\s+of\s+${NUM}${GAP}{0,60}?\bat`,
  String.raw`(?:txn|transaction)\s+(?:of\s+)?${NUM}${GAP}{0,40}?\b(?:made|done|successful|completed)\s+(?:on|at|using|with|via)\b`,
  String.raw`you(?:['’]ve|\s+have)\s+been\s+charged\s+${NUM}`,
  // "JOHN received £50 from you": the counterparty received, so it left this account.
  String.raw`received\s+${NUM}${GAP}{0,30}?\bfrom\s+you\b`,
  String.raw`(?:recibi[oó]|recebeu)\s+${NUM}${GAP}{0,30}?\bde\s+(?:ti|voc[eê]|usted)\b`,
  String.raw`${NUM}${GAP}{0,30}?\b(?:has|have|was|were)\s+(?:been\s+)?(?:successfully\s+)?(?:transferred|withdrawn)\s+from\s+your\b`,
  String.raw`${NUM}\s+(?:atm|cash)\s+withdrawal(?!\s+(?:request|limit|fee|available|up\s+to|allowed))`,
  String.raw`you(?:['’]ve|\s+have)?\s+(?:just\s+)?(?:successfully\s+)?(?:sent|transferred)\s+${NUM}`,
  String.raw`you\s+paid\s+(?!for\b)(?:[\p{L}'.-]+\s+){1,4}${NUM}`,
  String.raw`(?:has|have|was)\s+(?:been\s+)?charged\s+${NUM}`,
  String.raw`(?:bill\s+|bpay\s+)?payment\s+(?:of\s+)?(?:${NUM}\s*)?to\s+(?:\S${GAP}{0,80}?\s+)?(?:was|has\s+been|is)\s+(?:successful|successfully\s+\w+|completed|sent|made|processed)`,
  String.raw`your\s+${NUM}\s+payment\s+to\s+(?:\S${GAP}{0,80}?\s+)?(?:was|has\s+been)\s+(?:successful|completed|sent|made|processed)`,
  // Spanish / Portuguese.
  String.raw`realizaste\s+(?:un|una|el)\s+(?:compra|cargo|pago|consumo|retiro|transferencia)`,
  String.raw`(?:pagaste|retiraste|compraste|gastaste)`,
  String.raw`(?:enviaste|transferiste)${P2P_RAIL}`,
  // Third-person Portuguese verbs name no subject ("MARIA enviou R$ 50 para você"): only "você" proves the reader.
  String.raw`voc[eê]\s+(?:pagou|sacou|comprou)`,
  String.raw`voc[eê]\s+(?:enviou|transferiu)${P2P_RAIL}`,
  String.raw`(?<=(?:^|:)\s*)(?:pagou|sacou|comprou)\s+${NUM}`,
  String.raw`(?<=(?:^|:)\s*)(?:enviou|transferiu)\s+${NUM}${P2P_RAIL}`,
  String.raw`(?:usted|ud\.?)\s+(?:envi[oó]|pag[oó]|retir[oó]|transfiri[oó])`,
  String.raw`se\s+(?:ha\s+)?(?:realiz(?:o|ó|ado)\s+(?:un|una)\s+(?:cargo|compra|pago|retiro|consumo|transferencia)|cargado|debitado|descontado|retirado)`,
  String.raw`registr[oó]\s+un\s+(?:consumo|cargo|compra)`,
  String.raw`hiciste\s+(?:un|una)\s+(?:compra|retiro|pago|transferencia)`,
  String.raw`has\s+(?:pagado|retirado|enviado|comprado|transferido)`,
  String.raw`se\s+(?:debit[oó]|descont[oó]|carg[oó]|aplic[oó]\s+un\s+cargo)`,
  String.raw`(?:pago|transferencia|retiro|compra)\s+(?:de\s+\p{L}+\s+)?(?:por|de)\s+${NUM}${GAP}{0,60}?\b(?:realizad[oa]|exitos[oa]|aplicad[oa])`,
  String.raw`voc[eê]\s+(?:fez|realizou|efetuou)\s+(?:um|uma)\s+(?:compra|pagamento|transfer[eê]ncia|saque|pix)`,
  String.raw`(?:pagamento|transfer[eê]ncia)\s+(?:de\s+)?${NUM}${GAP}{0,60}?\b(?:realizad[oa]|efetuad[oa])`,
  String.raw`giro\s+en\s+cajero(?:\s+autom[aá]tico)?\s+por\s+${NUM}`,
  String.raw`(?:retiro|saque)\s+(?:de\s+efectivo\s+)?(?:de|por)\s+${NUM}${GAP}{0,100}?(?:cajero|atm|caixa\s+eletr)`,
  String.raw`(?:compra|pagamento|saque|transfer[eê]ncia)\s+(?:de\s+|no\s+valor\s+de\s+)?${NUM}${GAP}{0,80}?(?:realizad[oa]|efetuad[oa]|conclu[ií]d[oa])`,
  String.raw`d[eé]bito\s+de\s+(?:tarifa|taxa|anuidade|mensalidade|pacote)`,
  // French / Italian / Dutch (German already has "belastet/abgebucht/bezahlt").
  String.raw`vous\s+avez\s+(?:effectué|réalisé|payé|retiré|envoyé)`,
  String.raw`a\s+été\s+(?:débité|prélevé)`,
  String.raw`hai\s+(?:pagato|inviato|prelevato)`,
  String.raw`è\s+stat[oa]\s+addebitat[oa]`,
  String.raw`u\s+heeft\s+(?:betaald|overgemaakt)`,
  String.raw`is\s+afgeschreven`,
  // Swahili.
  String.raw`(?:umetuma|umelipa|umetoa|umenunua|umekatwa|kimetolewa|imetolewa|kimekatwa)`,
  // Turkish (dotted and dotless i spelled both ways: SMS often drops the dots).
  String.raw`al[ıi][sş]veri[sş][^.;\n]{0,50}?(?:yap[ıi]lm[ıi][sş]t[ıi]r|yap[ıi]ld[ıi]|ger[cç]ekle[sş]mi[sş]tir|ger[cç]ekle[sş]ti)`,
  String.raw`harcama\s+yap[ıi](?:lm[ıi][sş]t[ıi]r|ld[ıi])`,
  String.raw`[oö]deme\s+(?:yapt[ıi]n(?:[ıi]z)?|yap[ıi]ld[ıi]|ger[cç]ekle[sş]tirildi)`,
  // Turkish case suffix names the side: hesabınızdan = from your account, hesabınıza = to it.
  String.raw`hesab[ıi]n[ıi]zdan${GAP}{0,80}?(?:g[oö]nderilmi[sş]tir|g[oö]nderildi|[cç]ekilmi[sş]tir|[cç]ekildi|tahsil\s+edildi)`,
  String.raw`(?:[cç]ekilmi[sş]tir|[cç]ekildi|tahsil\s+edildi)`,
  // Indonesian / Malay.
  String.raw`(?:telah\s+)?(?:didebet|didebit|ditarik)`,
  String.raw`(?:berhasil|telah)\s+(?:ditransfer|dibayarkan|dibayar)\s+ke\s+(?!rekening\s+(?:anda|kamu)|akun\s+(?:anda|kamu))\p{L}+`,
  String.raw`(?:kamu|anda|saya)\s+(?:udah|sudah|telah)\s+(?:bayar|membayar|membeli|menarik|transfer|mentransfer)`,
  String.raw`tarik\s+tunai`,
  String.raw`(?:anda|kamu)\s+(?:telah\s+)?melakukan\s+(?:transfer|pembayaran|penarikan|pembelian|transaksi)`,
  // Vietnamese: "Bạn đã thanh toán 45.000đ cho ...", "Thanh toán thành công".
  String.raw`[dđ][aãạ]\s+thanh\s+to[aá]n\s+${NUM}`,
  String.raw`thanh\s+to[aá]n\s+th[aà]nh\s+c[oô]ng`,
  // Arabic wallet: "تم تحويل مبلغ 50,000 دينار الى الرقم 0780... بنجاح" (sent to a number, successfully).
  String.raw`تم\s+(?:تحويل|إرسال|ارسال)\s+مبلغ${GAP}{0,60}?(?:إلى|الى)\s+(?:الرقم|رقم)\s*\d${GAP}{0,60}?بنجاح`,
  // Card ledger line: "Debit Card 5678 txn RM128.40 at AEON ...".
  String.raw`card\s+(?:no\.?\s*)?[xX*•]*\d{3,}\s+(?:txn|transaction)\s+${NUM}${GAP}{0,50}?\bat\b`,
);

// ── Completed credits (money arrived in the account) ─────────────────────────
const WORLD_CREDIT = wordsOf(
  String.raw`(?:deposit|credit)s?\s+(?:of\s+|for\s+)?${NUM}${GAP}{0,80}?\b(?:was|has\s+been|were|have\s+been|has)\s+(?:made|posted|completed|processed|credited)`,
  String.raw`you(?:['’]ve|\s+have)?\s+(?:just\s+)?(?:successfully\s+)?received\s+${NUM}`,
  String.raw`payment\s+received\s+(?:for|of)\s+${NUM}`,
  String.raw`${NUM}${GAP}{0,30}?\b(?:has|have|was|were)\s+(?:been\s+)?(?:successfully\s+)?transferred\s+to\s+your\b`,
  String.raw`received\s+${NUM}${GAP}{0,40}?\b(?:in|into)\s+your\s+(?:[\p{L}&.-]+\s+){0,3}?(?:a\/?c|ac|acct|account)`,
  // Spanish / Portuguese. "Crédito" alone is a loan offer: only salary-type credits.
  String.raw`(?:recibiste|te\s+lleg[oó]|voc[eê]\s+recebeu)`,
  String.raw`te\s+(?:envi[oó]|transfiri[oó]|deposit[oó]|abon[oó])`,
  String.raw`se\s+abon(?:aron|[oó]|ado)${GAP}{0,60}?\b(?:tu|su)\b`,
  String.raw`(?:dep[oó]sito|abono)\s+(?:de|por)\s+${NUM}`,
  String.raw`has\s+recibido|se\s+(?:acredit(?:aron|[oó])|abon(?:aron|[oó])|deposit(?:aron|[oó]))${GAP}{0,60}?\b(?:tu|su)\b`,
  String.raw`te\s+(?:acreditaron|depositaron|abonaron|transfirieron|enviaron)`,
  String.raw`dep[oó]sito\s+recibido|transferencia\s+recibida`,
  String.raw`voc[eê]\s+recebeu\s+(?:um\s+)?pix|foi\s+(?:creditad|depositad)[oa]|cr[eé]dito\s+em\s+conta`,
  String.raw`dep[oó]sito\s+(?:em\s+conta\s+)?(?:de|no\s+valor\s+de)\s+${NUM}`,
  String.raw`cr[eé]dito\s+de\s+(?:sal[aá]rio|proventos|benef[ií]cio|aposentadoria|pens[aã]o)\s+de\s+${NUM}`,
  // French / Italian / Dutch.
  String.raw`vous\s+avez\s+reçu`,
  String.raw`a\s+été\s+crédité`,
  String.raw`d[eé]p[oô]t\s+(?:de\s+\p{L}+\s+)?de\s+${NUM}${GAP}{0,60}?a\s+été\s+effectué`,
  String.raw`hai\s+ricevuto`,
  String.raw`è\s+stat[oa]\s+accreditat[oa]`,
  String.raw`u\s+heeft\s+ontvangen`,
  String.raw`is\s+bijgeschreven`,
  // Swahili.
  String.raw`(?:umepokea|imeingia|imewekwa|kimewekwa|umewekewa)`,
  // Turkish.
  String.raw`(?:gelmi[sş]tir|geldi|yat[ıi]r[ıi]lm[ıi][sş]t[ıi]r|yat[ıi]r[ıi]ld[ıi])`,
  String.raw`hesab[ıi]n[ıi]za${GAP}{0,80}?(?:g[oö]nderilmi[sş]tir|g[oö]nderildi)`,
  // Indonesian / Malay.
  String.raw`(?:telah\s+)?(?:dikredit|dikreditkan)`,
  String.raw`(?:kamu|anda)\s+(?:menerima|telah\s+menerima)`,
  String.raw`transfer\s+masuk|(?:berhasil|telah)\s+ditransfer\s+ke\s+(?:rekening|akun)\s+(?:anda|kamu)`,
  // Vietnamese "received"; Roman Urdu "wusool huay" (was received).
  String.raw`[dđ][aãạ]\s+nh[aậ]n\s+${NUM}|nh[aậ]n\s+[dđ][uư][oơợ]\S*\s+${NUM}`,
  String.raw`(?:wusool|wasool|mausool)\s+hu(?:ay|e|a)`,
  // Arabic wallet: "تم استلام مبلغ 500.00 جنيه من رقم ... بنجاح" (received from a number, successfully).
  String.raw`تم\s+(?:استلام|استقبال)\s+مبلغ${GAP}{0,60}?بنجاح`,
);

// Scripts written without word spaces cannot use word boundaries. Each shape
// is a whole predicate: a verb of completion, or a booked noun that is
// immediately followed by a currency/number ("消费满100元" promotions and
// "消費税" tax lines do not match).
const CJK_MONEY = String.raw`\s*(?:[(（][^)）]{0,30}[)）])?\s*(?:人民币|人民幣|新台[币幣]|港[币幣]|NT\$|HK\$|[¥￥$])?\s*\d`;
// Alert text is lower-cased before it is read, so currency prefixes (NT$, HK$) must match either case.
const cjkOf = (...alternatives: string[]): RegExp => new RegExp(alternatives.join('|'), 'iu');
// A named payment channel directly before the amount is a finished payment, not an offer:
// "请使用快捷支付100元" (please use ...) and similar instructions are excluded.
const CJK_CHANNEL = '(?<!请|請|可|需|须|須|将|將|应|應|使用|选择|選擇|通过|通過)(?:快捷|网上|網上|扫码|掃碼|云闪付|雲閃付|刷卡)支付';
const THAI_MONEY = String.raw`\s*(?:฿|thb)?\s*\d`;
const CJK_DEBIT = cjkOf(
  `ถอน/โอนเงิน|ถอนเงิน(?:สด)?|โอนเงินออก|ใช้จ่าย${THAI_MONEY}|ชำระเงินสำเร็จ|ตัดบัญชี|หักบัญชี|ถอน${THAI_MONEY}`,
  'お引出し|お引き出し|支払い?完了|決済完了|送金(?:しました|完了)|支払いました',
  '송금\\s*완료|보냈어요|보냈습니다',
  // Korean bank withdrawal lines ("출금200,000원", "출금 100,000"): the word is followed by the amount.
  '출금(?!\\s*(?:예정|요청|한도|가능|불가|계좌|일|기한))',
  // Chinese payment channel notices name the channel, then the amount ("快捷支付19.90元").
  `${CJK_CHANNEL}(?:交易)?${CJK_MONEY}`,
  `(?:消费|消費|支出|簽賬|签账|转出|轉出|取款|取现|支取|付款)${CJK_MONEY}`,
  '付款成功|支付成功|消费成功|扣款成功|转账成功|轉帳成功|付款完成|支付完成|付款金额\\s*[:：]|支付金额\\s*[:：]',
);
const CJK_CREDIT = cjkOf(
  'รับโอน|เงินเข้า|โอนเข้า|เข้า\\s*บ/?ช',
  '受け取りました|入金(?:がありました|しました)',
  '입금(?!\\s*(?:예정|요청|하세요|해\\s*주|안내|한도|계좌|기한|마감|바랍|부탁))',
  `(?:收入|转入|轉入|入账|入帳|到账|到帳|存入|薪資轉入|工资收入)${CJK_MONEY}`,
);
const CJK_TRANSFER = cjkOf('รับโอน|โอนเงิน|ถอน/โอน|โอนเข้า|출금|입금|受け取りました|送金(?:しました|完了)|송금\\s*완료|보냈어요|보냈습니다|받았어요|받았습니다|转账|轉帳|轉賬|汇款|匯款|工资|工資|薪资|薪資|代发|代發|급여');
const CJK_PURCHASE = cjkOf(
  `ใช้จ่าย${THAI_MONEY}`,
  `${CJK_CHANNEL}(?:交易)?${CJK_MONEY}`,
  `(?:消费|消費|簽賬|签账|付款)${CJK_MONEY}`,
  '付款成功|支付成功|消费成功|付款完成|支付完成|付款金额\\s*[:：]|支付金额\\s*[:：]|支払い?完了|決済完了',
);
const CJK_CASH = cjkOf('お引出し|お引き出し|ถอนเงินสด', `(?:取款|取现|支取)${CJK_MONEY}`);
const CJK_FAILED = cjkOf(
  '取り消|取消|キャンセル|失敗|失败|エラー|拒否|拒絕|拒绝|未完成|未成功|不成功|できません|ませんでした|无法|無法|未能|취소|실패|거절|ไม่สำเร็จ|ล้มเหลว|ยกเลิก|ปฏิเสธ|ไม่อนุมัติ|ไม่เพียงพอ|ผิดพลาด',
);
// Held, scheduled or promotional: money is announced but has not moved. A
// coupon, points or gift receipt carries a yen amount yet moves no money.
const CJK_HELD = cjkOf(
  'รออนุมัติ|รอดำเนินการ|โปรโมชั่น|แคมเปญ|ส่วนลด|สิทธิพิเศษ|เครดิตเงินคืน|แต้ม|ครบ\\s*\\d|สมัคร|กำหนดชำระ|ยอดที่ต้องชำระ|ใบแจ้งหนี้|รอบบัญชี|ยอดรวม|予定|請求予定|承認待ち|保留|待处理|待處理|本月|月度|账单|賬單|对账|對賬|累计|累計|合计|合計|汇总|匯總|明细|明細|ご利用明細|クーポン|ポイント(?:還元|プレゼント|付与)|ギフト|商品券|キャンペーン|割引|优惠券|優惠券|红包|紅包|积分|積分|分期|优惠|優惠|立减|立減|返现|返現|抽奖|抽獎|满\\d|滿\\d|쿠폰|포인트',
);

// ── Family: only a shape that already proved a completed movement names one ───
const WORLD_PURCHASE = wordsOf(
  String.raw`paiement\s+par\s+carte\s*[*xX•]*\d{3,4}\s+d['’]un\s+montant\s+de\s+${NUM}${NOT_HELD}`,
  String.raw`(?:achat|paiement|cargo|consumo)\s+(?:de|por|d['’]un\s+montant\s+de)\s+${NUM}${NOT_HELD}[^;\n]{1,120}?${CARD_TAIL}`,
  String.raw`[dđ][aãạ]\s+thanh\s+to[aá]n\s+${NUM}|thanh\s+to[aá]n\s+th[aà]nh\s+c[oô]ng`,
  String.raw`card\s+(?:no\.?\s*)?[xX*•]*\d{3,}\s+(?:txn|transaction)\s+${NUM}${GAP}{0,50}?\bat\b`,
  String.raw`(?:txn|transaction)\s+(?:of\s+)?${NUM}${GAP}{0,40}?\b(?:made|done|successful|completed)\s+(?:on|at|using|with|via)\b`,
  String.raw`you(?:['’]ve|\s+have)\s+been\s+charged\s+${NUM}`,
  String.raw`(?:debit\s+card|credit\s+card|card|contactless|pos|online)\s+(?:payment|purchase|transaction|txn)s?\s+(?:of\s+)?${NUM}`,
  String.raw`(?:charge|transaction|txn|payment|purchase)s?\s+(?:of\s+|for\s+)?${NUM}${GAP}{0,80}?\b(?:was|has\s+been|were|have\s+been|has)\s+(?:made|posted|completed|processed|taken|deducted|debited)`,
  String.raw`an?\s+${NUM}\s*(?:\w+\s+)?(?:transaction|purchase|charge|payment)\s+(?:was|has\s+been)\s+(?:made|posted|completed|processed)`,
  String.raw`(?<!(?:can|may|will|could|would|should|must|to|be|not|never)\s)(?:(?:has|have)\s+been\s+|was\s+)?used\s+for\s+${NUM}`,
  String.raw`(?:charge|purchase)\s+of\s+${NUM}${GAP}{0,60}?\bat`,
  String.raw`(?:bill\s+|bpay\s+)?payment\s+(?:of\s+)?(?:${NUM}\s*)?to\s+(?:\S${GAP}{0,80}?\s+)?(?:was|has\s+been|is)\s+(?:successful|successfully\s+\w+|completed|sent|made|processed)`,
  String.raw`your\s+${NUM}\s+payment\s+to\s+(?:\S${GAP}{0,80}?\s+)?(?:was|has\s+been)\s+(?:successful|completed|sent|made|processed)`,
  String.raw`realizaste\s+(?:un|una)\s+(?:compra|consumo|pago)`,
  String.raw`(?:pagaste|compraste|gastaste|voc[eê]\s+pagou|voc[eê]\s+comprou)\s+${NUM}`,
  String.raw`se\s+(?:ha\s+)?realiz(?:o|ó|ado)\s+(?:un|una)\s+(?:cargo|compra|pago|consumo)`,
  String.raw`registr[oó]\s+un\s+(?:consumo|cargo|compra)`,
  String.raw`hiciste\s+(?:un|una)\s+(?:compra|pago)|has\s+(?:pagado|comprado)|voc[eê]\s+(?:fez|realizou|efetuou)\s+(?:um|uma)\s+(?:compra|pagamento)`,
  String.raw`(?:compra|pagamento)\s+(?:de\s+|no\s+valor\s+de\s+)?${NUM}${GAP}{0,80}?(?:realizad[oa]|efetuad[oa]|conclu[ií]d[oa])`,
  String.raw`vous\s+avez\s+(?:effectué|réalisé|payé)`,
  String.raw`al[ıi][sş]veri[sş]|harcama|[oö]deme\s+yapt[ıi]n`,
  String.raw`kamu\s+udah\s+bayar|(?:kamu|anda)\s+(?:udah|sudah|telah)\s+(?:bayar|membayar|membeli)|telah\s+dibayarkan`,
  String.raw`umelipa|umenunua`,
);
const WORLD_CASH = wordsOf(
  String.raw`(?:retrait|retiro)\s+(?:de|por)\s+${NUM}${NOT_HELD}[^;\n]{1,120}?${CARD_TAIL}`,
  String.raw`${NUM}\s+(?:atm|cash)\s+withdrawal(?!\s+(?:request|limit|fee|available|up\s+to|allowed))`,
  String.raw`(?:atm|cash)\s+withdrawal\s+(?:of\s+)?${NUM}`,
  String.raw`withdrawal\s+of\s+${NUM}${GAP}{0,80}?\b(?:was|has\s+been)\s+(?:made|posted|completed|processed)`,
  String.raw`(?:retiraste|sacou)`,
  String.raw`(?:retiro|saque)\s+(?:de\s+efectivo\s+)?(?:de|por)\s+${NUM}${GAP}{0,80}?(?:realizad[oa]|efetuad[oa]|exitos[oa])`,
  String.raw`(?:retiro|saque)\s+(?:de\s+efectivo\s+)?(?:de|por)\s+${NUM}${GAP}{0,100}?(?:cajero|atm|caixa\s+eletr)`,
  String.raw`giro\s+en\s+cajero|cajero\s+autom[aá]tico|caixa\s+eletr[oô]nico`,
  String.raw`tarik\s+tunai|penarikan\s+tunai`,
  String.raw`para\s+[cç]ekme|[cç]ekilmi[sş]tir`,
);
const WORLD_FEE = wordsOf(
  String.raw`d[eé]bito\s+de\s+(?:tarifa|taxa|anuidade|mensalidade|pacote)`,
  String.raw`tarifa|comisi[oó]n|anualidad|anuidade|biaya\s+(?:admin|administrasi|bulanan|layanan)|caj\s+(?:tahunan|bulanan)|[uü]cret|komisyon`,
);
const WORLD_REFUND = wordsOf(
  String.raw`devolu[cç][aã]o|estorno|reintegro|iade|pengembalian\s+dana|bayaran\s+balik`,
  // A merchant credit posted to the reader's card: "A credit of $29.99 from AMAZON was posted to your credit card".
  String.raw`credit\s+of\s+${NUM}\s+from\s+[^;\n]{1,60}?\b(?:was|has\s+been)\s+posted\s+to\s+your\s+(?:[\p{L}]+\s+){0,2}card\b`,
);
// A person-to-person movement: a named counterparty directly beside the money.
const WORLD_TRANSFER = wordsOf(
  String.raw`${NUM}${GAP}{0,30}?\b(?:has|have|was|were)\s+(?:been\s+)?(?:successfully\s+)?transferred\s+(?:from|to)\s+your\b`,
  String.raw`(?:anda|kamu)\s+(?:telah\s+)?melakukan\s+transfer`,
  String.raw`received\s+${NUM}${GAP}{0,40}?\b(?:in|into)\s+your\s+(?:[\p{L}&.-]+\s+){0,3}?(?:a\/?c|ac|acct|account)`,
  String.raw`you(?:['’]ve|\s+have)?\s+(?:just\s+)?(?:successfully\s+)?(?:sent|transferred|received)\s+${NUM}`,
  String.raw`you\s+paid\s+(?!for\b)(?:[\p{L}'.-]+\s+){1,4}${NUM}`,
  String.raw`payment\s+received\s+(?:for|of)\s+${NUM}`,
  String.raw`(?<=(?:^|:)\s*)(?!(?:someone|somebody|anyone|anybody|a\s+friend|your\s+friend)\b)(?:[\p{L}][\p{L}'.-]*\s+){1,4}sent\s+you\s+${NUM}`,
  String.raw`deposit\s+of\s+${NUM}${GAP}{0,80}?\b(?:was|has\s+been|has)\s+(?:made|posted|completed|processed)\s+(?:to|into|in)\s+your\b`,
  String.raw`(?:recibiste|te\s+(?:envi[oó]|transfiri[oó]|deposit[oó])|te\s+lleg[oó]|(?:usted|ud\.?)\s+envi[oó])`,
  String.raw`(?:enviaste|transferiste)${P2P_RAIL}`,
  String.raw`voc[eê]\s+(?:recebeu|enviou|transferiu)\s+uma?\s+(?:transfer[eê]ncia|pix)`,
  String.raw`voc[eê]\s+recebeu\s+${NUM}`,
  String.raw`voc[eê]\s+(?:enviou|transferiu)\s+${NUM}${P2P_RAIL}`,
  String.raw`transfer[eê]ncia\s+(?:recebida|enviada|realizada)|pix\s+(?:enviado|recebido)|voc[eê]\s+recebeu\s+(?:um\s+)?pix`,
  String.raw`hiciste\s+una\s+transferencia|has\s+(?:recibido|enviado|transferido)|te\s+(?:acreditaron|depositaron|abonaron|transfirieron|enviaron)|transferencia\s+recibida`,
  String.raw`voc[eê]\s+(?:fez|realizou|efetuou)\s+(?:uma\s+transfer[eê]ncia|um\s+pix)`,
  String.raw`cr[eé]dito\s+de\s+(?:sal[aá]rio|proventos|benef[ií]cio|aposentadoria|pens[aã]o)\s+de`,
  String.raw`vous\s+avez\s+(?:envoyé|reçu)|virement\s+(?:reçu|émis|effectué)`,
  String.raw`hai\s+(?:inviato|ricevuto)|u\s+heeft\s+(?:overgemaakt|ontvangen)`,
  String.raw`(?:umetuma|umepokea)`,
  String.raw`(?:havale|eft|fast)\s+(?:gelmi[sş]tir|g[oö]nderilmi[sş]tir|g[oö]nderildi|geldi)|eft\s+g[oö]nderilmi[sş]tir`,
  String.raw`(?:berhasil|telah)\s+(?:ditransfer|dikirim)|transfer\s+masuk|(?:kamu|anda)\s+(?:menerima|telah\s+menerima)`,
);

// ── Negative lifecycle: each only moves an alert AWAY from a posting ─────────
// "returned to your account" is money coming back, not a failure.
const WORLD_FAILED = wordsOf(
  String.raw`(?:was|were|been|is|are)\s+returned(?!\s+to\s+your\b)`,
  String.raw`bounced|timed\s+out|expired|cancell?ed|voided`,
  String.raw`could\s+not|couldn['’]t|unable\s+to|did(?:\s+not|n['’]t)\s+go\s+through|not\s+go(?:ne)?\s+through`,
  String.raw`rechazad[oa]|declinad[oa]|denegad[oa]|negad[oa]|recusad[oa]|fallid[oa]|fall[oó]|anulad[oa]|cancelad[oa]|devuelt[oa]|reprovad[oa]|falhou`,
  String.raw`no\s+(?:se\s+)?(?:pudo|pude|puede|proces[oó]|complet[oó]|autoriz[oó]|realiz[oó])`,
  String.raw`n[aã]o\s+(?:foi\s+poss[ií]vel|p[oô]de|foi\s+(?:realizad|conclu[ií]d|aprovad|efetuad)\w*)`,
  String.raw`saldo\s+insuficiente|fondos\s+insuficientes`,
  String.raw`refus[ée]e?|rejet[ée]e?|[ée]chou[ée]e?|annul[ée]e?|impossible`,
  String.raw`abgelehnt|fehlgeschlagen|storniert|zur[uü]ckgebucht|nicht\s+durchgef[uü]hrt`,
  String.raw`rifiutat[oa]|annullat[oa]|stornat[oa]|non\s+riuscit[oa]`,
  String.raw`geweigerd|mislukt|geannuleerd|niet\s+gelukt`,
  String.raw`imeshindwa|haikufanikiwa|imekataliwa|haijakamilika`,
  String.raw`yap[ıi]lamad[ıi]|ger[cç]ekle[sş]medi|reddedildi|iptal\s+(?:edildi|edilmi[sş])|ba[sş]ar[ıi]s[ıi]z`,
  String.raw`gagal|tidak\s+berhasil|tidak\s+berjaya|ditolak|dibatalkan|belum\s+berhasil`,
  String.raw`kh[oô]ng\s+th[aà]nh\s+c[oô]ng|th[aấ]t\s+b[aạ]i|b[ịi]\s+t[ừu]\s+ch[ốo]i|[dđ][aãạ]\s+h[uủ]y`,
);
const WORLD_FUTURE = wordsOf(
  String.raw`ser[aá]\s+(?:cargad|debitad|abonad|descontad|cobrad|transferid)\w*|se\s+(?:cargar[aá]|debitar[aá]|descontar[aá]|abonar[aá])|programad[oa]|agendad[oa]|agendamento|vencimiento|vence`,
  String.raw`sera\s+(?:débité|crédité|prélevé)|à\s+venir|échéance`,
  String.raw`wird\s+(?:abgebucht|belastet|gutgeschrieben)|geplant|f[aä]llig`,
  String.raw`sar[aà]\s+(?:addebitat|accreditat)\w*|in\s+scadenza`,
  String.raw`wordt\s+(?:afgeschreven|bijgeschreven)|gepland`,
  String.raw`itakatwa|itatolewa|itakuwa`,
  String.raw`[oö]denecek|yap[ıi]lacak|vadesi|son\s+[oö]deme`,
  String.raw`akan\s+(?:didebet|dikenakan|dibayar|dikredit)|jatuh\s+tempo|jadwal`,
  String.raw`s[eẽ]\s+(?:được\s+)?(?:tr[uừ]|thanh\s+to[aá]n)|d[ựu]\s+ki[eế]n|l[eê]n\s+l[iị]ch`,
);
const WORLD_PENDING = wordsOf(
  String.raw`en\s+proceso|procesando|processando|por\s+confirmar|a\s+confirmar|aguardando|esperando`,
  String.raw`en\s+attente|en\s+cours|vorgemerkt|in\s+sospeso|gereserveerd|inasubiri|beklemede|menunggu|belum\s+diproses`,
);
const WORLD_REQUEST = wordsOf(
  // A request is not a transfer, and a "claim it" prompt is a lure, not a receipt.
  String.raw`(?:sent|made|created|received)\s+an?\s+(?:payment\s+|money\s+|transfer\s+)?request`,
  String.raw`request(?:ed)?\s+(?:for|of)?\s*${NUM}`,
  String.raw`claim\s+(?:it|your|now|here)|click\s+(?:here|the\s+link|to)|tap\s+(?:here|the\s+link)`,
  String.raw`solicitud|solicitaste|solicit[oó]|te\s+pidi[oó]|solicita[cç][aã]o|solicitou|pediu`,
  String.raw`demande|anfrage|zahlungsaufforderung|richiesta|verzoek|ombi|talep|permintaan|meminta`,
);
const WORLD_AUTHENTICATION = wordsOf(
  String.raw`c[oó]digo\s+(?:de\s+)?(?:verificaci[oó]n|seguridad|acceso|autorizaci[oó]n|confirmaci[oó]n|seguran[cç]a|verifica[cç][aã]o)`,
  String.raw`clave\s+(?:din[aá]mica|temporal)`,
  String.raw`(?:c[oó]digo|clave|senha|nip)\s+(?:para|de)\s+(?:retiro|saque|compra|pago|confirmar|autorizar|validar|confirmaci[oó]n|autoriza[cç][aã]o)`,
  String.raw`(?:o\s+)?c[oó]digo\s+\d{4,8}\s+confirma`,
  String.raw`kode\s+(?:otp|verifikasi|keamanan)|onay\s+kodu|do[gğ]rulama\s+kodu|[sş]ifre`,
);
const WORLD_CONDITIONAL = new RegExp(
  String.raw`^(?:[^.;\n]{0,60}?[:,]\s*)?(?:if|unless|whether|in\s+case|suppose|imagine|si|wenn|falls|indien|caso|jika|kalau|apabila|eğer)(?![\p{L}\p{N}])`, 'iu');

// A bare completion word with no direction (like English "successful").
const WORLD_POSTED_ONLY = wordsOf(
  String.raw`(?:telah\s+)?berhasil|sukses|berjaya|exitos[oa]|com\s+sucesso|ba[sş]ar[ıi]yla|ba[sş]ar[ıi]l[ıi]`,
);

const WORLD_VOCAB: AlertVocabulary = {
  posted: anyOf(POSTED, WORLD_DEBIT, WORLD_CREDIT, CJK_DEBIT, CJK_CREDIT, WORLD_POSTED_ONLY),
  credit: anyOf(CREDIT, WORLD_CREDIT, CJK_CREDIT),
  debit: anyOf(DEBIT, WORLD_DEBIT, CJK_DEBIT),
  purchase: anyOf(PURCHASE, WORLD_PURCHASE, CJK_PURCHASE), cash: anyOf(CASH, WORLD_CASH, CJK_CASH), fee: anyOf(FEE, WORLD_FEE),
  refund: anyOf(REFUND, WORLD_REFUND), transfer: anyOf(WORLD_TRANSFER, CJK_TRANSFER),
  failed: anyOf(FAILED, WORLD_FAILED, CJK_FAILED), future: anyOf(FUTURE, WORLD_FUTURE, CJK_HELD),
  pending: anyOf(PENDING_OR_AUTHORIZED, WORLD_PENDING), request: anyOf(REQUEST_LIFECYCLE, WORLD_REQUEST),
  authentication: anyOf(AUTHENTICATION, WORLD_AUTHENTICATION), conditional: WORLD_CONDITIONAL,
};
/**
 * Decline/failure wording for the rest of the sentence AFTER a selected amount
 * clause ("...en MERCADO, pero fue rechazada"): money fields are split at
 * commas, so a trailing verdict would otherwise be outside the clause read.
 */
export const hasDeclinedWording = (text: string): boolean =>
  WORLD_VOCAB.failed.test(text) || NEGATED_POSTING.some((pattern) => pattern.test(text));

/**
 * A later sentence that carries no money of its own but states the lifecycle of
 * the movement above it ("Transferencia no realizada", "Agendamento via Pix",
 * "Refunded"). It can only move a posting away from posted. A conditional
 * sentence ("Si no reconoce esta compra...") describes a hypothetical, not this
 * movement, so it never counts.
 */
const TAIL_HELD = /(?<![\p{L}\p{N}])(?:scheduled|programad[oa]|agendad[oa]|agendamento|programm[ée]e?|geplant|gepland)(?![\p{L}\p{N}])/iu;
export const nonPostingTailVerdict = (sentence: string): 'failed' | 'informational' | null => {
  // A verdict line is short; a long promotional or help sentence only mentions the words.
  sentence = sentence.trim();
  const words = sentence.split(/\s+/u).length;
  if (words > 8 || WORLD_VOCAB.conditional.test(sentence)) return null;
  if (hasDeclinedWording(sentence)) return 'failed';
  if (words > 6) return null;
  // Only scheduling, pending and refund words: a due-date or feature footer
  // ("Next payment due ...") talks about a different obligation.
  return TAIL_HELD.test(sentence) || WORLD_VOCAB.pending.test(sentence) || WORLD_VOCAB.refund.test(sentence)
    ? 'informational' : null;
};

/**
 * Scripts without word spaces cannot be scoped to one amount clause, so their
 * decline/held words are read across the whole message (recall may drop, a
 * cancelled or promotional notice never posts).
 */
export const cjkNonPostingVerdict = (text: string): 'failed' | 'informational' | null =>
  CJK_FAILED.test(text) ? 'failed' : CJK_HELD.test(text) ? 'informational' : null;

const BASE_VOCAB: AlertVocabulary = {
  posted: POSTED, credit: CREDIT, debit: DEBIT, purchase: PURCHASE, cash: CASH, fee: FEE, refund: REFUND,
  transfer: NEVER, failed: FAILED, future: FUTURE, pending: PENDING_OR_AUTHORIZED, request: REQUEST_LIFECYCLE,
  authentication: AUTHENTICATION, conditional: NEVER,
};

/**
 * Resolve the account owner in an already selected principal-money clause.
 * Bare "paid" and the recipient's "deposited" describe opposite sides of
 * the same transfer. They cannot override the possessive account evidence.
 * Null leaves unrelated grammars alone; unknown explicitly withholds direction.
 */
export const accountMovementDirection = (text: string, qualificationPrefix = ''): MoneyDirection | null => {
  const paidIntoOwnAccount = /\b(?:has\s+been|have\s+been|was|were)\s+paid\s+into\s+your\s+(?:[\p{L}-]+\s+){0,3}?(?:account|acct|a\/?c)\b/iu.exec(text);
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

// Only grammar vocabulary enters this bounded cache, never an alert or sender.
// Rebuilding the same Unicode expression for every term of every message is
// unnecessary on mobile runtimes. Non-global tests have no matching cursor.
const termPatterns = new Map<string, RegExp>();
const termPattern = (term: string): RegExp => {
  const cached = termPatterns.get(term);
  if (cached) return cached;
  const flexibleTerm = term.trim().split(/\s+/u).map(escapeRegExp).join('\\s+');
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${flexibleTerm}(?=$|[^\\p{L}\\p{N}])`, 'iu');
  if (termPatterns.size >= 1024) termPatterns.clear();
  termPatterns.set(term, pattern);
  return pattern;
};

const findTerm = (text: string, terms: readonly string[]): string | null => {
  for (const term of terms) {
    if (termPattern(term).test(text)) return term;
  }
  return null;
};

const isClauseBoundary = (text: string, index: number): boolean => {
  const character = text[index];
  if (character === '\n' || character === '\r' || character === ';') return true;
  if (character !== '.' && character !== '!' && character !== '?') return false;
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

const moneyCandidateRole = (
  text: string,
  span: { start: number; end: number },
  pack: ReturnType<typeof alertMarketPack>,
  vocab: AlertVocabulary,
): MoneyCandidateRole => {
  const nearby = semanticClause(text, span).replace(/\s+/gu, ' ');
  if (NEAR_LIMIT.test(nearby)) return 'limit';
  if (NEAR_DUE.test(nearby)) return 'due';
  if (NEAR_BALANCE.test(nearby)) return 'balance';
  if (vocab.fee.test(nearby)) return 'fee';
  if (vocab.debit.test(nearby) || vocab.credit.test(nearby) || vocab.purchase.test(nearby) ||
    vocab.cash.test(nearby) || vocab.refund.test(nearby) ||
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
  vocab: AlertVocabulary = BASE_VOCAB,
): PostingStatus => {
  if (vocab.authentication.test(text)) return 'informational';
  if (vocab.failed.test(text) || NEGATED_POSTING.some((pattern) => pattern.test(text)) ||
    findTerm(text, failedTerms)) return 'failed';
  // The generic layer cannot separate a statement total from an individual
  // posting safely. Exact verified bank grammars may do that later; until
  // then every statement-shaped alert is informational and non-importable.
  if (STATEMENT.test(text)) return 'informational';
  const hasTransactionEvidence = vocab.posted.test(text) || Boolean(findTerm(text, postedTerms));
  if (vocab.future.test(text) || findTerm(text, futureTerms)) return 'future';
  if (vocab.conditional.test(text)) return 'informational';
  // A request that was "received"/"approved" moved no money; neither did a
  // pending or held authorization. Only explicit completed settlement wins.
  const settled = EXPLICIT_SETTLEMENT.test(text) && !NEGATED_SETTLEMENT.test(text);
  if (vocab.request.test(text) && !settled) return 'informational';
  if (vocab.pending.test(text) && !settled) return 'future';
  if (BALANCE.test(text) && !hasTransactionEvidence) return 'informational';
  return hasTransactionEvidence ? 'posted' : 'unknown';
};

const moneyDirection = (
  text: string,
  debitTerms: readonly string[] = [],
  creditTerms: readonly string[] = [],
  vocab: AlertVocabulary = BASE_VOCAB,
): MoneyDirection => {
  const accountMovement = accountMovementDirection(text);
  if (accountMovement !== null) return accountMovement;
  const accountCredit = /\bcredited to (?:your|the) (?:bank )?account\b/i.test(text);
  const accountDebit = /\bdebited from (?:your|the) (?:bank )?account\b/i.test(text);
  if (accountCredit !== accountDebit) return accountCredit ? 'credit' : 'debit';
  // Who did the paying decides, not the bare verb: "NAME paid you" is money in.
  if (peerPaidYou(text)) return 'credit';
  const credit = vocab.credit.test(text) || Boolean(findTerm(text, creditTerms));
  const debit = vocab.debit.test(text) || Boolean(findTerm(text, debitTerms));
  if (credit === debit) return 'unknown';
  return credit ? 'credit' : 'debit';
};

export const inspectMarketAlert = (
  source: string,
  market: UniversalMarket,
  context: MarketAlertContext = {},
): MarketAlertReview => {
  const pack = alertMarketPack(market);
  const vocab = context.world ? WORLD_VOCAB : BASE_VOCAB;
  const draftContext = { currencyAliases: pack.currencyAliases, dotDecimalCurrencies: pack.dotDecimalCurrencies };
  const draft = inspectAlertDraft(source, draftContext);
  const text = draft.normalizedText.toLowerCase();
  const moneyRoles = draft.candidates.map((candidate) =>
    moneyCandidateRole(text, candidate.span, pack, vocab));
  const primaryCandidateIndex = primaryCandidate(moneyRoles);
  const primarySpan = primaryCandidateIndex === null
    ? null
    : draft.candidates[primaryCandidateIndex]?.span ?? null;
  const semanticText = semanticClause(text, primarySpan);
  const semanticDraft = inspectAlertDraft(semanticText, draftContext);
  const classificationText = semanticText.replace(/\s+/gu, ' ');
  const initialStatus = postingStatus(
    classificationText,
    pack.postedTerms,
    pack.failedTerms,
    pack.futureTerms,
    vocab,
  );
  const rail = findTerm(classificationText, pack.rails);
  const transfer = findTerm(classificationText, pack.transferTerms);
  const utility = findTerm(classificationText, pack.utilityTerms);
  const recurring = findTerm(classificationText, pack.recurringTerms);
  const eventEvidence = inspectAlertEventEvidence(text, {
    recurringTerm: recurring,
    utilityTerm: utility,
    primaryCandidateIndex,
  });
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
  const challenged = initialStatus === 'posted' && isTransactionVerificationChallenge(text);
  const status = lifecycleOnly || ungroundedExecution
    ? 'informational'
    : challenged ? 'unknown' : initialStatus;
  const institution = inspectAlertInstitutionGrammar(
    draft.normalizedText,
    market,
    context.sender,
  );

  let family: AlertFamily = 'unknown';
  if (vocab.authentication.test(classificationText)) family = 'authentication';
  else if (status === 'informational' && STATEMENT.test(classificationText)) family = 'statement';
  else if (status === 'informational' && BALANCE.test(classificationText)) family = 'balance';
  else if (vocab.refund.test(classificationText) || findTerm(classificationText, pack.refundTerms ?? [])) family = 'refund';
  else if (vocab.cash.test(classificationText) || findTerm(classificationText, pack.cashTerms ?? [])) family = 'cash-withdrawal';
  else if (vocab.fee.test(classificationText) || eventEvidence.fee ||
    findTerm(classificationText, pack.feeTerms ?? [])) family = 'fee';
  else if (status === 'posted' && utility) family = 'utility';
  else if (status === 'posted' && recurring) family = 'recurring-payment';
  else if (status === 'posted' && (transfer || vocab.transfer.test(classificationText))) family = 'transfer';
  else if (status === 'posted' && accountMovementDirection(classificationText) !== null) family = 'transfer';
  // "NAME paid you $X" is a person-to-person transfer in, not a purchase.
  else if (status === 'posted' && peerPaidYou(classificationText)) family = 'transfer';
  else if (vocab.purchase.test(classificationText) || findTerm(classificationText, pack.purchaseTerms ?? [])) family = 'purchase';

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
      ? moneyDirection(classificationText, pack.debitTerms, pack.creditTerms, vocab)
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
