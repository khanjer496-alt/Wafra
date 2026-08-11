import type { CategoryId } from '@/lib/types';

/**
 * Market packs: everything country-specific lives here as data — currency,
 * bank sender-ID registry (with website domains for logo lookup), and local
 * merchant/utility vocabulary. The parser, subscriptions, dues and insights
 * engines are market-agnostic and read the active pack at call time.
 *
 * Adding a country = adding one pack to MARKETS. Nothing else changes.
 */

export interface BankDef {
  re: RegExp;
  name: string;
  color: string;
  /** Bank website, used to fetch its logo (favicon) at runtime. */
  domain?: string;
  /**
   * The bank that actually issues this brand's cards, when the brand is a
   * digital sub-brand rather than a licence of its own. Liv is Emirates NBD's
   * app; a Liv card and an ENBD card with the same last four digits are one
   * piece of plastic, filed twice because two sender IDs describe it.
   *
   * This is NOT a display alias — the brands stay distinct everywhere the user
   * can see them. It only says whose card it is when deciding whether two rows
   * are the same card.
   */
  issuer?: string;
}

export interface MarketPack {
  id: string;
  name: string;
  flag: string;
  currency: {
    code: string;
    /** How amounts render: "AED 1,234". */
    display: string;
    /** Regex alternatives the parser accepts for this currency in SMS. */
    aliases: string[];
  };
  banks: BankDef[];
  /** Market-specific category keywords, checked before the global list. */
  keywords: [RegExp, CategoryId][];
}

/**
 * Category vocabulary in Arabic, shared by both Gulf packs.
 *
 * A merchant named in Arabic matched nothing at all — every Arabic charge
 * landed in `other`, which is the category that makes the whole app look
 * broken, because it is the one the user sees and cannot explain.
 *
 * Two kinds of entry, both facts rather than guesses: the common noun for a
 * kind of shop (مطعم is "restaurant", صيدليه is "pharmacy"), and the Arabic
 * spelling of a chain the English list already knows (كارفور is Carrefour,
 * نون is noon). Nothing here is a transliteration invented for the purpose.
 *
 * EVERY LITERAL BELOW IS WRITTEN POST-FOLD, and that is not a style choice.
 * `guessCategory` normalises its input through `foldOrthography` before it
 * reaches this table — آ أ إ ٱ collapse to ا, ى to ي, ة to ه, ؤ to و, ئ to ي —
 * so a rule spelled the natural way can NEVER fire. It does not throw, it does
 * not warn, and the list still reads like coverage: مقهى, قهوة, صيدلية, تأمين,
 * إيجار, أوبر, أدنوك, أمازون and الإمارات were all dead on arrival, which is
 * eleven of these twenty-four rules matching nothing at all while the file
 * claimed a full Arabic vocabulary.
 *
 * Folding also collapses pairs that used to be written out twice (بقالة/بقاله,
 * إيجار/ايجار, أدنوك/ادنوك): post-fold they are the same string, so only one
 * survives. That is the point — one spelling, matched once.
 *
 * parser.test.js asserts that `foldOrthography` is the identity on every source
 * string in this table, so a rule added in natural spelling fails the suite
 * instead of quietly matching nothing.
 */
