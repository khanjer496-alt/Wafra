import { inspectAlertDraft, normalizeAlertText, type CurrencyAliasMap, type MoneyCandidate } from '@/lib/alert-draft';
import { hasNonCompletedWording } from '@/lib/best-effort-autopost';
import { dateOrderForCountry } from '@/lib/country';
import { CURRENCY_SYMBOL_CANDIDATES, currencyMinorUnits, type CurrencyCode } from '@/lib/currency-metadata';
import { detectLaunchMarketFromSender } from '@/lib/markets';
import { extractUniversalDates } from '@/lib/universal-dates';
import { inspectUniversalMoneyDraft } from '@/lib/universal-money';

/**
 * PER-USER ALERT FORMAT LEARNING (deterministic, on device, no network).
 *
 * When the person confirms or corrects a Review item for an alert format no
 * parser recognises, `learnFromConfirmation` induces a strict TEMPLATE from
 * that one message: the bank's boilerplate stays as case-folded LITERAL
 * anchors, and only the parts that vary become typed SLOTS:
 *   AMT   the confirmed amount (grounded: found exactly once, as written,
 *         with its currency token adjacent, via the existing money tokeniser)
 *   BAL   every other money figure (balance, limit, converted figure). It
 *         may vary but can never become the amount.
 *   MER   the confirmed merchant (exact substring on token boundaries)
 *   DATE  the date token that parses (universal-dates.ts) to the confirmed day
 *   DATEX any other date token (not extracted)
 *   CARD  card / account digits near a card/account word (exact digit count)
 *   NUM   other digit runs (references, phone fragments), same separator shape
 *   ALNUM mixed letter+digit identifiers (references), same length
 *   TIME  clock times
 * Direction and status words are literals, so a template never matches a
 * message with a different direction or status word. No digit run, amount,
 * merchant or raw message text is stored: only anchors and slot types.
 *
 * `matchLearnedFormat` later parses a message only when the WHOLE message is
 * consumed by one template: literals exactly in order, every slot filled by a
 * token of its type, no money outside AMT/BAL, the amount in the learned ISO
 * currency and unambiguous, the date (if learned) valid, and no
 * pending/declined/OTP/promotion/statement/future wording (the same guards as
 * best-effort-autopost.ts). One confirmation gives `prefill`; `postThreshold`
 * (default 2) consistent confirmations give `post`.
 *
 * Launch markets: the proven AE/SA grammar is never overridden. Learning and
 * matching both refuse when the sender is an AE/SA launch sender
 * (`isLearnableSender`) or when the caller says the alert's route resolved to
 * AE/SA (`routedMarket: 'AE' | 'SA'` or `launchRoute: true`).
 *
 * ── INTEGRATION (for the lead engineer; this module is pure) ─────────────
 * Store field: persist `learnedAlertFormats: LearnedFormatStore` beside the
 * other parser preferences (start with `emptyLearnedFormatStore()`).
 *
 * 1. Review confirmation (the handler that turns a Review item for an
 *    UNRECOGNISED format into a ledger row, after the user confirmed/edited):
 *      const r = recordLearnedConfirmation(store, {
 *        source: item.rawText, sender: item.sender ?? null,
 *        confirmed: { amountMinor, currency, exponent, direction, merchant, date },
 *        context: { country: activeCountry, routedMarket, launchRoute },
 *        now: Date.now(),
 *      });
 *      if (r.ok) setLearnedAlertFormats(r.store);   // r.reason otherwise
 *    `merchant` must be the text span as it appears in the message (or
 *    omitted); a prettified name that is not in the text refuses learning
 *    ('merchant-not-grounded') — retry without it.
 *    Only call it for items that no proven parser (AE/SA launch grammar,
 *    certified template) recognised, and never for AE/SA routes.
 * 2. Parse chain (launch-alert-parser / capture), AFTER the AE/SA launch
 *    parser and certified templates declined and BEFORE best-effort/universal
 *    Review:
 *      const hit = matchLearnedFormat(source, sender, store,
 *        { postThreshold: 2, now: observedAt, routedMarket });
 *      hit.kind === 'post'    → add the row (keep the usual duplicate guard and
 *                               FX conversion; mark it undoable, carrying
 *                               hit.templateId)
 *      hit.kind === 'prefill' → Review item with hit.fields pre-filled
 *      hit.kind === 'none'    → continue the existing chain unchanged.
 * 3. Undo / reject of a row produced by a learned template:
 *      store = blockLearnedTemplate(store, templateId, now)   (stops it)
 *    Settings "forget" for one row: removeLearnedTemplate(store, id);
 *    "forget all": clearLearnedFormats().
 * 4. Settings list: listLearnedFormatsForSettings(store, { postThreshold })
 *    returns sender + a MASKED shape string only (never raw text).
 * 5. Backup/restore: include the store as-is (plain JSON); on restore call
 *    validateLearnedFormatStore(unknown) → store | null (null = reject that
 *    field; invalid templates are dropped, caps clamped, ids re-verified).
 */

export type LearnedDirection = 'debit' | 'credit';
export type LearnedDateOrder = 'DMY' | 'MDY' | 'YMD';

export type TemplateToken =
  | { k: 'L'; v: string; m?: 1 }
  | { k: 'AMT' }
  | { k: 'BAL'; iso: string }
  | { k: 'MER' }
  | { k: 'DATE'; f: string }
  | { k: 'DATEX'; f: string }
  | { k: 'TIME'; f: string }
  | { k: 'CARD'; f: string }
  | { k: 'NUM'; f: string }
  | { k: 'ALNUM'; n: number };

