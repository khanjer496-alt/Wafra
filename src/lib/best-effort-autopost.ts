import { currencyMinorUnits } from '@/lib/currency-metadata';
import { withPlainSpaces } from '@/lib/alert-status-lexicon';
import { isUnboundAndroidSourceKey, isUsableCaptureSourceIdentity } from '@/lib/capture-source-identity';
import type { FxQuote } from '@/lib/fx';
import { convertForeignConfirmation, quoteFitsDay, type ReferenceConversion } from '@/lib/fx-rates';
import { nonPostingReason } from '@/lib/sms-parser';
import type { BestEffortMarker, CaptureInstrument } from '@/lib/types';
import type { UniversalBankEvent, UniversalMoney } from '@/lib/universal-types';

/**
 * BEST-EFFORT AUTOMATIC POSTING FOR UNPROVEN BANK-ALERT FORMATS.
 *
 * Only the UAE and Saudi launch grammars (years of real-alert fixtures) and
 * the certified worldwide templates are PROVEN formats. Every other country
 * and message format is unproven: its grammar is either synthetic or the
 * bank-agnostic universal parser. By explicit product decision such an alert
 * may still be added automatically, but ONLY when this one policy says the
 * message proves a single completed money movement on its own. The row is
 * then marked (`bestEffort`) so the person can confirm, edit or undo it.
 *
 * Everything this function refuses goes to Review exactly as before. It never
 * widens the AE/SA launch parser or a certified template: callers must use it
 * only after those proven paths declined, and never for an alert routed to a
 * launch market (the mature parser's refusal there is deliberate evidence).
 *
 * Guardrails, all required:
 *  - the setting "Auto-add alerts from unverified bank formats" is on;
 *  - the universal parser reads status `posted` (never pending, future,
 *    failed, informational) and no wording in the text says otherwise
 *    (pending/hold/authorisation, request, declined/failed, reversed/
 *    cancelled, OTP/verification, fraud check/unusual attempt/restriction,
 *    initiated refund/bank-details ask, promotion, statement/bill/due,
 *    scheduled), including lure wording (money owed or waiting to be
 *    released, apply/register now, shop order notices, dispute desks);
 *  - from a phone number of 7+ digits, an e-mail address, a generic header
 *    ("INFO") or a BLANK sender (iOS History, pasted text), a credit (or a
 *    debit whose only hook is "Not you? call") must name one of the reader's
 *    own accounts or cards by its tail, or match an exact certified bank
 *    template when the sender is blank (unverifiedMoneyClaim);
 *  - a supported money-movement family whose direction matches its wording
 *    (purchases/fees/withdrawals/utilities/recurring are debits, refunds are
 *    credits, transfers must say which way) with no direction issue;
 *  - exactly one principal amount: no unresolved role, no second competing
 *    transaction figure (a balance or limit is role-separated and allowed);
 *  - an explicit currency: an ISO code or a symbol the parser proved, or a
 *    shared symbol (`$`, `¥`, `Rs`) resolved ONLY through the user's own
 *    country's currency — a `$` alert for a user in Germany stays in Review;
 *  - a transaction date that is not in the future;
 *  - foreign money converts with a dated rate already on the device (or the
 *    card's own charged figure); without one the alert waits in Review.
 * Duplicate protection is not repeated here: posted rows still pass the
 * import planner's duplicate guard and Wallet near-match holding.
 */

export type BestEffortRefusal =
  | 'disabled'
  | 'launch-market'
  | 'not-posted'
  | 'non-posting-wording'
  | 'unverified-sender'
  | 'unsupported-family'
  | 'direction-unclear'
  | 'amount-unclear'
  | 'competing-amounts'
  | 'currency-unclear'
  | 'future-dated'
  | 'ledger-currency-unknown'
  | 'fx-rate-unavailable'
  | 'invalid-money';

export type BestEffortDecision =
  | {
      outcome: 'post';
      /** Ledger-currency minor units (converted when the alert was foreign). */
      amountFils: number;
      /** Currency of amountFils: the ledger's, or the alert's own when unpinned. */
      currency: string;
      /** The alert's own money, after any country-resolved symbol. */
      original: UniversalMoney;
      /** Present only when foreign money was converted. */
      conversion: ReferenceConversion | null;
      /** Explicit date the alert states, never inferred. */
      date: string | null;
      marker: BestEffortMarker;
    }
  | { outcome: 'review'; reason: BestEffortRefusal };

export interface BestEffortInput {
  source: string;
  event: UniversalBankEvent;
  /** The persisted setting; OFF restores review-first for unproven formats. */
  enabled: boolean;
  /** The user's ISO country (country.ts); resolves shared currency symbols only. */
  country: string | null;
  /** Market the router proved for this alert, when single. */
  routedMarket: string | null;
  /** Launch market proven by the sender, if any. */
  launchSenderMarket?: string | null;
  /**
   * The market whose institution the capture's own sender ID identifies (never
   * a bank named in the text); null when the sender proves none. When a
   * capture seam supplies this field, only it may say whose money a bare
   * "دينار" is; see resolvePrincipalMoney. Omitted (a caller with no capture
   * identity), the person's country resolves the word as before.
   */
  senderMarket?: string | null;
  /** Ledger currency and exponent; null means not pinned yet. */
  ledgerCurrency: string | null;
  ledgerExponent: number | null;
  /** When the alert was observed (epoch ms), for future-date and rate-day checks. */
  observedAt?: number;
  /** Network-free dated rate lookup (rates already on this device). */
  fxLookup?: (base: string, quote: string, date: string) => FxQuote | null;
  /**
   * The capture's sender ID, when known: decides whether a link may stand,
   * whether a money claim is unverified, and whether a promo footer may stand aside.
   */
  sender?: string;
  /**
   * The text matched an exact certified bank template (latam-alert-templates).
   * With a blank sender the template stands in for it; a phone number,
   * e-mail or generic sender is still an unverified money claim.
   */
  exactTemplate?: boolean;
  /** Code-owned format prefix: 'universal' or 'semantic'. Never source text. */
  formatPrefix?: 'universal' | 'semantic' | 'ai';
}

/**
 * Official currency of countries whose currency shares a symbol with others.
 * Only these are needed: an unshared symbol (€, £, ₹, R$) is already proven
 * by the parser. Deliberately small and explicit; absent = no resolution.
 */
const SHARED_SYMBOL_COUNTRY_CURRENCY: Readonly<Record<string, string>> = {
  // `$`
  US: 'USD', PR: 'USD', GU: 'USD', VI: 'USD', AS: 'USD', MP: 'USD', EC: 'USD', SV: 'USD',
  CA: 'CAD', AU: 'AUD', NZ: 'NZD', SG: 'SGD', HK: 'HKD', MX: 'MXN', AR: 'ARS', CL: 'CLP', CO: 'COP',
  // `¥`
  JP: 'JPY', CN: 'CNY',
  // `Rs`
  IN: 'INR', PK: 'PKR', LK: 'LKR', NP: 'NPR', MU: 'MUR', SC: 'SCR',
  EG: 'EGP', SD: 'SDG', SS: 'SSP',
  // `kr`
  SE: 'SEK', DK: 'DKK', FO: 'DKK', GL: 'DKK', NO: 'NOK', IS: 'ISK',
  // `دينار` (dinar): the Arabic word alone names no one country's money.
  JO: 'JOD', IQ: 'IQD', KW: 'KWD', BH: 'BHD', LY: 'LYD', TN: 'TND', DZ: 'DZD',
};

/** Exposed for tests and the settings copy; never a general country→currency map. */
export const sharedSymbolCurrencyForCountry = (country: string | null | undefined): string | null =>
  (country && SHARED_SYMBOL_COUNTRY_CURRENCY[country.toUpperCase()]) || null;

/** Countries whose own banking writes a three-decimal currency with a dot decimal point. */
const THREE_DECIMAL_COUNTRY_CURRENCY: Readonly<Record<string, string>> = {
  KW: 'KWD', BH: 'BHD', OM: 'OMR', JO: 'JOD',
};

const LAUNCH_MARKETS = new Set(['AE', 'SA']);
/**
 * The Nordic languages an alert is written in, from words and letters only
 * one of them uses: Swedish ä/ö words, "från", "fått", "dragits"; Danish
 * "dit", "køb", "beløb", "hævet", "sendt dig"; Norwegian "deg", "kjøp",
 * "beløp", "mottatt", "kortet ditt"; Danish/Norwegian "betalt" (Swedish
 * "betalat"). Words the two share decide nothing between them.
 */
const NORDIC_MARKERS: readonly ['SE' | 'DK' | 'NO' | 'DKNO', RegExp][] = [
  // Danish and Norwegian share "betalt"; Swedish writes "betalat".
  // (Read in any case: an all-capitals "DU HAR FÅTT … FRÅN" is still Swedish.)
  ['DKNO', /(?<![\p{L}\p{N}])(?:betalt|handlet|handlede|\p{L}*[æøÆØ]\p{L}*)(?![\p{L}\p{N}])/iu],
  ['SE', /(?<![\p{L}\p{N}])(?:\p{L}*[äöÄÖ]\p{L}*|från|fått|dragits|betalat|belopp|debiterats|skickat)(?![\p{L}\p{N}])/iu],
  ['DK', /(?<![\p{L}\p{N}])(?:dit|købt?|købet|beløb|hævet|modtaget|opkrævet|gennemført|kender|sendt\s+dig|af)(?![\p{L}\p{N}])/iu],
  ['NO', /(?<![\p{L}\p{N}])(?:deg|kjøp(?:et)?|beløp|mottatt|gjennomført|kjenner|kortet\s+ditt)(?![\p{L}\p{N}])/iu],
];
const nordicAlertLanguages = (text: string): ('SE' | 'DK' | 'NO' | 'DKNO')[] =>
  NORDIC_MARKERS.filter(([, marker]) => marker.test(text)).map(([market]) => market);
const NORDIC_KRONE_MARKET: Readonly<Record<string, 'SE' | 'DK' | 'NO'>> = { SEK: 'SE', DKK: 'DK', NOK: 'NO' };

const POSTABLE_FAMILIES = new Set<UniversalBankEvent['family']>([
  'purchase', 'cash-withdrawal', 'refund', 'fee', 'utility', 'recurring-payment', 'transfer',
]);

const BLOCKING_ISSUES = new Set([
  'amount-role-unresolved',
  'posting-status-unresolved',
  'direction-unresolved',
  'direction-conflict',
  'multiple-event-adapter-required',
  'authentication-not-posting',
  'authentication-or-otp',
  'pending-not-posting',
  'promotion-not-posting',
  'settlement-adapter-required',
  'own-account-move',
  'failed-not-posting',
]);

/**
 * Independent wording guard. The universal parser already classifies status;
 * this second, deliberately broad net refuses anything whose text says the
 * money has not (or not yet, or not really) moved. False refusals only cost a
 * Review tap; a false post costs trust. Covers English plus the first-wave
 * European languages, Portuguese and Arabic.
 */
