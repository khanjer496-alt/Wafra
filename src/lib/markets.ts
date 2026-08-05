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
    { re: /\bliv\b/i, name: 'Liv', color: '#00D3B9', domain: 'liv.me' },
    { re: /\bajman\s*bank/i, name: 'Ajman Bank', color: '#00747A', domain: 'ajmanbank.ae' },
    { re: /\bcbi\b/i, name: 'CBI', color: '#7A2048', domain: 'cbi.ae' },
  ],
  keywords: ARABIC_KEYWORDS, // the UAE vocabulary is the current global baseline
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
    [/\bsadad\b/i, 'utilities'],
    ...ARABIC_KEYWORDS,
  ],
};

export const MARKETS: MarketPack[] = [AE, SA];

let active: MarketPack = AE;

export function getActiveMarket(): MarketPack {
  return active;
}

export function setActiveMarket(id: string): void {
  active = MARKETS.find((m) => m.id === id) ?? AE;
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