const ARABIC_KEYWORDS: [RegExp, CategoryId][] = [
  // shop kinds — the noun does the work
  [/مطعم|مطاعم|كافيه|مقهي|قهوه/, 'dining'],
  [/سوبرماركت|بقاله|تموين|هايبر|جمعيه/, 'groceries'],
  // "طبي" is BOUNDED, and the boundary is load-bearing: Arabic letters are not
  // `\w`, so `\b` cannot express it and an unanchored طبي matches inside
  // تطبيق — "application". Etisalat's Arabic payment receipt says it was paid
  // through "تطبيق إتصالات" (the Etisalat app), and 29 real telecom bills in
  // the accuracy corpus were filed as HEALTH by that one substring. This table
  // is consulted BEFORE the parser's own, so fixing only that copy changed
  // nothing. The article and the endings are spelled out so الطبية and طبيب
  // still match.
  [/صيدليه|مستشفي|مستوصف|عياده|(?:^|[^ء-ي])(?:ال)?طبي(?:ه|ات|ب|به|بات|ين)?(?![ء-ي])|مختبر/, 'health'],
  [/محطه|وقود|بنزين|مواقف|موقف/, 'transport'],
  [/كهرباء|مياه|ماء|غاز/, 'utilities'],
  [/اتصالات|جوال|هاتف|انترنت/, 'telecom'],
  [/مدرسه|جامعه|رسوم\s*دراسيه/, 'education'],
  [/فندق|طيران|تذكره\s*سفر|سياحه|سفر/, 'travel'],
  [/تامين/, 'health'],
  [/ايجار/, 'rent'],
  [/صالون|حلاق|تجميل|مشغل/, 'personal-care'],
  // chains the English vocabulary already knows, in their Arabic spelling
  [/كارفور/, 'groceries'],
  [/لولو/, 'groceries'],
  [/العثيم|اسواق\s*عبدالله/, 'groceries'],
  [/التميمي|بنده|الدانوب|نستو/, 'groceries'],
  [/نون(?!\s*يه)/, 'shopping'],
  [/طلبات|كريم\s*ناو|هنقرستيشن|جاهز/, 'dining'],
  [/كريم|اوبر/, 'transport'],
  [/ادنوك|اينوك|ارامكو/, 'transport'],
  [/سالك|درب/, 'transport'],
  [/امازون|نمشي|شي\s*ان/, 'shopping'],
  [/نتفلكس|نتفليكس|سبوتيفاي|شاهد|ستارزبلاي/, 'entertainment'],
  [/دو\b|اتصالات\s*الامارات|موبايلي|زين|اس\s*تي\s*سي/, 'telecom'],
];

/**
 * Merchants that belong to no single market pack.
 *
 * A UAE card is used abroad, and the acquirer's descriptor is the same string
 * whichever country the CARD was issued in. Nothing here is UAE- or Saudi-
 * specific, so it is shared by every pack the way ARABIC_KEYWORDS is, rather
 * than copied into each.
 *
 * THE BAR FOR AN ENTRY IS THAT THE NAME SAYS WHAT WAS BOUGHT. A store code, a
 * processor prefix and a person's name all say nothing, and `other` is the
 * honest answer for those — see the report in the commit that added this list
 * for the ones deliberately left alone (2C2P, FAT*THE VIOLE, SP ALL-CHARMS,
 * MARFAA, CRO, TUBA INT...). Every rule below fires on a real message from the
 * accuracy corpus; none was written against an invented descriptor.
 *
 * These are consulted BEFORE the parser's own global vocabulary, so a rule here
 * can take a category AWAY from a better answer. That is why each one is
 * anchored on a whole brand token and never on a bare English word: `CENTRAL`,
 * `TOPS` and `SPA` all appear in this corpus and none of them is safe alone.
 */
