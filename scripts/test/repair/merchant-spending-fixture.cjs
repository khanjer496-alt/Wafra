'use strict';
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
// Execute the actual accounting, period, format and projection modules.
// Only active UI currency (normally supplied by StoreProvider) is substituted.
module.exports = function fixture() {
  const dependencies = { '@/lib/markets': {
    ledgerCurrencyCode: () => 'AED', ledgerCurrencyDisplay: () => 'AED', ledgerCurrencyExponent: () => 2,
  } };
  dependencies['@/lib/transfer-reconciliation'] = require('./load-transfer-ledger.cjs').core;
  for (const name of ['i18n', 'currency-metadata', 'ledger-money', 'arabic-sms', 'format', 'period',
    'ledger', 'categories', 'splits', 'analytics', 'merchant-spending']) {
    dependencies[`@/lib/${name}`] = load(path.join(root, `src/lib/${name}.ts`), dependencies);
  }
  return dependencies;
};
