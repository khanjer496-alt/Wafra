'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const MARKETS = [
  { id: 'AE', currency: { code: 'AED' }, banks: [
    { name: 'Emirates NBD', domain: 'emiratesnbd.com', color: '#1' },
    { name: 'FAB', domain: 'bankfab.com', color: '#2' },
    { name: 'ADCB', domain: 'adcb.com', color: '#3' },
  ] },
  { id: 'SA', currency: { code: 'SAR' }, banks: [
    { name: 'Al Rajhi', domain: 'alrajhibank.com.sa', color: '#1' },
    { name: 'SNB AlAhli', domain: 'alahli.com', color: '#2' },
    { name: 'Riyad Bank', domain: 'riyadbank.com', color: '#3' },
  ] },
];

const api = load(path.join(root, 'src/lib/onboarding-bank-examples.ts'), {
  '@/lib/markets': { MARKETS },
});

test('device Region selects the matching onboarding bank examples', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(api.onboardingBankRegion('AE', 'GB'))),
    {
      id: 'GB', currency: 'GBP', banks: [
        { name: 'Barclays', domain: 'barclays.co.uk', color: '#00AEEF' },
        { name: 'HSBC', domain: 'hsbc.co.uk', color: '#DB0011' },
        { name: 'Lloyds Bank', domain: 'lloydsbank.com', color: '#006A4D' },
      ],
    },
  );
});

test('unsupported device Region stays neutral instead of inheriting the UAE parser fallback', () => {
  assert.equal(api.onboardingBankRegion('AE', 'CA'), null);
  assert.equal(api.onboardingBankRegion('SA', 'JP'), null);
});

test('UAE and Saudi examples reuse their real market-pack bank identities', () => {
  assert.deepEqual(api.onboardingBankRegion('SA', 'AE').banks.map(bank => bank.name),
    ['Emirates NBD', 'FAB', 'ADCB']);
  assert.deepEqual(api.onboardingBankRegion('AE', 'SA').banks.map(bank => bank.name),
    ['Al Rajhi', 'SNB AlAhli', 'Riyad Bank']);
});
