import AsyncStorage from '@react-native-async-storage/async-storage';

import { isLogoCacheGenerationCurrent, logoCacheGeneration, mutateLogoCache, registerLogoCacheReset } from '@/lib/logo-cache-lifecycle';
import { brandfetchSearchUrl, verifiedLogoUrl, verifiedMerchantIdentity } from '@/lib/verified-logo-identities';

export interface RemoteMerchantLogo {
  readonly id: string;
  readonly domain: string;
  readonly canonicalName: string;
  readonly logoUrl: string;
  readonly confidence: number;
  readonly source: 'verified' | 'search';
}

type CacheRecord = { query: string; value: RemoteMerchantLogo | null; expiresAt: number };
type BrandfetchSearchResult = {
  icon?: unknown;
  name?: unknown;
  domain?: unknown;
  claimed?: unknown;
  brandId?: unknown;
};
// v4 invalidates negative results produced by the old exact/core-only matcher.
// Descriptors such as "Cloudflare San Francisco" used to be cached as misses
// even when Brandfetch returned Cloudflare as the first claimed brand.
const CACHE_PREFIX = 'wafra:merchant-logo:v4:';
const POSITIVE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;
const SEARCH_TIMEOUT_MS = 4_000;
const MAX_CONCURRENT_SEARCHES = 3;
// Scrolling a long transaction history can surface hundreds of distinct
// merchant strings in one session. Persistent cache entries belong on disk;
// keeping every one of them alive in JS indefinitely turns a presentation
// feature into process-lifetime memory growth.
const MAX_MEMORY_CACHE_ENTRIES = 128;
// A virtualized list can move much faster than a 4s network timeout. Bound the
// number of unresolved logo jobs as well as the number actively fetching, so
// fast scrolling cannot build an arbitrarily large queue of stale artwork work.
const MAX_PENDING_RESOLUTIONS = 24;
const memory = new Map<string, CacheRecord>();
const pending = new Map<string, Promise<RemoteMerchantLogo | null>>();
let activeSearches = 0;
const searchWaiters: (() => void)[] = [];
let peakMemoryEntries = 0;
let peakPendingEntries = 0;
let peakQueuedSearches = 0;
let memoryEvictions = 0;
let saturatedResolutionDrops = 0;

function remember(key: string, record: CacheRecord): void {
  // Map insertion order gives us a tiny allocation-free LRU. Touching a hit
  // moves it to the end; adding a new value evicts the oldest metadata only.
  // The durable AsyncStorage copy remains available if that merchant reappears.
  memory.delete(key);
  memory.set(key, record);
  while (memory.size > MAX_MEMORY_CACHE_ENTRIES) {
    const oldest = memory.keys().next().value as string | undefined;
    if (!oldest) break;
    memory.delete(oldest);
    memoryEvictions += 1;
  }
  peakMemoryEntries = Math.max(peakMemoryEntries, memory.size);
}

function notePending(): void {
  peakPendingEntries = Math.max(peakPendingEntries, pending.size);
  peakQueuedSearches = Math.max(peakQueuedSearches, searchWaiters.length);
}

