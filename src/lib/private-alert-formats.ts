import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { normalizeAlertText, type SourceSpan } from '@/lib/alert-draft';
import { isOwnerProfileClause, ownerProfilePrefixLength } from '@/lib/alert-source-ownership';
import { dateOrderForCountry } from '@/lib/country';
import { currencyMinorUnits, type CurrencyCode } from '@/lib/currency-metadata';
import {
  inspectLearnedSourceForPrivateMatching, learnFromConfirmation, matchLearnedFormat,
  normalizeLearnedSender, publicLearnedCurrencyCandidates,
  type LearnInput, type LearnedDateOrder, type LearnedFields, type LearnedTemplate,
  type MatchOptions, type TemplateToken,
} from '@/lib/learned-alert-formats';
import { extractUniversalMoney } from '@/lib/universal-money';
import { extractUniversalDates } from '@/lib/universal-dates';
import { inspectUniversalBankEvent } from '@/lib/universal-parser';

/** Private device format metadata. It never contains source text or extracted values. */
export type PrivateAlertToken = Exclude<TemplateToken, { k: 'L' } | { k: 'NUM' } | { k: 'CARD' } | { k: 'ALNUM' }> |
  { k: 'L'; h: string } | { k: 'NUM' | 'CARD'; f: string; h?: string } | { k: 'ALNUM'; n: number; h?: string };
export interface PrivateAlertFormat {
  v: 1;
  id: string;
  senderDigest: string;
  sampleDigest: string;
  validatedSampleDigest: string | null;
  direction: 'debit' | 'credit';
  currency: string;
  exponent: number;
  /** Strictly allowlisted public spellings, never arbitrary source aliases. */
  aliases: Record<string, string>;
  dateOrder: LearnedDateOrder | null;
  tokens: PrivateAlertToken[];
  advisory: boolean;
  status: 'draft' | 'validated';
  createdAt: number;
  updatedAt: number;
  /** Authenticates every preceding field, including confirmation status. */
  sealDigest: string;
}
export interface PrivateAlertFormatStore { version: 1; templates: PrivateAlertFormat[] }
export interface PrivateAlertMatchOptions extends MatchOptions {
  country?: string | null;
  dateOrder?: LearnedDateOrder | null;
}
export type PrivateAlertFormatMatch = { kind: 'none' } | { kind: 'prefill'; fields: LearnedFields; templateId: string };
export type PrivateAlertLearnResult = { ok: true; template: PrivateAlertFormat } | { ok: false; reason: string };
export type PrivateAlertValidationResult = { ok: true; template: PrivateAlertFormat; fields: LearnedFields } | { ok: false; reason: string };
export const PRIVATE_ALERT_FORMAT_MAX_TEMPLATES = 50;
const MAX_TOKENS = 160;
const DIGEST = /^[a-f0-9]{64}$/;
const MAX_EPOCH = 8_640_000_000_000_000;
const TEMPLATE_KEYS = ['v', 'id', 'senderDigest', 'sampleDigest', 'validatedSampleDigest', 'direction', 'currency', 'exponent', 'aliases', 'dateOrder', 'tokens', 'advisory', 'status', 'createdAt', 'updatedAt', 'sealDigest'];
const none = (): PrivateAlertFormatMatch => ({ kind: 'none' });
const refuse = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
const validKey = (key: unknown): key is Uint8Array => key instanceof Uint8Array && key.byteLength === 32;
const digest = (key: Uint8Array, domain: string, value: string): string =>
  bytesToHex(hmac(sha256, key, utf8ToBytes(`wafra-private-alert-v1\0${domain}\0${value}`)));
