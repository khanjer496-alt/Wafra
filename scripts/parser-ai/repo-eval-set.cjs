'use strict';
/**
 * Build the labelled evaluation set from privacy-safe fixtures already in the
 * repository (schema.cjs). Nothing here is real user text: every source file
 * is either synthetic, standard-derived or redacted public evidence.
 *
 * Labels are taken from each fixture's own TRUE expectation (never from a
 * `knownGap`, which records today's behaviour rather than the truth).
 */
const path = require('node:path');
const { COUNTRY_CURRENCY } = require('./schema.cjs');

const root = path.resolve(__dirname, '../..');
const req = (p) => require(path.join(root, p));
const exponentOf = (currency) => (['KWD', 'BHD', 'OMR', 'JOD', 'TND', 'IQD', 'LYD'].includes(currency) ? 3
  : ['JPY', 'KRW', 'CLP', 'VND', 'IDR'].includes(currency) ? 0 : 2);

const MOVE_FAMILY = {
  purchase: 'purchase', transfer: 'transfer', 'cash-withdrawal': 'withdrawal', refund: 'refund', fee: 'fee',
  utility: 'bill-payment', 'recurring-payment': 'bill-payment', bill: 'bill-payment', 'card-payment': 'card-payment',
};

const marketStatus = (status, family) => {
  if (status === 'posted') return 'completed';
  if (status === 'failed') return 'declined';
  if (status === 'future') return 'future';
  if (status === 'informational') return family === 'authentication' ? 'otp' : 'informational';
  return 'unknown';
};

const LANG_BY_MARKET = { FR: 'fr', DE: 'de', ES: 'es', IT: 'it', NL: 'nl', BR: 'pt', MX: 'es', QA: 'ar', KW: 'ar', BH: 'ar', OM: 'ar', EG: 'ar', JO: 'ar' };
const guessLanguage = (body, market) => (/[؀-ۿ]/u.test(body)
  ? (/[A-Za-z]{4,}/.test(body.replace(/[A-Z]{3}/g, '')) ? 'mixed' : 'ar')
  : /[ऀ-ॿ]/u.test(body) ? 'hi' : LANG_BY_MARKET[market] ?? 'en');

function fromMarketFixture(r, source) {
  const e = r.expected;
  const status = marketStatus(e.status, e.family);
  const shouldPost = e.decision === 'review' && e.status === 'posted';
  return {
    id: `${source}:${r.id}`, source: `repo:${source}`, country: r.market, language: guessLanguage(r.body, r.market),
    bank: r.institution ?? null, sender: r.sender ?? '', template: `${source}:${r.id}`, split: 'eval', body: r.body,
    label: {
      status, shouldPost,
      family: shouldPost ? MOVE_FAMILY[e.family] ?? 'purchase' : 'non-posting',
      direction: shouldPost ? e.direction : 'none',
      amount: e.currency ? { minor: e.minorUnits, currency: e.currency, exponent: exponentOf(e.currency) } : undefined,
      date: 'transactionDate' in e ? e.transactionDate : undefined,
    },
  };
}

const LAUNCH_SENDER = { ENBD: 'EmiratesNBD', ADCB: 'ADCBAlert', FAB: 'FAB', Mashreq: 'MASHREQ', ADIB: 'ADIB', RAKBANK: 'RAKBANK', Liv: 'Liv', Wio: 'Wio', 'Bank Albilad': 'Bank Albilad' };
function fromLaunchFixture(r, source) {
  const x = r.expect;
  const income = x.type === 'income';
  return {
    id: `${source}:${r.id}`, source: `repo:${source}`, country: r.market, language: guessLanguage(r.body, r.market),
    bank: r.bank, sender: LAUNCH_SENDER[r.bank] ?? r.bank, template: `${source}:${r.id}`, split: 'eval', body: r.body,
    label: {
      status: 'completed', shouldPost: true,
      family: x.transferHint || (income && /transfer/i.test(x.merchant)) ? 'transfer' : income ? 'refund' : 'purchase',
      direction: income ? 'credit' : 'debit',
      // The fixture pins the ledger (AED/SAR) figure; a foreign original is not labelled.
      amount: r.id === 'wio-foreign-with-local-equivalent' || r.id === 'mashreq-foreign-compact-date' ? undefined
        : { minor: String(x.amountFils), currency: x.currency, exponent: 2 },
      merchant: /transfer/i.test(x.merchant) ? undefined : x.merchant,
      date: x.date,
    },
  };
}

const UE_STATUS = { posted: 'completed', failed: 'declined', future: 'future', informational: 'informational', unknown: 'unknown' };
function fromUniversalEvidence(r, source) {
  const e = r.expected;
  const mustNotPost = !!r.safety?.mustNotPost;
  const shouldPost = e.status === 'posted' && !mustNotPost;
  const amount = e['amount.value'];
  const status = e.family === 'authentication' ? 'otp'
    : e.status === 'posted' && mustNotPost ? 'unknown' : UE_STATUS[e.status] ?? 'unknown';
  return {
    id: `${source}:${r.id}`, source: `repo:${source}`, country: r.country === 'unknown' ? 'ZZ' : r.country,
    language: r.language, bank: null, sender: '', template: `${source}:${r.id}`, split: 'eval', body: r.body,
    label: {
      status, shouldPost,
      family: shouldPost ? undefined : 'non-posting',
      direction: shouldPost ? e.direction : 'none',
      amount: amount === undefined ? undefined : amount && { minor: amount.minorUnits, currency: amount.currency, exponent: amount.exponent },
      merchant: shouldPost && 'merchant.value' in e ? e['merchant.value'] : undefined,
      date: 'transactionDate.value' in e ? e['transactionDate.value'] : undefined,
    },
  };
}