const NON_COMPLETED_WORDING: readonly RegExp[] = [
  // Korean cancellation/decline/hold/limit/advert words, Chinese/Japanese
  // reversal and pre-authorisation, Polish not-completed and holds, Hindi
  // credited-back and reversal.
  /취소|거절|거부|불가|반려|대기|가승인|실패|한도|캐시백|할인|쿠폰|이벤트|撤销|冲正|取消|预授权|預授權|\bnie\s+zosta|\boczekuje\b|\bblokada\b|वापस|रिवर्स|रद्द/iu,
  // pending / holds / authorisations
  /\bpending\b|\bon\s+hold\b|\bhold\s+(?:placed|of|on|for)\b|\bpre-?auth(?:ori[sz](?:ation|ed))?\b|\bauthori[sz]ation\s+(?:hold|request|only)\b|\bblocked\s+amount\b|\bamount\s+(?:blocked|reserved)\b|\breserved\b|\bprocessing\b|\bin\s+progress\b|\bawaiting\b/iu,
  /\ben\s+attente\b|\bausstehend\b|\bvorgemerkt\b|\breserviert\b|\bpendiente\b|\bretenid[oa]\b|\bin\s+attesa\b|\bin\s+behandeling\b|\bgereserveerd\b|\bpendente\b|\bem\s+processamento\b|معلق|قيد\s+(?:المعالجة|التنفيذ)|محجوز/iu,
  // requests / collect / approval asks
  /\brequest(?:ed|s|ing)?\b|\bcollect\s+request\b|\bapprove\s+(?:this|the)\b|\bconfirm\s+(?:this|the|your)\s+(?:payment|transaction|purchase)\b|\bdemande\b|\banfrage\b|\bsolicitud\b|\brichiesta\b|\bverzoek\b|\bsolicita[çc][aã]o|طلب/iu,
  // declined / failed / unsuccessful
  // "could not be made", "can't be processed" say the same as "failed"; so
  // does each first-wave language's own decline word ("nicht ausgeführt",
  // "non abouti", "denegado", "afgewezen", "falhou", "rejeitado", "negata",
  // "odrzucona", "nekades", "afvist", "avvist", "zamítnuta").
  /\bdeclin(?:e|ed|ing)\b|\bfail(?:ed|ure|s)?\b|\bunsuccessful\b|\bnot\s+(?:been\s+)?(?:processed|completed|successful|approved|authori[sz]ed)\b|(?:\bnot|\bcannot|\bcan['’]t|\bcouldn['’]t|\bwon['’]t)\s+be\s+(?:made|processed|completed)\b|\brejected\b|\binsufficient\b|\brefus(?:[ée]e?|ed)?(?!\p{L})|(?<!\p{L})[ée]chou[ée]|\babgelehnt\b|\bfehlgeschlagen\b|\brechazad[oa]\b|\brifiutat[oa]\b|\bnon\s+riuscit[oa]\b|\bgeweigerd\b|\bmislukt\b|\brecusad[oa]\b|\bnegad[oa]\b|مرفوض|رفض|فشل|لم\s+تتم/iu,
  // The first-wave language decline words named above, Unicode-bounded and
  // lower-case (a capital only at a sentence start): "NEKAD AB" and "NEGATI
  // SRL" are company names, not declines.
  /(?<!\p{L})(?:[Nn]icht\s+(?:ausgeführt|durchgeführt)|[Nn]on\s+abouti(?:e)?|[Dd]enegad[oa]|[Aa]fgewezen|[Ff]alhou|[Rr]ejeitad[oa]|[Nn]egat[oa]|[Oo]drzucon[aey]|[Nn]ekad\p{Ll}*|[Aa]fvist|[Aa]vvist|[Zz]amítnut\p{Ll}*|[Vv]orbehaltlich)(?!\p{L})/u,
  // reversed / cancelled / void
  /\brevers(?:al|ed|e)\b|\bchargeback\b|\bcancel(?:l)?(?:ed|ation)\b|\bvoid(?:ed)?\b|\bannul[ée]|\bstorniert\b|\banulad[oa]\b|\bannullat[oa]\b|\bgeannuleerd\b|\bcancelad[oa]\b|(?<!\p{L})cancel(?:ou|ó|aram|aron)(?!\p{L})|عكس|إلغاء|الغاء|ملغ/iu,
  // OTP / verification / codes
  /\botp\b|\bone[-\s]?time\s+(?:pass(?:word|code)?|code|pin)\b|\bverification\s+code\b|\bsecurity\s+code\b|\bpasscode\b|\bdo\s+not\s+share\b|\bnever\s+share\b|\b2fa\b|\bverify\s+(?:this|the|your)\s+(?:transaction|payment|purchase)\b|\bcode\s+(?:de\s+)?(?:v[ée]rification|s[ée]curit[ée])|\bbest[äa]tigungscode\b|\bc[óo]digo\s+de\s+(?:verificaci[óo]n|seguran[çc]a|verifica[çc][aã]o)\b|\bcodice\s+(?:di\s+)?(?:verifica|sicurezza)\b|رمز\s+(?:التحقق|التفعيل)|كلمة\s+(?:المرور|السر)\s+لمرة/iu,
  // promotions. "Cashback" naming the CARD PRODUCT ("with your BMO CashBack
  // Mastercard ending in 8765") is the instrument, not an offer; an offer of
  // cashback beside it ("earn 5% cashback") or a sign-up bonus is refused.
  /\bcash\s?back\b(?!\s+(?:(?:world|elite|plus|platinum|signature|infinite|preferred)\s+)?(?:mastercard|visa)\b)|\bwhen\s+you\s+sign[\s-]?up\b|\bsign[\s-]?up\s+(?:today|now|bonus)\b|\bdiscount\b|\b\d{1,3}\s?%\s*off\b|\boffers?\b|\bpromo(?:tion|code)?\b|\bvoucher\b|\bcoupon\b|\bwin\b|\bgiveaway\b|\bredeem\b|\bangebot\b|\brabatt\b|\bpromoci[óo]n\b|\bdescuento\b|\bsconto\b|\bkorting\b|\bdesconto\b|\bpromo[çc][aã]o|عرض|تخفيض/iu,
  // statements / bills / dues / reminders / balance-only
  /\bstatement\b|\bminimum\s+(?:amount\s+)?(?:due|payment)\b|\btotal\s+(?:amount\s+)?due\b|\bamount\s+due\b|\bdue\s+(?:date|on|by)\b|\bpayment\s+due\b|\bbill\s+(?:is\s+)?(?:due|generated|ready)\b|\breminder\b|\boverdue\b|\brelev[ée](?!\p{L})|\bkontoauszug\b|\bextracto\b|\bestratto\s+conto\b|\brekeningoverzicht\b|\bfatura\s+(?:fechada|vence)\b|كشف\s+(?:ال)?حساب|مستحق|تذكير|الحد\s+الأدنى/iu,
  // fraud checks and unconfirmed authorisations: the bank is asking, holding
  // or investigating, not reporting a completed charge ("is under review",
  // "after an unusual … purchase attempt", "We need to confirm a … purchase",
  // "checking recent activity", "Restrictions were placed on card …")
  /\bunder\s+review\b|\bunusual\b|\bsuspicious\s+(?:activity|transaction|purchase|attempt|login)\s+(?:was\s+|has\s+been\s+)?(?:detected|noticed|flagged|identified)\b|\b(?:detected|noticed|flagged)\s+(?:a\s+|some\s+)?suspicious\b|\battempt(?:ed|s)?\b|\bneed\s+to\s+(?:confirm|verify)\b|\bchecking\s+(?:(?:recent|some|your)\s+)*(?:activity|transactions?|purchases?)\b|\brestrictions?\s+(?:(?:was|were|has|have)\s+(?:been\s+)?)?(?:placed|applied|added)\b|\b(?:card|account)\s+(?:(?:has|have)\s+been\s+|is\s+(?:now\s+)?|was\s+)?(?:temporarily\s+)?(?:blocked|frozen|suspended|locked|restricted)\b|\bwas\s+(?:this|that|it)\s+(?:transaction\s+)?(?:you|yours)\b|\breply\s+(?:with\s+)?["']?(?:yes|y)["']?\s+(?:or|if)\b/iu,
  // initiated (not completed) refunds and phishing-style "update your bank
  // details to receive your refund" asks
  /\brefund\s+(?:has\s+been\s+|is\s+|was\s+)?initiated\b|\brefund\b[^.\n]{0,48}?\b(?:has\s+been|is|was)\s+initiated\b|\b(?:should|will)\s+reflect\s+(?:in|within)\s+\d|\binitiated\s+(?:a\s+|your\s+)?refund\b|\bupdate\s+(?:your\s+)?(?:bank|account|kyc|card|pan)\s+(?:details|information|info)\b|\bto\s+receive\s+(?:your|the)\s+refund\b/iu,
  // fraud questions: the bank (or a fraudster posing as one) is asking
  // whether the customer made it, which is not a report that it posted
  /\bdid\s+(?:you|u)\s+(?:make|authori[sz]e|initiate|attempt|do)\b|\bwas\s+(?:this|that|it)\s+(?:made\s+by\s+)?(?:you|yours)\b|\breply\s+(?:with\s+)?["']?(?:yes|y)["']?\s*(?:\/|or|,)\s*["']?(?:no|n)["']?\b|\b(?:respond|reply|text)\s+(?:with\s+)?["']?(?:yes|y)["']?(?=[\s.,;!]|$)|\bverify\s+(?:this|the)\s+(?:transaction|purchase|payment|charge|activity)\b|\bverify\s+(?:your\s+)?account\s+activity\b|\bif\s+(?:this\s+(?:transaction\s+)?was\s+|it\s+was\s+)?not\s+(?:made\s+by\s+|done\s+by\s+|initiated\s+by\s+)?you\b[^.\n]{0,60}?\b(?:click|tap|visit|follow|open)\b|\bif\s+(?:you\s+)?did\s+not\s+(?:make|authori[sz]e|authenticate|initiate)\b[^.\n]{0,60}?\b(?:click|tap|visit|follow|open|check\s+here)\b|\bverifique\b|\bsi\s+no\s+(?:reconoce|ha\s+sido\s+usted)\b/iu,
  // lures: refund/grant/prize bait asking the reader to act ("You will
  // receive a tax refund of $573.00 ... confirm your information")
  /\bclaim\b|\bcongrat(?:s|ulations?)\b|\byou\s+(?:have\s+|'ve\s+)?won\b|\byou\s+will\s+receive\b|\bcan\s+be\s+credited\b|\beligible\s+for\b|\bconfirm\s+(?:your\s+)?(?:information|info|details|identity)\b|\bupdate\s+(?:your\s+)?(?:details|kyc|information|info)\b|\bkyc\b|\b(?:click|tap)\s+(?:here|below|on\s+(?:the|this)\s+link|(?:the|this)\s+link)\b|\bverify\s+your\s+(?:account|identity|details)\b|\b(?:you|card|account)\s+(?:\(?do\s+not\)?\s+)?(?:has|have)\s+(?:an?\s+)?(?:outstanding\s+)?(?:tax\s+)?refund\s+of\b|\breply\s+with\s+your\s+(?:bank|account|card|details)\b|\buse\s+code\b/iu,
  // activation / verification / PIN code messages quote an amount they are
  // authorising, never one that moved
  // (any case: "Savings a/c ACTIVATION CODE is: 434165"); OTP and PIN stay
  // upper-case only so the words "pin" and "otp" in prose are not codes.
  /\bactivation\s+code\b|\bverification\s+code\b|\bauth(?:entication|ori[sz]ation)\s+code\b|\bshare\s+(?:this|the)\s+code\b/iu,
  /\bOTP\b|\bPIN\b/u,
  // offers phrased as an amount off a future purchase
  /\bflash\s+sale\b|\boff\s+(?:your|on\s+(?:your|the|all))\s+(?:next\s+|first\s+)?(?:purchase|order|bill|booking|ride|meal|trip)s?\b/iu,
  // Money that did not, or may not, have moved, and notices that only look
  // like one: "Nothing was charged to your card … for the $77.75 order",
  // "might have been charged", "It looks like $147.52 may have been spent",
  // "… was used for $67.00 at X or was it not
  // you?", "You received $65.00 via Zelle. Enroll to receive it", "You have
  // received a new bill from X for $3,255.51, due Nov 8", "Sample alert. You
  // made a $18.14 purchase".
  /\bnothing\s+(?:was|has\s+been)\s+(?:charged|debited|taken|deducted|paid)\b|\bno\s+(?:charge|money|payment)\s+(?:was|has\s+been)\s+(?:made|taken|charged)\b|\b(?:it\s+)?(?:looks|seems)\s+(?:like|as\s+if)\b(?:[^.\n]|\.(?=\S)){0,60}?\b(?:spent|charged|paid|debited|used|withdrawn|sent)\b|\bwas\s+(?:this|that|it)\s+not\s+(?:you|yours)\b|\b(?:enrol(?:l)?|register|sign\s+up)\s+(?:now\s+)?to\s+(?:receive|claim|accept|get|collect)\s+(?:it|them|this|the\s+(?:money|payment|funds|transfer|amount)|your\s+(?:money|payment|funds|transfer))\b|\breceived\s+(?:a\s+|an\s+)?(?:new\s+)?(?:e-?bill|bill|invoice)\b(?!\s+payments?)|,\s*due\s+(?:on\s+)?(?:\d{1,2}[\/.-]|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d|tomorrow|today)|^\s*(?:sample|example|test|demo)\s+(?:alert|message|notification|sms)\b/iu,
  // First-wave decline words, in prose case only: an upper-case descriptor
  // ("NEKAD AB", "NEGATI SRL") is a merchant name, not a decline. Also a
  // hedged principal beside its money ("$147.52 may have been spent",
  // "might have been charged QR 40.00"), case-sensitive so a currency code
  // is upper case and "You may have been charged a fee" stays a footer.
  /\b[Nn]icht\s+(?:ausgeführt|durchgeführt)|(?<!\p{L})(?:[Nn]on\s+aboutie?|[Dd]enegad[oa]|[Aa]fgewezen|[Ff]alhou|[Rr]ejeitad[oa]|[Nn]egat[oaie]|[Oo]drzucon[aeyo]?|[Nn]eka(?:d|des|t)|[Aa]fvist|[Aa]vvist|[Zz]amítnut[aáéoý]?)(?!\p{L})|(?:[$€£₹]\s?\d[\d.,]*|\d[\d.,]*\s?(?:[A-Z]{2,3}\b|[$€£₹])|\b[A-Z]{2,3}\s?\d[\d.,]*)\s+(?:might|may|could)\s+(?:have\s+)?been\s+(?:charged|debited|deducted|paid|taken|spent|used|withdrawn|sent|transferred)\b|\b(?:[Mm]ight|[Mm]ay|[Cc]ould)\s+(?:have\s+)?been\s+(?:charged|debited|deducted|paid|taken)\s+(?:[$€£₹]\s?\d|\d|[A-Z]{2,3}\s?\d)/u,
  // An alert SETTING, not a movement: "If you make a purchase over 126.67 USD
  // at CHEVRON 0091, we will send you an alert", "إذا قمت بعملية شراء بأكثر من
  // … فسنرسل لك تنبيهاً". Present tense only: the footer "If you made this
  // purchase, no action is needed" on a real charge is untouched.
  // The clause must hold the money ("over 126.67 USD"): "If you pay your
  // full balance each month, you'll avoid interest" is advice, not a setting.
  /\b(?:if|when|whenever|once)\s+(?:you\s+)?(?:make|spend|pay|use|withdraw|send|transfer|receive|buy)\b(?:[^.\n]|\.(?=\S)){0,80}?(?:[$€£₹]\s?\d|\d[\d.,]*\s?(?:[A-Z]{2,3}\b|[$€£₹])|\b[A-Z]{2,3}\s?\d)(?:[^.\n]|\.(?=\S)){0,80}?\b(?:we(?:['’]ll|\s+will)|you(?:['’]ll|\s+will)|(?:an?\s+)?(?:alert|notification|text|sms)\s+will)\b|(?:إذا|اذا|عند|عندما)\s+(?:قمت|تمت|أجريت|اجريت)(?:[^.\n]|\.(?=\S)){0,80}?\d(?:[^.\n]|\.(?=\S)){0,80}?(?:فسنرسل|سنرسل|فسوف|ستتلقى|ستصلك)/iu,
  // future / scheduled / mandates
  /\bwill\s+(?:be|have\s+been)\s+(?:debited|charged|deducted|paid|processed|collected|credited|received)\b|\bscheduled\b|\bupcoming\b|\bstanding\s+(?:instruction|order)\b|\bmandate\b(?<!\b(?:has\s+been|was)\s+debited\b(?:[^.\n]|\.(?=\S)){0,120}?\bas\s+per\s+(?:your\s+|the\s+)?(?:e-)?mandate)|\bpre-?debit\b|\bauto-?pay\s+(?:set|scheduled|registered)\b|\b(?:sera|seront)\s+(?:d[ée]bit[ée]e?s?|pr[ée]lev[ée]e?s?)|\bvont\s+(?:[êe]tre\s+)?(?:d[ée]bit|pr[ée]lev)|\bnon\s+(?:d[ée]bit[ée]|pr[ée]lev[ée])|\b(?:wird|werden)\s+(?:\S+\s+){0,2}?(?:abgebucht|belastet)\b|\bser[áa]\s+(?:cargad[oa]|debitad[oa])\b|\bsar[àa]\s+addebitat[oa]\b|\bwordt\s+afgeschreven\b|سيتم/iu,
  // A sentence after a debit that takes it back, stops it or leaves it open
  // (Gulf-neighbour review): cancelled/unsuccessful/incomplete, card
  // suspended, the amount returned, awaiting confirmation, under review, a
  // share-the-code footer; "to be debited", "blocked", a raised dispute.
  // "If you did not make this transaction, call us" is a security footer on
  // genuine completed alerts and is deliberately NOT here.
  /ألغيت|أُلغيت|لم\s+تنجح|غير\s+ناجحة?|غير\s+مكتملة?|(?:تعليق|إيقاف|ايقاف)\s+(?:ال)?بطاق|(?:استرجاع|استرداد|إرجاع|ارجاع|إعادة|اعادة)\s+المبلغ|بانتظار|قيد\s+المراجعة|لا\s+تشارك|\bamount\s+(?:has\s+been\s+|was\s+)?(?:refunded|returned)\b|\bto\s+be\s+(?:debited|charged|deducted|collected)\b|\bblocked\b|\bdispute\s+(?:raised|registered|logged|lodged|opened|filed|initiated)\b|\bdisputed\b/iu,
  // Money that is owed, waiting or promised rather than moved (reported
  // smishing, round 7): "you're due a tax refund", "we owe you a refund",
  // "we have to refund you", "I will refund you", "entitled to",
  // "ready for disbursement", "refund payment link", "use the payment link
  // to receive", "eligible to get", "due to receive"; the "sent to you by
  // mistake, kindly send it back" reversal scam.
  /\byou(?:'re|\s+are)\s+due\s+(?:a|an|your)\b|\bwe\s+owe\s+you\b|\b(?:have|need)\s+to\s+refund\s+you\b|\b(?:i|we)\s+will\s+(?:refund|repay|return)\b|\bentitled\s+to\b|\bready\s+for\s+disbursement\b|\brefund\s+(?:payment\s+)?link\b|\b(?:click|tap|use|open|pay\s+(?:via|through|using|with))\s+(?:on\s+)?(?:the|this|our|a)\s+(?:payment\s+)?link\b|\bpayment\s*link\s+to\s+(?:receive|claim|get|collect|deposit|accept)\b|\beligible\s+to\s+(?:get|receive|claim)\b|\bdue\s+to\s+receive\b|\bsend\s+(?:it|the\s+(?:money|amount|funds))?\s*back\b|\bby\s+mistake\b|\b(?:sent|credited|transferred|deposited)\s+(?:to\s+(?:you|your\s+\w+)\s+)?in\s+error\b|\bwas\s+a\s+mistake\b|\bwrongly\s+(?:sent|credited|transferred)\b/iu,
  // The reader must act before the money is theirs: "to deposit the funds",
  // "to receive the amount", "download and withdraw it now", "collect your
  // refund", "follow the steps", "complete the form", "submit a refund
  // application", "provide your account details". A completed alert reports;
  // it never asks for a step to release the money.
  // "Accept within 24 hours" and "contact our agent to release" are the same
  // ask.
  /\b(?:to|and)\s+(?:deposit|accept|collect|release|receive|withdraw)\s+(?:your\s+|the\s+|this\s+)?(?:funds?|money|refund|payment|amount|deposit|cash)\b|\baccept\s+(?:it\s+|them\s+|the\s+(?:money|payment|funds|transfer)\s+)?(?:within|by|before)\b|\bto\s+release\b(?!\s+(?:date|notes?)\b)|\bwithdraw\s+it\s+now\b|\b(?:get|collect|claim)\s+your\s+(?:\S+\s+){0,2}refund\b|\bfollow\s+the\s+steps\b|\bcomplete\s+(?:your|the|this|a)\s+(?:\w+\s+){0,2}(?:form|return|application|verification|registration)\b|\bsubmit\s+(?:a|an|your|the)\s+(?:\w+\s+)?(?:application|form|claim)\b|\bprovide\s+(?:us\s+)?(?:with\s+)?your\s+(?:full\s+name|account|bank|card)\b/iu,
  // A charge the sender still holds open or wants confirmed: "we have noticed
  // a purchase", "please confirm the following", "to confirm please call",
  // "you can view or cancel this payment"; a dormant account to activate.
  /\bnoticed\s+(?:a|an|the|some)\s+(?:\w+\s+)?(?:purchase|transaction|charge|payment|debit)\b|\bconfirm\s+(?:the\s+)?following\b|\bto\s+confirm,?\s+(?:please\s+)?(?:call|reply|click|visit)\b|\bcancel\s+(?:this|the)\s+(?:payment|transaction|transfer|order)\b|\bdormant\b|\bto\s+activate\s+(?:your|the|this)\s+(?:\w+\s+){0,2}(?:account|card)\b/iu,
  // Future collection: the shop's "amount to be paid / when it ships" is not
  // money that moved (the shop-notice words are in PROMO_AND_SHOP_WORDING).
  /\b(?:will|wil|wl)\s+be\s+(?:refunded|deposited)\b|\b(?:to|must)\s+be\s+paid\b|\bwhen\s+it\s+ships\b/iu,
  // Still to happen, in SMS shorthand or the French subjunctive: a cheque in
  // clearing that "wl be paid if in order", "click to pay", a refund
  // waiting "to deposit", an amount that "soit
  // débité" unless the reader updates their identity.
  /\b(?:wl|wil)\s+be\s+(?:paid|debited|credited|charged)\b|\b(?:click|tap)\s+to\s+pay\b|\bto\s+deposit\b|\bsoit\s+(?:d[ée]bit[ée]|pr[ée]lev[ée])|\bmettre\s+[àa]\s+jour\s+vos?\b/iu,
  // A security question that sends the reader to a link: "If this trx.
  // wasn't done by you, click ...".
  /\b(?:wasn'?t|was\s+not)\s+(?:done|made|initiated)\s+by\s+you\b[^\n]{0,30}?\b(?:click|tap|visit)\b/iu,
];

/**
 * A fake order charge: a shop order number beside a callback or dispute hook
 * ("charged $349 for a recliner, order id AMZ1649. If you DO NOT, contact
 * us"). A wallet payment with an order ID and no hook ("Paid Rs.120 to GREEN
 * GROCERS. Order ID ...") is untouched.
 */
const ORDER_REFERENCE = /\border[\s-]*(?:id|#|no\b\.?|number)/iu;
const ORDER_CALLBACK_HOOK =
  /\b(?:not\s+you|not\s+(?:done|made)\s+by\s+you|wasn'?t\s+you|if\s+(?:you\s+)?(?:did|do)\s+not|if\s+(?:it|this)\s+(?:was|is)\s+not|dispute|helpline|ring\s+us|call\s+(?:us|immediately|now))\b/iu;
/**
 * "If any dispute, please report on <phone>": a dispute desk offered for a
 * charge, not a bank's security footer. "Call 1800... for dispute" IS a real
 * FASTag footer and is deliberately not matched.
 */
const DISPUTE_DESK = /\bif\s+any\s+(?:query\s+or\s+)?dispute\b/iu;

/**
 * LATIN AMERICAN WORDING, SCOPED TO BR/CO/MX/PE. Spanish and Brazilian
 * Portuguese purchase/security codes, two-step confirmations ("foi você?",
 * "responde SI"), scheduled Pix, bills and reminders, loan and limit offers,
 * transactions under analysis or unfinished. Applied only to an alert routed
 * to one of these markets, a person in one of them, or money in BRL/COP/MXN/
 * PEN: "token", "confirme" or "programado" in a US alert ("your Apple Pay
 * token", a cafe called CONFIRME) must not change what a US alert does.
 */
const LATAM_MARKETS: ReadonlySet<string> = new Set(['BR', 'CO', 'MX', 'PE']);
const LATAM_CURRENCIES: ReadonlySet<string> = new Set(['BRL', 'COP', 'MXN', 'PEN']);
const LATAM_NON_COMPLETED_WORDING: readonly RegExp[] = [
  /(?<!\p{L})(?:c[óo]digo\s+(?:de\s+)?(?:seguridad|autorizaci[óo]n|autoriza[çc][ãa]o|confirmaci[óo]n|confirma[çc][ãa]o|acceso|acesso|compra|transacci[óo]n)|c[óo]d\.\s*de\s+seguridad|tu\s+c[óo]digo|es\s+tu\s+c[óo]digo|clave\s+din[áa]mica|token)(?!\p{L})/iu,
  /(?<!\p{L})(?:foi\s+voc[êe]|fuiste\s+t[úu]|reconoces|reconhece|responda|responde\s+(?:s[íi]|sim|no|n[ãa]o|cancelar)|confirma\s+(?:tu|su)\s+(?:pago|compra|transacci[óo]n|operaci[óo]n)|confirme)(?!\p{L})/iu,
  /(?<!\p{L})(?:agendad[oa]|agendamentos?|programad[oa]|se\s+(?:cargar|debitar)[áa]|en\s+proceso|em\s+processamento|em\s+an[áa]lise|en\s+an[áa]lisis|vence(?:\s+amanh[ãa])?|vencimento|pago\s+m[íi]nimo|tienes\s+un\s+pago|completa\s+tu\s+pago|fa[çc]a\s+o\s+pagamento|j[áa]\s+pode\s+agendar|novo\s+boleto|sua\s+fatura\s+(?:de\s+R\$\s?[\d.,]+\s+)?(?:est[áa]\s+dispon[íi]vel|fechou|vence)|a\s+fatura\s+do\s+cart[ãa]o\s+fechou)(?!\p{L})/iu,
  // Loan OFFERS only: a loan repayment ("pagamento do empréstimo") is real money.
  /(?<!\p{L})(?:empr[ée]stimo\s+foi\s+aprovado|pr[ée]-?aprovad[oa]|pr[ée]-?aprobad[oa]|cr[ée]dito\s+(?:de\s+R?\$\s?[\d.,]+\s+)?dispon[íi]vel|simul(?:ar|e)|limite\s+subiu|cupo\s+disponible|ganhe|garanta|cupom|invista|meses\s+sin\s+intereses)(?!\p{L})/iu,
  /(?<!\p{L})(?:n[ãa]o\s+(?:conclu[íi]d[oa]|aprovad[oa]|autorizad[oa]|realizad[oa])|no\s+fue\s+posible|no\s+(?:aprobad[oa]|autorizad[oa]))(?!\p{L})/iu,
  // A movement already reversed, returned, failed, disputed, suspended or
  // still processing ("Consumo extornado", "Pix devolvido", "en trámite").
  // Participles only: a refund NOUN ("extorno de S/ 20", "estorno de compra")
  // can announce money really credited and is left to the other guards.
  /(?<!\p{L})(?:extornad[oa]|estornad[oa]|reversad[oa]|devuelt[oa]|devolvid[oa]|sin\s+[ée]xito|sem\s+sucesso|fallid[oa]|fall[óo]|procesando|processando|n[ãa]o\s+processad[oa]|en\s+tr[áa]mite|desfeit[oa]|contestad[oa]|suspendid[oa]|suspens[oa]|no\s+se\s+pudo)(?!\p{L})/iu,
];

/** Temporary holds/charges are never a completed movement. */
const TEMPORARY_HOLD = /\btemporary\s+(?:authori[sz]ation|hold|charge|debit|block)\b|\bhold\s+amount\b/iu;
/**
 * "Authorised"/"authorisation" alone describes an approval, which may still be
 * released or change; only posted/completed/settled wording makes it money.
 */
const AUTHORISATION = /\bauthori[sz](?:ed|ation)\b/iu;
const COMPLETED = /\b(?:completed|posted|settled)\b/iu;

/**
 * A web address, with or without a scheme: `http://x`, `www.x`, or a bare
 * `host.tld/path` (a path is required without a scheme, so "Amazon.com" as a
 * merchant name is not a link). Group 1 is the host.
 */
// The label repetition is bounded: an unbounded run made a long "a.b.a.b…"
// text cost one full scan per letter.
const LINK = String.raw`(?:https?:\/\/|www\.)([^\s/?#]+)[^\s]*|\b([a-z0-9][a-z0-9-]{0,62}(?:\.[a-z0-9-]{1,63}){0,5}\.[a-z]{2,12})\/[^\s]*`;
/**
 * What a smishing text asks the reader to do at its link. The weak verbs
 * (update, log in, sign in, receive, get) are ordinary bank-footer verbs ("Log
 * in: https://www.chase.com", "Update the app: …"); they count only for the
 * person's own details/money or at a bait host.
 */
const STRONG_ACTION = String.raw`dispute|verify|validate|confirm|cancel|claim|collect|unlock|unblock|reactivate|restore|redeem|reverse|accept`;
// "Review it: https://…" asks the reader to act at an unknown host; a
// bank's own "Review your activity at chase.com" footer is the same weak verb.
const WEAK_ACTION = String.raw`update|log\s?in|sign\s?in|receive|get|review`;
const LINK_ACTION = `${STRONG_ACTION}|${WEAK_ACTION}`;
const ACTION_THEN_LINK = new RegExp(String.raw`\b(${LINK_ACTION})\b([^.!?\n]{0,30}?)(?:${LINK})`, 'giu');
const LINK_THEN_ACTION = new RegExp(String.raw`(?:${LINK})[^.!?\n]{0,12}?\bto\s+(?:${LINK_ACTION})\b`, 'giu');
const WEAK_ACTION_ONLY = new RegExp(String.raw`^(?:${WEAK_ACTION})$`, 'iu');
const OWN_DETAILS = /^\s*(?:your\s+)(?:details|information|info|account|card|kyc|money|funds|payment|refund|reward)\b/iu;
/** Link shorteners hide the destination; a bank footer that uses one is still a bait shape. */
const SHORTENER = /^(?:bit\.ly|tinyurl\.com|rb\.gy|t\.co|cutt\.ly|is\.gd|goo\.gl|ow\.ly|shorturl\.at|tiny\.cc|s\.id|t\.ly)$/iu;
/** App stores are where a bank's own "update the app" footer points. */
const APP_STORE = /^(?:apps\.apple\.com|play\.google\.com)$/iu;
/** Lookalike registrable domains spell the action or security words into the name. */
const BAIT_HOST = /verify|secure|dispute|claim|refund|login|signin|support|help|billing|unlock|update|confirm|account/iu;
/**
 * The registrable domain: the last two labels, or three under a two-letter
 * country code with a generic second level (`bank.co.uk`). A bank's own
 * subdomain (`secure.chase.com`) is judged as `chase.com`.
 */
const registrableDomain = (host: string): string => {
  const labels = host.toLowerCase().replace(/^www\./u, '').replace(/[:.]+$/u, '').split('.');
  const take = labels.length >= 3 && /^[a-z]{2}$/u.test(labels.at(-1)!) &&
    /^(?:co|com|net|org|gov|ac|edu|bank)$/u.test(labels.at(-2)!) ? 3 : 2;
  return labels.slice(-take).join('.');
};
/**
 * "chase.com-refund.example": a real-looking domain spelled into another one.
 * Judged after `www.` is stripped, and only when another label follows, so a
 * real hyphenated host ("co-operativebank.co.uk", "net-banking…") is not one.
 */
const SPOOFED_TLD = /\.(?:com|net|org|bank)-[^.]+\./iu;
const spoofedHost = (host: string): boolean => SPOOFED_TLD.test(host.replace(/^www\./iu, ''));
/** Brand and security words a lookalike domain borrows. */
const LOOKALIKE_WORD = /chase|paypal|amazon|apple|bank|secure|verify|login|refund|wells|citi|hsbc|barclays|venmo|zelle|account|support|help/iu;
const letters = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/gu, '');
/** The brand the alert names in its header ("Chase: …", "Co-operative Bank: …"). */
const headerBrand = (source: string): string | null => {
  const header = source.match(/^\s*([\p{L}][\p{L}&' .-]{1,40}?)\s*:/u)?.[1];
  return header ? letters(header) : null;
};
/** The link is the alert's own brand domain: its first label spells the header brand exactly. */
const ownBrandHost = (host: string, brand: string | null): boolean => {
  if (!brand) return false;
  const label = letters(registrableDomain(host).split('.')[0]);
  return label.length >= 3 && (label === brand || brand.startsWith(label) && /^(?:bank|uk|us|card|cards)?$/u.test(brand.slice(label.length)));
};
const baitHost = (host: string | undefined): boolean => {
  if (!host) return false;
  if (APP_STORE.test(host.replace(/^www\./iu, ''))) return false;
  return SHORTENER.test(host) || spoofedHost(host) || BAIT_HOST.test(registrableDomain(host));
};
/** A "Not you?" / "If this wasn't you" / "to stop this payment" sentence. */
const DENIAL_CONTEXT = /\bnot\s+you\b|\bwasn['’]t\s+you\b|\bwas\s+not\s+you\b|\bdidn['’]t\s+make\b|\bstop\s+this\s+(?:payment|transaction|charge)\b/iu;
const ANY_LINK = new RegExp(LINK, 'giu');
/**
 * Footer noun phrases that name a service, not an action on this money:
 * UCO Bank's "Report Dispute <link>" and "To cancel alerts, visit …".
 */
const FOOTER_SERVICE = /\breport\s+dispute\b|\b(?:cancel|stop|unsubscribe\s+from)\s+(?:these\s+|all\s+|text\s+|sms\s+|account\s+)?alerts?\b/giu;

/**
 * A LINK WHOSE CALL TO ACTION IS DISPUTE/VERIFY/CANCEL/CLAIM is the shape of
 * smishing ("Your card has been charged $499 … If this wasn't you, dispute
 * here: http://…"). The money sentence before it is bait, not a bank fact, so
 * such a message never auto-posts. It is bait when a strong action is
 * imperative at the link ("dispute here:", "Claim it now", "Verify: …"), a
 * weak one names the person's own details or money ("update your details"),
 * or the link is a shortener, a lookalike registrable domain or a spoofed one
 * ("chase.com-refund.example"); in a "Not you?" sentence any hyphenated or
 * lookalike domain is bait. A purpose-clause footer to a plain domain ("To
 * dispute this charge visit www.chase.com/dispute"), a bank subdomain ("Sign
 * in at secure.chase.com"), an app store, "Report Dispute", "To cancel
 * alerts" and "Not you? Visit chase.com/fraud" are not.
 */
const hasLinkCallToAction = (source: string): boolean => {
  const text = source.replace(FOOTER_SERVICE, (phrase) => ' '.repeat(phrase.length));
  const brand = headerBrand(source);
  for (const match of text.matchAll(ACTION_THEN_LINK)) {
    const action = match[1] ?? '';
    const between = match[2] ?? '';
    const host = match[3] ?? match[4];
    if (baitHost(host)) return true;
    if (WEAK_ACTION_ONLY.test(action)) {
      if (OWN_DETAILS.test(between)) return true;
      // "Log in now: http://…" is bait unless the link is the brand's own
      // domain ("Chase: … Log in: https://www.chase.com").
      if (/\b(?:here|now|immediately|below)\b|:/iu.test(between) && !(host && (ownBrandHost(host, brand) || APP_STORE.test(host.replace(/^www\./iu, ''))))) return true;
      continue;
    }
    const purpose = /\bto\s*$/iu.test(text.slice(Math.max(0, match.index! - 4), match.index!));
    if (!purpose && /\b(?:here|now|immediately|below)\b|:/iu.test(between)) return true;
  }
  for (const match of text.matchAll(LINK_THEN_ACTION)) {
    if (baitHost(match[1] ?? match[2])) return true;
  }
  const sentences = text.split(/(?<=[.!?\n])\s+/u);
  for (const [index, sentence] of sentences.entries()) {
    // "Not you? Click …" puts the question in the sentence before the link.
    const context = `${sentences[index - 1] ?? ''} ${sentence}`;
    for (const match of sentence.matchAll(ANY_LINK)) {
      const host = match[1] ?? match[2];
      if (host && spoofedHost(host)) return true;
      // In a "Not you?" sentence a hyphenated domain is bait only when it also
      // borrows a brand/security word and is not the alert's own brand:
      // "chase-x.example" is, "first-direct.com" and "credit-agricole.fr" are not.
      const label = host ? registrableDomain(host).split('.')[0] : '';
      if (host && DENIAL_CONTEXT.test(context) && !APP_STORE.test(host.replace(/^www\./iu, '')) &&
        !ownBrandHost(host, brand) &&
        (baitHost(host) || (label.includes('-') && LOOKALIKE_WORD.test(label)))) return true;
    }
  }
  return false;
};

/**
 * Wording that withdraws or questions the money sentence it sits beside:
 * fraud prompts ("Fraud alert", "Was this you?", "that we blocked"), an
 * advert ("Earn $5 every time…"), an accept-the-money prompt, a question or a
 * condition about the payment itself ("Has JORDAN paid you $48.20?", "If
 * JORDAN LEE paid you $48.20, mark it received").
 */
const NOT_A_SETTLED_FACT: readonly RegExp[] = [
  // A conditional footer ("In case the transaction is suspicious, call …",
  // "If you notice unusual activity …") is advice, not a fraud prompt.
  /\bfraud\s+alert\b|(?<!\b(?:if|in\s+case|should)\b[^.!?\n]{0,60})\b(?:suspicious\s+(?:activity|transaction|charge|payment|login|purchase)|unusual\s+activity)\b|\bif\s+it\s+was\s+you\b|\bwas\s+this\s+you\b|\bwe\s+(?:have\s+)?(?:blocked|stopped|declined|locked)\b|(?<!\b(?:if|in\s+case|should|can|could|may)\b[^.!?\n]{0,60})\blocked\b|\bunder\s+review\b/iu,
  // An earn-per-event advert ("Earn $5 every time a friend has paid you"),
  // not a rewards tagline ("Earn 5% back on groceries").
  /\bearn\s+(?:up\s+to\s+)?(?:[$€£₹]\s?\d|\d[\d.,]*\s*(?:%|[A-Z]{3}\b))(?:[^.!?\n]|\.\d){0,40}?\b(?:when|every\s+time|each\s+time|for\s+every)\b|\btap\s+to\s+accept\b/iu,
  // Fraud and verification prompts beside the money sentence. "Don't
  // recognise it? Call us" is the security footer on a completed charge;
  // "Do you recognise this payment?" still asks.
  // A security code, or a bare "Code 123456"; an auth/approval/merchant/MCC
  // code is a receipt field, not a challenge. That lookbehind is written
  // AFTER "code" (`\bcode(?<!… code)`): in front of it, it ran at every
  // position, and a long blank run made each run quadratic.
  /\bdid\s+you\s+(?:authori[sz]e|make|attempt|use)\b|\breply\s+(?:y|yes|n|no|1|2)\b|(?<!\b(?:if|in\s+case|should|don['’]t|do\s+not)\b[^.!?\n]{0,40})\brecogni[sz]e\b|\bflagged\b|\bheld\b|\b(?:otp|one[-\s]time|verification|security)\s+code\b|\bcode(?<!\b(?:auth|authori[sz]ation|approval|merchant|biller|branch|postal|zip|sort|mcc|promo|category|reference|ref)\s+code)\s*:?\s*\d{4,}\b/iu,
  // An unnamed payer ("Somebody paid you $500!") or a question about it.
  /\b(?:someone|somebody|anyone|anybody|a\s+friend)\s+(?:has\s+)?(?:paid|sent)\s+you\b|\b(?:if|whether)\s+(?:they|he|she|you|[\p{L}]+)\s+(?:have\s+|has\s+)?(?:paid|sent)\s+you\b/iu,
  // These two open at the start or after punctuation and its blanks; the
  // lookbehind refuses a second start at a newline an earlier separator's
  // blanks already cover (same matches, linear on a long blank run).
  /(?:^|[.!?\n:](?<![.!?\n:]\s*?\s)\s*)(?:has|have|did|does|do|is|was|were)\s+(?:[^.!?\n]|\.\d){0,80}?\d(?:[^.!?\n]|\.\d){0,40}\?/iu,
  /(?:^|[.!?\n:](?<![.!?\n:]\s*?\s)\s*)(?:if|when|once|unless)\b(?:[^.!?\n]|\.\d){0,80}?\b(?:paid|made|sent|received|charged|spent|debited|credited)\b(?:[^.!?\n]|\.\d){0,40}?(?:[$€£₹]\s?\d|\b[A-Z]{3}\s?\d)/iu,
];

/**
 * Text that quotes money which is not a new movement of the person's own
 * cash, so a best-effort reading must not post it:
 *  - a past purchase "converted to EMI/instalments" (the purchase was already
 *    posted; the plan changes how it is repaid);
 *  - airtime RECEIVED (phone credit, not money; buying airtime still posts);
 *  - a merchant's order notice ("Your FoodApp Order #… was paid", "Your order
 *    #12345 has shipped. You paid $50.00 …"), which repeats the bank's own
 *    debit alert for the same payment;
 *  - a fund crediting UNITS for a contribution (own money moved into an
 *    investment; the bank side already shows it leaving).
 */
const NOT_A_NEW_MOVEMENT: readonly RegExp[] = [
  /\bconverted\s+(?:in)?to\s+(?:an?\s+)?(?:emi|instal(?:l)?ments?|instal(?:l)?ment\s+plan)\b/iu,
  /\breceived\s+(?:an?\s+)?airtime\b/iu,
  /\b(?:money\s+market|unit\s+trust|mutual|investment)\s+fund\b[\s\S]{0,120}?\b\d[\d,.]*\s+units\b/iu,
];

/**
 * A merchant's order notice ("Your FoodApp Order #… was paid", "Your order
 * #12345 has shipped. You paid $50.00 …") repeats the bank's own debit alert
 * for the same payment. A wallet's or bank's own debit that merely carries an
 * order id ("Paid Rs.120.00 to GREEN GROCERS. Order ID: 77120334. Updated
 * Balance: Wallet Rs 880.00") states the payer's own balance, which a merchant
 * cannot know: that is the movement itself and stays postable.
 */
const MERCHANT_ORDER_RECEIPT =
  /\border\s*(?:#|no\.?|number|id)\s*[:.-]?\s*[A-Z0-9-]*\d[\s\S]{0,80}?\b(?:paid|payment)\b|\b(?:paid|payment)\b[\s\S]{0,40}?\border\s*(?:#|no\.?|number|id)\s*[:.-]?\s*[A-Z0-9-]*\d/iu;
const OWN_BALANCE_STATED =
  /\b(?:updated|avl\.?|available|new|closing|current)\s+(?:wallet\s+|account\s+|a\/c\s+)?bal(?:ance)?\b|\bbal(?:ance)?\s*(?:is|:)\s*(?:[A-Z]{3}|Rs\.?|[$£€₹])/iu;

/**
 * "You paid $4,493.74 to your Venture X Card…(9792)": a payment to the
 * person's own card settles earlier purchases, so posting it as an ordinary
 * movement counts them twice. The universal reader does not recognise this
 * wording as a card payment, so it is simply not auto-posted ("You sent $20.00
 * to your CHASE CREDIT CRD AUTOPAY card ending 9220" is the same). The card is a
 * named product ("… to your Venture X Card", "… to your credit card"), never
 * "to your friend using your debit card".
 */
const OWN_CARD_PAYMENT = /\b(?:[Yy]ou\s+)?(?:paid|sent|transferred|moved)\b(?:[^.\n]|\.\d){0,40}?\bto\s+your\s+(?:(?:[A-Z][\p{L}\p{N}&.'’-]*|credit|charge)\s+){0,4}?[Cc]ard\b/u;

/**
 * Never auto-posted by the unverified-format policy or a certified template:
 * a smishing link call-to-action, wording that withdraws the money sentence,
 * or money that is not a new movement. Deliberately NOT part of
 * hasNonCompletedWording, which also gates user-taught (learned) templates in
 * every market: those keep their own, older contract. Such a message is not
 * auto-added; whether it then reaches Review is the refusal inspector's
 * decision (on the iPhone History path most of these are simply not imported).
 */
/**
 * A lookalike host anywhere, whoever sent it: a hyphenated or dotted label
 * that spells a security or account word ("spk-sicher.example",
 * "chase-secure.com", "chase.verify-id.co", "secure-chase.app") or a spoofed
 * domain. A letter sender ID is easy to spoof; a bank's own footer domain
 * ("sparkasse.de", "credit-agricole.fr", "sparkasse-koelnbonn.de") spells no
 * such word.
 */
const LOOKALIKE_LABEL = /verif|secur|sicher|s[äa]ker|sikker|veilig|seguro|segur|sicurezza|bezpiec|bezpe[čc]|login|signin|anmeld|support|hilfe|help|refund|claim|unlock|update|confirm|bestaetig|bestätig|validat|account|konto|compte|cuenta|conto|rekening|kunde|alert|service/iu;
const BARE_HOST = /(?<![\p{L}\p{N}@._-])((?:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.){1,4}[a-z]{2,12})(?![\p{L}\p{N}-])(\S*)/gu;
const RISKY_TLD = /\.(?:app|xyz|top|info|online|site|link|click|live|support|help|icu|vip|shop|cc|ws|ru|tk|ml|ga|cf|gq)$/iu;
const lookalikeHost = (host: string): boolean => {
  const bare = host.toLowerCase().replace(/^www\./u, '').replace(/[:.]+$/u, '');
  const registrable = registrableDomain(bare).split('.')[0];
  return spoofedHost(bare) || bare.split('.').slice(0, -1).some((label) => label.includes('-') && LOOKALIKE_LABEL.test(label)) ||
    (LOOKALIKE_LABEL.test(registrable) && RISKY_TLD.test(bare));
};
const hasLookalikeLink = (source: string): boolean => {
  for (const match of source.matchAll(ANY_LINK)) {
    const host = match[1] ?? match[2];
    if (host && lookalikeHost(host)) return true;
  }
  for (const match of source.matchAll(BARE_HOST)) if (lookalikeHost(match[1])) return true;
  // A lookalike host in capitals ("Confirm at CHASE-SECURE.COM") is still a link.
  for (const match of source.toLowerCase().matchAll(BARE_HOST)) if (lookalikeHost(match[1])) return true;
  return false;
};
/**
 * A scheme-less domain is a link to tap when it is lower-case and has a
 * path or query, a lookalike label or a throwaway top-level domain
 * ("chase-help.net?id=88", "secure-chase.app"). A capitalised descriptor
 * ("AMAZON.COM") or a bare brand domain ("Visit chase.com") is not.
 */
const hasBareLink = (source: string): boolean => [...source.matchAll(BARE_HOST)].some((match) =>
  /^[/?#]/u.test(match[2] ?? '') || lookalikeHost(match[1]) || RISKY_TLD.test(match[1]));

// A link however it is written: a disguised scheme ("hxxps://", "https//"), a
// disguised dot ("sparkasse[.]de", "sparkasse . de/x", a path required), or a host of any case
// behind a label ("[INFO: SPARKASSE.INFO]", "DETAILS:REWE-BANK.DE").
const DISGUISED_LINK = /(?<![\p{L}\p{N}])(?:h(?:xx|xt|tx)ps?:?\/\/|https?\/\/)|[\p{L}\p{N}-][。．｡][a-z]{2,12}(?![\p{L}])|(?<![\p{L}\p{N}-])[a-z0-9-]{1,63}_[a-z0-9_-]{0,63}\.[a-z]{2,12}(?:\/|(?![\p{L}\p{N}]))|(?<=[\p{L}\p{N}])\s*[[(]\s*\.\s*[\])]\s*(?=[\p{L}\p{N}])|(?<![\p{L}\p{N}.-])[a-z0-9-]{2,63}[ \t]+\.[ \t]*[a-z]{2,12}\//iu;
const LABELLED_HOST = /(?<!\p{L})(?:info|details?|link|mehr|more|plus|m[aá]s|pi[uù]|meer|mer|wi[eę]cej|v[ií]ce|pr[üu]fen|check|ver|voir|vedi|zie|se|zobacz|viz|web|online|url|site|portal)[ \t]*:[ \t]*(?:[a-z0-9][a-z0-9-]{0,62}\.){1,4}[a-z]{2,12}(?![\p{L}\p{N}-])/iu;
// A host spelled with a non-ASCII letter ("spärkasse.de/x") imitates another.
const NON_ASCII_HOST = /(?<![\p{L}\p{N}.-])[\p{L}\p{N}-]{0,62}[^\x00-\x7f\s][\p{L}\p{N}-]{0,62}\.(?:[a-z]{2,12})\//iu;
export const isNotAutoPostableMoney = (source: string): boolean =>
  hasLinkCallToAction(source) || hasLookalikeLink(source) || DISGUISED_LINK.test(source) || NON_ASCII_HOST.test(source) || NOT_A_SETTLED_FACT.some((pattern) => pattern.test(source)) ||
  NOT_A_NEW_MOVEMENT.some((pattern) => pattern.test(source)) ||
  (MERCHANT_ORDER_RECEIPT.test(source) && !OWN_BALANCE_STATED.test(source));

/**
 * A link next to the money. Lures always carry one ("confirm your
 * information in the link"); a genuine alert from a registered bank header
 * sometimes has an app/history link in its footer. So a link blocks
 * auto-add unless the sender is a registered header, short code or app
 * package (see registeredAlphaSender): from a phone number, an e-mail
 * address, a generic
 * "INFO"-style header or an unknown sender, the row goes to Review at most.
 * www./domain arms are lower-case only: an upper-case "WWW.GRAB.COM" or
 * "AMZN.COM/BI" is a card descriptor naming the merchant, not a link to tap.
 */
const LINK_RE =
  /\bhttps?:\/\/|\bwww\.[a-z0-9-]|\b(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|cutt\.ly|rb\.gy|is\.gd|ow\.ly|shorturl\.at)\/|\b[a-z0-9][a-z0-9-]{0,62}\.[a-z]{2,24}\/[\w-]/u;
const GENERIC_SENDER = /^(?:info|infos|alert|alerts|notice|notify|sms|msg|message|verify|secure|security|service|support|update|bank|banking)$/i;
/**
 * A sender a stranger cannot simply type: an operator-registered alphanumeric
 * header ("AD-HDFCBK", "EmiratesNBD"), a carrier short code of three to six
 * digits, or an installed app's package name (push). Never a full phone
 * number, an e-mail address or a generic word such as "INFO".
 */
const registeredAlphaSender = (sender: string | undefined): boolean => {
  if (typeof sender !== 'string') return false;
  const raw = sender.trim();
  if (/^\d{3,6}$/.test(raw)) return true;
  if (/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){2,}$/i.test(raw) && !raw.includes('@')) return true;
  const id = raw.replace(/^[A-Z]{2}-/, '').replace(/-[A-Z]$/, '');
  // A two-letter header ("CA" Crédit Agricole, "SG") is operator-registered
  // like a longer one; no personal phone can send from either.
  if (/^[A-Za-z]{2}$/.test(id)) return true;
  // A bank's second header may join its name with a hyphen or underscore
  // ("KFH-Info" beside "KFH", "SANLAM_UT", "T-CASH"); the same rules as a
  // plain header apply to it, so the bank's two ids decide alike. A dot is
  // not allowed: "secure-bank.com" is a domain, not a header.
  return /^[A-Za-z][A-Za-z0-9 ]*(?:[-_][A-Za-z0-9 ]+)*$/.test(id) && id.length >= 3 && id.length <= 16 &&
    (id.match(/[A-Za-z]/g) ?? []).length >= 3 && !GENERIC_SENDER.test(id.replace(/[-_].*$/, ''));
};
// A scheme or a link shortener in capitals ("HTTPS://BIT.LY/3XYZ") is a link too.
const CAPITAL_LINK = /\bHTTPS?:\/\/|\b(?:BIT\.LY|TINYURL\.COM|T\.CO|GOO\.GL|CUTT\.LY|RB\.GY|IS\.GD|OW\.LY|T\.LY|SHORTURL\.AT)\//iu;
export const hasLinkFromUnregisteredSender = (source: string, sender?: string): boolean =>
  (LINK_RE.test(source) || hasBareLink(source) || DISGUISED_LINK.test(source) || LABELLED_HOST.test(source) || CAPITAL_LINK.test(source)) &&
  !registeredAlphaSender(sender);
/**
 * A sender nobody is accountable for, when one IS present: a full phone
 * number (seven or more digits), an e-mail address or a generic "INFO"-style
 * word. Narrower than !registeredAlphaSender on purpose: a short or
 * punctuated bank header ("SG", "SANLAM_UT", "T-CASH") is not a person's
 * phone. NO sender at all (an iOS History record, a pasted text, the AI path
 * without one) is NOT unverified: the text alone decides, through the wording
 * guard and the link gate, exactly as before this rule existed.
 *
 * Known trade-off: a few banks really do send from a full phone number (US
 * toll-free alert numbers, Swedbank Latvia's 29610101). Their credits that do
 * not name the own account or card tail go to Review, not auto-add. No
 * per-bank exception is made without real evidence of the sender.
 */
export const isUnverifiedAlertSender = (sender: string | undefined): boolean => {
  const raw = typeof sender === 'string' ? sender.trim() : '';
  if (!raw) return false;
  if (raw.includes('@') || /^\+?[\d\s().-]{7,}$/.test(raw)) return true;
  return GENERIC_SENDER.test(raw.replace(/^[A-Z]{2}-/, '').replace(/-[A-Z]$/, ''));
};
/** Exposed for the Review admission in launch-alert-parser.ts. */
export const isRegisteredAlertSender = (sender: string | undefined): boolean => registeredAlphaSender(sender);

/**
 * The alert names one of the reader's own accounts or cards by its visible
 * tail, and the tail sits next to an own-instrument word: "A/c XX4410",
 * "Card x4410", "card ending 2201", "card ending in 4421", "Acct: ******1736",
 * "account 3231", "account 0312XXXXX4410", "cheq a/c..123456", "a/c *917",
 * Arabic "حساب رقم XXXX1234", "بطاقة …1234". A masked figure anywhere else is
 * NOT the reader's: a payer's phone ("from JOHN DOE 0712***678"), a reference
 * ("Ref *4410") or a USSD code ("Dial *334#"). A fully masked "a/c XXXXXX"
 * names nothing. A masked IBAN after the account word ("Your account
 * BH19BBKUXXXXXXXXXXXX74", BBK) names its tail like any other mask.
 * So does a dash-grouped mask ("your account XXXX-XXXXX6-001", Emirates
 * Islamic's official sample). Malaysia's Islamic "Account-i ****1234" and a
 * mask glued to the noun ("ur A/cX1234") name it the same way.
 *
 * Each blank run between the optional "no"/":"/"ending in" words is read by
 * ONE `\s*`: chained `\s*(?:no|…)?\s*:?\s*` retried every split of a long
 * blank run ("wallet" + 600 blanks took ~0.2 s, 1 KB several seconds). Same
 * matches — pinned by a differential fuzz in launch-perf.test.cjs.
 */
const OWN_INSTRUMENT_TAIL =
  /(?:\b(?:a\/c|acc(?:oun)?t(?:-i)?|acct|card|ending|wallet(?:\s+(?:no\.?|number))?)\b|\ba\/c(?=[xX*•·]+\d)|(?<!\p{L})(?:حساب|بطاق[ةه])(?:\s+رقم)?)\.?\s*(?:(?:no\.?|number|#)\s*)?(?::\s*)?(?:ending\s+(?:in|with)\s+)?(?:(?:[*xX•·]{2,}[\d*xX•·]*-){1,3}[\d*xX•·]*\d{2,6}|(?:[A-Z]{2}\d{2}[A-Z]{0,4})?\d{0,6}[*xX•·…]+\s?-?\d{2,6}|\.{2,3}\s?\d{2,6}|\d{3,6})(?![\d#])/iu;
/**
 * A card network (or the "AC" abbreviation) named in place of the word card
 * or account: "your Amex ••1234", "thank you for using your VISA 7490 for BHD
 * 9.000". Those words also name visas, model numbers and years ("your visa
 * 2026 application", "your AC 1234 repair"), so a bare figure counts only
 * when the text goes on to use it as a payment instrument (for money, at a
 * merchant, was used/charged/debited/credited); a mask always counts.
 */
const NETWORK_TAIL =
  /\b(?:visa|mastercard|amex|maestro|ac)\b\.?\s*(?:(?:no\.?|number)\s*(?::\s*)?)?(?:\d{0,6}[*xX•·…]+\s?-?\d{2,6}|\.{2,3}\s?\d{2,6}|\d{4}(?=\s+(?:for\s+(?:[$€£₹]\s?\d|[a-z]{2,3}\.?\s?\d|\d)|at\s|(?:was|has\s+been)\s+(?:used|charged|debited|credited)\b)))(?![\d#])/iu;
const OWN_INSTRUMENT_TAIL_ALL = new RegExp(`${OWN_INSTRUMENT_TAIL.source}|${NETWORK_TAIL.source}`, 'giu');
/**
 * The tail must be the READER's. A payer's account or card is named after a
 * payer word ("You have received AED 5,000.00 from account XXXX9876 of JOHN",
 * "credited from card 1234 holder JOHN", "من: …") and never counts. The
 * reader's is named after an owner word ("to/into/in/on/with your … account
 * XX1234", "الى", "في") or opens a clause ("A/c XX8360 Credited …", "Dear
 * Customer, Acct XX552 is credited"). SMS shorthand "ur A/cX1234" and a product
 * name of up to three words after "your" ("your Flexi Debit Visa ending
 * 4321") count too. On a credit a payer label ("Payer:", "Remitter:"), "from
 * your uncle's card 4321" and a holder named after the tail ("account 4321
 * of JOHN ROE") all mark the payer's instrument instead.
 */
const PAYER_BEFORE =
  /(?:\b(?:from|sender|by|of|payer|remitter)|(?<!\p{L})من)[ \t]*:?[ \t]*(?:(?:the|a|an)[ \t]+)?$|\bfrom[ \t]+your[ \t]+(?:[^\s.,;:!?]+[ \t]+){0,3}$/iu;
const PAYER_AFTER = /^[ \t]*(?:of|holder|belonging[ \t]+to)\b/iu;
const OWNER_BEFORE =
  /\b(?:your|ur|yr)[ \t]+(?:[^\s.,;:!?]+[ \t]+){0,3}$|(?:\b(?:your|to|in|into|on|with|using)|(?<!\p{L})(?:الى|إلى|الي|في|على))[ \t]*:?[ \t]*(?:[^\s.,;:!?]+[ \t]+){0,2}$/iu;
const CLAUSE_START_BEFORE = /(?:^|[\n.,;:!?(])[ \t]*(?:dear[ \t]+(?:customer|client|member)[ \t]*,?[ \t]*)?$/iu;
/** A field label naming the destination account: "To: **1234", "الى: 1234", "حساب: XX1234". */
const OWN_FIELD_TAIL = /(?:^|\n)[ \t]*(?:to|الى|إلى|الي|حساب)[ \t]*:[ \t]*[*xX•·]*\d{3,4}(?![\d#])/iu;
/**
 * The alert already said whose instrument it is ("Your card has been credited
 * CHF 32.70 Refund ZKB Visa Debit card no. xxxx 5387"): a later tail with no
 * payer word in front of it is that same own card or account.
 */
const YOUR_INSTRUMENT_EARLIER = /\byour[ \t]+(?:[\p{L}]+[ \t]+){0,2}(?:card|account|a\/c|acct)\b/iu;
/** On a DEBIT "from" is the reader's own origin ("paid from cheq a/c..123456"). */
const DEBIT_ORIGIN_BEFORE = /\bfrom[ \t]+(?:[^\s.,;:!?]+[ \t]+){0,2}$/iu;
/** Wording that makes an undirected text a credit, for the payer-word rule. */
const CREDIT_CUE = /\b(?:credited|received|deposited|incoming|inward|refund(?:ed)?)\b|(?<!\p{L})(?:وارد|ايداع|إيداع|استلام)/iu;
const ownInstrumentTailIn = (text: string, direction?: 'credit' | 'debit' | 'unknown'): boolean => {
  if (OWN_FIELD_TAIL.test(text)) return true;
  const credit = direction === 'credit' || ((direction === undefined || direction === 'unknown') && CREDIT_CUE.test(text));
  for (const match of text.matchAll(OWN_INSTRUMENT_TAIL_ALL)) {
    const at = match.index ?? 0;
    const before = text.slice(0, at);
    const near = before.slice(-48);
    if (credit && (PAYER_BEFORE.test(near) || PAYER_AFTER.test(text.slice(at + match[0].length, at + match[0].length + 24)))) continue;
    if (OWNER_BEFORE.test(near) || CLAUSE_START_BEFORE.test(before) || (!credit && DEBIT_ORIGIN_BEFORE.test(near)) ||
      YOUR_INSTRUMENT_EARLIER.test(before)) return true;
  }
  return false;
};
/**
 * Exposed for tests and the launch path: whether the text names the reader's
 * own card or account by its tail. `direction`, when known, decides whether
 * "from" names a payer (credit) or the reader's own origin (debit); without
 * it, credit wording in the text decides.
 */
export const namesOwnInstrumentTail = (text: string, direction?: 'credit' | 'debit'): boolean =>
  ownInstrumentTailIn(text, direction);
// On a credit the reader's instrument must be named by the text's own-tail
// rule: the universal reader's instrument is whatever account the alert
// names, and "from account XXXX9876 of JOHN" is the payer's.
const namesOwnInstrument = (source: string, event: UniversalBankEvent): boolean =>
  (event.direction !== 'credit' && event.instrument?.evidence === 'explicit' && !!event.instrument.value?.last4 &&
    /\d{2,}/.test(event.instrument.value.last4)) || ownInstrumentTailIn(source, event.direction === 'credit' || event.direction === 'debit' ? event.direction : undefined);
/**
 * The callback hook of a fake purchase alert: it exists to make the reader
 * phone or visit someone ("Not you? Ring us", "If any dispute, call our
 * helpline"). On a genuine alert it sits next to a card or account tail.
 */
const CALLBACK_HOOK =
  /\b(?:not\s+(?:you|u|correct)|not\s+(?:done|made|authori[sz]ed)\s+by\s+you|wasn'?t\s+you|if\s+(?:you\s+)?(?:did|do)\s+not|dispute|helpline|need\s+help)\b/iu;
/** A number to ring: "call 1-888-555-0100", "on 0800 000 0347", "+44 20 7946 0000". */
const CALLBACK_NUMBER = /\b(?:call|ring|phone|dial|contact)(?:\s+us)?(?:\s+(?:on|at))?\s*:?\s*\+?\d[\d\s().-]{6,16}\d(?![\p{L}\p{N}])/iu;
/** Exposed for the Review admission in launch-alert-parser.ts: the vishing hook. */
export const hasCallbackHook = (source: string): boolean => CALLBACK_HOOK.test(source);

/**
 * Chat, not an alert: "lol just spent $65.00 at CHEVRON 0091 😂", "I paid
 * … can you send me your half?", "دفعت … حوّل لي نصيبك". A bank never laughs,
 * writes "I just spent" or asks the reader for their share. Requiring issuer
 * evidence on every senderless debit instead cost far more genuine fintech
 * pushes ("📤 £200.01 sent to MARIA GARCIA", "Gebühr belastet 25,00 €").
 * Case-sensitive "I" on purpose.
 */
const CHAT_MARKER =
  /(?<![\p{L}\p{N}])(?:[Ll][Oo][Ll]|[Ll][Mm][Aa][Oo]|[Hh][Aa](?:[Hh][Aa])+|[Oo][Mm][Gg])(?![\p{L}\p{N}])|😂|🤣|😅|\bI(?:['’]ve|\s+(?:just|have|already))?\s+(?:spent|paid|bought|sent|transferred)\b|\b(?:send|pay|transfer)\s+me\s+(?:back\s+)?(?:your|my|the)\s+(?:half|share|part|cut)\b|حو[ّ]?ل\s*لي|نصيبك|ادفع\s*لي/u;
/**
 * A MONEY CLAIM FROM A SENDER NOBODY IS ACCOUNTABLE FOR. Banks and wallets
 * alert from an operator-registered header, short code or app package. A
 * message from a personal phone number, an e-mail address or a generic "INFO"
 * header that says money ARRIVED but names none of the reader's own accounts
 * or cards is exactly the shape of the fake "Confirmed. You have received Ksh
 * 17,500" and "your tax refund of $258.44" texts. The same from a debit side,
 * with only a callback hook to show for it, is the fake-purchase vishing
 * text. Neither is refused: it waits in Review. So does anything from such a
 * sender that reads as chat (CHAT_MARKER).
 *
 * A BLANK sender (an iOS 26 Messages History record — Find Messages exposes
 * no sender — or pasted text) is treated the same way for these two shapes.
 * A senderless record is the iPhone's main history path, and a fake "You
 * have received Ksh 17,500 …" with no lure word and no link would otherwise
 * be booked as income; such a credit waits in Review with its amount filled
 * (the Review admission in launch-alert-parser.ts lets it through), unless it
 * names the reader's own account or card tail or matched an exact certified
 * bank template (latam-alert-templates). A caller that does not know the
 * sender at all (`undefined`: the push semantic path, which has its own
 * package-trust gate) is unaffected.
 */
/** The European banks' "not you?" footers ("Unbekannte Zahlung?", "Nebyli jste to vy?"). */
const EUROPEAN_DENIAL_HOOK = /(?<!\p{L})(?:unbekannte\s+(?:zahlung|buchung)|nicht\s+von\s+ihnen|waren\s+sie\s+das\s+nicht|ce\s+n['’]est\s+pas\s+vous|op[ée]ration\s+inconnue|no\s+reconoces|no\s+has\s+sido\s+t[uú]|non\s+riconosci|n[ãa]o\s+reconhece|niet\s+herkend|herkent\s+u\s+dit\s+niet|nie\s+rozpoznajesz|to\s+nie\s+ty|k[äa]nner\s+du\s+inte\s+igen|var\s+det\s+inte\s+du|kender\s+du\s+ikke|kjenner\s+du\s+ikke|ikke\s+(?:dig|deg)|nebyli\s+jste\s+to\s+vy)(?!\p{L})/iu;
/** "Call 19623", "اتصل فوراً على 19623", "Ring 7012": a call verb before a short hotline number. */
const CALL_VERB_NUMBER = /(?<![\p{L}])(?:call|ring|phone|dial|contact|reach\s+us|rufen|anrufen|appelez|llam[ae]|chiam[ai]|ligue|bel|zadzwo[nń]|volejte|ring|اتصل|اتصلوا|اتصال)(?:[ \t]+[^\d\s]+){0,3}?[ \t]*:?[ \t]*\+?\d[\d \t().-]{2,18}\d(?![\p{N}])/iu;
const personalSender = (sender: string | undefined): boolean =>
  typeof sender === 'string' && (sender.includes('@') || /^\+?[\d\s().-]{7,}$/u.test(sender.trim()));
/**
 * A phone number in the body: seven to fifteen digits in one run of digits,
 * spaces, dots, dashes and brackets, that is not the amount or another money
 * figure, a date, a time or a masked card/account tail.
 */
const PHONE_RUN = /(?<![\p{L}\p{N}*•·#.,])\+?\(?\d[\d \t().-]{5,20}\d(?![\p{N}]|[.,]\d)/gu;
const hasCallbackPhone = (source: string, event: UniversalBankEvent): boolean => {
  const money = [...event.amount.spans, ...event.observations.flatMap((observation) => observation.field.spans)];
  // Dates and times are blanked first ("2024-11-25 14:07:41", "03.10.2026 18:14").
  const text = source.replace(/(?<![\d.])(?:\d{4}-(?:0?[1-9]|1[0-2])-(?:0?[1-9]|[12]\d|3[01])|(?:0?[1-9]|[12]\d|3[01])[./-](?:0?[1-9]|1[0-2])[./-](?:\d{4}|\d{2}))(?![\d.]?\d)|(?<![\d.])(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?/gu, (date) => ' '.repeat(date.length));
  for (const match of text.matchAll(PHONE_RUN)) {
    const start = match.index!, end = start + match[0].length;
    const digits = match[0].replace(/\D/gu, '');
    if (digits.length < 7 || digits.length > 15) continue;
    if (money.some((span) => span.start < end && span.end > start)) continue;
    const run = match[0].trim();
    const moneyShape = /^\d{1,3}(?:[ .,'’]\d{3})*[.,]\d{2}$/u.test(run) || (/^\d{1,3}(?:[ .,'’]\d{3})*[.,]\d{3}$/u.test(run) &&
      (/(?:[A-Z]{3}|[$€£¥₹]|kr\.?|zł|Kč|\p{Script=Arabic}+)\s*$/u.test(source.slice(Math.max(0, start - 6), start)) ||
      /^\s*(?:[A-Z]{3}|[$€£¥₹]|kr|zł|Kč|\p{Script=Arabic})/u.test(source.slice(end, end + 6))));
    if (/^\d{1,4}[./-]\d{1,2}[./-]\d{2,4}$/u.test(run) || moneyShape) continue;
    return true;
  }
  return false;
};

const unverifiedMoneyClaim = (
  source: string,
  event: UniversalBankEvent,
  sender: string | undefined,
  exactTemplate: boolean,
): boolean => {
  const blank = typeof sender === 'string' && sender.trim() === '';
  if (!isUnverifiedAlertSender(sender) && !(blank && !exactTemplate)) return false;
  if (CHAT_MARKER.test(source)) return true;
  // A personal phone number or e-mail that names a card tail AND asks the
  // reader to ring a number is the fake-purchase vishing text; a tail is
  // trivial to invent. Banks alert from registered headers and short codes.
  if (!blank && event.direction === 'debit' && CALLBACK_HOOK.test(source) && CALLBACK_NUMBER.test(source)) return true;
  // Any number to ring, in any language ("Rufen Sie uns an +49 30 1234567",
  // "Volejte 800 123 456", "Reach us at 800.555.0199"), from a personal phone
  // number or an e-mail address: banks put their hotline in a registered
  // header's alert, a vishing text puts it in a personal one.
  if (!blank && personalSender(sender) && (hasCallbackPhone(source, event) || CALL_VERB_NUMBER.test(source))) return true;
  if (namesOwnInstrument(source, event)) return false;
  if (event.direction === 'credit') return true;
  return event.direction === 'debit' && (CALLBACK_HOOK.test(source) ||
    // Language-agnostic, and on a blank sender (iPhone History) too: a
    // "not you?" question in any language beside a number to ring.
    (!registeredAlphaSender(sender) && EUROPEAN_DENIAL_HOOK.test(source) && hasCallbackPhone(source, event)));
};

/**
 * A completed movement stated in the past ("spent", "debited", "credited",
 * "paid", "posted", "You made a $45.00 purchase", "Purchase of KWD 12.345",
 * "was used for", "is available in account ending"). A bare "purchase" or
 * "payment" noun is not one: "Make your first purchase using code ..." is an
 * advert.
 */
const COMPLETED_MOVEMENT =
  /\b(?:transaction|purchase|payment|charge)\b(?:[^.\n]|\.(?=\S)){0,60}?\b(?:was|has\s+been)\s+made\b|\b(?:spent|debited|credited|paid|posted|withdrawn|transferred|received|charged|deposited|purchased|refunded)\b|\bmade\s+an?\s+\S+\s+(?:purchase|transaction|payment)\b|\b(?:purchase|payment|transaction)\s+of\s+(?:[A-Z]{3}|Rs\.?|[$£€₹])\s?\d|\bused\s+(?:for|at)\b|\bavailable\s+in\s+(?:your\s+)?(?:account|a\/c|acct|card)\b/iu;

/**
 * Trailing promotional footers banks append to completed alerts: "Apply now
 * for a personal loan", "Earn up to 7.5% on FD", "Get paid up to 2 days
 * early", "Track your order in the app", "To deposit cash anytime use our
 * CDM", "Reward points will be added". The sentence is set aside (never the
 * rest of the text) only when the alert states a completed movement AND names
 * the own card/account tail or comes from a registered header (with no link
 * in the message); a lure that
 * merely sounds like one keeps every veto.
 */
// A sentence runs to ".", "!", ";" or a line break; a point inside a figure
// ("7.5%") does not end it. Sentences are cut once, in one pass, rather than
// by a regex that re-scanned from every sentence start (quadratic on "1.1.1…").
const PROMO_KEYWORDS = /\b(?:apply\s+(?:now|here|today)|earn\s+(?:over|up\s*to|upto|extra)|get\s+paid|track\s+your\s+(?:order|parcel|package|shipment|spending)|to\s+deposit\b[^]*?\buse|reward\s+points?\s+will\s+be\s+added)\b/iu;
const PROMO_FOOTER_SENTENCE = {
  [Symbol.replace](source: string, replacement: string): string {
    let out = '';
    let start = 0;
    for (let index = 0; index <= source.length; index += 1) {
      const char = source[index];
      const boundary = index === source.length || char === '!' || char === ';' || char === '\n' ||
        (char === '.' && !/\d/u.test(source[index + 1] ?? ''));
      if (!boundary) continue;
      const sentence = source.slice(start, index);
      if (PROMO_KEYWORDS.test(sentence)) {
        // The sentence and its own closing "." or "!" go.
        out += replacement;
        start = index + (char === '.' || char === '!' ? 1 : 0);
        if (start > index) continue;
      } else {
        out += sentence;
        start = index;
      }
      if (index < source.length) { out += char; start = index + 1; }
    }
    return out;
  },
};

/**
 * A card or wallet descriptor is a NAME, not wording: "purchase at HURRY
 * CURRY OF TOKYO", "at PAY NOW PARKING", "with HURRY BURGER". The upper-case
 * run after a merchant preposition is masked before the advert and shop
 * arms below are tested. Case-sensitive on purpose: "Hurry! Use code" is
 * prose, not a descriptor.
 */
const MERCHANT_DESCRIPTOR =
  /((?:\b(?:at|to|from|with|on|in|by|via|for)|@|لدى:?)\s+(?:the\s+)?)(?!(?:APPLY|REGISTER|CLAIM|CLICK|TAP|REPLY|EARN|GET)\b)[A-Z][A-Z0-9&'’.-]*(?:\s+[A-Z0-9&][A-Z0-9&'’.-]*)*/gu;
const maskMerchantDescriptors = (source: string): string => source.replace(MERCHANT_DESCRIPTOR, '$1MERCHANT');

/**
 * Advert and shop wording, tested on the merchant-masked text: "apply now",
 * "register now", "Hurry!", "using code WELCOME300", "get paid $500", "earn
 * over Ksh7,700", "pay now", a shop's "will be delivered", "track your
 * order", "order confirmed".
 */
const PROMO_AND_SHOP_WORDING: readonly RegExp[] = [
  /\bapply\s+(?:now|here|today)\b|\bto\s+apply\b|\bregister\s+now\b|\bhurry\b|\b(?:using|apply|enter)\s+(?:the\s+)?(?:promo\s+|coupon\s+)?code\b|\bget\s+paid\b|\bearn\s+(?:over|up\s*to|upto|extra)\b|\bpay\s+now\b/iu,
  /\bwill\s+be\s+(?:added|delivered|shipped|dispatched)\b|\btrack\s+your\s+(?:order|parcel|package|shipment)\b|\border\s+(?:update|confirmed)\b/iu,
];

/**
 * Vetoes that a genuine completed alert naming the reader's own card or
 * account answers for itself: a refund that "is available" (a lure when it
 * names nothing; "is available in account ending 4410" when posted), a shop
 * order number beside a callback hook, a dispute desk.
 */
const REFUND_AVAILABLE = /\brefund\b[^\n]{0,30}?\b(?:is|are)\s+(?:now\s+)?(?:available|ready)\b/iu;

const hardNonCompletedWording = (source: string, market?: string | null): boolean =>
  nonPostingReason(source) !== null || NON_COMPLETED_WORDING.some((pattern) => pattern.test(source)) ||
  (!!market && LATAM_MARKETS.has(market) && LATAM_NON_COMPLETED_WORDING.some((pattern) => pattern.test(source))) ||
  TEMPORARY_HOLD.test(source) || (AUTHORISATION.test(source) && !COMPLETED.test(source));

const softNonCompletedWording = (source: string, ownCompleted: boolean): boolean => {
  const masked = maskMerchantDescriptors(source);
  if (PROMO_AND_SHOP_WORDING.some((pattern) => pattern.test(masked))) return true;
  if (ownCompleted) return false;
  return REFUND_AVAILABLE.test(source) || (ORDER_REFERENCE.test(source) && ORDER_CALLBACK_HOOK.test(source)) ||
    DISPUTE_DESK.test(source);
};

/** The text the wording guard reads: promo footers set aside when the alert answers for itself. */
const wordingGuardText = (source: string, sender: string | undefined): { text: string; ownCompleted: boolean } => {
  // The movement must be stated OUTSIDE the footer: "Get paid $400 a week"
  // is the whole advert, not a completed payment beside one.
  const withoutFooters = source.replace(PROMO_FOOTER_SENTENCE, ' ');
  const completed = COMPLETED_MOVEMENT.test(withoutFooters);
  const ownCompleted = completed && ownInstrumentTailIn(withoutFooters);
  // A registered header alone answers only for a footer with no link in the
  // message: "Rs.25,00,000 has been Credited to your account. To get this
  // message, apply now ... http://..." is an advert dressed as a credit.
  const footerExempt = completed && (ownCompleted || (registeredAlphaSender(sender) && !LINK_RE.test(source)));
  return { text: footerExempt ? withoutFooters : source, ownCompleted };
};

/**
 * `market` (an ISO country or routed market) adds that region's own wording.
 * `sender`, when known, lets a registered header's promo footer stand aside.
 */
export const hasNonCompletedWording = (source: string, market?: string | null, sender?: string): boolean => {
  const { text, ownCompleted } = wordingGuardText(source, sender);
  return hardNonCompletedWording(text, market) || softNonCompletedWording(text, ownCompleted);
};

/**
 * Refused ONLY by advert, shop-notice, order-callback or dispute-desk wording,
 * never by a lure, hold, decline, code or future arm. From a registered
 * header such an alert ("Rs.200 paid to Swiggy from Paytm wallet. Order ID:
 * 9988. Need help? Contact 24x7 Helpline") reaches Review instead of being
 * dropped as unrecognised (launch-alert-parser.ts).
 */
export const refusedOnlyByShopOrPromoWording = (source: string, sender?: string): boolean => {
  const { text, ownCompleted } = wordingGuardText(source, sender);
  return !hardNonCompletedWording(text) && softNonCompletedWording(text, ownCompleted) &&
    COMPLETED_MOVEMENT.test(source.replace(PROMO_FOOTER_SENTENCE, ' '));
};

/** Whether an alert is Latin American by route, by the person's country, or by its money. */
const latamScope = (input: BestEffortInput): string | null => {
  if (input.routedMarket && LATAM_MARKETS.has(input.routedMarket)) return input.routedMarket;
  if (input.country && LATAM_MARKETS.has(input.country)) return input.country;
  // Only a RESOLVED currency counts: a bare "$" lists COP and MXN among its
  // alternatives in every market, and must not make a US alert Latin American.
  const currency = input.event?.amount?.value?.currency;
  return currency && LATAM_CURRENCIES.has(currency)
    ? ({ BRL: 'BR', COP: 'CO', MXN: 'MX', PEN: 'PE' } as Record<string, string>)[currency]
    : null;
};

const MONTHS: Readonly<Record<string, number>> = { jan: 1, feb: 2, mar: 3, mär: 3, apr: 4, mai: 5, may: 5, maj: 5, jun: 6, jul: 7,
  aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, dez: 12, dec: 12, des: 12, ene: 1, gen: 1, fév: 2, fev: 2, avr: 4, ago: 8, set: 9, ott: 10, dic: 12,
  mei: 5, out: 10 };
/** The day a message opens with ("01.11.2026", "15. Nov", "2026-11-01"), DMY; null when none. */
const leadingDateDay = (source: string, observedDay: string | null): string | null => {
  const text = source.replace(/^[^\p{L}\p{N}]+/u, '');
  const pad = (value: number) => String(value).padStart(2, '0');
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/u.exec(text);
  if (match) return `${match[1]}-${pad(+match[2])}-${pad(+match[3])}`;
  match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?!\d)/u.exec(text);
  if (match) {
    const year = match[3].length === 2 ? 2000 + +match[3] : +match[3];
    if (+match[2] >= 1 && +match[2] <= 12 && +match[1] >= 1 && +match[1] <= 31) return `${year}-${pad(+match[2])}-${pad(+match[1])}`;
    return null;
  }
  match = /^(\d{1,2})\.?\s+(\p{L}{3,4})/u.exec(text);
  const month = match ? MONTHS[match[2].toLocaleLowerCase('de-DE').slice(0, 3)] ?? MONTHS[match[2].toLocaleLowerCase('de-DE')] : undefined;
  if (match && month && observedDay) return `${observedDay.slice(0, 4)}-${pad(month)}-${pad(+match[1])}`;
  return null;
};
const localIsoDay = (epochMs: number | undefined): string | null => {
  if (epochMs === undefined || !Number.isFinite(epochMs)) return null;
  const day = new Date(epochMs);
  if (!Number.isFinite(day.getTime())) return null;
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
};

const directionMatchesFamily = (event: UniversalBankEvent): boolean => {
  if (event.direction !== 'debit' && event.direction !== 'credit') return false;
  if (event.family === 'refund') return event.direction === 'credit';
  if (event.family === 'transfer') return true;
  return event.direction === 'debit';
};

/**
 * "PKR 4,750.00 sent to SCB PK A/C ***8821 from AYESHA KHAN via Raast" is an
 * INBOUND alert: the destination is a masked account at the alerting bank
 * (the reader's own), and "sent" is the payer's verb. The universal reader
 * sees "sent" and calls it a debit. When the only destination named is a bank
 * account reference (at most three institution abbreviations of two or three
 * letters, "SCB PK", then A/C and a masked tail; a payee name such as "BRIAN
 * DOE" is longer) and the text never says the money left "from your" account,
 * the direction is not knowable from wording, so it goes to Review instead of
 * being auto-added either way. "sent to HAMZA ALI ... from your A/C" (a named
 * payee, or an origin stated as yours) is untouched.
 */
const SENT_TO_ACCOUNT_REFERENCE =
  /\bsent\s+to\s+(?:your\s+)?(?:[A-Za-z][A-Za-z&]{1,2}\s+){0,3}(?:a\/c|acc(?:oun)?t)\.?\s*(?:no\.?\s*)?[*xX•·]+\d{2,6}\b/iu;
const FROM_YOUR_ORIGIN = /\bfrom\s+your\b/iu;
/**
 * "LAYLA HADDAD has received your bank transfer of EUR 144" is the payee
 * confirming the reader's OUTGOING transfer; "received" is the payee's verb.
 * Never auto-added as income.
 */
// The money may sit inside the phrase: "MARIA GARCIA has received your
// $210.57 transfer", "… your 140.24 USD transfer".
const PAYEE_RECEIVED_YOUR_TRANSFER = /\b(?:has|have)\s+(?:now\s+)?received\s+your\s+(?:\S+\s+){0,3}?(?:transfer|payment|money|remittance)\b/iu;
const inboundSentToOwnAccount = (source: string): boolean =>
  SENT_TO_ACCOUNT_REFERENCE.test(source) && !FROM_YOUR_ORIGIN.test(source);

const validMoney = (money: UniversalMoney | null | undefined): money is UniversalMoney => {
  if (!money || typeof money.currency !== 'string' || !/^[A-Z]{3}$/.test(money.currency)) return false;
  const exponent = currencyMinorUnits(money.currency);
  if (exponent === null || exponent !== money.exponent) return false;
  if (typeof money.minorUnits !== 'string' || !/^[1-9]\d{0,15}$/.test(money.minorUnits)) return false;
  return Number.isSafeInteger(Number(money.minorUnits));
};

/**
 * The principal amount, or a refusal. A shared symbol ($, ¥, Rs) resolves
 * only when that is the sole reason for ambiguity: through the bank's own
 * routed market when there is one (a Chase alert means USD even for a user in
 * Mexico), otherwise through the user's country. A route whose market has no
 * shared-symbol currency leaves the symbol unclear. A result in another
 * currency than the ledger then needs a dated rate like any foreign charge.
 */
const DINAR_CURRENCIES = new Set(['JOD', 'IQD', 'KWD', 'BHD', 'LYD', 'TND', 'DZD']);
const resolvePrincipalMoney = (
  source: string,
  event: UniversalBankEvent,
  country: string | null,
  routedMarket: string | null,
  senderMarket: string | null | undefined,
): UniversalMoney | 'amount-unclear' | 'currency-unclear' => {
  const field = event.amount;
  if (field.evidence === 'explicit') {
    if (field.alternatives.length !== 0 || !validMoney(field.value)) return 'amount-unclear';
    return field.value;
  }
  if (field.evidence !== 'ambiguous') return 'amount-unclear';
  // LOCALE EVIDENCE FOR A THREE-DECIMAL FIGURE. "KWD 12.500" is kept
  // ambiguous by the reader (12.5 or 12,500) because nothing in the text says
  // which. The person's own country does, for its own currency: Kuwait,
  // Bahrain, Oman and Jordan print the full stop as the decimal point. Only
  // that exact case resolves: one currency, two readings, the grouping
  // reading exactly 1000x the decimal one, and the figure written with a
  // FULL STOP (a comma stays ambiguous).
  //
  // The currency is settled first: a shared symbol or word ($, kr, دينار)
  // resolves only to the country's (or routed market's) own currency. Then
  // the figure: one remaining reading of a zero-decimal currency is the amount
  // ("1,250,000 دينار" in Iraq has no decimal reading for a zero-decimal
  // dinar), or two are settled by the three-decimal rule above ("75.000
  // دينار" in Jordan). Any other doubt (two numbers, a role question) stays
  // with the person.
  const allowed = new Set(['currency-symbol', 'currency-exponent', 'decimal-or-grouping']);
  if (field.issues.length === 0 || !field.issues.every((issue) => allowed.has(issue))) return 'amount-unclear';
  const symbolDoubt = field.issues.some((issue) => issue === 'currency-symbol' || issue === 'currency-exponent');
  const figureDoubt = field.issues.includes('decimal-or-grouping');
  const market = (routedMarket ?? country ?? '').toUpperCase();
  // A BARE "دينار" is seven countries' money, and a Kuwaiti or Bahraini
  // person routinely receives Jordanian, Iraqi or another neighbour's alerts:
  // "تم خصم 5.250 دينار … لدى SAMPLE SHOP" from a Jordanian sender was booked
  // as 5.250 KWD on a KWD ledger. The person's country does not prove whose
  // dinar it is; only a sender ID identified as that market's own bank does.
  // (The capture seam, launch-alert-parser.ts, always states senderMarket.)
  const dinarWord = symbolDoubt && [field.value, ...field.alternatives]
    .every((money) => !money || DINAR_CURRENCIES.has(money.currency));
  const wanted = dinarWord && senderMarket !== undefined
    ? sharedSymbolCurrencyForCountry(senderMarket)
    : symbolDoubt
      ? sharedSymbolCurrencyForCountry(routedMarket ?? country)
      : THREE_DECIMAL_COUNTRY_CURRENCY[market] ?? null;
  if (!wanted) return symbolDoubt ? 'currency-unclear' : 'amount-unclear';
  const readings = new Map<string, UniversalMoney>();
  for (const money of [...(field.value ? [field.value] : []), ...field.alternatives]) {
    if (money && money.currency === wanted) readings.set(`${money.minorUnits}/${money.exponent}`, money);
  }
  const options = [...readings.values()];
  if (options.length === 1) {
    if (!validMoney(options[0])) return symbolDoubt ? 'currency-unclear' : 'amount-unclear';
    // Under a decimal-or-grouping doubt a lone reading is trustworthy only for
    // a zero-decimal currency, which has no decimal reading to lose. For "$0.125"
    // the lone USD reading is the 1000x grouping one: never take it.
    if (figureDoubt && options[0].exponent !== 0) return 'amount-unclear';
    return options[0];
  }
  const localThreeDecimal = THREE_DECIMAL_COUNTRY_CURRENCY[market];
  const figure = field.spans.length === 1 ? source.slice(field.spans[0].start, field.spans[0].end) : '';
  if (figureDoubt && options.length === 2 && localThreeDecimal === wanted &&
    /^[^,]*\d\.\d{3}(?!\d)[^,]*$/.test(figure)) {
    const [decimal, grouped] = [...options].sort((a, b) => a.minorUnits.length - b.minorUnits.length);
    if (validMoney(decimal) && /^\d+$/.test(grouped.minorUnits) &&
      BigInt(grouped.minorUnits) === BigInt(decimal.minorUnits) * 1000n) return decimal;
  }
  return symbolDoubt && options.length === 0 ? 'currency-unclear' : 'amount-unclear';
};

/**
 * AMOUNT SHAPE MAY ONLY BLOCK. Mexican pesos print `1,234.56`; a dot used for
 * grouping (`$45.000`) or a comma decimal (`$1.234,56`) in an alert read as
 * MXN is the Colombian shape and goes to Review rather than becoming 45 or
 * 45,000 MXN. A Colombian card purchase under 50 pesos is almost certainly a
 * mangled `45.000`. Neither rule can route or change an amount.
 */
const amountShapeConflict = (
  source: string,
  event: UniversalBankEvent,
  principal: UniversalMoney,
): boolean => {
  const span = event.amount.spans.length === 1 ? event.amount.spans[0] : null;
  const figure = span ? source.slice(span.start, span.end).match(/\d[\d.,]*\d|\d/u)?.[0] ?? '' : '';
  if (principal.currency === 'MXN' && (/\d\.\d{3}(?!\d)/u.test(figure) || /,\d{2}$/u.test(figure))) return true;
  return principal.currency === 'COP' && event.family === 'purchase' && principal.exponent === 2 &&
    /^\d+$/.test(principal.minorUnits) && BigInt(principal.minorUnits) < 5000n;
};

/**
 * Exactly one principal figure. Balance/limit/due observations are separate
 * roles and allowed; a second transaction figure or an unlabelled one is not,
 * except a figure in the ledger currency beside a foreign charge (the card's
 * own converted amount), which the FX path validates against a dated rate.
 */
const hasCompetingAmounts = (
  event: UniversalBankEvent,
  principal: UniversalMoney,
  ledgerCurrency: string | null,
): boolean => {
  const principalRoles = event.family === 'fee' ? new Set(['transaction', 'fee']) : new Set(['transaction']);
  const statedLedger = (money: UniversalMoney | null): boolean =>
    !!money && !!ledgerCurrency && principal.currency !== ledgerCurrency && money.currency === ledgerCurrency;
  let principals = 0;
  for (const observation of event.observations) {
    const value = observation.field.value;
    // An alert-threshold sentence ("was more than the $0.01 limit in your
    // Alerts settings") names a setting, not a second movement.
    if (observation.field.issues.includes('aggregate-money-field')) continue;
    if (observation.role === 'unknown') {
      if (statedLedger(value)) continue;
      return true;
    }
    if (!principalRoles.has(observation.role)) continue;
    if (statedLedger(value)) continue;
    principals += 1;
    const others = [...observation.field.alternatives, ...(value ? [value] : [])]
      .filter((money) => !(money.currency === principal.currency && money.minorUnits === principal.minorUnits))
      // The grouping reading of a locale-resolved three-decimal figure is the
      // same printed number, not a second amount (see resolvePrincipalMoney).
      .filter((money) => !(observation.field.issues.includes('decimal-or-grouping') &&
        money.currency === principal.currency && /^\d+$/.test(money.minorUnits) &&
        BigInt(money.minorUnits) === BigInt(principal.minorUnits) * 1000n))
      .filter((money) => !statedLedger(money))
      // A shared symbol or word reads ONE printed figure in several
      // currencies; those readings in other currencies are not a second amount.
      .filter((money) => !(observation.field.issues.includes('currency-symbol') && money.currency !== principal.currency));
    // A symbol ambiguity lists every candidate currency for the same figure.
    if (others.some((money) => money.minorUnits !== principal.minorUnits &&
      currencyMinorUnits(money.currency) === principal.exponent)) return true;
  }
  return principals !== 1;
};

const LAUNCH_ROUTE = (market: string | null | undefined): boolean => !!market && LAUNCH_MARKETS.has(market);

/**
 * A link on a record with NO sender (iOS History, pasted text) may stand when
 * the text itself answers for the alert: it states a completed movement on
 * the reader's own account or card tail, and the link carries no call to
 * action (hasLinkCallToAction, checked first through isNotAutoPostableMoney,
 * already refuses dispute/verify/claim links, shorteners used as bait and
 * lookalike hosts). UCO Bank's "A/c XX8360 Credited with Rs.6.00 … Report
 * Dispute https://bit.ly/… .For feedback https://rb.gy/…" is a real alert;
 * a phone number, e-mail or generic sender still never carries a link.
 */
const senderlessOwnAlertLink = (source: string, sender: string | undefined): boolean =>
  (sender === undefined || sender.trim() === '') && COMPLETED_MOVEMENT.test(source) &&
  ownInstrumentTailIn(source) && !hasLinkCallToAction(source);

const REFUND_NOT_YET = new RegExp(
  String.raw`\brefunds?\b(?:[^.\n]|\.\d){0,80}?\b(?:(?:has|have)\s+been\s+|was\s+|is\s+|are\s+)?(?:initiated|under\s+process(?:ing)?|in\s+process|in\s+progress|pending|requested|submitted|approved|being\s+processed)\b` +
  // (The refund's own cancellation; "for your cancelled order" is the order's.)
  String.raw`|\brefunds?\b(?:[^.\n]|\.\d){0,80}?\b(?:has\s+been|was|is)\s+(?:cancell?ed|declined|rejected)\b` +
  String.raw`|\brefunds?\b[^\n]{0,160}?\bwill\s+(?:reflect|appear|be\s+(?:credited|processed|posted|reflected))\b` +
  String.raw`|(?<![\u0621-\u064A])(?:استرداد|الاسترداد)(?:[^.\n]|\.\d){0,80}?(?:قيد\s+(?:ال)?(?:معالجة|معالجه|تنفيذ|مراجعة|مراجعه)|سيتم)`,
  'iu');
const REFUND_ARRIVED = /\b(?:credited|deposited|(?:processed|posted|returned|added)\s+(?:to|into|on)|received\s+(?:in|on|into))\b|(?<![\u0621-\u064A])تم\s+(?:إيداع|ايداع|إضافة|اضافة)/iu;
/** The single decision for an unproven format. Pure: no storage, no network. */
export function decideBestEffortAutoPost(rawInput: BestEffortInput): BestEffortDecision {
  // A no-break or other Unicode space reads as a space in every check below.
  const input: BestEffortInput = typeof rawInput.source === 'string'
    ? { ...rawInput, source: withPlainSpaces(rawInput.source) } : rawInput;
  const review = (reason: BestEffortRefusal): BestEffortDecision => ({ outcome: 'review', reason });
  const { event } = input;
  if (!input.enabled) return review('disabled');
  if (LAUNCH_ROUTE(input.routedMarket) || LAUNCH_ROUTE(input.launchSenderMarket ?? null)) {
    return review('launch-market');
  }
  if (!event || event.version !== 1 || event.decision !== 'review' || event.status !== 'posted') {
    return review('not-posted');
  }
  if (typeof input.source !== 'string' || hasNonCompletedWording(input.source, latamScope(input), input.sender) ||
    isNotAutoPostableMoney(input.source)) {
    return review('non-posting-wording');
  }
  // A refund that has not arrived ("Your refund of $45.99 from AMAZON has been
  // initiated", "… is under process", "approved … will reflect in 5-7 days")
  // or was cancelled is no credit yet: Review, never a posting.
  if (event.direction === 'credit' && REFUND_NOT_YET.test(input.source) && !REFUND_ARRIVED.test(input.source)) {
    return review('non-posting-wording');
  }
  if (hasLinkFromUnregisteredSender(input.source, input.sender) && !senderlessOwnAlertLink(input.source, input.sender)) {
    return review('non-posting-wording');
  }
  if (unverifiedMoneyClaim(input.source, event, input.sender, input.exactTemplate === true)) return review('unverified-sender');
  if (!POSTABLE_FAMILIES.has(event.family) || OWN_CARD_PAYMENT.test(input.source)) return review('unsupported-family');
  if (!directionMatchesFamily(event)) return review('direction-unclear');
  if (event.direction === 'debit' && inboundSentToOwnAccount(input.source)) return review('direction-unclear');
  if (event.direction === 'credit' && PAYEE_RECEIVED_YOUR_TRANSFER.test(input.source)) return review('direction-unclear');
  if (event.issues.some((issue) => BLOCKING_ISSUES.has(issue))) {
    return review(event.issues.some((issue) => issue.startsWith('direction')) ? 'direction-unclear' : 'not-posted');
  }

  const principal = resolvePrincipalMoney(input.source, event, input.country, input.routedMarket,
    input.senderMarket);
  if (typeof principal === 'string') return review(principal);
  // "kr" read as the reader's krone must be written in that country's
  // language: Swedish wording ("Köp 450,00 kr hos ICA") under a Danish or
  // Norwegian reader, or Danish/Norwegian under a Swedish one, is another
  // country's krone, and its amount waits in Review.
  if (event.amount.issues.includes('currency-symbol') && NORDIC_KRONE_MARKET[principal.currency]) {
    const languages = nordicAlertLanguages(input.source);
    const own = NORDIC_KRONE_MARKET[principal.currency];
    if (languages.some((language) => language !== own && !(language === 'DKNO' && own !== 'SE'))) return review('currency-unclear');
    // Another krone named by its code ("Kortköp 450,00 kr hos NETTO. Valuta DKK") leaves "kr" unclear.
    if ((input.source.match(/(?<![\p{L}\p{N}])(?:SEK|DKK|NOK)(?![\p{L}\p{N}])/giu) ?? [])
      .some((code) => code.toUpperCase() !== principal.currency)) return review('currency-unclear');
  }
  if (amountShapeConflict(input.source, event, principal)) return review('amount-unclear');
  if (hasCompetingAmounts(event, principal, input.ledgerCurrency)) return review('competing-amounts');

  const observedDay = localIsoDay(input.observedAt);
  // A message that opens with a date after the day it arrived announces a
  // movement ("01.11.2026 Lastschrift 45,67 EUR an VODAFONE"): Review.
  const leadingDay = leadingDateDay(input.source, observedDay);
  if (leadingDay && observedDay && leadingDay > observedDay) return review('future-dated');
  // A European dotted date after the arrival day ("Fälligkeit 01.11.2026"): a due date.
  if (observedDay && [...input.source.matchAll(/(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4})(?![\d.]?\d)/gu)].some((match) =>
    +match[2] >= 1 && +match[2] <= 12 && +match[1] >= 1 && +match[1] <= 31 &&
    `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` > observedDay)) return review('future-dated');
  const date = event.transactionDate.evidence === 'explicit' ? event.transactionDate.value : null;
  if (date !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return review('future-dated');
    if (observedDay && date > observedDay) return review('future-dated');
  }

  const originalMinor = Number(principal.minorUnits);
  let amountFils = originalMinor;
  let currency = principal.currency;
  let conversion: ReferenceConversion | null = null;
  if (input.ledgerCurrency && input.ledgerCurrency !== principal.currency) {
    const exponent = input.ledgerExponent;
    if (exponent !== 0 && exponent !== 2 && exponent !== 3) return review('invalid-money');
    const day = date ?? observedDay;
    if (!day) return review('fx-rate-unavailable');
    const quote = input.fxLookup ? input.fxLookup(principal.currency, input.ledgerCurrency, day) : null;
    const converted = convertForeignConfirmation(
      event,
      { currency: principal.currency, minorUnits: originalMinor, exponent: principal.exponent },
      { currency: input.ledgerCurrency, exponent },
      quoteFitsDay(quote, day) ? quote : null,
      { requireQuoteForStated: true },
    );
    if (converted === 'fx-rate-unavailable') return review('fx-rate-unavailable');
    if (converted === 'invalid-money') return review('invalid-money');
    conversion = converted;
    amountFils = converted.amountFils;
    currency = input.ledgerCurrency;
  } else if (input.ledgerCurrency && input.ledgerExponent !== null &&
    input.ledgerExponent !== principal.exponent) {
    return review('invalid-money');
  }
  if (!Number.isSafeInteger(amountFils) || amountFils <= 0) return review('invalid-money');

  const market = input.routedMarket && /^[A-Z]{2}$/.test(input.routedMarket)
    ? input.routedMarket
    : input.country && /^[A-Z]{2}$/.test(input.country) ? input.country : 'ZZ';
  return {
    outcome: 'post',
    amountFils,
    currency,
    original: principal,
    conversion,
    date,
    marker: {
      v: 1,
      format: `${input.formatPrefix ?? 'universal'}:${event.family}:${event.direction}`,
      market,
    },
  };
}

/* ── Setting mirror ─────────────────────────────────────────────────────────
 * The persisted AppState flag is mirrored here (like country.ts) so parser
 * sessions created deep in capture pipelines honour it without threading the
 * store through every native adapter. Undefined in storage means ON: the
 * product default chosen for unproven formats. */
let bestEffortEnabled = true;

export function setBestEffortAutoPostEnabled(enabled: boolean | undefined): void {
  bestEffortEnabled = enabled !== false;
}

export function bestEffortAutoPostEnabled(): boolean {
  return bestEffortEnabled;
}

/** Bounded, durable identities of rows the person undid; rescans never re-add them. */
export const BEST_EFFORT_UNDO_CAP = 2000;

/**
 * The observation-time identity of one best-effort reading: time, ledger
 * currency and exact amount. Including the money means an undo can never
 * suppress a different movement that merely shares the timestamp.
 */
export const bestEffortObservationKey = (
  ts: number | undefined,
  currency: string | null | undefined,
  amountFils: number,
): string | null =>
  typeof ts === 'number' && Number.isFinite(ts) && typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) &&
    Number.isSafeInteger(amountFils) && amountFils > 0
    ? `t${ts}:${currency}${amountFils}`
    : null;

interface BestEffortUndoRow {
  smsKey?: string;
  ts?: number;
  amountFils: number;
  bestEffort?: unknown;
  captureInstrument?: CaptureInstrument;
  cardPaymentSide?: 'debit' | 'receipt';
}

/** A weak settlement observation needs the same card, issuer and leg. A
 * timestamp/amount alone can describe payments to several different cards.
 * Missing scope proves nothing and never creates a generic payment key.
 */
export const bestEffortCardPaymentObservationKey = (
  row: BestEffortUndoRow,
  ledgerCurrency: string | null | undefined,
): string | null => {
  const observed = bestEffortObservationKey(row.ts, ledgerCurrency, row.amountFils);
  const instrument = row.captureInstrument;
  const bank = instrument?.bankIdentity;
  if (!observed || instrument?.kind !== 'credit' || !/^\d{4}$/.test(instrument.last4) ||
      typeof bank !== 'string' || !bank || bank !== bank.trim() || bank.length > 120 || /\p{C}/u.test(bank) ||
      (row.cardPaymentSide !== 'receipt' && row.cardPaymentSide !== 'debit')) return null;
  const key = `p${observed.slice(1)}:${encodeURIComponent(bank)}:credit:${instrument.last4}:${row.cardPaymentSide}`;
  return key.length <= 256 ? key : null;
};

const isCardPaymentUndoRow = (row: BestEffortUndoRow): boolean => {
  const marker = row.bestEffort;
  const format = marker && typeof marker === 'object' && 'format' in marker ? marker.format : undefined;
  return row.cardPaymentSide !== undefined ||
    (typeof format === 'string' && /(?:^|:)card-payment(?:$|:)/.test(format));
};

/** Exact native identity takes precedence; weak card settlements additionally
 * use their card/issuer/leg scope. Ordinary movement keys remain unchanged.
 */
export const bestEffortUndoKeys = (
  row: BestEffortUndoRow,
  ledgerCurrency: string | null | undefined,
): string[] => {
  const keys = new Set<string>();
  const cardPayment = isCardPaymentUndoRow(row);
  if (typeof row.smsKey === 'string' && row.smsKey && (!cardPayment ||
      (row.smsKey.startsWith('h') && isUsableCaptureSourceIdentity(row.smsKey, row.ts) &&
        !isUnboundAndroidSourceKey(row.smsKey)))) keys.add(row.smsKey);
  if (cardPayment) {
    const scoped = bestEffortCardPaymentObservationKey(row, ledgerCurrency);
    if (scoped) keys.add(scoped);
    return [...keys];
  }
  const observed = bestEffortObservationKey(row.ts, ledgerCurrency, row.amountFils);
  if (observed) keys.add(observed);
  return [...keys];
};

/** Tombstones for every marked row among `removed` (undo, delete, batch undo, account delete). */
export const tombstonesForRemoved = (
  existing: readonly string[] | undefined,
  removed: readonly BestEffortUndoRow[],
  ledgerCurrency: string | null | undefined,
): string[] | undefined => {
  const keys = removed.filter((row) => row.bestEffort).flatMap((row) => bestEffortUndoKeys(row, ledgerCurrency));
  return keys.length > 0 ? appendBestEffortUndo(existing, keys) : undefined;
};

export const appendBestEffortUndo = (existing: readonly string[] | undefined, keys: readonly string[]): string[] => {
  const next = [...(existing ?? []).filter((key) => !keys.includes(key)), ...keys];
  return next.length > BEST_EFFORT_UNDO_CAP ? next.slice(next.length - BEST_EFFORT_UNDO_CAP) : next;
};
