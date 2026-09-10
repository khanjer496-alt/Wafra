'use strict';
// Shared actual-source graph for ledger tests; no money/ownership doubles.
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const markets = load(path.join(root, 'src/lib/markets.ts'));
const currency = load(path.join(root, 'src/lib/currency-metadata.ts'));
const dependencies = { '@/lib/markets': markets, '@/lib/currency-metadata': currency,
  '@noble/hashes/sha2.js': require('@noble/hashes/sha2.js'),
  '@noble/hashes/utils.js': require('@noble/hashes/utils.js') };
const core = load(path.join(root, 'src/lib/transfer-reconciliation.ts'), dependencies);
dependencies['@/lib/transfer-reconciliation'] = core;
const ledger = load(path.join(root, 'src/lib/ledger.ts'), dependencies);
module.exports = { ledger, core, markets, currency };
