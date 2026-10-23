import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { hasNonCompletedWording, isNotAutoPostableMoney } from '@/lib/best-effort-autopost';
import { currencyMinorUnits } from '@/lib/currency-metadata';
import {
  isLearnableSender,
  matchLearnedFormat,
  normalizeLearnedSender,
  publicLearnedCurrencyCandidates,
  type LearnedDateOrder,
  type LearnedDirection,
  type LearnedFields,
  type LearnedTemplate,
  type TemplateToken,
} from '@/lib/learned-alert-formats';
import { inspectUniversalBankEvent } from '@/lib/universal-parser';

/**
 * SHARED ALERT SHAPES (pure: no React, no network, no storage).
 *
 * A SHARED SHAPE is the part of a person's learned template that is safe to
 * give to other people who receive alerts from the same bank: the sender
 * code, the direction, the currency and the typed token sequence. Literal
 * anchors are boilerplate words; every variable part (amount, balance,
 * merchant, date, time, card digits, references) is a typed SLOT with no
 * value. No message text, amount or digit run is ever in a shape. A word the
 * learner flags as a possible name refuses the shape unless it is common
 * banking boilerplate. That heuristic cannot catch every name, so the relay
 * also publishes only a shape that several unrelated vaults submitted
 * identically (k-anonymity), and drops unpublished shapes after 30 days.
 *
 * `shapeHash` identifies a shape (sha256 over canonical sorted-key JSON).
 * `validateSharedAlertShape` is the single strict gate, used by the sanitizer,
 * by the relay on submit and by the phone on every downloaded list.
 *
 * `matchSharedAlertShape` reuses `matchLearnedFormat` (whole-message match,
 * AE/SA never overridden, non-completed wording, future dates) by converting a
 * shape to a LearnedTemplate in memory. With no sender (pasted text) only a
 * single unambiguous shape may prefill, never post. A match is only `prefill` by default:
 * it is `post` solely when independent deterministic evidence
 * (inspectUniversalBankEvent) agrees on direction and amount, and the
 * best-effort-autopost guards stay silent. Contradicting direction evidence
 * refuses outright: a shape that disagrees with the message is suspicious.
 */

export interface SharedAlertShape {
  v: 1;
  sender: string;
  direction: LearnedDirection;
  currency: string;
  aliases: Record<string, string>;
  dateOrder: LearnedDateOrder | null;
  tokens: TemplateToken[];
  advisory: boolean;
}

export interface SharedAlertFormat {
  hash: string;
  shape: SharedAlertShape;
}

export type SharedShapeRefusal =
  | 'no-sender'
  | 'phone-like-sender'
  | 'email-sender'
  | 'launch-market'
  | 'blocked'
  | 'no-amount'
  | 'unsafe-literal'
  | 'possible-name'
  | 'too-large'
  | 'invalid-shape';

export type SharedShapeResult =
  | { ok: true; shape: SharedAlertShape; hash: string }
  | { ok: false; reason: SharedShapeRefusal };

export type SharedAlertMatch =
  | { kind: 'none' }
  | { kind: 'prefill' | 'post'; fields: LearnedFields; hash: string };

export interface SharedMatchOptions {
  now?: number;
  routedMarket?: string | null;
  launchRoute?: boolean;
  /** The user's numeric date order for the independent direction evidence. */
  dateOrder?: LearnedDateOrder | null;
}

export const SHARED_SHAPE_MAX_TOKENS = 160;
export const SHARED_SHAPE_MAX_BYTES = 8192;
export const SHARED_FORMATS_MAX_LIST = 2000;
const MAX_LITERAL = 64;
const MAX_ALIASES = 8;
const MAX_SENDER = 32;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isIso = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Z]{3}$/.test(value) && currencyMinorUnits(value) !== null;
const shortString = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;
const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key));

/* ── canonical JSON and hash ─────────────────────────────────────────── */

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

/** sha256 hex of the canonical (sorted-key) JSON of the shape. */
export const sharedAlertShapeHash = (shape: SharedAlertShape): string =>
  bytesToHex(sha256(utf8ToBytes(canonical(shape))));

const canonicalBytes = (shape: SharedAlertShape): number => utf8ToBytes(canonical(shape)).length;

/* ── strict validation ───────────────────────────────────────────────── */

