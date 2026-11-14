const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
assert.equal(fs.existsSync(path.resolve(__dirname, '../../src/lib/bank-logo-resolver.ts')), false, 'the remote resolver is absent from Wafra 1.0');
console.log('✓ bank-logo-resolver removed from store source');
