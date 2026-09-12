import AsyncStorage from '@react-native-async-storage/async-storage';

import { isLogoCacheGenerationCurrent, logoCacheGeneration, mutateLogoCache, registerLogoCacheReset } from '@/lib/logo-cache-lifecycle';
import { verifiedLogoUrl, verifiedMerchantIdentity } from '@/lib/verified-logo-identities';

export interface RemoteMerchantLogo {
  readonly id: string;
  readonly domain: string;
  readonly canonicalName: string;
  readonly logoUrl: string;
  readonly confidence: number;
  readonly source: 'verified';
}

type CacheRecord = { value: RemoteMerchantLogo; expiresAt: number };
const CACHE_PREFIX = 'wafra:merchant-logo:v2:';
const POSITIVE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const memory = new Map<string, CacheRecord>();
const pending = new Map<string, Promise<RemoteMerchantLogo | null>>();

const LOCATION_TAIL = /\s+(?:dubai|dxb|abu dhabi|sharjah|ajman|al ain|riyadh|jeddah|dammam|doha|kuwait|manama|muscat|cairo|amman|beirut|london|paris|new york|uae|u\.a\.e\.?|are|ae|ksa|sau|sa|qa|qat|kw|kwt|bh|bhr|om|omn|eg|egy|jo|jor|lb|lbn|uk|gb|usa|us|دبي|أبوظبي|ابوظبي|أبو ظبي|ابو ظبي|الشارقة|عجمان|الرياض|جدة|الدوحة|الكويت|المنامة|مسقط)(?:\s+#?\d{1,12})?$/iu;
const TERMINAL_TAIL = /\s+(?:store|branch|shop|terminal|kiosk|pos|t\d+|#?\d{3,12})$/iu;
const PAYMENT_PREFIX = /^(?:(?:pos|purchase|card purchase|debit card purchase|credit card purchase|payment|paid to|spent at|transaction at|visa|mastercard|mada)\s*[:*\-]?\s*)+/iu;
const GENERIC_ONLY = /^(?:shop|store|market|restaurant|cafe|coffee|payment|purchase|merchant|online|retail|supermarket|grocery|food|services?|trading|general trading)$/iu;

function normalized(value: string): string {
  return value.normalize('NFKC').toLowerCase()
    .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Convert a display merchant title into the smallest useful brand candidate.
 * This value is used only for local exact identity matching. It must never
 * become a network query or authorize an unreviewed domain.
 */
export function merchantBrandCandidate(title: string): string | null {
  if (typeof title !== 'string' || !title.trim() || title.length > 160) return null;
  if (/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/u.test(title)) return null;

  let value = title.normalize('NFKC').trim()
    .replace(PAYMENT_PREFIX, '')
    .replace(/^at\s+/iu, '')
    .replace(/\b(?:aed|sar|usd|eur|gbp|qar|kwd|bhd|omr)\s*[\d,.]+\b/giu, ' ')
    .replace(/\b(?:card|acct|account|a\/c)\s*(?:x+|\*+)?\d{2,16}\b/giu, ' ')
    .replace(/(?:\*|x){2,}\d{2,8}/giu, ' ')
    .replace(/https?:\/\/\S+/giu, ' ')
    .replace(/\s+/g, ' ').trim();

  for (let i = 0; i < 4; i++) {
    const shorter = value.replace(LOCATION_TAIL, '').replace(TERMINAL_TAIL, '').trim();
    if (shorter === value) break;
    value = shorter;
  }

  if (value.length < 2 || value.length > 80 || GENERIC_ONLY.test(value)) return null;
  const key = normalized(value);
  if (key.length < 2 || /^\d+$/.test(key)) return null;
  return value;
}

function cacheKey(name: string): string {
  return CACHE_PREFIX + encodeURIComponent(normalized(name));
}

function matches(record: CacheRecord | null, expected: RemoteMerchantLogo): boolean {
  const value = record?.value;
  return typeof record?.expiresAt === 'number' && record.expiresAt > Date.now() && !!value &&
    value.id === expected.id && value.domain === expected.domain &&
    value.canonicalName === expected.canonicalName && value.logoUrl === expected.logoUrl &&
    value.source === expected.source && value.confidence === expected.confidence;
}

async function readCached(expected: RemoteMerchantLogo, generation: number): Promise<boolean> {
  const key = cacheKey(expected.canonicalName);
  const hot = memory.get(key);
  if (hot && matches(hot, expected)) return true;
  if (hot) memory.delete(key);
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!isLogoCacheGenerationCurrent(generation) || !raw) return false;
    const record = JSON.parse(raw) as CacheRecord;
    if (!matches(record, expected)) {
      await mutateLogoCache(generation, () => AsyncStorage.removeItem(key)).catch(() => undefined);
      return false;
    }
    // Publish only the locally constructed identity, never an object from storage.
    memory.set(key, { value: expected, expiresAt: record.expiresAt });
    return true;
  } catch {
    return false;
  }
}

async function writeCached(value: RemoteMerchantLogo, generation: number): Promise<void> {
  const record: CacheRecord = { value, expiresAt: Date.now() + POSITIVE_TTL_MS };
  try {
    await mutateLogoCache(generation, async () => {
      memory.set(cacheKey(value.canonicalName), record);
      await AsyncStorage.setItem(cacheKey(value.canonicalName), JSON.stringify(record));
    });
  } catch {
    // Optional artwork must not block the ledger when storage is unavailable.
  }
}

/** Resolve reviewed identities locally. Unknown transaction names never leave the device. */
export async function resolveRemoteMerchantLogo(title: string): Promise<RemoteMerchantLogo | null> {
  const generation = logoCacheGeneration();
  if (generation === null) return null;
  const candidate = merchantBrandCandidate(title);
  const identity = candidate ? verifiedMerchantIdentity(candidate) : null;
  if (!identity) return null; // Ignore legacy unknown-name mappings entirely.
  const logoUrl = verifiedLogoUrl(identity.domain);
  if (!logoUrl) return null;
  const expected: RemoteMerchantLogo = Object.freeze({
    id: `brandfetch:${identity.domain}`, ...identity, logoUrl, confidence: 1, source: 'verified',
  });
  const key = cacheKey(expected.canonicalName);
  const active = pending.get(key);
  if (active) return active;
  const request = (async () => {
    const cached = await readCached(expected, generation);
    if (!isLogoCacheGenerationCurrent(generation)) return null;
    if (!cached) await writeCached(expected, generation);
    return isLogoCacheGenerationCurrent(generation) ? expected : null;
  })().finally(() => {
    if (pending.get(key) === request) pending.delete(key);
  });
  pending.set(key, request);
  return request;
}

export function clearMerchantLogoMemoryCache(): void {
  memory.clear();
  pending.clear();
}

registerLogoCacheReset(clearMerchantLogoMemoryCache);
