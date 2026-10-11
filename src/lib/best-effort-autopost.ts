import { currencyMinorUnits } from '@/lib/currency-metadata';
import type { FxQuote } from '@/lib/fx';
import { convertForeignConfirmation, quoteFitsDay, type ReferenceConversion } from '@/lib/fx-rates';
import { nonPostingReason } from '@/lib/sms-parser';
import type { BestEffortMarker } from '@/lib/types';
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
 *    cancelled, OTP/verification, promotion, statement/bill/due, scheduled);
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
  /** Ledger currency and exponent; null means not pinned yet. */
  ledgerCurrency: string | null;
  ledgerExponent: number | null;
  /** When the alert was observed (epoch ms), for future-date and rate-day checks. */
  observedAt?: number;
  /** Network-free dated rate lookup (rates already on this device). */
  fxLookup?: (base: string, quote: string, date: string) => FxQuote | null;
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
};

/** Exposed for tests and the settings copy; never a general country→currency map. */
export const sharedSymbolCurrencyForCountry = (country: string | null | undefined): string | null =>
  (country && SHARED_SYMBOL_COUNTRY_CURRENCY[country.toUpperCase()]) || null;

/** Countries whose own banking writes a three-decimal currency with a dot decimal point. */
const THREE_DECIMAL_COUNTRY_CURRENCY: Readonly<Record<string, string>> = {
  KW: 'KWD', BH: 'BHD', OM: 'OMR', JO: 'JOD',
};

const LAUNCH_MARKETS = new Set(['AE', 'SA']);

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
  /\bdeclin(?:e|ed|ing)\b|\bfail(?:ed|ure|s)?\b|\bunsuccessful\b|\bnot\s+(?:been\s+)?(?:processed|completed|successful|approved|authori[sz]ed)\b|\brejected\b|\binsufficient\b|\brefus(?:[ée]e?|ed)?(?!\p{L})|(?<!\p{L})[ée]chou[ée]|\babgelehnt\b|\bfehlgeschlagen\b|\brechazad[oa]\b|\brifiutat[oa]\b|\bnon\s+riuscit[oa]\b|\bgeweigerd\b|\bmislukt\b|\brecusad[oa]\b|\bnegad[oa]\b|مرفوض|رفض|فشل|لم\s+تتم/iu,
  // reversed / cancelled / void
  /\brevers(?:al|ed|e)\b|\bchargeback\b|\bcancel(?:l)?(?:ed|ation)\b|\bvoid(?:ed)?\b|\bannul[ée]|\bstorniert\b|\banulad[oa]\b|\bannullat[oa]\b|\bgeannuleerd\b|\bcancelad[oa]\b|عكس|إلغاء|الغاء|ملغ/iu,
  // OTP / verification / codes
  /\botp\b|\bone[-\s]?time\s+(?:pass(?:word|code)?|code|pin)\b|\bverification\s+code\b|\bsecurity\s+code\b|\bpasscode\b|\bdo\s+not\s+share\b|\bnever\s+share\b|\b2fa\b|\bverify\s+(?:this|the|your)\s+(?:transaction|payment|purchase)\b|\bcode\s+(?:de\s+)?(?:v[ée]rification|s[ée]curit[ée])|\bbest[äa]tigungscode\b|\bc[óo]digo\s+de\s+(?:verificaci[óo]n|seguran[çc]a|verifica[çc][aã]o)\b|\bcodice\s+(?:di\s+)?(?:verifica|sicurezza)\b|رمز\s+(?:التحقق|التفعيل)|كلمة\s+(?:المرور|السر)\s+لمرة/iu,
  // promotions
  /\bcashback\b|\bcash\s+back\b|\bdiscount\b|\b\d{1,3}\s?%\s*off\b|\boffers?\b|\bpromo(?:tion|code)?\b|\bvoucher\b|\bcoupon\b|\bwin\b|\bgiveaway\b|\bredeem\b|\bangebot\b|\brabatt\b|\bpromoci[óo]n\b|\bdescuento\b|\bsconto\b|\bkorting\b|\bdesconto\b|\bpromo[çc][aã]o|عرض|تخفيض/iu,
  // statements / bills / dues / reminders / balance-only
  /\bstatement\b|\bminimum\s+(?:amount\s+)?(?:due|payment)\b|\btotal\s+(?:amount\s+)?due\b|\bamount\s+due\b|\bdue\s+(?:date|on|by)\b|\bpayment\s+due\b|\bbill\s+(?:is\s+)?(?:due|generated|ready)\b|\breminder\b|\boverdue\b|\brelev[ée](?!\p{L})|\bkontoauszug\b|\bextracto\b|\bestratto\s+conto\b|\brekeningoverzicht\b|\bfatura\s+(?:fechada|vence)\b|كشف\s+(?:ال)?حساب|مستحق|تذكير|الحد\s+الأدنى/iu,
  // future / scheduled / mandates
  /\bwill\s+(?:be|have\s+been)\s+(?:debited|charged|deducted|paid|processed|collected|credited)\b|\bscheduled\b|\bupcoming\b|\bstanding\s+(?:instruction|order)\b|\bmandate\b|\bpre-?debit\b|\bauto-?pay\s+(?:set|scheduled|registered)\b|\bsera\s+(?:d[ée]bit[ée]|pr[ée]lev[ée])|\bwird\s+(?:abgebucht|belastet)\b|\bser[áa]\s+(?:cargad[oa]|debitad[oa])\b|\bsar[àa]\s+addebitat[oa]\b|\bwordt\s+afgeschreven\b|سيتم/iu,
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
const LINK = String.raw`(?:https?:\/\/|www\.)([^\s/?#]+)[^\s]*|\b([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,12})\/[^\s]*`;
/**
 * What a smishing text asks the reader to do at its link. The weak verbs
 * (update, log in, sign in, receive, get) are ordinary bank-footer verbs ("Log
 * in: https://www.chase.com", "Update the app: …"); they count only for the
 * person's own details/money or at a bait host.
 */
