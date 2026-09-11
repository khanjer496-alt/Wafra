'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');

function harness() {
  let interpreterCalls = 0;
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
    },
    '@/lib/sms-parser': { parseSmsBatch: () => [] },
    '@/lib/currency-metadata': {
      CURRENCY_SYMBOL_CANDIDATES: { '$': ['USD'] },
      currencyMinorUnits: code => code === 'AED' || code === 'USD' ? 2 : null,
    },
    '@/lib/universal-parser': { inspectUniversalBankEvent: () => ({ decision: 'ignored' }) },
  });
  return { module, calls: () => interpreterCalls };
}

test('ordinary personal SMS bypasses the heavy launch bank parser', () => {
  const h = harness();
  const session = h.module.createLaunchAlertSession({ overrides: {} });
  assert.equal(session.parse('Dinner moved to seven tonight', 'Friend'), null);
  assert.equal(h.calls(), 0);
});

test('known bank sender still reaches the parser without an explicit currency', () => {
  const h = harness();
  const session = h.module.createLaunchAlertSession({ overrides: {} });
  session.parse('Your card purchase was approved', 'FAB');
  assert.equal(h.calls(), 1);
});

test('currency-bearing launch alert still reaches the parser', () => {
  const h = harness();
  const session = h.module.createLaunchAlertSession({ overrides: {} });
  session.parse('Purchase of AED 20.00 at TEST SHOP', 'Unknown');
  assert.equal(h.calls(), 1);
});

test('known global institution sender remains eligible for review routing', () => {
  const h = harness();
  assert.equal(h.module.hasGenericBankAlertContext('Account update', 'CHASE'), true);
});