const CROSS_BORDER_KEYWORDS: [RegExp, CategoryId][] = [
  // McDonald's own acquirer descriptor is "MCD-<store number> <location>", so
  // the brand never appears in full: "MCD-0297 PHUKET AIRPO PHUKET THA". The
  // digit after the hyphen is what makes this a store code and not a word.
  [/\bmcd-\s?\d/i, 'dining'],
  // Central Group's Thai malls and department stores, e.g. "PZD131 CENTRAL
  // PHUKET". "Central" alone is in half the street addresses on earth — and in
  // "central bank" — so the brand only counts with one of its own mall names
  // behind it. CentralPlaza is deliberately absent: the global vocabulary
  // already files any `plaza` as shopping, so it needs nothing from here.
  [/\bcentral\s*(?:phuket|festival|pattaya|embassy|chidlom|ladprao|world)\b|\bcentralworld\b/i, 'shopping'],
  // Thailand's beauty-and-wellness booking platform, which arrives behind Opn's
  // processor prefix as "OPN*gowabi.com".
  [/\bgowabi\b/i, 'personal-care'],
  // A ticketed spectator sport: "PATONG BOXING STADIUM". `\bstadium\b` alone
  // was rejected — Dubai has a metro station called Stadium, and that is
  // transport.
  [/\bmuay\s?thai\b|\bboxing\s+stadium\b/i, 'entertainment'],
  // "PHUKET KART SPEED". A bare `\bkart\b` is one letter from `mart` and `cart`
  // in a field that is routinely truncated, so it carries either the go- prefix,
  // the -ing ending, or a track noun.
  [/\bgo-?karts?\b|\bkarting\b|\bkarts?\s+(?:speed|racing|track|circuit)\b/i, 'entertainment'],
  // The Ancient City outside Bangkok — an open-air museum. The global
  // vocabulary already reads the word `museum`; this landmark does not contain
  // it.
  [/\bmuang\s?boran\b/i, 'entertainment'],
  // A travel document bought for a trip: "E-VISA VIET NAM HA NOI VNM". The
  // hyphen-or-nothing spelling is load-bearing — a bare `visa` is the card
  // network, and every second card alert names it.
  [/\be-?visas?\b/i, 'travel'],
  // Bangkok's older international airport, as "CF-1024 DON MUANG BANGKOK THA".
  // Kept as a place name rather than a generic `airport` rule, which would
  // outrank the MCD- line above and file an airport McDonald's as travel.
  [/\bdon\s?muang\b/i, 'travel'],
  // Zain is the telecom across Jordan, Kuwait, Bahrain, Iraq and Sudan; the
  // Saudi pack already knows it. It is ALSO a common given name ("Zain Ali
  // Trading"), and `telecom` unlocks the relaxed bill path in subscriptions.ts
  // — a misfire here does not mislabel one row, it mints a monthly bill. So the
  // brand only counts in front of one of its own products or markets, which is
  // what the real descriptor carries: "ZAIN WEBSITE AND SELFC, AMMAN".
  [/\bzain\s+(?:website|self-?care|self-?c\b|telecom|mobile|cash|prepaid|jordan|kuwait|bahrain|jo\b|kw\b|bh\b|iq\b)/i, 'telecom'],
  // "WASSAGY EBOOKS ...". The global vocabulary reads `bookshop` and
  // `book store`; this is the same claim about the same goods.
  [/\be-?books?\b/i, 'shopping'],
  // Bounded merchants from a UAE-issued-card accuracy corpus. Each name has a
  // public trade identity; none relies on PHUKET/DUBAI or another location to
  // decide what was bought. This prevents the old location-driven "Travel"
  // mistake without teaching broad words such as `studio`, `home` or `spa` to
  // classify unrelated businesses.
  [/\bl'?eto\s+(?:dubai|riyadh|jeddah|caffe|cafe|restaurant)\b/i, 'dining'],
  [/\blittle\s+bangkok\b|\bakiba\s+dori\b|\btum\s+rub\s+thai\b/i, 'dining'],
  [/\bbartels\s+c\s+bangkok\b|\bmarush\s+phuket\b|\bloof\s+garden\s+phuket\b|\bphukettique\s+phuket\b/i, 'dining'],
  [/\bmoontree\s*spa\b|\bal\s+mazoon\s+studio\b/i, 'personal-care'],
  [/\bplenary\s+(?:longevity\s+)?wellness\b/i, 'health'],
  [/\bsawadee\s*ka\s*thai\s*souvenirs?\b|\bsawadeekathaisouvenirs\b/i, 'shopping'],
  [/\bmrs\.?\s*wrap\s+co\b/i, 'shopping'],
  [/\blamsat\s+qotunia\s+gar\s+tr\b/i, 'shopping'],
];

const AE: MarketPack = {
  id: 'AE',
  name: 'United Arab Emirates',
  flag: '🇦🇪',
  // The spelled-out forms matter as much as the symbol: an Arabic-locale
  // handset renders the same alert as "50.00 درهم", and without the word the
  // parser saw no currency at all and dropped the transaction. The plural
  // "دراهم" must precede the singular, or "درهم" matches first and leaves a
  // stray letter behind. The parser folds these aliases through the same
  // orthography normalisation it applies to the message, so writing "د.إ"
  // here (rather than the folded "د.ا") is correct and intentional.
  currency: { code: 'AED', display: 'AED', aliases: ['AED', 'Dhs?\\.?', 'د\\.?إ\\.?', 'دراهم', 'درهم'] },
  banks: [
    { re: /enbd|emirates\s*nbd/i, name: 'Emirates NBD', color: '#2B4C9B', domain: 'emiratesnbd.com' },
    { re: /\bfab\b|first\s*abu\s*dhabi/i, name: 'FAB', color: '#00A3E0', domain: 'bankfab.com' },
    { re: /adcb/i, name: 'ADCB', color: '#E4032E', domain: 'adcb.com' },
    { re: /adib/i, name: 'ADIB', color: '#0E5AA7', domain: 'adib.ae' },
    { re: /\bdib\b|dubai\s*islamic/i, name: 'DIB', color: '#00704A', domain: 'dib.ae' },
    { re: /mashreq/i, name: 'Mashreq', color: '#FF5E00', domain: 'mashreqbank.com' },
    { re: /rak\s*bank/i, name: 'RAKBANK', color: '#D71920', domain: 'rakbank.ae' },
    { re: /\bcbd\b/i, name: 'CBD', color: '#00857D', domain: 'cbd.ae' },
    { re: /hsbc/i, name: 'HSBC', color: '#DB0011', domain: 'hsbc.ae' },
    { re: /emirates\s*islamic|\bei\b/i, name: 'Emirates Islamic', color: '#00843D', domain: 'emiratesislamic.ae' },
    { re: /\bsib\b|sharjah\s*islamic/i, name: 'Sharjah Islamic', color: '#006B54', domain: 'sib.ae' },
    { re: /\bnbf\b/i, name: 'NBF', color: '#5C6670', domain: 'nbf.ae' },
    { re: /\bwio\b/i, name: 'Wio', color: '#C4F04A', domain: 'wio.io' },
    { re: /\bliv\b/i, name: 'Liv', color: '#00D3B9', domain: 'liv.me', issuer: 'Emirates NBD' },
    { re: /\bajman\s*bank/i, name: 'Ajman Bank', color: '#00747A', domain: 'ajmanbank.ae' },
    { re: /\bcbi\b/i, name: 'CBI', color: '#7A2048', domain: 'cbi.ae' },
  ],
  // The UAE vocabulary is the current global baseline. Arabic runs first
  // because it is the older, better-tested list; the cross-border chains run
  // after it and before the parser's own global table.
  keywords: [...ARABIC_KEYWORDS, ...CROSS_BORDER_KEYWORDS],
};

const SA: MarketPack = {
  id: 'SA',
  name: 'Saudi Arabia',
  flag: '🇸🇦',
  currency: { code: 'SAR', display: 'SAR', aliases: ['SAR', 'SR', 'ر\\.س', 'ريال'] },
  banks: [
    { re: /al\s*rajhi|alrajhi/i, name: 'Al Rajhi', color: '#2A3C8F', domain: 'alrajhibank.com.sa' },
    { re: /\bsnb\b|saudi\s*national|alahli|al\s*ahli|\bncb\b/i, name: 'SNB AlAhli', color: '#00A651', domain: 'alahli.com' },
    { re: /riyad\s*bank|riyadbank/i, name: 'Riyad Bank', color: '#00457C', domain: 'riyadbank.com' },
    { re: /alinma/i, name: 'Alinma', color: '#7B2E68', domain: 'alinma.com' },
    { re: /albilad|bank\s*albilad/i, name: 'Bank Albilad', color: '#E63329', domain: 'bankalbilad.com' },
    { re: /\bsab\b|saudi\s*awwal|sabb/i, name: 'SAB', color: '#5C2D91', domain: 'sab.com' },
    { re: /\banb\b|arab\s*national/i, name: 'ANB', color: '#0072BC', domain: 'anb.com.sa' },
    { re: /saudi\s*fransi|\bbsf\b|fransi/i, name: 'Banque Saudi Fransi', color: '#00693E', domain: 'alfransi.com.sa' },
    { re: /aljazira|al\s*jazira/i, name: 'Bank AlJazira', color: '#F58220', domain: 'baj.com.sa' },
    { re: /\bstc\s*pay|stcpay/i, name: 'stc pay', color: '#4F008C', domain: 'stcpay.com.sa' },
    { re: /\burpay\b/i, name: 'urpay', color: '#00C4B3', domain: 'urpay.com.sa' },
    { re: /\bd360\b/i, name: 'D360', color: '#111827', domain: 'd360.com' },
  ],
  keywords: [
    [/\bstc\b|mobily|zain|salam\s*mobile/i, 'telecom'],
    [/saudi\s*electric|\bsec\b|marafiq|national\s*water|\bnwc\b/i, 'utilities'],
    [/hungerstation|jahez|mrsool|toyou|the\s*chefz/i, 'dining'],
    [/panda|tamimi|danube|othaim|bindawood|lulu/i, 'groceries'],
    [/petromin|sasco|aldrees|naft/i, 'transport'],
    [/jarir\s+(?:book\s*store|marketing)|مكتبه\s+جرير/i, 'shopping'],
    [/nahdi\s+(?:pharmacy|medical)|صيدليه\s+النهدي/i, 'health'],
    [/flynas|flyadeal|saudia\s+(?:air|airlines?|booking)/i, 'travel'],
    ...ARABIC_KEYWORDS,
    ...CROSS_BORDER_KEYWORDS,
  ],
};

export const MARKETS: MarketPack[] = [AE, SA];

/** Read-only vocabulary lookup for already-validated statement/import rows. */
export function keywordsForMarket(id: 'AE' | 'SA'): MarketPack['keywords'] {
  return MARKETS.find((market) => market.id === id)?.keywords ?? [];
}

let active: MarketPack = AE;

/**
 * ISO 4217 code the STORED `amountFils` are denominated in, or null while the
 * ledger holds no money.
 *
 * `marketId` used to answer two different questions at once: which bank and
 * merchant vocabulary the parser matches senders against, and what currency
 * the stored fils ARE. Only the first is a preference. The second is a fact
 * about money already recorded, and swapping the pack quietly rewrote it —
 * one USD 100.00 charge stored as 36730 fils printed "AED 367" before a
 * country change and "SAR 367" after it, same untouched row, nothing
 * converted. On the Foreign spending screen that figure sits under a heading
 * that literally reads "Converted total".
 *
 * CONVERTING INSTEAD IS THE TRAP. The stored fils are all the app has: there
 * is no per-row rate into the new currency, a historical row's true rate on
 * its own day is not knowable offline, and a conversion pass would silently
 * rewrite every figure the user ever recorded — with no undo, and with the
 * parser, the bank-quoted `fxRate` fields and every hand-entered amount all
 * left describing the old currency. A wrong number is worse than an honest
 * label.
 *
 * So the accounting currency is pinned BY THE LEDGER: once money is recorded,
 * only a pack denominated in the same currency may become active. Nothing new
 * is persisted for this — `marketId` is still the record, it simply can no
 * longer drift once there is money that would be relabelled by the drift. The
 * store re-derives this from state on every reduction, so erasing the ledger
 * (or restoring a different one) releases the pin on the same tick.
 *
 * The pin lives here rather than in the country picker so it holds for every
 * caller — Settings, onboarding, a restored backup, the Worker.
 */
let ledgerCurrency: string | null = null;
let ledgerExponent: 0 | 2 | 3 | null = null;

export function getActiveMarket(): MarketPack {
  return active;
}

/**
 * Pin the accounting currency to `code`, or release it with `null` when the
 * ledger holds no money. Anything that is not a three-letter code releases.
 */
export function setLedgerCurrency(code: string | null, exponent: 0 | 2 | 3 = 2): void {
  const wanted = code?.trim().toUpperCase();
  ledgerCurrency = wanted && /^[A-Z]{3}$/.test(wanted) ? wanted : null;
  ledgerExponent = ledgerCurrency ? exponent : null;
}

/** ISO 4217 code pack `id` denominates in — what a ledger recorded under it is. */
export function marketCurrencyCode(id: string): string {
  return (MARKETS.find((m) => m.id === id) ?? AE).currency.code;
}

/** ISO 4217 code the stored fils are denominated in. */
export function ledgerCurrencyCode(): string {
  return ledgerCurrency ?? active.currency.code;
}

/** The accounting currency already committed to disk, or null on a fresh ledger. */
export function pinnedLedgerCurrencyCode(): string | null {
  return ledgerCurrency;
}

/** Persisted minor-unit exponent; never re-derived from mutable ISO metadata. */
export function ledgerCurrencyExponent(): 0 | 2 | 3 {
  return ledgerExponent ?? 2;
}

/** How that currency renders in front of an amount: the "AED" in "AED 1,234". */
export function ledgerCurrencyDisplay(): string {
  if (!ledgerCurrency) return active.currency.display;
  return (
    MARKETS.find((m) => m.currency.code === ledgerCurrency)?.currency.display ?? ledgerCurrency
  );
}

/** Whether pack `id` can be selected without relabelling money already stored. */
export function canSelectMarket(id: string): boolean {
  if (!ledgerCurrency) return true;
  return (MARKETS.find((m) => m.id === id) ?? AE).currency.code === ledgerCurrency;
}

/**
 * Select a market pack. Returns false — and changes NOTHING, not even the
 * bank registry — when the pack is denominated differently from money the
 * ledger already holds. See `ledgerCurrency` above for why the answer is a
 * refusal rather than a conversion.
 */
export function setActiveMarket(id: string): boolean {
  if (!canSelectMarket(id)) return false;
  active = MARKETS.find((m) => m.id === id) ?? AE;
  return true;
}

const AED_ALERT = /\b(?:AED|Dhs?\.?)\b|د\.?[إا]\.?|دراهم|درهم/iu;
const SAR_ALERT = /\b(?:SAR|SR)\b|ر\.?\s?س\.?|ريال/iu;

/**
 * Route the launch-tested Gulf parser from this alert's evidence.
 *
 * Sender identity wins over the quoted currency because a UAE card can make
 * a purchase in SAR and a Saudi card can make one in AED. When the sender is
 * not yet in either registry, AED and SAR themselves are unambiguous market
 * evidence; they choose a parser pack but never prove that money moved.
 */
export function detectLaunchMarketFromAlert(
  source: string,
  sender?: string,
): 'AE' | 'SA' | null {
  const senderText = sender?.trim() ?? '';
  const senderMarkets = senderText
    ? MARKETS.filter((market) => market.banks.some((bank) => bank.re.test(senderText)))
    : [];
  if (senderMarkets.length === 1) return senderMarkets[0].id as 'AE' | 'SA';
  if (senderMarkets.length > 1) return null;
  const aed = AED_ALERT.test(source);
  const sar = SAR_ALERT.test(source);
  if (aed === sar) return null;
  return aed ? 'AE' : 'SA';
}

/**
 * Parse synchronously under one market without changing the user's stored
 * preference. A pinned ledger refuses the other currency before the parser
 * can convert or relabel it.
 */
export function withMarketPackForParsing<T>(
  id: 'AE' | 'SA',
  parse: () => T,
): T | null {
  const pack = MARKETS.find((market) => market.id === id);
  if (!pack || (ledgerCurrency && ledgerCurrency !== pack.currency.code)) return null;
  const previous = active;
  active = pack;
  try {
    return parse();
  } finally {
    active = previous;
  }
}

/** Best-effort country from the device locale ("en-SA" → SA). */
export function detectMarketId(): string {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale ?? '';
    const region = locale.match(/[-_]([A-Za-z]{2})\b/)?.[1]?.toUpperCase();
    if (region && MARKETS.some((m) => m.id === region)) return region;
  } catch {
    // Intl not available — fall through.
  }
  return 'AE';
}