/** A literal is boilerplate only: no digit, address, link or long opaque token. */
const unsafeLiteral = (text: string): boolean =>
  /\d/.test(text) || text.includes('@') || /http|www\./i.test(text) ||
  text.split(/\s+/).some((word) => word.length >= 24);

/**
 * Words the learner flags as possibly a name (m: 1) never leave the phone.
 * Bank SMS often shout their boilerplate in capitals, which the name heuristic
 * also flags, so common banking words stay shareable; anything else flagged
 * refuses the whole shape rather than upload a word that may be a person.
 */
const SHAREABLE_FLAGGED = new Set([
  'account', 'accounts', 'acct', 'alert', 'amount', 'atm', 'available', 'avail', 'avl', 'balance',
  'bank', 'banking', 'card', 'cards', 'cash', 'charge', 'charged', 'cheque', 'clear', 'cleared',
  'credit', 'credited', 'customer', 'debit', 'debited', 'deposit', 'deposited', 'dear', 'limit',
  'merchant', 'mobile', 'online', 'paid', 'payment', 'pos', 'purchase', 'received', 'refund',
  'refunded', 'reversal', 'reversed', 'salary', 'sent', 'spent', 'thank', 'thanks', 'total',
  'transaction', 'transfer', 'transferred', 'upi', 'used', 'wallet', 'withdrawal', 'withdrawn',
  'your', 'from', 'with', 'info', 'details', 'ending', 'debitcard', 'creditcard', 'neft', 'imps', 'rtgs',
  'bal', 'ac', 'acc', 'txn', 'amt', 'avbl', 'ref', 'dr', 'cr', 'vpa', 'ltd', 'sms', 'call', 'block',
  'not', 'you', 'please', 'pls', 'is', 'has', 'been', 'was', 'on', 'at', 'to', 'by', 'for', 'of', 'the',
  'and', 'in', 'a', 'an', 'if', 'or', 'via', 'new', 'now', 'helpline', 'support', 'service',
]);
const flaggedName = (token: TemplateToken): boolean =>
  token.k === 'L' && token.m === 1 &&
  token.v.split(/[^\p{L}]+/u).some((word) => word !== '' && !SHAREABLE_FLAGGED.has(word.toLowerCase()));

const phoneLike = (sender: string): boolean => (sender.match(/\d/g) ?? []).length >= 7;

const SENDER = /^[A-Z0-9][A-Z0-9 ._&-]*$/;

const validSender = (value: unknown): value is string =>
  shortString(value, MAX_SENDER) && value === normalizeLearnedSender(value) && SENDER.test(value) &&
  !value.includes('@') && !phoneLike(value) && isLearnableSender(value);

const validToken = (value: unknown): TemplateToken | null => {
  if (!isObject(value)) return null;
  switch (value.k) {
    case 'L':
      if (!onlyKeys(value, ['k', 'v', 'm']) || !shortString(value.v, MAX_LITERAL) || unsafeLiteral(value.v)) return null;
      if (value.m !== undefined && value.m !== 1) return null;
      return value.m === 1 ? { k: 'L', v: value.v, m: 1 } : { k: 'L', v: value.v };
    case 'AMT': case 'MER':
      return onlyKeys(value, ['k']) ? { k: value.k } : null;
    case 'BAL':
      return onlyKeys(value, ['k', 'iso']) && isIso(value.iso) ? { k: 'BAL', iso: value.iso } : null;
    case 'DATE': case 'DATEX': case 'TIME': case 'CARD': case 'NUM':
      return onlyKeys(value, ['k', 'f']) && shortString(value.f, 32) ? { k: value.k, f: value.f } as TemplateToken : null;
    case 'ALNUM':
      return onlyKeys(value, ['k', 'n']) && Number.isInteger(value.n) && (value.n as number) > 0 && (value.n as number) <= 64
        ? { k: 'ALNUM', n: value.n as number } : null;
    default: return null;
  }
};

