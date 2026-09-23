'use strict';
// Run after bash scripts/test/build.sh. Compare the same current parser with
// only v47's bank-name pattern construction restored. Fixtures are repository
// redacted/synthetic; no inbox contents are read or printed.
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const markets = require('../build/markets');
const { PARSER_VERSION } = require('../build/sms-parser');
const { createLaunchAlertSession } = require('../build/launch-alert-parser');
const fixtures = require('../fixtures/uae-bank-formats');
const optimized = markets.bankFromMessage;
function uncached(text) {
  if (!text) return null;
  for (const bank of markets.getActiveMarket().banks) {
    const pattern = new RegExp(`(?:${bank.re.source})[^\\n]{0,16}?\\b(?:credit|debit|cr\\.?)\\s*card\\b`, 'i');
    if (pattern.test(text)) return { name: bank.name, color: bank.color, domain: bank.domain };
  }
  return null;
}
const measure = (lookup, count, collect = false) => {
  markets.bankFromMessage = lookup;
  const session = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'AED', activeMarket: 'AE' });
  const results = []; let hits = 0;
  const started = performance.now();
  for (let i = 0; i < count; i++) {
    const row = fixtures[i % fixtures.length];
    const parsed = session.parse(row.body, row.bank);
    if (parsed) hits++;
    if (collect) results.push(parsed);
  }
  return { ms: +(performance.now() - started).toFixed(2), hits, results };
};
try {
  assert.deepEqual(measure(optimized, fixtures.length, true).results,
    measure(uncached, fixtures.length, true).results);
  const count = 10000, before = [], after = [];
  measure(optimized, count); measure(uncached, count);
  for (let i = 0; i < 5; i++) {
    const order = i % 2 ? [optimized, uncached] : [uncached, optimized];
    for (const lookup of order) {
      const result = measure(lookup, count);
      assert.equal(result.hits, count);
      (lookup === optimized ? after : before).push(result.ms);
    }
  }
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  console.log(JSON.stringify({ scope: 'desktop Node production parser; bank-pattern reuse only; nine UAE fixtures repeated',
    node: process.version, parserVersion: PARSER_VERSION, count, before, after,
    medianBeforeMs: median(before), medianAfterMs: median(after),
    improvementPercent: +((1 - median(after) / median(before)) * 100).toFixed(1) }, null, 2));
} finally { markets.bankFromMessage = optimized; }
