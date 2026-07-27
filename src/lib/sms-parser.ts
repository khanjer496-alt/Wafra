import { getActiveMarket } from '@/lib/markets';
import type { CategoryId, TransactionType } from '@/lib/types';

export interface ParsedCard {
  last4: string;
  kind: 'credit' | 'debit' | 'account';
}

/**
 * Bump whenever a parsing rule changes in a way that would read an ALREADY
 * IMPORTED message differently.
 *
 * A message is imported once — its fingerprint is remembered so it can never
 * arrive again — and the routine scan only ever looks at messages newer than
 * the last one it saw. So without this, every parser improvement applies only
 * to the future: the card payments a user has already received stay filed as
 * spending forever, however well the parser learns to read them.
 *
 * When this differs from the version recorded in state, the next scan re-reads
 * the whole inbox instead of the tail. Existing rows are not duplicated —
 * `seenSms` recognizes them by fingerprint — they are healed in place.
 */
export const PARSER_VERSION = 5;

export type SnapshotKind = 'balance' | 'limit' | 'outstanding';

export interface ParsedSms {
  /**
   * transaction — money moved; billDue — a payment reminder;
   * cardStatement — credit card statement with a due date;
   * cardPayment — payment received toward a credit card (a transfer, not spending).
   */
  kind: 'transaction' | 'billDue' | 'cardStatement' | 'cardPayment';
  type: TransactionType;
  amountFils: number;
  merchant: string;
  /** ISO date if the message contained one, otherwise null (caller defaults to today). */
  date: string | null;
  /** For billDue/cardStatement: the day of month it's due, when present. */
  dueDay: number | null;
  /** For cardStatement: minimum amount due, when present. */
  minDueFils: number | null;
  /** Card/account the message refers to, when identifiable. */
  card: ParsedCard | null;
  /** Bank-side leg of a card payment / own-account transfer: money moved, not spent. */
  transferHint: boolean;
  /** Balance / available-limit / outstanding figure the bank quoted, if any. */
  snapshotFils: number | null;
  snapshotKind: SnapshotKind | null;
  categoryGuess: CategoryId;
  /**
   * True when `categoryGuess` was DECIDED — by a vocabulary rule, a user
   * override, or a branch that knows what the row is. Absent when it is the
   * untouched fall-through default.
   *
   * It exists because `other` means two opposite things. A brokerage or a
   * crypto on-ramp is mapped to `other` on purpose (that money moved, it was
   * not spent), and so is a card settlement or a transfer between the user's
   * own accounts. Those rows are understood. A row that merely failed every
   * rule is not. The accuracy report treats an uncategorized row as a format
   * it could not read, which made every eToro and Capital.com purchase look
   * like a parser failure — 30-odd of them in one export.
   */
  categoryDeliberate?: boolean;
  raw: string;
}