/** Bank identity from an SMS sender ID / app package name, per the active market. */
export function bankFromSender(
  sender: string | undefined,
): { name: string; color: string; domain?: string } | null {
  if (!sender) return null;
  for (const b of active.banks) {
    if (b.re.test(sender)) return { name: b.name, color: b.color, domain: b.domain };
  }
  return null;
}

/**
 * The bank a message NAMES, as opposed to the one its sender ID implies.
 *
 * Sender was the only source of bank identity, which is fine until two real
 * cards share their last four digits at different banks — one user holds a Liv
 * card and an Emirates NBD card both ending 8575, and every alert had to be
 * attributed by sender alone, so statements and payments landed on whichever
 * card the sender happened to name.
 *
 * Deliberately narrow: only a bank name sitting immediately before a card noun
 * counts, as in "Emirates NBD Credit Card Mini Stmt for Card ending 8575".
 * A bank named anywhere in the body would be worse than useless — banks put
 * their own name in promo footers ("download the new FAB mobile banking app"),
 * and co-branded cards name a partner that is not the issuer.
 */
export function bankFromMessage(
  text: string | undefined,
): { name: string; color: string; domain?: string } | null {
  if (!text) return null;
  for (const b of active.banks) {
    const re = new RegExp(`(?:${b.re.source})[^\\n]{0,16}?\\b(?:credit|debit|cr\\.?)\\s*card\\b`, 'i');
    if (re.test(text)) return { name: b.name, color: b.color, domain: b.domain };
  }
  return null;
}

