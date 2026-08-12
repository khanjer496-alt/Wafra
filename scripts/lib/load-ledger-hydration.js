const fs = require('fs');
const path = require('path');
const ts = require('typescript');

/**
 * Load Store's pure migration/hydration exports without mounting React Native.
 * Shipping ledger modules execute unchanged; only UI/lifecycle adapters that
 * cannot run in Node are replaced. This keeps local corpus audits on the same
 * migration path an installed app uses before it scans the inbox.
 */
module.exports = function loadLedgerHydration(root) {
  const filename = path.join(root, 'src/lib/store.tsx');
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const build = (name) => require(path.join(root, 'scripts/test/build', `${name}.js`));
  const modules = {
    'react/jsx-runtime': { jsx: () => ({}), jsxs: () => ({}), Fragment: Symbol('Fragment') },
    react: {
      createContext: () => ({}),
      useCallback: (fn) => fn,
      useContext: () => null,
      useEffect: () => {},
      useMemo: (fn) => fn(),
      useRef: (value) => ({ current: value }),
      useState: (value) => [value, () => {}],
    },
    'react-native': {
      AppState: { addEventListener: () => ({ remove() {} }) },
      I18nManager: { isRTL: false, allowRTL() {}, forceRTL() {} },
      Platform: { OS: 'web' },
    },
    '@/lib/theme-preference': { setThemePreference() {} },
    '@/lib/ledger-persistence': {
      createLedgerPersistence: () => ({ load: async () => null, save: async () => true }),
      LedgerResetError: class LedgerResetError extends Error {},
    },
    '@/lib/state-storage': { migrateLegacyState: async () => null, stateStorage: {} },
  };
  const resolve = (id) => {
    if (Object.hasOwn(modules, id)) return modules[id];
    if (id === './balances') return build('balances');
    if (id.startsWith('@/lib/')) return build(id.slice('@/lib/'.length));
    throw new Error(`Unexpected Store dependency in corpus audit: ${id}`);
  };
  const loaded = { exports: {} };
  Function('require', 'module', 'exports', '__filename', '__dirname', output)(
    resolve,
    loaded,
    loaded.exports,
    filename,
    path.dirname(filename),
  );
  const { migratePersistedState, finalizeHydrationTransactions } = loaded.exports;
  if (typeof migratePersistedState !== 'function' || typeof finalizeHydrationTransactions !== 'function') {
    throw new Error('Store hydration exports are unavailable');
  }
  return { migratePersistedState, finalizeHydrationTransactions };
};
