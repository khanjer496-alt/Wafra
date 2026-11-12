import { inspectUniversalAlert, type UniversalAlertReview } from '@/lib/alert-market-detection';
import { hasUniversalInstitutionSender } from '@/lib/alert-institution-grammars';
import { activeCountryDateOrder, dateOrderForCountry, getActiveCountry } from '@/lib/country';
import {
  bestEffortAutoPostEnabled, decideBestEffortAutoPost, hasLinkFromUnregisteredSender, hasNonCompletedWording,
  isNotAutoPostableMoney, isRegisteredAlertSender, isUnverifiedAlertSender, namesOwnInstrumentTail,
  refusedOnlyByShopOrPromoWording,
  sharedSymbolCurrencyForCountry,
} from '@/lib/best-effort-autopost';
import {
  interpretBankAlert,
  type BankAlertInterpretation,
} from '@/lib/bank-alert-interpreter';
import {
  detectLaunchMarketFromAlert,
  detectLaunchMarketFromSender,
  getActiveMarket,
  ledgerCurrencyExponent,
  pinnedLedgerCurrencyCode,
} from '@/lib/markets';
import { isBnplProviderSource } from '@/lib/bnpl-providers';
import { nonPostingReason, parseSmsBatch, type ParsedSms } from '@/lib/sms-parser';
import type { CategoryId } from '@/lib/types';
import { CURRENCY_SYMBOL_CANDIDATES, currencyMinorUnits } from '@/lib/currency-metadata';
import { decideGulfNeighbourPosting, gulfNeighbourReadSource, isGulfNeighbourMarket } from '@/lib/gulf-neighbour-alerts';
import { inspectUniversalBankEvent } from '@/lib/universal-parser';
import { alertMarketPack } from '@/lib/alert-market-packs';
import { normalizeAlertText } from '@/lib/alert-draft';
import { isLatamOwnCardPayment, latamOwnTransferTitle, latamPolicySource, matchLatamTemplate } from '@/lib/latam-alert-templates';
import { suggestUniversalCategory } from '@/lib/universal-categorization';
import type { FxQuote } from '@/lib/fx';
import { cachedReferenceQuote, convertForeignConfirmation, quoteFitsDay } from '@/lib/fx-rates';
import type { UniversalBankEvent, UniversalField, UniversalMoney, UniversalParseContext } from '@/lib/universal-types';

type CurrencyAliasMap = NonNullable<UniversalParseContext['currencyAliases']>;

// Cheap supersets used only to decide whether market routing must run. The
// parser/reviewer remains the authority; matching one of these never imports.
// "QR" counts only beside a two-decimal figure (never "Scan QR 3 times" or
// "QR 123456"), and a dinar only with its country: a bare دينار is shared by
// several countries and is everyday speech.
// Peru's "S/" never counts after a letter, digit, slash or dot, so a short
// link path ("go.example/s/9Kx") does not read as soles.
export const REVIEW_MONEY_HINT = /\b(?:USD|GBP|EUR|INR|QAR|KWD|BHD|OMR|EGP|JOD|CAD|AUD|BRL|MXN|SGD|Rs\.?|KD|BD|RO|R\.O\.|LE|L\.E\.|JD)\b|\bQR\s{0,3}\d{1,3}(?:,\d{3})*\.\d{2}(?!\d)|(?<![\d.,])\d{1,3}(?:,\d{3})*\.\d{2}\s{0,3}QR\b|\b(?:COP|PEN)\s?\d|(?<![\p{L}\p{N}/.])S\/\.?\s?\d|[$€£₹]|ر\.ق|د\.ك|د\.ب|ر\.ع|ج\.م|د\.[أا]|دينار\s+(?:كويتي|بحريني)|ريال\s+(?:قطري|عماني)/iu;
// A code glued to its figure ("Amount:100SR", STC Bank) has no word boundary
// before it; the digit lookbehind admits it. Still a superset gate only.
const LAUNCH_MONEY_HINT = /(?:\b|(?<=\d))(?:AED|Dhs?\.?|SAR|SR)\b|د\.?[إا]\.?|دراهم|درهم|ر\.?\s?س\.?|ريال/iu;

export const hasBankAlertMoneyHint = (source: string): boolean =>
  REVIEW_MONEY_HINT.test(source) || LAUNCH_MONEY_HINT.test(source) ||
  /(?<![\p{L}\p{N}])TSh\s*\d/iu.test(source) ||
  [...source.matchAll(/(?<![A-Z])([A-Z]{3})(?![A-Z])/giu)]
    .some((match) => currencyMinorUnits(match[1]) !== null) ||
  // Case-insensitive only for multi-letter symbols ("Ksh" for KSh): a short
  // one lower-cased is inside ordinary words ("users", "hours", "Sharma").
  Object.keys(CURRENCY_SYMBOL_CANDIDATES).some((symbol) => symbol.length >= 3
    ? source.toLowerCase().includes(symbol.toLowerCase()) : source.includes(symbol));

/**
 * Cheap evidence that a final money movement MAY have posted.
 *
 * The universal parser is deliberately broad and expensive (~0.7ms/call on the
 * 30k research corpus). Running it after every regional-parser miss made history
 * import spend most of its CPU proving ordinary bills/offers/service notices
 * were not postings. This gate is only a superset admission test: matching it
 * never imports anything; it merely earns the worldwide parser.
 *
 * Keep the verbs aligned with the universal language packs. A known worldwide
 * institution sender bypasses this vocabulary gate below, so an unfamiliar
 * bank phrasing from a supported institution still reaches the full parser.
 */
// Unicode-aware boundaries: `\b` treats an accented letter as a non-letter,
// so "effectué" and "payé" never matched and French alerts were dropped here.
const UNIVERSAL_POSTED_EVENT_HINT =
  /(?<![\p{L}\p{N}])(?:purchase|purchased|debit(?:ed)?|credit(?:ed)?|charged|charge\s+(?:of|made)|deducted|spent|paid|payment|received|refund(?:ed)?|reversal|withdraw(?:n|al)?|withdrew|made\s+an?|was\s+made|used\s+for|deposit(?:ed)?|transferr(?:ed|ing)|sent|realizad[oa]|efetuad[oa]|zrealizowana|consumo|realizaste|lastschrift|paiement|gerçekleşmiştir|gelmiştir|alışveriş\w*|havale|virement|reçu|pix|enviado|enviou|recebeu|recebido|transaksi|berhasil|kaartbetaling|voltooid|cash\s+(?:withdrawal|advance)|used\s+(?:for|at|on)|transaction|completed|processed|successful|successfully|approved|authori[sz]ed|settled|posted|débité|crédité|effectué|payé|payée|belastet|abgebucht|bezahlt|gutgeschrieben|cargado|pagado|abonado|addebitato|pagata|accreditato|afgeschreven|betaald|bijgeschreven)(?![\p{L}\p{N}])|(?:خصم|دفع|شراء|سحب|تحويل|ايداع|إيداع|استرداد|استرجاع|تمت|تم|ご利用|利用金額|消费|支付|승인|डेबिट|क्रेडिट)/iu;

// A small family of real bank field-list alerts has amount + instrument +
// merchant but no verb at all. The 30k Jev benchmark found one such rescued FAB
// family ("cards ... AED <amount> ... at/to ..."). Keep this narrow and only
// for a sender the mature regional router already recognises.
const UNIVERSAL_FIELD_LIST_HINT =
  /\bcards?\b[\s\S]{0,120}\bAED\b[^\d]{0,12}\d[\s\S]{0,120}\b(?:at|to)\b/iu;

const UNIVERSAL_POSTED_STEM_HINT =
  /(?<![\p{L}\p{N}])(?:realiz(?:aste|ó|o|ado|ada)|pag(?:aste|ó|o|ou|amento|amentos)|compra(?:ste)?|recib(?:iste|ido|ida)|recebeu|envi(?:aste|ó|o|ou)|transfiri(?:ó|o|ste)|abon(?:aron|ó|o)|retir(?:o|aste|ada|ado)|saque|giro|cargo|d[ée]bito|cr[ée]dito|tarifa|usted\s+envi|pr[ée]lev\p{L}*|retrait|achat|d[ée]p[ôo]t|envoy[ée]e?|erhalten|gutschrift|zahlungseingang|kartenzahlung|umsatz|buchung|transaktion|abbuchung|überweisung|ueberweisung|operazione|eseguit[oa]|bonifico|prelievo|versamento|accredito|betaling|k[öo]p|betal(?:t|te)|f[åa]tt|sendt|skickat|ins[äa]ttning|uttag|p[łl]atno[śs][ćc]|przelew\p{L}*|platba|p[řr][íi]choz[íi]|yap[ıi]l\p{L}*|harcama\p{L}*|g[öo]nderil\p{L}*|[öo]deme\p{L}*|gelmi[sş]\p{L}*|aktar[ıi]m\p{L}*|didebe?t\p{L}*|dikredit\p{L}*|dibayar\p{L}*|ditransfer|menerima|bayar|tarik\s+tunai|transfer\s+masuk|umetuma|kimetolewa|txn|amt|(?:credit|debit)\s+alert|thanh\s+to[áa]n|chuy[ểe]n\s+(?:kho[ảa]n|ti[ềe]n)|wusool)(?![\p{L}\p{N}])|(?:입금|출금|송금|보냈|결제|お引出し|入金|支払|受け取|利用|支出|收入|转账|轉入|轉帳|消費|消费|付款|簽賬|刷卡|薪資|工资|ถอน|โอน|ใช้จ่าย|เงินเข้า|รับโอน|जमा|استلام)/iu;