/** Re-check every field of an untrusted shape; null on any deviation. */
export function validateSharedAlertShape(value: unknown): SharedAlertShape | null {
  if (!isObject(value) || value.v !== 1) return null;
  if (!onlyKeys(value, ['v', 'sender', 'direction', 'currency', 'aliases', 'dateOrder', 'tokens', 'advisory'])) return null;
  if (!validSender(value.sender)) return null;
  if (value.direction !== 'debit' && value.direction !== 'credit') return null;
  if (!isIso(value.currency)) return null;
  if (typeof value.advisory !== 'boolean') return null;
  const dateOrder = value.dateOrder === null ? null
    : value.dateOrder === 'DMY' || value.dateOrder === 'MDY' || value.dateOrder === 'YMD' ? value.dateOrder : undefined;
  if (dateOrder === undefined) return null;
  if (!isObject(value.aliases)) return null;
  const aliases: Record<string, string> = {};
  const aliasEntries = Object.entries(value.aliases);
  if (aliasEntries.length > MAX_ALIASES) return null;
  for (const [spelling, code] of aliasEntries) {
    // Only spellings the public currency tables already know; an alias taken
    // from a message could carry a name or an identifier.
    if (!shortString(spelling, 8) || !isIso(code) || !publicLearnedCurrencyCandidates(spelling).includes(code)) return null;
    aliases[spelling] = code;
  }
  if (!Array.isArray(value.tokens) || !value.tokens.length || value.tokens.length > SHARED_SHAPE_MAX_TOKENS) return null;
  const tokens: TemplateToken[] = [];
  for (const raw of value.tokens) {
    const token = validToken(raw);
    if (!token) return null;
    tokens.push(token);
  }
  const count = (k: TemplateToken['k']) => tokens.filter((token) => token.k === k).length;
  if (count('AMT') !== 1 || count('MER') > 1 || count('DATE') > 1) return null;
  const shape: SharedAlertShape = {
    v: 1, sender: value.sender, direction: value.direction, currency: value.currency,
    aliases, dateOrder, tokens, advisory: value.advisory,
  };
  return canonicalBytes(shape) > SHARED_SHAPE_MAX_BYTES ? null : shape;
}

/**
 * Validate a downloaded list: each entry is re-validated and re-hashed, and
 * an entry whose claimed hash differs, or that is a duplicate, is dropped.
 * Null for a malformed container.
 */
export function validateSharedAlertFormatList(value: unknown, cap: number = SHARED_FORMATS_MAX_LIST): SharedAlertFormat[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const out: SharedAlertFormat[] = [];
  for (const raw of value) {
    if (out.length >= cap) break;
    if (!isObject(raw) || typeof raw.hash !== 'string') continue;
    const shape = validateSharedAlertShape(raw.shape);
    if (!shape) continue;
    const hash = sharedAlertShapeHash(shape);
    if (hash !== raw.hash || seen.has(hash)) continue;
    seen.add(hash);
    out.push({ hash, shape });
  }
  return out;
}

/* ── sanitizer ───────────────────────────────────────────────────────── */

/** Build the shareable shape from a learned template, or say why it cannot be shared. */
export function toSharedAlertShape(template: LearnedTemplate): SharedShapeResult {
  const refuse = (reason: SharedShapeRefusal): SharedShapeResult => ({ ok: false, reason });
  const sender = normalizeLearnedSender(template.sender);
  if (!sender) return refuse('no-sender');
  if (sender.includes('@')) return refuse('email-sender');
  if (phoneLike(sender)) return refuse('phone-like-sender');
  if (!isLearnableSender(sender)) return refuse('launch-market');
  if (template.blocked) return refuse('blocked');
  if (!template.tokens.some((token) => token.k === 'AMT')) return refuse('no-amount');
  if (template.tokens.some((token) => token.k === 'L' && unsafeLiteral(token.v))) return refuse('unsafe-literal');
  if (template.tokens.some(flaggedName)) return refuse('possible-name');
  const candidate = {
    v: 1, sender, direction: template.direction, currency: template.currency,
    aliases: template.aliases, dateOrder: template.dateOrder, tokens: template.tokens, advisory: template.advisory,
  };
  const size = utf8ToBytes(canonical(candidate)).length;
  if (size > SHARED_SHAPE_MAX_BYTES) return refuse('too-large');
  const shape = validateSharedAlertShape(candidate);
  if (!shape) return refuse('invalid-shape');
  return { ok: true, shape, hash: sharedAlertShapeHash(shape) };
}

/* ── matching ────────────────────────────────────────────────────────── */

