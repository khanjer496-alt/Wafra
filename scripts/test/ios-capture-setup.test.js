const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

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

const ROOT = path.join(__dirname, '../..');
const execute = (relative, requireModule) => {
  const filename = path.join(ROOT, relative);
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
    requireModule, loaded, loaded.exports, filename, path.dirname(filename),
  );
  return loaded.exports;
};

class RelayError extends Error {
  constructor(message, retryable, code) {
    super(message);
    this.retryable = retryable;
    this.code = code;
  }
}

const linkingUrls = [];
const linkingCanOpenUrls = [];
let linkingSettingsOpened = 0;
const shortcutTestOptions = [];
const AUTOMATION_GENERATION_A = 'a'.repeat(43);
const AUTOMATION_GENERATION_B = 'b'.repeat(43);
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
  async openSettings() {
    this._validateURL('app-settings:');
    linkingSettingsOpened += 1;
  },
};

const setupModule = execute('src/lib/ios-capture-setup.ts', (id) => {
  if (id === 'expo-clipboard') return { setStringAsync: async () => {} };
  if (id === 'expo-haptics') {
    return {
      NotificationFeedbackType: { Success: 'success' },
      notificationAsync: async () => {},
      selectionAsync: async () => {},
    };
  }
  if (id === 'react-native') {
    return { Platform: { OS: 'web' }, Linking: receiverSensitiveLinking };
  }
  if (id === '@/lib/background-relay') {
    return {
      disableRelayBackgroundSync: async () => {},
      enableRelayBackgroundSync: async () => true,
    };
  }
  if (id === '@/lib/capture-executor') {
    return { createCaptureExecutor: () => ({ execute: async () => ({ kind: 'setup-waiting' }) }) };
  }
  if (id === '@/lib/notifications') return { requestSilentCapturePermission: async () => true };
  if (id === '@/lib/relay') {
    return {
      DEFAULT_RELAY_URL: 'https://relay.test',
      DEFAULT_SHORTCUT_URL: 'https://www.icloud.com/shortcuts/test',
      getRelayAutomationProof: async () => null,
      getRelayConfig: async () => null,
      isRelayAutomationProofCurrent: (active, proof) => {
        return active?.setupState === 'verified' &&
          active.automationGeneration === proof;
      },
      markRelayAutomationPrepared: async (active) => ({
        ...active,
        automationPreparedAt: 1_800_000_000_000,
        automationGeneration: AUTOMATION_GENERATION_B,
      }),
      markRelayConfigured: async (config) => ({ ...config, setupState: 'configured' }),
      subscribeRelayAutomationProof: () => () => {},
      pairDevice: async () => { throw new Error('unexpected pair'); },
      RelayError,
      unpairDevice: async () => {},
    };
  }
  if (id === '@/lib/relay-protocol') {
    return {
      shortcutSetupCode: (url, token) => `WAFRA ${url} ${token}`,
      shortcutTestUrl: (options) => {
        shortcutTestOptions.push(options);
        return 'wafra://capture-test';
      },
    };
  }
  throw new Error(`unexpected dependency ${id}`);
});

const protocolModule = execute('src/lib/relay-protocol.ts', (id) => {
  throw new Error(`unexpected relay protocol dependency ${id}`);
});

const config = (state = 'paired', extra = {}) => ({
  baseUrl: 'https://relay.test',
  deviceId: 'device',
  ingestToken: 'secret-ingest-token-123456',
  adminToken: 'secret-admin-token',
  syncToken: 'secret-sync-token',
  privateKey: 'secret-private-key',
  market: 'AE',
  ingestUrl: 'https://relay.test/v1/ingest',
  pairedAt: 1,
  setupState: state,
  ...extra,
});

const clock = () => {
  let now = 0;
  let id = 0;
  const timers = new Map();
  return {
    value: {
      now: () => now,
      set: (callback) => {
        const key = ++id;
        timers.set(key, callback);
        return key;
      },
      clear: (key) => timers.delete(key),
    },
    advance: (ms) => { now += ms; },
    run: () => {
      const pending = [...timers.values()];
      timers.clear();
      for (const callback of pending) callback();
    },
  };
};

const ledger = (state = { hydrated: true, privateMode: false, lastScanTs: 0 }) => ({
  getState: () => state,
  importBatch: () => ({ ids: [], durable: Promise.resolve() }),
  ensureDurable: async () => {},
  markParserVersion: () => {},
});