const CREDIT_WORDS = /credit(?:ed)?|received|salary|refund(?:ed)?|deposit(?:ed)?|transferred to your/i;
// DEBIT_WORDS is market-compiled below (its payment guard embeds the currency).
const BILL_DUE_WORDS = /\bdue\s+(?:on|by|date)\b|\bbill\b.*\b(?:due|generated|payable)\b|\bbill amount\b|\bpay\s+by\b|\bpayment\s+due\b|\bmin(?:imum)?\s+(?:amount\s+)?due\b/i;
const BILL_MERCHANT_RE = /(?:your|the)\s+([A-Za-z0-9][A-Za-z0-9 &.'\-]{1,30}?)\s+bill\b/i;

/** Credit-card statement: has "statement"/"total due" language plus a card reference. */
const STATEMENT_RE =
  /statement|total\s+(?:amount\s+)?due|total\s+billed\s+am(?:oun)?t|min(?:imum)?\s+payment\s+of|outstanding\s+(?:amount|balance)\s+of/i;
/** Purchase-style verbs that disqualify the statement branch (NOT "paid"). */
const STATEMENT_TXN_BLOCK_RE = /purchase|was used|charged|withdraw|debited|spent/i;
/** Payment INTO a card: settles dues rather than spending. */
// CARD_PAYMENT_RE is market-compiled below.

/** OTP / verification messages describe an ATTEMPT, not a completed transaction. */
const OTP_RE = /\botp\b|one[\s-]?time\s+(?:password|pin|code)|verification code|auth(?:oris|oriz)ation code|do not share|never share/i;
/**
 * Pre-auth holds are not postings; the real charge arrives as its own SMS.
 *
 * `hold` is word-bounded on the left. Without the boundary it matched inside
 * HOUSEHOLD, LEASEHOLD and THRESHOLD — "HOUSEHOLD OF ..." is `hold of` — and a
 * refusal is silent, so a purchase at a shop named that way would never appear
 * in spending at all. The app's own shopping vocabulary lists `house ?hold`,
 * so those descriptors are expected in a UAE inbox.
 */
const PREAUTH_RE = /pre-?auth|amount\s+(?:has been\s+)?blocked|\bhold\s+(?:of|amount|placed)|temporary\s+hold/i;
const DECLINED_RE = /declin|unsuccessful|insufficient|could not be (?:processed|completed)|has failed/i;
/**
 * "Reversed" is two different events wearing one word.
 *
 * At the terminal it means the transaction failed and no money moved: nothing
 * to import, which is why the word sat in DECLINED_RE. Afterwards it means the
 * bank has taken a charge BACK and put the money in the account — a chargeback
 * on a fraudulent purchase is exactly this — and that is money arriving.
 *
 * The blanket refusal discarded the second kind. The cost is not a missing
 * row: the fraudulent charge is already in the ledger, the credit that undoes
 * it never lands, and the user is charged for the fraud twice — once by the
 * criminal and once by us. It cannot be healed either, because a refused
 * message leaves no row to heal; only a full re-read recovers it, which is
 * what PARSER_VERSION is for.
 *
 * The discriminator is the wording the refund path ALREADY reads as income —
 * no new vocabulary, and deliberately not CREDIT_WORDS, whose bare `credit`
 * matches the "Credit Card" in nearly every message the bank sends.
 */
const REVERSED_RE = /\breversed\b/i;
/** A refund reverses spending: money coming back IN. */
const REFUNDED_TO_RE = /refunded to your (?:card|account)/i;
/** "credited to your account" settles the direction on its own. */
const CREDITED_IN_RE = /credited to your (?:account|a\/c)\b/i;
/**
 * The two wordings above, generalised over both nouns: what the file already
 * reads as money coming back, said about a card as readily as an account.
 *
 * ONLY ever consulted alongside `reversed`, and that gate is what makes it
 * safe. On its own "credited to your Credit Card" is what a card SETTLEMENT
 * says — money going out to pay a bill — and reading it as income anywhere
 * else would undo the cardPayment branch. A message that says both `reversed`
 * and `credited to your card` is a chargeback, which is the shape that
 * matters here: the fraud was on a credit card, so the credit that undoes it
 * lands on the card and not on an account.
 */
const CAME_BACK_RE =
  /(?:refunded|credited)\s+(?:back\s+)?to\s+your\s+(?:\w+\s+)?(?:card|account|a\/c)\b/i;
/** A reversal that says the money came back — a chargeback, not a decline. */
function reversedCredit(raw: string): boolean {
  return REVERSED_RE.test(raw) && CAME_BACK_RE.test(raw);
}
const PROMO_RE =
  /cashback|voucher|promo|discount|t&cs?\b|terms apply|conditions apply|shop now|hurry|limited time|congratulations|you (?:could|can) win|opt-?out|\bdnd\d*\b|bit\.ly|wa\.me|tinyurl|payment plan|bonus|rewards? (?:on|program|draw)|earn \d+x|https?:\/\//i;
/**
 * Evidence that money ACTUALLY moved — banks append promo footers to real
 * alerts ("...Avl Bal AED 5,376. 0% instalments... bit.ly/..."), so promo
 * markers alone must not discard a message that shows a transaction.
 *
 * This is the ONLY escape hatch from PROMO_RE, and PROMO_RE is a list of bare
 * stems: `promo`, `bonus`, `discount`, `voucher`, `cashback`. Those are shop
 * names as readily as they are marketing words — Promod is a fashion chain
 * with UAE mall stores — so any purchase whose descriptor happens to contain
 * one is refused outright unless something here recognises the format. A
 * refused message leaves no row at all: the charge never reaches Out and there
 * is nothing to heal later.
 *
 * Two of the biggest formats in the corpus had no entry here, which is 14
 * distinct messages / 56 occurrences carrying no evidence of any kind:
 *
 *   "Payment for CARIBOU COFFEE of AED 26.00 has been made using Credit Card
 *    ending with 4110. Available limit AED 63,155.07."
 *                      — "has been made using", and the balance is labelled
 *                        "Available limit", which `available (balance|credit)`
 *                        did not cover
 *   "Debit Card Purchase / Card XXXX5083 / AED 53.58 / MARK AND SAVE Dubai AE
 *    / 19/02/26 15:45 / Balance AED 1780.67"
 *                      — the header says "Debit Card Purchase", not "purchase
 *                        of", and the balance line is a bare "Balance"
 *
 * Widening this can only ever RESCUE a message: it is consulted at the promo
 * gate alone, and everything it lets through still has to carry a debit or
 * credit verb and yield a readable amount before a row is produced.
 */
const TXN_EVIDENCE_RE =
  /purchase (?:of|amount)|(?:debit|credit)\s+card\s+purchase|was used for|has been made using|has been (?:debited|deducted|credited|received)|debited from|deducted from|credited to|withdraw|avl\.?\s*(?:bal|cr|limit)|available\s+(?:balance|credit|limit)|bill amount|payment due|due (?:on|by|date)|pay by/i;

/**
 * Currency-bound patterns compile from the ACTIVE MARKET's currency aliases
 * (AED/Dhs for the UAE, SAR/SR for Saudi...) and are lazily recompiled when
 * the market changes. Everything else in the grammar is market-agnostic.
 */
let AED_AMOUNT_RE = /x^/g;
let AED_SUFFIX_RE = /x^/g;
let MIN_DUE_RE = /x^/;
let TOTAL_DUE_RE = /x^/;
let OUTSTANDING_RE = /x^/;
let CARD_PAYMENT_RE = /x^/;
let DEBIT_WORDS = /x^/;
let PAYMENT_FOR_RE = /x^/;
let FX_PREFIX_RE = /x^/;
let FX_SUFFIX_RE = /x^/;
let compiledForMarket = '';

/** Units of each currency per 1 USD — cross rates derive from this table. */
const UNITS_PER_USD: Record<string, number> = {
  USD: 1, AED: 3.6725, SAR: 3.75, EUR: 0.85, GBP: 0.74, QAR: 3.64,
  KWD: 0.307, BHD: 0.377, OMR: 0.385, INR: 83.5, PKR: 283, PHP: 56,
  EGP: 48, CAD: 1.37, AUD: 1.52, JPY: 150, CNY: 7.2, CHF: 0.8, TRY: 41,
};

function ensureCurrencyPatterns(): void {
  const m = getActiveMarket();
  if (compiledForMarket === m.id) return;
  compiledForMarket = m.id;
  const CUR = m.currency.aliases.join('|');
  AED_AMOUNT_RE = new RegExp(`(?:${CUR})\\s*([\\d,]+(?:\\.\\d{1,2})?)`, 'gi');
  AED_SUFFIX_RE = new RegExp(`([\\d,]+(?:\\.\\d{1,2})?)\\s*(?:${CUR})(?![A-Za-z])`, 'gi');
  MIN_DUE_RE = new RegExp(
    `min(?:imum)?\\s+(?:(?:amount\\s+)?due(?:\\s+amount)?|payment(?:\\s+of)?)\\s*(?:of|:|is)?\\s*(?:${CUR})\\s*([\\d,]+(?:\\.\\d{1,2})?)`, 'i');
  TOTAL_DUE_RE = new RegExp(
    `total\\s+(?:amount\\s+due|due|billed\\s+am(?:oun)?t)\\s*(?:is|:)?\\s*(?:${CUR})\\s*([\\d,]+(?:\\.\\d{1,2})?)`, 'i');
  OUTSTANDING_RE = new RegExp(
    `\\boutstanding(?:\\s+(?:amount|balance))?\\s*(?:is|:|of)?\\s*(?:${CUR})?\\s*([\\d,]+(?:\\.\\d{1,2})?)`, 'i');
  // Money arriving ON a credit card. Getting this wrong is expensive in a way
  // that is invisible: a payment that misses this test is still imported, but
  // as an EXPENSE carrying a transfer hint — and `allocatePayments` only ever
  // credits income-side transfers, so the statement stays open and the app
  // goes on saying a paid card is overdue.
  //
  // Three shapes below were doing exactly that. They are ordinary UAE bank
  // messages; only the word order differs from the ones already handled:
  //
  //   "Your payment instructions of AED 7,663.94 to 5492********3749 has been
  //    processed"           — the target is a masked PAN, and "processed"
  //                           comes after it rather than before
  //   "AED 4,061.69 has been deducted from your account 095XXX11XXX01 towards
  //    payment of your Credit Card ending 8575"
  //                         — "towards payment of ... card", not
  //                           "payment ... towards card"
  //   "...towards settlement of your card ..."
  //
  // The masked-PAN branch requires a run of at least twelve digit-or-mask
  // characters, so "payment instructions of AED 417.90 to Du for consumer
  // number 1238865" stays a utility bill — that message is handled earlier
  // anyway, and this keeps the two from ever competing.
  CARD_PAYMENT_RE = new RegExp(
    [
      `payment\\s+(?:of\\s+(?:${CUR})\\s*[\\d,.]+\\s+)?(?:is\\s+|was\\s+|has\\s+been\\s+)?(?:received|credited|processed)\\s+(?:towards?|to|on|for)\\s+(?:your\\s+)?(?:\\w+\\s+)?(?:credit\\s+)?card`,
      `payment\\s+of\\s+(?:${CUR})\\s*[\\d,.]+\\s+against\\s+(?:your\\s+)?credit\\s+card`,
      `received\\s+payment\\s+for\\s+your\\s+(?:credit\\s+)?card`,
      `thank you for (?:your )?payment.*card`,
      `card\\s+(?:no\\.?\\s*)?[\\dXx*•]*\\s*has\\s+been\\s+paid`,
      // "payment instructions of AED 7,663.94 to 5492********3749"
      `payment\\s+instructions?\\s+of\\s+(?:${CUR})?\\s*[\\d,.]+\\s+to\\s+[\\dXx*•]{12,}`,
      // "...towards payment/settlement of your Credit Card ending 8575"
      `towards?\\s+(?:the\\s+)?(?:payment|settlement|repayment)\\s+of\\s+(?:your\\s+)?(?:\\w+\\s+)?(?:credit\\s+)?card`,
    ].join('|'), 'i');
  // "Payment for GINNYS PLUS TRADING of AED 2.25 has been made using Credit
  // Card ending with 4110." The payee sits BEFORE the amount with none of the
  // prepositions MERCHANT_RE looks for, so every message in this format
  // arrived titled "Card purchase" — a third of one user's unread report, and
  // rows that could never group into a merchant or a subscription.
  PAYMENT_FOR_RE = new RegExp(
    `payment\\s+for\\s+([A-Za-z0-9][^\\n]{1,48}?)\\s+of\\s+(?:${CUR})\\s*[\\d,]`, 'i');
  DEBIT_WORDS = new RegExp(
    `purchase|debit(?:ed)?|deducted|spent|paid|payment(?!\\s+(?:due|of\\s+(?:${CUR})[\\d,. ]+(?:is\\s+)?received))|withdraw(?:n|al)?|was used|charged`, 'i');
  const codes = Object.keys(UNITS_PER_USD).filter((c) => c !== m.currency.code).join('|');
  FX_PREFIX_RE = new RegExp(`\\b(${codes})[^\\S\\r\\n]*([\\d,]+(?:\\.\\d{1,2})?)`, 'i');
  // Same line only. "Card No XXXX4777 \n USD .00" used to read the card's last
  // four digits as USD 8,722 and file a 32,031.55 purchase for a message whose
  // amount was masked out entirely.
  FX_SUFFIX_RE = new RegExp(`([\\d,]+(?:\\.\\d{1,2})?)[^\\S\\r\\n]*(${codes})\\b`, 'i');
}

/**
 * Banks redact the leading digits of a figure: "Avl Bal AED ····9235.93",
 * "AED ····0000.00", "Card No XXXX4777". What survives is a FRAGMENT, not the
 * number. Reading it recorded a 9,235.93 balance for an account that might
 * hold 129,235.93, so any figure whose digits are preceded by a mask run is
 * unknowable and gets dropped rather than guessed.
 */
const MASKED_PREFIX_RE = /(?:[·•*]|[Xx]{3,})[^\S\r\n]*$/;
function isMaskedFigure(raw: string, index: number): boolean {
  return MASKED_PREFIX_RE.test(raw.slice(Math.max(0, index - 12), index));
}

/** Minor units of the ACTIVE currency per 1 unit of `code`. */
function fxMinorPerUnit(code: string): number {
  const mine = UNITS_PER_USD[getActiveMarket().currency.code] ?? 1;
  const theirs = UNITS_PER_USD[code];
  return (mine / theirs) * 100;
}
/**
 * Foreign-currency fallback: online subscriptions (ChatGPT, Claude, PayPal
 * charges...) often arrive as "USD 20.00" with no local-currency figure at
 * all. Rather than dropping the transaction, convert with an approximate
 * cross rate into the active market's currency. A local amount anywhere in
 * the message always wins over conversion.
 */
function extractForeignAmountFils(raw: string): number | null {
  const pre = raw.match(FX_PREFIX_RE);
  const suf = pre ? null : raw.match(FX_SUFFIX_RE);
  const code = (pre?.[1] ?? suf?.[2])?.toUpperCase();
  const num = pre?.[2] ?? suf?.[1];
  if (!code || !num || !(code in UNITS_PER_USD)) return null;
  // Where the digits start: after the code for the prefix form, at the match
  // for the suffix form.
  const at = pre ? (pre.index ?? 0) + pre[0].length - num.length : (suf?.index ?? 0);
  if (isMaskedFigure(raw, at)) return null;
  const fils = Math.round(Number(num.replace(/,/g, '')) * fxMinorPerUnit(code));
  if (!Number.isFinite(fils) || fils <= 0 || fils > MAX_PLAUSIBLE_AMOUNT_FILS) return null;
  return fils;
}
/**
 * A single SMS transaction above AED 1,000,000 is almost certainly a misread
 * balance, loan figure, or reference number — never spending.
 */
const MAX_PLAUSIBLE_AMOUNT_FILS = 100_000_000;
const BALANCE_PREFIX_RE = /(?:bal(?:ance)?|avl|avail(?:able)?|limit|outstanding|total)\s*(?:is|:|\.|-)?\s*$/i;

/** Card identity: "Credit Card ending 1234", "Debit Card ..5678", "a/c XX9012", "card no. *1234". */
const CARD_RE = /(credit|debit)?\s*card(?:\s*(?:no\.?|number))?\s*(?:ending(?:\s+(?:in|with))?|\.\.+|x+|\*+)?\s*(\d{4})\b/i;
const ACCOUNT_RE =
  /a\/?c(?:count)?\s*(?:no\.?|number)?\s*(?:ending(?:\s+in)?|\.\.+|x+|\*+|[·•]+)?\s*(\d{4})\b/i;
/** Fully masked PAN like "4782********4833" — the LAST four digits identify the card. */
const MASKED_PAN_RE = /\b\d{4,6}[Xx*•]{2,}(\d{4})\b/;

const MERCHANT_STOP =
  String.raw`(?=\s*(?:,|\.|;|\bon\b|\bwith\b|\busing\b|\bvia\b|\bending\b|\bcard\b|\ba\/c\b|\bacc(?:ount)?\b|\bref\b|\btxn\b|\bdated\b|\bavl\b|\bavail(?:able)?\b|\bbal(?:ance)?\b|\botp\b|\bfor\b|\bis\b|\bhas\b|\bhave\b|\bwas\b|\bwill\b|\baed\b|\bdhs\b|\bsar\b|\busd\b|\beur\b|\bgbp\b|$))`;
// "%" leads a real brand ("% ARABICA"); "·•" appear inside acquirer terminal
// IDs ("BLOOMFIELD TREAT-····5814"). Both used to break the match outright and
// cost the whole merchant name.
const MERCHANT_RE = new RegExp(
  // The optional domain tail keeps "CAPITAL.COM" and "Name.com, Inc" whole —
  // MERCHANT_STOP treats "." as a sentence end, so both used to arrive as
  // "Capital" and "Name".
  String.raw`(?:\bat|\bto|\bfrom|@)\s+([A-Za-z0-9%][A-Za-z0-9%·• &'\-*/()]{1,40}?(?:\.(?:com|ae|net|org|io|co)\b)?)` +
    MERCHANT_STOP,
  'gi',
);
/**
 * Acquirer terminal ID glued to the descriptor: "GALADARI ICE CRE-151022".
 *
 * The version of this that only matched "····" was chasing a ghost: those dots
 * are the accuracy REPORT's own masking of digit runs, applied on export, not
 * something any bank sends. On the device the text is plain digits, so the
 * rule never fired where it mattered and "Bloomfield Treat-245814" stayed
 * split from "Bloomfield Treat".
 */
const TERMINAL_ID_RE = /[-\s]+(?:[·•X]{2,}\d*|\d{4,})$/i;

const DATE_RE = /\b(?:on|by|before|is)\s+(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/i;
// "03/07/26 05:53" — a bare date WITH a time is the transaction timestamp and
// beats any "statement due on <date>" footer later in the message.
const DATETIME_RE = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\s+\d{1,2}:\d{2}(?!\d)/;
// HSBC opens every alert with the transaction date run together, no
// separators: "From HSBC: 24JUN25 DUBAI INTEGRATED ECO Purchase from...".
// Nothing else in the grammar could read it, so a quarter of the messages in
// the first accuracy export carried no date at all and were filed on the day
// they happened to be imported. Anchored to the bank's own prefix, because a
// bare \d\d[A-Z]{3}\d\d would find that shape inside reference numbers.
const HSBC_DATE_RE = /\bfrom\s+hsbc:\s*(\d{1,2})([A-Za-z]{3})(\d{2})\b/i;

const ATM_RE = /\batm\b|cash\s+withdrawal|\bwithdrawn\b/i;
const FEE_RE = /\bfees?\b|\bcharges?\s+(?:of|:)|service charge|\bvat\b|annual membership/i;
const DEPOSIT_RE = /cash\s+deposit|\bcdm\b|deposit(?:ed)?\s+(?:in|into|to)\b/i;

/**
 * Multi-line bank formats put the merchant on its own line with no
 * preposition at all:
 *   Credit Card Purchase / Card No XXXX4711 / EUR 2.99 /
 *   ALLDEBRID.COM MONTROUGE FRA / 03/07/26 05:53 / Avl Bal AED 13107.74
 * The first line after the amount line that isn't a date, card, or balance
 * line is the merchant descriptor.
 */
// "purchase" is deliberately NOT bare: real descriptors contain it
// ("WL *STEAM PURCHASE"), and dropping those lines cost the merchant. The
// plural form and the "card purchase" header are the noise.
const LINE_NOISE_RE =
  /\bcard\b|a\/?c\b|\baccount\s+(?:no|number|xx)|\bbal(?:ance)?\b|\blimit\b|statement|\bdue\b|payment\s+channel|\bpayment\b(?!\s*[A-Za-z])|purchases\b|purchase\s+of\b|debited|credited|\botp\b|\bref(?:erence)?\b|\btxn\b|\bavl\b|avail|value date|^date\b|paid upto|transaction\s+(?:date|time|id|ref)|mode\s+of\s+payment|amount\s+(?:due|paid)|^remaining\b/i;
const LINE_DATE_RE = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/;
const TRAILING_PLACE_RE =
  /\s+(?:DXB|DUBAI|ABU DHABI|SHARJAH|AJMAN|ARE|UAE|FRA|USA|GBR|DEU|NLD|ESP|ITA|IRL|SGP|HKG|IND|SAU|KSA|LUX|CAN|AUS|CHE|SWE|POL|JPN|RIYADH|JEDDAH|QAT|GHA|KWT|BHR|OMN|JOR|LBN|EGY|TUR|THA|MYS|KOR|CHN|PAK|LKA|PHL|BGD|ZAF|KEN|NGA|MAR|GRC|PRT|BEL|AUT|DNK|NOR|FIN|CZE|RUS|BRA|MEX|NZL|VNM|IDN|TWN|MCO|LIE)$/i;

/**
 * Emirates and cities acquirers append to the descriptor field.
 *
 * The stray-letter allowance only applies when the place is SEPARATED from
 * the name ("AL NIMAR AL ABYADHd SHARJAH" — acquirer corruption). Allowing it
 * on a glued place ate the real last character of every truncated name:
 * "FRIENDS AVENUE CATERINDUBAI" came back as "Friends Avenue Cateri".
 */
/**
 * ...and RAK is split out because three letters glued to a name is not a
 * place, it is the end of an Arabic word. AL MUBARAK came back as "Al Muba"
 * and NEW BURAK as "New Bu". Ras Al Khaimah written out is long enough to be
 * unambiguous either way.
 */
const PLACE_TAIL_RE =
  /(?:(?:[-\s]+[A-Za-z]?)?(?:DXB|DUBAI|ABU ?DHABI|SHARJAH|AJMAN|FUJAIRAH|UMM AL QUWAIN|AL AIN|RAS AL KHAIMAH?)|[-\s]+RAK)$/i;

/**
 * Strips the noise an acquirer wraps around a merchant name.
 *
 * The descriptor is a fixed-width field, so the city is regularly glued
 * straight onto a truncated name with no separator at all — "DUBAI INTEGRATED
 * ECONODUBAI", "FRIENDS AVENUE CATERINDUBAI", "Ziina  *CLEANTIZER SERDubai".
 * Splitting only on whitespace left the emirate inside the merchant, so the
 * same shop arrived under a different name from every bank that reported it
 * and no merchant override could ever cover them all.
 */
function cleanDescriptor(name: string): string {
  let out = name
    .replace(/\s*\([^)]*\)?\s*/g, ' ') // "noon Food(Noon ECommerce)" → "noon Food"
    // Leading acquirer terminal id, masked on export: "····8730 TGI FRIDAYS".
    .replace(/^[·•X]{2,}\d*\s+/i, '')
    .replace(/^(?:pos|tap|wl|sq|alp|eig|web|google|paypal|apl|amzn|mamo|ziina)\s*\*\s*/i, '')
    // Google bills through a help URL, not a location: "GOOGLE*FINART AI EXPE
    // G.CO/HELPPAY#CA US".
    .replace(/\s+G\.CO\/\S+(?:\s+[A-Za-z]{2,3})?$/i, '')
    .replace(TERMINAL_ID_RE, '') // "BLOOMFIELD TREAT-····5814"
    .replace(/[\s,]*\+[\d·•X\s-]{6,}$/i, '') // "MUZZ LTD +····1111"
    .trim();
  // The acquirer's country field, when that is what it is. A country code
  // follows a WHOLE word: in "TOYS R US" and "HOMES R US" the US is the shop's
  // own name, and stripping it left "Toys R" — a name no override or merchant
  // grouping could ever match, for a chain the category vocabulary already
  // knows by its full name.
  const country = out.match(/([-\s]*)\b(?:AE|ARE|UAE|BH|BHR|SA|KSA|US|USA|GB|IN)$/i);
  if (country) {
    const upTo = (country.index ?? 0) + country[1].length;
    if (!/(?:^|[-\s])[A-Za-z][-\s]*$/.test(out.slice(0, upTo))) {
      out = out.slice(0, country.index ?? 0).trim();
    }
  }
  // Peel repeatedly: "TGI FRIDAYS DUBADUBAI" carries two. Never peel a name
  // down to nothing — a shop really can be called Dubai something.
  let prev = '';
  let peeledPlace = false;
  while (prev !== out) {
    prev = out;
    const peeled = out.replace(PLACE_TAIL_RE, '').trim();
    if (peeled !== out && (peeled.match(/[A-Za-z]/g) ?? []).length >= 3) {
      out = peeled;
      peeledPlace = true;
    }
  }
  // "AL NIMAR AL ABYADHdSHARJAH" → the lone lowercase letter left behind by
  // the peel is acquirer corruption, not the end of the name.
  if (peeledPlace && /[A-Z][a-z]$/.test(out)) out = out.slice(0, -1).trim();
  // A reference label the number was stripped from is not part of the name:
  // "FBINTER NO.-991" leaves "Fbinter No", "MOBILE NO." leaves "Mobile No".
  // Only ever a trailing word, and never the whole of one — "NO FRILLS" keeps
  // its first word because there is something after it.
  out = out.replace(/\s+(?:no|ref|id|acct?|a\/c)\.?$/i, '').trim();
  return out.replace(/(?:\s+COM|\.com)$/i, '').trim();
}

/**
 * The candidate descriptor lines of a multi-line alert, in order: everything
 * after the amount line that is not a date, a card/balance label, or another
 * amount.
 *
 * Split out of `merchantFromLines` so the location check reads the acquirer's
 * fields the same way the merchant does. Two readers of one format that
 * disagree about which line is which is how a parser starts contradicting
 * itself.
 */
function descriptorLines(raw: string): string[] {
  if (!raw.includes('\n')) return [];
  const codes = [
    ...Object.keys(UNITS_PER_USD),
    ...getActiveMarket().currency.aliases,
  ].join('|');
  const amountLineRe = new RegExp(`\\b(?:${codes})\\.?\\s*[\\d,]+(?:\\.\\d{1,2})?`, 'i');
  const lines = raw.split(/\r?\n+/).map((l) => l.trim()).filter(Boolean);
  const amountIdx = lines.findIndex((l) => amountLineRe.test(l));
  if (amountIdx < 0) return [];
  return lines
    .slice(amountIdx + 1)
    .filter(
      (line) =>
        !LINE_DATE_RE.test(line) &&
        !LINE_NOISE_RE.test(line) &&
        !amountLineRe.test(line) &&
        (line.match(/[A-Za-z]/g) ?? []).length >= 3,
    );
}

function merchantFromLines(raw: string): string {
  for (const line of descriptorLines(raw)) {
    // Acquirer descriptors are fixed-width fields padded with spaces:
    // "EXINITY ME LTD        Dubai           AE" and
    // "WL *STEAM PURCHASE    425-889-9642 WA US". Only drop the tail when it
    // actually looks like the acquirer's location/phone block — "Ziina  *qasr
    // al zain m Sharjah ARE" pads inside the merchant name, and cutting there
    // left the payment gateway as the merchant.
    const pad = line.search(/\s{2,}/);
    const tail = pad < 0 ? '' : line.slice(pad).trim();
    let cleaned =
      tail && /^[\d\s+()-]{6,}|^[A-Za-z .]{1,30}\s+[A-Z]{2,3}$/.test(tail)
        ? line.slice(0, pad).trim()
        : line.replace(/\s{2,}/g, ' ');
    let prev = '';
    while (prev !== cleaned) {
      prev = cleaned;
      cleaned = cleaned.replace(TRAILING_PLACE_RE, '');
    }
    cleaned = cleanDescriptor(cleaned);
    if (cleaned.length >= 2 && cleaned.length <= 48) return cleaned;
  }
  return '';
}

/**
 * WHERE THE CARD WAS PRESENTED — the acquirer's location field, and nothing
 * else in the message.
 *
 * Two formats, two fields:
 *
 *   inline     "...at <DESCRIPTOR>, <LOCATION>. Avl Balance is AED ..."
 *              the LAST comma-separated field of the merchant clause. The
 *              search is greedy so it lands on the last comma and not on one
 *              inside the descriptor ("Name.com, Inc, 720-2374"); a field that
 *              starts with a digit or a "+" is a phone number, not a place.
 *
 *   multi-line "<NAME> <CITY> <ISO3>" — the trailing country code ONLY.
 *              The padded tail cannot be used: "Ziina  *qasr al zain m Sharjah
 *              ARE" pads INSIDE the merchant name, so cutting at the padding
 *              would hand a shop's own words to the location check.
 *
 * Reading the descriptor instead would be the `water`-claims-waterparks
 * mistake pointed the other way: a Bangkok restaurant in Dubai is a Dubai
 * dinner, and its name must never decide where the card was.
 */
const INLINE_PLACE_RE =
  /\bat\s+[^\n]*,\s*([A-Za-z][A-Za-z .'-]{1,28}?)\s*(?:-\s*[A-Za-z]{2})?\s*\.(?:\s|$)/i;
function transactionPlace(raw: string): string {
  const line = descriptorLines(raw)[0];
  if (line) return line.match(/\b([A-Z]{3})\s*$/)?.[1] ?? '';
  return raw.match(INLINE_PLACE_RE)?.[1] ?? '';
}

/**
 * Places that only ever appear in a LOCATION field, never as a category.
 *
 * A card presented in Thailand is a holiday, whatever the shop sells: the
 * sportswear, the supermarket run and the mall stop on a trip belong with the
 * flights and the hotel, not scattered across Shopping and Groceries at home.
 * Krabi, Pattaya, Chiang Mai and Ko Samui are here for the same reason as the
 * three the corpus actually carries — safe only because this is matched
 * against the location field alone, where a restaurant name can never reach.
 */
const TRIP_PLACE_RE =
  /\b(?:THA|PHUKET|PATONG|BANGKOK|KRABI|PATTAYA|CHIANG ?MAI|KO[H]? ?SAMUI)\b/i;

/** Debit messages that are actually transfers: paying a card bill, moving between own accounts. */
const TRANSFER_HINT_RE =
  /(?:towards?|for)\s+(?:payment\s+of\s+)?(?:your\s+(?:credit\s+)?card|credit\s+card|card\s+(?:no\.?\s*)?[\dXx*•])|credit\s+card\s+(?:bill\s+)?payment|c\/?c\s+payment|cc\s*pymt|crd\s*pmt|card\s*e-?pay|card\s+settlement|own\s+account\s+transfer|transfer\s+to\s+(?:your\s+)?own\s+account|self\s+transfer|inward\s+remittance/i;

const CATEGORY_KEYWORDS: [RegExp, CategoryId][] = [
  // First, because a direct-debit instalment names a bank and would otherwise
  // fall through every other rule into "other". These three phrasings are
  // specific to standing debt instructions, not to utility direct debits.
  [/\bDD\s+instal?lments?\b|\bDDR\s+Reference\b|Direct\s+Debit\s+Service\s+Instructions?|\b(?:loan|finance|emi)\s+instal?lment\b|\b(?:car|auto|vehicle|home|personal|mortgage)\s+(?:loan|finance)\b|\bloan\s+(?:repayment|account|a\/c)\b|\binstal?lment\s+(?:due|paid|debited)\b/i, 'loan'],
  // UAE merchants read off a real 300-message accuracy report. Acquirers
  // truncate the descriptor to 20-22 characters, so several of these
  // deliberately match the stub the bank sends ("CATERIN", "GOVERNMEN",
  // "NATIONAL PAR") rather than the merchant's full legal name.
  [/caribou|caffe\s*nero|\bpeets?\b|tgi\s*fridays?|\btgif\b|cinnabon|cravia|bakemart|manazil al sham|al bait al shami|qalat trablus|alfatayir|aldumashqi|raydan|sultan saray|koshari|cookie dealer|malfoof|flurya|little neighborhood|friends\s?avenue|friendsavenue|caterin|chocolala|rabbash|arwa cake|cake n more|roti bhai|al tarbouch|buffalo\s+(?:jumeira|mirdif|wings)|cheese\s?cake|widerange fish|25 hours f and b|bloomfield treat|point seven|\bhutong\b|al baar wa al bahr|casa pons|al bahar al mutawasit|thai corner|golden city/i, 'dining'],
  // "TOPS-PATONG" is a branch of the Thai supermarket chain. Written with the
  // branch attached because a bare `tops` is a clothing word.
  [/hyper\s?ramez|lavender al madina|mark and save|fresh good day|almed retail|\btops-patong\b|dubai refreshment/i, 'groceries'],
  [/max fashion|\bmax\b(?!imum|\s*(?:limit|amount))|new yorker|lefties|la senza|victoria\s?s secret|\bkoton\b|ardene|lovisa|\blevis\b|\bcider\b|mumuso|whsmith|rivoli|malabar gold|l'?oreal|stradivarius|genzy trendz|nice style|honeylove|globale/i, 'shopping'],
  [/alphamed|wellfit|pilates|\bwatsons?\b|oriana|al khabeer al awal/i, 'health'],
  [/\blime\s*\*|\blime\s*(?:ride|auth|temp)\b|valtrans|\bcar\s*par\b|golden bay car|yellow line car|smart green line car/i, 'transport'],
  [/meraas|al zajil fairs|tickets fy events|mushrif national|al safa park|global village|splitwise|camscanner|pixocial|pixelcut|\bfinart\b|scaleup|ar ruler|\bfresha\b|adobe|\bcanva\b|linkedin/i, 'entertainment'],
  [/\bunigaz\b/i, 'utilities'],
  [/carrefour|lulu|spinneys|union coop|choithram|grandiose|waitrose|nesto|al maya|west zone|viva supermarket|\bcoop\b|noon minutes|instashop|careem quik|talabat mart|hypermarket|supermarket|grocer|fresh market|baqala/i, 'groceries'],
  [/talabat|deliveroo|zomato|noon food|careem food|eateasy|restaurant|cafe|coffee|starbucks|costa|tim hortons|mcdonald|kfc|hardee|subway|shawarma|cafeteria|dining|bakery|pizza|burger|grill|chicken|broast|dunkin|krispy|baskin|papa john|pizza hut|domino|wingstop|five guys|shake shack|raising cane|jollibee|al ?baik|karak|chai|juice|catering|kitchen|bistro|donut|gelato|ice ?cream|sweets|pastr|foodcourt|food court|snack|falafel|biryani|mandi|machboos|kabab|kebab|hommus|manakish|allo beirut|wagamama|nando|chili|applebee|cheesecake|paul\b|shakespeare|arabian tea|barista|caribou|filli|karam|zaatar|maraheb|al safadi|automatic\b|\bkeeta\b|americana|kuwait food|restaur|\bsweets?\b|\bbake\b|bakeir|shawerm|noodle|sushi|ramen|bento|taco\b|wings\b|cookies|crumble|pinkberry|kcal\b|tortilla|arabica|hummus|\bfoods?\b|beverages/i, 'dining'],
  // `metro` is bounded: unbounded it claimed METROPOLITAN HOTEL for transport
  // ahead of the travel rule, and METROPOLIS CINEMA ahead of entertainment.
  //
  // The tail here is read off the second accuracy export. `motors` is plural
  // on purpose — MOTOR CITY is a Dubai district, AL HABTOOR MOTORS is a car
  // dealer. The `auto` forms are the acquirer's 22-character truncations of
  // "AUTO SERVICE"/"AUTO AC" ("FARIQ AL AWAIEL AUTO S", "SHABAB AL KHAN AUTO
  // AC"), so they are anchored to the word `auto` rather than left loose.
  [/careem(?!\s*food)|uber|yango|bolt\b|udrive|ekar|taxi|\brta\b|road\s*(?:&|and)\s*transport|\bnol\b|salik|darb|mawaqif|mawgif|parkin\b|\bprkn\b|enoc|eppco|adnoc(?!\s*(?:oasis|coop))|emarat|petrol|fuel|tyre|tire|car wash|autopro|quicklube|oil change|\bmetro\b|tram|parking|valet|careem bike|\bgrab\b|moi traffic|traffic fines|\brafid\b|cafu\b|cafuae|www cafu|refueled|car cent(?:er|re)|\bdott\b|garage|spare parts|\bmotors\b|\bauto\s+(?:s|se|serv\w*|ac|repair|care|centre|center)\b|\btier\s+(?:[a-z]{2}\s+)?ride\b|mena mobility/i, 'transport'],
  // `water` is deliberately bounded and deliberately refuses "water park".
  // Unbounded it read AQUAVENTURE WATERPARK, WILD WADI WATERPARK and SEAWATER
  // SPA as utilities — and utilities unlocks the relaxed bill path in
  // subscriptions.ts, so a day out could mint a permanent monthly bill. It
  // also took Dubai's WATERFRONT MARKET, a fish market, off the groceries rule.
  [/dewa|sewa|fewa|addc|aadc|empower|lootah|tabreed|btu\b|chilled water|electricity|\bwater\b(?!\s*park)|cooling|utility|sewerage|ajmansewerage|\blpg\b|gas cylinder/i, 'utilities'],
  [/etisalat|\be&(?![a-z])|eand\b|\bdu\b|virgin mobile|swyp|telecom|mobile recharge|internet|five telecom|wifi|\btelephone\b|\blandline\b/i, 'telecom'],
  [/rent|ejari|landlord/i, 'rent'],
  // Personal care and home services. Neither had a category, so a corpus full
  // of cleaners and salons piled into "other" — one cleaning company alone
  // appeared 15 times. Brand names first, then what the business IS.
  //
  // `salon`, `barber`, `spa`, `beauty`, `laundry`, `dry clean`, `hairdress`
  // and `washmen` came off the shopping rule above to get here. Shopping ran
  // first, so it was already claiming all of them: a haircut and a laundry
  // pickup were both filed as retail, which is why the gap did not show up as
  // "other" and went unnoticed. They are services, not purchases, and a limit
  // on Shopping should not move because someone had their hair cut.
  [/urbanclap|urban ?clap|justlife|just ?life|helpling|matic services|home ?maids?|maids? ?in ?minutes|cleantizer|clentizer|\bfixat\b|servicemarket|service ?market|hitches ?(?:&|and) ?glitches|\bserrurier\b|lock ?smith/i, 'home-services'],
  [/\bcleanin|\bcleaner|\blaundr|dry ?clean|\bironing\b|housekeep|house ?maid|maid ?service|pest ?control|handyman|\bplumb|\belectrician|\bac (?:service|repair|clean)|\bcarpent|\bmovers?\b|packers?(?: ?(?:&|and)? ?movers)?\b|deep ?clean|car ?wash/i, 'home-services'],
  [/fresha|\bglamb\b|\bnstyle\b|tips ?(?:&|and) ?toes|sisters? beauty|laura ?beauty|\bbeautyland\b|pastels? ?salon|\bzenora\b|the ?nail ?spa|qasr al zain/i, 'personal-care'],
  [/\bsalo{1,2}n\b|\bbarber|\bspa\b|\bnails?\b|\bhair(?:cut|dress|\s?studio)|\bbeauty\b|\bgrooming\b|\bmassage\b|\bmani ?cure|\bpedi ?cure|\bwaxing\b|\bthreading\b|\btattoo\b|cosmetic ?(?:centre|center|clinic)/i, 'personal-care'],
  [/tabby|tamara|postpay|cashew|amazon|noon(?!\s*(?:food|minutes))|shein|temu|aliexpress|namshi|ounass|\bsivvi\b|ikea|home centre|homebox|home box|pan emirates|danube home|ace hardware|dragon ?mart|sharaf|jumbo|emax|virgin megastore|decathlon|sun ?& ?sand|nike|adidas|puma\b|\bh ?& ?m\b|zara\b|bershka|pull ?(?:&|and) ?bear|matalan|max fashion|centrepoint|splash\b|lifestyle|brands for less|daiso|miniso|mumzworld|firstcry|toys ?r ?us|dubizzle|mall\b|store|shop|boutique|tailor|tailo\b|perfume|jewel|gold ?souk|florist|flower|fashion|garment|abaya|red ?tag|landmark retail|citywalk|matajer|american eagle|hennes|uniqlo|sephora|skechers|lc waikiki|\basos\b|alibaba|duty ?free|dufry|\boutlet\b|jashanmal|house ?hold|majid al futtaim|\bmaf\b|gmg consumer|al ?shaya|under armour|crc sports|yzy sply|\byeezy\b|\baiiz\b|brand folio|\bg o a t\b|\bqdf\b|\baneeq\b|\boff ?price\b/i, 'shopping'],
  [/pharmacy|phcy|life pharm|bin sina|boots\b|supercare|clinic|hospital|aster|medcare|\bnmc\b|mediclinic|saudi german|burjeel|zulekha|prime medical|dental|medical|medic\b|polyclinic|physio|optic|vision|lab\b|diagnostic|x-?ray|derma|vet\b|veterinar|sukoon|\bdaman\b|\baxa\b|insura\w*|\bins\b|wathba|gym\b|fitness|classpass|padel|phar\b|pharma|sports? club|fit body|be ?fit\b|bodybuilding|\bseha\b|patient portal|bioniq|supplement|dietary supp|nutrition|ole for sports|sports? ?(?:playgr|ground|centre|center|complex|academy|arena|hall)|football|futsal|tennis|basketball|swimming|athletic/i, 'health'],
  [/school|university|college|tuition|academy|nursery|kindergarten|\bgems\b|taaleem|kumon|udemy|coursera|coursra|skillshare|training (?:center|centre)|institute/i, 'education'],
  [/emirates(?!\s*(?:nbd|islamic|coop))|flydubai|etihad|air arabia|airline|airways|\bhotel\b|rotana|marriott|hilton|hyatt|radisson|movenpick|sheraton|ibis\b|novotel|booking|airbnb|agoda|expedia|almosafer|musafir|wego\b|cleartrip|wizz|visa fee|travel|resort|oberoi|chedi|meridien|fairmont|loungekey|dragonpass|airport companion|dayuse|daypass|trip\.?\s?(?:dot ?)?com|viator|makemytrip|airasia|hoteltonight/i, 'travel'],
  [/playstation|\bpsn\b|xbox|steam|nintendo|app store|google play|itunes|apple\.com|you\s*tube|national park|cinema|vox\b|reel\b|novo\b|roxy\b|imax|netflix|spotify|anghami|shahid|osn\b|starz|game\b|gaming|arcade|bowling|magic planet|kidzania|global village|ferrari world|yas island|img world|wild wadi|aquaventure|dubai parks|adventure|entertainment|theme park|water ?park|playground|palyground|ball talent|openai|chat\s*gpt|anthropic|\bclaude\b|alldebrid|real-?debrid|getresponse|domain\.com|godaddy|namecheap|hostinger|\bhosting\b|museum|prison island|x ?strike|billiard|\bgolf\b|shooting|leisure|theentertainer|little fox|g2a\b|cdkeys|oculus|stadia|al futtaim cin|\bcin\b|bounce\b/i, 'entertainment'],
  [/donat|charity|zakat|sadaqah|dubai cares|red crescent|beit al khair|dar al ber|gofundme/i, 'charity'],
  // Developer and AI tooling billed per seat — a whole spending family the
  // vocabulary had no entry for, so every one of them landed in "other".
  [/\bcursor\b|\blovable\b|\bcluely\b|\brork\b|\bloopcv\b|skywork|beautiful\.ai|resume-?now|\brezi\b|bettercv|kickresume|nanonoble|hostgator|namecheap|name\.com|hetzner|openrouter|presentations ?ai|mailsuite|mailtrack|\bvpn\b|protonmail|vercel|netlify|supabase|railway\.app|replit|midjourney|perplexity|elevenlabs|runway\b|google ?one|fiverr|\bmuzz\b|pm connect/i, 'entertainment'],
  // Leisure venues and cinema distributors. Deliberately no district names
  // here — "City Walk" appears in the descriptor of every shop and cafe in
  // it, and matching it sent a coffee roastery to entertainment.
  [/gulf film|al mamzar|mamzar park|\bcinema\b/i, 'entertainment'],
  // Finance houses: an instalment to one of these is debt, like a bank DD.
  [/aafaq|amlak|tamweel|dunia finance|\bfinance house\b|reem finance|\bal hilal\b/i, 'loan'],
  // Food-delivery and restaurant-tech processors: these are meals, whatever
  // the descriptor says.
  //
  // "qlub" is the strongest of these and the reason it leads: it is the UAE
  // QR table-payment platform, and it appends itself to the venue's own name
  // in the card descriptor ("Kokoro qlub, sharjah", "LaBoheme-Muntazahqlub",
  // "BreakbyMara-AlJqlub"). Every descriptor carrying it is a restaurant bill,
  // whatever the venue is called — nine of them sat in Other.
  [/qlub|grubtech|\botter\b|carriage|deliveryhero|delivery hero|talabat|maxzigoodfood|alsafadi|wardt alsham|al tahadi|la barra|brass monkey|si italiano|tareeq al khalidiah|aseer time|nightjar|alpha flight|kitopi|new star families(?! sprm)/i, 'dining'],
  // Transliterated Arabic trade words. Half the descriptors on a UAE card
  // statement are Arabic shop names in Latin letters, and an English-only
  // vocabulary can never read them — which is why so much landed in Other.
  //
  // These are translations, not guesses about particular shops: aseer is
  // juice, mataam is restaurant, makhbaz is bakery. The English equivalents
  // (juice, restaurant, bakery) are already in the rules above; this is the
  // same vocabulary written the way the acquirer prints it.
  [/\baseer\b|\bmataam\b|\bmat3am\b|\bmakhbaz\b|\bmakhbz\b|\bfurn\b|hal[ae]w[iy]?[ay]{1,2}t|\bhalawa\b|\bqahwa\b|\bgahwa\b|\bmashawi\b|\bmeshwi\b|\bmashwi\b|\bfatayer\b|\bfattayer\b|\bsaj\b|\bmandi\b|\bmatbakh\b/i, 'dining'],
  [/\bthimar\b|\bthimaar\b|\bkhudar\b|\bkhodar\b|\bkhudra\b|\blahm\b|\blahom\b|\bleham\b|\blahham\b|\bsamak\b|\bdajaj\b|\bdajaaj\b|\bbaqal\w*|\bbakal[ae]\b|\btamoor\b/i, 'groceries'],
  [/\bsaydal\w*|\bsaidal\w*|\bsydal\w*/i, 'health'],
  // AliPay / WeChat descriptors are marketplace purchases.
  [/\balp\*|weixin\*|taobao|otherretail|guangdong|personalservices/i, 'shopping'],
  // Brokerages, crypto on-ramps and savings schemes are moving money, not
  // spending it. This rule RESOLVES to `other` — it is not the fall-through —
  // which is why `categoryDeliberate` exists: the accuracy report was calling
  // every one of these an unread format.
  [/etoro|capital\.com|bfinity|bitfi|binance|crypto\.com|interactive brokers|saxo|exinity|banxa|trustwallet|national bonds/i, 'other'],
  // Government sits AFTER transport/utilities so traffic fines, RTA and SEWA
  // keep their more specific buckets.
  [/smart dubai|smartdxbgov|digital sharjah|sharjah finance|govt of|government|ministry|ministries|municipality|sharjah police|dubai police|abu dhabi police|noqodi|ica smart|vfs global|\bukvi\b|tasheel|amer cent|federal authority|immigration|dubai courts|al etihad credit|tahseel|dubai pay|\bmoi\b|\bmofa\b|emirates id|residency|prosecution|notary|\bgdrfa\b|economic depart|economic zone|free ?zone|\bdmcc\b|\bjafza\b|\bdafza\b|\bifza\b|\bshams\b|masdar city|dubai integrated eco|\bded\b|governmen|muncipal/i, 'government'],
  [/salary|payroll|wages/i, 'salary'],
  // ── Payment-gateway prefixes ────────────────────────────────────────────
  //
  // `cleanDescriptor` strips these before the merchant is kept — GOOGLE*,
  // PAYPAL *, TAP*, Mamo*, Ziina * — because the gateway is not the shop. But
  // the prefix is often the only thing in the message that says what KIND of
  // purchase it was, and `guessCategory` reads the raw text, where the prefix
  // survives. So the name is cleaned and the prefix is still used to classify.
  //
  // They sit here, below every brand rule and above the structural fallbacks,
  // because the sub-merchant always knows better: PAYPAL *REALDEBRID is a
  // Real-Debrid subscription and GOOGLE*YOUTUBEPREMIUM is YouTube, and both
  // are claimed by name long before anything below.

  // Card-verification holds, not purchases. Before the Play Store rule, which
  // would otherwise call this AED 4.00 an in-app purchase. `other` here is an
  // ANSWER — the row is understood — so it must not read as an unread format.
  [/\bwallet\s*temp\b/i, 'other'],
  // Google bills the Play Store and in-app purchases through this prefix.
  [/google\s*\*/i, 'entertainment'],
  // A PayPal star is followed by the payee, and a payee means a purchase.
  [/paypal\s*\*\S/i, 'shopping'],
  // ...whereas PayPal with NO star and no payee is the account-verification
  // charge PayPal makes when a card is added. The star is the whole
  // discriminator, which is why these are two rules and not one.
  [/\bpaypal\b/i, 'other'],
  // UAE checkout platform, and the UK retailer's UAE storefront: the glued
  // descriptor decomposes as NEXT + UAE + AED + ECOM. Matched whole, because
  // a bare `next` would match half the sentences in a bank SMS.
  [/\bzbooni\b|nextuaeaedecom/i, 'shopping'],
  // Structural fallbacks — what the merchant IS, when no brand matched.
  // These sit last so brand rules always win.
  // `7-11` is anchored on BOTH sides. Unanchored it matched the digits of a
  // card number — "Card No XXXX4711" contains "711" — so every purchase on
  // that card that matched nothing else was filed as groceries. Four cards in
  // the two accuracy exports end in a number containing 711.
  [/hypermarket|supermarket|superm\w*|hyperm\w*|mini ?mart?\b|\bmart\b|grocer|baqala|coop\b|co-?op|vegetables|\bfruits?\b|butcher|fish market|meat\b|roastery|adnoc oasis|zoom\b|\b7-?11\b|\b7-?eleven\b|circle k|last chance|day to day|gala\b|west zone|foodstuff|tawfeer|tawpeek|vending|\bmarket\b|\bsupe\w*\b|sprmkt|spmkt|\bsprm\b|\bsmkt\b|now ?now|\bviva\b|smart seven|mazraat|janata|aswaaq|plus point|\bspices?\b|\bdates? (?:llc|tr|trading)\b|\bgro\b|\bgroc\b|\bhymkt\b|hypermkt|\bfoodstuff|nuts? (?:tr|llc)\b|\bbakala|dairy|\bmeats?\b/i, 'groceries'],
  // `caf` is the acquirer's truncation of "CAFE"/"CAFETERIA" at the 20-character
  // field limit ("WAQT AL KHAFAYEF CAF"). Bounded both sides, and it sits below
  // the transport rule so CAFU, the fuel-delivery brand, is claimed there first.
  [/\brest\b|\bres\b|\bresto\b|restur|\bcaf\b|caf[et]{2}eria|cafteria|cafet|coffe|caffeine|tea ?house|eater|diner\b|canteen|barbecu|\bbbq\b|burgr|\bgrill|charcoal|tacos?\b|shawerma|ice ?cre|icecre|frozen|chocolat|\bcandy\b|sweet ?shop|donuts?\b|waffle|crepe|creperie|smoothie|fruitpunch|fruit ?punch|thai ?food|\bsushi|noodl|\bwok\b|\bcocina\b|trattoria|pizzeria|steak|seafood|fish ?house|fish ?market|chinese|iranian|lebanese|libnan|\bsoory\b|syrian|shamiah|lukmah|turkish|indian ?restaur|biriyani|kabsa|foodstuff ?tr\b|\bfoodco\b/i, 'dining'],
  // "Centre" sits here, in the structural fallbacks, rather than with the
  // brands: a medical centre is health and a car centre is transport, and both
  // of those rules run earlier. By the time anything reaches this line, the
  // only centres left are the retail kind.
  [/trading|general trading|electronics|mobile(?:s| shop)|computer|stationery|bookshop|book ?store|gifts|accessories|garments?|textile|ready ?made?|footwear|shoes|optical shop|furniture|\bretail\b|\bcent(?:er|re)\b|\bcentr[ei]\b|\bplaza\b|\bsouq\b|\bbazaar\b/i, 'shopping'],
];

/**
 * The category AND whether anything actually decided it.
 *
 * `deliberate` is false in exactly one case: nothing matched and the answer is
 * the fall-through `other`. Every other answer — an override, the income
 * rules, a vocabulary rule that resolves to `other` on purpose — is a decision
 * the parser stands behind, and callers need to tell the two apart.
 */
function categoryOf(
  text: string,
  type: TransactionType,
  overrides?: Record<string, CategoryId>,
  merchant?: string,
): { id: CategoryId; deliberate: boolean } {
  if (overrides && merchant) {
    const hit = overrides[merchant.trim().toLowerCase()];
    if (hit) return { id: hit, deliberate: true };
  }
  // Money coming IN is never dining/groceries/etc — a Talabat payout is
  // business revenue, not food spending. Refunds, cashback, and bank
  // interest/profit are offsets, not revenue, so they stay out of Business.
  if (type === 'income') {
    if (/salary|payroll|wages/i.test(text)) return { id: 'salary', deliberate: true };
    // `revers(al|ed)`: the rule named one inflection of a word and missed the
    // other, so a chargeback credit read as business REVENUE.
    if (/refund|revers(?:al|ed)|cashback|\binterest\b|\bprofit\b/i.test(text)) {
      return { id: 'other', deliberate: true };
    }
    return { id: 'business', deliberate: true };
  }
  // Market-local vocabulary wins over the global baseline.
  for (const [re, cat] of [...getActiveMarket().keywords, ...CATEGORY_KEYWORDS]) {
    if (re.test(text)) return { id: cat, deliberate: true };
  }
  return { id: 'other', deliberate: false };
}

export function guessCategory(
  text: string,
  type: TransactionType,
  overrides?: Record<string, CategoryId>,
  merchant?: string,
): CategoryId {
  return categoryOf(text, type, overrides, merchant).id;
}

/**
 * Canonical names for online services whose card descriptors vary
 * ("OPENAI *CHATGPT", "PAYPAL *REALDEBRID", "APPLE.COM/BILL"...). One clean
 * name per service also makes subscription detection group them correctly.
 */
const SERVICE_NAMES: [RegExp, string][] = [
  [/openai|chat\s*gpt/i, 'ChatGPT'],
  [/anthropic|claude/i, 'Claude'],
  [/real-?debrid/i, 'Real-Debrid'],
  [/all-?debrid/i, 'AllDebrid'],
  [/netflix/i, 'Netflix'],
  [/spotify/i, 'Spotify'],
  [/you\s*tube|yt\s*premium/i, 'YouTube Premium'],
  [/google\s*one|google\s*storage/i, 'Google One'],
  [/apple\.com|apple\s*services|itunes/i, 'Apple'],
  [/icloud/i, 'iCloud'],
  [/amazon\s*prime|prime\s*video/i, 'Amazon Prime'],
  [/disney/i, 'Disney+'],
  [/anghami/i, 'Anghami'],
  [/shahid/i, 'Shahid'],
  [/\bosn\b/i, 'OSN+'],
  [/starz/i, 'StarzPlay'],
  [/deezer/i, 'Deezer'],
  [/audible/i, 'Audible'],
  [/dropbox/i, 'Dropbox'],
  [/linkedin/i, 'LinkedIn'],
  [/adobe/i, 'Adobe'],
  // Word-bounded: "CANVAS TRADING" or "CANVAS HOME" must not become Canva.
  [/\bcanva\b/i, 'Canva'],
  [/microsoft\s*365|office\s*365/i, 'Microsoft 365'],
  [/steam\s*(?:purchase|games)|steampowered/i, 'Steam'],
  [/capital\.com/i, 'Capital.com'],
  [/name\.com/i, 'Name.com'],
  [/coursra\*|coursera/i, 'Coursera'],
  [/\bkeeta\b/i, 'Keeta'],
  [/grubtech/i, 'Grubtech'],
  [/getresponse/i, 'GetResponse'],
  [/domain\.com/i, 'Domain.com'],
  [/www\.grab\b|grab\.com/i, 'Grab'],
  [/instashop/i, 'InstaShop'],
  [/ajmansewerage/i, 'Ajman Sewerage'],
  [/liv\.?\s*prime/i, 'Liv Prime'],
  [/\bcafu\b|cafuae|www cafu/i, 'CAFU'],
  [/crypto\.com/i, 'Crypto.com'],
  [/binance/i, 'Binance'],
  [/fiverr/i, 'Fiverr'],
  [/discord/i, 'Discord'],
  [/\bnotion\b/i, 'Notion'],
  [/github/i, 'GitHub'],
  [/telegram/i, 'Telegram Premium'],
  [/xbox\s*game\s*pass/i, 'Xbox Game Pass'],
  // UAE names seen under three spellings each across HSBC, Liv and ENBD
  // descriptors. Canonicalising them is what lets one merchant override — and
  // subscription detection — cover all of them at once.
  [/urban\s?clap|urban company/i, 'UrbanClap'],
  [/justlife/i, 'Justlife'],
  [/cleantizer|clentizer/i, 'Cleantizer'],
  [/hellochef/i, 'HelloChef'],
  [/dubai integrated eco/i, 'Dubai Integrated Economic Zones'],
  [/friends\s?avenue|friendsavenue/i, 'Friends Avenue'],
  [/manazil al sham/i, 'Manazil Al Sham'],
  [/valtrans/i, 'Valtrans'],
  [/mark and save/i, 'Mark & Save'],
  [/hyper\s?ramez/i, 'Hyper Ramez'],
  [/almed retail/i, 'Almed Retail'],
  [/arabian unigaz|\bunigaz\b/i, 'Arabian Unigaz'],
  [/little neighborhood/i, 'Little Neighborhood'],
  [/tgi\s*fridays?|\btgif\b/i, 'TGI Fridays'],
  [/caribou/i, 'Caribou Coffee'],
  [/caffe\s*nero/i, 'Caffe Nero'],
  [/new yorker/i, 'New Yorker'],
  [/lefties/i, 'Lefties'],
  [/mumuso/i, 'Mumuso'],
  [/laura beauty/i, 'Laura Beauty Salon'],
  [/ginnys plus/i, 'Ginnys Plus Trading'],
  [/al faan al raqi/i, 'Al Faan Al Raqi'],
  [/global village/i, 'Global Village'],
  [/\blime\s*\*|\blime\s*(?:ride|auth|temp)\b/i, 'Lime'],
  [/splitwise/i, 'Splitwise'],
  [/camscanner/i, 'CamScanner'],
  [/pixocial/i, 'Pixocial'],
  [/honeylove/i, 'HoneyLove'],
  [/playstation\s*plus|psn\s*plus/i, 'PlayStation Plus'],
];

/**
 * Structurally-recognized titles: the row IS understood even though its
 * category may be the neutral one — these never need format reporting.
 */
export const STRUCTURAL_TITLES = new Set([
  'ATM withdrawal',
  'Bank fee',
  'VAT fee',
  'Cash deposit',
  'Cheque',
  'Parking',
  'Outgoing transfer',
  'Incoming transfer',
  'Refund',
  'Inward remittance',
  'Bank transfer',
  'Card payment',
  'Account debit',
  'Telegraphic transfer',
  'Outward remittance',
]);

/** Clean descriptor noise and map to a canonical service name when known. */
export function normalizeServiceName(merchant: string): string | null {
  const stripped = merchant
    .replace(/^(?:tap|alp|web|eig|sq|wl)\s*\*\s*/i, '') // processor prefixes: "TAP*Keeta"
    .replace(/^(?:paypal|google|gpay|apl|amzn|pos|ziina|mamo)\s*\*?\s*/i, '');
  for (const [re, name] of SERVICE_NAMES) {
    if (re.test(stripped) || re.test(merchant)) return name;
  }
  return null;
}

const ACRONYMS = new Set([
  'RTA', 'KFC', 'FAB', 'DEWA', 'SEWA', 'FEWA', 'ADCB', 'ENBD', 'ENOC', 'ADNOC',
  'VOX', 'PSN', 'NMC', 'DXB', 'AUH', 'HSBC', 'CBD', 'RAK', 'DIB', 'ATM', 'NOL', 'OSN',
]);

/**
 * The vocabulary a bank SMS uses about itself. None of these is ever a
 * merchant, so a pattern that captures the words before an account or
 * reference number has to reject them however well the rest of it matched.
 */
const BANK_NOUN_RE =
  /^(?:a\/?c|acc(?:t|ount)?|card|cheque|check|ref(?:erence)?|txn|transaction|trn|iban|mobile|phone|consumer|customer|policy|invoice|bill|receipt|order|file|id|serial|batch|voucher|contract|loan|instal?ment|emi|application|request|service|registration|plate|traffic|fine|permit|licen[cs]e|visa|passport|emirates id|no)$/i;

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => {
      if (ACRONYMS.has(w.toUpperCase())) return w.toUpperCase();
      const lower = w.toLowerCase();
      return lower ? lower[0].toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}

function extractAmountFils(raw: string, allowBalanceFallback: boolean): number | null {
  // Gather candidates from both currency positions, in message order.
  const candidates: { index: number; value: number }[] = [];
  AED_AMOUNT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = AED_AMOUNT_RE.exec(raw))) {
    const at = match.index + match[0].length - match[1].length;
    if (isMaskedFigure(raw, at)) continue;
    candidates.push({ index: match.index, value: Math.round(Number(match[1].replace(/,/g, '')) * 100) });
  }
  AED_SUFFIX_RE.lastIndex = 0;
  while ((match = AED_SUFFIX_RE.exec(raw))) {
    // Skip digits glued to identifiers ("a/c XX9012 AED...", "041-339***-001
    // AED..." must not read the account fragment as an amount).
    const before = match.index > 0 ? raw[match.index - 1] : ' ';
    if (/[A-Za-z0-9*•·.\-/]/.test(before)) continue;
    // Skip if this is the number part of a prefix match ("AED 100" also ends before "AED"? no —
    // but "AED 100.00 AED"-style doubles resolve identically, so duplicates are harmless).
    candidates.push({ index: match.index, value: Math.round(Number(match[1].replace(/,/g, '')) * 100) });
  }
  candidates.sort((a, b) => a.index - b.index);

  let first: number | null = null;
  for (const c of candidates) {
    if (!Number.isFinite(c.value) || c.value <= 0 || c.value > MAX_PLAUSIBLE_AMOUNT_FILS) continue;
    if (first === null) first = c.value;
    const prefix = raw.slice(Math.max(0, c.index - 24), c.index);
    if (BALANCE_PREFIX_RE.test(prefix)) continue;
    return c.value;
  }
  return allowBalanceFallback ? first : null;
}

function amountWithFx(raw: string, allowBalanceFallback: boolean): number | null {
  return extractAmountFils(raw, allowBalanceFallback) ?? extractForeignAmountFils(raw);
}

function extractMerchant(raw: string, re: RegExp): string {
  re.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    const candidate = match[1].trim().replace(/\s{2,}/g, ' ');
    if (/^your\b/i.test(candidate) || /^(?:the |an? )?account\b/i.test(candidate)) continue;
    if (/^\d+$/.test(candidate)) continue; // bare digits are a card number, not a merchant
    if (/\d{4}[Xx*•]{2,}/.test(candidate) || /^\d{6,}/.test(candidate)) continue; // masked PANs
    if ((candidate.match(/[A-Za-z]/g) ?? []).length < 3) continue; // account numbers, "AED 1"
    // "your payment to the account number 4822" stops at "account", leaving a
    // bare article as the merchant. A row titled "The" helps nobody.
    if (/^(?:the|this|that|your|our|an?|and|for|to)$/i.test(candidate)) continue;
    if (/^\d+\s+(?:month|day|week|year|hr|hour|min)/i.test(candidate)) continue; // "up to 12 months"
    if (/^acc[\s/]|^a\/?c\b|^cr\.?\s*card/i.test(candidate)) continue; // "from Acc/Cr.Card ..."
    if (/^(?:aed|dhs|sar|usd|eur|gbp)\b/i.test(candidate)) continue;
    if (/^www\.?$/i.test(candidate)) continue; // "at WWW.GRAB.COM" stops at the dot
    // Marketing sentences hide behind the same "to"/"for" the merchant uses:
    // "log in to View Your Statement", "pay now to Avoid Charges". Rows
    // titled "View Your Statement" and "Avoid Charges" were the result.
    // A descriptor never opens with an imperative or names the reader.
    if (
      /^(?:avoid|view|check|see|click|visit|call|contact|update|verify|confirm|download|enjoy|get|earn|save|know|learn|read|use|pay|activate|renew|register|apply|explore|discover|manage|track|start|join|book|order|shop|win|claim|reply|dial|send|scan|switch|upgrade|unlock|redeem|collect|refer|share|follow|subscribe|opt)\b/i.test(
        candidate,
      )
    ) {
      continue;
    }
    // Deliberately no "us"/"we": HOMES R US is a shop, not a sentence about
    // the reader, and the guard deleted its name outright.
    if (/\b(?:you|your|yours|which|whom|their)\b/i.test(candidate)) continue;
    if (candidate) return candidate;
    if (re.lastIndex === match.index) re.lastIndex++;
  }
  return '';
}

// The gap before the figure excludes mask characters: "Avl Bal AED ····9235.93"
// must not report a 9,235.93 balance, because the real one has digits the bank
// redacted.
// "avbl" and "lmt" are the same two words with the vowels dropped, and
// "limit available" is them the other way round. All three come from the
// published vocabulary of a long-running Indian SMS parser
// (MabudAlam/transaction_sms_parser, MIT) — the template family HSBC, Citi
// and Standard Chartered carry into the Gulf. None appear in this corpus
// yet; they are here because a missed snapshot is silent, and an
// abbreviation of a word already matched cannot match anything else.
const SNAPSHOT_RE =
  /(?:(?:avl|avbl|avail(?:able)?|remaining|total)\.?\s*(?:cr(?:edit)?\.?\s+)?(limit|lmt|bal(?:ance)?|outstanding)|(limit|lmt)\s+available)[^0-9·•*-]{0,12}([\d,]+(?:\.\d{1,2})?)/i;
// "Your balance is AED 401913.68" — balance quotes without an Avl/Total
// prefix. Kept separate so bare "limit" mentions (daily limits, offers)
// still need the availability prefix above.
const PLAIN_BALANCE_RE =
  /(?:your|current|new|updated|net|a\/?c(?:count)?)\s+bal(?:ance)?\s*(?:is|:|now)?[^0-9·•*-]{0,10}([\d,]+(?:\.\d{1,2})?)/i;
const MAX_SNAPSHOT_FILS = 1_000_000_000; // 10M in the local currency

/** The balance / available-limit figure banks append to most alerts. */
function extractSnapshot(raw: string): { fils: number; kind: SnapshotKind } | null {
  const m = raw.match(SNAPSHOT_RE);
  if (m) {
    const fils = Math.round(Number(m[3].replace(/,/g, '')) * 100);
    if (Number.isFinite(fils) && fils >= 0 && fils <= MAX_SNAPSHOT_FILS) {
      // Group 1 is the "avl <word>" order, group 2 the "<word> available"
      // order; exactly one of them is set.
      const word = (m[1] ?? m[2]).toLowerCase();
      return {
        fils,
        kind:
          word.startsWith('limit') || word === 'lmt'
            ? 'limit'
            : word === 'outstanding'
              ? 'outstanding'
              : 'balance',
      };
    }
  }
  const plain = raw.match(PLAIN_BALANCE_RE);
  if (plain) {
    const fils = Math.round(Number(plain[1].replace(/,/g, '')) * 100);
    if (Number.isFinite(fils) && fils >= 0 && fils <= MAX_SNAPSHOT_FILS) {
      return { fils, kind: 'balance' };
    }
  }
  const o = raw.match(OUTSTANDING_RE);
  if (o) {
    const fils = Math.round(Number(o[1].replace(/,/g, '')) * 100);
    if (Number.isFinite(fils) && fils >= 0 && fils <= MAX_SNAPSHOT_FILS) {
      return { fils, kind: 'outstanding' };
    }
  }
  return null;
}

function extractCard(raw: string): ParsedCard | null {
  // Masked PANs first: CARD_RE would otherwise grab the FIRST four digits of
  // "Credit Card 4782********4833" as the identity.
  const masked = raw.match(MASKED_PAN_RE);
  if (masked) {
    return { last4: masked[1], kind: /credit/i.test(raw) ? 'credit' : 'debit' };
  }
  const cardMatch = raw.match(CARD_RE);
  if (cardMatch) {
    const kindWord = cardMatch[1]?.toLowerCase();
    // Multi-line formats say "Credit Card Purchase" in the header and
    // "Card No XXXX4711" further down — when the number clause carries no
    // kind word, look at the whole message before assuming debit.
    const kind =
      kindWord === 'credit' || (!kindWord && /credit\s+card/i.test(raw))
        ? 'credit'
        : 'debit';
    return { last4: cardMatch[2], kind };
  }
  const accMatch = raw.match(ACCOUNT_RE);
  if (accMatch) return { last4: accMatch[1], kind: 'account' };
  return null;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
// ADCB style: "due by Jul 19 2026"
const MONTH_DATE_RE = /\b(?:on|by|before)\s+([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/i;

/**
 * Dates a statement introduces with PAY-BY language, as opposed to the date it
 * says it was generated on.
 *
 * `extractDate` takes the first date it can read, and "on" introduces the
 * generation date as readily as the deadline: "Total amount due AED 1,500.
 * Generated on 30/12/2026. Please pay by Jul 19 2027" filed the due on
 * 30 December — the statement date, seven months before the money was owed.
 * Every statement of that shape landed weeks early, and the Bills tab, the
 * overdue status and the payment-matching window are all built on this figure.
 *
 * A stated deadline therefore beats any other date in the message. Only the
 * statement branch uses this: on a purchase, "on <date>" IS the date, and the
 * "statement due on 27/07" footer such messages carry must keep losing to the
 * transaction's own timestamp.
 */
const DUE_BY_NUMERIC_RE = /\b(?:by|before)\s+(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/i;
const DUE_BY_NAMED_RE = /\b(?:by|before)\s+([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/i;
// "the payment due date of your FAB Credit Card ending with 4833 is 06-07-2026"
// — the due phrase and its date sit either side of the card clause, so the
// bridge between them is bounded rather than adjacent, and has to tolerate the
// digits in that clause. The anchor is the two-word "due date", which the
// amount phrasings ("total amount due AED ...") do not contain, and what
// follows must look like a date, so no amount can be read as one.
const DUE_PHRASE_NUMERIC_RE =
  /\b(?:payment\s+)?due\s+date\b[^\n]{0,60}?\b(?:is|on|:)\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/i;
const DUE_PHRASE_NAMED_RE =
  /\b(?:payment\s+)?due\s+date\b[^\n]{0,60}?\b(?:is|on|:)\s*([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/i;

function namedDate(monthWord: string, day: string, year: string): string | null {
  const month = MONTH_NAMES[monthWord.slice(0, 3).toLowerCase()];
  return month ? isoDate(Number(year), month, Number(day)) : null;
}

/**
 * The date a statement says it must be paid by, or null when it states none.
 * Callers fall back to `extractDate` so a statement that only carries one date
 * still reads exactly as it did before.
 */
function extractDueDate(raw: string): string | null {
  // An explicit "due date ... is X" is the most specific claim in the message.
  const phrase = raw.match(DUE_PHRASE_NUMERIC_RE);
  if (phrase) {
    const iso = numericDate(phrase[1], phrase[2], phrase[3]);
    if (iso) return iso;
  }
  const phraseNamed = raw.match(DUE_PHRASE_NAMED_RE);
  if (phraseNamed) {
    const iso = namedDate(phraseNamed[1], phraseNamed[2], phraseNamed[3]);
    if (iso) return iso;
  }
  // "pay by X" / "is due by X" / "minimum due AED 162.00 by 05/08/2026".
  const by = raw.match(DUE_BY_NUMERIC_RE);
  if (by) {
    const iso = numericDate(by[1], by[2], by[3]);
    if (iso) return iso;
  }
  const byNamed = raw.match(DUE_BY_NAMED_RE);
  if (byNamed) {
    const iso = namedDate(byNamed[1], byNamed[2], byNamed[3]);
    if (iso) return iso;
  }
  return null;
}

/**
 * ISO string for a date that actually exists. A day past the end of its month
 * ("30/02") is rejected rather than emitted: `new Date('2026-02-30')` rolls
 * forward to 2 March, which silently files the transaction in the wrong month
 * and skews every monthly figure derived from it.
 */
function isoDate(y: number, month: number, day: number): string | null {
  if (!(y >= 2000 && y <= 2100 && month >= 1 && month <= 12 && day >= 1)) return null;
  const daysInMonth = new Date(Date.UTC(y, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Day/month from a numeric date, tolerating the US order when it's unambiguous. */
function numericDate(d: string, m: string, yRaw: string): string | null {
  const y = yRaw.length === 2 ? 2000 + Number(yRaw) : Number(yRaw);
  const first = Number(d);
  const second = Number(m);
  // The region writes DD/MM, so that reading is tried first. "12/25/2026" has
  // no valid DD/MM reading, and its MM/DD reading is unambiguous — before,
  // dates like this were dropped and the transaction silently took today.
  return isoDate(y, second, first) ?? isoDate(y, first, second);
}

function extractDate(raw: string): string | null {
  // Each format falls through to the next: a numeric date that matched but
  // could not be resolved must not stop the named-month form from being read.
  const withTime = raw.match(DATETIME_RE);
  if (withTime) {
    const iso = numericDate(withTime[1], withTime[2], withTime[3]);
    if (iso) return iso;
  }
  const hsbc = raw.match(HSBC_DATE_RE);
  if (hsbc) {
    const iso = namedDate(hsbc[2], hsbc[1], String(2000 + Number(hsbc[3])));
    if (iso) return iso;
  }
  const numeric = raw.match(DATE_RE);
  if (numeric) {
    const iso = numericDate(numeric[1], numeric[2], numeric[3]);
    if (iso) return iso;
  }
  const named = raw.match(MONTH_DATE_RE);
  if (named) {
    const month = MONTH_NAMES[named[1].slice(0, 3).toLowerCase()];
    if (month) {
      const iso = isoDate(Number(named[3]), month, Number(named[2]));
      if (iso) return iso;
    }
  }
  return null;
}

/**
 * Parses a single bank-alert SMS. Returns null for non-transaction messages.
 *
 * ONE if-chain, first match wins. Nothing documented the intended precedence,
 * so here it is. `L` marks an ordering that is load-bearing: move that branch
 * and a message starts reading as the wrong thing.
 *
 *  #  branch                guard                                      why here
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1  refusals              OTP / declined / pre-auth / rate card /  L first: a
 *                           fee schedule / autopay / BNPL preview /    declined
 *                           instalment offer / overdue nag / receipt   purchase
 *                                                                      still says
 *                                                                      "purchase"
 *  2  parking              "PlateNo-" AND a fee figure               L before the
 *                                                                      amount
 *                                                                      helpers:
 *                                                                      "Fee-AED2.38"
 *                                                                      is not the
 *                                                                      only figure
 *  3  card payment IN       a card AND CARD_PAYMENT_RE               L before the
 *                                                                      generic
 *                                                                      debit path,
 *                                                                      which sees
 *                                                                      only the
 *                                                                      word
 *                                                                      "payment"
 *                                                                      and files a
 *                                                                      settlement
 *                                                                      as spending
 *  4  payment instructions "payment instructions of" AND a masked      near-dead:
 *     → masked PAN          PAN                                        #3 claims
 *                                                                      every shape
 *                                                                      seen so far
 *  5  bank bill-pay        "payment instructions ... for consumer     L after #4:
 *                           number"                                    a masked PAN
 *                                                                      is a card,
 *                                                                      not a biller
 *  6  biller reference      CAPS + "NO.-<digits>", not BANK_NOUN_RE,   L after #5
 *                           and the name must resolve to a category    and before
 *                           or a known service                         the generic
 *                                                                      path, whose
 *                                                                      title would
 *                                                                      be "Account
 *                                                                      debit"
 *  7  biller portal receipt "payment to account no ..." + "Amount Paid"
 *  8  telegraphic transfer / outward remittance
 *  9  TT payment          "TT Payment"                                L before the
 *                                                                      generic
 *                                                                      path: the
 *                                                                      account
 *                                                                      fragment
 *                                                                      "041-339***-
 *                                                                      001 AED"
 *                                                                      fakes an
 *                                                                      amount
 * 10  card statement        a card AND statement words AND due words  L the
 *                           AND NOT purchase/was used/charged/          negative
 *                           withdraw/debited/spent                      guard is
 *                                                                      what keeps
 *                                                                      a PURCHASE
 *                                                                      carrying a
 *                                                                      "statement
 *                                                                      due on"
 *                                                                      footer in
 *                                                                      the generic
 *                                                                      path
 * 11  generic               a debit word, a credit word, or bill-due   the rest
 *                           words with neither
 *
 * Inside #11 the order matters too: refund/credited-in decides direction before
 * a merchant is looked for; savings sweeps and named transfers overwrite the
 * merchant AFTER descriptor cleanup so a rail is never titled like a shop; the
 * ATM rename runs last because those messages do name a location.
 */
export function parseSms(
  message: string,
  overrides?: Record<string, CategoryId>,
): ParsedSms | null {
  const raw = message.trim();
  if (!raw) return null;
  ensureCurrencyPatterns();

  if (OTP_RE.test(raw)) return null;
  if (DECLINED_RE.test(raw)) return null;
  // A reversal that says the money came back is a credit, not a failure. One
  // that says nothing of the kind is the terminal declining, and still isn't a
  // transaction.
  if (REVERSED_RE.test(raw) && !reversedCredit(raw)) return null;
  if (PREAUTH_RE.test(raw)) return null;
  // Telecom rate cards ("Make local calls for 5 AED/Minute") read like
  // purchases; a biller's own AutoPay receipt duplicates the bank-side SMS.
  if (/\d\s*(?:aed|dhs|sar)\s*\/\s*min(?:ute)?|roaming minutes/i.test(raw)) return null;
  // Fee schedules quote a price without charging it: "Branch Teller Services
  // are charged at AED 52.5 per transaction. Enjoy free banking at 430 ATMs".
  if (/\bare charged at\b|\bis charged at\b|\bper transaction\b/i.test(raw)) return null;
  if (/autopay service/i.test(raw)) return null;
  // "Amount will be deducted from next recharge" — nothing has moved yet.
  if (/deducted from (?:your )?next recharge|will be deducted from next/i.test(raw)) return null;
  // BNPL / tabby previews of TOMORROW's charge — the real charge arrives as
  // its own bank SMS, so importing these double-counts every instalment.
  if (
    /will be charged to your (?:default )?(?:card|payment method)|due tomorrow and will be charged|statement for (?:aed\s*)?[\d,.]+ is ready|charged to your (?:card|default payment method) (?:tomorrow|on \d)/i.test(
      raw,
    )
  ) {
    return null;
  }
  // Instalment-conversion offers quote an EXISTING purchase; payment
  // reminders and biller receipts duplicate messages already counted.
  if (/\*?convert now\*?|converted into instalments?|converted into installments?|interest payment plan|easy payment plan/i.test(raw)) return null;
  if (/payment reminder|due date reminder|pay immediately to avoid|avoid blockage|is overdue\b/i.test(raw)) return null;
  if (/rate our service|thank you for using ajmanpay|successfully redeemed|delivery associate/i.test(raw)) return null;

  // RTA / municipal parking confirmations:
  //   Confirmation / PlateNo-XXX / TicketNo-XXX / Fee-AED2.38 / Paid upto ...
  if (
    /\bplate(?:no|source)?\s*[-:]/i.test(raw) &&
    /\b(?:fee|paid)\s*[-:]?\s*(?:aed|dhs|[\d,])/i.test(raw)
  ) {
    // Both spellings exist: "Fee-AED2.38" and "Paid: 2 AED".
    const feeMatch =
      raw.match(/\b(?:fee|paid)\s*[-:]?\s*(?:aed|dhs)\s*([\d,]+(?:\.\d{1,2})?)/i) ??
      raw.match(/\b(?:fee|paid)\s*[-:]?\s*([\d,]+(?:\.\d{1,2})?)\s*(?:aed|dhs)/i);
    const fils = feeMatch ? Math.round(Number(feeMatch[1].replace(/,/g, '')) * 100) : null;
    if (!fils || fils <= 0) return null;
    return {
      kind: 'transaction',
      type: 'expense',
      amountFils: fils,
      merchant: 'Parking',
      date: extractDate(raw),
      dueDay: null,
      minDueFils: null,
      card: null,
      transferHint: false,
      snapshotFils: null,
      snapshotKind: null,
      categoryGuess: 'transport',
      categoryDeliberate: true,
      raw,
    };
  }

  const card = extractCard(raw);
  const date = extractDate(raw);
  const snapshot = extractSnapshot(raw);
  const snapshotFils = snapshot?.fils ?? null;
  let snapshotKind = snapshot?.kind ?? null;
  // On a credit card, "Avl Bal" is available CREDIT (limit headroom), not
  // money in an account — storing it as a balance made cards look rich.
  if (snapshotKind === 'balance' && card?.kind === 'credit') snapshotKind = 'limit';

  // Card payment received (transfer into the card) — before debit detection,
  // since these messages also contain the word "payment". Only credit cards
  // receive payments, whatever the message called the card.
  if (card?.kind !== 'account' && card && CARD_PAYMENT_RE.test(raw)) {
    const amountFils = amountWithFx(raw, true);
    if (!amountFils) return null;
    return {
      kind: 'cardPayment',
      type: 'expense',
      amountFils,
      merchant: `Card •${card.last4} payment`,
      date,
      dueDay: null,
      minDueFils: null,
      card: { ...card, kind: 'credit' },
      transferHint: true,
      snapshotFils,
      snapshotKind,
      categoryGuess: 'other',
      categoryDeliberate: true,
      raw,
    };
  }

  // FAB-style card bill payment from the bank-account side:
  //   "Your payment instructions of AED 7,663.94 to 5492********4711 has
  //    been processed" — a transfer onto the card, never spending.
  if (/payment\s+instructions?\s+of/i.test(raw)) {
    const masked = raw.match(MASKED_PAN_RE);
    if (masked) {
      const amountFils = amountWithFx(raw, false);
      if (!amountFils) return null;
      return {
        // `cardPayment`, not `transaction`. This is the same event the branch
        // above reads, and only `cardPayment` is turned into an income-side
        // transfer on import — which is the only shape `allocatePayments`
        // credits. As a plain transaction the payment could never settle the
        // statement it just paid, and the card would go on reading as owed.
        kind: 'cardPayment',
        type: 'expense',
        amountFils,
        merchant: `Card •${masked[1]} payment`,
        date,
        dueDay: null,
        minDueFils: null,
        card: { last4: masked[1], kind: 'credit' },
        transferHint: true,
        snapshotFils,
        snapshotKind,
        categoryGuess: 'other',
        categoryDeliberate: true,
        raw,
      };
    }
  }

  // Bill-pay through the bank: "Your payment instructions of AED 313.95 to
  // homeinet for consumer number 4026 has been processed".
  //
  // "for consumer number" is the tell, and it is decisive: this is a
  // registered biller, so the payment is a bill. The payee is a nickname the
  // user chose when they set the biller up (homeinet, apthome, Offhome,
  // Villabill), which means no vocabulary can ever classify it and adding
  // names to a list would be endless. The structure is what we recognise;
  // the name becomes the title, and one correction from the user pins the
  // category for that payee forever.
  const billerPay = raw.match(
    /payment\s+instructions?\s+of\s+(?:[A-Z]{3}|Dhs?)?\s*[\d,.]+\s+to\s+(.+?)\s+for\s+consumer\s+number/i,
  );
  if (billerPay) {
    const amountFils = amountWithFx(raw, false);
    if (!amountFils) return null;
    const payee = billerPay[1].trim().replace(/\s{2,}/g, ' ');
    const merchant = normalizeServiceName(payee) ?? titleCase(payee);
    return {
      kind: 'transaction',
      type: 'expense',
      amountFils,
      merchant,
      date,
      dueDay: null,
      minDueFils: null,
      card,
      transferHint: false,
      snapshotFils,
      snapshotKind,
      // A named biller beats the default; "Du" should still read as telecom.
      categoryGuess: guessCategory(payee, 'expense', overrides, merchant) === 'other'
        ? 'utilities'
        : guessCategory(payee, 'expense', overrides, merchant),
      categoryDeliberate: true,
      raw,
    };
  }

  // Utility direct debits name the biller before the account: "AED 1,938.41
  // has been debited from your account no. 095-XXX11XXX-01 SEWA NO.-8765".
  // Without this the row title fell back to the generic "Card purchase".
  //
  // The capture is only a run of capitals, so on its own it also matches the
  // ordinary furniture of a bank SMS — REF NO., ACCOUNT NO., CHEQUE NO. — and
  // the words before an account reference in a transfer alert. Two guards keep
  // it to real billers: the name has to be one the app already recognizes, and
  // an unrecognized one no longer gets called a utility.
  //
  // That fallback never helped a genuine biller: SEWA, DEWA and Etisalat all
  // categorize themselves. It only fired on names the app could not place, so
  // every hit was wrong. It is what put a fish shop, a furniture store and a
  // transfer beneficiary under "Utilities & fixed bills" — and, because that
  // category also unlocks the bill-shaped detection path in subscriptions.ts,
  // what turned three of them into standing monthly bills.
  const billerRef = raw.match(/\b([A-Z][A-Z ]{2,20}?)\s+NO\.?\s*[-:]\s*[\dX·]/);
  if (billerRef && !BANK_NOUN_RE.test(billerRef[1].trim())) {
    const payee = billerRef[1].trim();
    const named = normalizeServiceName(payee);
    const cat = categoryOf(payee, 'expense', overrides, named ?? titleCase(payee));
    const category = cat.id;
    const amountFils = category === 'other' && !named ? null : amountWithFx(raw, false);
    if (amountFils) {
      const merchant = named ?? titleCase(payee);
      return {
        kind: 'transaction',
        type: CREDIT_WORDS.test(raw) && !DEBIT_WORDS.test(raw) ? 'income' : 'expense',
        amountFils,
        merchant,
        date,
        dueDay: null,
        minDueFils: null,
        card,
        transferHint: false,
        snapshotFils,
        snapshotKind,
        categoryGuess: category,
        // A recognized biller reached here; its category came from a rule.
        categoryDeliberate: cat.deliberate,
        raw,
      };
    }
  }

  // Biller-portal receipt, sent as a labelled block:
  //   Your payment to the account number ····4822 has been processed.
  //   Amount Due: AED 408.45 / Amount Paid: AED 408.45 / Remaining Balance: 0
  // "Amount Paid" is the figure that moved; "Amount Due" only happens to equal
  // it when the bill was settled in full. Naming the account beats the generic
  // fallback, and the labelled lines are not a merchant descriptor.
  const portalPay = raw.match(
    /payment\s+to\s+(?:the\s+)?account\s+(?:number|no\.?)\s*[·•X*]*(\d{4,})[\s\S]*?amount\s+paid\s*:?\s*(?:[A-Z]{3}|Dhs?)?\s*([\d,]+(?:\.\d{1,2})?)/i,
  );
  if (portalPay) {
    // Last four, not first four: an unmasked account number would otherwise
    // label the row with its leading digits.
    const last4 = portalPay[1].slice(-4);
    const amountFils = Math.round(Number(portalPay[2].replace(/,/g, '')) * 100);
    const portalCat = categoryOf(raw, 'expense', overrides, `Payment to •${last4}`);
    if (amountFils > 0) {
      return {
        kind: 'transaction',
        type: 'expense',
        amountFils,
        merchant: `Payment to •${last4}`,
        date,
        dueDay: null,
        minDueFils: null,
        card,
        transferHint: false,
        snapshotFils,
        snapshotKind,
        categoryGuess: portalCat.id,
        // The row IS understood \u2014 a settled bill on a named account \u2014 even
        // when the payment channel says nothing about what the bill was for.
        categoryDeliberate: true,
        raw,
      };
    }
  }

  // Telegraphic transfers / outward remittances — money moved between
  // accounts (usually abroad), not merchant spending.
  if (/issuance of telegraphic transfer|debit telegraphic transfer|^outward remittance/i.test(raw)) {
    const amountFils = amountWithFx(raw, false);
    if (!amountFils) return null;
    return {
      kind: 'transaction',
      type: 'expense',
      amountFils,
      merchant: /^outward remittance/i.test(raw) ? 'Outward remittance' : 'Telegraphic transfer',
      date,
      dueDay: null,
      minDueFils: null,
      card,
      transferHint: true,
      snapshotFils,
      snapshotKind,
      categoryGuess: 'other',
      categoryDeliberate: true,
      raw,
    };
  }

  // HSBC-style "TT Payment to 041-339***-001 AED 1,108.00+" — an
  // inter-account transfer; "+" after the amount marks money arriving.
  if (/\btt\s+payment\b/i.test(raw)) {
    // Account fragments like "041-339***-001 AED" fake a suffix amount, so
    // read the prefix-form figure (optionally "+"-terminated) directly.
    const m = raw.match(/(?:aed|dhs|sar|usd|eur|gbp)\s*([\d,]+(?:\.\d{1,2})?)/i);
    const amountFils = m ? Math.round(Number(m[1].replace(/,/g, '')) * 100) : null;
    if (!amountFils) return null;
    return {
      kind: 'transaction',
      type: /[\d.,]\+/.test(raw) ? 'income' : 'expense',
      amountFils,
      merchant: 'Bank transfer',
      date,
      dueDay: null,
      minDueFils: null,
      card,
      transferHint: true,
      snapshotFils,
      snapshotKind,
      categoryGuess: 'other',
      categoryDeliberate: true,
      raw,
    };
  }

  // A card statement with no digits in it is still a statement.
  //
  // Without a card there is nothing to attach a due to, so this fell through
  // to the generic path — and an ADCB "statement is ready. Total due AED
  // 714.74, minimum due AED 100.00" imported as INCOME of 714.74, filed as
  // business revenue. A message announcing a bill must never become money
  // moving, in either direction, however little else we can tell about it.
  //
  // Deliberately narrow: it demands the words "credit card" or "card
  // statement", so a utility bill that happens to say "total amount due"
  // still reaches the billDue path it belongs to.
  if (
    !card &&
    /\bcredit\s*card\b|\bcard\s+statement\b/i.test(raw) &&
    STATEMENT_RE.test(raw) &&
    BILL_DUE_WORDS.test(raw) &&
    !STATEMENT_TXN_BLOCK_RE.test(raw)
  ) {
    return null;
  }

  // Credit-card statement with dues. Statements only exist for credit cards.
  // Purchase-style verbs mean this is a transaction with a "statement due"
  // footer, not the statement itself ("if already paid" footers must NOT
  // disqualify a real due reminder, so this deliberately excludes "paid").
  if (card && STATEMENT_RE.test(raw) && BILL_DUE_WORDS.test(raw) && !STATEMENT_TXN_BLOCK_RE.test(raw)) {
    // "Min payment of AED100 ... Total billed amt is AED1174.49" — the
    // stated total beats first-amount extraction (which would grab the min).
    const totalMatch = raw.match(TOTAL_DUE_RE);
    const amountFils = totalMatch
      ? Math.round(Number(totalMatch[1].replace(/,/g, '')) * 100)
      : amountWithFx(raw, true);
    if (!amountFils) return null;
    const minMatch = raw.match(MIN_DUE_RE);
    // A stated pay-by date beats every other date in the message, including
    // the one the statement says it was generated on. `date` is the whole
    // statement's date downstream: it becomes CardDue.dueDate.
    const dueDate = extractDueDate(raw) ?? date;
    return {
      kind: 'cardStatement',
      type: 'expense',
      amountFils,
      merchant: `Card •${card.last4}`,
      date: dueDate,
      dueDay: dueDate ? Number(dueDate.slice(8)) : null,
      minDueFils: minMatch ? Math.round(Number(minMatch[1].replace(/,/g, '')) * 100) : null,
      card: { ...card, kind: 'credit' },
      transferHint: false,
      snapshotFils,
      snapshotKind,
      categoryGuess: 'other',
      categoryDeliberate: true,
      raw,
    };
  }

  // URLs carry misleading words ("sewapayment.tiny.us" is not a payment).
  const prose = raw.replace(/https?:\/\/\S+/gi, ' ');
  const hasDebit = DEBIT_WORDS.test(prose);
  const hasCredit = CREDIT_WORDS.test(prose);
  // Carrier-billed store purchases ("App Store & Google Play bill") are
  // receipts, never utility bills — treating them as dues produced garbage
  // reminders with balance-sized amounts.
  const carrierBilling = /app\s*store|google play|play store|itunes/i.test(raw);
  const isBillDue = BILL_DUE_WORDS.test(raw) && !hasDebit && !hasCredit && !carrierBilling;

  if (PROMO_RE.test(raw) && !TXN_EVIDENCE_RE.test(raw)) return null;
  if (!hasDebit && !hasCredit && !isBillDue) return null;

  // No balance fallback here. On a bill reminder the fallback could only ever
  // return a figure the message introduced as a BALANCE or a LIMIT, and a
  // reminder carrying a balance-sized amount is exactly the garbage the
  // carrier-billing guard above was added to stop. Nothing in the corpus needs
  // it; refusing the message is the honest answer.
  const amountFils = amountWithFx(raw, false);
  if (!amountFils) return null;

  // A refund reverses spending: money coming back IN, whatever verbs the
  // message uses ("Purchase amount of AED X ... has been refunded").
  const isRefund = REFUNDED_TO_RE.test(raw) || reversedCredit(raw);
  // "credited to your account" settles the direction on its own. These
  // messages carry a reference line naming the sender — "...B/O DELIVERY HERO
  // TALABAT DB LLC Talabat Biweekly Payment" — and the word Payment in it was
  // enough to trip the debit test, filing an incoming payout as spending.
  const creditedIn = CREDITED_IN_RE.test(prose);
  const type: TransactionType =
    isRefund || creditedIn || (!isBillDue && hasCredit && !hasDebit) ? 'income' : 'expense';

  let merchant = '';
  /** The descriptor before cleanup — ".com" survives here, so Capital.com and
   *  Name.com can still be recognised as the services they are. */
  let descriptor = '';
  if (isBillDue) {
    const billMatch = raw.match(BILL_MERCHANT_RE);
    merchant = billMatch ? billMatch[1].trim() : extractMerchant(raw, MERCHANT_RE);
  } else {
    merchant = extractMerchant(raw, MERCHANT_RE);
    if (!merchant) {
      const paymentFor = raw.match(PAYMENT_FOR_RE);
      if (paymentFor) merchant = paymentFor[1].trim();
    }
  }
  let transferHint = !isBillDue && TRANSFER_HINT_RE.test(raw);
  descriptor = merchant;
  merchant = cleanDescriptor(merchant);
  // HSBC embeds the merchant BEFORE the verb:
  //   "From HSBC: 30AUG23 MINISTRY OF HUMAN RE Purchase from 041-..."
  if (!merchant) {
    const hsbc = raw.match(/from hsbc:\s*\d{1,2}[a-z]{3}\d{2,4}\s+(.{3,40}?)\s+purchase from/i);
    if (hsbc) merchant = hsbc[1].trim();
  }
  // Multi-line formats: the merchant sits on its own line after the amount.
  if (!merchant && !isBillDue && type === 'expense' && !transferHint) {
    const lineMerchant = merchantFromLines(raw);
    if (lineMerchant) merchant = lineMerchant;
  }
  // A known service named anywhere beats the looser payee heuristics below
  // ("WWW.GRAB.COM, BANGKOK" must resolve to Grab, not "for exact amt").
  if (!merchant && !isBillDue && type === 'expense' && !transferHint) {
    const svc = normalizeServiceName(raw);
    if (svc) merchant = svc;
  }
  // Transfer rails name the rail, not a shop: "for a FastPay transfer to
  // Khalid Rashid", "MOBILE BANKING TRANSFER TO AE····0021...", "for Fund
  // Transfer through Liv app". The money did leave, so these stay expenses —
  // but calling them "Card purchase" was wrong twice over, and a row that
  // reads "Transfer to Khalid Rashid" needs no category at all.
  let structuralMerchant = false;
  // "RULE TRANSFER TO SAVINGS WITH ONE-SHOT SAVING" — an automated sweep into
  // the user's own savings pot. It is the clearest possible self-transfer, and
  // three of them were being counted as spending.
  if (
    !isBillDue &&
    // A savings pot has a NAME, and the name is rarely the word "savings":
    // Liv calls its default one "Emergency Funds" and sweeps into it with a
    // "RULE TRANSFER". Two of those, at AED 7,000 and AED 4,000, were being
    // counted as a month's spending.
    /transfer to savings|savings? (?:rule|goal|pot|plan)\b|round-?up saving|\brule\s+transfer\b|one-?shot\s+sav|\bemergency\s+funds?\b/i.test(
      raw,
    )
  ) {
    merchant = 'Savings transfer';
    structuralMerchant = true;
    transferHint = true;
  }

  if (!isBillDue && type === 'expense') {
    const named = raw.match(
      /\b(?:fastpay|instant|local|domestic|international|fund|mobile\s+banking)\s+transfer\s+to\s+([A-Za-z][A-Za-z .'\-]{2,40}?)\s*(?:[.,;]|\bif\b|$)/i,
    );
    if (named) {
      merchant = `Transfer to ${named[1].trim().replace(/\s{2,}/g, ' ')}`;
      structuralMerchant = true;
    } else if (/\btransfer\s+to\s+[A-Z]{2}[\dX·•]/i.test(raw)) {
      merchant = 'Bank transfer';
      structuralMerchant = true;
    } else if (!merchant && /\bfund\s+transfer\b|\bfunds?\s+transferred\b/i.test(raw)) {
      merchant = 'Outgoing transfer';
      structuralMerchant = true;
    }
  }

  // "debited ... for SALIK on", "sent to Dubai Islamic Bank as per your
  // Direct Debit instructions" — payee named after "for" / "sent to".
  if (!merchant && !isBillDue && type === 'expense' && !transferHint) {
    const payeeRe =
      /\b(?:for|sent\s+to)\s+([A-Za-z][A-Za-z &.'\-]{2,40}?)\s*(?:[.,;]|\bon\b|\bas\s+per\b|\bthrough\b|$)/gi;
    for (const m of raw.matchAll(payeeRe)) {
      const candidate = m[1].trim();
      if (/^(?:aed|dhs|sar|usd|eur|gbp|your|the|payment|consumer|exact|pay\b|using|below)/i.test(candidate)) continue;
      if ((candidate.match(/[A-Za-z]/g) ?? []).length < 3) continue;
      merchant = candidate.replace(/\s+(?:PJSC|LLC|PSC|FZE)$/i, '').trim();
      break;
    }
  }
  if (!merchant) {
    // No "at/to/from" clause — but a known service named ANYWHERE in the
    // message still identifies the row (many card descriptors put the
    // merchant at the end with no preposition). Generic "Card purchase"
    // titles can never group into subscriptions, so this matters.
    const service =
      !isBillDue && type === 'expense' && !transferHint ? normalizeServiceName(raw) : null;
    merchant = service ?? (isBillDue
      ? 'Bill payment'
      : type === 'income'
        ? /\brefund(?:ed)?\b/i.test(raw)
          ? 'Refund'
          : DEPOSIT_RE.test(raw)
          ? 'Cash deposit'
          : /inward\s+remittance/i.test(raw)
            ? 'Inward remittance'
            : 'Incoming transfer'
        : transferHint
          ? 'Card payment'
          : ATM_RE.test(raw)
            ? 'ATM withdrawal'
            : /cheque|\bchq\b/i.test(raw)
              ? 'Cheque'
              : /value\s+added\s+tax|\bvat\b\s*(?:@|¡)?\s*\d/i.test(raw)
                ? 'VAT fee'
                : FEE_RE.test(raw)
                  ? 'Bank fee'
                  : /instant\s+transfer|local\s+transfer|social\s+transfer/i.test(raw)
                    ? 'Outgoing transfer'
                    // No card in the message means no card purchase: "An amount
                    // of AED 118.04 has been debited from your FAB account
                    // XXXX0002" names no payee at all, and saying "Card
                    // purchase" invented one.
                    : !card || card.kind === 'account'
                      ? 'Account debit'
                      : 'Card purchase');
  } else if (!structuralMerchant) {
    // Payment processors prefix their own descriptor: "ALP*Taobao",
    // "EIG*Hostgator.com", "V*bettercv.com", "GOOGLE*GOOGLE ONE". The prefix
    // is the acquirer, never the merchant, and it made identical shops read
    // as different ones.
    // Ziina and Mamo are UAE payment links: the shop's own name follows the
    // star, so "Ziina  *qasr al zain m" is Qasr Al Zain, not Ziina.
    // "HTTP WWW CARS24 COM" and "HTTP //WWW.BINANCE.COM" are URLs, not names.
    // When nothing survives the scheme and host prefix, a service named
    // anywhere in the message identifies the row better than "Www" does.
    const deUrled =
      merchant.replace(/^https?\s*[:/]*\s*(?:www[\s.]?)?/i, '').trim() ||
      normalizeServiceName(raw) ||
      merchant;
    const unprefixed = deUrled.replace(
      /^(?:alp|eig|sq|tap|web|v|paypal|google|gpay|apl|amzn|pos|ziina|mamo|wl)\s*\*\s*/i,
      '',
    );
    merchant =
      normalizeServiceName(descriptor || merchant) ??
      normalizeServiceName(merchant) ??
      titleCase((unprefixed || deUrled || merchant).replace(/[\s,;.*-]+$/, ''));
  }
  // ATM messages usually name a location; the row is still a cash withdrawal.
  if (!isBillDue && type === 'expense' && !transferHint && ATM_RE.test(raw)) {
    merchant = 'ATM withdrawal';
  }
  // A transfer the bank never gave a payee for is money moving between your
  // own places, not spending. The bank sends BOTH legs of a card settlement —
  // "instant transfer AED 10,089" and "payment instructions ... to
  // 5492****4833" — and with only the second leg flagged, the same 10,089 was
  // counted once as a transfer and once as spending, on the same day.
  //
  // A transfer that DOES name a person keeps its "Transfer to <name>" title
  // and stays an expense, because that money really did leave.
  //
  // Outgoing only. Including incoming here was a mistake that zeroed a user's
  // income: an unnamed transfer OUT is usually a self-move or a card
  // settlement, but an unnamed transfer IN is real money arriving — a salary,
  // someone paying you back — and excluding it is never right.
  if (type === 'expense' && (merchant === 'Outgoing transfer' || merchant === 'Bank transfer')) {
    transferHint = true;
  }

  // WHERE beats WHAT. A charge whose location field is abroad on a trip is
  // holiday spending, decided before any merchant vocabulary runs — otherwise
  // one week in Thailand arrives as a sportswear purchase, a supermarket run
  // and a mall stop filed among the month's ordinary shopping at home.
  //
  // A category the USER set still wins over both, which is why the override is
  // read out first rather than left to `categoryOf`.
  const overridden = Boolean(overrides && merchant && overrides[merchant.trim().toLowerCase()]);
  const onTrip =
    type === 'expense' &&
    !isBillDue &&
    !transferHint &&
    TRIP_PLACE_RE.test(transactionPlace(raw));
  const cat =
    onTrip && !overridden
      ? { id: 'travel' as CategoryId, deliberate: true }
      : categoryOf(raw, type, overrides, merchant);
  // A row the parser named STRUCTURALLY — a savings sweep, "Transfer to Khalid
  // Rashid", a bank transfer — is understood even though no spending category
  // applies to it. Money moving between places has no category, and reporting
  // one of these as an unread format is what buried the real misses.
  const structural =
    structuralMerchant || transferHint || STRUCTURAL_TITLES.has(merchant);

  return {
    kind: isBillDue ? 'billDue' : 'transaction',
    type,
    amountFils,
    merchant,
    date,
    dueDay: isBillDue && date ? Number(date.slice(8)) : null,
    minDueFils: null,
    card,
    transferHint,
    snapshotFils,
    snapshotKind,
    categoryGuess: cat.id,
    categoryDeliberate: cat.deliberate || structural,
    raw,
  };
}

/** Parses pasted text that may contain several messages separated by blank lines. */
export function parseSmsBatch(
  text: string,
  overrides?: Record<string, CategoryId>,
): ParsedSms[] {
  return text
    .split(/\n\s*\n/)
    .map((m) => parseSms(m, overrides))
    .filter((p): p is ParsedSms => p !== null);
}
