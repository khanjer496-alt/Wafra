import { COUNTRY_NAMES } from '@/lib/country-names';

/** Device presentation preferences, independent of parser country and money. */
interface DateTimeLocale {
  languageTag?: string | null;
  regionCode?: string | null;
  uses24hourClock?: boolean | null;
}

// Region convention language, derived from Unicode CLDR 49 likelySubtags:
// https://github.com/unicode-org/cldr-json/blob/49.0.0/cldr-json/cldr-core/supplemental/likelySubtags.json
// Each und-REGION entry contributes its language; an absent entry uses CLDR's
// und default (English), with the actual region reapplied below. This is only
// date-convention data, never a claim that Wafra translates to these languages.
// Snapshot SHA256: 95447c75a7e54f7f9900f696ca96881aa2f6fab26d3c1f897f5f3c2a21e876fb
const REGION_CONVENTION_LANGUAGE: Readonly<Record<string, string>> = {
  AD: 'ca', AE: 'ar', AF: 'fa', AL: 'sq', AM: 'hy', AO: 'pt', AR: 'es', AS: 'sm', AT: 'de', AW: 'nl',
  AX: 'sv', AZ: 'az', BA: 'bs', BD: 'bn', BE: 'nl', BF: 'fr', BG: 'bg', BH: 'ar', BI: 'rn', BJ: 'fr',
  BL: 'fr', BN: 'ms', BO: 'es', BQ: 'pap', BR: 'pt', BT: 'dz', BV: 'no', BY: 'ru', CC: 'ms', CD: 'fr',
  CF: 'sg', CG: 'fr', CH: 'de', CI: 'fr', CL: 'es', CM: 'fr', CN: 'zh', CO: 'es', CR: 'es', CU: 'es',
  CV: 'pt', CW: 'pap', CY: 'el', CZ: 'cs', DE: 'de', DJ: 'fr', DK: 'da', DO: 'es', DZ: 'ar', EC: 'es',
  EE: 'et', EG: 'ar', EH: 'ar', ER: 'ti', ES: 'es', ET: 'am', FI: 'fi', FO: 'fo', FR: 'fr', GA: 'fr',
  GE: 'ka', GF: 'fr', GH: 'ak', GL: 'kl', GN: 'fr', GP: 'fr', GQ: 'es', GR: 'el', GT: 'es', GW: 'pt',
  HK: 'zh', HN: 'es', HR: 'hr', HT: 'ht', HU: 'hu', ID: 'id', IL: 'he', IN: 'hi', IQ: 'ar', IR: 'fa',
  IS: 'is', IT: 'it', JO: 'ar', JP: 'ja', KE: 'sw', KG: 'ky', KH: 'km', KM: 'ar', KP: 'ko', KR: 'ko',
  KW: 'ar', KZ: 'ru', LA: 'lo', LB: 'ar', LI: 'de', LK: 'si', LS: 'st', LT: 'lt', LU: 'fr', LV: 'lv',
  LY: 'ar', MA: 'ar', MC: 'fr', MD: 'ro', ME: 'sr', MF: 'fr', MG: 'mg', MK: 'mk', ML: 'bm', MM: 'my',
  MN: 'mn', MO: 'zh', MQ: 'fr', MR: 'ar', MT: 'mt', MU: 'fr', MV: 'dv', MX: 'es', MY: 'ms', MZ: 'pt',
  NA: 'af', NC: 'fr', NE: 'ha', NI: 'es', NL: 'nl', NO: 'nb', NP: 'ne', OM: 'ar', PA: 'es', PE: 'es',
  PF: 'fr', PG: 'tpi', PH: 'fil', PK: 'ur', PL: 'pl', PM: 'fr', PR: 'es', PS: 'ar', PT: 'pt', PW: 'pau',
  PY: 'gn', QA: 'ar', RE: 'fr', RO: 'ro', RS: 'sr', RU: 'ru', RW: 'rw', SA: 'ar', SC: 'fr', SD: 'ar',
  SE: 'sv', SI: 'sl', SJ: 'nb', SK: 'sk', SM: 'it', SN: 'wo', SO: 'so', SR: 'nl', SS: 'ar', ST: 'pt',
  SV: 'es', SY: 'ar', TD: 'ar', TF: 'fr', TG: 'fr', TH: 'th', TJ: 'tg', TK: 'tkl', TL: 'pt', TM: 'tk',
  TN: 'ar', TO: 'to', TR: 'tr', TV: 'tvl', TW: 'zh', TZ: 'sw', UA: 'uk', UG: 'sw', UY: 'es', UZ: 'uz',
  VA: 'it', VE: 'es', VN: 'vi', VU: 'bi', WF: 'fr', WS: 'sm', YE: 'ar', YT: 'fr', ZW: 'sn',
};

let preference: DateTimeLocale | null = null;
let preferenceKey = 'null';
const formatters = new Map<string, Intl.DateTimeFormat>();
const profiles = new Map<string, DateProfile>();