const foldedBody = (source: string): string => normalizeAlertText(source).trim().toLowerCase().replace(/\s+/gu, ' ');
const sourceDigest = (key: Uint8Array, source: string): string => digest(key, 'sample', foldedBody(source));
const epoch = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_EPOCH;
const iso = (value: unknown): value is string => typeof value === 'string' && /^[A-Z]{3}$/.test(value) && currencyMinorUnits(value) !== null;
// The legacy normalizer caps at64; never let a longer source identifier
// silently alias another sender through that truncation.
function privateSender(sender: string | null | undefined): string | null | undefined {
  if (sender == null) return null;
  if (typeof sender !== 'string' || sender.length > 128) return undefined;
  let normalized = sender.normalize('NFKC').trim().toUpperCase().replace(/\s+/gu, ' ');
  const dlt = normalized.match(/^[A-Z]{2}-([A-Z0-9]{4,})(?:-[A-Z])?$/u);
  if (dlt) normalized = dlt[1];
  return normalized.length > 64 ? undefined : normalizeLearnedSender(normalized);
}

/** Descriptor validation avoids evaluating untrusted getters while restoring. */
function ownRecord(value: unknown, allowed?: readonly string[], required: readonly string[] = []): Record<string, unknown> | null {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > 32 || keys.some((key) => typeof key !== 'string' || (allowed && !allowed.includes(key)))) return null;
    if (required.some((key) => !Object.hasOwn(descriptors, key))) return null;
    const out: Record<string, unknown> = {};
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
      Object.defineProperty(out, key, { value: descriptor.value, enumerable: true });
    }
    return out;
  } catch { return null; }
}

function ownArray(value: unknown, max: number): unknown[] | null {
  try {
    if (!Array.isArray(value) || value.length > max || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== value.length + 1) return null;
    const out: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      const descriptor = descriptors[String(i)];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return null;
      out.push(descriptor.value);
    }
    return out;
  } catch { return null; }
}

function readAliases(value: unknown): Record<string, string> | null {
  const record = ownRecord(value);
  if (!record || Object.keys(record).length > 8) return null;
  const aliases: Record<string, string> = {};
  for (const [spelling, currency] of Object.entries(record)) {
    if (!spelling || spelling.length > 8 || !iso(currency) || !publicLearnedCurrencyCandidates(spelling).includes(currency)) return null;
    Object.defineProperty(aliases, spelling, { value: currency, enumerable: true, writable: true, configurable: true });
  }
  return aliases;
}

