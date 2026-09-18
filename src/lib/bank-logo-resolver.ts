import AsyncStorage from '@react-native-async-storage/async-storage';

import { bankBrandForName } from '@/lib/markets';
import { isLogoCacheGenerationCurrent, logoCacheGeneration, mutateLogoCache, registerLogoCacheReset } from '@/lib/logo-cache-lifecycle';
import { brandfetchSearchUrl, verifiedLogoUrl } from '@/lib/verified-logo-identities';

export interface ResolvedBankLogo {
  readonly id: string;
  readonly domain: string;
  readonly canonicalName: string;
  readonly logoUrl: string;
  readonly source: 'market' | 'search';
}

type CacheRecord = { query: string; value: ResolvedBankLogo | null; expiresAt: number };
type BrandfetchSearchResult = { name?: unknown; domain?: unknown; claimed?: unknown };
const CACHE_PREFIX = 'wafra:bank-logo:v2:';
const POSITIVE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;
const SEARCH_TIMEOUT_MS = 4_000;
const MAX_MEMORY_CACHE_ENTRIES = 64;
const MAX_PENDING_RESOLUTIONS = 8;
const memory = new Map<string, CacheRecord>();
const pending = new Map<string, Promise<ResolvedBankLogo | null>>();
let peakMemoryEntries = 0;
let peakPendingEntries = 0;
let memoryEvictions = 0;
let saturatedResolutionDrops = 0;

function remember(key: string, record: CacheRecord): void {
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

function normalized(value: string): string {
  return value.normalize('NFKD').toLowerCase()
    .replace(/\p{M}+/gu, '')
    .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ').trim();
}

function safeBankName(value: string): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > 120) return null;
  if (/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/u.test(value)) return null;
  const clean = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (/\d{4,}/u.test(clean) || /\b(?:account|acct|card)\s*(?:x+|\*+)?\d{2,16}\b/iu.test(clean)) return null;
  const key = normalized(clean);
  if (key.length < 2 || /^\d+$/.test(key)) return null;
  return clean;
}

function cacheKey(name: string): string {
  return CACHE_PREFIX + encodeURIComponent(normalized(name));
}

function safeCachedValue(value: unknown): ResolvedBankLogo | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<ResolvedBankLogo>;
  if (candidate.source !== 'search' || typeof candidate.domain !== 'string' ||
      typeof candidate.canonicalName !== 'string' || candidate.canonicalName.length > 160 ||
      /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/u.test(candidate.canonicalName)) return undefined;
  const logoUrl = verifiedLogoUrl(candidate.domain);
  if (!logoUrl) return undefined;
  return Object.freeze({
    id: `bank:${candidate.domain}`,
    domain: candidate.domain,
    canonicalName: candidate.canonicalName,
    logoUrl,
    source: 'search' as const,
  });
}

async function readCached(candidate: string, generation: number): Promise<ResolvedBankLogo | null | undefined> {
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
    remember(key, { query, value: safe, expiresAt: record.expiresAt });
    return safe;
  } catch {
    return undefined;
  }
}

async function writeCached(candidate: string, value: ResolvedBankLogo | null, generation: number): Promise<void> {
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

function bankNameCore(value: string): string {
  return normalized(value)
    .split(' ')
    .filter(token => !['bank', 'banco', 'banque', 'the', 'plc', 'inc', 'ltd', 'limited', 'group'].includes(token))
    .join(' ');
}

function scoredSearchResult(candidate: string, result: BrandfetchSearchResult): { value: ResolvedBankLogo; score: number } | null {
  if (typeof result.name !== 'string' || typeof result.domain !== 'string') return null;
  const logoUrl = verifiedLogoUrl(result.domain);
  if (!logoUrl) return null;
  const query = normalized(candidate);
  const name = normalized(result.name);
  if (!query || !name) return null;
  const exact = query === name;
  const compact = query.replace(/\s/g, '') === name.replace(/\s/g, '');
  const core = bankNameCore(candidate);
  const resultCore = bankNameCore(result.name);
  const claimed = result.claimed === true;
  let score = exact ? 100 : compact && claimed ? 94 : core && core === resultCore && claimed ? 90 : 0;
  if (!score) return null;
  if (claimed) score += 4;
  return {
    score,
    value: Object.freeze({
      id: `bank:${result.domain}`,
      domain: result.domain,
      canonicalName: result.name.trim(),
      logoUrl,
      source: 'search',
    }),
  };
}

/** null = a successful search with no confident match; undefined = transient lookup failure. */
async function searchBrandfetch(candidate: string, generation: number): Promise<ResolvedBankLogo | null | undefined> {
  const url = brandfetchSearchUrl(candidate);
  if (!url || !isLogoCacheGenerationCurrent(generation)) return undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    if (!response.ok || !isLogoCacheGenerationCurrent(generation)) return undefined;
    const raw = await response.json();
    if (!Array.isArray(raw)) return undefined;
    const ranked = raw
      .map(result => scoredSearchResult(candidate, result as BrandfetchSearchResult))
      .filter((value): value is { value: ResolvedBankLogo; score: number } => value !== null)
      .sort((a, b) => b.score - a.score);
    return ranked[0]?.value ?? null;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve known banks locally, then use Brandfetch Search for other institution names. */
export async function resolveBankLogo(bankName: string | undefined): Promise<ResolvedBankLogo | null> {
  const generation = logoCacheGeneration();
  if (generation === null || !bankName) return null;
  const candidate = safeBankName(bankName);
  if (!candidate) return null;
  const known = bankBrandForName(candidate);
  // Bank names learned by the launch parser are canonical. Keep those on the
  // no-search fast path; a loose substring match still does not authorize it.
  if (known?.domain && normalized(known.name) === normalized(candidate)) {
    const logoUrl = verifiedLogoUrl(known.domain);
    return logoUrl ? Object.freeze({
      id: `bank:${known.domain}`, domain: known.domain, canonicalName: known.name, logoUrl, source: 'market',
    }) : null;
  }
  const key = cacheKey(candidate);
  const active = pending.get(key);
  if (active) return active;
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
  peakPendingEntries = Math.max(peakPendingEntries, pending.size);
  return request;
}

/** Source-free process-lifetime counters for tester diagnostics. */
export function getBankLogoCacheDiagnostics() {
  return {
    memoryEntries: memory.size,
    memoryLimit: MAX_MEMORY_CACHE_ENTRIES,
    peakMemoryEntries,
    pendingEntries: pending.size,
    pendingLimit: MAX_PENDING_RESOLUTIONS,
    peakPendingEntries,
    memoryEvictions,
    saturatedResolutionDrops,
  };
}

export function clearBankLogoMemoryCache(): void {
  memory.clear();
  pending.clear();
  peakMemoryEntries = 0;
  peakPendingEntries = 0;
  memoryEvictions = 0;
  saturatedResolutionDrops = 0;
}

registerLogoCacheReset(clearBankLogoMemoryCache);
