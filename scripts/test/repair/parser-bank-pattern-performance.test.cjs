'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const load = require('./load-typescript.cjs');
const file = path.resolve(__dirname, '../../../src/lib/markets.ts');

function loadObserved() {
  let constructions = 0;
  class ObservedRegExp extends RegExp {
    constructor(...args) { super(...args); constructions++; }
  }
  return { markets: load(file, {}, { RegExp: ObservedRegExp }), count: () => constructions };
}

// Equivalent uncached implementation from v47, retained only as a benchmark
// oracle. It uses the active pack's actual registry and identical matching rules.
function uncached(markets, text) {
  if (!text) return null;
  for (const bank of markets.getActiveMarket().banks) {
    const pattern = new RegExp(`(?:${bank.re.source})[^\\n]{0,16}?\\b(?:credit|debit|cr\\.?)\\s*card\\b`, 'i');
    if (pattern.test(text)) return { name: bank.name, color: bank.color, domain: bank.domain };
  }
  return null;
}
const messages = [
  'Emirates NBD Credit Card Mini Stmt for Card ending 1234',
  'Liv Credit Card ending 1234',
  'Purchase of AED 42.00 with Credit Card ending 1234 at CARREFOUR.',
  'Download the new FAB mobile banking app',
  'Payment received for your Al Rajhi credit card ending 5678',
  'FAB\nCredit Card', '', undefined,
];

test('bank identity matching reuses grammar across messages and market switches', () => {
  const observed = loadObserved();
  for (const id of ['AE', 'SA']) {
    observed.markets.setActiveMarket(id);
    for (const body of messages) observed.markets.bankFromMessage(body);
  }
  const warmCount = observed.count();
  for (const id of ['AE', 'SA', 'AE', 'SA']) {
    observed.markets.setActiveMarket(id);
    for (const body of messages) {
      assert.equal(JSON.stringify(observed.markets.bankFromMessage(body)), JSON.stringify(uncached(observed.markets, body)));
    }
  }
  assert.equal(observed.count(), warmCount, 'warm parsing must not rebuild each bank expression for every message');
});

test('report bank grammar reuse timing with identical identity results', () => {
  const markets = load(file);
  markets.setActiveMarket('AE');
  const rounds = 10000;
  const measure = fn => {
    let hits = 0; const start = performance.now();
    for (let i = 0; i < rounds; i++) if (fn(messages[i % messages.length])) hits++;
    return { ms: +(performance.now() - start).toFixed(2), hits };
  };
  measure(markets.bankFromMessage); measure(body => uncached(markets, body));
  const before = [], after = [];
  for (let i = 0; i < 3; i++) {
    const b = measure(body => uncached(markets, body)), a = measure(markets.bankFromMessage);
    assert.equal(a.hits, b.hits); before.push(b.ms); after.push(a.ms);
  }
  console.log(JSON.stringify({ scope: 'desktop Node bank identity lookup only', rounds, before, after }));
});
