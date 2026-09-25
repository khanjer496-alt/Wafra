/**
 * The in-app amount keypad's text model, kept pure so it can be tested
 * without a screen.
 *
 * The keypad writes a CANONICAL string — ASCII digits and at most one "."
 * — whatever the device's number conventions. That string is never handed to
 * the locale-aware typed-input parser (in a decimal-comma locale that parser
 * would read "12.5" as a digit group); it is converted here, digit by digit,
 * with no floating-point arithmetic anywhere.
 *
 * The currency's ISO exponent decides the shape: 0 (JPY) has no decimal key
 * at all, 2 (USD) accepts two decimals, 3 (KWD) three.
 */

export type KeypadDigit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
export type KeypadKey = KeypadDigit | 'decimal' | 'backspace';

/**
 * Whole-number digits the keypad accepts. 12 whole digits plus 3 decimals is
 * 15 significant digits, inside Number.MAX_SAFE_INTEGER (16 digits) with room
 * to spare, so every accepted string converts to an exact safe integer.
 */
export const KEYPAD_MAX_WHOLE_DIGITS = 12;

const CANONICAL = /^(?:0|[1-9]\d*)?(?:\.\d*)?$/;

/** Whether the currency has a decimal key at all. */
export function keypadHasDecimal(exponent: number): boolean {
  return Number.isInteger(exponent) && exponent > 0;
}

/**
 * The next keypad string after one key. Keys that would make the amount
 * invalid (a second ".", a decimal for a whole-unit currency, a digit past the
 * currency's exponent or past the whole-digit cap) leave it unchanged rather
 * than producing something the save path would later refuse.
 */
export function applyKeypadKey(text: string, key: KeypadKey, exponent: number): string {
  const current = CANONICAL.test(text) ? text : '';
  if (key === 'backspace') return current.slice(0, -1);
  if (key === 'decimal') {
    if (!keypadHasDecimal(exponent) || current.includes('.')) return current;
    return `${current === '' ? '0' : current}.`;
  }
  const point = current.indexOf('.');
  if (point >= 0) {
    const fraction = current.length - point - 1;
    return fraction >= exponent ? current : current + key;
  }
  // A lone leading zero is replaced, never extended: "0" then "5" is "5".
  if (current === '0') return key;
  if (current.length >= KEYPAD_MAX_WHOLE_DIGITS) return current;
  return current + key;
}

/**
 * Exact minor units for a keypad string, or null when it is empty, zero, or
 * not something the keypad could have produced for this exponent.
 * "18" → 1800 and "18.5" → 1850 at exponent 2; "1.234" → 1234 at 3; "1500"
 * → 1500 at 0.
 */
export function keypadMinorUnits(text: string, exponent: number): number | null {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 3) return null;
  if (!text || !CANONICAL.test(text)) return null;
  const point = text.indexOf('.');
  const whole = point >= 0 ? text.slice(0, point) : text;
  const fraction = point >= 0 ? text.slice(point + 1) : '';
  if (point >= 0 && exponent === 0) return null;
  if (fraction.length > exponent) return null;
  if (whole.length > KEYPAD_MAX_WHOLE_DIGITS) return null;
  const digits = `${whole}${fraction.padEnd(exponent, '0')}`.replace(/^0+/, '');
  if (digits === '') return null;
  const minor = Number.parseInt(digits, 10);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

/**
 * The keypad string for an amount already known in minor units — used when
 * someone switches from typing back to the keypad. Trailing zero decimals are
 * dropped ("18.00" becomes "18"); the value is unchanged.
 */
export function keypadTextFromMinor(minor: number | null | undefined, exponent: number): string {
  if (minor === null || minor === undefined || !Number.isSafeInteger(minor) || minor <= 0) return '';
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 3) return '';
  const digits = String(minor);
  if (exponent === 0) return digits.length > KEYPAD_MAX_WHOLE_DIGITS ? '' : digits;
  const padded = digits.padStart(exponent + 1, '0');
  const whole = padded.slice(0, padded.length - exponent);
  const fraction = padded.slice(padded.length - exponent).replace(/0+$/, '');
  if (whole.length > KEYPAD_MAX_WHOLE_DIGITS) return '';
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * How the keypad string reads on screen: whole digits grouped by the given
 * grouping function (the app's money formatter), the device decimal mark, and
 * the fraction exactly as typed so far — "18." stays "18." while the user is
 * between keys. Empty shows "0".
 */
export function keypadDisplay(
  text: string,
  groupWhole: (wholeDigits: string) => string,
  decimalMark: string,
): string {
  const current = CANONICAL.test(text) ? text : '';
  if (current === '') return groupWhole('0');
  const point = current.indexOf('.');
  const whole = point >= 0 ? current.slice(0, point) : current;
  const grouped = groupWhole(whole === '' ? '0' : whole);
  return point >= 0 ? `${grouped}${decimalMark}${current.slice(point + 1)}` : grouped;
}
