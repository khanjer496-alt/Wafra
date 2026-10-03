'use strict';
/**
 * Score model predictions (probe/train.py output) with the SAME scorer as the
 * rule baseline, after a deterministic verification gate:
 *
 *  - the AMT span must parse as a number in the text, with the currency's own
 *    exponent (no invented digits);
 *  - the CUR span must map to exactly one ISO currency (shared symbols such as
 *    $, Rs, R, N, درهم resolve only through the user's own country);
 *  - status head = completed, family != non-posting, and the direction head
 *    must agree with the family (purchase/fee/withdrawal/bill = debit;
 *    refund/salary = credit);
 *  - modelGuard: the existing rule wording guard (hasNonCompletedWording) vetoes;
 *  - modelStrict: guard + the direction must match a tagged in-text cue.
 *
 * Variants reported: model-only, modelGuard, modelStrict, and hybrid (rules first, model
 * fills only what the rules did not post, guard on).
 *
 *   node scripts/parser-ai/probe-score.cjs <rows.jsonl> <pred.jsonl> [--json out]
 */
const fs = require('node:fs');
const { createLoader } = require('../universal-test/load-ts.cjs');
const { runLedger, runExtraction } = require('./pipeline.cjs');
const { newBucket, scoreRow, summarize } = require('./score.cjs');

const load = createLoader();
const bestEffort = load('@/lib/best-effort-autopost');
const country = load('@/lib/country');
const currencyMeta = load('@/lib/currency-metadata');

const ISO = /^[A-Z]{3}$/;
const ALIASES = {
  '€': 'EUR', '£': 'GBP', '₹': 'INR', 'R$': 'BRL', RM: 'MYR', Rp: 'IDR', Ksh: 'KES', KSh: 'KES', '₦': 'NGN', '₱': 'PHP',
  S$: 'SGD', A$: 'AUD', CA$: 'CAD', US$: 'USD', TL: 'TRY', '₺': 'TRY', 'Fr.': 'CHF', KD: 'KWD', SR: 'SAR', Dhs: 'AED',
  LE: 'EGP', DH: 'MAD', MN: 'MXN', 'د.إ': 'AED', 'ر.س': 'SAR', 'ج.م': 'EGP', 'د.ك': 'KWD', 'ر.ق': 'QAR', 'د.ب': 'BHD', 'ر.ع': 'OMR', 'د.أ': 'JOD',
  Bt: 'THB', '¥': null, '$': null, Rs: null, 'Rs.': null,
};
const COUNTRY_ONLY = { R: { ZA: 'ZAR' }, N: { NG: 'NGN' }, P: { PH: 'PHP' }, 'ريال': { SA: 'SAR', QA: 'QAR', OM: 'OMR' }, 'درهم': { AE: 'AED', MA: 'MAD' } };

function resolveCurrency(text, cc) {
  const t = (text ?? '').trim();
  if (!t) return null;
  if (ISO.test(t.toUpperCase()) && currencyMeta.currencyMinorUnits(t.toUpperCase()) !== null) return t.toUpperCase();
  if (t in COUNTRY_ONLY) return COUNTRY_ONLY[t][cc] ?? null;
  if (t in ALIASES) return ALIASES[t] ?? bestEffort.sharedSymbolCurrencyForCountry(cc);
  const ci = Object.keys(ALIASES).find((k) => k.toLowerCase() === t.toLowerCase());
  return ci ? ALIASES[ci] ?? bestEffort.sharedSymbolCurrencyForCountry(cc) : null;
}

