const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { compileModsAsync, IOSConfig } = require('@expo/config-plugins');
const ts = require('typescript');
const xcode = require('xcode');

let pass = 0;
let fail = 0;
const ok = (name, condition, detail = '') => {
  if (condition) {
    pass += 1;
    console.log(`✓ ${name}`);
    return;
  }
  fail += 1;
  console.log(`✗ ${name}\n    ${detail}`);
};
const eq = (name, actual, expected) => ok(
  name,
  JSON.stringify(actual) === JSON.stringify(expected),
  `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`,
);
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const nextMicrotask = () => new Promise((resolve) => setTimeout(resolve, 0));
const createHookRuntime = () => {
  const slots = [];
  const pendingEffects = [];
  let cursor = 0;

  const sameDependencies = (left, right) =>
    Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index]));
  const nextSlot = (kind, initial) => {
    const index = cursor++;
    if (!slots[index]) slots[index] = { kind, ...initial() };
    if (slots[index].kind !== kind) throw new Error(`hook slot ${index} changed kind`);
    return slots[index];
  };
  const useRef = (value) => nextSlot('ref', () => ({ value: { current: value } })).value;
  const useState = (initial) => {
    const slot = nextSlot('state', () => ({
      value: typeof initial === 'function' ? initial() : initial,
    }));
    const setValue = (next) => {
      slot.value = typeof next === 'function' ? next(slot.value) : next;
    };
    return [slot.value, setValue];
  };
  const memoizeHook = (factory, dependencies) => {
    const slot = nextSlot('memo', () => ({
      dependencies: undefined,
      value: undefined,
    }));
    if (!sameDependencies(slot.dependencies, dependencies)) {
      slot.dependencies = dependencies;
      slot.value = factory();
    }
    return slot.value;
  };
  const memoizeCallback = (callback, dependencies) =>
    memoizeHook(() => callback, dependencies);
  const useEffect = (effect, dependencies) => {
    const slot = nextSlot('effect', () => ({
      cleanup: undefined,
      dependencies: undefined,
      effect: undefined,
    }));
    slot.effect = effect;
    if (sameDependencies(slot.dependencies, dependencies)) return;
    slot.dependencies = dependencies;
    pendingEffects.push({ slot, effect });
  };
  const react = {
    useCallback: memoizeCallback,
    useEffect,
    useMemo: memoizeHook,
    useRef,
    useState,
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  };

  return {
    react,
    render(operation) {
      cursor = 0;
      return operation();
    },
    async flush() {
      while (pendingEffects.length > 0) {
        const { slot, effect } = pendingEffects.shift();
        if (typeof slot.cleanup === 'function') slot.cleanup();
        const cleanup = effect();
        slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
      }
      await nextMicrotask();
      await nextMicrotask();
    },
    async replayEffects() {
      const effects = slots.filter((slot) => slot?.kind === 'effect');
      for (const slot of effects) {
        if (typeof slot.cleanup === 'function') slot.cleanup();
      }
      for (const slot of effects) {
        const cleanup = slot.effect();
        slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
      }
      await nextMicrotask();
      await nextMicrotask();
    },
    cleanup() {
      for (const slot of slots) {
        if (slot?.kind === 'effect' && typeof slot.cleanup === 'function') slot.cleanup();
      }
    },
  };
};
const rejects = async (operation, pattern) => {
  try {
    await operation();
    throw new Error('operation resolved');
  } catch (error) {
    if (!pattern.test(String(error))) throw error;
  }
};
const throws = (operation, pattern) => {
  try {
    operation();
    return false;
  } catch (error) {
    return pattern.test(String(error));
  }
};

const ROOT = path.join(__dirname, '../..');
const readTask3Source = (relative) => {
  const filename = path.join(ROOT, relative);
  if (!fs.existsSync(filename)) {
    ok(`Task 3 source exists: ${relative}`, false, `${filename} does not exist`);
    return '';
  }
  ok(`Task 3 source exists: ${relative}`, true);
  return fs.readFileSync(filename, 'utf8');
};
const executeFile = (filename, requireModule) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} };
  Function('require', 'module', 'exports', '__filename', '__dirname', output)(
    (id) => id === './ios-capture-health' || id === '@/lib/ios-capture-health'
      ? execute('src/lib/ios-capture-health.ts', requireModule) : requireModule(id),
    loaded, loaded.exports, filename, path.dirname(filename),
  );
  return loaded.exports;
};
const execute = (relative, requireModule) => executeFile(path.join(ROOT, relative), requireModule);

const linkingUrls = [];
const linkingCanOpenUrls = [];
const receiverSensitiveLinking = {
  _validateURL(url) {
    if (typeof url !== 'string') throw new TypeError('URL must be a string');
  },
  async openURL(url) {
    this._validateURL(url);
    linkingUrls.push(url);
  },
  async canOpenURL(url) {
    this._validateURL(url);
    linkingCanOpenUrls.push(url);
    return true;
  },
};

const defaultNativeStatus = {
  enabled: false,
  entitled: true,
  pending: 0,
  dropped: 0,
  corrupt: false,
  warningId: null,
  setupProofVersion: null,
  setupProofAt: null,
  firstCapturedAt: null,
};
const defaultNativeModule = {
  async getCaptureStatus() { return { ...defaultNativeStatus }; },
  async setCaptureEnabled() {},
};
const protocolModule = execute('src/lib/ios-local-capture-protocol.ts', (id) => {
  throw new Error(`unexpected local capture protocol dependency ${id}`);
});

const setupModule = execute('src/lib/ios-capture-setup.ts', (id) => {
  if (id === 'react-native') {
    return {
      Platform: { OS: 'ios', Version: '17.5' },
      Linking: receiverSensitiveLinking,
    };
  }
  if (id === '@/lib/capture') {
    return {
      getIosCaptureNativeModule: () => defaultNativeModule,
      subscribeIosCaptureStatusRefresh: () => () => {},
    };
  }
  if (id === '@/lib/ios-local-capture-protocol') return protocolModule;
  throw new Error(`unexpected dependency ${id}`);
});

