'use strict';
/** Shared across every module that requires the expo-crypto stub. */
let expoCryptoIssued = 0;
/** Keys a module system reads off any namespace object; never a crypto call. */
const INTEROP_PROBES = new Set([
  '__esModule', 'default', 'then', 'constructor', 'prototype', 'valueOf', 'toString',
  'toJSON', 'inspect', 'nodeType', '$$typeof',
]);

const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

/** Execute actual checked-in source; stubs are explicit native/UI boundaries. */
module.exports = function loadTypescript(file, dependencies = {}, globals = {}) {
  const source = fs.readFileSync(file, 'utf8');
  const result = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      isolatedModules: true,
    },
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => '\n',
  }));
  const exports = {};
  const module = { exports };
  vm.runInNewContext(result.outputText, {
    exports, module,
    require: (name) => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      // UI/parser repair harnesses isolate their own subject and intentionally
      // do not execute foreground scheduling. The scheduling suite supplies an
      // explicit counted stub; unrelated harnesses get an inert boundary so a
      // new maintenance-priority import does not make dozens of UI tests model
      // timers they do not own.
      if (name === '@/lib/foreground-history-priority') {
        return {
          prioritizeForegroundNavigation() {},
          waitForForegroundHistoryIdle: async () => {},
        };
      }
      // ledger.ts needs only the pure completion predicate from history-import.
      // UI/repair harnesses that do not exercise the history coordinator should
      // not have to model its native scheduling graph just to read ledger math.
      if (name === '@/lib/history-import') {
        return {
          historyImportIncomplete: progress => !!progress && progress.status !== 'complete',
        };
      }
      // Runtime performance breadcrumbs are observational only. Repair/UI
      // harnesses exercise the shipping computation and interaction paths,
      // not the diagnostics collector, so keep timing transparent unless a
      // test explicitly provides its own counted implementation.
      if (name === '@/lib/runtime-performance') {
        return {
          recordRuntimeInteraction() {},
          recordRuntimeOperation() {},
          measureRuntimeOperation: (_tag, work) => work(),
          measureRuntimeOperationAsync: async (_tag, work) => work(),
        };
      }
      // Recap discovery is a Home presentation enhancement. Unless a recap
      // test supplies the real module, unrelated repair harnesses keep it
      // dormant so they can continue isolating their own screen behavior.
      if (name === '@/lib/recap') {
        return {
          hasRecapActivity: () => false,
          recapCandidates: () => [],
        };
      }
      if (name === '@/lib/recap-view-state') {
        return { loadViewedRecaps: async () => new Set() };
      }
      // The onboarding gate mints a session id for a statement import. These
      // harnesses drive navigation and timing, not identity, so a counter keeps
      // them reproducible while still handing back a real UUID shape — a random
      // one would make every assertion that carries the id unstable.
      //
      // The counter is MODULE-WIDE, not per require. Scoped inside this branch
      // it gave every requiring module its own, so two modules in one harness
      // both minted `...000000000001` and a test that told sessions apart by id
      // could not fail. Ids are unique across the process, as real ones are.
      //
      // Anything this does not stub throws by name rather than arriving as
      // `undefined` and failing later as "not a function" somewhere unrelated —
      // the same contract as the unstubbed-dependency error below.
      if (name === 'expo-crypto') {
        return new Proxy({
          randomUUID: () => {
            expoCryptoIssued += 1;
            return `00000000-0000-4000-8000-${String(expoCryptoIssued).padStart(12, '0')}`;
          },
          getRandomValues: (array) => {
            for (let index = 0; index < array.length; index += 1) {
              expoCryptoIssued += 1;
              array[index] = expoCryptoIssued % 256;
            }
            return array;
          },
        }, {
          get(target, property) {
            if (property in target) return target[property];
            // Interop and introspection probes are not member access and must
            // answer undefined: TypeScript's __importStar reads `__esModule`
            // off every namespace import, and `await` reads `then`. Throwing on
            // those turned the whole gate into an unloadable module.
            if (typeof property === 'symbol' || INTEROP_PROBES.has(property)) return undefined;
            throw new Error(`Unstubbed expo-crypto member ${String(property)} in ${file}`);
          },
        });
      }
      throw new Error(`Unstubbed runtime dependency ${name} in ${file}`);
    },
    console, setTimeout, clearTimeout,
    requestAnimationFrame: callback => { callback(Date.now()); return 1; },
    cancelAnimationFrame() {},
    Date, Set, Map, Number, Math, Promise,
    process: { env: {} },
    ...globals,
  }, { filename: file });
  return module.exports;
};
