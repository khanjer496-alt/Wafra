/**
 * Pure pieces of a multi-file statement import: upload pacing and counted copy.
 *
 * The relay limits statement uploads to six a minute per format (see
 * IMPORT_RATE_LIMITER in server/wrangler.toml) and twelve an hour per device.
 * A batch of statements used to fire every file back to back, hit the minute
 * limit on the seventh, and abort the whole batch there. Pacing below that
 * limit keeps a normal batch from ever seeing a 429; the hourly budget still
 * can, and the screen reports it per file instead of stopping silently.
 */

/** The relay's per-format rate-limit window. */
export const UPLOAD_WINDOW_MS = 60_000;
/** One below the relay's six a minute, leaving room for clock skew and retries. */
export const UPLOADS_PER_WINDOW = 5;
/** Slack after the window so the edge limiter has certainly rolled over. */
const WINDOW_MARGIN_MS = 1_000;

/**
 * How long to wait before the next upload of one format, given when the
 * previous uploads of that format started. Zero when it may start now.
 */
export function nextUploadDelay(starts: readonly number[], now: number): number {
  const recent = starts.filter((start) => now - start < UPLOAD_WINDOW_MS).sort((a, b) => a - b);
  if (recent.length < UPLOADS_PER_WINDOW) return 0;
  const oldestThatMustAge = recent[recent.length - UPLOADS_PER_WINDOW];
  return Math.max(0, Math.min(UPLOAD_WINDOW_MS, oldestThatMustAge + UPLOAD_WINDOW_MS + WINDOW_MARGIN_MS - now));
}

export type PluralForms = {
  zero?: string;
  one: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
};

/**
 * CLDR cardinal category, written out rather than taken from Intl.PluralRules
 * so the result does not depend on the JS engine's Intl build.
 */
function pluralCategory(language: string, n: number): keyof PluralForms {
  if (language === 'ar') {
    const mod100 = n % 100;
    if (n === 0) return 'zero';
    if (n === 1) return 'one';
    if (n === 2) return 'two';
    if (mod100 >= 3 && mod100 <= 10) return 'few';
    if (mod100 >= 11 && mod100 <= 99) return 'many';
    return 'other';
  }
  return n === 1 ? 'one' : 'other';
}

/** `{n}` in the chosen form becomes the count. */
export function countPhrase(language: string, forms: PluralForms, n: number): string {
  const form = forms[pluralCategory(language, n)] ?? forms.other;
  return form.replace(/\{n\}/g, String(n));
}
