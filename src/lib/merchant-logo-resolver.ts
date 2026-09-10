import AsyncStorage from '@react-native-async-storage/async-storage';

export interface RemoteMerchantLogo {
  readonly id: string;
  readonly domain: string;
  readonly canonicalName: string;
  readonly logoUrl: string;
  readonly confidence: number;
  readonly source: 'brandfetch';
}

type SearchResult = {
  name?: unknown;
  domain?: unknown;
  claimed?: unknown;
};

type CacheRecord = {
  value: RemoteMerchantLogo | null;
  expiresAt: number;
};

const CACHE_PREFIX = 'wafra:merchant-logo:v1:';
const POSITIVE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
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
 * Never pass a full SMS/body, card number, amount, account suffix or URL path
 * to a third-party logo service.
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

function tokens(value: string): string[] {
  return normalized(value).split(' ').filter(token => token.length > 1 && !['llc', 'ltd', 'inc', 'limited', 'company', 'co', 'plc', 'group'].includes(token));
}

export function merchantBrandConfidence(candidate: string, resultName: string, domain: string): number {
  const a = normalized(candidate);
  const b = normalized(resultName);
  const domainStem = normalized(domain.split('.')[0] ?? '');
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a === domainStem) return 0.99;
  if (b.startsWith(a + ' ')) return 0.96;
  if (a.startsWith(b + ' ')) {
    const suffix = a.slice(b.length + 1).split(' ').filter(Boolean);
    const safeSuffixes = new Set(['llc', 'ltd', 'limited', 'inc', 'incorporated', 'company', 'co', 'plc', 'group']);
    if (suffix.length > 0 && suffix.every(token => safeSuffixes.has(token))) return 0.96;
  }

  const left = new Set(tokens(candidate));
  const right = new Set([...tokens(resultName), ...tokens(domainStem)]);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap++;
  const containment = overlap / left.size;
  const union = new Set([...left, ...right]).size;
  const jaccard = union ? overlap / union : 0;
  if (containment === 1 && left.size >= 2) return Math.min(0.95, 0.9 + jaccard * 0.05);
  return Math.min(0.89, containment * 0.75 + jaccard * 0.14);
}

const DEFAULT_BRANDFETCH_CLIENT_ID = '1idPBg9EKr252UlBUPZ';

function clientId(): string | null {
  const value = process.env.EXPO_PUBLIC_WAFRA_BRANDFETCH_CLIENT_ID?.trim();
  return value || DEFAULT_BRANDFETCH_CLIENT_ID;
}

export function remoteMerchantLogosEnabled(): boolean {
  return clientId() !== null;
}

function cacheKey(candidate: string): string {
  return CACHE_PREFIX + encodeURIComponent(normalized(candidate));
}

async function readCached(candidate: string): Promise<CacheRecord | null> {
  const key = cacheKey(candidate);
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

async function writeCached(candidate: string, value: RemoteMerchantLogo | null): Promise<void> {
  const record: CacheRecord = {
    value,
    expiresAt: Date.now() + (value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
  };
  const key = cacheKey(candidate);
  memory.set(key, record);
  try {
    await AsyncStorage.setItem(key, JSON.stringify(record));
  } catch {
    // Logo enrichment must never make the ledger unusable when storage is full.
  }
}

function parseResults(payload: unknown): SearchResult[] {
  if (!Array.isArray(payload)) return [];
  return payload.filter((item): item is SearchResult => !!item && typeof item === 'object');
}

async function fetchRemote(candidate: string): Promise<RemoteMerchantLogo | null> {
  const id = clientId();
  if (!id) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const url = `https://api.brandfetch.io/v2/search/${encodeURIComponent(candidate)}?c=${encodeURIComponent(id)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return null;

    let best: RemoteMerchantLogo | null = null;
    const results = parseResults(await response.json());
    for (const item of results.slice(0, 8)) {
      if (typeof item.name !== 'string' || typeof item.domain !== 'string') continue;
      const domain = item.domain.trim().toLowerCase();
      if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+[a-z]{2,24}$/i.test(domain)) continue;
      const confidence = merchantBrandConfidence(candidate, item.name, domain);
      // The product requirement is "no wrong logo". A missing mark is much
      // cheaper than confidently attaching another business to a transaction.
      if (confidence < 0.94) continue;
      const value: RemoteMerchantLogo = Object.freeze({
        id: `brandfetch:${domain}`,
        domain,
        canonicalName: item.name.trim(),
        logoUrl: `https://cdn.brandfetch.io/domain/${encodeURIComponent(domain)}?c=${encodeURIComponent(id)}`,
        confidence,
        source: 'brandfetch',
      });
      if (!best || value.confidence > best.confidence) best = value;
    }
    return best;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve an unknown display merchant to a high-confidence remote logo. */
export async function resolveRemoteMerchantLogo(title: string): Promise<RemoteMerchantLogo | null> {
  const candidate = merchantBrandCandidate(title);
  if (!candidate || !remoteMerchantLogosEnabled()) return null;

  const cached = await readCached(candidate);
  if (cached) return cached.value;

  const key = normalized(candidate);
  const active = pending.get(key);
  if (active) return active;

  const request = fetchRemote(candidate)
    .then(async value => {
      await writeCached(candidate, value);
      return value;
    })
    .finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

/** Test/diagnostics only; does not expose user transaction data. */
export function clearMerchantLogoMemoryCache(): void {
  memory.clear();
  pending.clear();
}