const STRONG_ACTION = String.raw`dispute|verify|validate|confirm|cancel|claim|collect|unlock|unblock|reactivate|restore|redeem|reverse|accept`;
const WEAK_ACTION = String.raw`update|log\s?in|sign\s?in|receive|get`;
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
  // Fraud and verification prompts beside the money sentence.
  // A security code, or a bare "Code 123456"; an auth/approval/merchant/MCC
  // code is a receipt field, not a challenge.
  /\bdid\s+you\s+(?:authori[sz]e|make|attempt|use)\b|\breply\s+(?:y|yes|n|no|1|2)\b|(?<!\b(?:if|in\s+case|should)\b[^.!?\n]{0,40})\brecogni[sz]e\b|\bflagged\b|\bheld\b|\b(?:otp|one[-\s]time|verification|security)\s+code\b|(?<!\b(?:auth|authori[sz]ation|approval|merchant|branch|postal|zip|sort|mcc|promo|category|reference|ref)\s+)\bcode\s*:?\s*\d{4,}\b/iu,
  // An unnamed payer ("Somebody paid you $500!") or a question about it.
  /\b(?:someone|somebody|anyone|anybody|a\s+friend)\s+(?:has\s+)?(?:paid|sent)\s+you\b|\b(?:if|whether)\s+(?:they|he|she|you|[\p{L}]+)\s+(?:have\s+|has\s+)?(?:paid|sent)\s+you\b/iu,
  /(?:^|[.!?\n:]\s*)(?:has|have|did|does|do|is|was|were)\s+(?:[^.!?\n]|\.\d){0,80}?\d(?:[^.!?\n]|\.\d){0,40}\?/iu,
  /(?:^|[.!?\n:]\s*)(?:if|when|once|unless)\b(?:[^.!?\n]|\.\d){0,80}?\b(?:paid|made|sent|received|charged|spent|debited|credited)\b(?:[^.!?\n]|\.\d){0,40}?(?:[$€£₹]\s?\d|\b[A-Z]{3}\s?\d)/iu,
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
  /\border\s*(?:#|no\.?|number|id)\s*[:.-]?\s*[A-Z0-9-]*\d[\s\S]{0,80}?\b(?:paid|payment)\b|\b(?:paid|payment)\b[\s\S]{0,40}?\border\s*(?:#|no\.?|number|id)\s*[:.-]?\s*[A-Z0-9-]*\d/iu,
  /\b(?:money\s+market|unit\s+trust|mutual|investment)\s+fund\b[\s\S]{0,120}?\b\d[\d,.]*\s+units\b/iu,
];