function readToken(value: unknown): PrivateAlertToken | null {
  const row = ownRecord(value);
  if (!row) return null;
  const exact = (keys: readonly string[]): boolean => Object.keys(row).length === keys.length && keys.every((k) => Object.hasOwn(row, k));
  if (row.k === 'L') return exact(['k', 'h']) && typeof row.h === 'string' && DIGEST.test(row.h) ? { k: 'L', h: row.h } : null;
  if (row.k === 'AMT' || row.k === 'MER') return exact(['k']) ? { k: row.k } : null;
  if (row.k === 'BAL') return exact(['k', 'iso']) && iso(row.iso) ? { k: 'BAL', iso: row.iso } : null;
  const optionalDigest = row.h === undefined || (typeof row.h === 'string' && DIGEST.test(row.h));
  if (row.k === 'ALNUM') return exact(row.h === undefined ? ['k', 'n'] : ['k', 'n', 'h']) && optionalDigest && Number.isInteger(row.n) && (row.n as number) > 0 && (row.n as number) <= 64 ? { k: 'ALNUM', n: row.n as number, ...(row.h === undefined ? {} : { h: row.h as string }) } : null;
  const numeric = row.k === 'NUM' || row.k === 'CARD';
  if (!exact(numeric && row.h !== undefined ? ['k', 'f', 'h'] : ['k', 'f']) || !optionalDigest || typeof row.f !== 'string' || row.f.length > 32) return null;
  if (row.k === 'DATE' || row.k === 'DATEX') return /^(?:n[9Yy/.-]{3,20}|w[DM9Yy\s.,-]{3,28})$/u.test(row.f) ? { k: row.k, f: row.f } : null;
  if (row.k === 'TIME') return /^[9:A.]{3,24}$/u.test(row.f) ? { k: 'TIME', f: row.f } : null;
  if (row.k === 'CARD') return /^[x*•]*#{2,6}$/u.test(row.f) ? { k: 'CARD', f: row.f, ...(row.h === undefined ? {} : { h: row.h as string }) } : null;
  if (row.k === 'NUM') return /^[x9.,/:\-'#*•]{1,32}$/u.test(row.f) ? { k: 'NUM', f: row.f, ...(row.h === undefined ? {} : { h: row.h as string }) } : null;
  return null;
}

function readTemplate(value: unknown): PrivateAlertFormat | null {
  const row = ownRecord(value, TEMPLATE_KEYS, TEMPLATE_KEYS);
  if (!row || row.v !== 1 || typeof row.id !== 'string' || !/^pf_[a-f0-9]{64}$/u.test(row.id)) return null;
  if ([row.senderDigest, row.sampleDigest, row.sealDigest].some((value) => typeof value !== 'string' || !DIGEST.test(value))) return null;
  if (row.direction !== 'debit' && row.direction !== 'credit') return null;
  if (!iso(row.currency) || row.exponent !== currencyMinorUnits(row.currency)) return null;
  if (row.dateOrder !== null && row.dateOrder !== 'DMY' && row.dateOrder !== 'MDY' && row.dateOrder !== 'YMD') return null;
  if (typeof row.advisory !== 'boolean' || (row.status !== 'draft' && row.status !== 'validated')) return null;
  if (!epoch(row.createdAt) || !epoch(row.updatedAt) || row.updatedAt < row.createdAt) return null;
  if (row.status === 'draft' ? row.validatedSampleDigest !== null :
    typeof row.validatedSampleDigest !== 'string' || !DIGEST.test(row.validatedSampleDigest) || row.validatedSampleDigest === row.sampleDigest) return null;
  const aliases = readAliases(row.aliases);
  const rawTokens = ownArray(row.tokens, MAX_TOKENS);
  if (!aliases || !rawTokens?.length) return null;
  const tokens: PrivateAlertToken[] = [];
  for (const raw of rawTokens) { const token = readToken(raw); if (!token) return null; tokens.push(token); }
  const count = (kind: PrivateAlertToken['k']): number => tokens.filter((token) => token.k === kind).length;
  if (count('AMT') !== 1 || count('MER') > 1 || count('DATE') > 1 || count('L') < 2) return null;
  return { v: 1, id: row.id, senderDigest: row.senderDigest as string, sampleDigest: row.sampleDigest as string,
    validatedSampleDigest: row.validatedSampleDigest as string | null, direction: row.direction,
    currency: row.currency, exponent: row.exponent as number, aliases, dateOrder: row.dateOrder as LearnedDateOrder | null,
    tokens, advisory: row.advisory, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt,
    sealDigest: row.sealDigest as string };
}

const capsulePayload = (template: PrivateAlertFormat): string => JSON.stringify([
  template.v, template.id, template.senderDigest, template.sampleDigest, template.validatedSampleDigest,
  template.direction, template.currency, template.exponent, Object.entries(template.aliases).sort(),
  template.dateOrder, template.tokens, template.advisory, template.status, template.createdAt, template.updatedAt,
]);
const shapePayload = (template: PrivateAlertFormat): string => JSON.stringify([
  template.senderDigest, template.direction, template.currency, template.exponent,
  Object.entries(template.aliases).sort(), template.dateOrder, template.tokens, template.advisory,
]);
function signed(template: PrivateAlertFormat, key: Uint8Array): PrivateAlertFormat {
  return { ...template, sealDigest: digest(key, 'seal', capsulePayload(template)) };
}

export function authenticatePrivateAlertFormat(value: unknown, key: Uint8Array): boolean {
  try {
    if (!validKey(key)) return false;
    const template = readTemplate(value);
    return !!template && template.id === `pf_${digest(key, 'shape', shapePayload(template))}` &&
      template.sealDigest === digest(key, 'seal', capsulePayload(template));
  } catch { return false; }
}

export const emptyPrivateAlertFormatStore = (): PrivateAlertFormatStore => ({ version: 1, templates: [] });
/** Schema filtering only; callers must authenticate templates with the device key before use. */
export function normalizePrivateAlertFormatStore(value: unknown): PrivateAlertFormatStore {
  const row = ownRecord(value, ['version', 'templates'], ['version', 'templates']);
  const entries = row?.version === 1 ? ownArray(row.templates, PRIVATE_ALERT_FORMAT_MAX_TEMPLATES * 5) : null;
  if (!entries) return emptyPrivateAlertFormatStore();
  const seen = new Set<string>();
  const templates: PrivateAlertFormat[] = [];
  for (const entry of entries) {
    const template = readTemplate(entry);
    if (!template || seen.has(template.id)) continue;
    seen.add(template.id); templates.push(template);
  }
  return { version: 1, templates: templates.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)).slice(0, PRIVATE_ALERT_FORMAT_MAX_TEMPLATES) };
}
export function isValidPrivateAlertFormatStore(value: unknown): value is PrivateAlertFormatStore {
  const row = ownRecord(value, ['version', 'templates'], ['version', 'templates']);
  const entries = row?.version === 1 ? ownArray(row.templates, PRIVATE_ALERT_FORMAT_MAX_TEMPLATES) : null;
  if (!entries) return false;
  const seen = new Set<string>();
  for (const entry of entries) { const template = readTemplate(entry); if (!template || seen.has(template.id)) return false; seen.add(template.id); }
  return true;
}
export function removePrivateAlertFormat(store: PrivateAlertFormatStore, id: string): PrivateAlertFormatStore {
  const safe = normalizePrivateAlertFormatStore(store);
  return { version: 1, templates: safe.templates.filter((template) => template.id !== id) };
}

