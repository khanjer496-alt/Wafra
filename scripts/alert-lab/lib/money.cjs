'use strict';
// Locale money rendering. A style is the full surface of one written amount:
// where the currency token sits, the space between token and figure, the
// decimal mark, the grouping mark, and the digit script. Exponent comes from
// the currency (KWD/BHD/OMR/JOD 3, IQD/JPY 0, the rest 2), never the style.

const NBSP = ' ';
const NNBSP = ' ';
const EXPONENT = { KWD: 3, BHD: 3, OMR: 3, JOD: 3, IQD: 0, JPY: 0 };
const exponentOf = (currency) => EXPONENT[currency] ?? 2;

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const toArabicDigits = (s) => s.replace(/[0-9]/g, (d) => ARABIC_DIGITS[Number(d)]).replace(/\./g, '٫').replace(/,/g, '٬');

/**
 * Build a style. `tok` is the literal currency token as printed; `cur` is the
 * ISO code it means in this market (so "$" can mean USD or CAD).
 */
const S = (pos, tok, sp, dec, grp, extra = {}) => ({
  pos, tok, sp, dec, grp,
  script: /[؀-ۿ]/.test(tok) ? 'ar' : 'latin',
  ...extra,
  id: `${pos}|${tok}|${JSON.stringify(sp)}|${dec}|${JSON.stringify(grp)}${extra.trim ? '|trim' : ''}${extra.digits === 'arabic' ? '|arabic-digits' : ''}${extra.signOut ? '|sign-out' : ''}`,
});

function figure(minor, exp, dec, grp, trim) {
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const unit = 10 ** exp;
  const int = Math.floor(abs / unit);
  const frac = abs % unit;
  let intText = String(int);
  if (grp) intText = intText.replace(/\B(?=(\d{3})+(?!\d))/g, grp);
  let text = intText;
  if (exp > 0 && !(trim && frac === 0)) text += dec + String(frac).padStart(exp, '0');
  return { neg, text };
}

/** Render minor units in a style; `sign` is '', '-' or '+'. */
function formatMoney(minor, exp, style, sign = '') {
  const f = figure(minor, exp, style.dec, style.grp, style.trim);
  let num = f.text;
  if (style.digits === 'arabic') num = toArabicDigits(num);
  if (style.pos === 'pre') {
    return style.signOut ? `${sign}${style.tok}${style.sp}${num}` : `${style.tok}${style.sp}${sign}${num}`;
  }
  return `${sign}${num}${style.sp}${style.tok}`;
}

module.exports = { S, formatMoney, exponentOf, NBSP, NNBSP };
