'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const file = path.resolve(__dirname, '../../../src/components/ui/merchant-logo-assets.ts');
const deps = {};
for (const [i, match] of [...fs.readFileSync(file, 'utf8').matchAll(/require\('([^']+\.png)'\)/g)].entries()) deps[match[1]] = i + 1;
const { merchantLogoFor, merchantLogoDecision } = load(file, deps);
test('punctuated host/path or control characters cannot impersonate a logo alias', () => {
  for (const title of ['amazon.ae.dubai', 'apple.com/bill/123', 'Netflix.com/999', 'Google.One.AE', 'Careem\nDubai', 'Talabat\u202e', 'PayPal *Talabat', 'Lulu Exchange', 'Noon One Cafe']) {
    assert.equal(merchantLogoFor(title), null, title);
  }
});
test('legitimate exact aliases and separately stated terminal tails remain supported with diagnostic reasons', () => {
  assert.equal(merchantLogoDecision('Amazon.ae').reason, 'exact-alias');
  assert.equal(merchantLogoDecision('Amazon.ae Dubai').reason, 'location-or-terminal');
  assert.equal(merchantLogoFor('CARREFOUR HYPER #004 DUBAI ARE').id, 'carrefour');
  assert.equal(merchantLogoFor('Apple.com/bill').id, 'apple');
  assert.equal(merchantLogoFor('Noon One').id, 'noon');
});