const LOCATION_TAIL = /\s+(?:dubai|dxb|abu dhabi|sharjah|ajman|al ain|riyadh|jeddah|dammam|doha|kuwait|manama|muscat|cairo|amman|beirut|london|paris|new york|uae|u\.a\.e\.?|are|ae|ksa|sau|sa|qa|qat|kw|kwt|bh|bhr|om|omn|eg|egy|jo|jor|lb|lbn|uk|gb|usa|us|دبي|أبوظبي|ابوظبي|أبو ظبي|ابو ظبي|الشارقة|عجمان|الرياض|جدة|الدوحة|الكويت|المنامة|مسقط)(?:\s+#?\d{1,12})?$/iu;
const TERMINAL_TAIL = /\s+(?:store|branch|shop|terminal|kiosk|pos|t\d+|#?\d{3,12})$/iu;
const PAYMENT_PREFIX = /^(?:(?:pos|purchase|card purchase|debit card purchase|credit card purchase|payment|paid to|spent at|transaction at|visa|mastercard|mada)\s*[:*\-]?\s*)+/iu;
const PROCESSOR_PREFIX = /^(?:paypal|stripe|square|sq|sumup|adyen|opn|2c2p|tst|sp)\s*[*:/-]\s*/iu;
const GENERIC_ONLY = /^(?:shop|store|market|restaurant|cafe|coffee|payment|purchase|merchant|online|retail|supermarket|grocery|food|services?|trading|general trading)$/iu;
const NON_MERCHANT_ONLY = /^(?:(?:incoming|outgoing|bank|own|internal)?\s*(?:money\s+)?transfer|(?:atm|cash)\s+withdrawal|(?:credit\s+)?card\s+payment|payment\s+(?:received|sent)|salary|cash\s+deposit|refund|reversal)$/iu;
const SAFE_BRAND_DESCRIPTOR_WORDS = new Set([
  'app', 'business', 'co', 'company', 'inc', 'llc', 'ltd', 'online', 'pay', 'payment', 'payments',
  'sales', 'send', 'service', 'services', 'topup',
]);
const NON_LOCATION_SUFFIX_WORDS = new Set([
  'bakery', 'barber', 'barbershop', 'beauty', 'cafe', 'cafeteria', 'charity', 'clinic', 'club',
  'construction', 'contracting', 'cooperative', 'credit', 'design', 'donation', 'employee', 'exchange',
  'foundation', 'garage', 'grocery', 'gym', 'hospital', 'hotel', 'insurance', 'laundry', 'market',
  'medical', 'pharmacy', 'plumbing', 'rail', 'restaurant', 'salon', 'school', 'secret', 'services',
  'shop', 'society', 'spa', 'store', 'supermarket', 'tailoring', 'trading', 'transfer', 'university',
  'unknown',
]);

function normalized(value: string): string {
  return value.normalize('NFKD').toLowerCase()
    .replace(/\p{M}+/gu, '')
    .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Convert a display merchant title into the smallest useful brand candidate.
 * Only this cleaned value may become a Brandfetch name query. Raw bank text,
 * amounts and account/card tails are deliberately stripped before this point.
 */
export function merchantBrandCandidate(title: string): string | null {
  if (typeof title !== 'string' || !title.trim() || title.length > 160) return null;
  if (/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/u.test(title)) return null;

  let value = title.normalize('NFKC').trim()
    .replace(PAYMENT_PREFIX, '')
    .replace(PROCESSOR_PREFIX, '')
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
  if (key.length < 2 || /^\d+$/.test(key) || NON_MERCHANT_ONLY.test(key)) return null;
  return value;
}

function cacheKey(name: string): string {
  return CACHE_PREFIX + encodeURIComponent(normalized(name));
}

function brandCore(value: string): string {
  return normalized(value).split(' ').filter(token => token && !SAFE_BRAND_DESCRIPTOR_WORDS.has(token)).join(' ');
}

/**
 * Card descriptors often append the acquiring city to a real brand name.
 * Brandfetch already ranks the intended brand first in cases such as
 * "Cloudflare San Francisco", "Clemta Lewes" and "TorBox Sheridan". We can
 * safely use that signal without maintaining a worldwide city list, provided
 * the result is claimed, first-ranked, and the suffix does not look like a
 * different type of business ("Apple Cafe", "Tamara Restaurant", etc.).
 */
function likelyLocationSuffix(query: string, brandName: string): boolean {
  const queryTokens = normalized(query).split(' ').filter(Boolean);
  const brandTokens = normalized(brandName).split(' ').filter(Boolean);
  if (brandTokens.length === 0 || queryTokens.length <= brandTokens.length) return false;
  if (!brandTokens.every((token, index) => queryTokens[index] === token)) return false;
  const suffix = queryTokens.slice(brandTokens.length);
  if (suffix.length === 0 || suffix.length > 3) return false;
  return suffix.every(token =>
    /^[\p{L}][\p{L}'’-]*$/u.test(token) && !NON_LOCATION_SUFFIX_WORDS.has(token));
}

function safeCachedValue(value: unknown): RemoteMerchantLogo | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<RemoteMerchantLogo>;
  if (candidate.source !== 'search' || typeof candidate.domain !== 'string' ||
      typeof candidate.canonicalName !== 'string' || candidate.canonicalName.length > 160 ||
      /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/u.test(candidate.canonicalName) ||
      typeof candidate.confidence !== 'number') return undefined;
  const logoUrl = verifiedLogoUrl(candidate.domain);
  if (!logoUrl || candidate.confidence < 0 || candidate.confidence > 1) return undefined;
  return Object.freeze({
    id: `brandfetch:${candidate.domain}`,
    domain: candidate.domain,
    canonicalName: candidate.canonicalName,
    logoUrl,
    confidence: candidate.confidence,
    source: 'search' as const,
  });
}

async function readCached(candidate: string, generation: number): Promise<RemoteMerchantLogo | null | undefined> {
  const query = normalized(candidate);
  const key = cacheKey(candidate);
  const hot = memory.get(key);
  if (hot && hot.expiresAt > Date.now() && hot.query === query) {
    remember(key, hot);
    return safeCachedValue(hot.value);
  }
  if (hot) memory.delete(key);
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!isLogoCacheGenerationCurrent(generation) || !raw) return undefined;
    const record = JSON.parse(raw) as CacheRecord;
    const safe = record && record.query === query && record.expiresAt > Date.now()
      ? safeCachedValue(record.value) : undefined;
    if (safe === undefined) {
      await mutateLogoCache(generation, () => AsyncStorage.removeItem(key)).catch(() => undefined);
      return undefined;
    }
    // Publish a reconstructed CDN URL, never an arbitrary URL from storage.
    remember(key, { query, value: safe, expiresAt: record.expiresAt });
    return safe;
  } catch {
    return undefined;
  }
}

async function writeCached(candidate: string, value: RemoteMerchantLogo | null, generation: number): Promise<void> {
  const record: CacheRecord = {
    query: normalized(candidate),
    value,
    expiresAt: Date.now() + (value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
  };
  try {
    await mutateLogoCache(generation, async () => {
      remember(cacheKey(candidate), record);
      await AsyncStorage.setItem(cacheKey(candidate), JSON.stringify(record));
    });
  } catch {
    // Optional artwork must not block the ledger when storage is unavailable.
  }
}

function scoredSearchResult(
  candidate: string,
  result: BrandfetchSearchResult,
  rank: number,
): { value: RemoteMerchantLogo; score: number } | null {
  if (typeof result.name !== 'string' || typeof result.domain !== 'string') return null;
  const logoUrl = verifiedLogoUrl(result.domain);
  if (!logoUrl) return null;
  const query = normalized(candidate);
  const name = normalized(result.name);
  if (!query || !name) return null;
  const exact = query === name;
  const compact = query.replace(/\s/g, '') === name.replace(/\s/g, '');
  const core = brandCore(candidate);
  const resultCore = brandCore(result.name);
  const claimed = result.claimed === true;
  const locationSuffix = claimed && rank === 0 && likelyLocationSuffix(candidate, result.name);
  let score = exact ? 100
    : compact && claimed ? 94
      : core && core === resultCore && claimed ? 90
        : locationSuffix ? 88
          : 0;
  if (!score) return null;
  if (claimed) score += 4;
  const confidence = Math.min(0.99, score / 105);
  return {
    score,
    value: Object.freeze({
      id: `brandfetch:${result.domain}`,
      domain: result.domain,
      canonicalName: result.name.trim(),
      logoUrl,
      confidence,
      source: 'search',
    }),
  };
}

async function withSearchSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeSearches >= MAX_CONCURRENT_SEARCHES) {
    await new Promise<void>(resolve => {
      searchWaiters.push(resolve);
      notePending();
    });
  }
  activeSearches += 1;
  try {
    return await task();
  } finally {
    activeSearches -= 1;
    searchWaiters.shift()?.();
  }
}

/** null = a successful search with no confident match; undefined = transient lookup failure. */
async function searchBrandfetch(candidate: string, generation: number): Promise<RemoteMerchantLogo | null | undefined> {
  const url = brandfetchSearchUrl(candidate);
  if (!url || !isLogoCacheGenerationCurrent(generation)) return undefined;
  return withSearchSlot(async () => {
    if (!isLogoCacheGenerationCurrent(generation)) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { method: 'GET', signal: controller.signal });
      if (!response.ok || !isLogoCacheGenerationCurrent(generation)) return undefined;
      const raw = await response.json();
      if (!Array.isArray(raw)) return undefined;
      const ranked = raw
        .map((result, index) => scoredSearchResult(candidate, result as BrandfetchSearchResult, index))
        .filter((value): value is { value: RemoteMerchantLogo; score: number } => value !== null)
        .sort((a, b) => b.score - a.score);
      return ranked[0]?.value ?? null;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  });
}

