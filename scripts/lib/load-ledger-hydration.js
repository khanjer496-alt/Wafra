const path = require('node:path');

/**
 * Load shipping migrations through the same platform boundary used by the
 * store regression tests. Keeping a second import/stub table here let corpus
 * audits drift whenever the store gained a native adapter or pure helper.
 * No provider is mounted and no ledger is read or written by this loader.
 */
module.exports = function loadLedgerHydration(root) {
  const { loadStore } = require(path.join(root, 'scripts/perf/load-store.cjs'));
  const { migratePersistedState, finalizeHydrationTransactions } = loadStore().store;
  if (typeof migratePersistedState !== 'function' || typeof finalizeHydrationTransactions !== 'function') {
    throw new Error('Store hydration exports are unavailable');
  }
  return { migratePersistedState, finalizeHydrationTransactions };
};