const AR = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '٫': '.', '٬': ',' };
function parseAmount(text, exponent) {
  let t = [...(text ?? '')].map((c) => AR[c] ?? c).join('').replace(/[\s  ']/g, '');
  t = t.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  if (!/^\d[\d.,]*$/.test(t)) return null;
  const m = t.match(/^(.*?)([.,])(\d+)$/);
  let int = t; let frac = '';
  if (m) {
    const digits = m[3].length;
    const multiSep = (m[1].match(/[.,]/g) ?? []).length > 0;
    const sameSepBefore = m[1].includes(m[2]);
    const isDecimal = !sameSepBefore && (digits === exponent || (digits <= 2 && digits !== 3) || (exponent === 3 && digits === 3 && !multiSep));
    if (isDecimal) { int = m[1]; frac = m[3]; }
  }
  if (frac.length > exponent) return null;
  int = int.replace(/[.,]/g, '');
  if (!/^\d+$/.test(int)) return null;
  return (BigInt(int) * 10n ** BigInt(exponent) + BigInt((frac || '0').padEnd(exponent, '0') || '0')).toString();
}

const MONTHS = {};
const add = (list) => list.forEach((m, i) => { MONTHS[m.toLowerCase().replace(/\.$/, '')] = i + 1; });
add(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']);
add(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']);
add(['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc']);
add(['jan', 'feb', 'märz', 'apr', 'mai', 'juni', 'juli', 'aug', 'sep', 'okt', 'nov', 'dez']);
add(['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']);
add(['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']);
add(['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']);
add(['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']);
add(['oca', 'şub', 'mar', 'nis', 'may', 'haz', 'tem', 'ağu', 'eyl', 'eki', 'kas', 'ara']);
add(['jan', 'feb', 'mar', 'apr', 'mei', 'jun', 'jul', 'agu', 'sep', 'okt', 'nov', 'des']);
add(['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']);
const iso = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null);
function parseDate(text, cc) {
  const t = [...(text ?? '')].map((c) => AR[c] ?? c).join('').trim().replace(/,/g, '');
  const year = (y) => (y.length === 2 ? 2000 + Number(y) : Number(y));
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) {
    const order = country.dateOrderForCountry(cc) ?? 'DMY';
    return order === 'MDY' ? iso(year(m[3]), Number(m[1]), Number(m[2])) : iso(year(m[3]), Number(m[2]), Number(m[1]));
  }
  m = t.match(/^(\d{1,2})[-\s]?([^\d\s-]+)\.?[-\s]?(\d{2}|\d{4})$/u);
  if (m && MONTHS[m[2].toLowerCase().replace(/\.$/, '')]) return iso(year(m[3]), MONTHS[m[2].toLowerCase().replace(/\.$/, '')], Number(m[1]));
  m = t.match(/^([^\d\s]+)\.?\s(\d{1,2})\s(\d{4})$/u);
  if (m && MONTHS[m[1].toLowerCase().replace(/\.$/, '')]) return iso(Number(m[3]), MONTHS[m[1].toLowerCase().replace(/\.$/, '')], Number(m[2]));
  return null;
}

const DEBIT_FAMILIES = new Set(['purchase', 'fee', 'withdrawal', 'bill-payment']);
const CREDIT_FAMILIES = new Set(['refund', 'salary']);

/**
 * The direction head must be corroborated by a tagged in-text cue of the same
 * polarity (and no cue of the other polarity), so direction is grounded too.
 */
const cueAgrees = (pred) => {
  const debit = pred.spans.some((s) => s.label === 'CUE_DEBIT');
  const credit = pred.spans.some((s) => s.label === 'CUE_CREDIT');
  return pred.direction === 'debit' ? debit && !credit : pred.direction === 'credit' ? credit && !debit : false;
};

/** Model prediction -> ledger-shaped decision with the deterministic gate. */
function assemble(row, pred, { guard, cue = false }) {
  const first = (label) => pred.spans.find((s) => s.label === label);
  const amt = first('AMT');
  const cur = first('CUR');
  const currency = cur ? resolveCurrency(cur.text, row.country) : null;
  const exponent = currency ? currencyMeta.currencyMinorUnits(currency) : null;
  const minor = amt && exponent !== null ? parseAmount(amt.text, exponent) : null;
  const amount = minor && currency ? { minor, currency } : null;
  const mer = first('MER');
  const date = first('DATE');
  const extraction = {
    status: pred.status, family: pred.status === 'completed' ? pred.family : 'non-posting', direction: pred.direction,
    amount, merchant: mer ? mer.text : null, date: date ? parseDate(date.text, row.country) : null,
  };
  let reason = null;
  if (pred.status !== 'completed' || pred.family === 'non-posting') reason = 'not-completed';
  else if (!amount) reason = amt ? 'currency-or-amount-unverified' : 'no-amount';
  else if (pred.direction === 'none' || (DEBIT_FAMILIES.has(pred.family) && pred.direction !== 'debit') ||
    (CREDIT_FAMILIES.has(pred.family) && pred.direction !== 'credit')) reason = 'direction-conflict';
  else if (pred.spans.filter((s) => s.label === 'AMT').length > 1) reason = 'competing-amounts';
  else if (cue && !cueAgrees(pred)) reason = 'direction-cue-disagrees';
  else if (guard && bestEffort.hasNonCompletedWording(row.body)) reason = 'wording-guard';
  const ledger = reason ? { posted: false, reason } : {
    posted: true, amount, direction: pred.direction,
    merchant: ['purchase', 'refund', 'bill-payment'].includes(pred.family) ? extraction.merchant : null,
    date: extraction.date, family: pred.family,
  };
  return { ledger, extraction };
}

function scoreAll(rows, preds) {
  const byId = new Map(preds.map((p) => [p.id, p]));
  const variants = { rules: {}, model: {}, modelGuard: {}, modelStrict: {}, hybrid: {} };
  const bucket = (variant, key) => (variants[variant][key] ??= newBucket());
  const reasons = {};
  for (const row of rows) {
    const pred = byId.get(row.id);
    if (!pred) continue;
    const rulesLedger = runLedger(row);
    const rulesExtraction = runExtraction(row);
    const m = assemble(row, pred, { guard: false });
    const g = assemble(row, pred, { guard: true });
    const st = assemble(row, pred, { guard: true, cue: true });
    const hybridLedger = rulesLedger.posted ? rulesLedger : g.ledger;
    if (!g.ledger.posted) reasons[g.ledger.reason] = (reasons[g.ledger.reason] ?? 0) + 1;
    for (const key of ['all', `lang:${row.language}`, `country:${row.country}`]) {
      scoreRow(bucket('rules', key), row, rulesLedger, rulesExtraction);
      scoreRow(bucket('model', key), row, m.ledger, m.extraction);
      scoreRow(bucket('modelGuard', key), row, g.ledger, g.extraction);
      scoreRow(bucket('modelStrict', key), row, st.ledger, st.extraction);
      scoreRow(bucket('hybrid', key), row, hybridLedger, g.extraction);
    }
  }
  const out = {};
  for (const [variant, buckets] of Object.entries(variants)) {
    out[variant] = Object.fromEntries(Object.entries(buckets).map(([k, b]) => [k, summarize(b)]));
  }
  out.modelGuardRefusalReasons = reasons;
  return out;
}

module.exports = { assemble, scoreAll, parseAmount, parseDate, resolveCurrency };

if (require.main === module) {
  const [rowsPath, predPath] = process.argv.slice(2);
  const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
  const read = (p) => fs.readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const result = scoreAll(read(rowsPath), read(predPath));
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(result, null, 1) + '\n');
  for (const v of ['rules', 'model', 'modelGuard', 'modelStrict', 'hybrid']) {
    const s = result[v].all;
    console.log(v.padEnd(10), JSON.stringify({ recall: s.ledger.autoPostRecall, falsePost: s.ledger.falsePostRate, fp: s.ledger.falsePosts,
      precision: s.ledger.postedPrecision, e2e: s.ledger.endToEnd, amt: s.ledger.fieldsOnCorrectPosts.amount.acc,
      xStatus: s.extraction.status.acc, xAmt: s.extraction.amount.acc, xMer: s.extraction.merchantStrict.acc, xMerL: s.extraction.merchantLoose.acc, xDate: s.extraction.date.acc, xFam: s.extraction.family.acc }));
  }
  console.log(JSON.stringify(result.modelGuardRefusalReasons));
}
