'use strict';
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
      // Statement import mints a session id with expo-crypto. Journey/repair
      // harnesses that load the gate do not own entropy; a stable UUID keeps
      // the authorized /statement-import handoff deterministic.
      if (name === 'expo-crypto') {
        return { randomUUID: () => 'test-statement-session' };
      }
      // The real known-banks module, compiled. import-plan asks it which bank
      // labels an account no alert named, and Wallet and Cards build their
      // "Set bank" picker from it, so a stub would answer the very questions
      // these harnesses check differently from the app. It is market tables and
      // pure functions — there is no native or UI boundary here to isolate.
      if (name === '@/lib/known-banks') return require('../build/known-banks');
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