// Statement field-list codes ("DR Amt:18,450", "CR 5,000.00"); upper-case only,
// so the title "Dr." or the word "cr" never earns the parser.
const UNIVERSAL_FIELD_CODE_HINT = /(?<![A-Za-z])(?:DR|CR)(?![A-Za-z])/u;

export const shouldTryUniversalPosting = (source: string, sender: string): boolean =>
  hasUniversalInstitutionSender(sender) ||
  UNIVERSAL_POSTED_EVENT_HINT.test(source) ||
  UNIVERSAL_POSTED_STEM_HINT.test(source) ||
  UNIVERSAL_FIELD_CODE_HINT.test(source) ||
  (!!detectLaunchMarketFromSender(sender) && UNIVERSAL_FIELD_LIST_HINT.test(source)) ||
  // An exact Latin American bank template ("Te yapeó S/ 20", "DAVIVIENDA:
  // Compra . Aprobado(a)") carries none of the generic posting verbs.
  matchLatamTemplate(source, { sender }) !== null;

// Review eligibility needs financial-alert context, not merely a currency in
// a personal conversation. None of these words grants automatic import.
// "sent to SCB PK A/C ****9901" (money sent INTO a masked bank account) is a
// bank's own wording: it keeps that refused, direction-ambiguous alert in
// Review (best-effort-autopost.ts inboundSentToOwnAccount). Deliberately not
// every masked "A/c XX1234", which would widen Review worldwide: only one the
// text itself says was credited or debited ("Your A/C XXXXX543758 is credited
// with INR ..."), so a bank credit refused for its link footer from an unknown
// sender waits in Review instead of being dropped as unrecognised.
const GENERIC_BANK_CONTEXT = /\b(?:(?:credit|debit|covered|prepaid|charge)\s+card|card\s+(?:purchase|payment|ending|number|no\b)|(?:your|available|current)\s+(?:account|balance|credit)|bank\s+(?:alert|account|fee|transfer|statement|notification)|(?:minimum|total)\s+(?:amount\s+)?due|(?:account|a\/?c)\s+(?:ending|number|no\b)|(?:a\/c|acc(?:oun)?t)\.?\s*(?:no\.?\s*)?[*xX•·]{2,}\d{2,6}\s+(?:is\s+|has\s+been\s+|was\s+)?(?:credited|debited)|sent\s+to\s+(?:your\s+)?(?:[A-Za-z][A-Za-z&]{1,2}\s+){0,3}(?:a\/c|acc(?:oun)?t)\.?\s*(?:no\.?\s*)?[*xX•·]+\d{2,6}|iban|swift|sepa|upi|neft|imps|statement|paiement\s+par\s+carte|kartenzahlung|kontoauszug|compra\s+con\s+tarjeta|pagamento\s+con\s+carta|rekeningoverzicht)\b|بطاق[هة]|حساب|رصيد|كشف\s+حساب|فاتور[هة]/iu;

/**
 * Wording that says money reached the reader: "You have received", "credited
 * to", "refund"; Portuguese/Spanish "recebeu", "Pix recebido", "estorno",
 * "recibiste", "te envió", "abonado"; French "reçu", "crédité"; German
 * "gutgeschrieben"; Malay/Indonesian "diterima", "dikreditkan".
 */
const MONEY_ARRIVED_CLAIM =
  /(?<!\p{L})(?:you\s+have\s+received|you\s+received|received\s+(?:from|for)|(?:is|has\s+been|was)\s+credited|credited\s+(?:to|in|into|with)|deposited|refund(?:ed)?|recebeu|recebid[oa]|creditad[oa]|estorno|recibiste|recibid[oa]|te\s+(?:envi[óo]|ha\s+enviado)|yape[óo]|abonad[oa]|acreditad[oa]|reembolso|devoluci[óo]n|re[çc]u|cr[ée]dit[ée]e?|gutgeschrieben|diterima|dikreditkan)(?!\p{L})/iu;
/**
 * Something only a bank or wallet writes beside such a claim: a bank name
 * ("Swedbank", "Citibank"), a wallet,
 * account or rail word ("M-PESA", "Pix", "SPEI", "UPI", "Zelle", "Interac"),
 * a balance, a reference or transaction id, or an upper-case transaction code
 * ("QX81TR4KLM"). A chat ("you received Ksh 2,000 from me?") has none.
 */
const MONEY_CLAIM_EVIDENCE =
  /(?<!\p{L})(?:\p{L}*bank|banco|banque|wallet|carteira|billetera|account|acct|a\/c|conta|cuenta|compte|konto|rekening|balance|bal|avl|saldo|solde|ref(?:erence)?|txn|trx|tid|transaction|transfer|transferencia|transfer[êe]ncia|virement|[ée]-?transfer|pix|spei|aani|sarie|yape|plin|nequi|daviplata|m-?pesa|mpesa|upi|imps|neft|rtgs|zelle|interac|gcash|maya|paytm|jazzcash|easypaisa|momo|airtel\s+money)(?!\p{L})/iu;