(async () => {
  {
    const types = readTask3Source(
      'modules/wafra-live-capture/src/WafraLiveCapture.types.ts',
    );
    const nativeModule = readTask3Source(
      'modules/wafra-live-capture/src/WafraLiveCaptureModule.ts',
    );
    const webModule = readTask3Source(
      'modules/wafra-live-capture/src/WafraLiveCaptureModule.web.ts',
    );
    const swiftModule = readTask3Source(
      'modules/wafra-live-capture/ios/WafraLiveCaptureModule.swift',
    );
    const swiftStore = readTask3Source(
      'modules/wafra-live-capture/ios/WafraLiveCaptureStore.swift',
    );
    const resourceHelper = readTask3Source(
      'modules/wafra-live-capture/ios/WafraLiveCaptureResources.swift',
    );
    const podspec = readTask3Source(
      'modules/wafra-live-capture/ios/WafraLiveCapture.podspec',
    );
    const plugin = readTask3Source('modules/wafra-live-capture/plugin/index.js');
    const generatedIntent = readTask3Source('ios/Wafra/WafraLiveCaptureIntent.swift');
    const english = readTask3Source(
      'modules/wafra-live-capture/ios/Resources/en.lproj/WafraIntents.strings',
    );
    const arabic = readTask3Source(
      'modules/wafra-live-capture/ios/Resources/ar.lproj/WafraIntents.strings',
    );
    const moduleConfig = readTask3Source(
      'modules/wafra-live-capture/expo-module.config.json',
    );

    const normalizedTypes = types.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
    const exactStatus = `export interface WafraLiveCaptureStatus {
      enabled: boolean;
      entitled: boolean;
      pending: number;
      dropped: number;
      corrupt: boolean;
      warningId: string | null;
      setupProofVersion: number | null;
      setupProofAt: number | null;
      firstCapturedAt: number | null;
      lastReceivedAt?: number | null;
      lastHandledAt?: number | null;
    }`.replace(/\s+/g, ' ').trim();
    const exactNativeModule = `export interface WafraLiveCaptureNativeModule {
      setLocalCaptureEntitlementLease(expiresAtMs: number | null, lifetime: boolean): Promise<boolean>;
      setStoreCaptureEntitlementLease(
        expiresAtMs: number | null,
        lifetime: boolean,
        verifiedAtMs: number,
      ): Promise<boolean>;
      setCaptureEnabled(enabled: boolean): Promise<void>;
      listPendingRecords(limit: number): Promise<string[]>;
      acknowledgeRecords(ids: string[]): Promise<void>;
      purgeExpired(): Promise<number>;
      getCaptureStatus(): Promise<WafraLiveCaptureStatus>;
      getAutomationInputProbeAt(): Promise<number | null>;
      acknowledgeCaptureWarning(warningId: string): Promise<boolean>;
      recordFirstCapturedAt(observedAt: number): Promise<void>;
      eraseAll(): Promise<void>;
    }`.replace(/\s+/g, ' ').trim();
    ok('live-capture TypeScript status surface is exact',
      normalizedTypes.includes(exactStatus), normalizedTypes);
    ok('live-capture TypeScript native-module surface is exact',
      normalizedTypes.includes(exactNativeModule), normalizedTypes);
    ok('native TypeScript binding requires the autolinked module by exact name',
      /requireNativeModule<WafraLiveCaptureNativeModule>\(['"]WafraLiveCapture['"]\)/
        .test(nativeModule), nativeModule);
    ok('web live-capture bridge fails closed instead of simulating success',
      /throw new Error\(/.test(webModule) &&
        !/return\s+(?:\[\]|0|false|null|undefined)\s*;/.test(webModule), webModule);

    const webBridge = execute(
      'modules/wafra-live-capture/src/WafraLiveCaptureModule.web.ts',
      (id) => { throw new Error(`unexpected live-capture web dependency ${id}`); },
    ).default;
    const webCalls = [
      ['setLocalCaptureEntitlementLease', [1_800_000_000_000, false]],
      ['setStoreCaptureEntitlementLease', [1_800_000_000_000, false, 1_700_000_000_000]],
      ['setCaptureEnabled', [true]],
      ['listPendingRecords', [7]],
      ['acknowledgeRecords', [['00000000-0000-0000-0000-000000000001']]],
      ['purgeExpired', []],
      ['getCaptureStatus', []],
      ['getAutomationInputProbeAt', []],
      ['acknowledgeCaptureWarning', ['00000000-0000-0000-0000-000000000001']],
      ['recordFirstCapturedAt', [1_234_567]],
      ['eraseAll', []],
    ];
    for (const [method, args] of webCalls) {
      const outcome = await Promise.resolve()
        .then(() => webBridge[method](...args))
        .then(() => 'resolved', () => 'rejected');
      eq(`web live-capture ${method} rejects instead of mutating or simulating success`,
        outcome, 'rejected');
    }

    const nativeMethods = [
      'setLocalCaptureEntitlementLease',
      'setStoreCaptureEntitlementLease',
      'setCaptureEnabled',
      'listPendingRecords',
      'acknowledgeRecords',
      'purgeExpired',
      'getCaptureStatus',
      'getAutomationInputProbeAt',
      'acknowledgeCaptureWarning',
      'recordFirstCapturedAt',
      'eraseAll',
    ];
    for (const method of nativeMethods) {
      ok(`Swift bridge exposes ${method} exactly once`,
        (swiftModule.match(new RegExp(`AsyncFunction\\(\\"${method}\\"`, 'g')) || []).length === 1,
        swiftModule);
    }
    ok('Swift bridge rejects non-integer/out-of-range JS limits before the store call',
      /limit\.isFinite/.test(swiftModule) && /Int\(exactly:\s*limit\)/.test(swiftModule) &&
        /0\.\.\.WafraLiveCaptureStore\.maxBridgeRecords/.test(swiftModule) &&
        swiftModule.indexOf('limit.isFinite') < swiftModule.indexOf('listPendingRecords(limit:'),
      swiftModule);
    ok('Swift bridge performs explicit finite milliseconds/seconds conversion',
      /milliseconds\.isFinite/.test(swiftModule) &&
        /milliseconds\s*\/\s*1_000(?:\.0)?/.test(swiftModule) &&
        /seconds\s*\*\s*1_000(?:\.0)?/.test(swiftModule), swiftModule);
    ok('Swift bridge maps every operation directly to the singleton store',
      nativeMethods.every((method) => {
        const storeMethod = {
          getCaptureStatus: 'status',
          getAutomationInputProbeAt: 'automationInputProbeAt',
          setLocalCaptureEntitlementLease: 'setLocalEntitlementLease',
          setStoreCaptureEntitlementLease: 'setStoreEntitlementLease',
        }[method] || method;
        return new RegExp(`WafraLiveCaptureStore\\.shared\\.${storeMethod}\\(`).test(swiftModule);
      }),
      swiftModule);

    ok('local module is autolinkable on Apple and web', (() => {
      try {
        const parsed = JSON.parse(moduleConfig);
        return JSON.stringify(parsed.platforms) === JSON.stringify(['apple', 'web']) &&
          JSON.stringify(parsed.apple?.modules) === JSON.stringify(['WafraLiveCaptureModule']);
      } catch {
        return false;
      }
    })(), moduleConfig);
    ok('podspec packages the exact CocoaPods localization resource bundle',
      /s\.resource_bundles\s*=\s*\{\s*['"]WafraLiveCaptureResources['"]\s*=>\s*\[['"]Resources\/\*\*\/\*['"]\]\s*\}/s
        .test(podspec), podspec);
    ok('podspec excludes executable Task 3 test support from production sources',
      /s\.exclude_files\s*=\s*['"]Tests\/\*\*\/\*['"]/.test(podspec), podspec);
    ok('resource helper searches both framework and main bundles and fails closed',
      /public enum WafraLiveCaptureResources/.test(resourceHelper) &&
        /Bundle\(for:\s*ResourceAnchor\.self\)/.test(resourceHelper) &&
        /Bundle\.main/.test(resourceHelper) &&
        /WafraLiveCaptureResources/.test(resourceHelper) &&
        /preconditionFailure|fatalError/.test(resourceHelper), resourceHelper);
    ok('resource helper uses the custom table and CocoaPods bundle URL without fallback text',
      /LocalizedStringResource\(/.test(resourceHelper) &&
        /table:\s*(?:Self\.)?tableName/.test(resourceHelper) &&
        /WafraIntents/.test(resourceHelper) &&
        /bundle:\s*\.atURL\(bundle\.bundleURL\)/.test(resourceHelper) &&
        !/defaultValue:/.test(resourceHelper), resourceHelper);

    const expectedLocalizationKeys = [
      'live.setup_proof.title',
      'live.setup_proof.error',
      'live.automation_input_probe.title',
      'live.automation_input_probe.message.parameter',
      'live.automation_input_probe.error',
      'live.stage.title',
      'live.stage.sender.parameter',
      'live.stage.message.parameter',
      'live.stage.event_id.parameter',
      'live.stage.observed_at.parameter',
      'live.stage.error',
      'live.stage.disabled',
      'live.stage.invalid',
      'live.stage.capacity',
      'live.stage_text.title',
      'live.stage_text.message.parameter',
    ];
    const localizationKeys = (source) => [...source.matchAll(/^\s*"([^"]+)"\s*=/gm)]
      .map((match) => match[1]).sort();
    eq('English intent table contains the closed key set',
      localizationKeys(english), [...expectedLocalizationKeys].sort());
    eq('Arabic intent table contains the same closed key set',
      localizationKeys(arabic), [...expectedLocalizationKeys].sort());
    ok('Arabic intent table contains real Arabic values rather than English/key fallbacks',
      /[\u0600-\u06ff]/.test(arabic) && arabic !== english, arabic);

    eq('config plugin generates the exact app-target source path once',
      plugin.match(/filePath:\s*['"]WafraLiveCaptureIntent\.swift['"]/g)?.length || 0, 1);
    ok('config plugin uses the idempotent build-source helper with overwrite enabled',
      /IOSConfig\.XcodeProjectFile\.withBuildSourceFile/.test(plugin) &&
        /overwrite:\s*true/.test(plugin), plugin);
    const appPlugins = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8')).expo.plugins;
    const livePlugin = './modules/wafra-live-capture/plugin';
    eq('app config registers the live-capture plugin exactly once',
      appPlugins.filter((entry) => entry === livePlugin).length, 1);
    ok('live-capture plugin runs after the existing local native module integration',
      appPlugins.indexOf(livePlugin) > appPlugins.indexOf('./modules/wafra-message-history/plugin'),
      JSON.stringify(appPlugins));

    eq('generated source declares all four app-discoverable intents once', [
      generatedIntent.match(/struct RecordWafraCaptureSetupProofIntent:\s*AppIntent/g)?.length || 0,
      generatedIntent.match(/struct ProbeWafraAutomationInputIntent:\s*AppIntent/g)?.length || 0,
      generatedIntent.match(/struct StageWafraLiveMessageIntent:\s*AppIntent/g)?.length || 0,
      generatedIntent.match(/struct StageWafraLiveTextIntent:\s*AppIntent/g)?.length || 0,
    ], [1, 1, 1, 1]);
    eq('all intents are always allowed and do not launch Wafra', [
      generatedIntent.match(/authenticationPolicy:\s*IntentAuthenticationPolicy\s*=\s*\.alwaysAllowed/g)?.length || 0,
      generatedIntent.match(/openAppWhenRun\s*=\s*false/g)?.length || 0,
    ], [4, 4]);
    ok('setup-proof intent has no parameters and records proof version 1', (() => {
      const match = generatedIntent.match(
        /struct RecordWafraCaptureSetupProofIntent:\s*AppIntent\s*\{([\s\S]*?)\n\}/,
      );
      return Boolean(match) && !/@Parameter/.test(match[1]) &&
        /recordSetupProof\(version:\s*1,\s*at:\s*Date\(\)\)/.test(match[1]);
    })(), generatedIntent);
    ok('probe intent auto-connects one String and records only exact-match proof', (() => {
      const match = generatedIntent.match(
        /struct ProbeWafraAutomationInputIntent:\s*AppIntent\s*\{([\s\S]*?)\n\}\n\n@available\(iOS 26\.0, \*\)\s*extension ProbeWafraAutomationInputIntent/,
      );
      return Boolean(match) && (match[1].match(/@Parameter\(/g) || []).length === 1 &&
        /inputConnectionBehavior:\s*\.connectToPreviousIntentResult/.test(match[1]) &&
        /var message:\s*String/.test(match[1]) &&
        /recordAutomationInputProbe\(\s*body:\s*message,\s*at:\s*Date\(\)\s*\)/.test(match[1]) &&
        /return \.result\(value:\s*matched\)/.test(match[1]) &&
        !/\.stage\(|recordSetupProof/.test(match[1]);
    })(), generatedIntent);
    ok('diagnostic probe intent is compiled only in Debug builds',
      /#if DEBUG\s*@available\(iOS 16\.0, \*\)\s*struct ProbeWafraAutomationInputIntent:[\s\S]*?extension ProbeWafraAutomationInputIntent[\s\S]*?#endif/
        .test(generatedIntent), generatedIntent);
    ok('diagnostic probe write capability is compiled only in Debug builds',
      /#if DEBUG\s*public static let automationInputProbePayload[\s\S]*?#endif/.test(swiftStore) &&
        /#if DEBUG\s*public func recordAutomationInputProbe[\s\S]*?#endif/.test(swiftStore),
      swiftStore);
    ok('stage intent keeps its exact four parameters and fails visibly for rejected capture', (() => {
      const match = generatedIntent.match(
        /struct StageWafraLiveMessageIntent:\s*AppIntent\s*\{([\s\S]*?)\n\}\n\n@available\(iOS 26\.0, \*\)\s*extension StageWafraLiveMessageIntent/,
      );
      return Boolean(match) && (match[1].match(/@Parameter\(/g) || []).length === 4 &&
        /var sender:\s*String/.test(match[1]) && /var body:\s*String/.test(match[1]) &&
        /var eventId:\s*String/.test(match[1]) && /var observedAt:\s*Date/.test(match[1]) &&
        /case \.accepted, \.ignored:/.test(match[1]) &&
        /case \.disabled:[\s\S]*captureDisabled/.test(match[1]) &&
        /case \.invalid:[\s\S]*invalidMessage/.test(match[1]) &&
        /case \.capacityReached:[\s\S]*captureCapacityReached/.test(match[1]);
    })(), generatedIntent);
    ok('plain-text fallback auto-connects one String and uses the protected local queue', (() => {
      const match = generatedIntent.match(
        /struct StageWafraLiveTextIntent:\s*AppIntent\s*\{([\s\S]*?)\n\}\n\n@available\(iOS 26\.0, \*\)\s*extension StageWafraLiveTextIntent/,
      );
      return Boolean(match) && (match[1].match(/@Parameter\(/g) || []).length === 1 &&
        /inputConnectionBehavior:\s*\.connectToPreviousIntentResult/.test(match[1]) &&
        /var body:\s*String/.test(match[1]) &&
        /sender:\s*"Wafra Automation"/.test(match[1]) &&
        /eventId:\s*UUID\(\)\.uuidString/.test(match[1]) &&
        /observedAt:\s*Date\(\)/.test(match[1]) &&
        /case \.disabled:[\s\S]*captureDisabled/.test(match[1]);
    })(), generatedIntent);
    eq('probe plus live paths expose the exact six parameters',
      generatedIntent.match(/@Parameter\(/g)?.length || 0, 6);
    eq('Apple-extracted titles and parameters initialize LocalizedStringResource directly', [
      generatedIntent.match(/static let title\s*=\s*LocalizedStringResource\(/g)?.length || 0,
      generatedIntent.match(/@Parameter\(\s*title:\s*LocalizedStringResource\(/g)?.length || 0,
      generatedIntent.match(
        /(?:static let title\s*=|@Parameter\(title:)\s*WafraLiveCaptureResources\.localized\(/g,
      )?.length || 0,
    ], [4, 6, 0]);
    eq('Apple-extracted title and parameter resources use the required main bundle', [
      generatedIntent.match(/bundle:\s*\.main/g)?.length || 0,
      generatedIntent.match(/bundle:\s*\.atURL/g)?.length || 0,
    ], [10, 0]);
    ok('every intent title, parameter, and source-free error uses the closed localization keys',
      expectedLocalizationKeys.every((key) => generatedIntent.includes(`"${key}"`)) &&
        !/static let title[^\n]*=\s*"|@Parameter\(title:\s*"/.test(generatedIntent), generatedIntent);
    ok('iOS 26 supportedModes references occur only in availability extensions', (() => {
      const modes = generatedIntent.match(/supportedModes:\s*IntentModes\s*\{\s*\.background\s*\}/g) || [];
      const extensions = generatedIntent.match(
        /@available\(iOS 26\.0, \*\)\s*extension (?:RecordWafraCaptureSetupProofIntent|ProbeWafraAutomationInputIntent|StageWafraLiveMessageIntent|StageWafraLiveTextIntent)\s*\{\s*static var supportedModes:\s*IntentModes\s*\{\s*\.background\s*\}\s*\}/g,
      ) || [];
      return modes.length === 4 && extensions.length === 4;
    })(), generatedIntent);
    ok('generated intents contain no network, file, clipboard, log, notification, or dialog capability',
      !/(?:https?:|URLSession|FileManager|NSFile|UIPasteboard|clipboard|\bprint\s*\(|os_log|Logger\s*\(|UNUserNotificationCenter|notification|ProvidesDialog|dialog:)/i
        .test(generatedIntent), generatedIntent);
    const pluginIntentSource = plugin.match(/const intentSource = `([\s\S]*?)`;\s*\n/)?.[1] || '';
    eq('generated intent source exactly matches the deterministic plugin template',
      generatedIntent, pluginIntentSource);

    const unquoteProjectValue = (value) => String(value ?? '').replace(/^"|"$/g, '');
    const intentResourcePaths = [
      'en.lproj/WafraIntents.strings',
      'ar.lproj/WafraIntents.strings',
    ];
    const intentLocalizations = ['en', 'ar'];
    const parseXcodeProject = (filename) => {
      const project = xcode.project(filename);
      project.parseSync();
      return project;
    };
    const nativeTargetUuid = (project, targetName) => Object.entries(project.pbxNativeTargetSection())
      .find(([key, entry]) => !key.endsWith('_comment') &&
        entry?.isa === 'PBXNativeTarget' &&
        unquoteProjectValue(entry.name) === targetName)?.[0];
    const wafraTargetUuid = (project) => nativeTargetUuid(project, 'Wafra');
    const exactReferencePaths = (project) => Object.entries(project.pbxFileReferenceSection())
      .filter(([key, entry]) => !key.endsWith('_comment') &&
        intentResourcePaths.includes(unquoteProjectValue(entry?.path)))
      .map(([, entry]) => unquoteProjectValue(entry.path))
      .sort();
    const phaseResourceCounts = (project, phase) => {
      const fileReferences = project.pbxFileReferenceSection();
      const buildFiles = project.pbxBuildFileSection();
      const phaseFiles = phase?.files || [];
      return intentResourcePaths.map((resourcePath) => phaseFiles.filter((membership) => {
        const buildFile = buildFiles[membership.value];
        return unquoteProjectValue(fileReferences[buildFile?.fileRef]?.path) === resourcePath;
      }).length);
    };
    const task3ReferenceUuids = (project) => new Set(
      Object.entries(project.pbxFileReferenceSection())
        .filter(([key, entry]) => !key.endsWith('_comment') && [
          ...intentResourcePaths,
          'Wafra/WafraLiveCaptureIntent.swift',
        ].includes(unquoteProjectValue(entry?.path)))
        .map(([key]) => key),
    );
    const groupAtPath = (project, components) => {
      let group = project.getPBXGroupByKey(project.getFirstProject().firstProject.mainGroup);
      for (const component of components) {
        const child = group?.children.find(({ comment }) => comment === component);
        group = child ? project.getPBXGroupByKey(child.value) : null;
      }
      return group;
    };
    const removeTask3XcodeState = (project) => {
      const fileReferences = project.pbxFileReferenceSection();
      const removedReferences = task3ReferenceUuids(project);
      const buildFiles = project.pbxBuildFileSection();
      const removedBuildFiles = new Set(
        Object.entries(buildFiles)
          .filter(([key, entry]) => !key.endsWith('_comment') &&
            removedReferences.has(entry?.fileRef))
          .map(([key]) => key),
      );

      for (const [sectionName, section] of Object.entries(project.hash.project.objects)) {
        if (!sectionName.endsWith('BuildPhase')) continue;
        for (const [key, phase] of Object.entries(section)) {
          if (key.endsWith('_comment') || !Array.isArray(phase?.files)) continue;
          phase.files = phase.files.filter(({ value }) => !removedBuildFiles.has(value));
        }
      }
      for (const [key, group] of Object.entries(project.hash.project.objects.PBXGroup)) {
        if (key.endsWith('_comment') || !Array.isArray(group?.children)) continue;
        group.children = group.children.filter(({ value }) => !removedReferences.has(value));
      }
      for (const uuid of removedBuildFiles) {
        delete buildFiles[uuid];
        delete buildFiles[`${uuid}_comment`];
      }
      for (const uuid of removedReferences) {
        delete fileReferences[uuid];
        delete fileReferences[`${uuid}_comment`];
      }
      const firstProject = project.getFirstProject().firstProject;
      firstProject.knownRegions = (firstProject.knownRegions || [])
        .filter((region) => unquoteProjectValue(region) !== 'ar');

      const supportingGroup = groupAtPath(project, ['Wafra', 'Supporting']);
      const groups = project.hash.project.objects.PBXGroup;
      for (const localization of intentLocalizations) {
        const child = supportingGroup?.children.find(
          ({ comment }) => comment === `${localization}.lproj`,
        );
        const localeGroup = child ? project.getPBXGroupByKey(child.value) : null;
        if (!child || (localeGroup?.children || []).length > 0) continue;
        supportingGroup.children = supportingGroup.children.filter(
          ({ value }) => value !== child.value,
        );
        delete groups[child.value];
        delete groups[`${child.value}_comment`];
      }
    };
    const addOrphanedTask3References = (project) => {
      const fileReferences = project.pbxFileReferenceSection();
      const buildFiles = project.pbxBuildFileSection();
      const wrongTarget = project.addTarget(
        'FixtureWrongTarget',
        'bundle',
        'FixtureWrongTarget',
        'app.wafra.fixture',
      );
      project.addBuildPhase(
        [],
        'PBXResourcesBuildPhase',
        'Resources',
        wrongTarget.uuid,
      );
      const wrongResources = project.pbxResourcesBuildPhaseObj(wrongTarget.uuid);

      for (const [index, resourcePath] of intentResourcePaths.entries()) {
        const localization = resourcePath.split('.')[0];
        IOSConfig.XcodeUtils.ensureGroupRecursively(
          project,
          `Wafra/Supporting/${localization}.lproj`,
        );
        const group = groupAtPath(
          project,
          ['Wafra', 'Supporting', `${localization}.lproj`],
        );
        if (!group) throw new Error(`fixture group missing for ${localization}`);
        const fileRef = project.generateUuid();
        fileReferences[fileRef] = {
          isa: 'PBXFileReference',
          name: '"WafraIntents.strings"',
          path: `"${resourcePath}"`,
          sourceTree: '"<group>"',
          fileEncoding: 4,
          lastKnownFileType: 'text.plist.strings',
          explicitFileType: 'undefined',
          includeInIndex: 0,
        };
        fileReferences[`${fileRef}_comment`] = 'WafraIntents.strings';
        group.children.push({ value: fileRef, comment: 'WafraIntents.strings' });

        if (index === 0) {
          const buildFile = project.generateUuid();
          buildFiles[buildFile] = {
            isa: 'PBXBuildFile',
            fileRef,
            fileRef_comment: 'WafraIntents.strings',
          };
          buildFiles[`${buildFile}_comment`] = 'WafraIntents.strings in Resources';
          wrongResources.files.push({
            value: buildFile,
            comment: 'WafraIntents.strings in Resources',
          });
        }
      }
      project.getFirstProject().firstProject.knownRegions.push('ar', '"ar"');
    };
    const buildSettings = (project) => Object.entries(project.pbxXCBuildConfigurationSection())
      .filter(([key, value]) => !key.endsWith('_comment') && value?.isa === 'XCBuildConfiguration')
      .map(([key, value]) => [key, value.name, value.buildSettings])
      .sort(([left], [right]) => left.localeCompare(right));
    const applyLivePlugin = async (projectRoot) => {
      const configured = require(path.join(ROOT, 'modules/wafra-live-capture/plugin'))({
        name: 'Wafra',
        slug: 'wafra',
        ios: { bundleIdentifier: 'app.wafra' },
      });
      await compileModsAsync(configured, {
        projectRoot,
        platforms: ['ios'],
      });
    };

    const pluginProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-live-plugin-'));
    try {
      const temporaryIosRoot = path.join(pluginProjectRoot, 'ios');
      const temporaryAppRoot = path.join(temporaryIosRoot, 'Wafra');
      const temporaryProjectRoot = path.join(temporaryIosRoot, 'Wafra.xcodeproj');
      const temporaryProjectFile = path.join(temporaryProjectRoot, 'project.pbxproj');
      fs.mkdirSync(temporaryAppRoot, { recursive: true });
      fs.cpSync(path.join(ROOT, 'ios/Wafra.xcodeproj'), temporaryProjectRoot, { recursive: true });
      fs.copyFileSync(
        path.join(ROOT, 'ios/Wafra/AppDelegate.swift'),
        path.join(temporaryAppRoot, 'AppDelegate.swift'),
      );
      const emptyFixture = parseXcodeProject(temporaryProjectFile);
      removeTask3XcodeState(emptyFixture);
      fs.writeFileSync(temporaryProjectFile, emptyFixture.writeSync());
      const parseProject = () => parseXcodeProject(temporaryProjectFile);
      const baselineParsedProject = parseProject();
      const baselineBuildSettings = buildSettings(baselineParsedProject);
      eq('empty plugin fixture starts without Task 3 resource references or memberships', [
        exactReferencePaths(baselineParsedProject),
        phaseResourceCounts(
          baselineParsedProject,
          baselineParsedProject.pbxResourcesBuildPhaseObj(wafraTargetUuid(baselineParsedProject)),
        ),
        baselineParsedProject.getFirstProject().firstProject.knownRegions
          .map(unquoteProjectValue).filter((region) => region === 'ar').length,
        intentLocalizations.map((localization) => Boolean(groupAtPath(
          baselineParsedProject,
          ['Wafra', 'Supporting', `${localization}.lproj`],
        ))),
      ], [[], [0, 0], 0, [false, false]]);

      await applyLivePlugin(pluginProjectRoot);
      const firstSource = fs.readFileSync(
        path.join(temporaryAppRoot, 'WafraLiveCaptureIntent.swift'),
      );
      const firstEnglishResource = path.join(
        temporaryAppRoot, 'Supporting/en.lproj/WafraIntents.strings',
      );
      const firstArabicResource = path.join(
        temporaryAppRoot, 'Supporting/ar.lproj/WafraIntents.strings',
      );
      ok('actual live-capture plugin packages exact English intent bytes in the app target',
        fs.existsSync(firstEnglishResource) &&
          fs.readFileSync(firstEnglishResource, 'utf8') === english,
        firstEnglishResource);
      ok('actual live-capture plugin packages exact Arabic intent bytes in the app target',
        fs.existsSync(firstArabicResource) &&
          fs.readFileSync(firstArabicResource, 'utf8') === arabic,
        firstArabicResource);
      const firstProject = fs.readFileSync(temporaryProjectFile);
      const firstParsedProject = parseProject();
      eq('actual live-capture plugin preserves unrelated Xcode build settings',
        buildSettings(firstParsedProject), baselineBuildSettings);

      await applyLivePlugin(pluginProjectRoot);
      const secondSource = fs.readFileSync(
        path.join(temporaryAppRoot, 'WafraLiveCaptureIntent.swift'),
      );
      const secondProject = fs.readFileSync(temporaryProjectFile);
      const secondParsedProject = parseProject();
      ok('actual live-capture plugin writes deterministic source bytes across two passes',
        firstSource.equals(secondSource) && secondSource.equals(Buffer.from(generatedIntent)),
        secondSource.toString('utf8'));
      ok('actual live-capture plugin is byte-idempotent for the Xcode project',
        firstProject.equals(secondProject), 'project.pbxproj changed on the second plugin pass');
      eq('actual live-capture plugin preserves build settings on the second pass',
        buildSettings(secondParsedProject), baselineBuildSettings);

      const targetEntry = Object.entries(secondParsedProject.pbxNativeTargetSection())
        .find(([key, entry]) => !key.endsWith('_comment') &&
          entry?.isa === 'PBXNativeTarget' && entry.name === 'Wafra');
      const targetSources = targetEntry
        ? secondParsedProject.pbxSourcesBuildPhaseObj(targetEntry[0])?.files || []
        : [];
      const targetResources = targetEntry
        ? secondParsedProject.pbxResourcesBuildPhaseObj(targetEntry[0])?.files || []
        : [];
      const allSources = Object.values(
        secondParsedProject.hash.project.objects.PBXSourcesBuildPhase,
      ).filter((entry) => entry?.isa === 'PBXSourcesBuildPhase')
        .flatMap((entry) => entry.files || []);
      const fileReferences = Object.entries(secondParsedProject.pbxFileReferenceSection())
        .filter(([key, entry]) => !key.endsWith('_comment') &&
          entry?.path?.replaceAll('"', '') === 'Wafra/WafraLiveCaptureIntent.swift');
      eq('actual live-capture plugin targets Wafra Sources exactly once', [
        targetSources.filter((entry) => entry.comment === 'WafraLiveCaptureIntent.swift in Sources').length,
        allSources.filter((entry) => entry.comment === 'WafraLiveCaptureIntent.swift in Sources').length,
        fileReferences.length,
      ], [1, 1, 1]);
      eq('actual live-capture plugin preserves the existing history-intent membership',
        targetSources.filter((entry) => entry.comment === 'WafraMessageHistoryIntent.swift in Sources').length,
        1);
      eq('actual live-capture plugin adds both localized tables to Wafra Resources exactly once',
        targetResources.filter(
          (entry) => entry.comment === 'WafraIntents.strings in Resources',
        ).length,
        2);
      eq('actual live-capture plugin keeps one exact app-target file reference per locale',
        Object.entries(secondParsedProject.pbxFileReferenceSection())
          .filter(([key, entry]) => !key.endsWith('_comment') &&
            /(?:en|ar)\.lproj\/WafraIntents\.strings/.test(entry?.path?.replaceAll('"', '') || ''))
          .map(([, entry]) => entry.path.replaceAll('"', ''))
          .sort(),
        ['ar.lproj/WafraIntents.strings', 'en.lproj/WafraIntents.strings']);
      eq('actual live-capture plugin registers English and Arabic as app localizations',
        secondParsedProject.getFirstProject().firstProject.knownRegions
          .map((region) => String(region).replaceAll('"', ''))
          .filter((region) => region === 'ar' || region === 'en')
          .sort(),
        ['ar', 'en']);
    } finally {
      fs.rmSync(pluginProjectRoot, { recursive: true, force: true });
    }

    const repairProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-live-repair-'));
    try {
      const temporaryIosRoot = path.join(repairProjectRoot, 'ios');
      const temporaryAppRoot = path.join(temporaryIosRoot, 'Wafra');
      const temporaryProjectRoot = path.join(temporaryIosRoot, 'Wafra.xcodeproj');
      const temporaryProjectFile = path.join(temporaryProjectRoot, 'project.pbxproj');
      fs.mkdirSync(temporaryAppRoot, { recursive: true });
      fs.cpSync(path.join(ROOT, 'ios/Wafra.xcodeproj'), temporaryProjectRoot, { recursive: true });
      fs.copyFileSync(
        path.join(ROOT, 'ios/Wafra/AppDelegate.swift'),
        path.join(temporaryAppRoot, 'AppDelegate.swift'),
      );
      const orphanFixture = parseXcodeProject(temporaryProjectFile);
      removeTask3XcodeState(orphanFixture);
      addOrphanedTask3References(orphanFixture);
      fs.writeFileSync(temporaryProjectFile, orphanFixture.writeSync());

      const parseRepairProject = () => parseXcodeProject(temporaryProjectFile);
      const beforeRepair = parseRepairProject();
      const targetUuid = wafraTargetUuid(beforeRepair);
      const wrongTargetUuid = nativeTargetUuid(beforeRepair, 'FixtureWrongTarget');
      const baselineBuildSettings = buildSettings(beforeRepair);
      eq('repair fixture independently starts with orphan/wrong-target references only', [
        exactReferencePaths(beforeRepair),
        phaseResourceCounts(beforeRepair, beforeRepair.pbxResourcesBuildPhaseObj(targetUuid)),
        phaseResourceCounts(
          beforeRepair,
          beforeRepair.pbxResourcesBuildPhaseObj(wrongTargetUuid),
        ),
        beforeRepair.getFirstProject().firstProject.knownRegions
          .map(unquoteProjectValue).filter((region) => region === 'ar').length,
      ], [intentResourcePaths.slice().sort(), [0, 0], [1, 0], 2]);

      await applyLivePlugin(repairProjectRoot);
      const firstProject = fs.readFileSync(temporaryProjectFile);
      const firstParsedProject = parseRepairProject();
      const firstTargetUuid = wafraTargetUuid(firstParsedProject);
      eq('plugin repairs exact Wafra Resources membership without duplicate file references', [
        exactReferencePaths(firstParsedProject),
        phaseResourceCounts(
          firstParsedProject,
          firstParsedProject.pbxResourcesBuildPhaseObj(firstTargetUuid),
        ),
      ], [intentResourcePaths.slice().sort(), [1, 1]]);
      const firstWrongTargetUuid = nativeTargetUuid(firstParsedProject, 'FixtureWrongTarget');
      eq('plugin preserves the pre-existing wrong-target membership while adding Wafra Resources',
        phaseResourceCounts(
          firstParsedProject,
          firstParsedProject.pbxResourcesBuildPhaseObj(firstWrongTargetUuid),
        ), [1, 0]);
      eq('plugin repairs Arabic knownRegions registration exactly once',
        firstParsedProject.getFirstProject().firstProject.knownRegions
          .map(unquoteProjectValue).filter((region) => region === 'ar').length, 1);
      eq('repair pass preserves unrelated Xcode build settings',
        buildSettings(firstParsedProject), baselineBuildSettings);
      ok('repair pass still copies exact English and Arabic resource bytes',
        fs.readFileSync(
          path.join(temporaryAppRoot, 'Supporting/en.lproj/WafraIntents.strings'),
          'utf8',
        ) === english && fs.readFileSync(
          path.join(temporaryAppRoot, 'Supporting/ar.lproj/WafraIntents.strings'),
          'utf8',
        ) === arabic);

      await applyLivePlugin(repairProjectRoot);
      const secondProject = fs.readFileSync(temporaryProjectFile);
      const secondParsedProject = parseRepairProject();
      const secondTargetUuid = wafraTargetUuid(secondParsedProject);
      const secondWrongTargetUuid = nativeTargetUuid(secondParsedProject, 'FixtureWrongTarget');
      ok('repaired Xcode project is byte-idempotent on the second plugin pass',
        firstProject.equals(secondProject), 'project.pbxproj changed on the second repair pass');
      eq('repaired memberships, references, and region stay duplicate-free', [
        exactReferencePaths(secondParsedProject),
        phaseResourceCounts(
          secondParsedProject,
          secondParsedProject.pbxResourcesBuildPhaseObj(secondTargetUuid),
        ),
        phaseResourceCounts(
          secondParsedProject,
          secondParsedProject.pbxResourcesBuildPhaseObj(secondWrongTargetUuid),
        ),
        secondParsedProject.getFirstProject().firstProject.knownRegions
          .map(unquoteProjectValue).filter((region) => region === 'ar').length,
      ], [intentResourcePaths.slice().sort(), [1, 1], [1, 0], 1]);
    } finally {
      fs.rmSync(repairProjectRoot, { recursive: true, force: true });
    }

    const xcodeProject = fs.readFileSync(
      path.join(ROOT, 'ios/Wafra.xcodeproj/project.pbxproj'), 'utf8',
    );
    const sourcesPhase = xcodeProject.match(
      /\/\* Begin PBXSourcesBuildPhase section \*\/([\s\S]*?)\/\* End PBXSourcesBuildPhase section \*\//,
    )?.[1] || '';
    eq('generated live-capture intent appears exactly once in the Wafra Sources phase',
      sourcesPhase.match(/WafraLiveCaptureIntent\.swift in Sources/g)?.length || 0, 1);
    eq('generated live-capture intent has exactly one file reference',
      xcodeProject.match(/\/\* WafraLiveCaptureIntent\.swift \*\/ = \{isa = PBXFileReference/g)?.length || 0,
      1);
    eq('existing history intent remains exactly once in the Wafra Sources phase',
      sourcesPhase.match(/WafraMessageHistoryIntent\.swift in Sources/g)?.length || 0, 1);
  }

  {
    const registryPath = path.join(ROOT, 'config/ios-bank-senders.json');
    const generatorPath = path.join(ROOT, 'scripts/generate-ios-bank-senders.mjs');
    const generatedTypeScriptPath = path.join(ROOT, 'src/lib/ios-bank-senders.generated.ts');
    const generatedSwiftPath = path.join(
      ROOT, 'modules/wafra-live-capture/ios/WafraBankSenderRegistry.generated.swift',
    );
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-ios-bank-senders-'));

    try {
      const generatedTypeScript = path.join(tempDirectory, 'ios-bank-senders.generated.ts');
      const generatedSwift = path.join(tempDirectory, 'WafraBankSenderRegistry.generated.swift');
      const runGenerator = (input, typeScriptOutput = generatedTypeScript, swiftOutput = generatedSwift) => spawnSync(process.execPath, [
        generatorPath, input, typeScriptOutput, swiftOutput,
      ], { encoding: 'utf8' });

      const generated = runGenerator(registryPath);
      ok('sender registry generator accepts the checked-in registry',
        generated.status === 0, generated.stderr || generated.stdout);
      eq('production sender registry remains empty without physical evidence',
        JSON.parse(fs.readFileSync(registryPath, 'utf8')), { v: 1, aliases: [] });

      const generatedAliases = execute('src/lib/ios-bank-senders.generated.ts', (id) => {
        throw new Error(`unexpected generated sender dependency ${id}`);
      });
      const senderRegistry = execute('src/lib/ios-bank-senders.ts', (id) => {
        if (id === '@/lib/ios-bank-senders.generated') return generatedAliases;
        throw new Error(`unexpected sender registry dependency ${id}`);
      });
      const { normalizeIosBankSender, iosBankSenderIdentity } = senderRegistry;
      const senderCases = [
        ['EMIRATES NBD', 'emiratesnbd'],
        ['Emirates-NBD', 'emiratesnbd'],
        ['Al_Rajhi.Bank', 'alrajhibank'],
        ['AB\u202eCD', null],
        ['', null],
        ['x'.repeat(81), null],
      ];
      for (const [input, expected] of senderCases) {
        eq(`sender normalization: ${JSON.stringify(input)}`,
          normalizeIosBankSender(input), expected);
      }
      const registryFixture = {
        v: 1,
        aliases: [{
          alias: 'EMIRATES NBD', market: 'AE', bankId: 'emirates-nbd', evidence: 'test-fixture',
        }],
      };
      ok('exact fixture sender is accepted',
        iosBankSenderIdentity('Emirates-NBD', registryFixture)?.bankId === 'emirates-nbd');
      ok('substring sender is refused',
        iosBankSenderIdentity('FAKE-EMIRATES-NBD-OFFER', registryFixture) === null);

      const duplicateRegistry = path.join(tempDirectory, 'duplicate.json');
      fs.writeFileSync(duplicateRegistry, JSON.stringify({
        v: 1,
        aliases: [
          { alias: 'EMIRATES NBD', market: 'AE', bankId: 'emirates-nbd', evidence: 'first' },
          { alias: 'Emirates-NBD', market: 'SA', bankId: 'al-rajhi', evidence: 'second' },
        ],
      }));
      const duplicate = runGenerator(duplicateRegistry);
      ok('generator rejects aliases that collide across bank identities',
        duplicate.status !== 0, duplicate.stderr || duplicate.stdout);

      const missingEvidenceRegistry = path.join(tempDirectory, 'missing-evidence.json');
      fs.writeFileSync(missingEvidenceRegistry, JSON.stringify({
        v: 1,
        aliases: [{ alias: 'EMIRATES NBD', market: 'AE', bankId: 'emirates-nbd' }],
      }));
      const missingEvidence = runGenerator(missingEvidenceRegistry);
      ok('generator rejects aliases without physical-message evidence',
        missingEvidence.status !== 0, missingEvidence.stderr || missingEvidence.stdout);

      const extraFieldRegistry = path.join(tempDirectory, 'extra-field.json');
      fs.writeFileSync(extraFieldRegistry, JSON.stringify({
        v: 1,
        aliases: [{
          alias: 'EMIRATES NBD', market: 'AE', bankId: 'emirates-nbd', evidence: 'fixture', note: 'no',
        }],
      }));
      const extraField = runGenerator(extraFieldRegistry);
      ok('generator rejects fields outside the closed alias contract',
        extraField.status !== 0, extraField.stderr || extraField.stdout);

      const extraRootFieldRegistry = path.join(tempDirectory, 'extra-root-field.json');
      fs.writeFileSync(extraRootFieldRegistry, JSON.stringify({ v: 1, aliases: [], unknown: true }));
      const extraRootField = runGenerator(extraRootFieldRegistry);
      ok('generator rejects fields outside the closed root contract',
        extraRootField.status !== 0, extraRootField.stderr || extraRootField.stdout);

      const blankEvidenceRegistry = path.join(tempDirectory, 'blank-evidence.json');
      fs.writeFileSync(blankEvidenceRegistry, JSON.stringify({
        v: 1,
        aliases: [{ alias: 'EMIRATES NBD', market: 'AE', bankId: 'emirates-nbd', evidence: '   ' }],
      }));
      const blankEvidence = runGenerator(blankEvidenceRegistry);
      ok('generator rejects blank physical-message evidence',
        blankEvidence.status !== 0, blankEvidence.stderr || blankEvidence.stdout);

      const invalidUnicodeRegistry = path.join(tempDirectory, 'invalid-unicode.json');
      fs.writeFileSync(invalidUnicodeRegistry, JSON.stringify({
        v: 1,
        aliases: [{
          alias: `BANK${String.fromCharCode(0xD800)}`, market: 'AE', bankId: 'bank-id', evidence: 'fixture',
        }],
      }));
      const invalidUnicode = runGenerator(invalidUnicodeRegistry);
      ok('generator rejects strings that cannot be represented in Swift literals',
        invalidUnicode.status !== 0, invalidUnicode.stderr || invalidUnicode.stdout);

      const unsortedRegistry = path.join(tempDirectory, 'unsorted.json');
      const sortedTypeScript = path.join(tempDirectory, 'sorted.generated.ts');
      const sortedSwift = path.join(tempDirectory, 'Sorted.generated.swift');
      fs.writeFileSync(unsortedRegistry, JSON.stringify({
        v: 1,
        aliases: [
          { alias: 'Z Bank', market: 'SA', bankId: 'z-bank', evidence: 'z' },
          { alias: 'A.Bank', market: 'AE', bankId: 'a-bank', evidence: 'a' },
        ],
      }));
      const unsorted = runGenerator(unsortedRegistry, sortedTypeScript, sortedSwift);
      ok('generator accepts a physically evidenced alias fixture',
        unsorted.status === 0, unsorted.stderr || unsorted.stdout);
      const sortedAliases = executeFile(sortedTypeScript, (id) => {
        throw new Error(`unexpected sorted sender dependency ${id}`);
      });
      eq('generator sorts aliases by normalized sender',
        sortedAliases.IOS_BANK_SENDER_ALIASES.map((entry) => entry.alias), ['A.Bank', 'Z Bank']);

      const parityRegistry = path.join(tempDirectory, 'parity.json');
      const parityTypeScript = path.join(tempDirectory, 'parity.generated.ts');
      const paritySwift = path.join(tempDirectory, 'Parity.generated.swift');
      fs.writeFileSync(parityRegistry, JSON.stringify({
        v: 1,
        aliases: [
          { alias: 'A \u0301B', market: 'AE', bankId: 'combining-bank', evidence: 'combining' },
          { alias: 'Quote"\\Bank', market: 'SA', bankId: 'bank-id"\\value', evidence: 'escaped' },
        ],
      }));
      const parity = runGenerator(parityRegistry, parityTypeScript, paritySwift);
      ok('generator accepts combining-mark and escaped-literal aliases',
        parity.status === 0, parity.stderr || parity.stdout);
      const parityAliases = executeFile(parityTypeScript, (id) => {
        throw new Error(`unexpected parity sender dependency ${id}`);
      });
      const paritySenderRegistry = execute('src/lib/ios-bank-senders.ts', (id) => {
        if (id === '@/lib/ios-bank-senders.generated') return parityAliases;
        throw new Error(`unexpected parity registry dependency ${id}`);
      });
      eq('TypeScript admits a combining mark after a removed separator',
        paritySenderRegistry.iosBankSenderIdentity('A \u0301B'),
        { market: 'AE', bankId: 'combining-bank' });
      eq('TypeScript preserves quote and backslash sender identity',
        paritySenderRegistry.iosBankSenderIdentity('Quote"\\Bank'),
        { market: 'SA', bankId: 'bank-id"\\value' });

      const paritySwiftTest = path.join(tempDirectory, 'WafraBankSenderRegistryParityTests.swift');
      const paritySwiftBinary = path.join(tempDirectory, 'WafraBankSenderRegistryParityTests');
      fs.writeFileSync(paritySwiftTest, `
import Foundation

@main
struct WafraBankSenderRegistryParityTests {
  static func main() {
    guard WafraBankSenderRegistry.identity(for: "A \\u{0301}B") == WafraBankSenderIdentity(market: "AE", bankId: "combining-bank"),
          WafraBankSenderRegistry.identity(for: #"Quote"\\Bank"#) == WafraBankSenderIdentity(market: "SA", bankId: #"bank-id"\\value"#) else {
      Foundation.exit(1)
    }
  }
}
`);
      const paritySwiftBuild = spawnSync('swiftc', [paritySwift, paritySwiftTest, '-o', paritySwiftBinary], { encoding: 'utf8' });
      const paritySwiftRun = paritySwiftBuild.status === 0
        ? spawnSync(paritySwiftBinary, [], { encoding: 'utf8' })
        : { status: -1, stderr: paritySwiftBuild.stderr || paritySwiftBuild.stdout };
      ok('Swift matches TypeScript for combining-mark and escaped sender aliases',
        paritySwiftRun.status === 0,
        paritySwiftBuild.stderr || paritySwiftBuild.stdout || paritySwiftRun.stderr || paritySwiftRun.stdout);

      const swiftTest = path.join(tempDirectory, 'WafraBankSenderRegistryTests.swift');
      const swiftBinary = path.join(tempDirectory, 'WafraBankSenderRegistryTests');
      fs.writeFileSync(swiftTest, `
import Foundation

@main
struct WafraBankSenderRegistryTests {
  static func main() {
    guard WafraBankSenderRegistry.identity(for: "A-Bank") == WafraBankSenderIdentity(market: "AE", bankId: "a-bank"),
          WafraBankSenderRegistry.identity(for: "FAKE-A-BANK-OFFER") == nil,
          WafraBankSenderRegistry.normalize("AB\\u{202E}CD") == nil else {
      Foundation.exit(1)
    }
  }
}
`);
      const swiftBuild = spawnSync('swiftc', [sortedSwift, swiftTest, '-o', swiftBinary], { encoding: 'utf8' });
      const swiftRun = swiftBuild.status === 0
        ? spawnSync(swiftBinary, [], { encoding: 'utf8' })
        : { status: -1, stderr: swiftBuild.stderr || swiftBuild.stdout };
      ok('generated Swift exactly admits and refuses sender aliases', swiftRun.status === 0,
        swiftBuild.stderr || swiftBuild.stdout || swiftRun.stderr || swiftRun.stdout);

      eq('generated Swift is current', fs.readFileSync(generatedSwift, 'utf8'),
        fs.readFileSync(generatedSwiftPath, 'utf8'));
      eq('generated TypeScript is current', fs.readFileSync(generatedTypeScript, 'utf8'),
        fs.readFileSync(generatedTypeScriptPath, 'utf8'));
      const swiftTypecheck = spawnSync('swiftc', ['-typecheck', generatedSwift], { encoding: 'utf8' });
      ok('generated Swift sender registry type-checks', swiftTypecheck.status === 0,
        swiftTypecheck.stderr || swiftTypecheck.stdout);
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  }

  {
    const identities = new Map([
      ['EMIRATESNBD', { market: 'AE', bankId: 'emirates-nbd' }],
      ['FAB', { market: 'AE', bankId: 'fab' }],
      ['FAB\n', { market: 'AE', bankId: 'fab' }],
      ['FAB\u202E', { market: 'AE', bankId: 'fab' }],
      ['ALRAJHI', { market: 'SA', bankId: 'al-rajhi' }],
      ['ENBDSPOOF', { market: 'AE', bankId: 'fab' }],
    ]);
    const identityInputs = [];
    const senderIdentity = (sender) => identities.get(
      (() => {
        identityInputs.push(sender);
        return sender.normalize('NFKC').toUpperCase().replace(/[ ._-]/g, '');
      })(),
    ) ?? null;
    const requireBuild = (id) => {
      if (id.startsWith('@/lib/')) {
        return require(path.join(ROOT, 'scripts/test/build', `${id.slice('@/lib/'.length)}.js`));
      }
      throw new Error(`unexpected local capture dependency ${id}`);
    };
    const localMessage = execute('src/lib/local-message-record.ts', (id) => {
      if (id === '@/lib/ios-bank-senders') return { iosBankSenderIdentity: senderIdentity };
      return requireBuild(id);
    });
    const localCapture = execute('src/lib/ios-local-capture.ts', (id) => {
      if (id === '@/lib/ios-bank-senders') return { iosBankSenderIdentity: senderIdentity };
      if (id === '@/lib/local-message-record') return localMessage;
      return requireBuild(id);
    });
    const productionLocalMessage = require('./build/local-message-record.js');
    const productionLocalCapture = require('./build/ios-local-capture.js');
    ok('every production alias agrees with the parser attribution bank ID',
      require('./build/ios-bank-senders.generated.js').IOS_BANK_SENDER_ALIASES.every((alias) => {
        const attributed = productionLocalMessage.attributeIosBankSender(alias.alias);
        return attributed?.market === alias.market && attributed.bankId === alias.bankId;
      }));
    const { createLaunchAlertSession } = require('./build/launch-alert-parser.js');
    const markets = require('./build/markets.js');
    const NOW = Date.parse('2026-08-25T12:00:00.000Z');
    const qualificationTypes = require('./build/types.js');
    const normalizeQualifications = qualificationTypes.normalizeLocalCaptureQualifications ??
      (() => []);
    const mergeQualifications = qualificationTypes.mergeLocalCaptureQualifications ??
      ((current) => current);
    const QUALIFICATION_TTL = 30 * 24 * 60 * 60 * 1000;
    const qualification = (id, kind, observedAt, expiresAt, extra = {}) => ({
      v: 1, id, kind, observedAt, expiresAt, ...extra,
    });
    {
      const reviewId = '20000000-0000-4000-8000-000000000001';
      const declineId = '20000000-0000-4000-8000-000000000002';
      const digestReviewId = 'a'.repeat(64);
      const merged = mergeQualifications([], [
        { id: reviewId, kind: 'review', observedAt: NOW - 2_000 },
        { id: declineId, kind: 'decline', observedAt: NOW - 1_000 },
        { id: digestReviewId, kind: 'review', observedAt: NOW - 500 },
      ], NOW);
      ok('qualification receipts contain only the closed source-free replay schema',
        merged.length === 3 && merged.every((receipt) =>
          JSON.stringify(Object.keys(receipt).sort()) ===
            JSON.stringify(['expiresAt', 'id', 'kind', 'observedAt', 'v']) &&
          receipt.expiresAt === NOW + QUALIFICATION_TTL) &&
          merged.some((receipt) => receipt.id === digestReviewId) &&
          !/(sender|body|text|merchant|amount|account|bank)/i.test(JSON.stringify(merged)),
        JSON.stringify(merged));
    }
    {
      const validId = '20000000-0000-4000-8000-000000000003';
      const duplicateId = '20000000-0000-4000-8000-000000000004';
      const normalized = normalizeQualifications([
        qualification(validId, 'review', NOW - 1_000, NOW + 1_000),
        qualification('b'.repeat(64), 'decline', NOW - 500, NOW + 1_000),
        qualification('B'.repeat(64), 'decline', NOW - 400, NOW + 1_000),
        qualification(duplicateId, 'review', NOW - 2_000, NOW + 2_000),
        qualification(duplicateId, 'decline', NOW - 2_000, NOW + 2_000),
        qualification('20000000-0000-4000-8000-000000000005', 'review', NOW - 1_000, NOW + 1_000,
          { sender: 'must-not-survive' }),
        qualification('not-a-uuid', 'review', NOW - 1_000, NOW + 1_000),
        qualification('20000000-0000-4000-8000-000000000006', 'review', NOW - 1_000, NOW),
      ], NOW);
      eq('hydration drops malformed, expired, closed-schema, and duplicate qualification identities',
        normalized.map((receipt) => receipt.id), [validId, 'b'.repeat(64)]);
    }
    {
      const oversized = Array.from({ length: 2001 }, (_, index) => qualification(
        `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        'review', NOW - 10_000 + index, NOW + QUALIFICATION_TTL,
      ));
      const normalized = normalizeQualifications(oversized, NOW);
      ok('qualification hydration caps receipts at 2,000 and prunes the oldest observation',
        normalized.length === 2000 && normalized[0]?.id.endsWith('000000000002') &&
          !normalized.some((receipt) => receipt.id.endsWith('000000000001')),
        JSON.stringify({ length: normalized.length, first: normalized[0]?.id }));
    }
    {
      const newlyPersistedId = '50000000-0000-4000-8000-000000000001';
      const stale = Array.from({ length: 2000 }, (_, index) => qualification(
        `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        'review', NOW - 1_000 + index, NOW + 1_000,
      ));
      const merged = mergeQualifications(stale, [{
        id: newlyPersistedId,
        kind: 'review',
        observedAt: NOW - 1_000_000,
      }], NOW);
      ok('receipt cap retains newly persisted evidence even when its observation is older',
        merged.length === 2000 && merged.some((receipt) => receipt.id === newlyPersistedId),
        JSON.stringify({ length: merged.length, retained: merged.some(
          (receipt) => receipt.id === newlyPersistedId,
        ) }));
    }
    {
      const incomingId = '70000000-0000-4000-8000-000000000001';
      const frozenClockReceipts = Array.from({ length: 2000 }, (_, index) => qualification(
        `60000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        'review', NOW - 1_000 + index, NOW + QUALIFICATION_TTL,
      ));
      const merged = mergeQualifications(frozenClockReceipts, [{
        id: incomingId, kind: 'review', observedAt: NOW - 1_000_000,
      }], NOW);
      ok('a frozen clock reserves same-expiry capacity for an older observed incoming receipt',
        merged.length === 2000 && merged.some((receipt) => receipt.id === incomingId),
        JSON.stringify({ retained: merged.some((receipt) => receipt.id === incomingId) }));
    }
    {
      const incomingIds = [
        '70000000-0000-4000-8000-000000000002',
        '70000000-0000-4000-8000-000000000003',
      ];
      const full = Array.from({ length: 2000 }, (_, index) => qualification(
        `71000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        'decline', NOW + index, NOW + QUALIFICATION_TTL,
      ));
      const merged = mergeQualifications(full, incomingIds.map((id, index) => ({
        id, kind: 'decline', observedAt: NOW - 2_000 - index,
      })), NOW);
      ok('capacity reservation retains every incoming receipt before pruning prior evidence',
        merged.length === 2000 && incomingIds.every((id) =>
          merged.some((receipt) => receipt.id === id)), JSON.stringify(incomingIds));
    }
    {
      const duplicateId = '72000000-0000-4000-8000-000000000001';
      ok('duplicate incoming receipt identities are rejected instead of partially retained',
        throws(() => mergeQualifications([], [
          { id: duplicateId, kind: 'review', observedAt: NOW - 1 },
          { id: duplicateId, kind: 'review', observedAt: NOW - 1 },
        ], NOW), /identity/i));
      const duplicatePrior = [
        qualification(duplicateId, 'review', NOW - 1, NOW + QUALIFICATION_TTL),
        qualification(duplicateId, 'review', NOW - 1, NOW + QUALIFICATION_TTL),
        ...Array.from({ length: 1999 }, (_, index) => qualification(
          `73000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
          'review', NOW + index, NOW + QUALIFICATION_TTL,
        )),
      ];
      const repaired = mergeQualifications(duplicatePrior, [{
        id: duplicateId, kind: 'review', observedAt: NOW - 1,
      }], NOW);
      ok('an incoming identity replaces ambiguous duplicate prior evidence and is reserved',
        repaired.length === 2000 &&
          repaired.filter((receipt) => receipt.id === duplicateId).length === 1,
        JSON.stringify({ length: repaired.length }));
    }
    {
      const tooMany = Array.from({ length: 2001 }, (_, index) => ({
        id: `74000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        kind: 'review', observedAt: NOW + index,
      }));
      ok('a cap-plus-one incoming receipt set is rejected before partial retention',
        throws(() => mergeQualifications([], tooMany, NOW), /identity|capacity|cap/i));
    }
    const AE_BODY = 'Purchase of AED 120.00 with Debit Card ending 1234 at CARREFOUR, DUBAI. Avl Balance is AED 5,000.00.';
    const SA_BODY = 'POS purchase of SAR 125.50 at JARIR BOOKSTORE using Mada Card ending 1234. Available balance SAR 2,500.00.';
    const REVIEW_BODY = 'AED 2,500.00 has been transferred to your FAB account from JOHN DOE';
    const DECLINE_BODY = 'Your transaction of AED 1,108.00 at NOON was declined due to insufficient funds.';
    let idSequence = 1;
    const nextId = () => `00000000-0000-4000-8000-${String(idSequence++).padStart(12, '0')}`;
    const envelope = ({
      v = 1,
      id = nextId(), text = AE_BODY, sender = 'EMIRATES NBD',
      observedAt = '2026-08-25T11:00:00.000Z', source = 'message', extra,
    } = {}) => JSON.stringify({ v, id, text, sender, observedAt, source, ...extra });
    const session = (market) => createLaunchAlertSession({
      overrides: {}, activeMarket: market, pinnedCurrency: market === 'AE' ? 'AED' : 'SAR',
    });

    markets.setActiveMarket('AE');
    const parsedId = nextId();
    const parsed = localMessage.parseLocalMessageRecord(
      envelope({ id: parsedId }), new Date(NOW), 'AE', session('AE'),
    );
    ok('local parser decodes an exact v1 envelope into a financial result',
      parsed.kind === 'parsed' && parsed.market === 'AE' && parsed.row.amountFils === 12000,
      JSON.stringify(parsed));
    ok('local parser removes raw text and sender before returning a row',
      parsed.kind === 'parsed' && !Object.hasOwn(parsed.row, 'raw') &&
        !Object.hasOwn(parsed.row, 'sender') && !JSON.stringify(parsed).includes(AE_BODY),
      JSON.stringify(parsed));
    ok('local parser carries the stable native identity into planning',
      parsed.kind === 'parsed' &&
        parsed.row.sourceEventId === parsedId,
      JSON.stringify(parsed));
    ok('local sender attribution agrees with the exact registry bank identity',
      parsed.kind === 'parsed' && parsed.row.bankHint === 'Emirates NBD', JSON.stringify(parsed));

    const unknownSenderEnvelope = envelope({ sender: 'UNKNOWN', text: AE_BODY });
    const unknownPreflight = localMessage.preflightLocalMessageRecord(
      unknownSenderEnvelope,
      new Date(NOW),
    );
    ok('sender-agnostic preflight keeps a valid unknown sender for the shared parser',
      unknownPreflight?.valid === true && unknownPreflight.attribution === null &&
        unknownPreflight.market === 'AE',
      JSON.stringify(unknownPreflight));
    const unknownParsed = localMessage.parseLocalMessageRecord(
      unknownSenderEnvelope,
      new Date(NOW),
      'AE',
      session('AE'),
    );
    ok('the shared parser—not the sender registry—accepts a supported unknown-sender alert',
      unknownParsed.kind === 'parsed' && unknownParsed.market === 'AE' &&
        unknownParsed.row.amountFils === 12000,
      JSON.stringify(unknownParsed));

    const digestId = '9'.repeat(64);
    const digestEnvelope = envelope({ id: digestId });
    const digestPreflight = localMessage.preflightLocalMessageRecord(
      digestEnvelope,
      new Date(NOW),
    );
    const digestParsed = localMessage.parseLocalMessageRecord(
      digestEnvelope,
      new Date(NOW),
      'AE',
      session('AE'),
    );
    ok('local capture accepts and preserves the canonical SHA-256 Message identity',
      digestPreflight?.valid === true && digestPreflight.id === digestId &&
        digestParsed.kind === 'parsed' && digestParsed.row.sourceEventId === digestId,
      JSON.stringify({ digestPreflight, digestParsed }));

    const productionSaudiEnvelope = envelope({ sender: 'ALRAJHI', text: SA_BODY });
    const productionSaudiPreflight = productionLocalMessage.preflightLocalMessageRecord(
      productionSaudiEnvelope,
      new Date(NOW),
    );
    ok('an unknown registry sender still routes from explicit Saudi launch evidence',
      productionSaudiPreflight?.valid === true &&
        productionSaudiPreflight.attribution === null &&
        productionSaudiPreflight.market === 'SA',
      JSON.stringify(productionSaudiPreflight));
    const ambiguousPreflight = productionLocalMessage.preflightLocalMessageRecord(
      envelope({ sender: 'UNKNOWN', text: 'AED 10.00 and SAR 10.00 card purchase' }),
      new Date(NOW),
    );
    ok('conflicting unknown-sender money systems fail closed at preflight',
      ambiguousPreflight?.valid === true && ambiguousPreflight.market === null,
      JSON.stringify(ambiguousPreflight));

    const invalidCases = [
      ['unknown envelope keys', envelope({ extra: { futureKey: true } })],
      ['malformed Unicode high surrogate', envelope({
        text: `AED 1.00 ${String.fromCharCode(0xD800)}`,
      })],
      ['malformed Unicode low surrogate', envelope({
        text: `AED 1.00 ${String.fromCharCode(0xDC00)}`,
      })],
      ['sender control characters', envelope({ sender: 'FAB\n' })],
      ['sender bidi controls', envelope({ sender: 'FAB\u202E' })],
      ['empty UTF-8 text', envelope({ text: '' })],
      ['oversized UTF-8 text', envelope({ text: '💳'.repeat(4097) })],
      ['negative observedAt', envelope({ observedAt: '1969-12-31T23:59:59.999Z' })],
      ['noncanonical observedAt without milliseconds', envelope({
        observedAt: '2026-08-25T11:00:00Z',
      })],
      ['noncanonical observedAt with an offset', envelope({
        observedAt: '2026-08-25T15:00:00.000+04:00',
      })],
      ['future observedAt', envelope({ observedAt: '2026-08-25T12:05:00.001Z' })],
      ['string envelope version', envelope({ v: '1' })],
      ['numeric envelope id', envelope({ id: 1 })],
      ['numeric envelope text', envelope({ text: 1 })],
      ['numeric envelope sender', envelope({ sender: 1 })],
      ['numeric envelope observedAt', envelope({ observedAt: 1 })],
      ['numeric envelope source', envelope({ source: 1 })],
      ['wrong source', envelope({ source: 'relay' })],
      ['invalid UUID', envelope({ id: 'not-a-uuid' })],
      ['uppercase SHA-256 identity', envelope({ id: 'A'.repeat(64) })],
    ];
    for (const [name, serialized] of invalidCases) {
      const result = localMessage.parseLocalMessageRecord(
        serialized, new Date(NOW), 'AE', session('AE'),
      );
      eq(`local parser rejects ${name} without source data`, result, { kind: 'invalid', milestone: 'none' });
    }
    const exactFutureBoundary = localMessage.parseLocalMessageRecord(
      envelope({ observedAt: '2026-08-25T12:05:00.000Z' }),
      new Date(NOW), 'AE', session('AE'),
    );
    ok('local parser accepts the exact configured future-skew boundary',
      exactFutureBoundary.kind !== 'invalid', JSON.stringify(exactFutureBoundary));

    let inspectedSender = null;
    let parsedMarket = null;
    const forced = localMessage.parseLocalMessageRecord(
      envelope(), new Date(NOW), 'AE', {
        inspect: (_text, sender) => { inspectedSender = sender; return null; },
        parse: (_text, _sender, _inspection, market) => {
          parsedMarket = market;
          return {
            kind: 'transaction', type: 'expense', amountFils: 100, currency: 'AED',
            merchant: 'Test', categoryGuess: 'other', categoryDeliberate: true,
          };
        },
        interpret: () => null,
        detectedMarket: () => null,
      },
    );
    ok('local parser passes exact sender to inspection and forces the registry market',
      forced.kind === 'parsed' && inspectedSender === 'EMIRATES NBD' && parsedMarket === 'AE',
      JSON.stringify({ forced, inspectedSender, parsedMarket }));

    markets.setActiveMarket('SA');
    const saParsed = localMessage.parseLocalMessageRecord(
      envelope({ text: SA_BODY, sender: 'ALRAJHI' }), new Date(NOW), 'SA', session('SA'),
    );
    ok('local parser reads a Saudi sender under the forced Saudi money system',
      saParsed.kind === 'parsed' && saParsed.market === 'SA' &&
        saParsed.row.currency === 'SAR' && saParsed.row.amountFils === 12550,
      JSON.stringify(saParsed));
    const unicode = localMessage.parseLocalMessageRecord(
      envelope({
        text: 'رصيد حسابك المتاح ٢٥٠٠ ريال',
        sender: 'ALRAJHI',
      }),
      new Date(NOW), 'SA', session('SA'),
    );
    ok('local parser accepts well-formed UTF-8 Arabic without relabelling it invalid',
      unicode.kind !== 'invalid', JSON.stringify(unicode));
    markets.setActiveMarket('AE');

    const ignored = localMessage.parseLocalMessageRecord(
      envelope({ text: 'Get 20% off at CARREFOUR when you use your card.' }),
      new Date(NOW), 'AE', session('AE'),
    );
    eq('local parser preserves Android promotion refusal semantics', ignored,
      { kind: 'ignored', market: 'AE', milestone: 'none' });
    const declined = localMessage.parseLocalMessageRecord(
      envelope({ text: DECLINE_BODY }), new Date(NOW), 'AE', session('AE'),
    );
    ok('local parser emits only source-free decline evidence',
      declined.kind === 'declined' && declined.row.reason === 'declined' &&
        !Object.hasOwn(declined.row, 'sender') && !JSON.stringify(declined).includes(DECLINE_BODY),
      JSON.stringify(declined));
    const review = localMessage.parseLocalMessageRecord(
      envelope({ text: REVIEW_BODY, sender: 'FAB' }), new Date(NOW), 'AE', session('AE'),
    );
    ok('local parser uses the shared review admission policy without returning source fields',
      review.kind === 'review' && review.item.market === 'AE' &&
        !Object.hasOwn(review.item, 'sender') && !Object.hasOwn(review.item, 'raw') &&
        !JSON.stringify(review).includes(REVIEW_BODY), JSON.stringify(review));

    const historicalParser = require('./build/historical-import.js');
    const parityFields = (row) => ({
      kind: row.kind,
      type: row.type,
      amountFils: row.amountFils,
      merchant: row.merchant,
      categoryGuess: row.categoryGuess,
      categoryDeliberate: row.categoryDeliberate,
      currency: row.currency,
      card: row.card,
      originalCurrency: row.originalCurrency,
      originalAmountMinor: row.originalAmountMinor,
      fxSource: row.fxSource,
      bankHint: row.bankHint,
      snapshotFils: row.snapshotFils,
      snapshotKind: row.snapshotKind,
    });
    const parityFixtures = [
      {
        name: 'ENBD foreign-currency purchase',
        sender: 'EMIRATES NBD',
        text: 'Purchase of USD 20.00 with Debit Card ending 4733 at CURSOR, AI POWERED IDE, +9715504. Avl Balance is AED 13,933.26.',
        overrides: {},
        kind: 'parsed',
      },
      {
        name: 'ADIB kindless Card',
        sender: 'ADIB',
        text: 'Your ADIB Card ending 4417 has been used for AED 250.00 at CARREFOUR. Your available limit is AED 8,240.00',
        overrides: {},
        kind: 'parsed',
      },
      {
        name: 'category override',
        sender: 'EMIRATES NBD',
        text: 'Purchase of AED 55.00 at MYSTERY VENDOR with card ending 1111',
        overrides: { 'mystery vendor': 'health' },
        kind: 'parsed',
      },
      {
        name: 'low-confidence income',
        sender: 'FAB',
        text: REVIEW_BODY,
        overrides: {},
        kind: 'review',
      },
      {
        name: 'promotion',
        sender: 'EMIRATES NBD',
        text: 'Get 20% off at CARREFOUR when you use your card.',
        overrides: {},
        kind: 'ignored',
      },
      {
        name: 'decline',
        sender: 'EMIRATES NBD',
        text: DECLINE_BODY,
        overrides: {},
        kind: 'declined',
      },
    ];
    for (let index = 0; index < parityFixtures.length; index += 1) {
      const fixture = parityFixtures[index];
      const eventId = (index + 10).toString(16).padStart(64, '0');
      const local = localMessage.parseLocalMessageRecord(
        envelope({ id: eventId, sender: fixture.sender, text: fixture.text }),
        new Date(NOW),
        'AE',
        createLaunchAlertSession({
          overrides: fixture.overrides,
          activeMarket: 'AE',
          pinnedCurrency: 'AED',
        }),
      );
      markets.setLedgerCurrency(null);
      markets.setActiveMarket('AE');
      const historyResult = historicalParser.parseHistoricalMessageRecords([
        JSON.stringify({
          v: 1,
          id: eventId,
          text: fixture.text,
          sender: fixture.sender,
          observedAt: undefined,
          receivedAt: '2026-08-25T11:00:00.000Z',
        }),
      ], fixture.overrides, new Date(NOW));
      const parity = fixture.kind === 'parsed'
        ? local.kind === 'parsed' && historyResult.parsed.length === 1 &&
          JSON.stringify(parityFields(local.row)) ===
            JSON.stringify(parityFields(historyResult.parsed[0]))
        : fixture.kind === 'review'
          ? local.kind === 'review' && historyResult.reviewCandidates.length === 1 &&
            local.item.id === historyResult.reviewCandidates[0].id &&
            local.item.sourceKey === historyResult.reviewCandidates[0].sourceKey &&
            JSON.stringify({
              market: local.item.market,
              amount: local.item.amount,
              direction: local.item.direction,
              family: local.item.family,
            }) === JSON.stringify({
              market: historyResult.reviewCandidates[0].market,
              amount: historyResult.reviewCandidates[0].amount,
              direction: historyResult.reviewCandidates[0].direction,
              family: historyResult.reviewCandidates[0].family,
            })
          : fixture.kind === 'declined'
            ? local.kind === 'declined' && historyResult.declined.length === 1 &&
              local.row.reason === historyResult.declined[0].reason
            : local.kind === 'ignored' && historyResult.ignoredCount === 1;
      ok(`Android-equivalent parser semantics match history and local: ${fixture.name}`,
        parity,
        JSON.stringify({ local, historyResult }));
    }

    {
      const eventId = '7'.repeat(64);
      const sender = 'UNLISTED-SENDER';
      const preflight = localMessage.preflightLocalMessageRecord(
        envelope({ id: eventId, sender, text: SA_BODY }),
        new Date(NOW),
      );
      const local = localMessage.parseLocalMessageRecord(
        envelope({ id: eventId, sender, text: SA_BODY }),
        new Date(NOW),
        'SA',
        createLaunchAlertSession({
          overrides: {},
          activeMarket: 'SA',
          pinnedCurrency: 'SAR',
        }),
      );
      markets.setLedgerCurrency(null);
      markets.setActiveMarket('SA');
      const history = historicalParser.parseHistoricalMessageRecords([
        JSON.stringify({
          v: 1,
          id: eventId,
          text: SA_BODY,
          sender,
          receivedAt: '2026-08-25T11:00:00.000Z',
        }),
      ], {}, new Date(NOW));
      ok('Android-equivalent all-Saudi unknown-sender semantics match history and local',
        preflight?.market === 'SA' && local.kind === 'parsed' &&
          history.parsed.length === 1 &&
          JSON.stringify(parityFields(local.row)) ===
            JSON.stringify(parityFields(history.parsed[0])),
        JSON.stringify({ preflight, local, history }));
      markets.setActiveMarket('AE');
    }

    const BASE_STATE = {
      hydrated: true,
      marketId: 'AE',
      reviewTray: { schemaVersion: 1, pending: [], tombstones: [], templateRules: [] },
      localCaptureQualifications: [],
      accounts: [], transactions: [], budgets: [], bills: [], cardDues: [], goals: [],
      accountHints: {}, merchantOverrides: {}, lastScanTs: 0, parserVersion: 0,
      onboardingPlan: null, onboardingCurrencyEvidence: null,
    };
    const nativeQueue = (initial, firstCapturedAt = null) => {
      let rows = [...initial];
      const calls = [];
      let milestone = firstCapturedAt;
      return {
        calls,
        acknowledged: [],
        milestones: [],
        pending: () => [...rows],
        async purgeExpired() { calls.push('purge'); return 0; },
        async listPendingRecords(limit) {
          calls.push(`list:${limit}`);
          return rows.slice(0, limit);
        },
        async acknowledgeRecords(ids) {
          calls.push('ack');
          this.acknowledged.push(...ids);
          const named = new Set(ids);
          rows = rows.filter((serialized) => !named.has(JSON.parse(serialized).id));
        },
        async getCaptureStatus() {
          return {
            enabled: true, pending: rows.length, dropped: 0, corrupt: false,
            warningId: null,
            setupProofVersion: 1, setupProofAt: NOW, firstCapturedAt: milestone,
          };
        },
        async recordFirstCapturedAt(value) {
          calls.push('milestone');
          this.milestones.push(value);
          milestone = milestone === null ? value : Math.min(milestone, value);
        },
        async setCaptureEnabled() {}, async acknowledgeCaptureWarning() { return true; },
        async eraseAll() {},
      };
    };
    const ledgerAdapter = (extra = {}) => {
      let state = { ...BASE_STATE };
      let generation = 0;
      const calls = [];
      let nextTx = 1;
      const value = {
        calls,
        getState: () => state,
        getStateGeneration: () => generation,
        setState: (next) => { state = next; },
        replaceState: (next) => {
          state = next;
          generation += 1;
        },
        setMarket(id) {
          calls.push(`market:${id}`);
          state = { ...state, marketId: id };
          markets.setActiveMarket(id);
          return true;
        },
        stageReviewAlerts(items, reviewQualifications = []) {
          calls.push(`review:${items.length}`);
          const pendingIds = new Set(state.reviewTray.pending.map((item) => item.id));
          const admittedItems = items.filter((item) => !pendingIds.has(item.id));
          const admittedReviewIds = new Set(admittedItems.map((item) => item.id));
          const qualifications = reviewQualifications
            .filter((candidate) => admittedReviewIds.has(candidate.reviewId))
            .map((candidate) => candidate.qualification);
          state = {
            ...state,
            reviewTray: {
              ...state.reviewTray,
              pending: [...state.reviewTray.pending, ...admittedItems],
            },
            localCaptureQualifications: mergeQualifications(
              state.localCaptureQualifications, qualifications, NOW,
            ),
          };
          return {
            admitted: admittedItems.length,
            qualificationIds: qualifications.map((candidate) => candidate.id),
            durable: Promise.resolve(),
          };
        },
        importBatch(batch, qualificationMappings = []) {
          calls.push('import');
          const qualifications = qualificationMappings.map((mapping) => mapping.qualification);
          const transactions = batch.transactions.map((row) => ({ ...row, id: `local-${nextTx++}` }));
          state = {
            ...state,
            transactions: [
              ...state.transactions.filter((row) =>
                !batch.updates.some((update) => update.id === row.id && update.remove)),
              ...transactions,
            ],
            accounts: [
              ...state.accounts,
              ...batch.newAccounts.map((row, index) => ({ ...row, id: `account-${index + 1}` })),
            ],
            cardDues: [
              ...state.cardDues,
              ...batch.newDues.map((row, index) => ({ ...row, id: `due-${index + 1}` })),
            ],
            lastScanTs: Math.max(state.lastScanTs, batch.lastScanTs),
            localCaptureQualifications: mergeQualifications(
              state.localCaptureQualifications, qualifications, NOW,
            ),
          };
          return {
            ids: transactions.map((row) => row.id),
            qualificationIds: qualifications.map((candidate) => candidate.id),
            durable: Promise.resolve(),
          };
        },
        async ensureDurable() { calls.push('ensure'); },
        ...extra,
      };
      return value;
    };
    const coordinator = (native, ledger, retireShortcutCapture = async () => 'not-needed') =>
      localCapture.createIosLocalCaptureCoordinator({ native, ledger, retireShortcutCapture });
    const coordinatorWithPlan = (native, ledger, changePlan) => {
      const importPlan = requireBuild('@/lib/import-plan');
      const captureWithPlan = execute('src/lib/ios-local-capture.ts', (id) => {
        if (id === '@/lib/ios-bank-senders') return { iosBankSenderIdentity: senderIdentity };
        if (id === '@/lib/local-message-record') return localMessage;
        if (id === '@/lib/import-plan') {
          return {
            ...importPlan,
            buildImportPlan: (...args) => changePlan(importPlan.buildImportPlan(...args)),
          };
        }
        return requireBuild(id);
      });
      return captureWithPlan.createIosLocalCaptureCoordinator({
        native,
        ledger,
        retireShortcutCapture: async () => 'not-needed',
      });
    };

    // Frozen universal-extractor probe, admitted only as an unqualified suggestion.
    {
      const eventId = 'e'.repeat(64);
      const text = 'Card purchase CAD 24.90 at MAPLE CAFE on 2026-09-05. Available balance CAD 500.00.';
      const genericEnvelope = envelope({ id: eventId, sender: 'UNLISTED-BANK', text });
      const local = productionLocalMessage.parseLocalMessageRecord(
        genericEnvelope, new Date(NOW), null, createLaunchAlertSession({ overrides: {} }),
      );
      ok('unregistered native financial alerts reach generic review without bank qualification',
        local.kind === 'review' && local.item.kind === 'universal' && local.milestone === 'none' &&
          local.item.sourceKey === `apple_message_review_source_${eventId}`, JSON.stringify(local));
      const native = nativeQueue([genericEnvelope]);
      const ledger = ledgerAdapter();
      ledger.setState({ ...BASE_STATE, marketId: 'SA' });
      const outcome = await coordinator(native, ledger).drain();
      ok('universal native review persists and acknowledges without importing or changing ledger market',
        outcome.reviews === 1 && outcome.imported === 0 && ledger.getState().marketId === 'SA' &&
          native.acknowledged.includes(eventId) && !ledger.calls.some((call) => call.startsWith('market:')),
        JSON.stringify({ outcome, calls: ledger.calls }));
      ok('universal native review cannot establish firstCapturedAt or a known-bank receipt',
        outcome.firstCapturedAt === null && native.milestones.length === 0 &&
          ledger.getState().localCaptureQualifications.length === 0);
      const failedNative = nativeQueue([genericEnvelope]);
      const failedLedger = ledgerAdapter({ stageReviewAlerts: () => ({ admitted: 1,
        durable: Promise.reject(new Error('review storage failed')) }) });
      await rejects(() => coordinator(failedNative, failedLedger).drain(), /review storage failed/);
      ok('failed universal review staging leaves the native source unacknowledged',
        failedNative.acknowledged.length === 0 && failedNative.pending().length === 1 &&
          failedNative.milestones.length === 0);
      const mixedNative = nativeQueue([
        envelope({ id: eventId, sender: 'UNLISTED-BANK', text, observedAt: '2026-08-25T10:00:00.000Z' }),
        envelope(),
      ]);
      const mixed = await coordinator(mixedNative, ledgerAdapter()).drain();
      ok('mixed native pages retain valid automatic rows without borrowing a generic review milestone',
        mixed.imported === 1 && mixed.reviews === 1 && mixedNative.acknowledged.length === 2 &&
          mixed.firstCapturedAt === Date.parse('2026-08-25T11:00:00.000Z'));
    }

    {
      const native = nativeQueue([envelope()]);
      const ledger = ledgerAdapter({ getStateGeneration: undefined });
      await rejects(() => coordinator(native, ledger).drain(), /generation/i);
      ok('a coordinator without a ledger generation accessor fails closed before mutation',
        ledger.calls.length === 0 && native.acknowledged.length === 0,
        JSON.stringify({ ledger: ledger.calls, native: native.calls }));
    }

    {
      const ae = envelope();
      const unknown = envelope({ sender: 'UNKNOWN' });
      const native = nativeQueue([ae, unknown]);
      identityInputs.length = 0;
      let identitiesBeforeMutation = [];
      const ledger = ledgerAdapter({
        importBatch: () => {
          identitiesBeforeMutation = [...identityInputs];
          return { ids: ['preflight'], durable: Promise.resolve() };
        },
      });
      await coordinator(native, ledger).drain();
      ok('the complete page identity preflight runs before any ledger mutation',
        identitiesBeforeMutation.includes('EMIRATES NBD') &&
          identitiesBeforeMutation.includes('UNKNOWN') && native.acknowledged.length === 2,
        JSON.stringify({ identitiesBeforeMutation, native: native.calls }));
    }

    {
      const aeId = nextId();
      const saId = nextId();
      const native = nativeQueue([
        envelope({ id: aeId, sender: 'EMIRATES NBD' }),
        envelope({ id: saId, sender: 'ALRAJHI', text: SA_BODY }),
      ]);
      const ledger = ledgerAdapter();
      const outcome = await coordinator(native, ledger).drain();
      ok('a mixed-market page drains one currency partition at a time without wedging',
        outcome.scanned === 2 && outcome.imported >= 1 &&
          native.acknowledged.includes(aeId) && native.acknowledged.includes(saId) &&
          ledger.calls.includes('market:SA'),
        JSON.stringify({ outcome, ledger: ledger.calls, native: native.calls }));
    }

    for (const [name, setter] of [
      ['missing', undefined],
      ['refused', () => false],
    ]) {
      const native = nativeQueue([envelope({ sender: 'ALRAJHI', text: SA_BODY })]);
      const ledger = ledgerAdapter({ setMarket: setter });
      await rejects(() => coordinator(native, ledger).drain(), /ledger currency/);
      ok(`${name} setMarket leaves the complete Saudi page queued`,
        native.acknowledged.length === 0 && !ledger.calls.includes('import'),
        JSON.stringify({ ledger: ledger.calls, native: native.calls }));
    }

    {
      const native = nativeQueue([envelope({ sender: 'ALRAJHI', text: SA_BODY })]);
      const ledger = ledgerAdapter();
      const outcome = await coordinator(native, ledger).drain();
      ok('a SAR page aligns an initially AED ledger before parsing and planning',
        ledger.getState().marketId === 'SA' && ledger.getState().transactions[0]?.amountFils === 12550 &&
          ledger.calls.indexOf('market:SA') < ledger.calls.indexOf('import') && outcome.imported === 1,
        JSON.stringify({ state: ledger.getState(), calls: ledger.calls, outcome }));
    }

    {
      markets.setLedgerCurrency(null);
      markets.setActiveMarket('AE');
      const native = nativeQueue([productionSaudiEnvelope]);
      const ledger = ledgerAdapter();
      const outcome = await productionLocalCapture.createIosLocalCaptureCoordinator({
        native,
        ledger,
        retireShortcutCapture: async () => 'not-needed',
      }).drain();
      ok('production unknown-sender capture aligns an AED ledger from explicit Saudi evidence',
        ledger.getState().marketId === 'SA' &&
          ledger.getState().transactions[0]?.amountFils === 12550 &&
          ledger.calls.indexOf('market:SA') < ledger.calls.indexOf('import') &&
          outcome.imported === 1,
        JSON.stringify({ state: ledger.getState(), calls: ledger.calls, outcome }));
    }

    {
      const reviewEventId = '6'.repeat(64);
      const native = nativeQueue([
        envelope({ id: reviewEventId, text: REVIEW_BODY, sender: 'FAB' }),
      ]);
      const ledger = ledgerAdapter();
      const outcome = await coordinator(native, ledger).drain();
      ok('SHA-256 local review identity survives the source-free durability receipt',
        outcome.reviews === 1 &&
          ledger.getState().localCaptureQualifications.some((receipt) =>
            receipt.id === reviewEventId && receipt.kind === 'review') &&
          native.acknowledged.includes(reviewEventId),
        JSON.stringify({ outcome, state: ledger.getState(), native: native.calls }));
    }

    {
      const firstId = nextId();
      const secondId = nextId();
      const first = envelope({ id: firstId });
      const second = envelope({ id: secondId });
      const native = nativeQueue([first, second]);
      const ledger = ledgerAdapter();
      const outcome = await coordinator(native, ledger).drain();
      const smsKeys = new Set(ledger.getState().transactions.map((row) => row.smsKey));
      ok('distinct local UUIDs with the same financial semantics remain distinct events',
        ledger.getState().transactions.length === 2 && outcome.scanned === 2 &&
          outcome.imported === 2 && smsKeys.size === 2 &&
          smsKeys.has(`h${firstId}`) && smsKeys.has(`h${secondId}`),
        JSON.stringify({ state: ledger.getState(), outcome }));
      eq('acknowledgement names the exact page snapshot IDs', native.acknowledged, [firstId, secondId]);
    }

    {
      const sharedId = '8'.repeat(64);
      const localOutcome = productionLocalMessage.parseLocalMessageRecord(
        envelope({ id: sharedId, sender: 'EMIRATES NBD', text: AE_BODY }),
        new Date(NOW),
        'AE',
        session('AE'),
      );
      const historyOutcome = historicalParser.parseHistoricalMessageRecords([
        JSON.stringify({
          v: 1,
          id: sharedId,
          text: AE_BODY,
          sender: 'EMIRATES NBD',
          receivedAt: '2026-08-25T11:00:00.000Z',
        }),
      ], {}, new Date(NOW));
      const ledger = ledgerAdapter();
      const planner = require('./build/import-plan.js').buildImportPlan;
      const localPlan = localOutcome.kind === 'parsed'
        ? planner([localOutcome.row], ledger.getState(), 0, new Date(NOW))
        : null;
      if (localPlan) ledger.importBatch(localPlan.batch);
      const historyPlan = planner(
        historyOutcome.parsed,
        ledger.getState(),
        0,
        new Date(NOW),
        historyOutcome.declined,
      );
      ok('local and history ingestion share the exact Message identity and dedupe once',
        localOutcome.kind === 'parsed' && localPlan?.txCount === 1 &&
          ledger.getState().transactions[0]?.smsKey === `h${sharedId}` &&
          historyOutcome.parsed[0]?.sourceEventId === sharedId &&
          historyPlan.txCount === 0 && ledger.getState().transactions.length === 1,
        JSON.stringify({ localOutcome, historyOutcome, localPlan, historyPlan }));
    }

    {
      const replayId = '7'.repeat(64);
      const ledger = ledgerAdapter();
      const first = await coordinator(
        nativeQueue([envelope({ id: replayId })]),
        ledger,
      ).drain();
      ledger.calls.length = 0;
      const secondNative = nativeQueue([envelope({ id: replayId })]);
      const second = await coordinator(secondNative, ledger).drain();
      ok('an exact local Message replay is idempotent after encrypted durability',
        first.imported === 1 && second.imported === 0 &&
          ledger.getState().transactions.length === 1 &&
          ledger.getState().transactions[0]?.smsKey === `h${replayId}` &&
          ledger.calls.includes('ensure') && secondNative.acknowledged.includes(replayId),
        JSON.stringify({ first, second, state: ledger.getState(), calls: ledger.calls }));
    }

    {
      const id = nextId();
      const native = nativeQueue([envelope({ id })]);
      const existing = ledgerAdapter();
      const { sourceEventId: _sourceEventId, ...relayParsed } = parsed.row;
      const relayRow = {
        ...relayParsed,
        channel: undefined,
        captureSource: 'shortcut',
      };
      const firstPlan = require('./build/import-plan.js').buildImportPlan(
        [relayRow], existing.getState(), relayRow.smsTs,
      );
      existing.importBatch(firstPlan.batch);
      existing.calls.length = 0;
      const outcome = await coordinator(native, existing).drain();
      ok('a relay/local semantic duplicate still qualifies only after ensureDurable',
        outcome.imported === 0 && existing.calls.includes('ensure') && native.milestones.length === 1,
        JSON.stringify({ outcome, calls: existing.calls, milestones: native.milestones }));
    }

    {
      const lateLedger = ledgerAdapter();
      const seeded = ledgerAdapter();
      const seedPlan = require('./build/import-plan.js').buildImportPlan(
        [parsed.row], seeded.getState(), parsed.row.smsTs,
      );
      seeded.importBatch(seedPlan.batch);
      const lateState = seeded.getState();
      lateLedger.stageReviewAlerts = (items, qualifications = []) => ({
        admitted: items.length,
        qualificationIds: qualifications.map((candidate) => candidate.qualification.id),
        durable: Promise.resolve().then(() => {
          lateLedger.setState({
            ...lateState,
            reviewTray: { ...lateState.reviewTray, pending: items },
            localCaptureQualifications: mergeQualifications(
              lateState.localCaptureQualifications,
              qualifications.map((candidate) => candidate.qualification),
              NOW,
            ),
          });
        }),
      });
      const native = nativeQueue([
        envelope({ id: parsedId }),
        envelope({ text: REVIEW_BODY, sender: 'FAB' }),
      ]);
      const outcome = await coordinator(native, lateLedger).drain();
      ok('planning rereads ledger state after the durable review receipt',
        outcome.imported === 0 && lateLedger.calls.includes('ensure') &&
          lateLedger.getState().transactions.length === 1,
        JSON.stringify({ outcome, calls: lateLedger.calls, state: lateLedger.getState() }));
    }

    {
      const durable = deferred();
      const id = nextId();
      const native = nativeQueue([envelope({ id })]);
      let exposedPage = [];
      native.listPendingRecords = async (limit) => {
        native.calls.push(`list:${limit}`);
        exposedPage = native.pending().slice(0, limit);
        return exposedPage;
      };
      const ledger = ledgerAdapter({
        importBatch: () => ({ ids: ['tx-1'], durable: durable.promise }),
      });
      const drain = coordinator(native, ledger);
      const pending = drain.drain();
      await nextMicrotask();
      ok('raw page strings are cleared from the JavaScript bridge buffer before durability waits',
        exposedPage.length === 1 && exposedPage[0] === '', JSON.stringify(exposedPage));
      eq('source is not acknowledged before durable save', native.acknowledged, []);
      durable.resolve();
      await pending;
      eq('source is acknowledged after durable save', native.acknowledged, [id]);
    }

    {
      const native = nativeQueue([envelope()]);
      const ledger = ledgerAdapter({
        importBatch: () => ({ ids: ['tx-1'], durable: Promise.reject(new Error('disk')) }),
      });
      await rejects(() => coordinator(native, ledger).drain(), /disk/);
      eq('failed storage leaves the whole source page queued', native.acknowledged, []);
    }

    for (const replacement of ['restore', 'clear', 'load-demo']) {
      for (const kind of ['review', 'financial']) {
        const durable = deferred();
        const native = nativeQueue([
          kind === 'review'
            ? envelope({ text: REVIEW_BODY, sender: 'FAB' })
            : envelope(),
        ]);
        const ledger = kind === 'review'
          ? ledgerAdapter({
              stageReviewAlerts: (items, qualifications = []) => ({
                admitted: items.length,
                qualificationIds: qualifications.map((entry) => entry.qualification.id),
                durable: durable.promise,
              }),
            })
          : ledgerAdapter({
              importBatch: () => ({
                ids: ['old-ledger-row'], qualificationIds: [], durable: durable.promise,
              }),
            });
        const pending = coordinator(native, ledger).drain();
        await nextMicrotask();
        ledger.replaceState({
          ...BASE_STATE,
          accounts: [{ id: `${replacement}-${kind}-ledger` }],
        });
        durable.resolve();
        await rejects(() => pending, /generation|replaced/i);
        ok(`${replacement} during ${kind} durability leaves the complete native page queued`,
          native.acknowledged.length === 0 && native.milestones.length === 0,
          JSON.stringify({ acknowledged: native.acknowledged, milestones: native.milestones }));
      }
    }

    {
      const releaseMilestone = deferred();
      const milestoneStarted = deferred();
      const native = nativeQueue([envelope()]);
      const recordMilestone = native.recordFirstCapturedAt.bind(native);
      native.recordFirstCapturedAt = async (value) => {
        milestoneStarted.resolve();
        await releaseMilestone.promise;
        await recordMilestone(value);
      };
      const ledger = ledgerAdapter();
      const pending = coordinator(native, ledger).drain();
      await milestoneStarted.promise;
      ledger.replaceState({ ...BASE_STATE, accounts: [{ id: 'milestone-replacement' }] });
      releaseMilestone.resolve();
      await rejects(() => pending, /generation|replaced/i);
      ok('a replacement across the native milestone boundary prevents acknowledgement',
        native.milestones.length === 1 && native.acknowledged.length === 0,
        JSON.stringify({ acknowledged: native.acknowledged, milestones: native.milestones }));
    }

    for (const [name, record] of [
      ['financial', envelope()],
      ['review', envelope({ text: REVIEW_BODY, sender: 'FAB' })],
    ]) {
      const native = nativeQueue([record]);
      const ledger = ledgerAdapter();
      await coordinator(native, ledger).drain();
      ok(`an unchanged generation admits the ordinary ${name} durability path`,
        native.acknowledged.length === 1,
        JSON.stringify({ acknowledged: native.acknowledged, generation: ledger.getStateGeneration() }));
    }

    for (const [name, reviewStage, expectedMilestone] of [
      ['admitted', (items, qualifications = []) => ({
        admitted: items.length,
        qualificationIds: qualifications.map((candidate) => candidate.qualification.id),
        durable: Promise.resolve(),
      }), 1],
      ['refused', () => ({ admitted: 0, qualificationIds: [], durable: Promise.resolve() }), 0],
      ['rejected', (_items, qualifications = []) => ({
        admitted: 1,
        qualificationIds: qualifications.map((candidate) => candidate.qualification.id),
        durable: Promise.reject(new Error('review disk')),
      }), null],
    ]) {
      const native = nativeQueue([envelope({ text: REVIEW_BODY, sender: 'FAB' })]);
      const ledger = ledgerAdapter({ stageReviewAlerts: reviewStage });
      if (name === 'rejected') {
        await rejects(() => coordinator(native, ledger).drain(), /review disk/);
        ok('a rejected review durability receipt leaves its page queued', native.acknowledged.length === 0);
      } else {
        const outcome = await coordinator(native, ledger).drain();
        ok(`${name} review receipt controls review qualification`,
          native.milestones.length === expectedMilestone &&
            outcome.reviews === (name === 'admitted' ? 1 : 0),
          JSON.stringify({ outcome, milestones: native.milestones }));
      }
    }

    {
      const earlierId = nextId();
      const laterId = nextId();
      const earlierAt = '2026-08-25T10:00:00.000Z';
      const laterAt = '2026-08-25T10:30:00.000Z';
      const native = nativeQueue([
        envelope({ id: earlierId, text: REVIEW_BODY, sender: 'FAB', observedAt: earlierAt }),
        envelope({ id: laterId, text: REVIEW_BODY, sender: 'FAB', observedAt: laterAt }),
      ]);
      const ledger = ledgerAdapter();
      ledger.stageReviewAlerts = (items, qualifications = []) => {
        const admittedItem = items[1];
        const admitted = qualifications.find((candidate) => candidate.reviewId === admittedItem.id) ?? {
          reviewId: admittedItem.id,
          qualification: { id: laterId, kind: 'review', observedAt: Date.parse(laterAt) },
        };
        ledger.setState({
          ...ledger.getState(),
          reviewTray: {
            ...ledger.getState().reviewTray,
            pending: [admittedItem],
          },
          localCaptureQualifications: mergeQualifications(
            ledger.getState().localCaptureQualifications, [admitted.qualification], NOW,
          ),
        });
        return {
          admitted: 1,
          qualificationIds: [admitted.qualification.id],
          durable: Promise.resolve(),
        };
      };
      const outcome = await coordinator(native, ledger).drain();
      ok('an earlier rejected review cannot outrank the exact later admitted identity',
        outcome.reviews === 1 && native.milestones[0] === Date.parse(laterAt) &&
          ledger.getState().localCaptureQualifications[0]?.id === laterId,
        JSON.stringify({ outcome, milestones: native.milestones,
          receipts: ledger.getState().localCaptureQualifications }));
    }

    for (const [name, qualificationIds] of [
      ['duplicate', (id) => [id, id]],
      ['malformed', () => [null]],
      ['candidate mismatch', () => ['ffffffff-ffff-4fff-8fff-ffffffffffff']],
    ]) {
      const id = nextId();
      const native = nativeQueue([envelope({ id, text: REVIEW_BODY, sender: 'FAB' })]);
      const ledger = ledgerAdapter({
        stageReviewAlerts: (_items, qualifications = []) => ({
          admitted: 1,
          qualificationIds: qualificationIds(qualifications[0]?.qualification.id ?? id),
          durable: Promise.resolve(),
        }),
      });
      await rejects(() => coordinator(native, ledger).drain(), /review receipt|qualification/i);
      ok(`${name} review qualification identities fail closed before milestone and ack`,
        native.milestones.length === 0 && native.acknowledged.length === 0,
        JSON.stringify({ milestones: native.milestones, acknowledged: native.acknowledged }));
    }

    {
      const firstId = nextId();
      const secondId = nextId();
      const native = nativeQueue([
        envelope({ id: firstId, text: REVIEW_BODY, sender: 'FAB' }),
        envelope({ id: secondId, text: REVIEW_BODY, sender: 'FAB' }),
      ]);
      const ledger = ledgerAdapter({
        stageReviewAlerts: (_items, qualifications = []) => ({
          admitted: 2,
          qualificationIds: [
            qualifications[0]?.qualification.id,
            qualifications[0]?.qualification.id,
          ],
          durable: Promise.resolve(),
        }),
      });
      await rejects(() => coordinator(native, ledger).drain(), /review receipt|qualification/i);
      ok('duplicate review identities fail even when receipt count matches admission count',
        native.milestones.length === 0 && native.acknowledged.length === 0,
        JSON.stringify({ milestones: native.milestones, acknowledged: native.acknowledged }));
    }

    {
      const id = nextId();
      const native = nativeQueue([envelope({ id, text: REVIEW_BODY, sender: 'FAB' })]);
      const ledger = ledgerAdapter();
      let durableAttempts = 0;
      ledger.ensureDurable = async () => {
        durableAttempts += 1;
        if (durableAttempts === 1) throw new Error('later ledger fence');
      };
      const drain = coordinator(native, ledger);
      await rejects(() => drain.drain(), /later ledger fence/);
      ok('durable review admission keeps an atomic source-free qualification after a later fence fails',
        ledger.getState().localCaptureQualifications.some((receipt) => receipt.id === id) &&
          native.milestones.length === 0 && native.acknowledged.length === 0,
        JSON.stringify({ state: ledger.getState(), native }));
      await nextMicrotask();
      const retried = await drain.drain();
      ok('a retry qualifies the duplicate review from its persisted receipt',
        retried.reviews === 0 && native.milestones.length === 1 &&
          native.acknowledged[0] === id,
        JSON.stringify({ retried, milestones: native.milestones }));
    }

    {
      const id = nextId();
      const native = nativeQueue([envelope({ id, text: REVIEW_BODY, sender: 'FAB' })]);
      const recordMilestone = native.recordFirstCapturedAt.bind(native);
      let milestoneAttempts = 0;
      native.recordFirstCapturedAt = async (value) => {
        milestoneAttempts += 1;
        if (milestoneAttempts === 1) throw new Error('milestone disk');
        return recordMilestone(value);
      };
      const firstLedger = ledgerAdapter();
      await rejects(() => coordinator(native, firstLedger).drain(), /milestone disk/);
      const persistedState = JSON.parse(JSON.stringify(firstLedger.getState()));
      ok('review qualification is durable before a milestone failure',
        persistedState.localCaptureQualifications.some((receipt) => receipt.id === id) &&
          native.acknowledged.length === 0, JSON.stringify(persistedState));
      const recreatedLedger = ledgerAdapter();
      recreatedLedger.setState(persistedState);
      const retried = await coordinator(native, recreatedLedger).drain();
      ok('coordinator and ledger recreation replay the persisted review qualification',
        retried.reviews === 0 && native.milestones.length === 1 &&
          native.acknowledged[0] === id && milestoneAttempts === 2,
        JSON.stringify({ retried, milestones: native.milestones, milestoneAttempts }));
    }

    {
      const declinedId = nextId();
      const native = nativeQueue([envelope({ id: declinedId, text: DECLINE_BODY })]);
      const ledger = ledgerAdapter();
      const outcome = await coordinator(native, ledger).drain();
      ok('a no-op decline is acknowledged without claiming a milestone',
        outcome.declined === 0 && native.milestones.length === 0 &&
          native.acknowledged[0] === declinedId,
        JSON.stringify({ outcome, native }));
    }

    {
      const observedAt = '2026-08-25T10:30:00.000Z';
      const ts = Date.parse(observedAt);
      const native = nativeQueue([envelope({ text: DECLINE_BODY, observedAt })]);
      const ledger = ledgerAdapter();
      ledger.setState({
        ...ledger.getState(),
        transactions: [{
          id: 'prior-decline', type: 'expense', amountFils: 110800, category: 'other',
          accountId: 'main', title: 'Noon', date: '2026-08-25', source: 'sms',
          ts, smsKey: `h00000000-0000-4000-8000-${String(idSequence - 1).padStart(12, '0')}`,
        }],
      });
      const outcome = await coordinator(native, ledger).drain();
      ok('an admitted decline reconciliation qualifies from the planner receipt only',
        outcome.declined === 1 && native.milestones[0] === ts,
        JSON.stringify({ outcome, calls: ledger.calls, milestones: native.milestones }));
    }

    {
      const id = nextId();
      const observedAt = '2026-08-25T10:30:00.000Z';
      const ts = Date.parse(observedAt);
      const native = nativeQueue([envelope({ id, text: DECLINE_BODY, observedAt })]);
      const ledger = ledgerAdapter();
      ledger.setState({
        ...ledger.getState(),
        transactions: [{
          id: 'planner-attested-row', type: 'expense', amountFils: 110800,
          category: 'other', accountId: 'main', title: 'Noon', date: '2026-08-25',
          source: 'sms', ts, smsKey: `s${ts}-110800`,
        }],
      });
      const drain = coordinatorWithPlan(native, ledger, (plan) => ({
        ...plan,
        declineReconciliations: [{
          localRecordId: id,
          removedTransactionId: 'different-ledger-row',
        }],
      }));
      await rejects(() => drain.drain(), /decline|qualification|mapping/i);
      ok('a planner removal mapping mismatch fails before import, milestone, or ack',
        !ledger.calls.includes('import') && native.milestones.length === 0 &&
          native.acknowledged.length === 0,
        JSON.stringify({ ledger: ledger.calls, native }));
    }

    {
      const earlierId = nextId();
      const laterId = nextId();
      const earlierAt = '2026-08-25T10:00:00.000Z';
      const laterAt = '2026-08-25T10:30:00.000Z';
      const laterTs = Date.parse(laterAt);
      const native = nativeQueue([
        envelope({ id: earlierId, text: DECLINE_BODY, observedAt: earlierAt }),
        envelope({ id: laterId, text: DECLINE_BODY, observedAt: laterAt }),
      ]);
      const recordMilestone = native.recordFirstCapturedAt.bind(native);
      let milestoneAttempts = 0;
      native.recordFirstCapturedAt = async (value) => {
        milestoneAttempts += 1;
        if (milestoneAttempts === 1) throw new Error('decline milestone disk');
        return recordMilestone(value);
      };
      const ledger = ledgerAdapter();
      ledger.setState({
        ...ledger.getState(),
        transactions: [{
          id: 'later-prior-decline', type: 'expense', amountFils: 110800, category: 'other',
          accountId: 'main', title: 'Noon', date: '2026-08-25', source: 'sms',
          ts: laterTs, smsKey: `s${laterTs}-110800`,
        }],
      });
      const drain = coordinator(native, ledger);
      await rejects(() => drain.drain(), /decline milestone disk/);
      ok('only the later reconciled decline identity is persisted atomically with removal',
        ledger.getState().transactions.length === 0 &&
          JSON.stringify(ledger.getState().localCaptureQualifications.map((receipt) => receipt.id)) ===
            JSON.stringify([laterId]) && native.acknowledged.length === 0,
        JSON.stringify({ state: ledger.getState(), native }));
      await nextMicrotask();
      const retried = await drain.drain();
      ok('a retry qualifies a now-no-op decline from its persisted exact receipt',
        retried.declined === 0 && native.milestones[0] === laterTs &&
          native.acknowledged.length === 2,
        JSON.stringify({ retried, milestones: native.milestones }));
    }

    for (const [name, qualificationIds] of [
      ['duplicate', (id) => [id, id]],
      ['malformed', () => [null]],
      ['candidate mismatch', () => ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee']],
    ]) {
      const id = nextId();
      const observedAt = '2026-08-25T10:30:00.000Z';
      const ts = Date.parse(observedAt);
      const native = nativeQueue([envelope({ id, text: DECLINE_BODY, observedAt })]);
      const ledger = ledgerAdapter({
        importBatch: (_batch, qualificationMappings = []) => ({
          ids: [],
          qualificationIds: qualificationIds(
            qualificationMappings[0]?.qualification.id ?? id,
          ),
          durable: Promise.resolve(),
        }),
      });
      ledger.setState({
        ...ledger.getState(),
        transactions: [{
          id: `receipt-${name}`, type: 'expense', amountFils: 110800, category: 'other',
          accountId: 'main', title: 'Noon', date: '2026-08-25', source: 'sms',
          ts, smsKey: `s${ts}-110800`,
        }],
      });
      await rejects(() => coordinator(native, ledger).drain(), /decline receipt|qualification/i);
      ok(`${name} decline qualification identities fail closed before milestone and ack`,
        native.milestones.length === 0 && native.acknowledged.length === 0,
        JSON.stringify({ milestones: native.milestones, acknowledged: native.acknowledged }));
    }

    {
      const firstId = nextId();
      const secondId = nextId();
      const firstAt = '2026-08-25T10:20:00.000Z';
      const secondAt = '2026-08-25T10:30:00.000Z';
      const firstTs = Date.parse(firstAt);
      const secondTs = Date.parse(secondAt);
      const native = nativeQueue([
        envelope({ id: firstId, text: DECLINE_BODY, observedAt: firstAt }),
        envelope({ id: secondId, text: DECLINE_BODY, observedAt: secondAt }),
      ]);
      const ledger = ledgerAdapter({
        importBatch: (_batch, qualificationMappings = []) => ({
          ids: [],
          qualificationIds: [
            qualificationMappings[0]?.qualification.id,
            qualificationMappings[0]?.qualification.id,
          ],
          durable: Promise.resolve(),
        }),
      });
      ledger.setState({
        ...ledger.getState(),
        transactions: [firstTs, secondTs].map((ts, index) => ({
          id: `duplicate-decline-${index}`, type: 'expense', amountFils: 110800,
          category: 'other', accountId: 'main', title: 'Noon', date: '2026-08-25',
          source: 'sms', ts, smsKey: `s${ts}-110800`,
        })),
      });
      await rejects(() => coordinator(native, ledger).drain(), /decline receipt|qualification/i);
      ok('duplicate decline identities fail even when receipt count matches reconciliation count',
        native.milestones.length === 0 && native.acknowledged.length === 0,
        JSON.stringify({ milestones: native.milestones, acknowledged: native.acknowledged }));
    }

    {
      const financialId = nextId();
      const noOpDeclineId = nextId();
      const native = nativeQueue([
        envelope({ id: financialId }),
        envelope({ id: noOpDeclineId, text: DECLINE_BODY }),
      ]);
      const ledger = ledgerAdapter({
        importBatch: () => ({
          ids: ['financial-row'],
          qualificationIds: [noOpDeclineId],
          durable: Promise.resolve(),
        }),
      });
      await rejects(() => coordinator(native, ledger).drain(), /decline receipt|qualification/i);
      ok('an import receipt cannot qualify a planner-refused no-op decline',
        native.milestones.length === 0 && native.acknowledged.length === 0,
        JSON.stringify({ milestones: native.milestones, acknowledged: native.acknowledged }));
    }

    {
      const id = nextId();
      const native = nativeQueue([envelope({ id })]);
      const acknowledge = native.acknowledgeRecords.bind(native);
      let acknowledgements = 0;
      native.acknowledgeRecords = async (ids) => {
        acknowledgements += 1;
        if (acknowledgements === 1) throw new Error('native ack disk');
        return acknowledge(ids);
      };
      const ledger = ledgerAdapter();
      const drain = coordinator(native, ledger);
      await rejects(() => drain.drain(), /native ack disk/);
      ok('milestone success survives a later acknowledgement failure',
        native.milestones.length === 1 && native.pending().length === 1,
        JSON.stringify({ milestones: native.milestones, pending: native.pending().length }));
      await nextMicrotask();
      await drain.drain();
      ok('ack retry preserves the one native milestone and drains the exact queued record',
        native.milestones.length === 1 && native.acknowledged[0] === id &&
          native.pending().length === 0,
        JSON.stringify({ milestones: native.milestones, acknowledged: native.acknowledged }));
    }

    {
      const native = nativeQueue([envelope({ text: 'Your available balance is AED 5,000.00.' })]);
      const ledger = ledgerAdapter();
      const outcome = await coordinator(native, ledger).drain();
      ok('a balance-only page stays informational review and crosses durability before acknowledgement',
        outcome.reviews === 1 && outcome.imported === 0 && outcome.firstCapturedAt === null &&
          ledger.calls.includes('ensure') && native.acknowledged.length === 1,
        JSON.stringify({ outcome, calls: ledger.calls }));
    }

    {
      const native = nativeQueue([envelope({ text: 'Get 20% off at CARREFOUR when you use your card.' })]);
      const ledger = ledgerAdapter();
      const outcome = await coordinator(native, ledger).drain();
      ok('an all-ignored promotion page still crosses ensureDurable before acknowledgement',
        outcome.ignored === 1 && outcome.reviews === 0 && ledger.calls.includes('ensure') &&
          native.acknowledged.length === 1, JSON.stringify({ outcome, calls: ledger.calls }));
    }

    {
      const rows = Array.from({ length: 2050 }, (_, index) => envelope({
        id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        text: 'Your available balance is AED 5,000.00.',
      }));
      const native = nativeQueue(rows);
      const ledger = ledgerAdapter();
      const pending = coordinator(native, ledger).drain();
      await nextMicrotask();
      ok('multi-page draining yields instead of consuming all pages in one turn',
        native.acknowledged.length < 2000, native.acknowledged.length);
      const outcome = await pending;
      ok('drain stops at the exact 40-by-50 queue capacity bound',
        outcome.scanned === 2000 && native.acknowledged.length === 2000 &&
          native.pending().length === 50,
        JSON.stringify({ outcome, remaining: native.pending().length }));
    }

    {
      const latest = envelope({ observedAt: '2026-08-25T11:00:00.000Z' });
      const earliest = envelope({ observedAt: '2026-08-25T10:00:00.000Z' });
      const native = nativeQueue([latest, earliest]);
      await coordinator(native, ledgerAdapter()).drain();
      eq('the earliest qualifying observedAt becomes the one local milestone',
        native.milestones, [Date.parse('2026-08-25T10:00:00.000Z')]);
    }

    {
      const durable = deferred();
      const native = nativeQueue([envelope()]);
      const ledger = ledgerAdapter({
        importBatch: () => ({ ids: ['joined'], durable: durable.promise }),
      });
      const drain = coordinator(native, ledger);
      const first = drain.drain();
      const second = drain.drain();
      ok('concurrent drain calls join the exact one in-flight promise', first === second);
      durable.resolve();
      await Promise.all([first, second]);
      ok('joined drains execute native purge and acknowledgement only once',
        native.calls.filter((call) => call === 'purge').length === 1 &&
          native.calls.filter((call) => call === 'ack').length === 1,
        JSON.stringify(native.calls));
    }

    {
      const firstDurable = deferred();
      const firstNative = nativeQueue([envelope()]);
      const secondNative = nativeQueue([envelope()]);
      const firstLedger = ledgerAdapter({
        importBatch: () => ({ ids: ['first-instance'], durable: firstDurable.promise }),
      });
      const secondLedger = ledgerAdapter();
      const firstCoordinator = coordinator(firstNative, firstLedger);
      const secondCoordinator = coordinator(secondNative, secondLedger);
      const first = firstCoordinator.drain();
      await nextMicrotask();
      const second = secondCoordinator.drain();
      ok('different coordinator instances receive distinct drain promises', first !== second);
      await nextMicrotask();
      ok('a second coordinator instance waits behind the first without using its dependencies',
        secondNative.calls.length === 0 && firstNative.calls.includes('purge'),
        JSON.stringify({ first: firstNative.calls, second: secondNative.calls }));
      firstDurable.resolve();
      await Promise.all([first, second]);
      ok('the queued coordinator runs afterward with only its own native and ledger dependencies',
        firstNative.acknowledged.length === 1 && secondNative.acknowledged.length === 1 &&
          secondLedger.getState().transactions.length === 1,
        JSON.stringify({ first: firstNative.calls, second: secondNative.calls }));
    }

    {
      const failedDurable = deferred();
      const failedNative = nativeQueue([envelope()]);
      const recoveryNative = nativeQueue([envelope()]);
      const failed = coordinator(failedNative, ledgerAdapter({
        importBatch: () => ({ ids: ['failed-instance'], durable: failedDurable.promise }),
      })).drain();
      await nextMicrotask();
      const recovered = coordinator(recoveryNative, ledgerAdapter()).drain();
      failedDurable.reject(new Error('first coordinator disk'));
      const results = await Promise.allSettled([failed, recovered]);
      ok('a rejected coordinator does not poison the FIFO or reject the next instance',
        results[0].status === 'rejected' && results[1].status === 'fulfilled' &&
          failedNative.acknowledged.length === 0 && recoveryNative.acknowledged.length === 1,
        JSON.stringify(results.map((result) => result.status)));
    }

    {
      const firstNative = nativeQueue([envelope()]);
      const secondNative = nativeQueue([envelope()]);
      let firstRetirements = 0;
      let secondRetirements = 0;
      await coordinator(firstNative, ledgerAdapter(), async () => {
        firstRetirements += 1;
        return 'complete';
      }).drain();
      await coordinator(secondNative, ledgerAdapter(), async () => {
        secondRetirements += 1;
        return 'complete';
      }).drain();
      ok('coordinator recreation uses the replacement dependency set',
        firstRetirements === 1 && secondRetirements === 1 &&
          firstNative.acknowledged.length === 1 && secondNative.acknowledged.length === 1,
        JSON.stringify({ firstRetirements, secondRetirements }));
    }

    for (const [name, retire, expected] of [
      ['success', false, 'complete'],
      ['failure', true, 'retry-needed'],
    ]) {
      const native = nativeQueue([envelope()]);
      const drain = coordinator(native, ledgerAdapter(), async () => {
        native.calls.push('retire');
        if (retire) throw new Error('relay');
        return 'complete';
      });
      const outcome = await drain.drain();
      ok(`retirement ${name} occurs after durable acknowledgement without rejecting`,
        outcome.retirement === expected &&
          native.calls.indexOf('ack') < native.calls.indexOf('retire'),
        JSON.stringify({ outcome, calls: native.calls }));
    }

    {
      const native = nativeQueue([envelope()]);
      const readStatus = native.getCaptureStatus.bind(native);
      let statusReads = 0;
      native.getCaptureStatus = async () => {
        statusReads += 1;
        if (statusReads > 1) throw new Error('native status unavailable');
        return readStatus();
      };
      const outcome = await coordinator(
        native, ledgerAdapter(), async () => 'complete',
      ).drain();
      ok('a retirement status-read failure cannot reject an already durable acknowledgement',
        outcome.retirement === 'retry-needed' && native.acknowledged.length === 1,
        JSON.stringify({ outcome, calls: native.calls }));
    }

    {
      const prior = Date.parse('2026-08-24T10:00:00.000Z');
      const native = nativeQueue([envelope()], prior);
      const outcome = await coordinator(native, ledgerAdapter()).drain();
      ok('an existing earlier native milestone is preserved without a second record call',
        outcome.firstCapturedAt === prior && native.milestones.length === 0,
        JSON.stringify({ outcome, milestones: native.milestones }));
    }

    {
      const prior = Date.parse('2026-08-25T11:30:00.000Z');
      const earlier = Date.parse('2026-08-25T10:00:00.000Z');
      const native = nativeQueue([
        envelope({ observedAt: new Date(earlier).toISOString() }),
      ], prior);
      const outcome = await coordinator(native, ledgerAdapter()).drain();
      ok('a queued earlier qualification corrects an existing later native milestone',
        outcome.firstCapturedAt === earlier && native.milestones.length === 1 &&
          native.milestones[0] === earlier,
        JSON.stringify({ outcome, milestones: native.milestones }));
    }

    for (const [name, observedAt] of [
      ['equal', '2026-08-25T10:00:00.000Z'],
      ['later', '2026-08-25T11:00:00.000Z'],
    ]) {
      const prior = Date.parse('2026-08-25T10:00:00.000Z');
      const native = nativeQueue([envelope({ observedAt })], prior);
      const outcome = await coordinator(native, ledgerAdapter()).drain();
      ok(`an ${name} queued qualification does not rewrite the native milestone`,
        outcome.firstCapturedAt === prior && native.milestones.length === 0,
        JSON.stringify({ outcome, milestones: native.milestones }));
    }

    {
      const prior = Date.parse('2026-08-25T10:30:00.000Z');
      const later = envelope({ observedAt: '2026-08-25T11:00:00.000Z' });
      const earlier = envelope({ observedAt: '2026-08-25T10:00:00.000Z' });
      const native = nativeQueue([later, earlier], prior);
      const listPage = native.listPendingRecords.bind(native);
      native.listPendingRecords = async (limit) => (await listPage(limit)).slice(0, 1);
      const outcome = await coordinator(native, ledgerAdapter()).drain();
      ok('a later page can correct the native milestone after an earlier page did not',
        outcome.scanned === 2 &&
          outcome.firstCapturedAt === Date.parse('2026-08-25T10:00:00.000Z') &&
          native.milestones.length === 1 &&
          native.milestones[0] === Date.parse('2026-08-25T10:00:00.000Z'),
        JSON.stringify({ outcome, milestones: native.milestones }));
    }

    {
      let attempts = 0;
      const native = nativeQueue([], NOW - 1_000);
      const drain = coordinator(native, ledgerAdapter(), async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('retry');
        return 'complete';
      });
      eq('coordinator-owned retirement retry reports a source-free pending state',
        await drain.retryRetirementIfNeeded(), 'retry-needed');
      eq('coordinator-owned retirement retry can later complete',
        await drain.retryRetirementIfNeeded(), 'complete');
      ok('only the coordinator-owned retry invokes scoped relay retirement', attempts === 2, attempts);
    }

    {
      const durable = deferred();
      const id = nextId();
      const native = nativeQueue([envelope({ id })]);
      const localLedger = ledgerAdapter();
      localLedger.importBatch = () => {
        localLedger.calls.push('import');
        return { ids: ['privacy-fence'], durable: durable.promise };
      };
      let retirements = 0;
      const localCoordinator = coordinator(native, localLedger, async () => {
        retirements += 1;
        return 'complete';
      });
      const pending = localCoordinator.drain();
      for (let attempt = 0; attempt < 5 && !localLedger.calls.includes('import'); attempt += 1) {
        await nextMicrotask();
      }
      localLedger.setState({ ...localLedger.getState(), captureOptOut: true });
      durable.resolve();
      await pending;
      ok('local privacy fence: opt-out during durability leaves native evidence queued',
        localLedger.calls.includes('import') && native.acknowledged.length === 0 &&
          native.milestones.length === 0 && retirements === 0,
        JSON.stringify({ ledger: localLedger.calls, native: native.calls, retirements }));
    }

    {
      const id = nextId();
      const native = nativeQueue([envelope({ id })]);
      const localLedger = ledgerAdapter();
      const list = native.listPendingRecords.bind(native);
      native.listPendingRecords = async (limit) => {
        const page = await list(limit);
        localLedger.setState({ ...localLedger.getState(), captureOptOut: true });
        return page;
      };
      await coordinator(native, localLedger).drain();
      ok('local privacy fence: opt-out after a native read blocks every ledger mutation and ACK',
        localLedger.calls.length === 0 && native.acknowledged.length === 0 &&
          native.milestones.length === 0,
        JSON.stringify({ ledger: localLedger.calls, native: native.calls }));
    }

    {
      const sharedFactory = localCapture.getSharedIosLocalCaptureCoordinator;
      if (typeof sharedFactory !== 'function') {
        ok('shared local service: stable ledger adapters receive one coordinator identity', false,
          'getSharedIosLocalCaptureCoordinator is missing');
        ok('shared local service: concurrent retirement retries join one operation', false,
          'getSharedIosLocalCaptureCoordinator is missing');
      } else {
        const retirementGate = deferred();
        const native = nativeQueue([], NOW - 1_000);
        const stableLedger = ledgerAdapter();
        let retirements = 0;
        const retireShortcutCapture = async () => {
          retirements += 1;
          await retirementGate.promise;
          return 'complete';
        };
        const first = sharedFactory({
          native,
          ledger: { ...stableLedger },
          retireShortcutCapture,
        });
        const second = sharedFactory({
          native,
          ledger: { ...stableLedger },
          retireShortcutCapture,
        });
        ok('shared local service: stable ledger adapters receive one coordinator identity',
          first === second);
        const firstRetry = first.retryRetirementIfNeeded();
        const secondRetry = second.retryRetirementIfNeeded();
        await nextMicrotask();
        ok('shared local service: concurrent retirement retries join one operation',
          firstRetry === secondRetry && retirements === 1,
          JSON.stringify({ samePromise: firstRetry === secondRetry, retirements }));
        retirementGate.resolve();
        eq('shared local service: every retirement waiter receives the completed result',
          await Promise.all([firstRetry, secondRetry]), ['complete', 'complete']);
      }
    }
  }

  /* Task 6: source-free local-capture lifecycle and surface state. */
  {
    const hookModule = execute('src/hooks/use-auto-import.ts', (id) => {
      if (id === 'react') return require('react');
      if (id === 'expo-router') {
        return {
          useFocusEffect: () => {},
          useRouter: () => ({ push: () => {} }),
        };
      }
      if (id === 'react-native') {
        return {
          AppState: { addEventListener: () => ({ remove: () => {} }) },
          Platform: { OS: 'ios', Version: 16 },
        };
      }
      return {};
    });
    const resolveSurface = hookModule.resolveIosCaptureSurfaceState;
    const surfaceCases = [
      ['checking outranks every unread fact', {
        hydrated: false, supported: true, proActive: true, captureOptOut: false,
        enabled: true, setupProofVersion: 1, firstCapturedAt: 1, dropped: 1,
        corrupt: true, retirementPending: true,
      }, 'checking'],
      ['unsupported outranks entitlement and setup', {
        hydrated: true, supported: false, proActive: false, captureOptOut: false,
        enabled: true, setupProofVersion: 1, firstCapturedAt: 1, dropped: 0,
        corrupt: false, retirementPending: false,
      }, 'unsupported'],
      ['explicit opt-out is off even with a durable warning', {
        hydrated: true, supported: true, proActive: true, captureOptOut: true,
        enabled: true, setupProofVersion: 1, firstCapturedAt: 1, dropped: 2,
        corrupt: true, retirementPending: true,
      }, 'off'],
      ['disabled native admission is off', {
        hydrated: true, supported: true, proActive: true, captureOptOut: false,
        enabled: false, setupProofVersion: null, firstCapturedAt: null, dropped: 0,
        corrupt: false, retirementPending: false,
      }, 'off'],
      ['inactive entitlement is paused after consent and support', {
        hydrated: true, supported: true, proActive: false, captureOptOut: false,
        enabled: true, setupProofVersion: 1, firstCapturedAt: null, dropped: 0,
        corrupt: false, retirementPending: false,
      }, 'paused'],
      ['inactive entitlement remains paused after native admission is disabled', {
        hydrated: true, supported: true, proActive: false, captureOptOut: false,
        enabled: false, setupProofVersion: 1, firstCapturedAt: null, dropped: 0,
        corrupt: false, retirementPending: false,
      }, 'paused'],
      ['durable dropped evidence stays recoverable after entitlement ends', {
        hydrated: true, supported: true, proActive: false, captureOptOut: false,
        enabled: false, setupProofVersion: 1, firstCapturedAt: null, dropped: 2,
        corrupt: false, retirementPending: false,
      }, 'queue-warning'],
      ['durable corruption stays recoverable after entitlement ends', {
        hydrated: true, supported: true, proActive: false, captureOptOut: false,
        enabled: false, setupProofVersion: 1, firstCapturedAt: null, dropped: 0,
        corrupt: true, retirementPending: false,
      }, 'queue-warning'],
      ['pending-only backlog stays recoverable after entitlement ends', {
        hydrated: true, supported: true, proActive: false, captureOptOut: false,
        enabled: false, setupProofVersion: 1, firstCapturedAt: null, pending: 1,
        dropped: 0, corrupt: false, retirementPending: false,
      }, 'queue-warning'],
      ['durable dropped evidence outranks healthy milestones', {
        hydrated: true, supported: true, proActive: true, captureOptOut: false,
        enabled: true, setupProofVersion: 1, firstCapturedAt: 1, dropped: 2,
        corrupt: false, retirementPending: true,
      }, 'queue-warning'],
      ['durable corruption evidence produces the same recovery state', {
        hydrated: true, supported: true, proActive: true, captureOptOut: false,
        enabled: true, setupProofVersion: 1, firstCapturedAt: 1, dropped: 0,
        corrupt: true, retirementPending: true,
      }, 'queue-warning'],
      ['retirement retry outranks the healthy captured milestone', {
        hydrated: true, supported: true, proActive: true, captureOptOut: false,
        enabled: true, setupProofVersion: 1, firstCapturedAt: 1, dropped: 0,
        corrupt: false, retirementPending: true,
      }, 'migration-retry'],
      ['missing setup proof needs Message automation', {
        hydrated: true, supported: true, proActive: true, captureOptOut: false,
        enabled: true, setupProofVersion: null, firstCapturedAt: null, dropped: 0,
        corrupt: false, retirementPending: false,
      }, 'needs-automation'],
      ['proof alone still needs Message automation confirmation', {
        hydrated: true, supported: true, proActive: true, captureOptOut: false,
        enabled: true, setupProofVersion: 1, firstCapturedAt: null, dropped: 0,
        corrupt: false, retirementPending: false, futureAutomationConfirmed: false,
      }, 'needs-automation'],
      ['missing confirmation defaults to unfinished automation', {
        hydrated: true, supported: true, proActive: true, captureOptOut: false,
        enabled: true, setupProofVersion: 1, firstCapturedAt: null, dropped: 0,
        corrupt: false, retirementPending: false,
      }, 'needs-automation'],
      ['confirmed automation and native proof wait for the first real alert', {
        hydrated: true, supported: true, proActive: true, captureOptOut: false,
        enabled: true, setupProofVersion: 1, firstCapturedAt: null, dropped: 0,
        corrupt: false, retirementPending: false, futureAutomationConfirmed: true,
      }, 'waiting-for-alert'],
      ['automation confirmation cannot replace missing native proof', {
        hydrated: true, supported: true, proActive: true, captureOptOut: false,
        enabled: true, setupProofVersion: null, firstCapturedAt: null, dropped: 0,
        corrupt: false, retirementPending: false, futureAutomationConfirmed: true,
      }, 'needs-automation'],
      ['an actual captured milestone survives absent self-confirmation', {
        hydrated: true, supported: true, proActive: true, captureOptOut: false,
        enabled: true, setupProofVersion: 1, firstCapturedAt: 1, dropped: 0,
        corrupt: false, retirementPending: false, futureAutomationConfirmed: false,
      }, 'first-alert-captured'],
      ['a qualifying durable milestone is first-alert-captured', {
        hydrated: true, supported: true, proActive: true, captureOptOut: false,
        enabled: true, setupProofVersion: 1, firstCapturedAt: 1, dropped: 0,
        corrupt: false, retirementPending: false,
      }, 'first-alert-captured'],
    ];
    for (const [name, input, expected] of surfaceCases) {
      ok(`local surface: ${name}`,
        typeof resolveSurface === 'function' && resolveSurface(input) === expected,
        typeof resolveSurface === 'function'
          ? JSON.stringify({ actual: resolveSurface(input), expected })
          : 'resolveIosCaptureSurfaceState is missing');
    }

    ok('local entitlement: expiry never erases Message automation consent in JS',
      !/setCaptureEnabled\(false\)/.test(
        fs.readFileSync(path.join(ROOT, 'src/hooks/use-auto-import.ts'), 'utf8').match(
          /if \(!isProActive\(state\)\)[\s\S]*?return 'not-pro';/,
        )?.[0] || '',
      ));

    const runCycle = hookModule.runIosLocalCaptureCycle;
    const warningId = '00000000-0000-0000-0000-00000000000A';
    const status = (overrides = {}) => {
      const value = {
        enabled: true,
        entitled: true,
        pending: 0,
        dropped: 0,
        corrupt: false,
        warningId: null,
        setupProofVersion: 1,
        setupProofAt: 1,
        firstCapturedAt: null,
        ...overrides,
      };
      if ((value.dropped > 0 || value.corrupt) && !value.warningId) {
        value.warningId = warningId;
      }
      return value;
    };
    const cycleHarness = ({ state = {}, nativeStatus = status(), durable } = {}) => {
      const events = [];
      const ledgerState = {
        hydrated: true,
        captureOptOut: false,
        privateMode: false,
        ...state,
      };
      const coordinator = {
        drain: async () => {
          events.push('drain');
          return {
            scanned: 0, imported: 0, reviews: 0, declined: 0, ignored: 0,
            invalid: 0, firstCapturedAt: nativeStatus.firstCapturedAt,
            retirement: 'not-needed',
          };
        },
        retryRetirementIfNeeded: async () => {
          events.push('retry-retirement');
          return 'not-needed';
        },
      };
      return {
        events,
        dependencies: {
          getStateSnapshot: () => ledgerState,
          native: {
            getCaptureStatus: async () => {
              events.push('status');
              return nativeStatus;
            },
          },
          coordinator,
          recordWarning: (warning) => {
            events.push(`warning:${warning.dropped}:${warning.corrupt}`);
            return { durable: durable ?? Promise.resolve() };
          },
          publishStatusRefresh: () => { events.push('publish'); },
          now: () => 1_800_000_000_000,
        },
      };
    };

    if (typeof runCycle !== 'function') {
      for (const name of [
        'hydration gates native status and drain',
        'private mode still drains local capture',
        'disabled native admission blocks drain',
        'status refresh retries retirement without draining',
        'warning durability precedes drain without acknowledgement',
        'failed warning persistence leaves native evidence untouched',
      ]) {
        ok(`local lifecycle: ${name}`, false, 'runIosLocalCaptureCycle is missing');
      }
    } else {
      {
        const harness = cycleHarness({ state: { hydrated: false } });
        await runCycle(harness.dependencies, 'drain');
        eq('local lifecycle: hydration gates native status and drain', harness.events, []);
      }
      {
        const harness = cycleHarness({ state: { privateMode: true } });
        await runCycle(harness.dependencies, 'drain');
        eq('local lifecycle: private mode still drains local capture',
          harness.events, ['status', 'drain', 'publish']);
      }
      {
        const harness = cycleHarness({ nativeStatus: status({ enabled: false }) });
        await runCycle(harness.dependencies, 'drain');
        eq('local lifecycle: disabled native admission blocks drain',
          harness.events, ['status']);
      }
      {
        const harness = cycleHarness();
        await runCycle(harness.dependencies, 'status');
        eq('local lifecycle: status refresh retries retirement without draining',
          harness.events, ['status', 'retry-retirement']);
      }
      {
        const harness = cycleHarness({
          state: {
            iosCaptureWarning: {
              dropped: 4,
              corrupt: true,
              recordedAt: 10,
              nativeWarningId: warningId,
            },
          },
          nativeStatus: status({ dropped: 2, corrupt: true }),
        });
        await runCycle(harness.dependencies, 'status');
        eq('local lifecycle: in-memory warning state never substitutes for a fresh durability receipt',
          harness.events,
          ['status', 'warning:2:true', 'publish', 'retry-retirement']);
      }
      {
        const harness = cycleHarness({ nativeStatus: status({ corrupt: true }) });
        harness.dependencies.recordWarning = (warning) => {
          harness.events.push(`warning:${warning.dropped}:${warning.corrupt}`);
          harness.dependencies.getStateSnapshot().iosCaptureWarning = warning;
          return { durable: Promise.resolve() };
        };
        await runCycle(harness.dependencies, 'status');
        await runCycle(harness.dependencies, 'status');
        eq('local lifecycle: a repeated durable corruption observation cannot bounce status signals',
          harness.events, [
            'status', 'warning:0:true', 'publish', 'retry-retirement',
            'status', 'warning:0:true', 'retry-retirement',
          ]);
      }
      {
        const gate = deferred();
        const harness = cycleHarness({
          nativeStatus: status({ dropped: 3, corrupt: true }),
          durable: gate.promise,
        });
        const running = runCycle(harness.dependencies, 'drain');
        await nextMicrotask();
        eq('local lifecycle: warning durability starts before drain',
          harness.events, ['status', 'warning:3:true']);
        gate.resolve();
        await running;
        eq('local lifecycle: warning durability precedes drain without acknowledgement',
          harness.events,
          ['status', 'warning:3:true', 'publish', 'drain', 'publish']);
      }
      {
        const harness = cycleHarness({
          nativeStatus: status({ dropped: 2 }),
          durable: Promise.reject(new Error('write failed')),
        });
        await rejects(() => runCycle(harness.dependencies, 'drain'), /write failed/);
        eq('local lifecycle: failed warning persistence leaves native evidence untouched',
          harness.events, ['status', 'warning:2:false']);
      }
      {
        const harness = cycleHarness({ nativeStatus: status({ dropped: 2 }) });
        harness.dependencies.native.acknowledgeCaptureWarning = async () => {
          harness.events.push('unexpected-ack');
          return true;
        };
        await runCycle(harness.dependencies, 'status');
        eq('local lifecycle: an ordinary status read never clears native warning evidence',
          harness.events,
          ['status', 'warning:2:false', 'publish', 'retry-retirement']);
      }
      {
        const harness = cycleHarness({ nativeStatus: status({ dropped: 2 }) });
        let writes = 0;
        harness.dependencies.recordWarning = (warning) => {
          harness.events.push(`warning:${warning.dropped}:${warning.corrupt}`);
          harness.dependencies.getStateSnapshot().iosCaptureWarning = warning;
          writes += 1;
          return {
            durable: writes === 1
              ? Promise.reject(new Error('first warning write failed'))
              : Promise.resolve(),
          };
        };
        await rejects(
          () => runCycle(harness.dependencies, 'status'),
          /first warning write failed/,
        );
        await runCycle(harness.dependencies, 'status');
        eq('local lifecycle: a failed warning write is persisted again on retry',
          harness.events, [
            'status', 'warning:2:false',
            'status', 'warning:2:false', 'publish', 'retry-retirement',
          ]);
      }
      {
        const harness = cycleHarness({ nativeStatus: status({ corrupt: true }) });
        harness.dependencies.coordinator.drain = async () => {
          harness.events.push('drain');
          throw new Error('drain failed');
        };
        await rejects(() => runCycle(harness.dependencies, 'drain'), /drain failed/);
        eq('local lifecycle: a durable warning refreshes other surfaces even when drain fails',
          harness.events, ['status', 'warning:0:true', 'publish', 'drain', 'publish']);
      }
      {
        const harness = cycleHarness();
        harness.dependencies.coordinator.drain = async () => {
          harness.events.push('drain');
          throw new Error('partial drain failed');
        };
        await rejects(() => runCycle(harness.dependencies, 'drain'), /partial drain failed/);
        eq('local lifecycle: every attempted drain publishes status even after partial failure',
          harness.events, ['status', 'drain', 'publish']);
      }
    }

    const recoverQueue = hookModule.recoverIosCaptureQueue;
    if (typeof recoverQueue !== 'function') {
      ok('local recovery: disabled or unpaid admission still drains the bounded backlog', false,
        'recoverIosCaptureQueue is missing');
      ok('local recovery: a racing warning ID cannot be cleared', false,
        'recoverIosCaptureQueue is missing');
    } else {
      {
        const events = [];
        const state = {
          hydrated: true,
          captureOptOut: false,
          privateMode: false,
          iosCaptureWarning: null,
        };
        let nativeStatus = status({ enabled: false, pending: 1 });
        const recovered = await recoverQueue({
          getStateSnapshot: () => state,
          native: {
            getCaptureStatus: async () => {
              events.push('status');
              return nativeStatus;
            },
            acknowledgeCaptureWarning: async () => {
              events.push('unexpected-warning-ack');
              return false;
            },
          },
          coordinator: {
            drain: async () => {
              events.push('drain');
              nativeStatus = status({ enabled: false, pending: 0 });
              return {
                scanned: 1, imported: 1, reviews: 0, declined: 0, ignored: 0,
                invalid: 0, firstCapturedAt: 1, retirement: 'not-needed',
              };
            },
          },
          recordWarning: () => {
            events.push('unexpected-warning-record');
            return { durable: Promise.resolve() };
          },
          clearWarning: () => {
            events.push('unexpected-warning-clear');
            return { cleared: false, durable: Promise.resolve() };
          },
          publishStatusRefresh: () => { events.push('publish'); },
          now: () => 2,
        });
        ok('local recovery: a paused pending-only backlog drains without warning ACK',
          recovered && JSON.stringify(events) === JSON.stringify([
            'drain', 'status', 'status', 'publish',
          ]), JSON.stringify({ recovered, events }));
      }
      {
        const events = [];
        const state = {
          hydrated: true,
          captureOptOut: false,
          privateMode: false,
          iosCaptureWarning: {
            dropped: 2,
            corrupt: true,
            recordedAt: 1,
            nativeWarningId: warningId,
          },
        };
        let nativeStatus = status({ enabled: false, dropped: 2, corrupt: true });
        const recovered = await recoverQueue({
          getStateSnapshot: () => state,
          native: {
            getCaptureStatus: async () => {
              events.push('status');
              return nativeStatus;
            },
            acknowledgeCaptureWarning: async (id) => {
              events.push(`ack:${id}`);
              if (id !== nativeStatus.warningId) return false;
              nativeStatus = status({ enabled: false });
              return true;
            },
          },
          coordinator: {
            drain: async () => {
              events.push('drain');
              return {
                scanned: 0, imported: 0, reviews: 0, declined: 0, ignored: 0,
                invalid: 0, firstCapturedAt: null, retirement: 'not-needed',
              };
            },
          },
          recordWarning: (warning) => {
            events.push(`record:${warning.nativeWarningId}`);
            state.iosCaptureWarning = warning;
            return {
              durable: Promise.resolve().then(() => { events.push('record-durable'); }),
            };
          },
          clearWarning: (expected) => {
            events.push(`clear:${expected}`);
            if (state.iosCaptureWarning?.nativeWarningId !== expected) {
              return { cleared: false, durable: Promise.resolve() };
            }
            state.iosCaptureWarning = null;
            return {
              cleared: true,
              durable: Promise.resolve().then(() => { events.push('clear-durable'); }),
            };
          },
          publishStatusRefresh: () => { events.push('publish'); },
          now: () => 2,
        });
        ok('local recovery: disabled or unpaid admission still drains the bounded backlog',
          recovered && state.iosCaptureWarning === null &&
            JSON.stringify(events) === JSON.stringify([
              'drain', 'status', `record:${warningId}`, 'record-durable',
              `ack:${warningId}`, `clear:${warningId}`, 'clear-durable',
              'status', 'publish',
            ]),
          JSON.stringify({ recovered, events, state }));
      }
      {
        const nextWarningId = '00000000-0000-0000-0000-00000000000B';
        const events = [];
        const state = {
          hydrated: true,
          captureOptOut: false,
          privateMode: false,
          iosCaptureWarning: null,
        };
        let reads = 0;
        const recovered = await recoverQueue({
          getStateSnapshot: () => state,
          native: {
            getCaptureStatus: async () => {
              reads += 1;
              events.push(`status:${reads}`);
              return status({
                dropped: reads === 1 ? 1 : 2,
                warningId: reads === 1 ? warningId : nextWarningId,
              });
            },
            acknowledgeCaptureWarning: async (id) => {
              events.push(`ack:${id}`);
              return false;
            },
          },
          coordinator: {
            drain: async () => ({
              scanned: 0, imported: 0, reviews: 0, declined: 0, ignored: 0,
              invalid: 0, firstCapturedAt: null, retirement: 'not-needed',
            }),
          },
          recordWarning: (warning) => {
            events.push(`record:${warning.nativeWarningId}`);
            state.iosCaptureWarning = warning;
            return { durable: Promise.resolve() };
          },
          clearWarning: () => {
            events.push('unexpected-clear');
            return { cleared: true, durable: Promise.resolve() };
          },
          publishStatusRefresh: () => { events.push('publish'); },
          now: () => reads,
        });
        ok('local recovery: a racing warning ID cannot be cleared',
          !recovered && state.iosCaptureWarning?.nativeWarningId === nextWarningId &&
            !events.includes('unexpected-clear'),
          JSON.stringify({ recovered, events, state }));
      }
    }

    {
      const createStatusRefresh = hookModule.createCoalescingStatusRefresh;
      if (typeof createStatusRefresh !== 'function') {
        ok('local status signal: an in-flight read coalesces one pending rerun', false,
          'createCoalescingStatusRefresh is missing');
      } else {
        const firstRead = deferred();
        const events = [];
        let reads = 0;
        const scheduler = createStatusRefresh(async (isCurrent) => {
          const read = ++reads;
          events.push(`read:${read}`);
          if (read === 1) await firstRead.promise;
          if (isCurrent()) events.push(`commit:${read}`);
        });
        const first = scheduler.request();
        await nextMicrotask();
        events.push('drain-published');
        const joined = scheduler.request();
        firstRead.resolve();
        await Promise.all([first, joined]);
        eq('local status signal: an in-flight read coalesces one pending rerun',
          events, ['read:1', 'drain-published', 'read:2', 'commit:2']);
      }
    }

    const chooseRelayIntent = hookModule.iosRelayIntentFor;
    eq('local lifecycle: an existing relay is supplemental only',
      typeof chooseRelayIntent === 'function'
        ? chooseRelayIntent({ hasRelayConfig: true, privateMode: false })
        : 'missing',
      'supplemental');
    eq('local lifecycle: no relay config means no network executor',
      typeof chooseRelayIntent === 'function'
        ? chooseRelayIntent({ hasRelayConfig: false, privateMode: false })
        : 'missing',
      null);
    eq('local lifecycle: Private Mode keeps local capture but blocks supplemental relay',
      typeof chooseRelayIntent === 'function'
        ? chooseRelayIntent({ hasRelayConfig: true, privateMode: true })
        : 'missing',
      null);
    const shouldReplayJoined = hookModule.shouldReplayJoinedAutoImport;
    eq('local lifecycle: an interactive iOS refresh joins an up-to-date foreground drain',
      typeof shouldReplayJoined === 'function'
        ? shouldReplayJoined({ platform: 'ios', outcome: 'up-to-date' })
        : 'missing',
      false);
    eq('local lifecycle: Android reports a successful joined scan without doing it twice',
      typeof shouldReplayJoined === 'function'
        ? shouldReplayJoined({ platform: 'android', outcome: 'up-to-date' })
        : 'missing',
      false);
    eq('local lifecycle: an imported join never runs a duplicate scan on either platform',
      typeof shouldReplayJoined === 'function'
        ? shouldReplayJoined({ platform: 'ios', outcome: 'imported' })
        : 'missing',
      false);

    const mountedHydrationCase = async ({
      label,
      expected,
      nativeStatus,
      captureOptOut,
      supported,
      publishToSelf = false,
      replayEffectsBeforeHydration = false,
      warningAckFails = false,
      automationConfirmed = false,
      progressReadFails = false,
      nextFocusProgress,
      expectedAfterFocus,
    }) => {
      const runtime = createHookRuntime();
      const statusListeners = new Set();
      let confirmed = automationConfirmed;
      let progressReadFailure = progressReadFails;
      let progressReads = 0;
      let focusEnter;
      let focusLeave;
      let storeState = {
        hydrated: false,
        captureOptOut: false,
        privateMode: false,
        iosCaptureWarning: null,
        historyImport: null,
        onboarded: true,
        lastScanTs: 1,
        dailySummary: false,
        transactions: [],
      };
      let statusReads = 0;
      let drains = 0;
      let purges = 0;
      const native = supported
        ? {
            getCaptureStatus: async () => {
              statusReads += 1;
              return typeof nativeStatus === 'function'
                ? nativeStatus(statusReads)
                : nativeStatus;
            },
            acknowledgeCaptureWarning: async () => {
              if (warningAckFails) throw new Error('warning ACK failed');
              return true;
            },
            purgeExpired: async () => {
              purges += 1;
              return 0;
            },
          }
        : null;
      const coordinator = {
        drain: async () => {
          drains += 1;
          return {
            scanned: 0, imported: 0, reviews: 0, declined: 0, ignored: 0,
            invalid: 0, firstCapturedAt: null, retirement: 'not-needed',
          };
        },
        retryRetirementIfNeeded: async () => 'not-needed',
      };
      const storeMethods = {
        getStateSnapshot: () => storeState,
        getStateGeneration: () => 0,
        importBatch: () => ({ ids: [], durable: Promise.resolve() }),
        stageReviewAlerts: () => ({ admitted: 0, durable: Promise.resolve() }),
        ensureDurable: async () => {},
        setMarket: () => true,
        undoBatch: () => {},
        recordIosCaptureWarning: (warning) => {
          storeState = { ...storeState, iosCaptureWarning: warning };
          return { durable: Promise.resolve() };
        },
        clearIosCaptureWarning: (expected) => {
          if (storeState.iosCaptureWarning?.nativeWarningId !== expected) {
            return { cleared: false, durable: Promise.resolve() };
          }
          storeState = { ...storeState, iosCaptureWarning: null };
          return { cleared: true, durable: Promise.resolve() };
        },
      };
      const mountedHookModule = execute('src/hooks/use-auto-import.ts', (id) => {
        if (id === 'react') return runtime.react;
        if (id === 'expo-router') {
          return {
            useFocusEffect: (effect) => {
              focusEnter = effect;
              runtime.react.useEffect(() => {
                focusLeave = effect();
                return () => { if (typeof focusLeave === 'function') focusLeave(); };
              }, [effect]);
            },
            useRouter: () => ({ push: () => {} }),
          };
        }
        if (id === 'react-native') {
          return {
            AppState: { addEventListener: () => ({ remove: () => {} }) },
            Platform: { OS: 'ios', Version: 16 },
          };
        }
        if (id === '@/components/ui/toast') return { useToast: () => ({ show: () => {} }) };
        if (id === '@/lib/auto-import') {
          return {
            hasSmsPermission: async () => false,
            isSmsInboxAccessError: () => false,
            isSmsScanningAvailable: () => false,
            openSmsPermissionSettings: async () => {},
            requestSmsPermission: async () => false,
          };
        }
        if (id === '@/lib/background-relay') {
          return { enableRelayBackgroundSync: async () => false };
        }
        if (id === '@/lib/capture') {
          return {
            getIosCaptureNativeModule: () => native,
            isCaptureAvailable: () => supported,
            publishIosCaptureStatusRefresh: () => {
              if (publishToSelf) {
                for (const listener of statusListeners) listener();
              }
            },
            subscribeIosCaptureStatusRefresh: (listener) => {
              statusListeners.add(listener);
              return () => statusListeners.delete(listener);
            },
          };
        }
        if (id === '@/lib/capture-executor') {
          return {
            createCaptureExecutor: () => ({
              execute: async () => ({
                kind: 'up-to-date', source: 'none', transactions: 0, dues: 0,
                bills: 0, healed: 0, newAccounts: 0, transactionIds: [], reviewAlerts: 0,
              }),
            }),
          };
        }
        if (id === '@/lib/haptics') return { committed: () => {} };
        if (id === '@/lib/i18n') return { t: (key) => key, tf: (key) => key };
        if (id === '@/lib/notifications') {
          return { syncDailySummary: async () => {}, syncPaymentReminders: async () => {} };
        }
        if (id === '@/lib/purchases') return { isProActive: () => true };
        if (id === '@/lib/ios-message-onboarding') {
          return {
            loadIosMessageSetupProgress: async () => {
              progressReads += 1;
              if (progressReadFailure) throw new Error('setup progress unavailable');
              return { futureAutomationConfirmed: confirmed };
            },
          };
        }
        if (id === '@/lib/relay') {
          return {
            getRelayConfig: async () => null,
            isLegacyShortcutCaptureActive: () => false,
            retireRelayShortcutCapture: async () => {},
          };
        }
        if (id === '@/lib/ios-local-capture') {
          return {
            createIosLocalCaptureCoordinator: () => coordinator,
            getSharedIosLocalCaptureCoordinator: () => coordinator,
          };
        }
        if (id === '@/lib/store') {
          return { useStore: () => ({ state: storeState, ...storeMethods }) };
        }
        return {};
      });
      const render = () => runtime.render(() => mountedHookModule.useAutoImport(false, true));
      render();
      await runtime.flush();
      render();
      if (replayEffectsBeforeHydration) await runtime.replayEffects();
      storeState = { ...storeState, hydrated: true, captureOptOut };
      render();
      await runtime.flush();
      let model = render();
      await runtime.flush();
      model = render();
      ok(`mounted local status: ${label}`,
        model.captureState === expected && statusReads === (supported && !captureOptOut ? 1 : 0) &&
          purges === (supported && captureOptOut ? 1 : 0) && drains === 0 &&
          progressReads === (supported && !captureOptOut ? 1 : 0),
        JSON.stringify({ state: model.captureState, expected, statusReads, purges, drains, progressReads }));
      if (nextFocusProgress !== undefined) {
        if (typeof focusLeave === 'function') focusLeave();
        confirmed = nextFocusProgress === true;
        progressReadFailure = nextFocusProgress === 'error';
        focusLeave = focusEnter();
        await runtime.flush();
        model = render();
        ok(`mounted local status: ${label} after returning to Home`,
          model.captureState === expectedAfterFocus && progressReads === 2 &&
            statusReads === 2 && drains === 0,
          JSON.stringify({ state: model.captureState, expectedAfterFocus, statusReads, progressReads, drains }));
      }
      runtime.cleanup();
    };
    await mountedHydrationCase({
      label: 'local proof alone opens unfinished setup until confirmation is saved',
      expected: 'needs-automation', nativeStatus: status(),
      captureOptOut: false, supported: true,
      nextFocusProgress: true, expectedAfterFocus: 'waiting-for-alert',
    });
    await mountedHydrationCase({
      label: 'a later progress read failure cannot preserve stale Ready',
      expected: 'waiting-for-alert', nativeStatus: status(),
      captureOptOut: false, supported: true, automationConfirmed: true,
      nextFocusProgress: 'error', expectedAfterFocus: 'needs-automation',
    });
    await mountedHydrationCase({
      label: 'failed setup progress read does not fabricate automation confirmation',
      expected: 'needs-automation', nativeStatus: status(),
      captureOptOut: false, supported: true, progressReadFails: true,
    });
    for (const [label, nativeStatus, expected] of [
      ['pending queue', status({ pending: 1 }), 'queue-warning'],
      ['dropped warning', status({ dropped: 2 }), 'queue-warning'],
      ['corrupt warning', status({ corrupt: true }), 'queue-warning'],
      ['expired native entitlement', status({ entitled: false }), 'paused'],
      ['actual first-alert receipt', status({ firstCapturedAt: 1 }), 'first-alert-captured'],
    ]) {
      await mountedHydrationCase({
        label: `setup progress read failure preserves ${label}`,
        expected, nativeStatus, captureOptOut: false, supported: true, progressReadFails: true,
      });
    }
    await mountedHydrationCase({
      label: 'hydration reads the native disabled default without draining',
      expected: 'off',
      nativeStatus: status({ enabled: false }),
      captureOptOut: false,
      supported: true,
    });
    await mountedHydrationCase({
      label: 'persisted opt-out purges expiry without reading status or draining',
      expected: 'off',
      nativeStatus: status(),
      captureOptOut: true,
      supported: true,
    });
    await mountedHydrationCase({
      label: 'unsupported iOS becomes unsupported without attempting a drain',
      expected: 'unsupported',
      nativeStatus: status(),
      captureOptOut: false,
      supported: false,
    });
    await mountedHydrationCase({
      label: 'Strict Mode effect replay keeps the hydration status scheduler live',
      expected: 'off',
      nativeStatus: status({ enabled: false }),
      captureOptOut: false,
      supported: true,
      replayEffectsBeforeHydration: true,
    });
    await mountedHydrationCase({
      label: 'durable dropped warning renders until targeted recovery',
      expected: 'queue-warning',
      nativeStatus: status({ dropped: 2 }),
      captureOptOut: false,
      supported: true,
      warningAckFails: true,
    });
    await mountedHydrationCase({
      label: 'a hook does not reread its own synchronously published warning signal',
      expected: 'queue-warning',
      nativeStatus: (read) => status({ corrupt: read === 1 }),
      captureOptOut: false,
      supported: true,
      publishToSelf: true,
    });

    {
      const runtime = createHookRuntime();
      let permissionGranted = false;
      let permissionChecks = 0;
      let providerFails = false;
      const appStateListeners = new Set();
      let storeState = {
        hydrated: true,
        captureOptOut: false,
        privateMode: false,
        iosCaptureWarning: null,
        historyImport: null,
        onboarded: false,
        lastScanTs: 0,
        dailySummary: false,
        transactions: [],
      };
      const storeMethods = {
        getStateSnapshot: () => storeState,
        getStateGeneration: () => 0,
        importBatch: () => ({ ids: [], durable: Promise.resolve() }),
        stageReviewAlerts: () => ({ admitted: 0, durable: Promise.resolve() }),
        ensureDurable: async () => {},
        setMarket: () => true,
        undoBatch: () => {},
        recordIosCaptureWarning: () => ({ durable: Promise.resolve() }),
        clearIosCaptureWarning: () => ({ cleared: false, durable: Promise.resolve() }),
      };
      const mountedAndroidHook = execute('src/hooks/use-auto-import.ts', (id) => {
        if (id === 'react') return runtime.react;
        if (id === 'expo-router') {
          return {
            useFocusEffect: (effect) => runtime.react.useEffect(effect, [effect]),
            useRouter: () => ({ push: () => {} }),
          };
        }
        if (id === 'react-native') {
          return {
            AppState: {
              addEventListener: (_event, listener) => {
                appStateListeners.add(listener);
                return { remove: () => appStateListeners.delete(listener) };
              },
            },
            Platform: { OS: 'android', Version: 36 },
          };
        }
        if (id === '@/components/ui/toast') return { useToast: () => ({ show: () => {} }) };
        if (id === '@/lib/auto-import') {
          return {
            hasSmsPermission: async () => {
              permissionChecks += 1;
              return permissionGranted;
            },
            isSmsInboxAccessError: (error) => error?.message === 'sms-provider-failure',
            isSmsScanningAvailable: () => true,
            openSmsPermissionSettings: async () => {},
            requestSmsPermission: async () => permissionGranted,
          };
        }
        if (id === '@/lib/background-relay') {
          return { enableRelayBackgroundSync: async () => false };
        }
        if (id === '@/lib/capture') {
          return {
            getIosCaptureNativeModule: () => null,
            isCaptureAvailable: () => true,
            publishIosCaptureStatusRefresh: () => {},
            subscribeIosCaptureStatusRefresh: () => () => {},
          };
        }
        if (id === '@/lib/capture-executor') {
          return {
            createCaptureExecutor: () => ({
              execute: async () => {
                if (providerFails) throw new Error('sms-provider-failure');
                return {
                  kind: 'up-to-date', source: 'none', transactions: 0, dues: 0,
                  bills: 0, healed: 0, newAccounts: 0, transactionIds: [], reviewAlerts: 0,
                };
              },
            }),
          };
        }
        if (id === '@/lib/haptics') return { committed: () => {} };
        if (id === '@/lib/i18n') return { t: (key) => key, tf: (key) => key };
        if (id === '@/lib/notifications') {
          return { syncDailySummary: async () => {}, syncPaymentReminders: async () => {} };
        }
        if (id === '@/lib/purchases') return { isProActive: () => true };
        if (id === '@/lib/relay') {
          return {
            getRelayConfig: async () => null,
            isLegacyShortcutCaptureActive: () => false,
            retireRelayShortcutCapture: async () => {},
          };
        }
        if (id === '@/lib/ios-local-capture') {
          return { getSharedIosLocalCaptureCoordinator: () => null };
        }
        if (id === '@/lib/store') {
          return { useStore: () => ({ state: storeState, ...storeMethods }) };
        }
        return {};
      });
      const render = () => runtime.render(() => ({
        home: mountedAndroidHook.useAutoImport(false, true),
        shell: mountedAndroidHook.useAutoImport(false, false),
      }));
      render();
      await runtime.flush();
      let models = render();
      await runtime.flush();
      models = render();
      let model = models.home;
      ok('mounted Android status: pre-onboarding denial is local and off',
        model.needsPermission && model.captureState === 'off' && permissionChecks >= 1,
        JSON.stringify({ model, permissionChecks }));

      permissionGranted = true;
      storeState = { ...storeState, onboarded: true };
      render();
      await runtime.flush();
      models = render();
      await runtime.flush();
      models = render();
      model = models.home;
      ok('mounted Android status: onboarding grant becomes ready immediately',
        !model.needsPermission && model.captureState === 'waiting-for-alert' &&
          permissionChecks >= 2,
        JSON.stringify({ model, permissionChecks }));

      providerFails = true;
      await models.shell.runAutoImport(false);
      models = render();
      await runtime.flush();
      models = render();
      for (const listener of appStateListeners) listener('active');
      await nextMicrotask();
      await nextMicrotask();
      models = render();
      model = models.home;
      ok('mounted Android status: a real provider failure is shared and off',
        model.needsPermission && model.captureState === 'off',
        JSON.stringify({ model, permissionChecks }));

      providerFails = false;
      await models.shell.runAutoImport(false);
      models = render();
      await runtime.flush();
      models = render();
      await runtime.flush();
      models = render();
      model = models.home;
      ok('mounted Android status: a successful retry immediately clears the shared failure',
        !model.needsPermission && model.captureState === 'waiting-for-alert',
        JSON.stringify({ model, permissionChecks }));
      runtime.cleanup();
    }
  }

  {
    const typesModule = execute('src/lib/types.ts', (id) => {
      throw new Error(`unexpected types dependency ${id}`);
    });
    const mergeWarning = typesModule.mergeIosCaptureWarningState;
    const normalizeWarning = typesModule.normalizeIosCaptureWarningState;
    const warningStateId = '00000000-0000-0000-0000-00000000000A';
    const prior = {
      dropped: 4, corrupt: false, recordedAt: 100, nativeWarningId: warningStateId,
    };
    const concurrent = {
      dropped: 4, corrupt: true, recordedAt: 101, nativeWarningId: warningStateId,
    };
    const merged = typeof mergeWarning === 'function'
      ? mergeWarning(prior, concurrent)
      : null;
    eq('local warning: concurrent observations dedupe dropped counts and merge corruption',
      merged, {
        dropped: 4, corrupt: true, recordedAt: 101, nativeWarningId: warningStateId,
      });
    const stale = typeof mergeWarning === 'function'
      ? mergeWarning(merged, {
          dropped: 2, corrupt: false, recordedAt: 99, nativeWarningId: warningStateId,
        })
      : null;
    eq('local warning: stale observations cannot reduce durable warning evidence',
      stale, {
        dropped: 4, corrupt: true, recordedAt: 101, nativeWarningId: warningStateId,
      });
    eq('local warning: legacy three-field state migrates without inventing a native ID',
      normalizeWarning({ dropped: 1, corrupt: false, recordedAt: 9 }),
      { dropped: 1, corrupt: false, recordedAt: 9, nativeWarningId: null });
  }

  {
    const loadCapture = ({ os, version, sms, native }) => {
      let optionalQueries = 0;
      const module = execute('src/lib/capture.ts', (id) => {
        if (id === 'react-native') return { Platform: { OS: os, Version: version } };
        if (id === 'expo') {
          return {
            requireOptionalNativeModule: () => {
              optionalQueries += 1;
              return native;
            },
          };
        }
        if (id === '@/lib/auto-import') {
          return { isSmsScanningAvailable: () => sms, scanInbox: async () => ({}) };
        }
        if (id === '@/lib/background-relay-storage') {
          return {
            BACKGROUND_RELAY_ERASE_PENDING_KEY: 'erase',
            backgroundRelayStorage: {},
          };
        }
        if (id === '@/lib/relay') {
          return {
            isRelayPlatform: () => os === 'ios',
          };
        }
        return {};
      });
      return { module, optionalQueries: () => optionalQueries };
    };
    {
      const capture = loadCapture({ os: 'ios', version: 16, sms: false, native: {} });
      ok('capture availability: iOS 16 with the optional live module is available',
        capture.module.isCaptureAvailable() && capture.optionalQueries() === 1,
        JSON.stringify({ available: capture.module.isCaptureAvailable(), queries: capture.optionalQueries() }));
    }
    {
      const capture = loadCapture({ os: 'ios', version: 15, sms: false, native: {} });
      ok('capture availability: iOS 15 does not query or claim the live module',
        !capture.module.isCaptureAvailable() && capture.optionalQueries() === 0,
        JSON.stringify({ available: capture.module.isCaptureAvailable(), queries: capture.optionalQueries() }));
    }
    {
      const capture = loadCapture({ os: 'ios', version: 16, sms: false, native: null });
      ok('capture availability: a missing optional iOS module fails closed',
        !capture.module.isCaptureAvailable() && capture.optionalQueries() === 1,
        JSON.stringify({ available: capture.module.isCaptureAvailable(), queries: capture.optionalQueries() }));
    }
    {
      const capture = loadCapture({ os: 'android', version: 35, sms: false, native: {} });
      ok('capture availability: Android never queries the iOS module',
        !capture.module.isCaptureAvailable() && capture.optionalQueries() === 0,
        JSON.stringify({ available: capture.module.isCaptureAvailable(), queries: capture.optionalQueries() }));
    }
  }

  const publishedShortcut =
    'https://www.icloud.com/shortcuts/0123456789abcdef0123456789abcdef';
  const status = (extra = {}) => ({ ...defaultNativeStatus, ...extra });
  const controllerHarness = ({
    initialStatus = status(),
    supported = true,
    nativeAvailable = true,
    shortcutUrl = publishedShortcut,
    dependencyOverrides = {},
  } = {}) => {
    let currentStatus = initialStatus;
    let statusReads = 0;
    const enableCalls = [];
    const opened = [];
    const capabilityChecks = [];
    let listener = () => {};
    let unsubscribed = false;
    const native = {
      async getCaptureStatus() {
        statusReads += 1;
        return { ...currentStatus };
      },
      async setCaptureEnabled(value) {
        enableCalls.push(value);
      },
    };
    const dependencies = {
      isSupported: () => supported,
      getNativeModule: () => nativeAvailable ? native : null,
      shortcutUrl,
      canOpenUrl: async (url) => {
        capabilityChecks.push(url);
        return true;
      },
      openUrl: async (url) => {
        opened.push(url);
      },
      subscribeCaptureStatus: (next) => {
        listener = next;
        return () => { unsubscribed = true; };
      },
      ...dependencyOverrides,
    };
    const controller = setupModule.createIosCaptureSetup({ dependencies });
    return {
      controller,
      dependencies,
      native,
      enableCalls,
      opened,
      capabilityChecks,
      statusReads: () => statusReads,
      setStatus: (next) => { currentStatus = next; },
      signal: () => listener(),
      unsubscribed: () => unsubscribed,
    };
  };

  eq('local capture protocol: stable Shortcut name',
    protocolModule.IOS_LOCAL_CAPTURE_SHORTCUT_NAME, 'Wafra Local Capture');
  eq('local capture protocol: obsolete Text sentinel is not exported',
    Object.hasOwn(protocolModule, 'IOS_LOCAL_CAPTURE_TEST_SENTINEL'), false);
  eq('local capture protocol: exact no-input x-callback URL',
    protocolModule.iosLocalCaptureTestUrl(),
    'shortcuts://x-callback-url/run-shortcut?name=Wafra%20Local%20Capture&x-success=wafra%3A%2F%2Fios-setup%3FshortcutResult%3Dsuccess&x-cancel=wafra%3A%2F%2Fios-setup%3FshortcutResult%3Dcancel&x-error=wafra%3A%2F%2Fios-setup%3FshortcutResult%3Derror');
  eq('local capture protocol: onboarding survives every callback',
    protocolModule.iosLocalCaptureTestUrl(true),
    'shortcuts://x-callback-url/run-shortcut?name=Wafra%20Local%20Capture&x-success=wafra%3A%2F%2Fios-setup%3FshortcutResult%3Dsuccess%26fromOnboarding%3D1&x-cancel=wafra%3A%2F%2Fios-setup%3FshortcutResult%3Dcancel%26fromOnboarding%3D1&x-error=wafra%3A%2F%2Fios-setup%3FshortcutResult%3Derror%26fromOnboarding%3D1');

  eq('local capture protocol: valid iCloud IDs normalize to lowercase',
    protocolModule.normalizeIosLocalCaptureShortcutUrl(
      'https://www.icloud.com/shortcuts/ABCDEFABCDEFABCDEFABCDEFABCDEFAB',
    ),
    'https://www.icloud.com/shortcuts/abcdefabcdefabcdefabcdefabcdefab');
  const signedReleaseShortcut =
    'https://github.com/khanjer496-alt/Wafra/releases/download/ios-catchup-beta-20260910-v1/Wafra-Local-Capture-signed.shortcut';
  eq('local capture protocol: GitHub beta release is rejected',
    protocolModule.normalizeIosLocalCaptureShortcutUrl(signedReleaseShortcut),
    null);
  eq('local capture protocol: another GitHub owner is rejected',
    protocolModule.normalizeIosLocalCaptureShortcutUrl(
      'https://github.com/other/Wafra/releases/download/ios-catchup-beta-20260910-v1/Wafra-Local-Capture-signed.shortcut',
    ), null);
  for (const candidate of [
    undefined,
    '',
    ' https://www.icloud.com/shortcuts/0123456789abcdef0123456789abcdef',
    'http://www.icloud.com/shortcuts/0123456789abcdef0123456789abcdef',
    'https://icloud.com/shortcuts/0123456789abcdef0123456789abcdef',
    'https://user@www.icloud.com/shortcuts/0123456789abcdef0123456789abcdef',
    'https://www.icloud.com/shortcuts/0123456789abcdef0123456789abcdef/',
    'https://www.icloud.com/shortcuts/0123456789abcdef0123456789abcdef?x=1',
    'https://www.icloud.com/shortcuts/0123456789abcdef0123456789abcdef#x',
    'https://www.icloud.com/shortcuts/not-hex-not-hex-not-hex-not-hex',
    'https://www.icloud.com/shortcuts/03d2ab22a33f4fef9d503142575a70fb',
    'https://www.icloud.com/shortcuts/85bd1e080e5849b591049eccffb9a3a1',
  ]) {
    eq(`local capture protocol: rejects unsafe or retired URL ${String(candidate)}`,
      protocolModule.normalizeIosLocalCaptureShortcutUrl(candidate), null);
  }
  eq('local capture protocol: the retired EAS value is unavailable at runtime',
    protocolModule.IOS_LOCAL_CAPTURE_SHORTCUT_URL, null);

  eq('setup readiness: first real alert outranks synthetic proof',
    setupModule.resolveIosSetupReadiness(status({
      enabled: true,
      setupProofVersion: null,
      firstCapturedAt: 1_800_000_000_000,
    })), 'first-alert-captured');
  eq('setup readiness: exact proof version maps to waiting state',
    setupModule.resolveIosSetupReadiness(status({ enabled: true, setupProofVersion: 1 })),
    'shortcut-proven');
  eq('setup readiness: unsupported proof versions cannot forge readiness',
    setupModule.resolveIosSetupReadiness(status({ enabled: true, setupProofVersion: 2 })),
    'not-added');
  eq('setup readiness: disabled admission cannot reuse historical proof as readiness',
    setupModule.resolveIosSetupReadiness(status({
      enabled: false,
      setupProofVersion: 1,
      firstCapturedAt: 1_800_000_000_000,
    })),
    'not-added');

  eq('setup restoration: a fresh Future row starts with the published Shortcut',
    setupModule.resolveIosFutureSetupStep({
      futureShortcutConfirmed: false,
      futureAutomationConfirmed: false,
      futureStatus: 'not-started',
    }, 'not-added'), 'add-shortcut');
  eq('setup restoration: a remount after the install handoff asks for confirmation',
    setupModule.resolveIosFutureSetupStep({
      futureShortcutConfirmed: false,
      futureAutomationConfirmed: false,
      futureStatus: 'in-progress',
    }, 'not-added'), 'confirm-shortcut');
  eq('setup restoration: a skipped Future row can restart from the published Shortcut',
    setupModule.resolveIosFutureSetupStep({
      futureShortcutConfirmed: false,
      futureAutomationConfirmed: false,
      futureStatus: 'skipped',
    }, 'not-added'), 'add-shortcut');
  eq('setup restoration: confirmed Shortcut progress resumes at Apple automation',
    setupModule.resolveIosFutureSetupStep({
      futureShortcutConfirmed: true,
      futureAutomationConfirmed: false,
      futureStatus: 'in-progress',
    }, 'not-added'), 'create-automation');
  eq('setup restoration: self-confirmed automation without native proof stays retryable',
    setupModule.resolveIosFutureSetupStep({
      futureShortcutConfirmed: true,
      futureAutomationConfirmed: true,
      futureStatus: 'in-progress',
    }, 'not-added'), 'prove-shortcut');
  eq('setup restoration: native no-input proof is the only ready transition',
    setupModule.resolveIosFutureSetupStep({
      futureShortcutConfirmed: true,
      futureAutomationConfirmed: true,
      futureStatus: 'in-progress',
    }, 'shortcut-proven'), 'ready');

  eq('setup trigger guard: one explicitly selected bank sender is supported',
    setupModule.isSupportedIosMessageAutomationTrigger({
      selectedSenderCount: 1,
      messageContains: null,
    }), true);
  for (const [name, trigger] of [
    ['Any Sender', { selectedSenderCount: 'any', messageContains: null }],
    ['blank universal trigger', { selectedSenderCount: 0, messageContains: null }],
    ['space trigger', { selectedSenderCount: 0, messageContains: ' ' }],
    ['AED keyword trigger', { selectedSenderCount: 0, messageContains: 'AED' }],
    ['SAR keyword trigger', { selectedSenderCount: 0, messageContains: 'SAR' }],
  ]) {
    eq(`setup trigger guard: rejects ${name}`,
      setupModule.isSupportedIosMessageAutomationTrigger(trigger), false);
  }

  {
    const events = [];
    let durableCalls = 0;
    const outcome = await setupModule.completeIosMessageOnboardingAttempt({
      retryRequired: false,
      ensureDurable: async () => {
        durableCalls += 1;
        events.push(`durable:${durableCalls}`);
        if (durableCalls === 2) throw new Error('final save');
      },
      markFinished: async () => { events.push('progress:finished'); },
      markStarted: async () => { events.push('progress:started'); },
      setOnboarded: () => { events.push('ledger:onboarded'); },
    });
    eq('setup completion: a failed final save restores onboarding return for retry',
      [outcome, events], [
        'retry-required',
        [
          'durable:1',
          'progress:finished',
          'ledger:onboarded',
          'durable:2',
          'progress:started',
        ],
      ]);
  }

  {
    const events = [];
    const outcome = await setupModule.completeIosMessageOnboardingAttempt({
      retryRequired: true,
      ensureDurable: async () => { events.push('durable'); },
      markFinished: async () => { events.push('progress:finished'); },
      markStarted: async () => { events.push('progress:started'); },
      setOnboarded: () => { events.push('ledger:onboarded'); },
    });
    eq('setup completion: retry skips the dangerous preflight and ledger mutation',
      [outcome, events], [
        'complete',
        ['progress:finished', 'durable'],
      ]);
  }

  {
    const harness = controllerHarness({ supported: false });
    await harness.controller.send({ type: 'load' });
    eq('setup controller: unsupported platforms remain manual-only', harness.controller.getModel(), {
      loading: false,
      supported: false,
      shortcutAvailable: false,
      stage: 'shortcut',
      readiness: 'not-added',
      opening: false,
      failure: null,
      captureHealth: null,
    });
    ok('setup controller: unsupported platforms never resolve a native module',
      harness.statusReads() === 0);
    harness.controller.dispose();
  }

  {
    const harness = controllerHarness({ nativeAvailable: false });
    await harness.controller.send({ type: 'load' });
    ok('setup controller: a supported iPhone with a missing module fails closed',
      harness.controller.getModel().supported &&
        !harness.controller.getModel().shortcutAvailable &&
        harness.controller.getModel().failure === 'load' &&
        harness.statusReads() === 0,
      JSON.stringify(harness.controller.getModel()));
    harness.controller.dispose();
  }

  {
    const harness = controllerHarness({ nativeAvailable: false });
    await harness.controller.send({ type: 'load' });
    let exited = false;
    try {
      await harness.controller.send({ type: 'manual-only' });
      exited = true;
    } catch {}
    ok('setup controller: missing native capture still permits the safe manual-only exit',
      exited && !harness.controller.getModel().opening);
    harness.controller.dispose();
  }

  for (const [nativeStatus, readiness, stage] of [
    [status(), 'not-added', 'shortcut'],
    [status({ enabled: true, setupProofVersion: 1, setupProofAt: 5 }), 'shortcut-proven', 'automation'],
    [status({ enabled: true, setupProofVersion: 1, firstCapturedAt: 7 }), 'first-alert-captured', 'automation'],
  ]) {
    const harness = controllerHarness({ initialStatus: nativeStatus });
    await harness.controller.send({ type: 'load' });
    ok(`setup controller: native status maps to ${readiness}`,
      harness.controller.getModel().readiness === readiness &&
        harness.controller.getModel().stage === stage &&
        harness.controller.getModel().shortcutAvailable,
      JSON.stringify(harness.controller.getModel()));
    harness.controller.dispose();
  }

  {
    const harness = controllerHarness();
    await harness.controller.send({ type: 'load' });
    await harness.controller.send({ type: 'install-shortcut' });
    eq('setup controller: install opens the validated iCloud URL directly',
      [...harness.capabilityChecks, ...harness.opened],
      [publishedShortcut]);
    ok('setup controller: install handoff advances without enabling capture',
      harness.controller.getModel().stage === 'automation' &&
        harness.enableCalls.length === 0 &&
        harness.controller.getModel().failure === null);
    harness.controller.dispose();
  }

  {
    const harness = controllerHarness({
      dependencyOverrides: { canOpenUrl: async () => false },
    });
    await harness.controller.send({ type: 'load' });
    await harness.controller.send({ type: 'install-shortcut' });
    ok('setup controller: install does not trust a flaky Shortcuts capability probe',
      harness.controller.getModel().failure === null &&
        harness.opened[0] === publishedShortcut && harness.enableCalls.length === 0);
    harness.controller.dispose();
  }

  {
    const harness = controllerHarness({
      dependencyOverrides: { openUrl: async () => { throw new Error('handoff'); } },
    });
    await harness.controller.send({ type: 'load' });
    await harness.controller.send({ type: 'install-shortcut' });
    ok('setup controller: an install handoff failure remains retryable',
      harness.controller.getModel().failure === 'shortcut-install' &&
        !harness.controller.getModel().opening);
    harness.controller.dispose();
  }

  {
    const harness = controllerHarness({ shortcutUrl: null });
    await harness.controller.send({ type: 'load' });
    await harness.controller.send({ type: 'install-shortcut' });
    ok('setup controller: an unpublished Shortcut never opens a fallback',
      !harness.controller.getModel().shortcutAvailable &&
        harness.controller.getModel().failure === 'shortcut-install' &&
        harness.opened.length === 0);
    harness.controller.dispose();
  }

  {
    const harness = controllerHarness();
    await harness.controller.send({ type: 'load' });
    await harness.controller.send({ type: 'shortcut-added' });
    ok('setup controller: user install attestation advances but cannot forge proof',
      harness.controller.getModel().stage === 'automation' &&
        harness.controller.getModel().readiness === 'not-added' &&
        harness.enableCalls.length === 0);
    harness.controller.dispose();
  }

  {
    const harness = controllerHarness();
    await harness.controller.send({ type: 'load' });
    await harness.controller.send({ type: 'open-automation' });
    eq('setup controller: opening automation does not enable native admission',
      { checks: harness.capabilityChecks, opens: harness.opened, enable: harness.enableCalls },
      { checks: ['shortcuts://'], opens: ['shortcuts://'], enable: [] });
    harness.controller.dispose();
  }

  {
    const events = [];
    const harness = controllerHarness({
      dependencyOverrides: {
        canOpenUrl: async (url) => { events.push(`can:${url}`); return true; },
        openUrl: async (url) => { events.push(`open:${url}`); },
      },
    });
    harness.native.setCaptureEnabled = async (value) => { events.push(`enable:${value}`); };
    await harness.controller.send({ type: 'load' });
    await harness.controller.send({ type: 'automation-added' });
    eq('setup controller: explicit automation confirmation enables before no-input proof run',
      events, [
        'can:shortcuts://',
        'enable:true',
        `open:${protocolModule.iosLocalCaptureTestUrl()}`,
      ]);
    harness.controller.dispose();
  }

  {
    let opened = 0;
    const harness = controllerHarness({
      dependencyOverrides: { openUrl: async () => { opened += 1; } },
    });
    harness.native.setCaptureEnabled = async () => { throw new Error('protected store'); };
    await harness.controller.send({ type: 'load' });
    await harness.controller.send({ type: 'automation-added' });
    ok('setup controller: enable failure prevents the synthetic run',
      opened === 0 && harness.controller.getModel().failure === 'shortcut-run' &&
        !harness.controller.getModel().opening);
    harness.controller.dispose();
  }

  {
    const gate = deferred();
    let enableCalls = 0;
    let opens = 0;
    const harness = controllerHarness({
      dependencyOverrides: { openUrl: async () => { opens += 1; } },
    });
    harness.native.setCaptureEnabled = async () => {
      enableCalls += 1;
      await gate.promise;
    };
    await harness.controller.send({ type: 'load' });
    const first = harness.controller.send({ type: 'automation-added' });
    const second = harness.controller.send({ type: 'automation-added' });
    await Promise.resolve();
    gate.resolve();
    await Promise.all([first, second]);
    ok('setup controller: double taps join one enable-and-open operation',
      enableCalls === 1 && opens === 1,
      JSON.stringify({ enableCalls, opens }));
    harness.controller.dispose();
  }

  {
    let activeStatus = status();
    const harness = controllerHarness({
      dependencyOverrides: {
        getNativeModule: () => ({
          getCaptureStatus: async () => ({ ...activeStatus }),
          setCaptureEnabled: async () => {},
        }),
      },
    });
    await harness.controller.send({ type: 'load' });
    await harness.controller.send({ type: 'shortcut-callback', result: 'success' });
    ok('setup controller: a forged success callback cannot create proof',
      harness.controller.getModel().readiness === 'not-added');
    activeStatus = status({ enabled: true, setupProofVersion: 1, setupProofAt: 8 });
    await harness.controller.send({ type: 'shortcut-callback', result: 'success' });
    ok('setup controller: a callback reflects only proof read from native status',
      harness.controller.getModel().readiness === 'shortcut-proven');
    harness.controller.dispose();
  }

  {
    const harness = controllerHarness();
    await harness.controller.send({ type: 'load' });
    harness.setStatus(status({ enabled: true, setupProofVersion: 1 }));
    harness.signal();
    await nextMicrotask();
    await nextMicrotask();
    ok('setup controller: a source-free signal refreshes mounted readiness',
      harness.controller.getModel().readiness === 'shortcut-proven');
    harness.controller.dispose();
    ok('setup controller: status subscription is removed on disposal',
      harness.unsubscribed());
  }

  {
    const firstRead = deferred();
    let reads = 0;
    let latest = status();
    let listener = () => {};
    const native = {
      getCaptureStatus: async () => {
        reads += 1;
        return reads === 1 ? firstRead.promise : { ...latest };
      },
      setCaptureEnabled: async () => {},
    };
    const controller = setupModule.createIosCaptureSetup({
      dependencies: {
        isSupported: () => true,
        getNativeModule: () => native,
        shortcutUrl: publishedShortcut,
        canOpenUrl: async () => true,
        openUrl: async () => {},
        subscribeCaptureStatus: (next) => {
          listener = next;
          return () => {};
        },
      },
    });
    const loading = controller.send({ type: 'load' });
    await Promise.resolve();
    latest = status({ enabled: true, setupProofVersion: 1 });
    listener();
    firstRead.resolve(status());
    await loading;
    await nextMicrotask();
    await nextMicrotask();
    ok('setup controller: a status signal during a read is replayed after stale data',
      reads === 2 && controller.getModel().readiness === 'shortcut-proven',
      JSON.stringify({ reads, model: controller.getModel() }));
    controller.dispose();
  }

  {
    const read = deferred();
    let unsubscribed = false;
    const controller = setupModule.createIosCaptureSetup({
      dependencies: {
        isSupported: () => true,
        getNativeModule: () => ({
          getCaptureStatus: async () => read.promise,
          setCaptureEnabled: async () => {},
        }),
        shortcutUrl: publishedShortcut,
        canOpenUrl: async () => true,
        openUrl: async () => {},
        subscribeCaptureStatus: () => () => { unsubscribed = true; },
      },
    });
    const loading = controller.send({ type: 'load' });
    await Promise.resolve();
    controller.dispose();
    read.resolve(status({ setupProofVersion: 1 }));
    await loading;
    ok('setup controller: disposal suppresses stale status publication and cleans up',
      controller.getModel().loading && unsubscribed,
      JSON.stringify(controller.getModel()));
  }

  {
    let enabled = 0;
    const harness = controllerHarness();
    harness.native.setCaptureEnabled = async (value) => {
      if (value) throw new Error('unexpected implicit enable');
      enabled += 1;
    };
    await harness.controller.send({ type: 'load' });
    await harness.controller.send({ type: 'install-shortcut' });
    await harness.controller.send({ type: 'shortcut-callback', result: 'success' });
    await harness.controller.send({ type: 'shortcut-added' });
    ok('setup controller: load, install return, callback, and attestation never enable',
      enabled === 0);
    harness.controller.dispose();
  }

  {
    const enableStarted = deferred();
    const releaseEnable = deferred();
    const events = [];
    let captureEnabled = false;
    let opens = 0;
    const harness = controllerHarness({
      dependencyOverrides: { openUrl: async () => { opens += 1; } },
    });
    harness.native.setCaptureEnabled = async (value) => {
      if (value) {
        events.push('enable:true:start');
        enableStarted.resolve();
        await releaseEnable.promise;
        captureEnabled = true;
        events.push('enable:true:end');
        return;
      }
      captureEnabled = false;
      events.push('enable:false');
    };
    await harness.controller.send({ type: 'load' });
    const confirming = harness.controller.send({ type: 'automation-added' });
    await enableStarted.promise;
    const leaving = harness.controller.send({ type: 'manual-only' });
    await Promise.resolve();
    releaseEnable.resolve();
    await Promise.all([confirming, leaving]);
    eq('setup controller: manual-only waits for an in-flight enable then disables last',
      { events, captureEnabled, opens }, {
        events: ['enable:true:start', 'enable:true:end', 'enable:false'],
        captureEnabled: false,
        opens: 0,
      });
    harness.controller.dispose();
  }

  {
    const events = [];
    const harness = controllerHarness();
    harness.native.setCaptureEnabled = async (value) => {
      events.push(`disable:${value}`);
    };
    await harness.controller.send({ type: 'load' });
    await harness.controller.send({ type: 'manual-only' });
    events.push('navigate');
    eq('setup controller: manual-only disables native admission before navigation',
      events, ['disable:false', 'navigate']);
    harness.controller.dispose();
  }

  {
    const disabled = deferred();
    let disables = 0;
    const harness = controllerHarness();
    harness.native.setCaptureEnabled = async () => {
      disables += 1;
      await disabled.promise;
    };
    await harness.controller.send({ type: 'load' });
    const first = harness.controller.send({ type: 'manual-only' });
    const second = harness.controller.send({ type: 'manual-only' });
    await Promise.resolve();
    const busy = harness.controller.getModel().opening;
    disabled.resolve();
    await Promise.all([first, second]);
    ok('setup controller: repeated manual-only taps join one visibly busy disable',
      busy && disables === 1 && !harness.controller.getModel().opening,
      JSON.stringify({ busy, disables, model: harness.controller.getModel() }));
    harness.controller.dispose();
  }

  {
    let navigated = false;
    const harness = controllerHarness();
    harness.native.setCaptureEnabled = async () => { throw new Error('disable failed'); };
    await harness.controller.send({ type: 'load' });
    try {
      await harness.controller.send({ type: 'manual-only' });
      navigated = true;
    } catch {}
    ok('setup controller: manual-only disable failure blocks navigation',
      !navigated && harness.controller.getModel().failure === 'load');
    harness.controller.dispose();
  }

  {
    let opened = 0;
    const harness = controllerHarness({
      dependencyOverrides: {
        canOpenUrl: async () => false,
        openUrl: async () => { opened += 1; },
      },
    });
    await harness.controller.send({ type: 'load' });
    await harness.controller.send({ type: 'install-shortcut' });
    ok('setup controller: direct HTTPS install is independent of Shortcuts scheme probing',
      opened === 1 && harness.controller.getModel().stage === 'automation' &&
        !harness.controller.getModel().opening);
    harness.controller.dispose();
  }

  {
    linkingUrls.length = 0;
    linkingCanOpenUrls.length = 0;
    const controller = setupModule.createIosCaptureSetup({
      dependencies: { shortcutUrl: publishedShortcut },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'install-shortcut' });
    ok('setup controller: production Linking wrappers preserve their receiver',
      linkingCanOpenUrls.length === 0 &&
        linkingUrls.at(-1) === publishedShortcut &&
        controller.getModel().failure === null,
      JSON.stringify({ linkingCanOpenUrls, linkingUrls, model: controller.getModel() }));
    controller.dispose();
  }

  console.log(`\nios-capture-setup: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
