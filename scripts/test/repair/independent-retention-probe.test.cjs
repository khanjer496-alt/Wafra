'use strict';
// Runs Reviewer's independent 59-source retention probe, byte-identical, in the
// hosted repair suite. The wrapper only sets the checkout root and refuses a
// probe whose bytes differ from the independently reviewed file.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const probe = path.join(__dirname, 'probes/reviewer-independent-retention.cjs');
// Reviewer probe, revised (3c8ecc0b): direct store stages pass 'hold-source' after
// CEO 4a8b6cee made strict deferral opt-in. Previous reviewed file 6e933e56….
const PINNED = '4a2c576633f65ce202a4973be31536246d380cadb6fb696d482520e58ea2e80e';
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(probe)).digest('hex'), PINNED,
  'the independent probe must stay byte-identical to the reviewed file');
process.env.WAFRA_ROOT ||= path.resolve(__dirname, '../../..');
require(probe);