/** The active market's entry for a bank name, in bankFromSender's shape. */
export function bankFromName(
  name: string | undefined,
): { name: string; color: string; domain?: string } | null {
  if (!name) return null;
  for (const b of active.banks) {
    if (b.name === name) return { name: b.name, color: b.color, domain: b.domain };
  }
  return null;
}

/**
 * The identity of whoever ISSUED this bank's cards — the sub-brand's parent
 * when it has one, otherwise the bank itself.
 *
 * Use this to decide whether two card rows are the same card. Use
 * bankIdentityForName for anything the user reads: Liv and Emirates NBD are
 * different products and are still shown as such.
 */
export function issuerIdentityForName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  for (const m of MARKETS) {
    for (const b of m.banks) {
      if (b.name.toLowerCase() === name.toLowerCase() || b.re.test(name)) {
        return bankIdentityForName(b.issuer ?? b.name);
      }
    }
  }
  return bankIdentityForName(name);
}

/** Brand identity for a bank NAME shown in the UI (any market's pack). */
export function bankBrandForName(
  name: string,
): { name: string; color: string; domain?: string } | null {
  const n = name.toLowerCase();
  for (const m of MARKETS) {
    for (const b of m.banks) {
      if (n.includes(b.name.toLowerCase()) || b.re.test(name)) {
        return { name: b.name, color: b.color, domain: b.domain };
      }
    }
  }
  return null;
}

/**
 * Stable identity key for a displayed bank name.
 *
 * Known brands collapse their aliases first. Unknown names remain distinct
 * in every script: stripping to ASCII made all Arabic-only banks normalize to
 * the same empty marker, which is unsafe anywhere last4 is only a weak hint.
 */
export function bankIdentityForName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const branded = bankBrandForName(name)?.name ?? name;
  const normalized = branded
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return normalized || undefined;
}

/** Logo domain for a bank NAME shown in the UI (any market's pack). */
export function bankDomainForName(name: string): string | null {
  return bankBrandForName(name)?.domain ?? null;
}

/**
 * Up to four letters standing in for a bank, e.g. ADCB, FAB, NBD, LIV.
 * Prefers an existing acronym in the name over generic initials.
 */
export function bankMonogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const acronym = words.find((w) => /^[A-Z]{2,4}$/.test(w));
  if (acronym) return acronym;
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
  return words
    .map((w) => w[0])
    .join('')
    .slice(0, 4)
    .toUpperCase();
}
