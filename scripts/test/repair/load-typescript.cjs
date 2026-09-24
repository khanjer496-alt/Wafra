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
      // Screens subscribe through narrow selectors now. A harness store stub
      // that models only `useStore()` still drives them: each selector reads
      // the same (possibly per-render replaced) store the stub returns.
      if (name === '@/lib/store' && Object.hasOwn(dependencies, name) &&
          typeof dependencies[name].useStore === 'function' &&
          typeof dependencies[name].useStoreSelector !== 'function') {
        const stub = dependencies[name];
        return {
          ...stub,
          useStoreSelector: (selector) => selector(stub.useStore()),
          useStoreActions: () => stub.useStore(),
        };
      }
      // Money reads the device-locale key beside the ledger denomination.
      // Stubs of that hook module predate it; outside a provider it is ''.
      if (name === '@/hooks/use-ledger-money' && Object.hasOwn(dependencies, name) &&
          typeof dependencies[name].useMoneyLocaleKey !== 'function') {
        return { ...dependencies[name], useMoneyLocaleKey: () => '' };
      }
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      // Pure selection helpers used by screens; always the real source.
      if (name === '@/lib/store-selection') {
        return loadTypescript(require('node:path').resolve(__dirname, '../../../src/lib/store-selection.ts'));
      }
      // The pull-to-refresh scan control is an opaque child boundary for
      // screen harnesses, like the other capture surfaces.
      if (name === '@/components/capture-refresh-control') {
        return { CaptureRefreshControl: (props) => ({ type: 'RefreshControl', props, key: undefined }) };
      }
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
      // The country model (ISO list, date order, parser-pack choice) is pure
      // data and functions, imported by markets.ts itself, so every harness
      // gets the real compiled module.
      // The real unproven-format policy (pure; the setting mirror defaults on).
      if (name === '@/lib/best-effort-autopost') {
        return require('../build/best-effort-autopost.js');
      }
      if (name === '@/lib/country') {
        return require('../build/country.js');
      }
      if (name === '@/lib/country-names') {
        return require('../build/country-names.js');
      }
      // The on-device semantic model is native-only and advisory. Screen and
      // journey harnesses get the same fail-closed behaviour the web build has:
      // the deterministic plan is returned unchanged and the runtime is never
      // ready. Harnesses that exercise the model supply their own module.
      // The universal extractor is pure and deterministic; harnesses that load
      // the capture path get the real compiled module, never a stub that could
      // drift from what ships. Shadow evaluation is observational only and
      // native-only, so it is inert here unless a harness supplies its own.
      // Reference-rate conversion is pure money arithmetic plus an in-memory
      // quote cache; its network loader only runs when a caller invokes it.
      // Harnesses get the real compiled modules so conversion cannot drift.
      if (name === '@/lib/fx') {
        return require('../build/fx.js');
      }
      if (name === '@/lib/fx-rates') {
        return require('../build/fx-rates.js');
      }
      if (name === '@/lib/universal-parser') {
        return require('../build/universal-parser.js');
      }
      if (name === '@/lib/universal-template-certification') {
        return require('../build/universal-template-certification.js');
      }
      if (name === '@/lib/local-semantic-shadow') {
        return {
          canCollectLocalSemanticShadow: () => false,
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
      // Exercise real admission/cache semantics. Native inference still resolves
      // to the compiled runtime's fail-closed Node boundary in these harnesses.
      if (name === '@/lib/local-semantic-review') {
        return require('../build/local-semantic-review.js');
      }
      if (name === '@/lib/local-semantic-background-policy') {
        return require('../build/local-semantic-background-policy.js');
      }
      // Pure capture helpers shared by every collector; harnesses that stub a
      // planner without Wallet near-matches get the real pass-through module.
      if (name === '@/lib/wallet-near-match') {
        return require('../build/wallet-near-match.js');
      }
      if (name === '@/lib/parsed-review-event') {
        return require('../build/parsed-review-event.js');
      }
      if (name === '@/lib/generic-review-entry') {
        return require('../build/generic-review-entry.js');
      }
      if (name === '@/lib/local-semantic-inbox-shadow') {
        return {
          runLocalSemanticInboxShadow: async () => ({ state: 'idle', checked: 0, eligible: 0, queued: 0, startedAt: null, finishedAt: null }),
          hydrateLocalSemanticInboxShadow: async () => {},
          localSemanticInboxShadowStatus: () => ({ state: 'idle', checked: 0, eligible: 0, queued: 0, startedAt: null, finishedAt: null }),
        };
      }
      // E5 is default-off in shipping builds; harnesses see the same flag.
      if (name === '@/lib/local-semantic-flags') {
        return { LOCAL_SEMANTIC_E5_ENABLED: false };
      }
      // Platform on-device model: absent in Node, exactly as on an older OS.
      // Suites that exercise the provider load src/lib/on-device-ai.ts itself.
      if (name === '@/lib/on-device-ai') {
        const availability = { status: 'unsupported-os', provider: null, languages: null, canPrepare: false };
        return {
          onDeviceAI: {
            peekAvailability: () => null,
            getAvailability: async () => availability,
            prepare: async () => availability,
            respond: async () => ({ kind: 'unavailable' }),
          },
          textLanguage: (text, fallback) => (/[\u0600-\u06FF]/u.test(text) ? 'ar' : /[A-Za-z]/u.test(text) ? 'en' : fallback),
          supportsOnDeviceLanguage: () => false,
        };
      }
      if (name === '@/lib/on-device-assistant') {
        return { improveAssistantRequestOnDevice: async ({ deterministicRequest }) =>
          ({ source: 'deterministic', request: deterministicRequest, reason: 'unavailable' }) };
      }
      if (name === '@/components/category-suggestion') {
        return { CategorySuggestion: () => null };
      }
      if (name === '@/lib/local-semantic-assistant') {
        return { improveAssistantRequestLocally: async ({ deterministicRequest }) => deterministicRequest };
      }
      if (name === '@/lib/local-assistant-grounding') {
        return loadTypescript(require('node:path').resolve(__dirname, '../../../src/lib/local-assistant-grounding.ts'), {
          '@/lib/wafra-assistant': require('../build/wafra-assistant.js'),
        });
      }
      if (name === '@/lib/local-semantic-runtime') {
        return {
          localSemanticRuntimeStatus: () => ({ state: 'not-downloaded', modelVersion: 'test', error: null, retryAfter: null,
            metrics: { downloadMs: 0, prepareMs: 0, sessionMs: 0, encodeCount: 0, encodeTotalMs: 0, encodeMaxMs: 0, failures: 0 } }),
          getLocalSemanticEncoder: async () => { throw new Error('local-semantic-runtime:native-only'); },
          createDownloadedSemanticRetriever: async () => { throw new Error('local-semantic-runtime:native-only'); },
          clearLocalSemanticArtifacts() {},
          purgeLocalSemanticArtifacts() {},
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
