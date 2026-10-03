import { COUNTRY_NAMES } from '@/lib/country-names';

/**
 * The user's country, kept apart from the parser market pack.
 *
 * `country` is any ISO 3166-1 alpha-2 code the user lives and banks in. It
 * decides conventions that genuinely vary by country — today, whether a bare
 * numeric date such as 03/04/2026 is day-first or month-first. It defaults
 * from the device Region and the user can change it in onboarding or
 * Settings.
 *
 * The parser MARKET pack (`marketId`, see markets.ts) is a different thing:
 * the mature, launch-tested UAE and Saudi grammars with their bank registries.
 * Only AE and SA have one. Every other country gets the neutral pack, so a
 * user in Germany never silently borrows UAE bank identities; their alerts go
 * through the universal (worldwide, review-first) parser exactly as before.
 *
 * `ZZ` (ISO's user-assigned "unknown") means nobody has said and the device
 * gave no Region. It is a real, storable answer: conventions that need a
 * country stay undecided rather than guessed.
 */
export const COUNTRY_UNKNOWN = 'ZZ';

/** How a bare numeric date reads in a country. ISO y-m-d is unambiguous everywhere. */
export type CountryDateOrder = 'DMY' | 'MDY' | 'YMD';

/**
 * Countries whose everyday numeric dates are month-first: the United States
 * and the territories and freely-associated states that follow its usage, and
 * the Philippines. Everything else not listed below is day-first.
 */
const MONTH_FIRST = new Set(['US', 'AS', 'GU', 'MP', 'PR', 'VI', 'UM', 'FM', 'MH', 'PW', 'PH']);

/** Year-first countries. A d/m/y-shaped token there is not a date we can place. */
const YEAR_FIRST = new Set(['CN', 'JP', 'KR', 'KP', 'TW', 'HU', 'LT', 'MN']);

/**
 * No single order is safe to assume:
 *   CA  — day-first, month-first and ISO all in everyday bank use.
 *   IR, AF, NP, ET — the numeric dates banks print are usually in a local
 *        calendar (Solar Hijri, Bikram Sambat, Ethiopian), so reading them as
 *        Gregorian in any order would be wrong.
 * These behave like an unknown country: an ambiguous date is refused.
 */
const UNDECIDED = new Set(['CA', 'IR', 'AF', 'NP', 'ET']);

/** Every assignable ISO 3166-1 alpha-2 code this build can name. */
export const COUNTRY_CODES: readonly string[] = Object.freeze(Object.keys(COUNTRY_NAMES));

const KNOWN = new Set(COUNTRY_CODES);

/** A real ISO country, `ZZ`, or null. */
export function normalizeCountryCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  if (code === COUNTRY_UNKNOWN) return COUNTRY_UNKNOWN;
  return KNOWN.has(code) ? code : null;
}

/** True only for a real country, never for `ZZ`. */
export function isKnownCountry(value: unknown): boolean {
  const code = normalizeCountryCode(value);
  return code !== null && code !== COUNTRY_UNKNOWN;
}

/** The Region part of a BCP 47 tag: "en-US" → US, "zh-Hant-TW" → TW, "es-419" → null. */
export function countryFromLocaleTag(tag: string | null | undefined): string | null {
  if (!tag) return null;
  for (const part of tag.replace(/_/g, '-').split('-').slice(1)) {
    if (/^[A-Za-z]{2}$/.test(part)) {
      const code = normalizeCountryCode(part);
      return code && code !== COUNTRY_UNKNOWN ? code : null;
    }
  }
  return null;
}

/**
 * The first real country among device Region candidates (a bare Region code or
 * a full locale tag), or `ZZ` when none is one. Never guesses AE or SA.
 */
export function countryFromDeviceRegions(candidates: readonly (string | null | undefined)[]): string {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const direct = /^[A-Za-z]{2}$/.test(candidate.trim()) ? normalizeCountryCode(candidate) : null;
    const code = direct && direct !== COUNTRY_UNKNOWN ? direct : countryFromLocaleTag(candidate);
    if (code) return code;
  }
  return COUNTRY_UNKNOWN;
}

/** The numeric date order a country uses, or null when it must not be assumed. */
export function dateOrderForCountry(country: string | null | undefined): CountryDateOrder | null {
  const code = normalizeCountryCode(country);
  if (!code || code === COUNTRY_UNKNOWN || UNDECIDED.has(code)) return null;
  if (MONTH_FIRST.has(code)) return 'MDY';
  if (YEAR_FIRST.has(code)) return 'YMD';
  return 'DMY';
}

/**
 * The statement parser's spelling of the same fact. Year-first countries map
 * to null: their statements print ISO dates, which need no hint, and a
 * d/m/y-shaped cell there is not something to resolve by assumption.
 */