/**
 * "You paid $4,493.74 to your Venture X Card…(9792)": a payment to the
 * person's own card settles earlier purchases, so posting it as an ordinary
 * movement counts them twice. The universal reader does not recognise this
 * wording as a card payment, so it is simply not auto-posted. The card is a
 * named product ("… to your Venture X Card", "… to your credit card"), never
 * "to your friend using your debit card".
 */
const OWN_CARD_PAYMENT = /\b(?:[Yy]ou\s+)?paid\b(?:[^.\n]|\.\d){0,40}?\bto\s+your\s+(?:(?:[A-Z][\p{L}\p{N}&.'’-]*|credit|charge)\s+){0,4}?[Cc]ard\b/u;

/**
 * Never auto-posted by the unverified-format policy or a certified template:
 * a smishing link call-to-action, wording that withdraws the money sentence,
 * or money that is not a new movement. Deliberately NOT part of
 * hasNonCompletedWording, which also gates user-taught (learned) templates in
 * every market: those keep their own, older contract. Such a message is not
 * auto-added; whether it then reaches Review is the refusal inspector's
 * decision (on the iPhone History path most of these are simply not imported).
 */
export const isNotAutoPostableMoney = (source: string): boolean =>
  hasLinkCallToAction(source) || NOT_A_SETTLED_FACT.some((pattern) => pattern.test(source)) ||
  NOT_A_NEW_MOVEMENT.some((pattern) => pattern.test(source));

export const hasNonCompletedWording = (source: string): boolean =>
  nonPostingReason(source) !== null || NON_COMPLETED_WORDING.some((pattern) => pattern.test(source)) ||
  TEMPORARY_HOLD.test(source) || (AUTHORISATION.test(source) && !COMPLETED.test(source));

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
const resolvePrincipalMoney = (
  source: string,
  event: UniversalBankEvent,
  country: string | null,
  routedMarket: string | null,
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
  // that exact case resolves: one currency, two readings,
  // the grouping reading exactly 1000x it, and the figure written with a
  // FULL STOP (a comma stays ambiguous).
  const localThreeDecimal = THREE_DECIMAL_COUNTRY_CURRENCY[(routedMarket ?? country ?? '').toUpperCase()];
  const figure = field.spans.length === 1 ? source.slice(field.spans[0].start, field.spans[0].end) : '';
  const [decimal, grouped] = [...field.alternatives].sort((a, b) => a.minorUnits.length - b.minorUnits.length);
  if (localThreeDecimal && field.issues.length > 0 && field.issues.every((issue) => issue === 'decimal-or-grouping') &&
    field.value === null && field.alternatives.length === 2 &&
    /^[^,]*\d\.\d{3}(?!\d)[^,]*$/.test(figure) &&
    validMoney(decimal) && decimal.currency === localThreeDecimal && grouped?.currency === localThreeDecimal &&
    BigInt(grouped.minorUnits) === BigInt(decimal.minorUnits) * 1000n) {
    return decimal;
  }
  // Otherwise only a currency-symbol ambiguity may be resolved. Any other
  // doubt (two numbers, a role question) stays with the person.
  const symbolOnly = field.issues.length > 0 &&
    field.issues.every((issue) => issue === 'currency-symbol' || issue === 'currency-exponent');
  if (!symbolOnly) return 'amount-unclear';
  const wanted = routedMarket
    ? sharedSymbolCurrencyForCountry(routedMarket)
    : sharedSymbolCurrencyForCountry(country);
  if (!wanted) return 'currency-unclear';
  const options = [...(field.value ? [field.value] : []), ...field.alternatives]
    .filter((money) => money && money.currency === wanted);
  const distinct = new Set(options.map((money) => `${money.minorUnits}/${money.exponent}`));
  if (distinct.size !== 1 || !validMoney(options[0])) return 'currency-unclear';
  return options[0];
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
      .filter((money) => !statedLedger(money));
    // A symbol ambiguity lists every candidate currency for the same figure.
    if (others.some((money) => money.minorUnits !== principal.minorUnits &&
      currencyMinorUnits(money.currency) === principal.exponent)) return true;
  }
  return principals !== 1;
};

const LAUNCH_ROUTE = (market: string | null | undefined): boolean => !!market && LAUNCH_MARKETS.has(market);

/** The single decision for an unproven format. Pure: no storage, no network. */
export function decideBestEffortAutoPost(input: BestEffortInput): BestEffortDecision {
  const review = (reason: BestEffortRefusal): BestEffortDecision => ({ outcome: 'review', reason });
  const { event } = input;
  if (!input.enabled) return review('disabled');
  if (LAUNCH_ROUTE(input.routedMarket) || LAUNCH_ROUTE(input.launchSenderMarket ?? null)) {
    return review('launch-market');
  }
  if (!event || event.version !== 1 || event.decision !== 'review' || event.status !== 'posted') {
    return review('not-posted');
  }
  if (typeof input.source !== 'string' || hasNonCompletedWording(input.source) || isNotAutoPostableMoney(input.source)) {
    return review('non-posting-wording');
  }
  if (!POSTABLE_FAMILIES.has(event.family) || OWN_CARD_PAYMENT.test(input.source)) return review('unsupported-family');
  if (!directionMatchesFamily(event)) return review('direction-unclear');
  if (event.issues.some((issue) => BLOCKING_ISSUES.has(issue))) {
    return review(event.issues.some((issue) => issue.startsWith('direction')) ? 'direction-unclear' : 'not-posted');
  }

  const principal = resolvePrincipalMoney(input.source, event, input.country, input.routedMarket);
  if (typeof principal === 'string') return review(principal);
  if (hasCompetingAmounts(event, principal, input.ledgerCurrency)) return review('competing-amounts');

  const observedDay = localIsoDay(input.observedAt);
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

/** Every identity a rescan of the same alert could plan the row under. */
export const bestEffortUndoKeys = (
  row: { smsKey?: string; ts?: number; amountFils: number },
  ledgerCurrency: string | null | undefined,
): string[] => {
  const keys = new Set<string>();
  if (typeof row.smsKey === 'string' && row.smsKey) keys.add(row.smsKey);
  const observed = bestEffortObservationKey(row.ts, ledgerCurrency, row.amountFils);
  if (observed) keys.add(observed);
  return [...keys];
};

/** Tombstones for every marked row among `removed` (undo, delete, batch undo, account delete). */
export const tombstonesForRemoved = (
  existing: readonly string[] | undefined,
  removed: readonly { bestEffort?: unknown; smsKey?: string; ts?: number; amountFils: number }[],
  ledgerCurrency: string | null | undefined,
): string[] | undefined => {
  const keys = removed.filter((row) => row.bestEffort).flatMap((row) => bestEffortUndoKeys(row, ledgerCurrency));
  return keys.length > 0 ? appendBestEffortUndo(existing, keys) : undefined;
};

export const appendBestEffortUndo = (existing: readonly string[] | undefined, keys: readonly string[]): string[] => {
  const next = [...(existing ?? []).filter((key) => !keys.includes(key)), ...keys];
  return next.length > BEST_EFFORT_UNDO_CAP ? next.slice(next.length - BEST_EFFORT_UNDO_CAP) : next;
};
