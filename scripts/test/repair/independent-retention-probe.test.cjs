'use strict';
// Runs Reviewer's independent 59-source retention probe, byte-identical, in the
// hosted repair suite. The wrapper only sets the checkout root and refuses a
// probe whose bytes differ from the independently reviewed file.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const probe = path.join(__dirname, 'probes/reviewer-independent-retention.cjs');
const PINNED = '6e933e562a084bb05cd9bc179f4e02e3e691973660a22687530700d9dc3f41d6';
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(probe)).digest('hex'), PINNED,
  'the independent probe must stay byte-identical to the reviewed file');
process.env.WAFRA_ROOT ||= path.resolve(__dirname, '../../..');
require(probe);
