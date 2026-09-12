import AsyncStorage from '@react-native-async-storage/async-storage';

import { bankBrandForName } from '@/lib/markets';
import { isLogoCacheGenerationCurrent, logoCacheGeneration, mutateLogoCache, registerLogoCacheReset } from '@/lib/logo-cache-lifecycle';
import { verifiedLogoUrl } from '@/lib/verified-logo-identities';

export interface ResolvedBankLogo {
  readonly id: string;
  readonly domain: string;
  readonly canonicalName: string;
  readonly logoUrl: string;
  readonly source: 'market';
}

type CacheRecord = { value: ResolvedBankLogo; expiresAt: number };
const CACHE_PREFIX = 'wafra:bank-logo:v1:';
const POSITIVE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const memory = new Map<string, CacheRecord>();
const pending = new Map<string, Promise<ResolvedBankLogo | null>>();

function normalized(value: string): string {
  return value.normalize('NFKC').toLowerCase()
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
  const key = normalized(clean);
  if (key.length < 2 || /^\d+$/.test(key)) return null;
  return clean;
}

function cacheKey(name: string): string {
  return CACHE_PREFIX + encodeURIComponent(normalized(name));
}

function matches(record: CacheRecord | null, expected: ResolvedBankLogo): boolean {
  const value = record?.value;
  return typeof record?.expiresAt === 'number' && record.expiresAt > Date.now() && !!value &&
    value.id === expected.id && value.domain === expected.domain &&
    value.canonicalName === expected.canonicalName && value.logoUrl === expected.logoUrl &&
    value.source === expected.source;
}

async function readCached(expected: ResolvedBankLogo, generation: number): Promise<boolean> {
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
    memory.set(key, { value: expected, expiresAt: record.expiresAt });
    return true;
  } catch {
    return false;
  }
}

async function writeCached(value: ResolvedBankLogo, generation: number): Promise<void> {
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

/** Only bundled bank identities authorize artwork; unknown institution names stay local. */
export async function resolveBankLogo(bankName: string | undefined): Promise<ResolvedBankLogo | null> {
  const generation = logoCacheGeneration();
  if (generation === null || !bankName) return null;
  const candidate = safeBankName(bankName);
  if (!candidate) return null;
  const known = bankBrandForName(candidate);
  // Bank names learned by the parser are canonical. A substring match in a
  // user-controlled label must not guess that an unrelated account is this bank.
  if (!known?.domain || normalized(known.name) !== normalized(candidate)) return null;
  const logoUrl = verifiedLogoUrl(known.domain);
  if (!logoUrl) return null;
  const expected: ResolvedBankLogo = Object.freeze({
    id: `bank:${known.domain}`, domain: known.domain, canonicalName: known.name, logoUrl, source: 'market',
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

export function clearBankLogoMemoryCache(): void {
  memory.clear();
  pending.clear();
}

registerLogoCacheReset(clearBankLogoMemoryCache);