export interface LearnedTemplate {
  v: 1;
  /** Deterministic: hash of key + shape. */
  id: string;
  /** 's:<normalised sender>' or 'a:<anchor-signature hash>' for sender-less sources. */
  key: string;
  sender: string | null;
  direction: LearnedDirection;
  currency: string;
  exponent: number;
  /** Currency spellings grounded by the confirmation: folded token → ISO. */
  aliases: Record<string, string>;
  dateOrder: LearnedDateOrder | null;
  tokens: TemplateToken[];
  /** Boilerplate carries a security advisory ("never share your OTP"). */
  advisory: boolean;
  confirmations: number;
  blocked: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface LearnedFormatStore {
  version: 1;
  templates: LearnedTemplate[];
}

export interface LearnContext {
  /** User's ISO country; supplies the numeric date order when dateOrder is absent. */
  country?: string | null;
  dateOrder?: LearnedDateOrder | null;
  /** Market-pack aliases the caller already trusts (e.g. alertMarketPack(m).currencyAliases). */
  currencyAliases?: CurrencyAliasMap;
  /** The market the alert router resolved; AE/SA refuses. */
  routedMarket?: string | null;
  /** True when the caller's route resolved to the AE/SA launch parser. */
  launchRoute?: boolean;
}

export interface ConfirmedFields {
  amountMinor: number | string;
  currency: string;
  exponent: number;
  direction: LearnedDirection;
  merchant?: string | null;
  /** YYYY-MM-DD */
  date?: string | null;
}

export interface LearnInput {
  source: string;
  sender?: string | null;
  confirmed: ConfirmedFields;
  context?: LearnContext;
  now: number;
}

export type LearnRefusal =
  | 'invalid-input'
  | 'launch-market'
  | 'non-completed-wording'
  | 'ambiguous-money'
  | 'amount-not-grounded'
  | 'amount-not-unique'
  | 'merchant-not-grounded'
  | 'too-few-anchors'
  | 'too-long';

export type LearnResult = { ok: true; template: LearnedTemplate } | { ok: false; reason: LearnRefusal };

export interface LearnedFields {
  amountMinor: number;
  currency: string;
  exponent: number;
  direction: LearnedDirection;
  merchant?: string;
  date?: string;
  cardLast4?: string;
}

export type LearnedMatch =
  | { kind: 'none' }
  | { kind: 'prefill'; fields: LearnedFields; templateId: string; confirmations: number }
  | { kind: 'post'; fields: LearnedFields; templateId: string; confirmations: number };

export interface MatchOptions {
  /** Confirmations needed before a match may post. Default 2, minimum 1. */
  postThreshold?: number;
  /** Epoch ms; a matched date after this local day refuses. */
  now?: number;
  routedMarket?: string | null;
  launchRoute?: boolean;
}

export const LEARNED_FORMATS_MAX_TEMPLATES = 200;
export const LEARNED_FORMATS_MAX_PER_KEY = 40;
const MAX_SOURCE = 1000;
const MAX_TOKENS = 160;
const MAX_MERCHANT_TOKENS = 16;
const MAX_MERCHANT_CHARS = 96;
const MAX_CONFIRMATIONS = 1000;
const LAUNCH = new Set(['AE', 'SA']);

/* ── small utilities ─────────────────────────────────────────────────── */

/** cyrb53: deterministic, dependency-free string hash (not cryptographic). */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, '0');
}

/** Case-fold a literal: lower case, Turkish dotless i and combining dot folded. */
const fold = (text: string): string =>
  text.normalize('NFC').toLowerCase().replace(/ı/g, 'i').replace(/̇/g, '');

/** Same-length fold, for locating substrings by index. */
const foldSameLength = (text: string): string => {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const lower = text[i].toLowerCase();
    out += lower.length === 1 ? (lower === 'ı' ? 'i' : lower) : text[i];
  }
  return out;
};

const localIsoDay = (epochMs: number | undefined): string | null => {
  if (epochMs === undefined || !Number.isFinite(epochMs)) return null;
  const day = new Date(epochMs);
  if (!Number.isFinite(day.getTime())) return null;
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
};

/** Normalised sender key: upper case, whitespace collapsed, Indian DLT prefix/suffix removed. */
export function normalizeLearnedSender(sender: string | null | undefined): string | null {
  if (typeof sender !== 'string') return null;
  let value = sender.normalize('NFKC').trim().toUpperCase().replace(/\s+/g, ' ');
  const dlt = value.match(/^[A-Z]{2}-([A-Z0-9]{4,})(?:-[A-Z])?$/);
  if (dlt) value = dlt[1];
  return value ? value.slice(0, 64) : null;
}

/** False for AE/SA launch senders, whose proven grammar must never be overridden. */
export function isLearnableSender(sender: string | null | undefined): boolean {
  if (!sender || !sender.trim()) return true;
  return detectLaunchMarketFromSender(sender) === null;
}

const launchRefused = (sender: string | null | undefined, context: { routedMarket?: string | null; launchRoute?: boolean } | undefined): boolean =>
  !isLearnableSender(sender) || !!context?.launchRoute ||
  (!!context?.routedMarket && LAUNCH.has(String(context.routedMarket).toUpperCase()));

/* ── wording guards ──────────────────────────────────────────────────── */

const SECRET = /(?<![\p{L}\p{N}])(?:otp|pin|password|passcode|cvv|codes?|claves?|senha|şifre\p{L}*|sifre\p{L}*|tan|kode|codici|codice)(?![\p{L}\p{N}])|رمز|كلمة\s+(?:المرور|السر)/iu;
const SHARE = /(?<![\p{L}\p{N}])(?:share|sharing|disclose|reveal|tell|batay\p{L}*|berikan|paylaş\p{L}*|compart\p{L}*|informe|communiquez|comunicare|comunique|weiter\p{L}*|deel|divulg\p{L}*)(?![\p{L}\p{N}])|تشارك|تفصح|تعطي/iu;

/** Remove digit-free security-advisory sentences ("Never share your OTP or PIN"). */
const stripAdvisory = (text: string): string =>
  text.replace(/[^.!?।\n]+[.!?।]*/g, (sentence) =>
    !/\d/.test(sentence) && SECRET.test(sentence) && SHARE.test(sentence) ? ' ' : sentence);

const HARD_REASONS = new Set([
  'authentication-or-otp', 'declined-or-failed', 'scheduled-or-due', 'promotion',
  'aggregate-or-summary', 'balance-only', 'input-too-long',
]);

const refusesWording = (text: string): boolean =>
  hasNonCompletedWording(text) || inspectAlertDraft(text).reasons.some((reason) => HARD_REASONS.has(reason));

/* ── currency spellings ──────────────────────────────────────────────── */

/**
 * Local spellings that are only applied when the person's confirmation names
 * the matching ISO currency. Never a global symbol table: one of these is
 * adopted by a template only if the confirmed amount is found next to it.
 */
const LOCAL_ALIASES: Readonly<Record<string, readonly string[]>> = {
  TL: ['TRY'], '₺': ['TRY'], Dhs: ['AED'], DH: ['MAD'], 'درهم': ['MAD'], SR: ['SAR'], 'ريال': ['SAR'],
  KD: ['KWD'], BD: ['BHD'], RO: ['OMR'], 'R.O.': ['OMR'], LE: ['EGP'], 'E£': ['EGP'],
  'Rs.': ['INR', 'PKR', 'LKR', 'NPR'], MN: ['MXN'], 'MX$': ['MXN'], 'CA$': ['CAD'], C$: ['CAD'],
  A$: ['AUD'], S$: ['SGD'], NZ$: ['NZD'], HK$: ['HKD'], '₱': ['PHP'], P: ['PHP'], N: ['NGN'], R: ['ZAR'],
  'Fr.': ['CHF'], Tk: ['BDT'], '৳': ['BDT'], '₫': ['VND'], '₪': ['ILS'], 'zł': ['PLN'], 'Kč': ['CZK'],
  kr: ['SEK', 'NOK', 'DKK', 'ISK'], 'Rp.': ['IDR'], Ksh: ['KES'],
};

