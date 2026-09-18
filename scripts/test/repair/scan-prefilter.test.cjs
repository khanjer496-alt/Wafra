'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');

function harness({ pinnedCurrency = 'AED', activeMarket = 'AE' } = {}) {
  let interpreterCalls = 0;
  let universalCalls = 0;
  const module = load(path.join(root, 'src/lib/launch-alert-parser.ts'), {
    '@/lib/alert-market-detection': { inspectUniversalAlert: () => null },
    '@/lib/alert-institution-grammars': {
      hasUniversalInstitutionSender: sender => sender === 'CHASE',
    },
    '@/lib/bank-alert-interpreter': {
      interpretBankAlert: () => {
        interpreterCalls += 1;
        return { outcome: 'ignored', reason: 'fixture' };
      },
    },
    '@/lib/markets': {
      detectLaunchMarketFromAlert: (source, sender) =>
        sender === 'FAB' || /AED/.test(source) ? 'AE' : null,
      detectLaunchMarketFromSender: sender => sender === 'FAB' ? 'AE' : null,
      getActiveMarket: () => ({ id: 'AE' }),
      pinnedLedgerCurrencyCode: () => 'AED',
      ledgerCurrencyExponent: () => 2,
    },
    '@/lib/sms-parser': { parseSmsBatch: () => [] },
    '@/lib/currency-metadata': {
      CURRENCY_SYMBOL_CANDIDATES: { '$': ['USD'] },
      currencyMinorUnits: code => code === 'AED' || code === 'USD' ? 2 : null,
    },
    '@/lib/universal-parser': { inspectUniversalBankEvent: () => {
      universalCalls += 1;
      return { decision: 'ignored' };
    } },
  });
  return { module, calls: () => interpreterCalls, universalCalls: () => universalCalls };
}

test('ordinary personal SMS bypasses the heavy launch bank parser', () => {
  const h = harness();
  const session = h.module.createLaunchAlertSession({ overrides: {} });
  assert.equal(session.parse('Dinner moved to seven tonight', 'Friend'), null);
  assert.equal(h.calls(), 0);
  assert.equal(h.universalCalls(), 0);
});

test('money-bearing service notice without posting evidence skips universal fallback', () => {
  const h = harness();
  const session = h.module.createLaunchAlertSession({ overrides: {} });
  assert.equal(session.parse('Your monthly statement is AED 250.00', 'Unknown'), null);
  assert.equal(h.universalCalls(), 0);
});

test('posted-event vocabulary still reaches universal fallback', () => {
  const h = harness({ pinnedCurrency: 'USD', activeMarket: 'US' });
  const session = h.module.createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'USD', activeMarket: 'US' });
  session.parse('USD 20.00 charged at TEST SHOP', 'Unknown');
  assert.equal(h.universalCalls(), 1);
});

test('known global institution sender bypasses cheap posting vocabulary gate', () => {
  const h = harness({ pinnedCurrency: 'USD', activeMarket: 'US' });
  const session = h.module.createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'USD', activeMarket: 'US' });
  session.parse('Account update: USD 20.00', 'CHASE');
  assert.equal(h.universalCalls(), 1);
});

test('known Gulf launch-bank field list cannot be resurrected by broad universal auto-posting', () => {
  const h = harness();
  const session = h.module.createLaunchAlertSession({ overrides: {} });
  session.parse('Cards ending 1234 AED 20.00 at TEST SHOP', 'FAB');
  assert.equal(h.calls(), 1);
  assert.equal(h.universalCalls(), 0);
});

test('known bank sender without money skips auto parsing and stays review-eligible', () => {
  const h = harness();
  const session = h.module.createLaunchAlertSession({ overrides: {} });
  assert.equal(session.parse('Your card purchase was approved', 'FAB'), null);
  assert.equal(h.calls(), 0);
  assert.equal(h.universalCalls(), 0);
  assert.equal(h.module.hasGenericBankAlertContext('Your card purchase was approved', 'FAB'), true);
});

test('currency-bearing Gulf alert reaches regional evidence without broad-parser resurrection', () => {
  const h = harness();
  const session = h.module.createLaunchAlertSession({ overrides: {} });
  session.parse('Purchase of AED 20.00 at TEST SHOP', 'Unknown');
  assert.equal(h.calls(), 1);
  assert.equal(h.universalCalls(), 0);
});

test('known global institution sender remains eligible for review routing', () => {
  const h = harness();
  assert.equal(h.module.hasGenericBankAlertContext('Account update', 'CHASE'), true);
});