const templateForShape = (format: SharedAlertFormat): LearnedTemplate => ({
  v: 1,
  id: `sf_${format.hash}`,
  key: `s:${format.shape.sender}`,
  sender: format.shape.sender,
  direction: format.shape.direction,
  currency: format.shape.currency,
  exponent: currencyMinorUnits(format.shape.currency) ?? 2,
  aliases: format.shape.aliases,
  dateOrder: format.shape.dateOrder,
  tokens: format.shape.tokens,
  advisory: format.shape.advisory,
  // Two stand-in confirmations only let matchLearnedFormat report a post
  // candidate; the shared-post gate below decides whether it is honoured.
  confirmations: 2,
  blocked: false,
  createdAt: 0,
  updatedAt: 0,
});

/** Lists are validated once per array; the store replaces the array on every download. */
const validatedLists = new WeakMap<object, SharedAlertFormat[]>();
const validatedList = (formats: readonly SharedAlertFormat[]): SharedAlertFormat[] => {
  let valid = validatedLists.get(formats);
  if (!valid) {
    valid = validateSharedAlertFormatList(formats as unknown[]) ?? [];
    validatedLists.set(formats, valid);
  }
  return valid;
};

/**
 * Match `source` against downloaded shared shapes. Formats are re-validated
 * here, so a store edited on disk cannot widen what matches.
 */
export function matchSharedAlertShape(
  source: string,
  sender: string | null | undefined,
  formats: readonly SharedAlertFormat[] | null | undefined,
  opts: SharedMatchOptions = {},
): SharedAlertMatch {
  const none: SharedAlertMatch = { kind: 'none' };
  if (!formats?.length || typeof source !== 'string' || !source.trim()) return none;
  const valid = validatedList(formats);
  if (!valid.length) return none;
  const matchOptions = { postThreshold: 2, now: opts.now, routedMarket: opts.routedMarket, launchRoute: opts.launchRoute };
  const normSender = normalizeLearnedSender(sender);
  if (!normSender) {
    // Pasted text carries no sender. Try every shape under its own sender and
    // accept only a single unambiguous layout, and only as a prefill: without
    // the sender nothing ties the message to the bank that taught the shape.
    let found: { fields: LearnedFields; hash: string } | null = null;
    for (const format of valid) {
      const hit = matchLearnedFormat(source, format.shape.sender,
        { version: 1, templates: [templateForShape(format)] }, matchOptions);
      if (hit.kind === 'none') continue;
      if (found) return none;
      found = { fields: hit.fields, hash: format.hash };
    }
    if (!found) return none;
    const event = inspectUniversalBankEvent(source, opts.dateOrder ? { dateOrder: opts.dateOrder } : {});
    if ((event.direction === 'debit' || event.direction === 'credit') && event.direction !== found.fields.direction) return none;
    return { kind: 'prefill', ...found };
  }
  if (!isLearnableSender(sender)) return none;
  const templates = valid.filter((format) => format.shape.sender === normSender).map(templateForShape);
  if (!templates.length) return none;
  const hit = matchLearnedFormat(source, sender, { version: 1, templates }, matchOptions);
  if (hit.kind === 'none') return none;
  const hash = hit.templateId.slice(3);
  const direction = templates.find((row) => row.id === hit.templateId)?.direction ?? hit.fields.direction;

  // Independent evidence: the shared-post gate. Anything but a clean agreement
  // keeps the row in Review; a contradiction is not even pre-filled.
  const event = inspectUniversalBankEvent(source, {
    sender: normSender,
    ...(opts.dateOrder ? { dateOrder: opts.dateOrder } : {}),
  });
  if ((event.direction === 'debit' || event.direction === 'credit') && event.direction !== direction) return none;
  let post = hit.kind === 'post' && event.direction === direction && event.decision === 'review';
  const evidenceAmount = event.amount.value;
  if (post && evidenceAmount) {
    post = evidenceAmount.currency === hit.fields.currency && evidenceAmount.minorUnits === String(hit.fields.amountMinor);
  }
  if (post && (isNotAutoPostableMoney(source) || hasNonCompletedWording(source, opts.routedMarket, normSender))) post = false;
  return { kind: post ? 'post' : 'prefill', fields: hit.fields, hash };
}