export function statementDateOrderForCountry(
  country: string | null | undefined,
): 'day-first' | 'month-first' | null {
  const order = dateOrderForCountry(country);
  return order === 'DMY' ? 'day-first' : order === 'MDY' ? 'month-first' : null;
}

/** Display name in the UI language, or the bare code for a code this build does not know. */
export function countryDisplayName(code: string, language: 'en' | 'ar'): string {
  const names = COUNTRY_NAMES[code];
  return names ? names[language === 'ar' ? 1 : 0] : code;
}

/** Regional-indicator flag for a real country; a globe for anything else. */
export function countryFlag(code: string | null | undefined): string {
  const normalized = normalizeCountryCode(code);
  if (!normalized || normalized === COUNTRY_UNKNOWN) return '\u{1F30D}';
  return String.fromCodePoint(...[...normalized].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65));
}

/** Launch parser markets with a mature grammar pack. */
const PACKED = new Set(['AE', 'SA']);

/** Id of the neutral parser pack (no bank registry, no country overlay). */
export const NEUTRAL_MARKET_ID = 'ZZ';

/**
 * Which parser pack a country selects, given what the ledger already proves.
 *
 * A ledger already denominated in AED or SAR keeps a Gulf pack: its money is
 * the strongest evidence of whose banks the alerts come from, and a pack
 * change on such a ledger must never be a side effect of picking a country.
 * An AE/SA user with an AED/SAR ledger is therefore unaffected by this
 * function; so is anyone whose chosen country is AE or SA. Everyone else gets
 * the neutral pack.
 */
export function parserMarketForCountry(
  country: string | null | undefined,
  current: { marketId?: string | null; ledgerCurrency?: string | null } = {},
): string {
  const ledger = current.ledgerCurrency?.toUpperCase() ?? null;
  const gulfLedger = ledger === 'AED' ? 'AE' : ledger === 'SAR' ? 'SA' : null;
  if (gulfLedger) {
    return current.marketId && PACKED.has(current.marketId) ? current.marketId : gulfLedger;
  }
  const code = normalizeCountryCode(country);
  return code && PACKED.has(code) ? code : NEUTRAL_MARKET_ID;
}

/**
 * One-time migration of a stored ledger that predates `country`.
 *
 * Every earlier build stored `marketId` AE or SA, because detectMarketId fell
 * back to AE for any locale outside the two launch markets. So the stored
 * pack alone cannot say whether a user is really in the UAE. In order:
 *   1. a stored country wins;
 *   2. a country the user picked during onboarding (it was display-only then,
 *      but it is what they told us) wins next;
 *   3. an AE/SA pack stays that country when the ledger's money matches it,
 *      or when there is no ledger currency and the device does not say
 *      otherwise — the launch behaviour, unchanged;
 *   4. otherwise the device Region, or `ZZ`.
 * The parser pack then follows parserMarketForCountry, which keeps every
 * AED/SAR ledger on its Gulf pack.
 */
export function migrateCountryState(input: {
  country?: unknown;
  marketId?: unknown;
  onboardingCountry?: unknown;
  ledgerCurrency?: string | null;
  deviceCountry: string;
}): { country: string; marketId: string } {
  const marketId = typeof input.marketId === 'string' ? input.marketId : '';
  const ledgerCurrency = input.ledgerCurrency ?? null;
  const device = normalizeCountryCode(input.deviceCountry) ?? COUNTRY_UNKNOWN;
  const stored = normalizeCountryCode(input.country);
  // Already migrated. The pack may since have moved on evidence (a history
  // import that proved Saudi alerts) and must not be re-derived every launch.
  if (stored) {
    return {
      country: stored,
      marketId: PACKED.has(marketId) || marketId === NEUTRAL_MARKET_ID
        ? marketId
        : parserMarketForCountry(stored, { marketId, ledgerCurrency }),
    };
  }
  const onboarding = normalizeCountryCode(input.onboardingCountry);
  let country: string;
  if (onboarding && onboarding !== COUNTRY_UNKNOWN) {
    country = onboarding;
  } else if (PACKED.has(marketId) && (
    ledgerCurrency === (marketId === 'SA' ? 'SAR' : 'AED') ||
    (!ledgerCurrency && (device === marketId || device === COUNTRY_UNKNOWN))
  )) {
    country = marketId;
  } else {
    country = device;
  }
  return { country, marketId: parserMarketForCountry(country, { marketId, ledgerCurrency }) };
}

let activeCountry: string | null = null;

/** Mirror the persisted country into parsing modules; `null` clears it. */
export function setActiveCountry(code: string | null): void {
  activeCountry = normalizeCountryCode(code);
}

/** The user's country as last synced from the ledger, or null before hydration. */
export function getActiveCountry(): string | null {
  return activeCountry;
}

/** Date order for alerts from an unknown institution: the user's own country's. */
export function activeCountryDateOrder(): CountryDateOrder | undefined {
  return dateOrderForCountry(activeCountry) ?? undefined;
}
