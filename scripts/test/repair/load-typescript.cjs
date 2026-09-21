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
      // The known-banks helpers decide which bank an account gets and which
      // accounts a setup answer relabels. They are pure, so every harness gets
      // the real compiled module rather than a stub that could drift from it.
      if (name === '@/lib/known-banks') {
        return require('../build/known-banks.js');
      }
      // The on-device semantic model is native-only and advisory. Screen and
      // journey harnesses get the same fail-closed behaviour the web build has:
      // the deterministic plan is returned unchanged and the runtime is never
      // ready. Harnesses that exercise the model supply their own module.
      // The universal extractor is pure and deterministic; harnesses that load
      // the capture path get the real compiled module, never a stub that could
      // drift from what ships. Shadow evaluation is observational only and
      // native-only, so it is inert here unless a harness supplies its own.
      if (name === '@/lib/universal-parser') {
        return require('../build/universal-parser.js');
      }
      if (name === '@/lib/universal-template-certification') {
        return require('../build/universal-template-certification.js');
      }
      if (name === '@/lib/local-semantic-shadow') {
        return {
          async observeLocalSemanticParserShadow() {},
          async hydrateLocalSemanticShadow() {},
          flushLocalSemanticShadowPersistence: async () => {},
          queueLocalSemanticParserShadow() {},
          async flushLocalSemanticParserShadow() {},
          buildLocalParserSemanticWindow: () => null,
          localSemanticShadowSnapshot: () => ({ schemaVersion: 1, observed: 0, modelUnavailable: 0, eligible: 0,
            canonicalAccepted: 0, learnedAccepted: 0, hybridAccepted: 0, bothAccepted: 0, modelAgreement: 0,
            deterministicComparable: 0, canonicalDeterministicAgreement: 0, learnedDeterministicAgreement: 0,
            hybridDeterministicAgreement: 0, byDeterministicFamily: {}, byCanonicalFamily: {}, byLearnedFamily: {},
            byHybridFamily: {}, queued: 0, queueDropped: 0 }),
        };
      }
      if (name === '@/lib/local-semantic-inbox-shadow') {
        return {
          runLocalSemanticInboxShadow: async () => ({ state: 'idle', checked: 0, eligible: 0, queued: 0, startedAt: null, finishedAt: null }),
          hydrateLocalSemanticInboxShadow: async () => {},
          localSemanticInboxShadowStatus: () => ({ state: 'idle', checked: 0, eligible: 0, queued: 0, startedAt: null, finishedAt: null }),
        };
      }
      if (name === '@/lib/local-semantic-assistant') {
        return { improveAssistantRequestLocally: async ({ deterministicRequest }) => deterministicRequest };
      }
      if (name === '@/lib/local-semantic-runtime') {
        return {
          localSemanticRuntimeStatus: () => ({ state: 'not-downloaded', modelVersion: 'test', error: null, retryAfter: null,
            metrics: { downloadMs: 0, prepareMs: 0, sessionMs: 0, encodeCount: 0, encodeTotalMs: 0, encodeMaxMs: 0, failures: 0 } }),
          getLocalSemanticEncoder: async () => { throw new Error('local-semantic-runtime:native-only'); },
          createDownloadedSemanticRetriever: async () => { throw new Error('local-semantic-runtime:native-only'); },
          clearLocalSemanticArtifacts() {},
        };
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