(async () => {
  eq('relay protocol: the safe test returns every x-callback outcome to setup',
    protocolModule.shortcutTestUrl(),
    'shortcuts://x-callback-url/run-shortcut?name=Wafra%20Capture&input=text&text=WAFRA_CAPTURE_TEST_V1&x-success=wafra%3A%2F%2Fios-setup%3FshortcutResult%3Dsuccess&x-cancel=wafra%3A%2F%2Fios-setup%3FshortcutResult%3Dcancel&x-error=wafra%3A%2F%2Fios-setup%3FshortcutResult%3Derror');
  eq('relay protocol: onboarding survives every native x-callback return',
    protocolModule.shortcutTestUrl({ fromOnboarding: true }),
    'shortcuts://x-callback-url/run-shortcut?name=Wafra%20Capture&input=text&text=WAFRA_CAPTURE_TEST_V1&x-success=wafra%3A%2F%2Fios-setup%3FshortcutResult%3Dsuccess%26fromOnboarding%3D1&x-cancel=wafra%3A%2F%2Fios-setup%3FshortcutResult%3Dcancel%26fromOnboarding%3D1&x-error=wafra%3A%2F%2Fios-setup%3FshortcutResult%3Derror%26fromOnboarding%3D1');

  {
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: { getConfig: async () => config() },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'install-shortcut' });
    ok('setup controller: the production URL opener preserves the Linking receiver',
      linkingUrls.at(-1) === 'https://www.icloud.com/shortcuts/test' &&
        controller.getModel().failure === null,
      JSON.stringify({ linkingUrls, failure: controller.getModel().failure }));
    controller.dispose();
  }

  {
    let opens = 0;
    let polls = 0;
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      captureExecutor: {
        execute: async () => { polls += 1; return { kind: 'setup-waiting' }; },
      },
      dependencies: {
        isWeb: false,
        getConfig: async () => config('configured'),
        openUrl: async () => { opens += 1; },
      },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'shortcut-callback', result: 'success' });
    await Promise.resolve();
    ok('setup controller: a cold x-success resumes relay polling without rerunning Shortcuts',
      controller.getModel().step === 2 && controller.getModel().listening &&
        !controller.getModel().captureOn && opens === 0 && polls === 1,
      JSON.stringify({ model: controller.getModel(), opens, polls }));
    controller.dispose();
  }

  {
    let polls = 0;
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      captureExecutor: {
        execute: async () => {
          polls += 1;
          return {
            kind: 'setup-observed', merchant: 'Wafra Capture', isTest: true, verifiedAt: 9,
          };
        },
      },
      dependencies: { getConfig: async () => config('configured') },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'start-test' });
    await Promise.resolve();
    await controller.send({ type: 'shortcut-callback', result: 'success' });
    await Promise.resolve();
    ok('setup controller: a late x-success cannot consume an already verified probe twice',
      polls === 1 && controller.getModel().captureOn && !controller.getModel().listening &&
        controller.getModel().captured?.merchant === 'Wafra Capture' &&
        controller.getModel().shortcutCallbackResult === 'success',
      JSON.stringify({ polls, model: controller.getModel() }));
    controller.dispose();
  }

  for (const result of ['cancel', 'error']) {
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: { getConfig: async () => config('verified', { verifiedAt: 9 }) },
    });
    await controller.send({ type: 'load' });
    const before = controller.getModel();
    await controller.send({ type: 'shortcut-callback', result });
    ok(`setup controller: a verified idle setup ignores a late x-${result}`,
      controller.getModel().step === before.step && controller.getModel().captureOn &&
        controller.getModel().failure === null &&
        controller.getModel().shortcutCallbackResult === before.shortcutCallbackResult,
      JSON.stringify(controller.getModel()));
    controller.dispose();
  }

  {
    let polls = 0;
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      captureExecutor: {
        execute: async () => { polls += 1; return { kind: 'setup-waiting' }; },
      },
      dependencies: { getConfig: async () => config('configured') },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'start-test' });
    await controller.send({ type: 'shortcut-callback', result: 'cancel' });
    ok('setup controller: x-cancel stops waiting immediately and remains retryable',
      !controller.getModel().listening && !controller.getModel().captureOn &&
        controller.getModel().failure === null && polls === 1,
      JSON.stringify(controller.getModel()));
    controller.dispose();
  }

  {
    let proof = null;
    let proofListener = () => {};
    let unsubscribed = false;
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: {
        getConfig: async () => config('verified', {
          automationPreparedAt: 1_800_000_000_000,
          automationGeneration: AUTOMATION_GENERATION_B,
        }),
        getAutomationProof: async () => proof,
        subscribeAutomationProof: (listener) => {
          proofListener = listener;
          return () => { unsubscribed = true; };
        },
      },
    });
    await controller.send({ type: 'load' });
    ok('setup controller: a mounted waiting screen starts from persisted non-proof',
      controller.getModel().automationPrepared && !controller.getModel().automationActive);
    proof = AUTOMATION_GENERATION_B;
    proofListener();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    ok('setup controller: a local proof write refreshes the mounted waiting screen',
      controller.getModel().automationActive,
      JSON.stringify(controller.getModel()));
    controller.dispose();
    ok('setup controller: proof refresh subscription is removed on disposal', unsubscribed);
  }

  {
    let storedConfig = config('verified', {
      automationPreparedAt: 1_800_000_000_000,
      automationGeneration: AUTOMATION_GENERATION_B,
    });
    let proof = AUTOMATION_GENERATION_B;
    let proofListener = () => {};
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: {
        getConfig: async () => storedConfig,
        getAutomationProof: async () => proof,
        subscribeAutomationProof: (listener) => {
          proofListener = listener;
          return () => {};
        },
      },
    });
    await controller.send({ type: 'load' });
    ok('setup controller: mounted relay status starts active before revocation',
      controller.getModel().paired && controller.getModel().automationActive);
    storedConfig = null;
    proof = null;
    proofListener();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    ok('setup controller: a relay revocation immediately resets the mounted setup screen',
      controller.getModel().step === 0 && !controller.getModel().paired &&
        !controller.getModel().captureOn && !controller.getModel().automationPrepared &&
        !controller.getModel().automationActive,
      JSON.stringify(controller.getModel()));
    controller.dispose();
  }

  {
    const staleConfig = config('verified', {
      automationPreparedAt: 1_800_000_000_000,
      automationGeneration: AUTOMATION_GENERATION_B,
    });
    let storedConfig = staleConfig;
    let proofListener = () => {};
    let resolveFirstProof;
    let proofReads = 0;
    const firstProof = new Promise((resolve) => { resolveFirstProof = resolve; });
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: {
        getConfig: async () => storedConfig,
        getAutomationProof: async () => {
          proofReads += 1;
          return proofReads === 1 ? firstProof : null;
        },
        subscribeAutomationProof: (listener) => {
          proofListener = listener;
          return () => {};
        },
      },
    });
    const loading = controller.send({ type: 'load' });
    await Promise.resolve();
    storedConfig = null;
    proofListener();
    resolveFirstProof(AUTOMATION_GENERATION_B);
    await loading;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    ok('setup controller: a relay signal during load is replayed after stale reads settle',
      proofReads === 2 && controller.getModel().step === 0 &&
        !controller.getModel().paired && !controller.getModel().automationActive,
      JSON.stringify({ proofReads, model: controller.getModel() }));
    controller.dispose();
  }

  {
    let storedConfig = config('configured', {
      automationPreparedAt: 1_800_000_000_000,
      automationGeneration: AUTOMATION_GENERATION_B,
    });
    let proofListener = () => {};
    let proofReads = 0;
    let releaseNotificationProof;
    let notificationProofStarted;
    const notificationProofGate = new Promise((resolve) => {
      releaseNotificationProof = resolve;
    });
    const notificationProofRead = new Promise((resolve) => {
      notificationProofStarted = resolve;
    });
    let resolvePoll;
    const pollResult = new Promise((resolve) => { resolvePoll = resolve; });
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      captureExecutor: { execute: async () => pollResult },
      dependencies: {
        getConfig: async () => storedConfig,
        getAutomationProof: async () => {
          proofReads += 1;
          if (proofReads === 1) return null;
          if (proofReads === 2) {
            notificationProofStarted();
            return notificationProofGate;
          }
          return AUTOMATION_GENERATION_B;
        },
        subscribeAutomationProof: (listener) => {
          proofListener = listener;
          return () => {};
        },
      },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'start-test' });
    proofListener();
    await notificationProofRead;
    storedConfig = config('verified', {
      verifiedAt: 1_800_000_000_100,
      automationPreparedAt: 1_800_000_000_000,
      automationGeneration: AUTOMATION_GENERATION_B,
    });
    resolvePoll({
      kind: 'setup-observed', merchant: 'Wafra Capture', isTest: true,
      verifiedAt: 1_800_000_000_100,
    });
    await Promise.resolve();
    await Promise.resolve();
    releaseNotificationProof(AUTOMATION_GENERATION_B);
    await new Promise((resolve) => setImmediate(resolve));
    ok('setup controller: a proof refresh replays after the safe-test poll advances config',
      proofReads === 3 && controller.getModel().captureOn &&
        controller.getModel().automationActive,
      JSON.stringify({ proofReads, model: controller.getModel() }));
    controller.dispose();
  }

  {
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: { getConfig: async () => config('paired') },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'shortcut-callback', result: 'cancel' });
    ok('setup controller: an unsolicited callback cannot skip an uninstalled Shortcut',
      controller.getModel().step === 1 && !controller.getModel().listening &&
        controller.getModel().failure === null,
      JSON.stringify(controller.getModel()));
    controller.dispose();
  }

  {
    const before = shortcutTestOptions.length;
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {}, fromOnboarding: true,
      captureExecutor: { execute: async () => ({ kind: 'setup-waiting' }) },
      dependencies: { isWeb: false, getConfig: async () => config('configured') },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'start-test' });
    eq('setup controller: onboarding context reaches the Shortcut callback builder',
      shortcutTestOptions.slice(before), [{ fromOnboarding: true }]);
    controller.dispose();
  }

  {
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      captureExecutor: { execute: async () => ({ kind: 'setup-waiting' }) },
      dependencies: { getConfig: async () => config('configured') },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'start-test' });
    await controller.send({ type: 'shortcut-callback', result: 'error' });
    ok('setup controller: x-error stops waiting with actionable non-proof',
      !controller.getModel().listening && !controller.getModel().captureOn &&
        controller.getModel().failure === 'shortcut-run' &&
        controller.getModel().recovery === 'shortcut',
      JSON.stringify(controller.getModel()));
    controller.dispose();
  }

  {
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: {
        getConfig: async () => config('verified', {
          verifiedAt: 1_800_000_000_100,
          automationPreparedAt: 1_800_000_000_200,
          automationGeneration: AUTOMATION_GENERATION_B,
        }),
        getAutomationProof: async () => AUTOMATION_GENERATION_A,
      },
    });
    await controller.send({ type: 'load' });
    ok('setup controller: durable preparation survives re-entry without accepting stale proof',
      controller.getModel().step === 3 && controller.getModel().automationPrepared === true &&
        controller.getModel().automationActive === false && controller.getModel().captureOn,
      JSON.stringify(controller.getModel()));
    controller.dispose();
  }

  {
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: {
        getConfig: async () => config('verified', {
          verifiedAt: 1_800_000_000_100,
          automationPreparedAt: 1_800_000_000_200,
          automationGeneration: AUTOMATION_GENERATION_B,
        }),
        getAutomationProof: async () => AUTOMATION_GENERATION_B,
      },
    });
    await controller.send({ type: 'load' });
    ok('setup controller: only proof matching the current setup generation is active',
      controller.getModel().automationPrepared && controller.getModel().automationActive,
      JSON.stringify(controller.getModel()));
    controller.dispose();
  }

  {
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      captureExecutor: {
        execute: async () => ({
          kind: 'setup-observed', merchant: 'Wafra Capture', isTest: true, verifiedAt: 9,
        }),
      },
      dependencies: {
        getConfig: async () => config('configured', {
          automationGeneration: AUTOMATION_GENERATION_B,
        }),
        getAutomationProof: async () => AUTOMATION_GENERATION_B,
      },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'start-test' });
    await Promise.resolve();
    ok('setup controller: device-scoped automation proof becomes active only after pipe proof',
      controller.getModel().captureOn && controller.getModel().automationActive &&
        controller.getModel().step === 2,
      JSON.stringify(controller.getModel()));
    controller.dispose();
  }

  {
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: { getConfig: async () => config() },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'open-settings' });
    eq('setup controller: the production settings opener preserves the Linking receiver',
      linkingSettingsOpened, 1);
    controller.dispose();
  }

  {
    const proofQueries = [];
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: {
        getConfig: async () => config('verified', {
          automationGeneration: AUTOMATION_GENERATION_B,
        }),
        getAutomationProof: async (deviceId) => {
          proofQueries.push(deviceId);
          return AUTOMATION_GENERATION_B;
        },
      },
    });
    await controller.send({ type: 'load' });
    ok('setup controller: strong background proof is distinct and device-scoped',
      JSON.stringify(proofQueries) === JSON.stringify(['device']) &&
        controller.getModel().automationActive === true &&
        controller.getModel().automationPrepared === true &&
        controller.getModel().captureOn === true,
      JSON.stringify({ proofQueries, model: controller.getModel() }));
    controller.dispose();
  }

  {
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: {
        getConfig: async () => config('configured', {
          automationGeneration: AUTOMATION_GENERATION_B,
        }),
        getAutomationProof: async () => AUTOMATION_GENERATION_B,
      },
    });
    await controller.send({ type: 'load' });
    ok('setup controller: stale automation proof cannot outrank unverified pipe state',
      controller.getModel().step === 2 && controller.getModel().automationPrepared === false &&
        controller.getModel().automationActive === false && !controller.getModel().captureOn,
      JSON.stringify(controller.getModel()));
    controller.dispose();
  }

  {
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      captureExecutor: { execute: async () => ({ kind: 'setup-waiting' }) },
      dependencies: { isWeb: false, getConfig: async () => config('configured') },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'start-test' });
    ok('setup controller: the production capability check preserves the Linking receiver',
      linkingCanOpenUrls.at(-1) === 'shortcuts://' &&
        linkingUrls.at(-1) === 'wafra://capture-test',
      JSON.stringify({ linkingCanOpenUrls, linkingUrls }));
    controller.dispose();
  }

  {
    let resolveLoad;
    let pairs = 0;
    const pending = new Promise((resolve) => { resolveLoad = resolve; });
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: {
        getConfig: () => pending,
        pair: async () => { pairs += 1; return config(); },
      },
    });
    const loading = controller.send({ type: 'load' });
    await controller.send({ type: 'connect' });
    eq('setup controller: loading blocks a duplicate pairing identity', pairs, 0);
    resolveLoad(config('verified'));
    await loading;
    ok('setup controller: an existing verified phone routes directly to proof state',
      controller.getModel().step === 3 && controller.getModel().captureOn);
    controller.dispose();
  }

  {
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: { getConfig: async () => config('configured') },
    });
    await controller.send({ type: 'load' });
    ok('setup controller: a legacy configured phone resumes at the safe test',
      controller.getModel().step === 2 && !controller.getModel().captureOn,
      JSON.stringify(controller.getModel()));
    controller.dispose();
  }

  {
    let pairs = 0;
    let releasePair;
    const pairing = new Promise((resolve) => { releasePair = resolve; });
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: {
        getConfig: async () => null,
        pair: async () => { pairs += 1; return pairing; },
      },
    });
    await controller.send({ type: 'load' });
    const first = controller.send({ type: 'connect' });
    const second = controller.send({ type: 'connect' });
    await Promise.resolve();
    eq('setup controller: a double tap starts one pair request', pairs, 1);
    releasePair(config());
    await Promise.all([first, second]);
    controller.dispose();
  }

  {
    const events = [];
    let polls = 0;
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      captureExecutor: {
        execute: async () => { polls += 1; return { kind: 'setup-waiting' }; },
      },
      dependencies: {
        isWeb: false,
        getConfig: async () => config(),
        canOpenUrl: async (url) => { events.push(`can:${url}`); return true; },
        markConfigured: async (active) => {
          events.push('configured');
          return { ...active, setupState: 'configured' };
        },
        writeClipboard: async (value) => void events.push(`clipboard:${value}`),
        openUrl: async (url) => void events.push(`open:${url}`),
        selectionHaptic: async () => {},
      },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'install-shortcut' });
    await controller.send({ type: 'shortcut-installed' });
    ok('setup controller: the setup code is copied before Shortcuts opens',
      events[1].startsWith('clipboard:WAFRA ') &&
        events[2] === 'open:https://www.icloud.com/shortcuts/test');
    ok('setup controller: continue clears the credential without reading the pasteboard',
      events[3] === 'clipboard:');
    ok('setup controller: install confirmation is durable before the safe-test handoff',
      events[4] === 'configured' && events[5] === 'can:shortcuts://' &&
        events[6] === 'open:wafra://capture-test', JSON.stringify(events));
    ok('setup controller: confirming the install moves to and starts the safe test',
      events[5] === 'can:shortcuts://' && events[6] === 'open:wafra://capture-test' &&
        controller.getModel().step === 2 && controller.getModel().listening && polls === 1,
      JSON.stringify({ events, model: controller.getModel(), polls }));
    controller.dispose();
  }

  {
    const events = [];
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: {
        getConfig: async () => config('verified', { verifiedAt: 100 }),
        canOpenUrl: async (url) => { events.push(`can:${url}`); return false; },
        requestSilentPermission: async () => { events.push('permission'); return true; },
        enableBackground: async () => { events.push('background'); return true; },
        openUrl: async (url) => void events.push(`open:${url}`),
      },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'open-shortcuts-store' });
    await controller.send({ type: 'automation-ready' });
    ok('setup controller: returning from the App Store cannot attest an uninstalled app',
      JSON.stringify(events) === JSON.stringify([
        'open:https://apps.apple.com/app/shortcuts/id1462947752',
        'can:shortcuts://',
      ]) && controller.getModel().failure === 'shortcuts-missing' &&
        !controller.getModel().automationPrepared,
      JSON.stringify({ events, model: controller.getModel() }));
    controller.dispose();
  }

  {
    let permissions = 0;
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: {
        getConfig: async () => config('configured'),
        requestSilentPermission: async () => { permissions += 1; return true; },
      },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'automation-ready' });
    ok('setup controller: automation cannot finalize before pipe verification',
      controller.getModel().step === 2 && controller.getModel().failure === 'configure' &&
        !controller.getModel().automationPrepared && permissions === 0,
      JSON.stringify({ model: controller.getModel(), permissions }));
    controller.dispose();
  }

  {
    let proof = null;
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: {
        getConfig: async () => config('verified'),
        getAutomationProof: async () => proof,
        requestSilentPermission: async () => true,
        enableBackground: async () => true,
      },
    });
    await controller.send({ type: 'load' });
    proof = AUTOMATION_GENERATION_B;
    await controller.send({ type: 'automation-ready' });
    ok('setup controller: finalizing refreshes strong automation proof without exposing its value',
      controller.getModel().automationActive === true &&
        controller.getModel().automationPrepared === true &&
        !JSON.stringify(controller.getModel()).includes(AUTOMATION_GENERATION_B),
      JSON.stringify(controller.getModel()));
    controller.dispose();
  }

  {
    const events = [];
    let polls = 0;
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      captureExecutor: {
        execute: async () => { polls += 1; return { kind: 'setup-waiting' }; },
      },
      dependencies: {
        getConfig: async () => config('verified'),
        requestSilentPermission: async () => { events.push('permission'); return true; },
        enableBackground: async () => { events.push('background'); return true; },
        markConfigured: async (active) => {
          events.push('mark-configured');
          return { ...active, setupState: 'configured' };
        },
      },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'automation-ready' });
    ok('setup controller: finalizing automation never downgrades or reruns verified pipe proof',
      JSON.stringify(events) === JSON.stringify(['permission', 'background']) && polls === 0 &&
        controller.getModel().step === 3 && controller.getModel().captureOn &&
        controller.getModel().automationPrepared === true && !controller.getModel().preparing,
      JSON.stringify({ events, polls, model: controller.getModel() }));
    controller.dispose();
  }

  {
    const events = [];
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: {
        getConfig: async () => config(),
        canOpenUrl: async (url) => { events.push(`can:${url}`); return false; },
        openUrl: async (url) => void events.push(`open:${url}`),
        openSettings: async () => void events.push('settings'),
      },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'open-shortcuts-store' });
    eq('setup controller: missing-app recovery opens Apple HTTPS without a scheme preflight',
      events, ['open:https://apps.apple.com/app/shortcuts/id1462947752']);
    controller.dispose();
  }

  {
    let resolveCapability;
    const events = [];
    const capability = new Promise((resolve) => { resolveCapability = resolve; });
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: {
        getConfig: async () => config('verified'),
        canOpenUrl: async () => { events.push('can'); return capability; },
        requestSilentPermission: async () => { events.push('permission'); return true; },
        enableBackground: async () => { events.push('background'); return true; },
        openUrl: async () => void events.push('open'),
      },
    });
    await controller.send({ type: 'load' });
    const opening = controller.send({ type: 'open-automation' });
    await Promise.resolve();
    await controller.send({ type: 'go-to-step', step: 2 });
    resolveCapability(true);
    await opening;
    eq('setup controller: stale automation capability cannot trigger permission or a handoff',
      events, ['can']);
    controller.dispose();
  }

  {
    const events = [];
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: {
        isWeb: false,
        shortcutUrl: null,
        getConfig: async () => config(),
        canOpenUrl: async (url) => { events.push(`can:${url}`); return false; },
        writeClipboard: async (value) => void events.push(`clipboard:${value}`),
        openUrl: async (url) => void events.push(`open:${url}`),
      },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'install-shortcut' });
    eq('setup controller: a scheme-only install checks Shortcuts before copying credentials',
      events, ['can:shortcuts://']);
    ok('setup controller: a scheme-only install reports the missing Shortcuts recovery',
      controller.getModel().failure === 'shortcuts-missing' &&
        controller.getModel().recovery === 'shortcut');
    controller.dispose();
  }

  for (const unpairFails of [false, true]) {
    const clipboard = [];
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: {
        getConfig: async () => config(),
        writeClipboard: async (value) => void clipboard.push(value),
        unpair: async () => {
          if (unpairFails) throw new Error('offline');
        },
        selectionHaptic: async () => {},
      },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'copy', target: 'setup' });
    await controller.send({ type: 'disconnect' });
    ok(`setup controller: ${unpairFails ? 'failed' : 'successful'} disconnect clears copied credentials`,
      clipboard[0].startsWith('WAFRA ') && clipboard.at(-1) === '' &&
        controller.getModel().failure === (unpairFails ? 'disconnect' : null),
      JSON.stringify({ clipboard, model: controller.getModel() }));
    controller.dispose();
  }

  {
    let resolveCapability;
    const events = [];
    const capability = new Promise((resolve) => { resolveCapability = resolve; });
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: {
        isWeb: false,
        getConfig: async () => config(),
        canOpenUrl: async () => capability,
        writeClipboard: async (value) => void events.push(`clipboard:${value}`),
        openUrl: async () => void events.push('open'),
        unpair: async () => void events.push('unpair'),
      },
    });
    await controller.send({ type: 'load' });
    const installing = controller.send({ type: 'install-shortcut' });
    await Promise.resolve();
    await controller.send({ type: 'disconnect' });
    resolveCapability(true);
    await installing;
    eq('setup controller: disconnect invalidates a pending install capability check',
      events, ['unpair']);
    controller.dispose();
  }

  {
    const clipboard = [];
    let opened = 0;
    let releaseSecret;
    const secretGate = new Promise((resolve) => { releaseSecret = resolve; });
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: {
        getConfig: async () => config(),
        writeClipboard: async (value) => {
          clipboard.push(value);
          if (value.startsWith('WAFRA ')) await secretGate;
        },
        openUrl: async () => { opened += 1; },
        unpair: async () => {},
        selectionHaptic: async () => {},
      },
    });
    await controller.send({ type: 'load' });
    const installing = controller.send({ type: 'install-shortcut' });
    await Promise.resolve();
    await controller.send({ type: 'disconnect' });
    releaseSecret();
    await installing;
    ok('setup controller: disconnect during a clipboard write clears the late secret',
      clipboard[0].startsWith('WAFRA ') && clipboard.at(-1) === '' && opened === 0 &&
        controller.getModel().paired === false,
      JSON.stringify({ clipboard, opened, model: controller.getModel() }));
    controller.dispose();
  }

  {
    const clipboard = [];
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: {
        getConfig: async () => config(),
        writeClipboard: async (value) => void clipboard.push(value),
        openUrl: async () => {},
        selectionHaptic: async () => {},
      },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'install-shortcut' });
    controller.dispose();
    await Promise.resolve();
    ok('setup controller: leaving by header-back clears a copied ingest credential',
      clipboard[0].startsWith('WAFRA ') && clipboard.at(-1) === '');
  }

  {
    const clipboard = [];
    let opened = 0;
    let releaseSecret;
    const secretGate = new Promise((resolve) => { releaseSecret = resolve; });
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: {
        getConfig: async () => config(),
        writeClipboard: async (value) => {
          clipboard.push(value);
          if (value.startsWith('WAFRA ')) await secretGate;
        },
        openUrl: async () => { opened += 1; },
        selectionHaptic: async () => {},
      },
    });
    await controller.send({ type: 'load' });
    const installing = controller.send({ type: 'install-shortcut' });
    await Promise.resolve();
    controller.dispose();
    releaseSecret();
    await installing;
    ok('setup controller: disposal during a clipboard write clears after the secret lands',
      clipboard[0].startsWith('WAFRA ') && clipboard.at(-1) === '' && opened === 0,
      JSON.stringify({ clipboard, opened }));
  }

  {
    let resolveClear;
    let capabilityChecks = 0;
    let opens = 0;
    let polls = 0;
    const clearGate = new Promise((resolve) => { resolveClear = resolve; });
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      captureExecutor: {
        execute: async () => { polls += 1; return { kind: 'setup-waiting' }; },
      },
      dependencies: {
        isWeb: false,
        getConfig: async () => config(),
        writeClipboard: async (value) => {
          if (value === '') await clearGate;
        },
        canOpenUrl: async () => { capabilityChecks += 1; return true; },
        openUrl: async () => { opens += 1; },
      },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'install-shortcut' });
    const confirming = controller.send({ type: 'shortcut-installed' });
    await Promise.resolve();
    controller.dispose();
    resolveClear();
    await confirming;
    await Promise.resolve();
    ok('setup controller: disposal during credential clearing cannot launch the safe test',
      opens === 1 && capabilityChecks === 1 && polls === 0,
      JSON.stringify({ opens, capabilityChecks, polls }));
  }

  {
    const clipboard = [];
    let releaseClear;
    let blockedFirstClear = false;
    const clearGate = new Promise((resolve) => { releaseClear = resolve; });
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: {
        getConfig: async () => config(),
        writeClipboard: async (value) => {
          clipboard.push(value);
          if (value === '' && !blockedFirstClear) {
            blockedFirstClear = true;
            await clearGate;
          }
        },
        openUrl: async () => {},
        selectionHaptic: async () => {},
      },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'install-shortcut' });
    const confirming = controller.send({ type: 'shortcut-installed' });
    await Promise.resolve();
    await controller.send({ type: 'copy', target: 'setup' });
    await controller.send({ type: 'install-shortcut' });
    releaseClear();
    await confirming;
    ok('setup controller: confirmation blocks a late copy while clearing credentials',
      clipboard[0].startsWith('WAFRA ') && clipboard.at(-1) === '' &&
        clipboard.length === 2 && controller.getModel().step === 2,
      JSON.stringify({ clipboard, model: controller.getModel() }));
    controller.dispose();
  }

  {
    let releasePair;
    const pendingPair = new Promise((resolve) => { releasePair = resolve; });
    const unpaired = [];
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: {
        getConfig: async () => null,
        pair: async () => pendingPair,
        unpair: async (active) => void unpaired.push(active.deviceId),
      },
    });
    await controller.send({ type: 'load' });
    const pairing = controller.send({ type: 'connect' });
    await Promise.resolve();
    controller.dispose();
    releasePair(config());
    await pairing;
    eq('setup controller: a pairing that finishes after disposal is cleaned up',
      unpaired, ['device']);
  }

  {
    let polls = 0;
    let opened = 0;
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      captureExecutor: {
        execute: async () => { polls += 1; return { kind: 'setup-waiting' }; },
      },
      dependencies: {
        isWeb: false,
        getConfig: async () => config('configured'),
        canOpenUrl: async () => false,
        openUrl: async () => { opened += 1; },
      },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'start-test' });
    ok('setup controller: a missing Shortcuts app blocks the safe test actionably',
      controller.getModel().failure === 'shortcuts-missing' &&
        controller.getModel().recovery === 'shortcut' &&
        !controller.getModel().listening && polls === 0 && opened === 0,
      JSON.stringify({ model: controller.getModel(), polls, opened }));
    controller.dispose();
  }

  {
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      captureExecutor: { execute: async () => ({ kind: 'setup-waiting' }) },
      dependencies: { getConfig: async () => config('verified') },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'start-test' });
    ok('setup controller: every safe-test attempt runs on step two',
      controller.getModel().step === 2 && controller.getModel().listening,
      JSON.stringify(controller.getModel()));
    controller.dispose();
  }

  {
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      captureExecutor: { execute: async () => ({ kind: 'setup-waiting' }) },
      dependencies: { getConfig: async () => config('verified') },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'start-test' });
    await controller.send({ type: 'continue-to-automation' });
    ok('setup controller: verified pipe evidence can advance to Message automation',
      controller.getModel().step === 3 && !controller.getModel().listening &&
        controller.getModel().captureOn,
      JSON.stringify(controller.getModel()));
    controller.dispose();
  }

  {
    let polls = 0;
    let opened = 0;
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      captureExecutor: {
        execute: async () => { polls += 1; return { kind: 'setup-waiting' }; },
      },
      dependencies: {
        isWeb: false,
        getConfig: async () => config('configured'),
        canOpenUrl: async () => { throw new Error('scheme query unavailable'); },
        openUrl: async () => { opened += 1; },
      },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'start-test' });
    ok('setup controller: an unavailable Shortcuts scheme query has missing-app recovery',
      controller.getModel().failure === 'shortcuts-missing' &&
        controller.getModel().recovery === 'shortcut' && polls === 0 && opened === 0,
      JSON.stringify({ model: controller.getModel(), polls, opened }));
    controller.dispose();
  }

  {
    let polls = 0;
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      captureExecutor: {
        execute: async () => { polls += 1; return { kind: 'setup-waiting' }; },
      },
      dependencies: {
        isWeb: false,
        getConfig: async () => config('configured'),
        openUrl: async () => { throw new Error('Shortcuts unavailable'); },
      },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'start-test' });
    ok('setup controller: native Shortcut launch failure is actionable and never starts polling',
      controller.getModel().failure === 'shortcut-run' && !controller.getModel().listening &&
        polls === 0);
    controller.dispose();
  }

  {
    const events = [];
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: {
        getConfig: async () => config(),
        canOpenUrl: async (url) => { events.push(`can:${url}`); return false; },
        requestSilentPermission: async () => { events.push('permission'); return true; },
        enableBackground: async () => { events.push('background'); return true; },
        openUrl: async () => void events.push('open'),
      },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'open-automation' });
    eq('setup controller: missing Shortcuts blocks automation before permission work',
      events, ['can:shortcuts://']);
    ok('setup controller: missing Shortcuts gives the install recovery on automation',
      controller.getModel().failure === 'shortcuts-missing' &&
        controller.getModel().recovery === 'shortcut');
    controller.dispose();
  }

  {
    const events = [];
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: {
        getConfig: async () => config(),
        canOpenUrl: async (url) => { events.push(`can:${url}`); return true; },
        requestSilentPermission: async () => { events.push('permission'); return true; },
        enableBackground: async () => { events.push('background'); return true; },
        openUrl: async () => void events.push('open'),
      },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'open-automation' });
    eq('setup controller: silent permission and registration precede opening automation',
      events, ['can:shortcuts://', 'permission', 'background', 'open']);
    controller.dispose();
  }

  {
    let resolvePoll;
    const result = new Promise((resolve) => { resolvePoll = resolve; });
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      captureExecutor: { execute: async () => result },
      dependencies: { getConfig: async () => config('configured') },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'start-test' });
    await controller.send({ type: 'go-to-step', step: 2 });
    resolvePoll({ kind: 'setup-observed', merchant: 'SHOP', isTest: false, verifiedAt: 9 });
    await Promise.resolve();
    await Promise.resolve();
    ok('setup controller: a stale in-flight poll cannot mutate a different step',
      controller.getModel().step === 2 && controller.getModel().captured === null);
    controller.dispose();
  }

  {
    const clipboard = [];
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: {
        getConfig: async () => config(),
        writeClipboard: async (value) => void clipboard.push(value),
        openUrl: async () => { throw new Error('handoff failed'); },
        selectionHaptic: async () => {},
      },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'install-shortcut' });
    ok('setup controller: a failed Shortcut handoff clears the copied credential',
      clipboard[0].startsWith('WAFRA ') && clipboard.at(-1) === '' &&
        controller.getModel().failure === 'shortcut-install',
      JSON.stringify({ clipboard, model: controller.getModel() }));
    controller.dispose();
  }

  {
    const clipboard = [];
    let releaseClear;
    let clearStarted;
    const clearGate = new Promise((resolve) => { releaseClear = resolve; });
    const clearing = new Promise((resolve) => { clearStarted = resolve; });
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: {
        getConfig: async () => config(),
        writeClipboard: async (value) => {
          clipboard.push(value);
          if (value === '') {
            clearStarted();
            await clearGate;
          }
        },
        openUrl: async () => { throw new Error('handoff failed'); },
        selectionHaptic: async () => {},
      },
    });
    await controller.send({ type: 'load' });
    const installing = controller.send({ type: 'install-shortcut' });
    await clearing;
    await controller.send({ type: 'copy', target: 'setup' });
    ok('setup controller: a failed handoff owns setup while credential clearing is pending',
      controller.getModel().preparing && clipboard.length === 2 &&
        clipboard[0].startsWith('WAFRA ') && clipboard[1] === '',
      JSON.stringify({ clipboard, model: controller.getModel() }));
    releaseClear();
    await installing;
    ok('setup controller: failed handoff cleanup releases setup only after the blank write',
      !controller.getModel().preparing && clipboard.at(-1) === '' &&
        controller.getModel().failure === 'shortcut-install',
      JSON.stringify({ clipboard, model: controller.getModel() }));
    controller.dispose();
  }

  {
    const clipboard = [];
    let opens = 0;
    let releaseUnpair;
    const unpairGate = new Promise((resolve) => { releaseUnpair = resolve; });
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: {
        getConfig: async () => config(),
        writeClipboard: async (value) => void clipboard.push(value),
        openUrl: async () => { opens += 1; },
        unpair: async () => unpairGate,
        selectionHaptic: async () => {},
      },
    });
    await controller.send({ type: 'load' });
    const disconnecting = controller.send({ type: 'disconnect' });
    await Promise.resolve();
    await Promise.resolve();
    await controller.send({ type: 'copy', target: 'setup' });
    await controller.send({ type: 'install-shortcut' });
    releaseUnpair();
    await disconnecting;
    ok('setup controller: copy and install taps are inert while disconnecting',
      clipboard.length === 0 && opens === 0 && !controller.getModel().paired,
      JSON.stringify({ clipboard, opens, model: controller.getModel() }));
    controller.dispose();
  }

  {
    let resolveCapability;
    let opened = 0;
    let polls = 0;
    const capability = new Promise((resolve) => { resolveCapability = resolve; });
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      captureExecutor: {
        execute: async () => { polls += 1; return { kind: 'setup-waiting' }; },
      },
      dependencies: {
        isWeb: false,
        getConfig: async () => config('configured'),
        canOpenUrl: async () => capability,
        openUrl: async () => { opened += 1; },
      },
    });
    await controller.send({ type: 'load' });
    const starting = controller.send({ type: 'start-test' });
    await Promise.resolve();
    await controller.send({ type: 'go-to-step', step: 1 });
    resolveCapability(true);
    await starting;
    await Promise.resolve();
    ok('setup controller: a stale capability check cannot launch or poll after navigation',
      controller.getModel().step === 1 && opened === 0 && polls === 0,
      JSON.stringify({ model: controller.getModel(), opened, polls }));
    controller.dispose();
  }

  {
    let resolveOpen;
    let polls = 0;
    const opening = new Promise((resolve) => { resolveOpen = resolve; });
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      captureExecutor: {
        execute: async () => { polls += 1; return { kind: 'setup-waiting' }; },
      },
      dependencies: {
        isWeb: false,
        getConfig: async () => config('configured'),
        canOpenUrl: async () => true,
        openUrl: async () => opening,
      },
    });
    await controller.send({ type: 'load' });
    const starting = controller.send({ type: 'start-test' });
    await Promise.resolve();
    await Promise.resolve();
    await controller.send({ type: 'go-to-step', step: 1 });
    resolveOpen();
    await starting;
    await Promise.resolve();
    ok('setup controller: returning from a stale Shortcut open cannot start a poll',
      controller.getModel().step === 1 && polls === 0,
      JSON.stringify({ model: controller.getModel(), polls }));
    controller.dispose();
  }

  {
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      captureExecutor: { execute: async () => ({ kind: 'setup-waiting' }) },
      dependencies: { getConfig: async () => config('configured') },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'start-test' });
    await controller.send({ type: 'shortcut-callback', result: 'success' });
    ok('setup controller: an x-callback result is informational while relay proof stays authoritative',
      controller.getModel().shortcutCallbackResult === 'success' &&
        controller.getModel().listening && !controller.getModel().captureOn &&
        controller.getModel().captured === null,
      JSON.stringify(controller.getModel()));
    controller.dispose();
  }

  {
    const fakeClock = clock();
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      captureExecutor: { execute: async () => ({ kind: 'setup-waiting' }) },
      dependencies: { getConfig: async () => config('configured'), clock: fakeClock.value },
      pollMs: 1,
      timeoutMs: 10,
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'start-test' });
    await Promise.resolve();
    fakeClock.advance(11);
    fakeClock.run();
    await Promise.resolve();
    ok('setup controller: timeout is deterministic and stops listening',
      controller.getModel().timedOut && !controller.getModel().listening);
    controller.dispose();
  }

  {
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: { getConfig: async () => config('verified') },
    });
    await controller.send({ type: 'load' });
    const serialized = JSON.stringify(controller.getModel());
    ok('setup controller: the view model never exposes relay credentials',
      !serialized.includes('secret-ingest-token') &&
      !serialized.includes('secret-admin-token') &&
      !serialized.includes('secret-sync-token') &&
      !serialized.includes('secret-private-key'), serialized);
    controller.dispose();
  }

  console.log(`\nios-capture-setup: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