function localDay(now: number): string {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function sourceSnapshot(source: string, template: Pick<PrivateAlertFormat, 'currency' | 'aliases' | 'dateOrder'>, now: number) {
  const snapshot = inspectLearnedSourceForPrivateMatching(source, template.currency, template.aliases, template.dateOrder);
  return snapshot && !snapshot.dates.some((date) => date === null || date > localDay(now)) ? snapshot : null;
}

function readOptions(value: unknown): PrivateAlertMatchOptions | null {
  const row = ownRecord(value, ['now', 'postThreshold', 'routedMarket', 'launchRoute', 'country', 'dateOrder']);
  if (!row || !epoch(row.now)) return null;
  for (const field of ['routedMarket', 'country']) if (row[field] != null && (typeof row[field] !== 'string' || !/^[A-Za-z]{2}$/u.test(row[field]))) return null;
  if (row.launchRoute !== undefined && typeof row.launchRoute !== 'boolean') return null;
  if (row.dateOrder != null && !['DMY', 'MDY', 'YMD'].includes(row.dateOrder as string)) return null;
  return { now: row.now, country: row.country as string | undefined, dateOrder: row.dateOrder as LearnedDateOrder | undefined,
    routedMarket: row.routedMarket as string | undefined, launchRoute: row.launchRoute as boolean | undefined };
}

function matchOne(source: string, sender: string | null | undefined, template: PrivateAlertFormat, key: Uint8Array, options: PrivateAlertMatchOptions): LearnedFields | null {
  if (!authenticatePrivateAlertFormat(template, key)) return null;
  const normalizedSender = privateSender(sender);
  if (normalizedSender === undefined) return null;
  if (digest(key, 'sender', normalizedSender ?? '<senderless>') !== template.senderDigest) return null;
  const requestedOrder = options.dateOrder ?? dateOrderForCountry(options.country ?? null);
  if (template.dateOrder && requestedOrder && template.dateOrder !== requestedOrder) return null;
  const snapshot = sourceSnapshot(source, template, options.now!);
  if (!snapshot) return null;
  const literals = new Map<string, string>();
  for (const literal of snapshot.literals) {
    const h = digest(key, 'literal', literal);
    if (literals.has(h) && literals.get(h) !== literal) return null;
    literals.set(h, literal);
  }
  const tokens: TemplateToken[] = [];
  for (const token of template.tokens) {
    if (token.k === 'L') { const literal = literals.get(token.h); if (literal === undefined) return null; tokens.push({ k: 'L', v: literal }); }
    else if (token.k === 'NUM' || token.k === 'CARD') tokens.push({ k: token.k, f: token.f });
    else if (token.k === 'ALNUM') tokens.push({ k: 'ALNUM', n: token.n });
    else tokens.push({ ...token });
  }
  // Plaintext anchors are reconstructed only from this new source, used by
  // the existing strict whole-message matcher, and never enter a stored object.
  const ephemeral: LearnedTemplate = { v: 1, id: template.id, key: 'ephemeral-private-format', sender: normalizedSender,
    direction: template.direction, currency: template.currency, exponent: template.exponent, aliases: template.aliases,
    dateOrder: template.dateOrder, tokens, advisory: template.advisory, confirmations: 1, blocked: false,
    createdAt: template.createdAt, updatedAt: template.updatedAt };
  const hit = matchLearnedFormat(source, sender, { version: 1, templates: [ephemeral] }, { ...options, postThreshold: 1001 }, (index, literal) => {
    const token = template.tokens[index];
    return (token.k !== 'NUM' && token.k !== 'CARD' && token.k !== 'ALNUM') || token.h === undefined || token.h === digest(key, 'fixed-number', literal.toLowerCase());
  });
  if (hit.kind === 'none') return null;
  if (hit.fields.merchant && !source.includes(hit.fields.merchant)) return null;
  const confirmation: LearnInput = { source, sender, now: options.now!, confirmed: hit.fields,
    context: { country: options.country, dateOrder: template.dateOrder } };
  if (!principalGrounded(confirmation) || !confirmedSourceFieldsGrounded(confirmation)) return null;
  return { ...hit.fields };
}

export function matchPrivateAlertFormat(source: string, sender: string | null | undefined, store: PrivateAlertFormatStore, key: Uint8Array, options: PrivateAlertMatchOptions = {}, includeDraftId?: string): PrivateAlertFormatMatch {
  try {
    if (!validKey(key) || typeof source !== 'string' || !source.trim() || source.length > 1000 || (sender != null && (typeof sender !== 'string' || sender.length > 128))) return none();
    const safeOptions = readOptions(options);
    if (!safeOptions) return none();
    const hits: { templateId: string; fields: LearnedFields }[] = [];
    for (const template of normalizePrivateAlertFormatStore(store).templates) {
      if (template.status !== 'validated' && template.id !== includeDraftId) continue;
      const fields = matchOne(source, sender, template, key, safeOptions);
      if (fields) hits.push({ templateId: template.id, fields });
    }
    // Multiple independently taught layouts are not an authority to choose.
    return hits.length === 1 ? { kind: 'prefill', ...hits[0] } : none();
  } catch { return none(); }
}

/** Sanitize the human confirmation before invoking the legacy pure inducer. */
function readLearnInput(value: unknown): LearnInput | null {
  const row = ownRecord(value, ['source', 'sender', 'confirmed', 'context', 'now'], ['source', 'confirmed', 'now']);
  if (!row || typeof row.source !== 'string' || !row.source.trim() || row.source.length > 1000 || !epoch(row.now)) return null;
  if (privateSender(row.sender as string | null | undefined) === undefined) return null;
  const confirmed = ownRecord(row.confirmed, ['amountMinor', 'currency', 'exponent', 'direction', 'merchant', 'date'], ['amountMinor', 'currency', 'exponent', 'direction']);
  const context = row.context === undefined ? {} : ownRecord(row.context, ['country', 'dateOrder', 'currencyAliases', 'routedMarket', 'launchRoute']);
  if (!confirmed || !context || !iso(confirmed.currency) || confirmed.exponent !== currencyMinorUnits(confirmed.currency) || !['debit', 'credit'].includes(confirmed.direction as string)) return null;
  if (!['string', 'number'].includes(typeof confirmed.amountMinor) || !/^[1-9]\d{0,15}$/u.test(String(confirmed.amountMinor)) || !Number.isSafeInteger(Number(confirmed.amountMinor))) return null;
  if (confirmed.merchant != null && (typeof confirmed.merchant !== 'string' || confirmed.merchant.length > 96)) return null;
  if (confirmed.date != null && (typeof confirmed.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(confirmed.date))) return null;
  for (const field of ['routedMarket', 'country']) if (context[field] != null && (typeof context[field] !== 'string' || !/^[A-Za-z]{2}$/u.test(context[field]))) return null;
  if (context.launchRoute !== undefined && typeof context.launchRoute !== 'boolean') return null;
  if (context.dateOrder != null && !['DMY', 'MDY', 'YMD'].includes(context.dateOrder as string)) return null;
  const currencyAliases: Record<string, CurrencyCode[]> = {};
  if (context.currencyAliases !== undefined) {
    const aliases = ownRecord(context.currencyAliases);
    if (!aliases || Object.keys(aliases).length > 8) return null;
    for (const [spelling, rawCodes] of Object.entries(aliases)) {
      const codes = ownArray(rawCodes, 10);
      const publicCodes = publicLearnedCurrencyCandidates(spelling);
      if (!codes?.length || spelling.length > 8 || publicCodes.length !== 1 || codes.length !== 1 || codes[0] !== publicCodes[0]) return null;
      currencyAliases[spelling] = [codes[0] as CurrencyCode];
    }
  }
  return { source: row.source, sender: row.sender as string | null | undefined, now: row.now,
    confirmed: confirmed as unknown as LearnInput['confirmed'], context: { ...context, currencyAliases } as LearnInput['context'] };
}

function principalGrounded(input: LearnInput): boolean {
  const merchant = input.confirmed.merchant?.trim();
  const at = merchant ? input.source.indexOf(merchant) : -1;
  const exclusions = merchant && at >= 0 && input.source.indexOf(merchant, at + 1) < 0 ? [{ start: at, end: at + merchant.length }] : [];
  const money = extractUniversalMoney(input.source, { currencyAliases: input.context?.currencyAliases }, exclusions);
  const desired = money.observations.filter((row) => row.field.evidence === 'explicit' && row.field.value?.currency === input.confirmed.currency && row.field.value.exponent === input.confirmed.exponent && row.field.value.minorUnits === String(input.confirmed.amountMinor));
  if (desired.length !== 1 || !['transaction', 'unknown', 'fee'].includes(desired[0].role) || desired[0].field.issues.includes('aggregate-money-field')) return false;
  if (desired[0].role === 'transaction') return money.observations.filter((row) =>
    ['transaction', 'unknown'].includes(row.role) && !row.field.issues.includes('aggregate-money-field')).length === 1;
  if (money.observations.filter((row) => ['transaction', 'unknown', 'fee'].includes(row.role)).length !== 1) return false;
  if (desired[0].role === 'unknown') return true;
  const event = inspectUniversalBankEvent(input.source, { sender: input.sender ?? undefined, currencyAliases: input.context?.currencyAliases });
  return event.family === 'fee' && event.status === 'posted';
}

const NUMBER_LABEL = /(?:\b(?:cards?(?:\s+(?:ending|number))?|accounts?(?:\s+(?:ending|number))?|acct|ref(?:erence)?(?:\s+(?:number|no|id))?|transaction\s+(?:id|ref)|tel(?:ephone)?|phone)(?:\s+no\.?)?|بطاقة|البطاقة|حساب|الحساب|رقم\s+(?:الحساب|المرجع|العملية)|المرجع)\s*[:#=-]?\s*[*•.xX]*\s*$/iu;

const NON_TRANSACTION_CLAUSE = /^(?:account\s+holder(?:\s+name)?|customer\s+name|card\s*holder(?:\s+name)?|owner\s+name|(?:account|card)\s+(?:opened|created|registered|issued|expires|opening\s+date|creation\s+date|registration\s+date|issuance\s+date|expiry(?:\s+date)?|expiration(?:\s+date)?)|(?:customer|member)\s+since|date\s+of\s+birth|birth\s+date|for\s+(?:help|support|offers?|promotions?|details)|need\s+(?:help|support)|customer\s+(?:support|care|service)|(?:please\s+)?(?:call|contact|visit|log\s*in)|(?:statement|header|due|support)\s+date|اسم\s+(?:صاحب\s+الحساب|مالك\s+الحساب|حامل\s+البطاق[ةه]|العميل)|صاحب\s+الحساب|حامل\s+البطاق[ةه]|تاريخ\s+(?:فتح\s+الحساب|إنشاء\s+الحساب|انشاء\s+الحساب|إصدار\s+البطاق[ةه]|اصدار\s+البطاق[ةه]|انتهاء\s+(?:البطاق[ةه]|الصلاحية)|الميلاد))(?=$|[^\p{L}\p{M}\p{N}])/iu;
const overlaps = (a: SourceSpan, b: SourceSpan): boolean => a.start < b.end && a.end > b.start;

function confirmedSourceFieldsGrounded(input: LearnInput): boolean {
  const normalized = normalizeAlertText(input.source);
  const dateOrder = input.context?.dateOrder ?? dateOrderForCountry(input.context?.country ?? null);
  const base = inspectUniversalBankEvent(input.source, { dateOrder: dateOrder ?? undefined,
    sender: input.sender ?? undefined, currencyAliases: input.context?.currencyAliases });
  if (base.issues.includes('direction-conflict') || ((base.direction === 'debit' || base.direction === 'credit') && base.direction !== input.confirmed.direction)) return false;
  const excluded: SourceSpan[] = [...base.instrument.spans, ...base.dueDate.spans, ...base.statementDate.spans];
  let start = 0;
  for (const separator of [...normalized.matchAll(/[\n;!?。।]|\.(?=\s|$)/gu), null]) {
    const end = separator?.index ?? normalized.length;
    const clause = normalized.slice(start, end);
    if (NON_TRANSACTION_CLAUSE.test(clause.trim()) || isOwnerProfileClause(clause)) {
      excluded.push({ start, end: start + ownerProfilePrefixLength(clause) });
    }
    const heading = clause.match(/^\s*[^:\n]{0,64}\bbank\b[^:\n]{0,32}:/iu);
    if (heading) excluded.push({ start, end: start + heading[0].length });
    start = end + (separator?.[0].length ?? 0);
  }
  for (const reference of normalized.matchAll(/\b(?:ref(?:erence)?(?:\s+(?:id|no\.?|number))?|(?:transaction|txn|customer|mandate)\s+(?:id|no\.?|number)|iban)\s*[:#-]?\s*([A-Z0-9*._-]{1,40})/giu)) {
    excluded.push({ start: reference.index!, end: reference.index! + reference[0].length });
  }
  if (input.confirmed.merchant?.trim()) {
    const merchant = input.confirmed.merchant.trim();
    const at = input.source.indexOf(merchant);
    if (at < 0 || input.source.indexOf(merchant, at + 1) >= 0 || excluded.some((span) => overlaps(span, { start: at, end: at + merchant.length }))) return false;
  }
  if (input.confirmed.date) {
    const masked = normalized.split('');
    for (const span of excluded) for (let i = span.start; i < span.end; i++) masked[i] = ' ';
    const money = extractUniversalMoney(input.source, { currencyAliases: input.context?.currencyAliases });
    const field = extractUniversalDates(masked.join(''), { dateOrder: dateOrder ?? undefined }, money.draft.candidates.map((candidate) => candidate.span)).transactionDate;
    if (field.evidence !== 'explicit' || field.value !== input.confirmed.date || field.spans.length !== 1 || !/\d{4}/u.test(normalized.slice(field.spans[0].start, field.spans[0].end))) return false;
  }
  return true;
}

export function createPrivateAlertFormat(value: LearnInput, key: Uint8Array): PrivateAlertLearnResult {
  try {
    if (!validKey(key)) return refuse('invalid-key');
    const input = readLearnInput(value);
    if (!input) return refuse('invalid-input');
    if (!principalGrounded(input)) return refuse('amount-not-grounded');
    if (!confirmedSourceFieldsGrounded(input)) return refuse('confirmed-field-not-grounded');
    const learned = learnFromConfirmation(input);
    if (learned.ok === false) return learned;
    if (input.confirmed.date && !learned.template.tokens.some((token) => token.k === 'DATE')) return refuse('date-not-grounded');
    const snapshot = sourceSnapshot(input.source, learned.template, input.now);
    if (!snapshot) return refuse('invalid-or-future-source');
    const merchant = input.confirmed.merchant?.trim();
    const merchantStart = merchant ? input.source.indexOf(merchant) : -1;
    const variables = snapshot.variableNumbers.filter((span) => !(merchant && merchantStart >= 0 && span.start >= merchantStart && span.end <= merchantStart + merchant.length));
    let variableIndex = 0;
    const tokens: PrivateAlertToken[] = learned.template.tokens.map((token) => {
      if (token.k === 'L') return { k: 'L', h: digest(key, 'literal', token.v) };
      if (token.k !== 'NUM' && token.k !== 'CARD' && token.k !== 'ALNUM') return { ...token };
      const span = variables[variableIndex++];
      if (!span) throw Error('Unexpected numeric token alignment');
      const prefix = normalizeAlertText(input.source.slice(Math.max(0, span.start - 80), span.start));
      return NUMBER_LABEL.test(prefix) ? { ...token } : { ...token, h: digest(key, 'fixed-number', span.literal.toLowerCase()) };
    });
    if (variableIndex !== variables.length) return refuse('numeric-source-alignment-failed');
    const template: PrivateAlertFormat = { v: 1, id: '', senderDigest: digest(key, 'sender', learned.template.sender ?? '<senderless>'),
      sampleDigest: sourceDigest(key, input.source), validatedSampleDigest: null, direction: learned.template.direction,
      currency: learned.template.currency, exponent: learned.template.exponent, aliases: learned.template.aliases,
      dateOrder: learned.template.dateOrder, tokens, advisory: learned.template.advisory, status: 'draft',
      createdAt: input.now, updatedAt: input.now, sealDigest: '' };
    template.id = `pf_${digest(key, 'shape', shapePayload(template))}`;
    const sealed = signed(template, key);
    if (!readTemplate(sealed) || !matchOne(input.source, input.sender, sealed, key, { now: input.now })) return refuse('source-self-check-failed');
    return { ok: true, template: sealed };
  } catch { return refuse('invalid-input'); }
}

/** Call only after the person confirms the second distinct received sample. */
export function validatePrivateAlertFormat(value: PrivateAlertFormat, source: string, sender: string | null | undefined, key: Uint8Array, options: PrivateAlertMatchOptions): PrivateAlertValidationResult {
  try {
    const template = readTemplate(value);
    const safeOptions = readOptions(options);
    if (!template || !safeOptions || !validKey(key) || !authenticatePrivateAlertFormat(template, key)) return refuse('invalid-template');
    if (typeof source !== 'string' || !source.trim() || source.length > 1000 || (sender != null && (typeof sender !== 'string' || sender.length > 128))) return refuse('invalid-input');
    const nextDigest = sourceDigest(key, source);
    if (nextDigest === template.sampleDigest || nextDigest === template.validatedSampleDigest) return refuse('distinct-source-required');
    if (safeOptions.now! < template.createdAt) return refuse('invalid-observed-time');
    const fields = matchOne(source, sender, template, key, safeOptions);
    if (!fields) return refuse('format-mismatch');
    const validated = signed({ ...template, status: 'validated', validatedSampleDigest: nextDigest, updatedAt: safeOptions.now! }, key);
    return { ok: true, template: validated, fields };
  } catch { return refuse('invalid-input'); }
}