/** Called with Expo's first Locale and Calendar; null restores Intl defaults. */
export function setDateTimeLocale(input: DateTimeLocale | null): void {
  const next = input ? {
    languageTag: input.languageTag ?? null,
    regionCode: input.regionCode ?? null,
    uses24hourClock: typeof input.uses24hourClock === 'boolean' ? input.uses24hourClock : null,
  } : null;
  const key = JSON.stringify(next);
  if (key === preferenceKey) return;
  preference = next;
  preferenceKey = key;
  formatters.clear();
  profiles.clear();
}

type DateField = 'year' | 'month' | 'day';
interface DateProfile {
  uiLocale: string;
  regionalOrder: DateField[];
  compatibleOrders: Partial<Record<NonNullable<Intl.DateTimeFormatOptions['month']>, boolean>>;
  clock24: boolean;
}

function canonicalTag(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const normalized = value.trim().replace(/_/g, '-');
    if (!/^[a-z]{2,3}(?:-[a-z]{4})?(?:-(?:[a-z]{2}|\d{3}))?(?:-[a-z0-9]{1,8})*$/i.test(normalized)) return null;
    // getCanonicalLocales is optional on older native Intl implementations.
    // supportedLocalesOf still validates the tag before any formatter sees it.
    const pieces = normalized.split('-');
    let index = 1;
    pieces[0] = pieces[0].toLowerCase();
    if (/^[a-z]{4}$/i.test(pieces[index] ?? '')) {
      pieces[index] = pieces[index][0].toUpperCase() + pieces[index].slice(1).toLowerCase();
      index++;
    }
    if (/^(?:[a-z]{2}|\d{3})$/i.test(pieces[index] ?? '')) {
      pieces[index] = pieces[index].toUpperCase();
      index++;
    }
    for (; index < pieces.length; index++) pieces[index] = pieces[index].toLowerCase();
    const tag = typeof Intl.getCanonicalLocales === 'function'
      ? Intl.getCanonicalLocales(normalized)[0] : pieces.join('-');
    return tag && Intl.DateTimeFormat.supportedLocalesOf([tag]).length ? tag : null;
  } catch { return null; }
}

function knownRegion(value: string | null | undefined): string | null {
  const region = value?.trim().toUpperCase();
  return region && Object.prototype.hasOwnProperty.call(COUNTRY_NAMES, region) ? region : null;
}

function regionFromTag(tag: string): string | null {
  const pieces = tag.split('-');
  return knownRegion(pieces[/^[A-Z][a-z]{3}$/.test(pieces[1] ?? '') ? 2 : 1]);
}