const aliasesForConfirmation = (iso: string, extra: CurrencyAliasMap | undefined): Record<string, CurrencyCode[]> => {
  const out: Record<string, CurrencyCode[]> = {};
  for (const [token, isos] of Object.entries(extra ?? {})) {
    const valid = isos.filter((code) => currencyMinorUnits(code) !== null);
    if (valid.length) out[token] = [...valid];
  }
  for (const [token, isos] of Object.entries(LOCAL_ALIASES)) {
    if (isos.includes(iso)) out[token] = [iso as CurrencyCode];
  }
  // A shared symbol ($, ¥, Rs) is resolved to the currency the person confirmed.
  for (const [token, isos] of Object.entries(CURRENCY_SYMBOL_CANDIDATES)) {
    if (isos.length > 1 && isos.includes(iso as CurrencyCode)) out[token] = [iso as CurrencyCode];
  }
  return out;
};

/** The currency spelling of a money token (folded), e.g. 'usd', '$', 'tl'. */
const currencyTokenOf = (candidate: MoneyCandidate): string => {
  const text = candidate.sourceText.trim();
  const before = text.match(/^([^\d+-]*?)\s*[+-]?\d/);
  const token = before && before[1] ? before[1] : text.replace(/^.*\d\s*/s, '');
  return fold(token.trim());
};

/* ── dates ───────────────────────────────────────────────────────────── */

const MONTHS: Readonly<Record<string, number>> = (() => {
  const table: Record<string, number> = {};
  const add = (month: number, ...names: string[]) => {
    for (const name of names) { table[fold(name)] = month; table[name.toLowerCase()] = month; }
  };
  add(1, 'jan', 'january', 'janv', 'janvier', 'januar', 'ene', 'enero', 'janeiro', 'gen', 'gennaio', 'januari', 'oca', 'ocak', 'يناير');
  add(2, 'feb', 'february', 'févr', 'fevr', 'février', 'februar', 'febrero', 'fev', 'fevereiro', 'febbraio', 'februari', 'şub', 'şubat', 'فبراير');
  add(3, 'mar', 'march', 'mars', 'märz', 'mär', 'marzo', 'março', 'marco', 'mrt', 'maart', 'mart', 'maret', 'مارس');
  add(4, 'apr', 'april', 'avr', 'avril', 'abr', 'abril', 'aprile', 'nis', 'nisan', 'أبريل', 'ابريل');
  add(5, 'may', 'mai', 'mayo', 'maio', 'mag', 'maggio', 'mei', 'mayıs', 'مايو');
  add(6, 'jun', 'june', 'juin', 'juni', 'junio', 'junho', 'giu', 'giugno', 'haz', 'haziran', 'يونيو');
  add(7, 'jul', 'july', 'juil', 'juillet', 'juli', 'julio', 'julho', 'lug', 'luglio', 'tem', 'temmuz', 'يوليو');
  add(8, 'aug', 'august', 'août', 'aout', 'ago', 'agosto', 'augustus', 'ağu', 'ağustos', 'agu', 'agt', 'agustus', 'أغسطس', 'اغسطس');
  add(9, 'sep', 'sept', 'september', 'septembre', 'septiembre', 'set', 'setembro', 'settembre', 'eyl', 'eylül', 'سبتمبر');
  add(10, 'oct', 'october', 'octobre', 'okt', 'oktober', 'octubre', 'out', 'outubro', 'ott', 'ottobre', 'eki', 'ekim', 'أكتوبر', 'اكتوبر');
  add(11, 'nov', 'november', 'novembre', 'noviembre', 'novembro', 'kas', 'kasım', 'kasim', 'نوفمبر');
  add(12, 'dec', 'december', 'déc', 'decembre', 'décembre', 'dez', 'dezember', 'dic', 'diciembre', 'dezembro', 'dicembre', 'ara', 'aralık', 'aralik', 'des', 'desember', 'ديسمبر');
  return table;
})();
const EN_MONTH = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const escapeRe = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).map(escapeRe).join('|');
const NUM_DATE = /(?<![\p{L}\p{N}./-])(?:\d{4}([/.-])\d{1,2}\1\d{1,2}|\d{1,2}([/.-])\d{1,2}\2(?:\d{4}|\d{2}))(?![\p{L}\p{N}]|[/.-]\d)/gu;
const WORD_DATE_DMY = new RegExp(
  `(?<![\\p{L}\\p{N}])(\\d{1,2})([\\s-]*)(${MONTH_ALT})(\\.?)([\\s,-]*)(\\d{4}|\\d{2})(?![\\p{L}\\p{N}])`, 'giu');
const WORD_DATE_MDY = new RegExp(
  `(?<![\\p{L}\\p{N}])(${MONTH_ALT})(\\.?)(\\s+)(\\d{1,2})(,?\\s+)(\\d{4})(?![\\p{L}\\p{N}])`, 'giu');
const TIME_TOKEN = /(?<![\p{L}\p{N}:])\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?m\.?)?(?![\p{L}\p{N}])/giu;

const expandYear = (year: string): string => (year.length === 2 ? `20${year}` : year);

/** One calendar date through universal-dates.ts, or null when not exactly one. */
const universalDate = (text: string, order: LearnedDateOrder | null): string | null => {
  const field = extractUniversalDates(text, order ? { dateOrder: order } : {}, []).transactionDate;
  return field.evidence === 'explicit' && field.value ? field.value : null;
};

interface DateInfo { kind: 'num' | 'word'; form: string; parse: (order: LearnedDateOrder | null) => string | null }

const numericDate = (text: string): DateInfo => {
  const parts = text.split(/[/.-]/);
  const form = `n${text.replace(/\d{4}/g, 'Y').replace(/\d{1,2}/g, '9')}`;
  if (parts[0].length === 4) {
    return { kind: 'num', form, parse: () => universalDate(`${parts[0]}-${parts[1]}-${parts[2]}`, null) };
  }
  const rebuilt = `${parts[0]}/${parts[1]}/${expandYear(parts[2])}`;
  return { kind: 'num', form, parse: (order) => universalDate(rebuilt, order === 'YMD' ? null : order) };
};

const wordDate = (day: string, monthWord: string, year: string, form: string): DateInfo => {
  const month = MONTHS[fold(monthWord)];
  const text = `${Number(day)} ${EN_MONTH[(month ?? 1) - 1]} ${expandYear(year)}`;
  return { kind: 'word', form, parse: () => (month ? universalDate(text, null) : null) };
};

/* ── tokenisation ────────────────────────────────────────────────────── */

