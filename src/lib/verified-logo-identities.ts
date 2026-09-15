/** Fast-path identities that do not need a Brandfetch name search. */
export interface VerifiedMerchantIdentity {
  readonly canonicalName: string;
  readonly domain: string;
}

// These domains are the brands' reviewed primary sites. Keep new aliases exact:
// a substring such as "Nesto Plumbing" is not evidence of the retail chain.
const MERCHANTS: readonly (VerifiedMerchantIdentity & { aliases: readonly string[] })[] = [
  { canonicalName: 'Choithrams', domain: 'choithrams.com', aliases: ['choithrams'] },
  { canonicalName: 'Nesto', domain: 'nestogroup.com', aliases: ['nesto', 'nesto hypermarket'] },
  { canonicalName: 'Sharaf DG', domain: 'sharafdg.com', aliases: ['sharaf dg'] },
  { canonicalName: 'Starbucks', domain: 'starbucks.com', aliases: ['starbucks'] },
];

export function verifiedMerchantIdentity(candidate: string): VerifiedMerchantIdentity | null {
  const key = candidate.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  const identity = MERCHANTS.find(value => value.aliases.includes(key));
  return identity ? { canonicalName: identity.canonicalName, domain: identity.domain } : null;
}

function brandfetchClientId(): string {
  return process.env.EXPO_PUBLIC_WAFRA_BRANDFETCH_CLIENT_ID?.trim() || '1idPBg9EKr252UlBUPZ';
}

/** Build artwork only from a validated brand domain, never from an arbitrary URL. */
export function verifiedLogoUrl(domain: string): string | null {
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+[a-z]{2,24}$/i.test(domain)) return null;
  return `https://cdn.brandfetch.io/domain/${encodeURIComponent(domain)}?c=${encodeURIComponent(brandfetchClientId())}`;
}

/** Brand Search is intentionally name-only: amounts, account tails and raw bank text never belong here. */
export function brandfetchSearchUrl(name: string): string | null {
  const clean = name.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (!clean || clean.length > 80 || /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/u.test(clean)) return null;
  return `https://api.brandfetch.io/v2/search/${encodeURIComponent(clean)}?c=${encodeURIComponent(brandfetchClientId())}`;
}
