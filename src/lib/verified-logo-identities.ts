/** Only reviewed identities may supply remote artwork; input names stay on-device. */
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

/** Call only with a domain from the reviewed merchant list or a bundled bank pack. */
export function verifiedLogoUrl(domain: string): string | null {
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+[a-z]{2,24}$/i.test(domain)) return null;
  const client = process.env.EXPO_PUBLIC_WAFRA_BRANDFETCH_CLIENT_ID?.trim() || '1idPBg9EKr252UlBUPZ';
  return `https://cdn.brandfetch.io/domain/${encodeURIComponent(domain)}?c=${encodeURIComponent(client)}`;
}