const TRANSACTION_CODE = /\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{8,12}\b/u;
/** Explicit first-person chat cannot become an issuer alert through a money verb. */
const PERSONAL_MESSAGE_PREFIX_RE = /^\s*(?:(?:hi|hey|hello)\b(?:[^\r\n.!?]{0,40}[,!:]|\s+)\s*)?(?:I(?:\s+(?:(?:have|just|already)\s+){0,2}|['’]ve\s+(?:(?:just|already)\s+)?)(?:spent|paid|bought|sent|deposited|transferred|refunded)\b|[اأ]نا\s+(?:(?:قد|لقد)\s+)?(?:صرفت|دفعت|اشتريت|حولت|حوّلت|أرسلت|ارسلت)(?=\s))/iu;
export const hasPersonalMessagePrefix = (source: string): boolean => PERSONAL_MESSAGE_PREFIX_RE.test(source);

// Only a leading principal-money claim is checked here. A posted purchase
// must survive a separate negated fee, balance update or bank-security footer.
const NEGATED_PRINCIPAL_MOVEMENT_RE = /^\s*(?:Dear\s+Customer[,!:]\s*)?((?:[A-Z]{3}|\p{Sc})\s*\d[\d,.]*)\s+(?:(?:has|have)\s+not\s+been|hasn['’]t\s+been|(?:was|were|is|are)\s+not|(?:was|were|is|are)n['’]t)\s+(?:transferred|debited|credited|deducted|charged|withdrawn|paid|deposited|refunded)\b/iu;
const hasNegatedPrincipalMovement = (source: string): boolean => {
  const match = NEGATED_PRINCIPAL_MOVEMENT_RE.exec(source);
  return !!match && hasBankAlertMoneyHint(match[1]);
};

/**
 * First- and second-person chat: the writer says THEY sent it, or asks
 * whether it arrived. A bank never writes "from me" or "did you get it".
 */
const PERSONAL_CHAT =
  /\b(?:from\s+me|i\s+(?:have\s+|'ve\s+|just\s+)?(?:sent|deposited|transferred|paid|refunded)|sent\s+it|did\s+(?:you|u)\s+(?:get|receive)|have\s+(?:you|u)\s+(?:got|received)|te\s+mandei|ukipata|nimekutumia)\b/iu;

// South African bank layouts can use a bare rand symbol plus a masked account
// field. This admits Review context only; the money reader still has to prove
// the actual principal, and it never supplies the destination's ownership.
const hasNativeCurrencyAccountContext = (source: string): boolean =>
  getActiveCountry() === 'ZA' && ZA_RAND_HINT.test(source) &&
  /\b(?:a\/c|acct?|account)\s*(?:ending(?:\s+in)?\s*|[.*x•·]{2,})\d{4,12}\b/iu.test(source) &&
  /(?<![\p{L}\p{N}])R\s?\d[\d,.]{0,20}\s+(?:(?:has\s+been|was)\s+)?(?:paid|debited|credited|deposited|received)\b/iu.test(source) &&
  !PERSONAL_CHAT.test(source) && !hasNonCompletedWording(source, null, '') &&
  !hasLinkFromUnregisteredSender(source, '');

export const hasGenericBankAlertContext = (source: string, sender = ''): boolean => {
  // Normalize shaped Arabic letters with the same length-preserving contract
  // as field extraction. This admits an alert to Review, not to posting.
  const text = /[\uFB50-\uFDFF\uFE70-\uFEFF]/u.test(source) ? normalizeAlertText(source) : source;
  if (GENERIC_BANK_CONTEXT.test(text) || detectLaunchMarketFromSender(sender) !== null ||
      hasUniversalInstitutionSender(sender)) return true;
  const accountFieldList = /^\s*(?:debit|credit)\s*!?\s*\r?\n/iu.test(text) &&
    /(?:^|\n)\s*(?:acct|acc|account|a\/?c)\s*:/iu.test(text) &&
    /(?:^|\n)\s*(?:amt|amount)\s*:/iu.test(text) && hasBankAlertMoneyHint(text);
  // Public Tanzanian receipt layouts pair their literal unit with principal,
  // balance and receipt identity. A bare wallet word or price is insufficient.
  // Their settlement status is still decided by the universal status guards.
  const walletReceipt = /(?<![\p{L}\p{N}])TSh\s*\d/iu.test(text) &&
    /\b(?:balance|bal\s*:)/iu.test(text) &&
    /\b(?:txn\s*id|transaction\s*id|receipt(?:\s*(?:no|number))?|ref(?:erence)?|id)\s*[:#]/iu.test(text) &&
    /\b(?:amount|txn\s+amt|you\s+have\s+received|cash\s+out\s+of)\b/iu.test(text) && !PERSONAL_CHAT.test(text);
  return accountFieldList || walletReceipt || hasNativeCurrencyAccountContext(text);
};

// Real iPhone History loses the sender for the owner's "Your Cr.Card ... was
// used for" alerts. The abbreviated card noun misses GENERIC_BANK_CONTEXT.
// Admit only this completed own-card shape to the reader below, then require
// explicit purchase facts. This is not bank, country or auto-post evidence.
// A visible last-four may be masked or bare; a full/grouped card number fails.
const SENDERLESS_USED_CARD_HINT = /^\s*your\s+(?:cr\.\s*)?card\s+(?:[*xX•·]{1,24}\s*)?(\d{4})(?![\p{L}\p{N}]|[ \t-]+\d)[ \t]+(?:was|has[ \t]+been)[ \t]+used[ \t]+for\b/iu;

/**
 * Generic evidence augments misses in every country; it is always review-only.
 * `market` is passed only for an alert routed to a Gulf neighbour, so its own
 * currency spellings (KD, ر.ع …) and three-decimal figures fill the amount.
 */
export const inspectGenericBankEventForReview = (
  source: string,
  sender = '',
  market?: string | null,
  sourceContext?: UniversalParseContext,
): UniversalBankEvent | null => {
  if (hasPersonalMessagePrefix(source) || hasNegatedPrincipalMovement(source)) return null;
  // An exact LatAm bank template is bank-alert context in its own right.
  const noContext = !hasGenericBankAlertContext(source, sender) && !matchLatamTemplate(source, { sender });
  // A "money arrived" claim from a phone number, e-mail, generic header or
  // no sender has no bank context of its own. From an unverified sender the
  // best-effort policy will not auto-add it (unverified-sender); without a
  // sender the policy may still refuse it for another reason. Either way it
  // waits in Review instead of being dropped, so a genuine wallet credit is
  // never lost, provided it carries something only a bank or wallet writes
  // (a rail, a balance, a reference or transaction code) and is not a chat
  // ("you received Ksh 2,000 from me?"). A registered sender keeps the
  // context requirement, and a claim the wording guard already refuses
  // ("Congrats, INR 30,000 Can Be Credited ... Check Now") or that carries a
  // link ("... is credited to 98XXXXXXXX Register now d5m.example/x") is not
  // admitted this way.
  const claimAdmitted = noContext && (!sender.trim() || isUnverifiedAlertSender(sender)) &&
    MONEY_ARRIVED_CLAIM.test(source) && (MONEY_CLAIM_EVIDENCE.test(source) || TRANSACTION_CODE.test(source)) && !PERSONAL_CHAT.test(source) &&
    !hasNonCompletedWording(source, null, sender) && !hasLinkFromUnregisteredSender(source, sender);
  // A completed movement from a registered header that only advert, shop
  // notice or order-callback wording refused ("Rs.200 paid to Swiggy from
  // Paytm wallet. Order ID: 9988. Need help? Contact 24x7 Helpline") also
  // waits in Review rather than being dropped.
  const footerAdmitted = noContext && !claimAdmitted && isRegisteredAlertSender(sender) &&
    refusedOnlyByShopOrPromoWording(source, sender);
  const senderlessCard = noContext && !sender.trim() ? SENDERLESS_USED_CARD_HINT.exec(source) : null;
  const cardAdmitted = !!senderlessCard && namesOwnInstrumentTail(source, 'debit') &&
    !nonPostingReason(source) && !isNotAutoPostableMoney(source) &&
    !hasNonCompletedWording(source, null, '') && !hasLinkFromUnregisteredSender(source, '');
  if (noContext && !claimAdmitted && !footerAdmitted && !cardAdmitted) return null;
  const event = isGulfNeighbourMarket(market)
    ? inspectUniversalBankEvent(gulfNeighbourReadSource(source, market), {
        sender, market, dateOrder: dateOrderForCountry(market) ?? undefined,
      })
    : inspectUniversalBankEvent(source, sourceContext
        ? { ...sourceContext, sender }
        : universalSourceParseContext(hasUniversalInstitutionSender(sender)
          ? inspectUniversalAlert({ source, sender }) : null, sender, getActiveCountry()));
  if (event.decision !== 'review') return null;
  // A source-labelled credit limit is not a second purchase. Every other
  // extra figure remains refused: "used for X ... and Y ..." can otherwise
  // look like one explicit principal plus one unknown amount.
  const hasOtherCardMoney = cardAdmitted && event.observations.some(observation =>
    observation.role !== 'transaction' && observation.role !== 'credit-limit');
  if (cardAdmitted && (event.family !== 'purchase' || event.status !== 'posted' || event.direction !== 'debit' ||
    event.amount.evidence !== 'explicit' || !event.amount.value || event.amount.spans.length !== 1 ||
    hasOtherCardMoney ||
    event.observations.filter(observation => observation.role === 'transaction').length !== 1 ||
    event.instrument.evidence !== 'explicit' || event.instrument.spans.length !== 1 ||
    event.instrument.value?.kind !== 'card' || event.instrument.value.last4 !== senderlessCard?.[1])) return null;
  if (hasNativeCurrencyAccountContext(source) && !hasBankAlertMoneyHint(source) &&
    (event.amount.evidence !== 'explicit' || event.amount.value?.currency !== 'ZAR')) return null;
  if (noContext && !((event.direction === 'credit' || ((footerAdmitted || cardAdmitted) && event.direction === 'debit')) &&
    event.status === 'posted' && event.amount.evidence !== 'missing')) return null;
  const hasGroundedMoney =
    event.amount.evidence !== 'missing' ||
    event.observations.some((observation) => observation.field.evidence !== 'missing');
  if (event.status === 'unknown' && event.family === 'unknown' &&
    event.instrument.evidence !== 'explicit' && !hasGroundedMoney) return null;
  return event;
};

/** Synchronous, network-free rate lookup used while parsing. */
export type ParseFxLookup = (base: string, quote: string, date: string) => FxQuote | null;

/**
 * The category and title an automatically posted worldwide row gets.
 *
 * Both posting seams below used to hard-code `other` for everything except
 * ATM and utility rows, so a Tesco, Spotify or REWE purchase posted in the
 * UK or Germany arrived uncategorized even though the worldwide merchant
 * vocabulary and brand table (universal-categorization.ts) already knew them,
 * and the SAME alert promoted from Review was categorized. One alert must get
 * one answer whichever door it came through, so this is the Review path's own
 * call. Transfers keep their structural title and stay uncategorized: whether
 * they are the user's own money is reconciliation's question, not a merchant's.
 */
const WORLD_SALARY_RE = /\b(?:salary|payroll|wages?|pay\s*cheque|paycheck|salaire|gehalt|lohn|salario|sueldo|n[óo]mina|sal[áa]rio|stipendio|salaris|maa[şs]|gaji)\b|راتب|رواتب|वेतन/iu;
const universalRowCategory = (
  source: string,
  event: UniversalBankEvent,
  overrides: Record<string, CategoryId>,
  market: string | null,
): { category: CategoryId; deliberate: boolean; merchant: string } => {
  const explicit = event.merchant.evidence === 'explicit' ? event.merchant.value?.trim() ?? '' : '';
  if (event.family === 'cash-withdrawal') return { category: 'cash-withdrawal', deliberate: true, merchant: explicit };
  // Salary is the one incoming transfer whose purpose the wording states.
  if (event.direction === 'credit' && event.family === 'transfer' && WORLD_SALARY_RE.test(source)) {
    return { category: 'salary', deliberate: true, merchant: 'Salary' };
  }
  if (event.family === 'transfer' || (event.direction !== 'debit' && event.direction !== 'credit')) {
    return { category: 'other', deliberate: false, merchant: explicit };
  }
  const type = event.direction === 'credit' ? 'income' as const : 'expense' as const;
  const suggestion = suggestUniversalCategory(event, { type, overrides, market: market ?? undefined });
  if (event.family === 'utility' && suggestion.needsReview) {
    return { category: 'utilities', deliberate: true, merchant: suggestion.merchant || explicit };
  }
  return {
    category: suggestion.category,
    deliberate: !suggestion.needsReview,
    merchant: explicit ? suggestion.merchant || explicit : '',
  };
};

/**
 * COUNTRY CONVENTIONS FOR MONEY WITHOUT AN ISO CODE.
 *
 * Both apply only when the PERSON's country states the convention; nothing
 * here reads the ledger currency, and no other country is affected.
 *  - South Africa prints the rand as a bare "R" ("R450.00 paid from Cheq
 *    a/c"). A letter on its own is not a currency anywhere else.
 *  - Indian UPI/IMPS/NEFT account alerts often state no currency at all
 *    ("A/C X1234 debited by 450.0 ... trf to ZOMATO"). Only that exact shape
 *    is read as rupees: an account reference, a payment rail, a debited/
 *    credited-by figure, and no other money in the text.
 */
const COUNTRY_CURRENCY_ALIASES: Readonly<Record<string, CurrencyAliasMap>> = {
  ZA: { R: ['ZAR'] },
  // Philippine banks print the peso as a bare "P" ("used for P3,200.00").
  PH: { P: ['PHP'] },
};
const ZA_RAND_HINT = /(?<![\p{L}\p{N}])R\s?\d/u;
// A lone "P" is a letter ("P2 promo", "Pier 39", "Level P3"): it is a peso only
// beside a two-decimal figure ("P3,200.00"), never a bare integer.
const PH_PESO_HINT = /(?<![\p{L}\p{N}])P\s?\d{1,3}(?:,\d{3})*\.\d{2}(?![\d.,])/u;
const IN_IMPLICIT_RUPEE_RE = /\b(debited|credited)\s+(by|for|with)\s+(?=\d[\d,]*(?:\.\d{1,2})?\b)/i;
const countryReadSource = (source: string, country: string | null): string => {
  if (country !== 'IN' || hasBankAlertMoneyHint(source)) return source;
  if (!/\b(?:a\/c|acct?|account)\b/i.test(source) || !/\b(?:upi|imps|neft|rtgs)\b/i.test(source)) return source;
  return source.replace(IN_IMPLICIT_RUPEE_RE, '$1 $2 INR ');
};
const countryMoneyHint = (source: string, country: string | null): boolean =>
  (country === 'ZA' && ZA_RAND_HINT.test(source)) || (country === 'PH' && PH_PESO_HINT.test(source)) ||
  countryReadSource(source, country) !== source;

/**
 * A money field in the ledger currency, or null. An explicit figure must
 * already be in it; a shared symbol ($, Rs) resolves only through the
 * person's own country, exactly as the best-effort policy resolves it.
 */
const ledgerMinorOf = (
  field: UniversalField<UniversalMoney>,
  country: string | null,
  ledgerCurrency: string,
  ledgerExponent: number | null,
): number | null => {
  let money: UniversalMoney | null = null;
  if (field.evidence === 'explicit' && field.value && field.alternatives.length === 0) money = field.value;
  else if (field.evidence === 'ambiguous' && field.issues.length > 0 &&
    field.issues.every((issue) => issue === 'currency-symbol' || issue === 'currency-exponent' ||
      issue === 'decimal-or-grouping')) {
    // Same rule as resolvePrincipalMoney: a dot-grouped peso resolves only
    // when the person's own currency has exactly one reading of it.
    const wanted = sharedSymbolCurrencyForCountry(country);
    const options = [...(field.value ? [field.value] : []), ...field.alternatives].filter((m) => m.currency === wanted);
    if (new Set(options.map((m) => `${m.minorUnits}/${m.exponent}`)).size === 1) money = options[0];
  }
  if (!money || money.currency !== ledgerCurrency || (ledgerExponent !== null && money.exponent !== ledgerExponent)) return null;
  if (!/^[1-9]\d{0,15}$/.test(money.minorUnits)) return null;
  const minor = Number(money.minorUnits);
  return Number.isSafeInteger(minor) ? minor : null;
};

// Candidate payment context only; this never proves the paid card's kind.
const CREDIT_CARD_WORDS = /\b(?:credit|charge|covered)\s+card\b|\bcredit\s*card\b|\bbarclaycard\b|\bamerican\s+express\b|\bamex\b|\bcapital\s+one\b|\bdiscover\s+card\b/iu;
/** Not a card obligation at all: a loan/EMI statement that merely mentions a card. */
const NOT_CARD_OBLIGATION = /\b(?:loan|emi|mortgage|finance|instal?ment\s+plan)\b/iu;

/** The generic instrument field deliberately does not distinguish card kinds.
 * Read kind only beside its validated tail span, in the payment clause or a
 * standalone card heading. A debit/prepaid/gift number elsewhere cannot name
 * an unnumbered credit-card payment, even when both cards share their tail.
 */
const sourceNamesPaidCreditCard = (source: string, event: UniversalBankEvent, last4: string): boolean => {
  const template = matchLatamTemplate(source);
  if (template?.status === 'posted' && template.ownTransfer === 'card-payment') return template.paidCard === last4;
  const text = normalizeAlertText(source);
  const kindPrefix = /\b(credit|charge|covered|debit|prepaid|gift)\s*card\s*(?:(?:ending(?:\s+(?:in|with))?|no\.?|number|last\s*4)\s*)?[:#-]?\s*[\dXx*•·-]*(?:[ \t]+[\dXx*•·-]{1,40})*\s*$/iu;
  const boundary = /[!?;\n]|\.(?!\d)|(?<!\d)\./gu;
  // Rs. belongs to its validated monetary token, not a new sentence. Keep
  // indices unchanged so paid-card ownership still uses the original spans.
  const sentenceText = text.replace(/\bRs\.(?=\s*\d)/giu, token => token.replace('.', ' '));
  let paidCredit = false;
  for (const span of event.instrument.spans) {
    if (text.slice(span.start, span.end) !== last4) continue;
    const before = text.slice(Math.max(0, span.start - 120), span.start);
    const match = before.match(kindPrefix);
    if (!match) continue;
    if (/debit|prepaid|gift/i.test(match[1])) return false;
    const kindStart = span.start - before.length + match.index!;
    const prior = Array.from(sentenceText.slice(0, kindStart).matchAll(boundary)).at(-1);
    const clauseStart = prior ? prior.index! + prior[0].length : 0;
    const next = sentenceText.slice(span.end).search(boundary);
    const clauseEnd = next < 0 ? text.length : span.end + next;
    const clause = text.slice(clauseStart, clauseEnd);
    const standalone = /^(?:your|the)?\s*$/iu.test(text.slice(clauseStart, kindStart).trim()) &&
      text.slice(span.end, clauseEnd).trim() === '';
    if (/\b(?:payment|repayment)\b/iu.test(clause) || standalone) paidCredit = true;
  }
  return paidCredit;
};
/**
 * WORLDWIDE CARD PAYMENTS.
 *
 * A card payment is a settlement, not spending or income. Read it only when
 * the alert proves its own completed payment:
 *  - a payment must be a completed card-payment family alert that names the
 *    card's last four, in the ledger currency;
 *  - any refusal, code challenge, hold or pending wording stops it.
 * Unverified statements stay in typed Review: CardDue has no visible
 * best-effort provenance or Undo. The universal field reader retains their
 * total, minimum, deadline and instrument for that Review path.
 */
const universalCardPayment = (
  source: string,
  event: UniversalBankEvent,
  ledgerCurrency: string,
  ledgerExponent: number | null,
  country: string | null,
  observedAt?: number,
): Omit<ParsedSms, 'raw' | 'bestEffort'> | null => {
  if (event.family !== 'card-payment' || event.decision !== 'review' ||
    nonPostingReason(source) || isNotAutoPostableMoney(source)) return null;
  // An exact Latin American own card-bill template ("Pagaste ... en la tarjeta
  // de credito *4321 desde la cuenta *1234") names the paid card in Spanish.
  const latamCardPayment = event.family === 'card-payment' && isLatamOwnCardPayment(source);
  if (NOT_CARD_OBLIGATION.test(source) || (!CREDIT_CARD_WORDS.test(source) && !latamCardPayment)) return null;
  const today = localIsoDay(observedAt);
  if (event.status === 'failed' || event.issues.some((issue) =>
    issue === 'authentication-not-posting' || issue === 'pending-not-posting' || issue === 'failed-not-posting')) return null;
  const instrument = event.instrument.evidence === 'explicit' ? event.instrument.value : null;
  const last4 = instrument?.kind === 'card' && instrument.last4 && /^\d{4}$/.test(instrument.last4) ? instrument.last4 : null;
  if (!last4 || !sourceNamesPaidCreditCard(source, event, last4)) return null;
  if (event.family === 'card-payment' && event.status === 'posted' && last4 &&
    (event.direction === 'credit' || event.direction === 'debit')) {
    // The same completed-money guard every other worldwide posting passes:
    // reversed, processing, scheduled or auto-debit-later payments are not paid.
    if (hasNonCompletedWording(source, country)) return null;
    const amount = ledgerMinorOf(event.amount, country, ledgerCurrency, ledgerExponent);
    if (!amount) return null;
    const date = event.transactionDate.evidence === 'explicit' ? event.transactionDate.value : null;
    if (date && today && date > today) return null;
    const receipt = event.direction === 'credit';
    return {
      kind: 'cardPayment', type: receipt ? 'income' : 'expense', amountFils: amount, currency: ledgerCurrency,
      merchant: `Card •${last4} payment`, date, dueDay: null, minDueFils: null,
      card: { last4, kind: 'credit' }, cardPaymentSide: receipt ? 'receipt' : 'debit',
      reference: null, transferHint: true, snapshotFils: null, snapshotKind: null,
      categoryGuess: 'other', categoryDeliberate: true,
    };
  }
  return null;
};

const localIsoDay = (epochMs: number | undefined): string | null => {
  if (epochMs === undefined || !Number.isFinite(epochMs)) return null;
  const day = new Date(epochMs);
  if (!Number.isFinite(day.getTime())) return null;
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
};

/**
 * STRICT, UNMARKED universal posting for UAE/Saudi evidence only.
 *
 * Used by parse() when the sender or route is a launch market (AE/SA) but the
 * launch grammar declined and the ledger is not Gulf. This is the behaviour
 * that shipped before the best-effort policy existed, kept unchanged so a
 * UAE/Saudi sender is never treated as an "unverified format": no marker, and
 * the best-effort setting does not apply.
 *
 * This is the bank-agnostic production seam: no bank/sender registry is
 * required. The universal parser must prove one posted amount, one direction,
 * and an unambiguous ISO currency. Anything involving transfer ownership,
 * card settlement, statements, balances, bills/future events, authentication,
 * promotions, or unresolved fields remains in Review.
 */
const parseUniversalLaunchStrict = (
  source: string,
  sender: string,
  pinnedCurrency: string | null,
  pinnedExponent: number | null,
  fxLookup: ParseFxLookup,
  observedAt?: number,
  overrides: Record<string, CategoryId> = {},
  market: string | null = null,
): ParsedSms | null => {
  const event = inspectUniversalBankEvent(source, { sender, dateOrder: activeCountryDateOrder() });
  if (event.decision !== 'review' || event.status !== 'posted') return null;
  if (event.direction !== 'debit' && event.direction !== 'credit') return null;
  if (!['purchase', 'cash-withdrawal', 'refund', 'fee', 'utility', 'recurring-payment'].includes(event.family)) {
    return null;
  }
  if (event.amount.evidence !== 'explicit' || !event.amount.value) return null;
  const money = event.amount.value;
  const exponent = currencyMinorUnits(money.currency);
  if (exponent === null || exponent !== money.exponent || !/^\d+$/.test(money.minorUnits)) return null;
  const originalMinor = Number(money.minorUnits);
  if (!Number.isSafeInteger(originalMinor) || originalMinor <= 0) return null;
  const transactionDay = event.transactionDate.evidence === 'explicit' ? event.transactionDate.value : null;
  /**
   * FOREIGN MONEY ON A PINNED LEDGER IS CONVERTED, NEVER RELABELLED.
   *
   * A USD ledger receiving "EUR 45.00 spent at ..." posts the ledger-currency
   * equivalent and keeps EUR 45.00 on the row. The card's own charged ledger
   * figure wins when the alert states one; otherwise only a dated provider
   * rate ALREADY KNOWN on this device may convert (parsing never touches the
   * network). With neither, this returns null exactly as before and the alert
   * reaches Review, where promotion fetches the rate or keeps it pending.
   */
  let amountFils = originalMinor;
  let currency = money.currency;
  let fx: Partial<ParsedSms> = {};
  if (pinnedCurrency && pinnedCurrency !== money.currency) {
    if (pinnedExponent !== 0 && pinnedExponent !== 2 && pinnedExponent !== 3) return null;
    const day = transactionDay ?? localIsoDay(observedAt);
    if (!day) return null;
    const quote = fxLookup(money.currency, pinnedCurrency, day);
    const converted = convertForeignConfirmation(event, {
      currency: money.currency, minorUnits: originalMinor, exponent,
    }, { currency: pinnedCurrency, exponent: pinnedExponent },
    quoteFitsDay(quote, day) ? quote : null, { requireQuoteForStated: true });
    if (converted === 'fx-rate-unavailable' || converted === 'invalid-money') return null;
    amountFils = converted.amountFils;
    currency = pinnedCurrency;
    fx = converted.fields;
  } else if (pinnedExponent !== null && pinnedExponent !== money.exponent) {
    return null;
  }
  const blockedIssues = new Set([
    'amount-role-unresolved',
    'posting-status-unresolved',
    'direction-unresolved',
    'direction-conflict',
    'multiple-event-adapter-required',
    'authentication-not-posting',
    'pending-not-posting',
    'promotion-not-posting',
    'settlement-adapter-required',
    'failed-not-posting',
  ]);
  if (event.issues.some((issue) => blockedIssues.has(issue))) return null;

  const instrument = event.instrument.evidence === 'explicit' ? event.instrument.value : null;
  const card = instrument ? {
    last4: instrument.last4 ?? '',
    kind: instrument.kind === 'account' ? 'account' as const : 'unknown' as const,
  } : null;
  const classified = universalRowCategory(source, event, overrides, market);
  const merchant = classified.merchant
    ? classified.merchant
    : event.family === 'cash-withdrawal'
      ? 'ATM withdrawal'
      : event.family === 'refund'
        ? 'Refund'
        : event.direction === 'credit'
          ? 'Incoming transfer'
          : 'Account debit';
  const categoryGuess: CategoryId = classified.category;

  return {
    kind: 'transaction',
    type: event.direction === 'credit' ? 'income' : 'expense',
    amountFils,
    currency,
    ...fx,
    merchant,
    date: transactionDay,
    dueDay: null,
    minDueFils: null,
    card: card && card.last4 ? card : null,
    reference: null,
    transferHint: false,
    snapshotFils: null,
    snapshotKind: null,
    categoryGuess,
    categoryDeliberate: classified.deliberate,
    raw: source.trim(),
  };
};

interface UnprovenPostingContext {
  enabled: boolean;
  country: string | null;
  routedMarket: string | null;
  /** Launch (AE/SA) sender evidence; the policy then refuses unconditionally. */
  launchSenderMarket: string | null;
  overrides?: Record<string, CategoryId>;
  /** The routed market's identified institution (Gulf-neighbour posting needs one). */
  institution?: { id: string; sender: boolean } | null;
  inspection: UniversalAlertReview | null;
}

/** The identified institution of a single route, and whether the sender itself proved it. */
const routedInstitution = (inspection: UniversalAlertReview | null): { id: string; sender: boolean } | null => {
  const review = inspection?.route.decision === 'single' ? inspection.review?.institution : null;
  if (!review || review.decision !== 'identified' || !review.institution) return null;
  const candidate = review.candidates.find((item) => item.institution === review.institution);
  return { id: review.institution, sender: !!candidate?.evidence.includes('sender') };
};

/**
 * A registered sender's single identified issuer scopes its money aliases.
 * Its owned principal currency also supports the issuer's date convention;
 * a multinational bank's foreign-currency alert keeps the country fallback.
 * A bank name elsewhere in the body can be a merchant or beneficiary, so that
 * route alone cannot supply aliases or override the person's chosen country.
 * Conflicting issuers leave numeric dates unresolved even when country is set.
 * Callers may share this context with Review; it grants no posting authority.
 */
export const universalSourceParseContext = (
  inspection: UniversalAlertReview | null,
  sender: string,
  country: string | null,
): UniversalParseContext => {
  const route = inspection?.route;
  const market = route?.decision === 'single' && route.market !== 'AE' && route.market !== 'SA' &&
    routedInstitution(inspection)?.sender ? route.market : undefined;
  const issuerConflict = route?.decision === 'ambiguous' && route.reasons.some(reason =>
    reason === 'overlapping-sender' || reason === 'sender-institution-conflict' || reason === 'multiple-institutions');
  const homeCurrencies: readonly string[] = market ? alertMarketPack(market).currencies : [];
  // Informational balances, limits, fees and minimums cannot establish the
  // principal's source convention. Use the common field-ownership reader,
  // including its instrument/date/name exclusions, before selecting a token.
  const sourceFields = market && inspection?.review
    ? inspectUniversalBankEvent(inspection.review.draft.normalizedText, { sender, moneyMarket: market })
    : null;
  const principal = sourceFields?.amount.evidence === 'explicit' ? sourceFields.amount
    : sourceFields?.family === 'statement' && sourceFields.statementTotal.evidence === 'explicit'
      ? sourceFields.statementTotal : null;
  const sourceOwnCurrency = !!market && !!inspection?.review?.draft.candidates.some(candidate => {
    if (!principal?.spans.some(span => span.start === candidate.span.start && span.end === candidate.span.end) ||
        candidate.evidence === 'ambiguous-symbol' || candidate.interpretations.length === 0 ||
        !candidate.interpretations.every(value => homeCurrencies.includes(value.currency))) return false;
    if (candidate.evidence === 'iso-code') return true;
    // The routed draft can narrow a shared "$"/"Rs" alias. Re-read its exact
    // monetary token without the route before treating it as country evidence.
    // A pack-only literal unit (JD) has no global currency interpretation;
    // an already unique global unit (£) retains its original interpretation.
    const neutral = inspectUniversalBankEvent(candidate.sourceText);
    const neutralCurrencies = neutral.observations.flatMap(row =>
      row.field.value ? [row.field.value.currency] : row.field.alternatives.map(value => value.currency));
    return neutralCurrencies.length === 0 || neutralCurrencies.every(currency => homeCurrencies.includes(currency));
  });
  const dateOrder = issuerConflict ? null : dateOrderForCountry(sourceOwnCurrency ? market : country);
  const aliases = country ? COUNTRY_CURRENCY_ALIASES[country] : undefined;
  return { sender, ...(market ? { moneyMarket: market } : {}), ...(dateOrder ? { dateOrder } : {}),
    ...(aliases ? { currencyAliases: aliases } : {}) };
};

/**
 * Promote only a self-proving universal event — an UNPROVEN format.
 *
 * This is the bank-agnostic production seam: no bank/sender registry is
 * required. Whether it may post is decided by exactly one policy,
 * decideBestEffortAutoPost (best-effort-autopost.ts): one completed amount,
 * one direction, an explicit (or country-resolved) currency, no non-posting
 * wording, no competing figure, and a dated rate for foreign money. Anything
 * else (statements, balances, bills/future events, authentication,
 * promotions, unresolved fields) stays in Review. Every row produced here
 * carries the `bestEffort` marker so the person can check it.
 *
 * FOREIGN MONEY ON A PINNED LEDGER IS CONVERTED, NEVER RELABELLED. The card's
 * own charged ledger figure wins when the alert states one; otherwise only a
 * dated provider rate ALREADY KNOWN on this device may convert (parsing never
 * touches the network). With neither, this returns null and the alert reaches
 * Review, where promotion fetches the rate or keeps it pending.
 */
const parseUniversalPostedEvent = (
  source: string,
  sender: string,
  pinnedCurrency: string | null,
  pinnedExponent: number | null,
  fxLookup: ParseFxLookup,
  observedAt: number | undefined,
  context: UnprovenPostingContext,
): ParsedSms | null => {
  // The setting is checked before the (comparatively expensive) inspection.
  if (!context.enabled) return null;
  // A best-effort row is only ever written in the pinned ledger currency; an
  // unpinned ledger waits for Review (or a proven alert) to choose it.
  if (!pinnedCurrency) return null;
  const readSource = countryReadSource(source, context.country);
  const event = inspectUniversalBankEvent(readSource,
    universalSourceParseContext(context.inspection, sender, context.country));
  // `$` resolves through the issuer's routed market first, as the policy does.
  const payment = universalCardPayment(readSource, event, pinnedCurrency, pinnedExponent,
    context.routedMarket ?? context.country, observedAt);
  if (payment) {
    return {
      ...payment,
      bestEffort: { v: 1, format: `universal:${event.family}:${event.direction}`, market: context.routedMarket ?? context.country ?? 'ZZ' },
      raw: source.trim(),
    };
  }
  // Qatar, Kuwait, Bahrain and Oman: read by the launch grammar (or an exact
  // certified bank template), never by the generic reader alone. A neighbour
  // alert this declines waits in Review. See gulf-neighbour-alerts.ts.
  const neighbour = decideGulfNeighbourPosting({
    source, sender, routedMarket: context.routedMarket, institution: context.institution ?? null,
    enabled: context.enabled, ledgerCurrency: pinnedCurrency, ledgerExponent: pinnedExponent,
    observedAt, fxLookup, overrides: context.overrides,
  });
  if (neighbour.outcome === 'post') return neighbour.parsed;
  if (neighbour.outcome === 'review') return null;
  // Yape's payee-side receipt check is not an OTP, and is never kept: the
  // wording guard and the stored excerpt see the message without it.
  const policySource = latamPolicySource(readSource, { sender });
  const decision = decideBestEffortAutoPost({
    source: policySource,
    sender,
    event,
    enabled: context.enabled,
    country: context.country,
    routedMarket: context.routedMarket,
    launchSenderMarket: context.launchSenderMarket,
    ledgerCurrency: pinnedCurrency,
    ledgerExponent: pinnedExponent,
    observedAt,
    fxLookup,
    exactTemplate: matchLatamTemplate(readSource, { sender }) !== null,
  });
  if (decision.outcome !== 'post') return null;

  const instrument = event.instrument.evidence === 'explicit' ? event.instrument.value : null;
  const card = instrument ? {
    last4: instrument.last4 ?? '',
    kind: instrument.kind === 'account' ? 'account' as const : 'unknown' as const,
  } : null;
  const transfer = event.family === 'transfer';
  // Transfer ownership is a separate reconciliation question: keep the
  // structural title so a recipient name cannot turn it into spending.
  const classified = universalRowCategory(source, event, context.overrides ?? {}, context.routedMarket ?? context.country);
  // A LatAm card-bill payment or own-account move keeps the app's own title
  // for it ("Card payment", "Own account transfer"), never a payee's.
  const ownTitle = transfer ? latamOwnTransferTitle(policySource, { sender }) : null;
  const merchant = transfer
    ? ownTitle ?? (classified.category === 'salary' ? 'Salary' : event.direction === 'credit' ? 'Incoming transfer' : 'Outgoing transfer')
    : classified.merchant
      ? classified.merchant
      : event.family === 'cash-withdrawal'
        ? 'ATM withdrawal'
        : event.family === 'refund'
          ? 'Refund'
          : event.direction === 'credit'
            ? 'Incoming transfer'
            : 'Account debit';
  const categoryGuess: CategoryId = classified.category;

  return {
    kind: 'transaction',
    type: event.direction === 'credit' ? 'income' : 'expense',
    amountFils: decision.amountFils,
    currency: decision.currency,
    ...(decision.conversion ? decision.conversion.fields : {}),
    bestEffort: decision.marker,
    merchant,
    date: decision.date,
    dueDay: null,
    minDueFils: null,
    card: card && card.last4 ? card : null,
    reference: null,
    // A salary credit is income whose purpose the wording states; marking it
    // a transfer stored it with isTransfer and kept it out of Income entirely.
    transferHint: transfer && classified.category !== 'salary',
    snapshotFils: null,
    snapshotKind: null,
    categoryGuess,
    categoryDeliberate: classified.deliberate,
    raw: (readSource === source ? policySource : source).trim(),
  };
};

/**
 * A sender name some Gulf bank shares with the same institution elsewhere.
 *
 * HSBC sends as "HSBC" in the UAE and in the UK. The router already sees
 * this and reports the sender as overlapping, with a non-Gulf market among
 * the candidates. When that happens on a non-Gulf ledger and the alert's own
 * money is not AED/SAR, the name is not UAE evidence: treating it as one sent
 * a UK customer's GBP salary down the strict Gulf fallback, which refused it.
 * A Gulf-only name (FAB, ADCB) is never overlapping and stays launch evidence.
 */
const sharedSenderOutsideGulf = (
  source: string,
  inspection: UniversalAlertReview | null,
  pinnedCurrency: string | null,
  sender = '',
): boolean => {
  if (!pinnedCurrency || pinnedCurrency === 'AED' || pinnedCurrency === 'SAR' ||
    detectLaunchMarketFromAlert(source, '') !== null) return false;
  if (inspection?.route.decision === 'ambiguous') {
    return inspection.route.candidates.some((candidate) => candidate.market !== 'AE' && candidate.market !== 'SA');
  }
  // Routing never ran (the review gate only knows ~20 ISO codes, so an HKD or
  // THB alert returns no inspection): a worldwide institution's name plus ONE
  // ISO code that is the pinned non-Gulf currency is still not UAE evidence.
  if (inspection !== null || !hasUniversalInstitutionSender(sender)) return false;
  const codes = new Set([...source.matchAll(/(?<![A-Za-z])([A-Z]{3})(?![A-Za-z])/gu)]
    .map((match) => match[1]).filter((code) => currencyMinorUnits(code) !== null));
  return codes.size === 1 && codes.has(pinnedCurrency);
};

/**
 * THE UAE/SAUDI GRAMMAR TRUSTS ITS SENDER. A blank sender (an iPhone History
 * record: iOS 26 Find Messages exposes none) or a phone number, e-mail or
 * generic word is not a bank, and the launch grammar would otherwise book
 * "Dear Customer, AED 5,000.00 has been credited to your account. Click
 * https://enbd-verify.com to confirm" or "+971…: You have received AED
 * 1,500.00 from JOHN via Aani." as income. From such a sender:
 *  - a smishing link call-to-action, a fraud prompt or not-a-new-movement
 *    wording (isNotAutoPostableMoney) never posts;
 *  - a credit must name the person's OWN account or card by its tail
 *    (namesOwnInstrumentTail: never a payer's "from account XXXX9876"; a
 *    field-labelled "To: **1234" counts), or it is not auto-posted: it waits
 *    in Review with its amount (heldLaunchCreditForReview, auto-import.ts).
 * The parser's own card identity is NOT evidence: it reads a payer's
 * "from card 1234" as readily as the reader's.
 * A registered header (a bank's sender ID) keeps the grammar's decision.
 */
/** A blank sender, or a phone number, e-mail or generic word: nobody a bank registered. */
export const isUnaccountableLaunchSender = (sender: string): boolean =>
  !sender.trim() || isUnverifiedAlertSender(sender);
/**
 * The credit the sender-trust rule held back (no own tail, no scam wording),
 * for the refusal path to offer in Review with its amount. Null otherwise.
 */
export const isHeldLaunchCredit = (source: string, sender: string, parsed: ParsedSms | null): boolean =>
  !!parsed && isUnaccountableLaunchSender(sender) && parsed.kind === 'transaction' && parsed.type === 'income' &&
  !isNotAutoPostableMoney(source) && !namesOwnInstrumentTail(source, 'credit');
const launchSenderAnswersFor = (source: string, sender: string, parsed: ParsedSms): boolean => {
  if (sender.trim() && !isUnverifiedAlertSender(sender)) return true;
  if (parsed.kind !== 'transaction') return true;
  if (isNotAutoPostableMoney(source)) return false;
  return parsed.type !== 'income' || namesOwnInstrumentTail(source, 'credit');
};

export interface LaunchAlertSession {
  inspect(source: string, sender: string): UniversalAlertReview | null;
  parse(
    source: string,
    sender: string,
    inspection?: UniversalAlertReview | null,
    forcedMarket?: string,
    observedAt?: number,
  ): ParsedSms | null;
  /**
   * Unproven-format posting ONLY (never the AE/SA launch grammar). For capture
   * channels that were review-only for non-launch senders: the result, when
   * any, carries the `bestEffort` marker; null means Review as before.
   */
  parseUnproven(
    source: string,
    sender: string,
    inspection?: UniversalAlertReview | null,
    observedAt?: number,
  ): ParsedSms | null;
  detectedMarket(): 'AE' | 'SA' | null;
}

/**
 * One ordered capture session's launch-parser policy.
 *
 * Keeping routing, global-issuer refusal and the single Gulf-market lock here
 * lets the phone scanner and the private corpus audit execute exactly the same
 * decision. The session is intentionally stateful: once a corpus establishes
 * UAE or Saudi, a conflicting alert cannot silently switch money systems.
 */
export const createLaunchAlertSession = ({
  overrides,
  regionHint = null,
  pinnedCurrency = pinnedLedgerCurrencyCode(),
  activeMarket = getActiveMarket().id,
  fxLookup = (base, quote, date) => cachedReferenceQuote(base, quote, date),
  bestEffort = { enabled: bestEffortAutoPostEnabled(), country: getActiveCountry() },
}: {
  overrides: Record<string, CategoryId>;
  regionHint?: string | null;
  pinnedCurrency?: string | null;
  activeMarket?: string;
  /** Network-free dated rate lookup; defaults to rates already fetched this session. */
  fxLookup?: ParseFxLookup;
  /** Unproven-format policy inputs; defaults mirror the persisted setting and country. */
  bestEffort?: { enabled: boolean; country: string | null };
}): LaunchAlertSession => {
  const actualPinned = pinnedLedgerCurrencyCode();
  const pinnedExponent = pinnedCurrency
    ? pinnedCurrency === actualPinned
      ? ledgerCurrencyExponent()
      : currencyMinorUnits(pinnedCurrency)
    : null;
  let sessionMarket: 'AE' | 'SA' | null =
    pinnedCurrency === 'AED' ? 'AE' : pinnedCurrency === 'SAR' ? 'SA' : null;
  let detected: 'AE' | 'SA' | null = null;

  const inspect = (source: string, sender: string): UniversalAlertReview | null => {
    if (hasPersonalMessagePrefix(source) || hasNegatedPrincipalMovement(source)) return null;
    if (!REVIEW_MONEY_HINT.test(source)) return null;
    // A launch-tested issuer can quote any foreign transaction currency. Its
    // exact sender evidence already outranks that currency, and the universal
    // result cannot change the launch parser's decision. Avoid walking every
    // worldwide institution grammar for the common UAE/Saudi foreign-card
    // path; unknown and overlapping senders still take the full safe route.
    if (detectLaunchMarketFromSender(sender) && !hasUniversalInstitutionSender(sender)) return null;
    try {
      return inspectUniversalAlert({ source, sender, regionHint });
    } catch {
      return null;
    }
  };

  // Internal evidence adapter for the mature Gulf grammar. It is deliberately
  // not exposed on LaunchAlertSession: callers get one parser (`parse`) in
  // every country. Regional knowledge enriches that one decision instead of
  // becoming a second parser API with different behavior.
  const parseRegionalEvidence = (
    source: string,
    sender: string,
    inspection: UniversalAlertReview | null = null,
    forcedMarket?: string,
    observedAt?: number,
  ): Extract<BankAlertInterpretation, { outcome: 'parsed' }> | null => {
    if (pinnedCurrency && pinnedCurrency !== 'AED' && pinnedCurrency !== 'SAR') return null;
    // Most phone inbox rows are ordinary conversations, OTP-free service
    // notices, delivery updates, etc. On an AED/SAR ledger the old path still
    // ran the full launch-bank grammar over every one of them because the
    // active market supplied a default even when the message carried no money
    // or banking evidence. During a 10k-message history import that is a large
    // amount of pure CPU work. Fail fast only when BOTH broad evidence gates
    // are absent. Known launch/global institution senders remain eligible via
    // hasGenericBankAlertContext even when an unusual template omits currency.
    const moneyHint = hasBankAlertMoneyHint(source);
    // Automatic ledger rows always need an explicit monetary value. Sender
    // identity alone is enough for Review routing, but it cannot manufacture an
    // amount. In the 30k corpus 1,981 regional-interpreter calls had no money
    // evidence and not one produced a parsed row, so keep them out of the hot
    // auto-parse path and let the refusal/review seam handle them.
    if (!moneyHint) return null;
    if (
      inspection?.route.decision === 'single' &&
      inspection.route.market !== 'AE' &&
      inspection.route.market !== 'SA'
    ) return null;
    const routed = forcedMarket === 'AE' || forcedMarket === 'SA'
      ? forcedMarket
      : inspection?.route.decision === 'single' &&
          (inspection.route.market === 'AE' || inspection.route.market === 'SA')
        ? inspection.route.market
        : detectLaunchMarketFromAlert(source, sender);
    if (moneyHint && !routed) return null;
    const desired = routed ?? sessionMarket ?? activeMarket;
    if (desired !== 'AE' && desired !== 'SA') return null;
    if (sessionMarket && desired !== sessionMarket) return null;
    const interpretation = interpretBankAlert({
      source,
      sender,
      market: desired,
      overrides,
      observedAt,
    });
    const result = interpretation.outcome === 'parsed' ? interpretation : null;
    if (result && routed) {
      sessionMarket ??= routed;
      detected = routed;
    }
    return result;
  };

  const parse = (
    source: string,
    sender: string,
    inspection: UniversalAlertReview | null = null,
    forcedMarket?: string,
    observedAt?: number,
  ): ParsedSms | null => {
    if (hasPersonalMessagePrefix(source) || hasNegatedPrincipalMovement(source)) return null;
    // A BNPL provider's restatement of a bank card charge (see
    // bnpl-providers.ts). The regional path already refuses it; the
    // worldwide fallback below must not resurrect it on an unpinned ledger.
    if (isBnplProviderSource(sender)) return null;
    const local = parseRegionalEvidence(source, sender, inspection, forcedMarket, observedAt)?.parsed ?? null;
    if (local) return launchSenderAnswersFor(source, sender, local) ? local : null;
    // The worldwide parser is intentionally broader and therefore more
    // expensive. Ordinary conversations, delivery updates and generic service
    // SMS must not pay that cost after the launch parser already failed fast.
    // Money evidence OR bank-alert context is sufficient to preserve the
    // bank-agnostic universal seam for unknown institutions and countries.
    // Same rule for the worldwide parser: without explicit money it cannot
    // create a valid ledger row. Bank context is still consumed by the review
    // pipeline after this function returns null. The person's own country
    // may supply money a bare "R" or a currency-less UPI alert states.
    if (!hasBankAlertMoneyHint(source) && !countryMoneyHint(source, bestEffort.country) &&
      !matchLatamTemplate(source, { sender })) return null;
    if (!shouldTryUniversalPosting(source, sender)) return null;
    /**
     * ONE PUBLIC PARSER, WITH A MATURE LOCAL EVIDENCE PACK.
     *
     * On AED/SAR ledgers the AE/SA deterministic grammar has years of
     * high-specificity bank/biller/statement knowledge. If that pack refuses a
     * message, the broader worldwide grammar may still inspect it for Review,
     * but it must not silently resurrect the same message as a brand-new
     * posting. The 30k UAE corpus proved why: doing so recovered 197 rows but
     * introduced 139 high-confidence non-posting false positives, dominated by
     * temporary holds and promotions.
     *
     * This is not a second user-facing parser. LaunchAlertSession.parse remains
     * the single production entry point. The AE/SA pack is simply stronger
     * evidence inside that parser. A positively routed non-Gulf institution is
     * still allowed to use universal posting even when the user's current
     * device/region is Gulf.
     */
    const universalRouteIsNonGulf =
      inspection?.route.decision === 'single' &&
      inspection.route.market !== 'AE' &&
      inspection.route.market !== 'SA';
    const gulfLedger = pinnedCurrency === 'AED' || pinnedCurrency === 'SAR';
    // See sharedSenderOutsideGulf: a multinational sender name is not UAE
    // evidence for a non-Gulf alert on a non-Gulf ledger.
    const namedLaunchMarket = detectLaunchMarketFromSender(sender);
    const launchSenderMarket = namedLaunchMarket &&
      !sharedSenderOutsideGulf(source, inspection, pinnedCurrency, sender) ? namedLaunchMarket : null;
    // A single ordered capture/history session cannot change Gulf markets
    // through the broad universal fallback after regional evidence already
    // locked it. Without this guard, 50 UAE messages could establish AE and a
    // later Saudi sender could bypass that lock only because the mature Saudi
    // adapter correctly refused to switch sessionMarket.
    if (sessionMarket && launchSenderMarket && launchSenderMarket !== sessionMarket) return null;
    if (gulfLedger && (launchSenderMarket === 'AE' || launchSenderMarket === 'SA')) return null;
    if (gulfLedger && !universalRouteIsNonGulf) return null;
    const routedMarket = inspection?.route.decision === 'single' ? inspection.route.market : null;
    // UAE/Saudi evidence (sender or route) is never an "unverified format":
    // keep the strict, unmarked seam that shipped before, independent of the
    // best-effort setting.
    if (launchSenderMarket === 'AE' || launchSenderMarket === 'SA' ||
      routedMarket === 'AE' || routedMarket === 'SA') {
      return parseUniversalLaunchStrict(source, sender, pinnedCurrency, pinnedExponent, fxLookup, observedAt,
        overrides, launchSenderMarket ?? routedMarket);
    }
    return parseUniversalPostedEvent(source, sender, pinnedCurrency, pinnedExponent, fxLookup, observedAt, {
      enabled: bestEffort.enabled,
      country: bestEffort.country,
      routedMarket,
      launchSenderMarket: null,
      overrides,
      institution: routedInstitution(inspection),
      inspection,
    });
  };

  const parseUnproven = (
    source: string,
    sender: string,
    inspection: UniversalAlertReview | null = null,
    observedAt?: number,
  ): ParsedSms | null => {
    if (hasPersonalMessagePrefix(source) || hasNegatedPrincipalMovement(source)) return null;
    if (!bestEffort.enabled) return null;
    // Same rule as parse(): an SMS from a BNPL provider's sender ID reaches
    // this path (it is no launch-bank sender) and must not post as an
    // "unverified format" either.
    if (isBnplProviderSource(sender)) return null;
    // Nu Colombia's transfer-in prints a bare amount; only its exact template
    // (with Nu Colombia identity) makes that money.
    if (!hasBankAlertMoneyHint(source) && !countryMoneyHint(source, bestEffort.country) &&
      !matchLatamTemplate(source, { sender })) return null;
    if (!shouldTryUniversalPosting(source, sender)) return null;
    const routedMarket = inspection?.route.decision === 'single' ? inspection.route.market : null;
    // Same rule as parse(): see sharedSenderOutsideGulf.
    const namedLaunchMarket = detectLaunchMarketFromSender(sender);
    const launchSenderMarket = namedLaunchMarket &&
      !sharedSenderOutsideGulf(source, inspection, pinnedCurrency, sender) ? namedLaunchMarket : null;
    // AE/SA formats are PROVEN: when the mature grammar refused one, or the
    // alert is routed there, that refusal is the evidence. Never best-effort.
    if (launchSenderMarket || routedMarket === 'AE' || routedMarket === 'SA') return null;
    const gulfLedger = pinnedCurrency === 'AED' || pinnedCurrency === 'SAR';
    if (gulfLedger && routedMarket === null) return null;
    // A best-effort row must never make an import batch mixed-currency.
    if (!pinnedCurrency) return null;
    return parseUniversalPostedEvent(source, sender, pinnedCurrency, pinnedExponent, fxLookup, observedAt, {
      enabled: bestEffort.enabled,
      country: bestEffort.country,
      routedMarket,
      launchSenderMarket,
      overrides,
      institution: routedInstitution(inspection),
      inspection,
    });
  };

  return { inspect, parse, parseUnproven, detectedMarket: () => detected };
};

/**
 * Manual paste uses the same money and semantic policy as capture. Pasted
 * text supplies no authenticated sender: body mentions may route an alert,
 * but never manufacture the issuer evidence needed for global review.
 * Retain the batch parser's bilingual-restatement deduplication.
 */
export const parsePastedBankAlerts = (
  text: string,
  overrides: Record<string, CategoryId>,
  onRefused?: (source: string) => void,
): ParsedSms[] => {
  const session = createLaunchAlertSession({ overrides });
  return parseSmsBatch(text, overrides, (source) => {
    // Paste has no authenticated issuer. Keep the mature AED/SAR deterministic
    // path automatic, but do not turn a structurally valid worldwide amount
    // into unattended money with no sender evidence. Refused global blocks are
    // handed to the caller's Review flow instead.
    const launchMarket = detectLaunchMarketFromAlert(source, '');
    const parsed = launchMarket
      ? session.parse(source, '', session.inspect(source, ''), launchMarket)
      : null;
    if (!parsed) onRefused?.(source);
    return parsed;
  });
};