type MsgToken =
  | { k: 'MONEY'; start: number; end: number; nl: boolean; money: MoneyCandidate }
  | { k: 'DATE'; start: number; end: number; nl: boolean; date: DateInfo }
  | { k: 'TIME'; start: number; end: number; nl: boolean; f: string }
  | { k: 'NUM'; start: number; end: number; nl: boolean; loose: string; exact: string; digits: string }
  | { k: 'MASK'; start: number; end: number; nl: boolean; loose: string; exact: string; digits: string }
  | { k: 'ALNUM'; start: number; end: number; nl: boolean; n: number }
  | { k: 'WORD'; start: number; end: number; nl: boolean; v: string }
  | { k: 'PUNCT'; start: number; end: number; nl: boolean; v: string };

interface Tokenised { normalized: string; tokens: MsgToken[]; overlap: boolean; moneyAmbiguous: boolean }

type Special = { start: number; end: number; make: (nl: boolean) => MsgToken };

function tokenise(source: string, aliases: CurrencyAliasMap): Tokenised {
  const draft = inspectUniversalMoneyDraft(source, { currencyAliases: aliases });
  const normalized = draft.normalizedText;
  const specials: Special[] = [];
  const free = (start: number, end: number) => !specials.some((s) => start < s.end && end > s.start);
  let overlap = false;
  const money = [...draft.candidates].sort((a, b) => a.span.start - b.span.start);
  for (const candidate of money) {
    const { start, end } = candidate.span;
    // A money token glued to a letter or digit (A101 272,02 TL) may have
    // absorbed part of a name or reference: never guess where it begins.
    const glued = (start > 0 && /[\p{L}\p{N}]/u.test(normalized[start - 1])) ||
      (end < normalized.length && /[\p{L}\p{N}]/u.test(normalized[end]));
    if (glued || !free(start, end)) { overlap = true; continue; }
    specials.push({ start, end, make: (nl) => ({ k: 'MONEY', start, end, nl, money: candidate }) });
  }
  const addDate = (start: number, end: number, info: DateInfo) => {
    if (free(start, end)) specials.push({ start, end, make: (nl) => ({ k: 'DATE', start, end, nl, date: info }) });
  };
  for (const match of normalized.matchAll(WORD_DATE_DMY)) {
    const [, day, s1, mon, dot, s2, year] = match;
    const form = `wD9${s1.replace(/\s+/g, ' ')}M${dot}${s2.replace(/\s+/g, ' ')}${year.length === 4 ? 'Y' : 'y'}`;
    addDate(match.index!, match.index! + match[0].length, wordDate(day, mon, year, form));
  }
  for (const match of normalized.matchAll(WORD_DATE_MDY)) {
    const [, mon, dot, s1, day, s2, year] = match;
    const form = `wMM${dot}${s1.replace(/\s+/g, ' ')}9${s2.replace(/\s+/g, ' ')}Y`;
    addDate(match.index!, match.index! + match[0].length, wordDate(day, mon, year, form));
  }
  for (const match of normalized.matchAll(NUM_DATE)) {
    addDate(match.index!, match.index! + match[0].length, numericDate(match[0]));
  }
  for (const match of normalized.matchAll(TIME_TOKEN)) {
    const start = match.index!;
    const end = start + match[0].length;
    const f = fold(match[0]).replace(/\s+/g, '').replace(/\d+/g, '9').replace(/[ap]\.?m\.?/, 'A');
    if (free(start, end)) specials.push({ start, end, make: (nl) => ({ k: 'TIME', start, end, nl, f }) });
  }
  specials.sort((a, b) => a.start - b.start);

  const tokens: MsgToken[] = [];
  const WORDISH = /[\p{L}\p{M}\p{N}_]+/uy;
  const NUMBERISH = /\d+(?:[.,/:\-']\d+)*/y;
  let p = 0;
  let nl = false;
  let si = 0;
  while (p < normalized.length) {
    if (si < specials.length && specials[si].start === p) {
      tokens.push(specials[si].make(nl));
      nl = false;
      p = specials[si].end;
      si++;
      continue;
    }
    const limit = si < specials.length ? specials[si].start : normalized.length;
    const ch = normalized[p];
    if (/\s/u.test(ch)) { if (ch === '\n' || ch === '\r') nl = true; p++; continue; }
    WORDISH.lastIndex = p;
    const word = WORDISH.exec(normalized);
    if (word) {
      let text = word[0];
      if (p + text.length > limit) text = text.slice(0, limit - p);
      const start = p;
      if (/^\d+$/.test(text)) {
        NUMBERISH.lastIndex = p;
        const num = NUMBERISH.exec(normalized);
        const numText = num && p + num[0].length <= limit ? num[0] : text;
        const end = start + numText.length;
        tokens.push({ k: 'NUM', start, end, nl, loose: numText.replace(/\d+/g, '9'), exact: numText.replace(/\d/g, '#'), digits: numText.replace(/\D/g, '') });
        p = end;
      } else if (/\d/.test(text) && /[\p{L}\p{M}]/u.test(text)) {
        const end = start + text.length;
        const mask = text.match(/^([xX*•]+)(\d{2,})$/);
        if (mask) {
          const prefix = fold(mask[1]);
          tokens.push({ k: 'MASK', start, end, nl, loose: `${prefix}9`, exact: `${prefix}${'#'.repeat(mask[2].length)}`, digits: mask[2] });
        } else {
          tokens.push({ k: 'ALNUM', start, end, nl, n: text.length });
        }
        p = end;
      } else if (text.length) {
        tokens.push({ k: 'WORD', start, end: start + text.length, nl, v: fold(text) });
        p = start + text.length;
      } else { p++; continue; }
      nl = false;
      continue;
    }
    const code = normalized.codePointAt(p) as number;
    const width = code > 0xffff ? 2 : 1;
    tokens.push({ k: 'PUNCT', start: p, end: p + width, nl, v: normalized.slice(p, p + width) });
    nl = false;
    p += width;
  }
  const moneyAmbiguous = money.some((candidate) => candidate.currencyCandidates.length !== 1);
  return { normalized, tokens, overlap, moneyAmbiguous };
}

/** Unique minor units for `iso` in a money token, or null when absent/ambiguous. */
const uniqueMinor = (candidate: MoneyCandidate, iso: string, exponent: number): string | null => {
  if (candidate.currencyCandidates.length !== 1 || candidate.currencyCandidates[0] !== iso) return null;
  const values = [...new Set(candidate.interpretations
    .filter((row) => row.currency === iso && row.exponent === exponent).map((row) => row.minorUnits))];
  return values.length === 1 ? values[0] : null;
};

const CARD_CUE = /(?:^|\s)(?:cards?|carte|karte|kart\S*|tarjeta|cart[aã]o|carta|kaart|kartu|ending|endet|terminada|terminado|biten|acct|account|acc|a \/ c|konto|compte|cuenta|conta|rekening|hesab\S*|بطاقة|البطاقة|بطاقتك|حساب|الحساب|حسابك)(?=\s|$)/u;

const nearCardWord = (tokens: MsgToken[], index: number): boolean => {
  const around = [...tokens.slice(Math.max(0, index - 4), index), ...tokens.slice(index + 1, index + 4)]
    .map((token) => (token.k === 'WORD' || token.k === 'PUNCT' ? token.v : '#')).join(' ');
  return CARD_CUE.test(` ${around} `);
};

/* ── learning ────────────────────────────────────────────────────────── */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The identity of a shape. Date spellings and card-mask prefixes are matched
 * loosely (see matchTemplate), so they do not split one format in two.
 */
const shapeString = (tokens: readonly TemplateToken[]): string =>
  JSON.stringify(tokens.map((token) => {
    if (token.k === 'L') return { k: 'L', v: token.v };
    if (token.k === 'DATE' || token.k === 'DATEX') return { k: token.k };
    if (token.k === 'CARD') return { k: 'CARD', n: token.f.replace(/[^#]/g, '').length };
    return token;
  }));

const templateId = (key: string, tokens: readonly TemplateToken[]): string =>
  `lf_${hash(`${key}\u0001${shapeString(tokens)}`)}`;

const keyFor = (sender: string | null, tokens: readonly TemplateToken[]): string =>
  sender ? `s:${sender}` : `a:${hash(tokens.filter((t) => t.k === 'L').map((t) => (t as { v: string }).v).join('\u0001'))}`;

/** Literal words that may be a person or merchant name are masked in Settings. */
const looksLikeName = (original: string, previous: MsgToken | undefined): boolean => {
  const letters = original.replace(/[^\p{L}]/gu, '');
  if (!letters) return false;
  const upper = letters.replace(/[^\p{Lu}]/gu, '').length;
  if (upper === letters.length && letters.length >= 5) return true;
  const titled = /^\p{Lu}/u.test(letters) && upper < letters.length;
  const sentenceStart = !previous || (previous.k === 'PUNCT' && /[.:!?|]/.test(previous.v)) || previous.nl;
  return titled && !sentenceStart;
};

export function learnFromConfirmation(input: LearnInput): LearnResult {
  const refuse = (reason: LearnRefusal): LearnResult => ({ ok: false, reason });
  const { source, confirmed } = input;
  const context = input.context ?? {};
  if (typeof source !== 'string' || !source.trim() || !confirmed || !Number.isFinite(input.now)) return refuse('invalid-input');
  if (source.length > MAX_SOURCE) return refuse('too-long');
  const iso = typeof confirmed.currency === 'string' ? confirmed.currency.toUpperCase() : '';
  const exponent = currencyMinorUnits(iso);
  if (exponent === null || exponent !== confirmed.exponent) return refuse('invalid-input');
  if (confirmed.direction !== 'debit' && confirmed.direction !== 'credit') return refuse('invalid-input');
  const minorText = String(confirmed.amountMinor);
  if (!/^[1-9]\d{0,15}$/.test(minorText) || !Number.isSafeInteger(Number(minorText))) return refuse('invalid-input');
  if (confirmed.date != null && (typeof confirmed.date !== 'string' || !ISO_DATE.test(confirmed.date))) return refuse('invalid-input');
  if (launchRefused(input.sender, context)) return refuse('launch-market');

  const normalizedAll = normalizeAlertText(source);
  const stripped = stripAdvisory(normalizedAll);
  if (refusesWording(stripped)) return refuse('non-completed-wording');
  const advisory = refusesWording(normalizedAll);

  const aliasMap = aliasesForConfirmation(iso, context.currencyAliases);
  const tok = tokenise(source, aliasMap);
  if (tok.overlap || tok.moneyAmbiguous) return refuse('ambiguous-money');
  if (tok.tokens.length > MAX_TOKENS) return refuse('too-long');
  const tokens = tok.tokens;

  // AMT: grounded exactly once.
  const amountIndexes = tokens.flatMap((token, index) =>
    token.k === 'MONEY' && uniqueMinor(token.money, iso, exponent) === minorText ? [index] : []);
  if (!amountIndexes.length) return refuse('amount-not-grounded');
  if (amountIndexes.length > 1) return refuse('amount-not-unique');
  const amountIndex = amountIndexes[0];

  // MER: exact substring on token boundaries.
  let merchantRange: [number, number] | null = null;
  const merchant = typeof confirmed.merchant === 'string' ? confirmed.merchant.trim() : '';
  if (merchant) {
    if (merchant.length > MAX_MERCHANT_CHARS) return refuse('merchant-not-grounded');
    const occurrences = (haystack: string, needle: string): number[] => {
      const found: number[] = [];
      for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) found.push(at);
      return found;
    };
    let hits = occurrences(source, merchant);
    if (hits.length === 0) hits = occurrences(foldSameLength(tok.normalized), foldSameLength(normalizeAlertText(merchant)));
    if (hits.length !== 1) return refuse('merchant-not-grounded');
    const startIndex = tokens.findIndex((token) => token.start === hits[0]);
    const endIndex = tokens.findIndex((token) => token.end === hits[0] + merchant.length);
    if (startIndex < 0 || endIndex < startIndex || endIndex - startIndex + 1 > MAX_MERCHANT_TOKENS) return refuse('merchant-not-grounded');
    for (let i = startIndex; i <= endIndex; i++) {
      const token = tokens[i];
      if (token.k === 'MONEY' || token.k === 'DATE' || token.k === 'TIME' || (i > startIndex && token.nl)) return refuse('merchant-not-grounded');
    }
    if (tokens[startIndex].k === 'PUNCT') return refuse('merchant-not-grounded');
    merchantRange = [startIndex, endIndex];
  }

  // DATE: the one date token that parses to the confirmed day.
  const preferred: LearnedDateOrder | null = context.dateOrder ?? dateOrderForCountry(context.country ?? null);
  let dateIndex = -1;
  let dateOrder: LearnedDateOrder | null = null;
  if (confirmed.date) {
    const hitsByIndex: { index: number; order: LearnedDateOrder | null }[] = [];
    tokens.forEach((token, index) => {
      if (token.k !== 'DATE') return;
      if (token.date.kind === 'word' || token.date.form.startsWith('nY')) {
        if (token.date.parse(null) === confirmed.date) hitsByIndex.push({ index, order: null });
        return;
      }
      const orders = (['DMY', 'MDY'] as const).filter((order) => token.date.parse(order) === confirmed.date);
      if (orders.length === 1) hitsByIndex.push({ index, order: orders[0] });
      else if (orders.length === 2) hitsByIndex.push({ index, order: preferred === 'DMY' || preferred === 'MDY' ? preferred : null });
    });
    if (hitsByIndex.length === 1) { dateIndex = hitsByIndex[0].index; dateOrder = hitsByIndex[0].order; }
  }

  const out: TemplateToken[] = [];
  const usedAliases: Record<string, string> = {};
  const noteAlias = (candidate: MoneyCandidate) => {
    const spelled = currencyTokenOf(candidate);
    const code = candidate.currencyCandidates[0];
    const alias = Object.keys(aliasMap).find((token) => fold(token) === spelled && aliasMap[token].length === 1);
    if (alias && code) usedAliases[fold(alias)] = code;
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (merchantRange && i === merchantRange[0]) { out.push({ k: 'MER' }); i = merchantRange[1]; continue; }
    switch (token.k) {
      case 'MONEY':
        noteAlias(token.money);
        out.push(i === amountIndex ? { k: 'AMT' } : { k: 'BAL', iso: token.money.currencyCandidates[0] });
        break;
      case 'DATE':
        out.push(i === dateIndex ? { k: 'DATE', f: token.date.form } : { k: 'DATEX', f: token.date.form });
        break;
      case 'TIME': out.push({ k: 'TIME', f: token.f }); break;
      case 'NUM':
        if (token.loose === '9' && token.digits.length >= 2 && token.digits.length <= 6 && nearCardWord(tokens, i)) {
          out.push({ k: 'CARD', f: token.exact });
        } else out.push({ k: 'NUM', f: token.loose });
        break;
      case 'MASK':
        out.push(nearCardWord(tokens, i) ? { k: 'CARD', f: token.exact } : { k: 'NUM', f: token.loose });
        break;
      case 'ALNUM': out.push({ k: 'ALNUM', n: token.n }); break;
      case 'WORD': {
        const literal: TemplateToken = { k: 'L', v: token.v };
        if (looksLikeName(source.slice(token.start, token.end), tokens[i - 1])) literal.m = 1;
        out.push(literal);
        break;
      }
      case 'PUNCT': out.push({ k: 'L', v: token.v }); break;
    }
  }
  if (out.filter((token) => token.k === 'L' && /[\p{L}]/u.test(token.v)).length < 2) return refuse('too-few-anchors');

  const sender = normalizeLearnedSender(input.sender);
  const key = keyFor(sender, out);
  const template: LearnedTemplate = {
    v: 1,
    id: templateId(key, out),
    key,
    sender,
    direction: confirmed.direction,
    currency: iso,
    exponent,
    aliases: usedAliases,
    // A word or ISO date proves no numeric order; the country's order is then
    // the only evidence for a later numeric spelling from this bank.
    dateOrder: dateIndex >= 0 ? (dateOrder ?? (preferred === 'DMY' || preferred === 'MDY' ? preferred : null)) : null,
    tokens: out,
    advisory,
    confirmations: 1,
    blocked: false,
    createdAt: input.now,
    updatedAt: input.now,
  };
  // Self-check: what is learned must survive the same validation a restore uses.
  if (!validTemplate(template)) return refuse('too-long');
  return { ok: true, template };
}

/* ── store helpers ───────────────────────────────────────────────────── */

export const emptyLearnedFormatStore = (): LearnedFormatStore => ({ version: 1, templates: [] });

const enforceCaps = (templates: LearnedTemplate[], protect?: string): LearnedTemplate[] => {
  const newestFirst = [...templates].sort((a, b) =>
    (a.id === protect ? -1 : b.id === protect ? 1 : 0) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  const perKey = new Map<string, number>();
  const kept: LearnedTemplate[] = [];
  for (const template of newestFirst) {
    const count = perKey.get(template.key) ?? 0;
    if (count >= LEARNED_FORMATS_MAX_PER_KEY || kept.length >= LEARNED_FORMATS_MAX_TEMPLATES) continue;
    perKey.set(template.key, count + 1);
    kept.push(template);
  }
  const order = new Map(templates.map((template, index) => [template.id, index]));
  return kept.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
};

/**
 * Add a freshly learned template, or count a repeat confirmation of the same
 * shape. A contradictory confirmation (other direction or currency for the
 * same shape) blocks the template; a blocked template stays blocked until it
 * is removed.
 */
export function addOrUpdateLearnedTemplate(store: LearnedFormatStore, template: LearnedTemplate, now: number = template.updatedAt): LearnedFormatStore {
  const templates = [...(store?.templates ?? [])];
  const index = templates.findIndex((row) => row.id === template.id);
  if (index < 0) {
    templates.push({ ...template, confirmations: 1, blocked: false, createdAt: now, updatedAt: now });
  } else {
    const existing = templates[index];
    if (existing.blocked) {
      templates[index] = { ...existing, updatedAt: now };
    } else if (existing.direction !== template.direction || existing.currency !== template.currency) {
      templates[index] = { ...existing, blocked: true, confirmations: 0, updatedAt: now };
    } else {
      templates[index] = {
        ...existing,
        confirmations: Math.min(MAX_CONFIRMATIONS, existing.confirmations + 1),
        aliases: { ...existing.aliases, ...template.aliases },
        dateOrder: existing.dateOrder ?? template.dateOrder,
        advisory: existing.advisory || template.advisory,
        updatedAt: now,
      };
    }
  }
  return { version: 1, templates: enforceCaps(templates, template.id) };
}

/** learnFromConfirmation + addOrUpdateLearnedTemplate in one call. */
export function recordLearnedConfirmation(
  store: LearnedFormatStore,
  input: LearnInput,
): { ok: true; store: LearnedFormatStore; template: LearnedTemplate } | { ok: false; reason: LearnRefusal; store: LearnedFormatStore } {
  const learned = learnFromConfirmation(input);
  if (!learned.ok) return { ok: false, reason: learned.reason, store };
  const next = addOrUpdateLearnedTemplate(store, learned.template, input.now);
  return { ok: true, store: next, template: next.templates.find((row) => row.id === learned.template.id) ?? learned.template };
}

/** The person rejected or undid a row this template produced: stop using it. */
export function blockLearnedTemplate(store: LearnedFormatStore, id: string, now: number): LearnedFormatStore {
  return {
    version: 1,
    templates: (store?.templates ?? []).map((row) => (row.id === id ? { ...row, blocked: true, confirmations: 0, updatedAt: now } : row)),
  };
}

export function removeLearnedTemplate(store: LearnedFormatStore, id: string): LearnedFormatStore {
  return { version: 1, templates: (store?.templates ?? []).filter((row) => row.id !== id) };
}

export const clearLearnedFormats = (): LearnedFormatStore => emptyLearnedFormatStore();

/* ── matching ────────────────────────────────────────────────────────── */

/**
 * A space-grouped figure ("5 272,02 TL") could have swallowed digits that end
 * a merchant name or reference in front of it. It is accepted only when the
 * template puts a literal (which never contains digits) directly before it.
 */
const spacedMoneyAllowed = (money: MoneyCandidate, previous: TemplateToken | undefined): boolean =>
  !/\d[\s'\u2019]+\d/.test(money.sourceText) || !previous || previous.k === 'L';

interface Parse { amount: string; merchant?: [number, number]; date?: string; card?: string; dateOk: boolean }

function matchTemplate(template: LearnedTemplate, tok: Tokenised): Parse[] {
  const tt = template.tokens;
  const mt = tok.tokens;
  const results: Parse[] = [];
  const state: { amount?: string; merchant?: [number, number]; date?: string; card?: string } = {};
  const walk = (ti: number, mi: number): void => {
    if (results.length > 1) return;
    if (ti === tt.length) {
      if (mi === mt.length && state.amount) results.push({ ...state, amount: state.amount, dateOk: true });
      return;
    }
    if (mi > mt.length) return;
    const slot = tt[ti];
    const token = mt[mi];
    if (slot.k === 'MER') {
      let chars = 0;
      for (let end = mi; end < mt.length && end - mi < MAX_MERCHANT_TOKENS; end++) {
        const part = mt[end];
        if (part.k === 'MONEY' || part.k === 'DATE' || part.k === 'TIME') break;
        if (end === mi && part.k === 'PUNCT') break;
        if (end > mi && part.nl) break;
        chars = part.end - mt[mi].start;
        if (chars > MAX_MERCHANT_CHARS) break;
        state.merchant = [mt[mi].start, part.end];
        walk(ti + 1, end + 1);
        state.merchant = undefined;
        if (results.length > 1) return;
      }
      return;
    }
    if (!token) return;
    switch (slot.k) {
      case 'L':
        if ((token.k === 'WORD' || token.k === 'PUNCT') && token.v === slot.v) walk(ti + 1, mi + 1);
        return;
      case 'AMT': {
        if (token.k !== 'MONEY' || !spacedMoneyAllowed(token.money, tt[ti - 1])) return;
        const minor = uniqueMinor(token.money, template.currency, template.exponent);
        if (!minor || !/^[1-9]\d{0,15}$/.test(minor)) return;
        state.amount = minor;
        walk(ti + 1, mi + 1);
        state.amount = undefined;
        return;
      }
      case 'BAL':
        if (token.k === 'MONEY' && token.money.currencyCandidates.length === 1 &&
          token.money.currencyCandidates[0] === slot.iso && spacedMoneyAllowed(token.money, tt[ti - 1])) walk(ti + 1, mi + 1);
        return;
      case 'DATE': {
        // Any date spelling is accepted as long as it parses to exactly one
        // day with the learned order: banks vary numeric/word forms.
        if (token.k !== 'DATE') return;
        const value = token.date.parse(template.dateOrder);
        if (!value) return;
        state.date = value;
        walk(ti + 1, mi + 1);
        state.date = undefined;
        return;
      }
      case 'DATEX':
        if (token.k === 'DATE') walk(ti + 1, mi + 1);
        return;
      case 'TIME':
        if (token.k === 'TIME' && token.f === slot.f) walk(ti + 1, mi + 1);
        return;
      case 'CARD':
        // Same digit count; the masking prefix (XX / XXXX) may vary.
        if ((token.k === 'NUM' || token.k === 'MASK') && /^[^/.,:'-]*$/.test(token.exact) &&
          token.digits.length === slot.f.replace(/[^#]/g, '').length) {
          const previous = state.card;
          state.card = state.card ?? token.digits.slice(-4);
          walk(ti + 1, mi + 1);
          state.card = previous;
        }
        return;
      case 'NUM':
        if ((token.k === 'NUM' || token.k === 'MASK') && token.loose === slot.f) walk(ti + 1, mi + 1);
        return;
      case 'ALNUM':
        if (token.k === 'ALNUM' && token.n === slot.n) walk(ti + 1, mi + 1);
        return;
    }
  };
  walk(0, 0);
  return results;
}

/**
 * Parse `source` with the person's learned formats. Returns 'none' unless
 * exactly one active template consumes the whole message unambiguously.
 */
export function matchLearnedFormat(
  source: string,
  sender: string | null | undefined,
  store: LearnedFormatStore | null | undefined,
  options: MatchOptions = {},
): LearnedMatch {
  const none: LearnedMatch = { kind: 'none' };
  if (!store || !Array.isArray(store.templates) || !store.templates.length) return none;
  if (typeof source !== 'string' || !source.trim() || source.length > MAX_SOURCE) return none;
  if (launchRefused(sender, options)) return none;
  const normSender = normalizeLearnedSender(sender);
  const senderTemplates = store.templates.filter((row) => row.sender === normSender);
  if (!senderTemplates.length) return none;

  const normalizedAll = normalizeAlertText(source);
  // Cheap prefilter: every literal word of a template must occur in the text.
  const folded = fold(normalizedAll);
  const candidates = senderTemplates.filter((row) =>
    row.tokens.every((token) => token.k !== 'L' || folded.includes(token.v)));
  if (!candidates.length) return none;
  const strippedRefuses = refusesWording(stripAdvisory(normalizedAll));
  if (strippedRefuses) return none;
  const fullRefuses = refusesWording(normalizedAll);

  const tokenCache = new Map<string, Tokenised>();
  const hits: { template: LearnedTemplate; parse: Parse }[] = [];
  let blockedHit = false;
  for (const template of candidates) {
    if (fullRefuses && !template.advisory) continue;
    const aliasKey = JSON.stringify([template.currency, Object.entries(template.aliases).sort()]);
    let tok = tokenCache.get(aliasKey);
    if (!tok) {
      // The spellings learning applies for the confirmed currency, plus those
      // this template grounded. The alias collector matches case-insensitively,
      // so folded spellings suffice.
      const aliasMap: Record<string, CurrencyCode[]> = aliasesForConfirmation(template.currency, undefined);
      for (const [token, code] of Object.entries(template.aliases)) aliasMap[token] = [code as CurrencyCode];
      tok = tokenise(source, aliasMap);
      tokenCache.set(aliasKey, tok);
    }
    if (tok.overlap) continue;
    const parses = matchTemplate(template, tok);
    if (parses.length !== 1) continue;
    if (template.blocked) { blockedHit = true; continue; }
    hits.push({ template, parse: parses[0] });
  }
  if (blockedHit || hits.length === 0) return none;
  const signature = (hit: { template: LearnedTemplate; parse: Parse }) =>
    JSON.stringify([hit.parse.amount, hit.template.currency, hit.template.direction, hit.parse.date ?? null, hit.parse.merchant ?? null]);
  if (new Set(hits.map(signature)).size !== 1) return none;
  const best = [...hits].sort((a, b) => b.template.confirmations - a.template.confirmations || a.template.id.localeCompare(b.template.id))[0];
  const { template, parse } = best;
  const amountMinor = Number(parse.amount);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return none;
  const today = localIsoDay(options.now);
  if (parse.date && today && parse.date > today) return none;

  const fields: LearnedFields = { amountMinor, currency: template.currency, exponent: template.exponent, direction: template.direction };
  if (parse.merchant) {
    const text = source.slice(parse.merchant[0], parse.merchant[1]).trim();
    if (text) fields.merchant = text;
  }
  if (parse.date) fields.date = parse.date;
  if (parse.card) fields.cardLast4 = parse.card;
  const threshold = Math.max(1, Math.floor(options.postThreshold ?? 2));
  const confirmations = template.confirmations;
  if (confirmations < 1) return none;
  return { kind: confirmations >= threshold ? 'post' : 'prefill', fields, templateId: template.id, confirmations };
}

/* ── settings ────────────────────────────────────────────────────────── */

export interface LearnedFormatSettingsItem {
  id: string;
  sender: string | null;
  /** Masked shape, e.g. "Card ••{CARD} charged {AMOUNT} at {MERCHANT} on {DATE}". */
  shape: string;
  direction: LearnedDirection;
  currency: string;
  confirmations: number;
  status: 'learning' | 'automatic' | 'blocked';
  updatedAt: number;
}

const SLOT_LABEL: Record<Exclude<TemplateToken['k'], 'L'>, string> = {
  AMT: '{AMOUNT}', BAL: '{BALANCE}', MER: '{MERCHANT}', DATE: '{DATE}', DATEX: '{DATE}',
  TIME: '{TIME}', CARD: '••{CARD}', NUM: '{NUMBER}', ALNUM: '{REF}',
};

const maskedShape = (tokens: readonly TemplateToken[]): string => {
  let out = '';
  let lastMasked = false;
  for (const token of tokens) {
    let piece: string;
    if (token.k === 'L') {
      if (token.m) { if (lastMasked) continue; piece = '…'; lastMasked = true; }
      else { piece = token.v; lastMasked = false; }
    } else { piece = SLOT_LABEL[token.k]; lastMasked = false; }
    const tight = /^[.,:;!?)\]}%]$/.test(piece) || /[(\[{/#*@-]$/.test(out) || !out;
    out += (tight ? '' : ' ') + piece;
  }
  out = out.replace(/\s+/g, ' ').trim();
  out = out.charAt(0).toLocaleUpperCase() + out.slice(1);
  return out.length > 160 ? `${out.slice(0, 159)}…` : out;
};

export function listLearnedFormatsForSettings(
  store: LearnedFormatStore | null | undefined,
  options: { postThreshold?: number } = {},
): LearnedFormatSettingsItem[] {
  const threshold = Math.max(1, Math.floor(options.postThreshold ?? 2));
  return (store?.templates ?? []).map((row): LearnedFormatSettingsItem => ({
    id: row.id,
    sender: row.sender,
    shape: maskedShape(row.tokens),
    direction: row.direction,
    currency: row.currency,
    confirmations: row.confirmations,
    status: row.blocked ? 'blocked' : row.confirmations >= threshold ? 'automatic' : 'learning',
    updatedAt: row.updatedAt,
  })).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

/* ── backup / restore validation ─────────────────────────────────────── */

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isIso = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Z]{3}$/.test(value) && currencyMinorUnits(value) !== null;
const shortString = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;

const validToken = (value: unknown): TemplateToken | null => {
  if (!isObject(value)) return null;
  switch (value.k) {
    case 'L':
      if (!shortString(value.v, 64) || /\d/.test(value.v)) return null;
      return value.m === 1 ? { k: 'L', v: value.v, m: 1 } : { k: 'L', v: value.v };
    case 'AMT': return { k: 'AMT' };
    case 'MER': return { k: 'MER' };
    case 'BAL': return isIso(value.iso) ? { k: 'BAL', iso: value.iso } : null;
    case 'DATE': case 'DATEX': case 'TIME': case 'CARD': case 'NUM':
      return shortString(value.f, 32) ? { k: value.k, f: value.f } as TemplateToken : null;
    case 'ALNUM':
      return Number.isInteger(value.n) && (value.n as number) > 0 && (value.n as number) <= 64 ? { k: 'ALNUM', n: value.n as number } : null;
    default: return null;
  }
};

const validTemplate = (value: unknown): LearnedTemplate | null => {
  if (!isObject(value) || value.v !== 1) return null;
  if (!Array.isArray(value.tokens) || !value.tokens.length || value.tokens.length > MAX_TOKENS) return null;
  const tokens: TemplateToken[] = [];
  for (const raw of value.tokens) {
    const token = validToken(raw);
    if (!token) return null;
    tokens.push(token);
  }
  const count = (k: TemplateToken['k']) => tokens.filter((token) => token.k === k).length;
  if (count('AMT') !== 1 || count('MER') > 1 || count('DATE') > 1) return null;
  if (value.direction !== 'debit' && value.direction !== 'credit') return null;
  if (!isIso(value.currency) || value.exponent !== currencyMinorUnits(value.currency)) return null;
  const sender = value.sender === null ? null : shortString(value.sender, 64) ? normalizeLearnedSender(value.sender) : undefined;
  if (sender === undefined) return null;
  const key = keyFor(sender, tokens);
  if (value.key !== key || value.id !== templateId(key, tokens)) return null;
  if (!isObject(value.aliases)) return null;
  const aliases: Record<string, string> = {};
  const aliasEntries = Object.entries(value.aliases);
  if (aliasEntries.length > 8) return null;
  for (const [token, code] of aliasEntries) {
    if (!shortString(token, 8) || !isIso(code)) return null;
    aliases[token] = code;
  }
  const dateOrder = value.dateOrder === null ? null
    : value.dateOrder === 'DMY' || value.dateOrder === 'MDY' || value.dateOrder === 'YMD' ? value.dateOrder : undefined;
  if (dateOrder === undefined) return null;
  if (typeof value.advisory !== 'boolean' || typeof value.blocked !== 'boolean') return null;
  if (!Number.isInteger(value.confirmations) || (value.confirmations as number) < 0) return null;
  if (!Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt)) return null;
  return {
    v: 1, id: value.id as string, key, sender,
    direction: value.direction, currency: value.currency, exponent: value.exponent as number,
    aliases, dateOrder, tokens, advisory: value.advisory, blocked: value.blocked,
    confirmations: Math.min(MAX_CONFIRMATIONS, value.confirmations as number),
    createdAt: value.createdAt as number, updatedAt: value.updatedAt as number,
  };
};

/**
 * Validate a restored/backed-up store. Returns null for a malformed container;
 * individually malformed or tampered templates (id not matching their shape)
 * are dropped, duplicates removed and caps clamped.
 */
export function validateLearnedFormatStore(value: unknown): LearnedFormatStore | null {
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.templates)) return null;
  if (value.templates.length > LEARNED_FORMATS_MAX_TEMPLATES * 5) return null;
  const seen = new Set<string>();
  const templates: LearnedTemplate[] = [];
  for (const raw of value.templates) {
    const template = validTemplate(raw);
    if (!template || seen.has(template.id)) continue;
    seen.add(template.id);
    templates.push(template);
  }
  return { version: 1, templates: enforceCaps(templates) };
}