function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}:${JSON.stringify(options)}`;
  let value = formatters.get(key);
  if (!value) {
    value = new Intl.DateTimeFormat(locale, {
      ...options, calendar: 'gregory', numberingSystem: 'latn', timeZone: 'UTC',
    });
    if (formatters.size >= 64) formatters.delete(formatters.keys().next().value!);
    formatters.set(key, value);
  }
  return value;
}

function dateOrder(locale: string, month: Intl.DateTimeFormatOptions['month'] = 'numeric'): DateField[] {
  // Hermes guarantees format(), but not DateTimeFormat.formatToParts(). Probe
  // distinct Gregorian fields instead. Changing November to December changes
  // only the month token, including languages whose standalone month name has
  // a different grammatical form from the name used alongside a day.
  const selected = formatter(locale, { year: 'numeric', month, day: 'numeric' });
  const first = normalizedProbe(selected.format(new Date(Date.UTC(2006, 10, 22))));
  const second = normalizedProbe(selected.format(new Date(Date.UTC(2006, 11, 22))));
  const tokenPosition = (token: string): number => {
    const match = new RegExp(`(^|[^0-9])${token}(?=$|[^0-9])`).exec(first);
    return match ? match.index + match[1].length : -1;
  };
  const year = tokenPosition('2006');
  const day = tokenPosition('22');
  let monthAt = 0;
  while (monthAt < first.length && monthAt < second.length && first[monthAt] === second[monthAt]) monthAt++;
  if (year < 0 || day < 0 || monthAt >= first.length || monthAt >= second.length || monthAt === year || monthAt === day) {
    throw new Error('Date convention could not be determined');
  }
  const positions: [DateField, number][] = [['year', year], ['month', monthAt], ['day', day]];
  return positions.sort((left, right) => left[1] - right[1]).map(entry => entry[0]);
}

/** Probe normalization only: never interpret formatted text as ledger data. */
function normalizedProbe(value: string): string {
  return value.replace(/[\u200e\u200f\u061c]/g, '').replace(/[\u0660-\u0669\u06f0-\u06f9]/g,
    digit => String(digit.charCodeAt(0) - (digit.charCodeAt(0) >= 0x06f0 ? 0x06f0 : 0x0660)));
}

function profile(language: string): DateProfile {
  const cached = profiles.get(language);
  if (cached) return cached;
  let deviceTag = 'en-GB';
  try { deviceTag = canonicalTag(Intl.DateTimeFormat().resolvedOptions().locale) ?? deviceTag; } catch { /* safe fallback */ }
  deviceTag = canonicalTag(preference?.languageTag) ?? deviceTag;
  const region = knownRegion(preference?.regionCode) ?? regionFromTag(deviceTag);
  const uiTag = canonicalTag(language) ?? 'en';
  // Preserve an explicit script (e.g. zh-Hant), but the device's Region wins
  // over a translation's language-region. Never use the bank parser market.
  const uiParts = uiTag.split('-');
  const script = uiParts.slice(1).find(part => /^[A-Z][a-z]{3}$/.test(part));
  const uiLocale = [uiParts[0], script, region].filter(Boolean).join('-');
  // Intl.Locale and maximize/minimize are absent in supported Hermes builds.
  // The small pinned CLDR language lookup keeps native region conventions
  // without adding a polyfill or relying on those optional APIs.
  const regionalLocale = region ? `${REGION_CONVENTION_LANGUAGE[region] ?? 'en'}-${region}` : deviceTag;
  let regionalOrder: DateField[] = ['year', 'month', 'day'];
  let regionalSupported = false;
  try { regionalSupported = Intl.DateTimeFormat.supportedLocalesOf([regionalLocale]).length > 0; } catch { /* no convention data */ }
  if (regionalSupported) {
    try {
      regionalOrder = dateOrder(regionalLocale);
    } catch { /* ISO numeric presentation is safer than guessing. */ }
  }
  let clock24 = preference?.uses24hourClock;
  if (typeof clock24 !== 'boolean') {
    try { clock24 = !formatter(regionalSupported ? regionalLocale : deviceTag, { hour: 'numeric' }).resolvedOptions().hour12; }
    catch { clock24 = true; }
  }
  const value: DateProfile = { uiLocale, regionalOrder, compatibleOrders: {}, clock24 };
  if (profiles.size >= 16) profiles.delete(profiles.keys().next().value!);
  profiles.set(language, value);
  return value;
}

function civilDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCHours(12, 0, 0, 0);
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day
    ? value : null;
}

function numericDate(date: Date, fields: Intl.DateTimeFormatOptions, order: DateField[]): string {
  const yearFirst = order[0] === 'year';
  const parts = {
    year: String(date.getUTCFullYear()).padStart(4, '0'),
    month: yearFirst ? String(date.getUTCMonth() + 1).padStart(2, '0') : String(date.getUTCMonth() + 1),
    day: yearFirst ? String(date.getUTCDate()).padStart(2, '0') : String(date.getUTCDate()),
  };
  return order.filter(field => fields[field] !== undefined).map(field => parts[field]).join(yearFirst ? '-' : '/');
}

/** Format a ledger civil date without applying the device timezone/calendar. */
export function regionalCivilDate(
  iso: string,
  language: string,
  fields: Intl.DateTimeFormatOptions,
): string {
  const date = civilDate(iso);
  if (!date) return iso;
  const selected = profile(language);
  try {
    const monthStyle = fields.month ?? 'numeric';
    if (selected.compatibleOrders[monthStyle] === undefined) {
      // CLDR can use YMD for en-JP numeric dates but MDY for its month-name
      // pattern. Compare the style actually requested, not just numeric dates.
      selected.compatibleOrders[monthStyle] = selected.regionalOrder.join() === dateOrder(selected.uiLocale, monthStyle).join();
    }
    if (selected.compatibleOrders[monthStyle]) return formatter(selected.uiLocale, fields).format(date);
    // e.g. en-JP's CLDR English pattern is month-first, while Japan's regional
    // pattern is year-first. Numeric Gregorian YMD avoids putting Japanese
    // suffixes around English words or silently reverting to US ordering.
    const value = numericDate(date, fields, selected.regionalOrder);
    return fields.weekday
      ? `${formatter(selected.uiLocale, { weekday: fields.weekday }).format(date)}, ${value}`
      : value;
  } catch { return iso; }
}

export function regionalMonth(key: string, language: string, short: boolean): string {
  return regionalCivilDate(`${key}-01`, language, { month: short ? 'short' : 'long', year: 'numeric' });
}

export function regionalWeekday(index: number, language: string, short: boolean): string {
  if (!Number.isInteger(index) || index < 0 || index > 6) return '';
  try {
    return formatter(profile(language).uiLocale, { weekday: short ? 'short' : 'long' })
      .format(new Date(Date.UTC(2026, 10, 1 + index)));
  } catch { return ''; }
}

/** Display the instant's current local clock, honoring the user's hour cycle. */
export function regionalClock(at: Date, language: string): string {
  if (!Number.isFinite(at.getTime())) return '';
  const selected = profile(language);
  if (selected.clock24) {
    // The previous 24-hour contract is exact and does not depend on native
    // hourCycle support (some Intl versions ignore it or print 24 at midnight).
    return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  }
  // Copy local clock fields to a UTC anchor. Cached Intl formatters can then
  // never retain an old device timezone after travel or an OS setting change.
  const clock = new Date(Date.UTC(2000, 0, 1, at.getHours(), at.getMinutes()));
  try {
    return formatter(selected.uiLocale, {
      hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(clock);
  } catch {
    return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  }
}