/** local-ai-bank-v2 abstentions carry no status; these are read off each synthetic body. */
const BANK_V2_ABSTAIN_STATUS = {
  27: 'otp', 28: 'pending', 29: 'declined', 30: 'promo', 31: 'unknown', 32: 'informational', 33: 'otp', 34: 'pending',
  35: 'declined', 36: 'informational', 37: 'unknown', 38: 'otp', 39: 'pending', 40: 'unknown', 41: 'informational',
  42: 'otp', 43: 'pending', 44: 'unknown', 45: 'declined', 46: 'promo', 47: 'informational', 48: 'informational',
};
const V2_COUNTRY = { AED: 'AE', SAR: 'SA', KWD: 'KW', BHD: 'BH', OMR: 'OM', USD: 'US', GBP: 'GB' };
const EUR_COUNTRY = { fr: 'FR', es: 'ES', de: 'DE', mixed: 'FR', en: 'IE' };
const toAsciiDigits = (s) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
  .replace(/٫/g, '.').replace(/٬/g, ',');
function amountFromText(text, currency) {
  const exponent = exponentOf(currency);
  let t = toAsciiDigits(text).replace(/\s/g, '');
  // Decimal separator = the last '.' or ',' followed by exactly `exponent` digits.
  const m = t.match(/^(.*?)(?:[.,](\d+))?$/);
  let int = m[1];
  let frac = m[2] ?? '';
  if (frac.length !== exponent) { int = t; frac = ''; }
  int = int.replace(/[.,]/g, '');
  const minor = BigInt(int) * 10n ** BigInt(exponent) + BigInt((frac || '0').padEnd(exponent, '0').slice(0, exponent) || '0');
  return { minor: String(minor), currency, exponent };
}
function fromBankV2(r) {
  const e = r.expected;
  const n = Number(r.id.slice(-3));
  const candidate = e.decision === 'candidate';
  const cur = e.currency_text ?? (r.text.match(/\b(AED|SAR|KWD|BHD|OMR|USD|GBP|EUR)\b/) ?? [])[1] ?? 'AED';
  const country = cur === 'EUR' ? EUR_COUNTRY[r.language] : V2_COUNTRY[cur] ?? 'AE';
  return {
    id: `local-ai-bank-v2:${r.id}`, source: 'repo:local-ai-bank-v2', country, language: r.language, bank: null, sender: '',
    template: `local-ai-bank-v2:${r.id}`, split: 'eval', body: r.text,
    label: {
      status: candidate ? 'completed' : BANK_V2_ABSTAIN_STATUS[n] ?? 'unknown',
      shouldPost: candidate,
      family: candidate ? MOVE_FAMILY[e.family] ?? e.family : 'non-posting',
      direction: candidate ? e.direction : 'none',
      amount: candidate ? amountFromText(e.amount_text, e.currency_text) : undefined,
      merchant: candidate && ['purchase', 'refund'].includes(e.family) ? e.merchant_text : undefined,
    },
  };
}

function buildRepoEvalSet() {
  const rows = [];
  for (const r of req('scripts/test/fixtures/global-alert-formats.js')) rows.push(fromMarketFixture(r, 'global-alert-formats'));
  for (const r of req('scripts/test/fixtures/public-alert-evidence.js')) rows.push(fromMarketFixture(r, 'public-alert-evidence'));
  for (const r of req('scripts/test/fixtures/uae-bank-formats.js')) rows.push(fromLaunchFixture(r, 'uae-bank-formats'));
  for (const r of req('scripts/test/fixtures/saudi-bank-formats.js')) rows.push(fromLaunchFixture(r, 'saudi-bank-formats'));
  for (const [file, name] of [
    ['scripts/universal-evidence/independent-cases.json', 'universal-independent'],
    ['scripts/universal-evidence/public-cases.json', 'universal-public'],
    ['scripts/universal-evidence-round2/holdout.json', 'universal-round2-holdout'],
  ]) for (const r of req(file).parser) rows.push(fromUniversalEvidence(r, name));
  for (const r of req('scripts/test/fixtures/local-ai-bank-v2.json')) rows.push(fromBankV2(r));
  for (const r of rows) if (!(r.country in COUNTRY_CURRENCY) && r.country !== 'ZZ') throw new Error(`no currency for ${r.country}`);
  return rows;
}

module.exports = { buildRepoEvalSet, amountFromText, exponentOf };

if (require.main === module) {
  const rows = buildRepoEvalSet();
  const by = {};
  for (const r of rows) by[r.source] = (by[r.source] ?? 0) + 1;
  console.log(rows.length, by);
}
