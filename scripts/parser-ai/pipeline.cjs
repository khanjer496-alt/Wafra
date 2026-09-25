'use strict';
/**
 * Adapter that runs the CURRENT deterministic pipeline exactly as capture does
 * and maps its output onto the benchmark label vocabulary (schema.cjs).
 *
 * Two tracks are scored:
 *  - ledger:     createLaunchAlertSession, called the way historical-import.ts
 *                does (parse for AE/SA or unrouted, parseUnproven for foreign
 *                issuers/routes), best-effort auto-post ON, ledger pinned to
 *                the user's local currency, a rate-1 FX stub so a missing
 *                cached rate is never the reason for a refusal.
 *  - extraction: inspectUniversalBankEvent with the user's date order — the
 *                structured reader that feeds Review and best-effort posting.
 *
 * The real source is transpiled in memory (scripts/universal-test/load-ts.cjs).
 */
const path = require('node:path');
const { createLoader } = require('../universal-test/load-ts.cjs');
const { COUNTRY_CURRENCY } = require('./schema.cjs');

const load = createLoader();
const launch = load('@/lib/launch-alert-parser');
const universal = load('@/lib/universal-parser');
const markets = load('@/lib/markets');
const country = load('@/lib/country');
const currencyMeta = load('@/lib/currency-metadata');
const grammars = load('@/lib/alert-institution-grammars');
const universalCategorization = load('@/lib/universal-categorization');

/** Fixed "now" after every dated fixture, so dates are never future-refused. */
const OBSERVED_AT = Date.parse('2026-09-25T12:00:00Z');
const fxStub = (base, quote, date) => ({ base, quote, rate: 1, date });

const PLACEHOLDER_MERCHANTS = new Set(['Account debit', 'Incoming transfer', 'Outgoing transfer', 'Refund', 'ATM withdrawal']);

const UNIVERSAL_FAMILY = {
  purchase: 'purchase', transfer: 'transfer', 'cash-withdrawal': 'withdrawal', refund: 'refund', fee: 'fee',
  utility: 'bill-payment', 'recurring-payment': 'bill-payment', bill: 'bill-payment', 'card-payment': 'card-payment',
};

function setUser(countryCode) {
  const currency = COUNTRY_CURRENCY[countryCode] ?? null;
  const exponent = currency ? currencyMeta.currencyMinorUnits(currency) ?? 2 : 2;
  markets.setLedgerCurrency(currency, exponent);
  country.setActiveCountry(countryCode === 'ZZ' ? null : countryCode);
  if (countryCode === 'AE' || countryCode === 'SA') markets.setActiveMarket(countryCode);
  else markets.setActiveMarket('AE');
  return currency;
}

function ledgerFamily(parsed) {
  const fmt = parsed.bestEffort?.format;
  if (fmt) {
    const fam = fmt.split(':')[1];
    return UNIVERSAL_FAMILY[fam] ?? 'purchase';
  }
  if (parsed.kind === 'cardPayment') return 'card-payment';
  if (parsed.categoryGuess === 'cash-withdrawal') return 'withdrawal';
  if (parsed.categoryGuess === 'salary') return 'salary';
  if (parsed.transferHint || /transfer/i.test(parsed.merchant)) return 'transfer';
  if (parsed.type === 'income') return parsed.merchant === 'Refund' ? 'refund' : 'transfer';
  if (parsed.categoryGuess === 'utilities' || parsed.categoryGuess === 'telecom') return 'bill-payment';
  return 'purchase';
}

/** Run the production ledger decision for one row. */
function runLedger(row) {
  const pinned = setUser(row.country);
  const activeMarket = row.country === 'SA' ? 'SA' : 'AE';
  const session = launch.createLaunchAlertSession({
    overrides: {}, pinnedCurrency: pinned, activeMarket, fxLookup: fxStub,
    bestEffort: { enabled: true, country: row.country === 'ZZ' ? null : row.country },
  });
  const sender = row.sender ?? '';
  let parsed = null;
  try {
    const inspection = session.inspect(row.body, sender);
    const foreignIssuer = !markets.detectLaunchMarketFromSender(sender) && grammars.hasUniversalInstitutionSender(sender);
    const foreignRoute = inspection?.route.decision === 'single' &&
      inspection.route.market !== 'AE' && inspection.route.market !== 'SA';
    parsed = foreignIssuer || foreignRoute
      ? session.parseUnproven(row.body, sender, inspection, OBSERVED_AT)
      : session.parse(row.body, sender, inspection, undefined, OBSERVED_AT);
  } catch (error) {
    return { posted: false, error: String(error && error.message || error) };
  }
  if (!parsed || (parsed.kind !== 'transaction' && parsed.kind !== 'cardPayment')) {
    return { posted: false, kind: parsed?.kind ?? null };
  }
  const amount = parsed.originalCurrency && Number.isFinite(parsed.originalMinorUnits)
    ? { minor: String(parsed.originalMinorUnits), currency: parsed.originalCurrency }
    : { minor: String(parsed.amountFils), currency: parsed.currency };
  return {
    posted: true,
    bestEffort: !!parsed.bestEffort,
    amount,
    direction: parsed.type === 'income' ? 'credit' : 'debit',
    merchant: PLACEHOLDER_MERCHANTS.has(parsed.merchant) ? null : parsed.merchant,
    date: parsed.date ?? null,
    family: ledgerFamily(parsed),
    category: parsed.categoryGuess,
  };
}

function statusOf(event) {
  const issues = new Set(event.issues);
  if (issues.has('authentication-not-posting') || event.family === 'authentication') return 'otp';
  if (issues.has('promotion-not-posting')) return 'promo';
  if (issues.has('pending-not-posting')) return 'pending';
  switch (event.status) {
    case 'posted': return 'completed';
    case 'failed': return 'declined';
    case 'future': return 'future';
    case 'informational': return 'informational';
    default: return 'unknown';
  }
}

/** Run the structured universal reader for one row. */
function runExtraction(row) {
  setUser(row.country);
  let event;
  try {
    event = universal.inspectUniversalBankEvent(row.body, {
      sender: row.sender ?? '', dateOrder: country.activeCountryDateOrder(),
    });
  } catch (error) {
    return { error: String(error && error.message || error) };
  }
  const status = statusOf(event);
  const money = event.amount.evidence === 'explicit' ? event.amount.value : null;
  const family = status === 'completed' ? UNIVERSAL_FAMILY[event.family] ?? 'non-posting' : 'non-posting';
  return {
    status,
    family,
    direction: event.direction === 'debit' || event.direction === 'credit' ? event.direction : 'none',
    amount: money ? { minor: money.minorUnits, currency: money.currency } : null,
    merchant: event.merchant.evidence === 'explicit' ? event.merchant.value : null,
    date: event.transactionDate.evidence === 'explicit' ? event.transactionDate.value : null,
    event,
  };
}

/** Current merchant -> category vocabulary (global, market-aware for AE/SA). */
function categorize(merchant, market) {
  return universalCategorization.categorizeMerchant({ merchant, type: 'expense', meaning: 'purchase', market });
}

module.exports = { runLedger, runExtraction, categorize, OBSERVED_AT, root: path.resolve(__dirname, '../..') };
