import AsyncStorage from '@react-native-async-storage/async-storage';

import { bankBrandForName } from '@/lib/markets';

export interface ResolvedBankLogo {
  readonly id: string;
  readonly domain: string;
  readonly canonicalName: string;
  readonly logoUrl: string;
  readonly source: 'market' | 'brandfetch';
}

type SearchResult = {
  name?: unknown;
  domain?: unknown;
  claimed?: unknown;
};

type CacheRecord = {
  value: ResolvedBankLogo | null;
  expiresAt: number;
};

const CACHE_PREFIX = 'wafra:bank-logo:v1:';
const POSITIVE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const memory = new Map<string, CacheRecord>();
const pending = new Map<string, Promise<ResolvedBankLogo | null>>();
const DEFAULT_BRANDFETCH_CLIENT_ID = '1idPBg9EKr252UlBUPZ';

function clientId(): string | null {
  const value = process.env.EXPO_PUBLIC_WAFRA_BRANDFETCH_CLIENT_ID?.trim();
  return value || DEFAULT_BRANDFETCH_CLIENT_ID;
}

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

function cacheKey(bankName: string): string {
  return CACHE_PREFIX + encodeURIComponent(normalized(bankName));
}

async function readCached(bankName: string): Promise<CacheRecord | null> {
  const key = cacheKey(bankName);
  const now = Date.now();
  const hot = memory.get(key);
  if (hot && hot.expiresAt > now) return hot;
  if (hot) memory.delete(key);
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheRecord;
    if (!parsed || typeof parsed.expiresAt !== 'number' || parsed.expiresAt <= now) {
      await AsyncStorage.removeItem(key).catch(() => undefined);
      return null;
    }
    memory.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

async function writeCached(bankName: string, value: ResolvedBankLogo | null): Promise<void> {
  const record: CacheRecord = {
    value,
    expiresAt: Date.now() + (value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
  };
  const key = cacheKey(bankName);
  memory.set(key, record);
  try {
    await AsyncStorage.setItem(key, JSON.stringify(record));
  } catch {
    // Logo enrichment must never block or break the ledger.
  }
}

function exactRemoteIdentity(bankName: string, resultName: string, domain: string): boolean {
  const candidate = normalized(bankName);
  const result = normalized(resultName);
  const stem = normalized(domain.split('.')[0] ?? '');
  if (!candidate || !result || !stem) return false;
  if (candidate === result || candidate === stem) return true;

  // Legal suffixes do not make a different institution. Everything else does.
  const legal = new Set(['bank', 'banking', 'plc', 'ltd', 'limited', 'inc', 'incorporated', 'company', 'co', 'group', 'na', 'n a']);
  const candidateTokens = candidate.split(' ');
  const resultTokens = result.split(' ');
  const strip = (tokens: string[]) => tokens.filter(token => !legal.has(token)).join(' ');
  return strip(candidateTokens) === strip(resultTokens) && strip(candidateTokens).length >= 3;
}

function parseResults(payload: unknown): SearchResult[] {
  if (!Array.isArray(payload)) return [];
  return payload.filter((item): item is SearchResult => !!item && typeof item === 'object');
}

function logoForDomain(domain: string, canonicalName: string, source: ResolvedBankLogo['source']): ResolvedBankLogo | null {
  const id = clientId();
  if (!id) return null;
  const cleanedDomain = domain.trim().toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+[a-z]{2,24}$/i.test(cleanedDomain)) return null;
  return Object.freeze({
    id: `bank:${cleanedDomain}`,
    domain: cleanedDomain,
    canonicalName,
    logoUrl: `https://cdn.brandfetch.io/domain/${encodeURIComponent(cleanedDomain)}?c=${encodeURIComponent(id)}`,
    source,
  });
}

async function fetchUnknownBank(bankName: string): Promise<ResolvedBankLogo | null> {
  const id = clientId();
  if (!id) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(
      `https://api.brandfetch.io/v2/search/${encodeURIComponent(bankName)}?c=${encodeURIComponent(id)}`,
      { method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal },
    );
    if (!response.ok) return null;
    for (const item of parseResults(await response.json()).slice(0, 8)) {
      if (typeof item.name !== 'string' || typeof item.domain !== 'string') continue;
      // Unknown institutions require an exact identity and, when Brandfetch
      // provides ownership status, a claimed record. Missing is safer than wrong.
      if (item.claimed === false || !exactRemoteIdentity(bankName, item.name, item.domain)) continue;
      const logo = logoForDomain(item.domain, item.name.trim(), 'brandfetch');
      if (logo) return logo;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve only an institution identity already learned by Wafra. Account names
 * are intentionally not accepted: a user may call an account "Holiday money",
 * which must never leave the phone or be guessed into a financial brand.
 */
export async function resolveBankLogo(bankName: string | undefined): Promise<ResolvedBankLogo | null> {
  if (!bankName) return null;
  const candidate = safeBankName(bankName);
  if (!candidate) return null;

  const known = bankBrandForName(candidate);
  if (known?.domain) return logoForDomain(known.domain, known.name, 'market');

  const cached = await readCached(candidate);
  if (cached) return cached.value;
  const key = normalized(candidate);
  const active = pending.get(key);
  if (active) return active;
  const request = fetchUnknownBank(candidate)
    .then(async value => {
      await writeCached(candidate, value);
      return value;
    })
    .finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

export function clearBankLogoMemoryCache(): void {
  memory.clear();
  pending.clear();
}
