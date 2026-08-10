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
    return { Platform: { OS: 'web' }, Linking: { openURL: async () => {}, openSettings: async () => {} } };
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
      getRelayConfig: async () => null,
      markRelayConfigured: async (config) => ({ ...config, setupState: 'configured' }),
      pairDevice: async () => { throw new Error('unexpected pair'); },
      RelayError,
      unpairDevice: async () => {},
    };
  }
  if (id === '@/lib/relay-protocol') {
    return {
      shortcutSetupCode: (url, token) => `WAFRA ${url} ${token}`,
      shortcutTestUrl: () => 'wafra://capture-test',
    };
  }
  throw new Error(`unexpected dependency ${id}`);
});

const config = (state = 'paired') => ({
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
    const controller = setupModule.createIosCaptureSetup({
      ledger: ledger(), leavePrivateMode: async () => {},
      dependencies: {
        getConfig: async () => config(),
        writeClipboard: async (value) => void events.push(`clipboard:${value}`),
        openUrl: async (url) => void events.push(`open:${url}`),
        selectionHaptic: async () => {},
      },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'install-shortcut' });
    await controller.send({ type: 'shortcut-installed' });
    ok('setup controller: the setup code is copied before Shortcuts opens',
      events[0].startsWith('clipboard:WAFRA ') && events[1].startsWith('open:'));
    ok('setup controller: continue clears the credential without reading the pasteboard',
      events.at(-1) === 'clipboard:');
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
        requestSilentPermission: async () => { events.push('permission'); return true; },
        enableBackground: async () => { events.push('background'); return true; },
        openUrl: async () => void events.push('open'),
      },
    });
    await controller.send({ type: 'load' });
    await controller.send({ type: 'open-automation' });
    eq('setup controller: silent permission and registration precede opening automation',
      events, ['permission', 'background', 'open']);
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