/** Resolve bundled shortcuts locally, then enrich a sanitized merchant name through Brandfetch Search. */
export async function resolveRemoteMerchantLogo(title: string): Promise<RemoteMerchantLogo | null> {
  const generation = logoCacheGeneration();
  if (generation === null) return null;
  const candidate = merchantBrandCandidate(title);
  if (!candidate) return null;
  const identity = candidate ? verifiedMerchantIdentity(candidate) : null;
  if (identity) {
    const logoUrl = verifiedLogoUrl(identity.domain);
    return logoUrl ? Object.freeze({
      id: `brandfetch:${identity.domain}`, ...identity, logoUrl, confidence: 1, source: 'verified',
    }) : null;
  }
  const key = cacheKey(candidate);
  const active = pending.get(key);
  if (active) return active;
  // Presentation enrichment is optional. Prefer an immediate category fallback
  // to retaining dozens/hundreds of off-screen promises after a fast scroll.
  if (pending.size >= MAX_PENDING_RESOLUTIONS) {
    saturatedResolutionDrops += 1;
    return null;
  }
  const request = (async () => {
    const cached = await readCached(candidate, generation);
    if (!isLogoCacheGenerationCurrent(generation)) return null;
    if (cached !== undefined) return cached;
    const found = await searchBrandfetch(candidate, generation);
    if (!isLogoCacheGenerationCurrent(generation)) return null;
    if (found !== undefined) await writeCached(candidate, found, generation);
    return isLogoCacheGenerationCurrent(generation) ? found ?? null : null;
  })().finally(() => {
    if (pending.get(key) === request) pending.delete(key);
  });
  pending.set(key, request);
  notePending();
  return request;
}

/** Source-free process-lifetime counters for tester diagnostics. */
export function getMerchantLogoCacheDiagnostics() {
  return {
    memoryEntries: memory.size,
    memoryLimit: MAX_MEMORY_CACHE_ENTRIES,
    peakMemoryEntries,
    pendingEntries: pending.size,
    pendingLimit: MAX_PENDING_RESOLUTIONS,
    peakPendingEntries,
    queuedSearches: searchWaiters.length,
    peakQueuedSearches,
    memoryEvictions,
    saturatedResolutionDrops,
  };
}

export function clearMerchantLogoMemoryCache(): void {
  memory.clear();
  pending.clear();
  peakMemoryEntries = 0;
  peakPendingEntries = 0;
  peakQueuedSearches = 0;
  memoryEvictions = 0;
  saturatedResolutionDrops = 0;
}

registerLogoCacheReset(clearMerchantLogoMemoryCache);
