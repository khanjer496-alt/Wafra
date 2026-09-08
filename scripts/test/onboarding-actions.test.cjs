'use strict';
// Execute the shipping actions, extracted by declaration name rather than hook
// position. Substitutes cover native I/O, persistence, router and UI setters.
// This is a focused behavioral harness, not a native permission integration test.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.WAFRA_REPO_ROOT || path.resolve(__dirname, '../..');
const ts = require(path.join(root, 'node_modules/typescript'));
const load = require(path.join(root, 'scripts/test/repair/load-typescript.cjs'));
const sourcePath = process.env.WAFRA_ONBOARDING_SOURCE || path.join(root, 'src/components/onboarding-gate.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const ast = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const actionNames = ['startScan', 'beginCapture', 'continueManually', 'runSetupAction', 'openWafra'];
const declarations = new Map();
let overlayExpression;
let backDisabledExpression;
const completionFragments = new Map();
function collect(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && actionNames.includes(node.name.text)) {
    assert.ok(!declarations.has(node.name.text), `Only one shipping ${node.name.text} action`);
    declarations.set(node.name.text, `const ${node.getText(ast)};`);
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'showOverlay') {
    assert.equal(overlayExpression, undefined, 'One actual render condition owns the overlay');
    overlayExpression = node.initializer.getText(ast);
  }
  if (ts.isJsxElement(node)) {
    const attributes = node.openingElement.attributes.getText(ast);
    const content = node.getText(ast);
    if (attributes.includes('styles.captureActions') && content.includes('openWafra')) completionFragments.set('actions', content);
    if (attributes.includes('styles.questionTitle') && content.includes('automaticCompletion')) completionFragments.set('title', content);
    if (attributes.includes('styles.questionBodyCopy') && content.includes('automaticCompletion')) completionFragments.set('body', content);
  }
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'BackHeader') {
    const disabled = node.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === 'disabled');
    if (disabled?.initializer && ts.isJsxExpression(disabled.initializer)) backDisabledExpression = disabled.initializer.expression.getText(ast);
  }
  ts.forEachChild(node, collect);
}
collect(ast);
for (const name of actionNames) assert.ok(declarations.has(name), `Shipping action exists: ${name}`);
assert.ok(overlayExpression, 'Actual onboarding visibility expression exists');
assert.ok(backDisabledExpression, 'Actual back navigation has a disabled condition');
assert.equal(completionFragments.size, 3, 'Actual completion title, body and actions are rendered');
const program = ts.transpileModule(
  `${[...declarations.values()].join('\n')}\n({ ${actionNames.join(', ')} });`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText;
const clone = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function actions(options = {}) {
  const events = [];
  const ui = { outcome: null, step: 'capture', denied: false, cleanup: null, result: null, busy: false,
    finishing: false, finishSaveFailed: false };
  const ledger = { hydrated: true, captureOptOut: options.optOut ?? false, onboarded: false, transactions: [], accounts: [] };
  const record = (name, ...args) => events.push([name, ...clone(args)]);
  const service = (name, fallback) => async (...args) => {
    record(name, ...args);
    return options[name] ? options[name](...args) : fallback;
  };
  const context = {
    Platform: { OS: options.platform ?? 'android' },
    setupBusyRef: { current: false },
    requestedFirstEntry: { current: false },
    setFinishing(value) { ui.finishing = value; record('finishing', value); },
    setFinishSaveFailed(value) { ui.finishSaveFailed = value; record('finish-save-failed', value); },
    get finishing() { return ui.finishing; },
    get finishSaveFailed() { return ui.finishSaveFailed; },
    state: ledger,
    showRecovery: false,
    isIosSetupRoute: false,
    setSetupBusy(value) { ui.busy = value; record('busy', value); },
    setSmsDenied(value) { ui.denied = value; record('denied', value); },
    setResult(value) { ui.result = clone(value); record('result', value); },
    setCompletionOutcome(value) { ui.outcome = value; record('outcome', value); },
    setStep(value) { ui.step = value; record('step', value); },
    setShortcutCleanup(value) { ui.cleanup = value; record('cleanup', value); },
    async setCaptureOptOut(value) {
      record('capture-write-start', value);
      if (options.setCaptureOptOut) await options.setCaptureOptOut(value);
      ledger.captureOptOut = value;
      record('capture-write-durable', value);
    },
    requestSmsPermission: service('requestSmsPermission', options.granted ?? true),
    beginHistoryImport: service('beginHistoryImport'),
    ensureDurable: service('ensureDurable'),
    getRelayConfigStrict: service('getRelayConfigStrict', options.relay ?? null),
    unpairDevice: service('unpairDevice'),
    disableRelayBackgroundSync: service('disableRelayBackgroundSync'),
    dispatchIosMessageSetup: service('dispatchIosMessageSetup'),
    isSmsScanningAvailable: () => options.scanAvailable ?? true,
    setOnboarded() { ledger.onboarded = true; record('setOnboarded'); },
    committed() { record('committed'); },
    router: { push(route) { record('route', route); } },
  };
  const handlers = vm.runInNewContext(program, context, { filename: sourcePath });
  Object.assign(context, handlers, {
    exports: {},
    View: 'View', Button: 'Button', ThemedText: 'Text',
    styles: new Proxy({}, { get: () => ({}) }), night: new Proxy({}, { get: () => 'color' }),
    t: key => key,
    goBack() { record('goBack'); },
    automaticCompletion: false,
    require(name) {
      assert.equal(name, 'react/jsx-runtime');
      const jsx = (type, props = {}) => ({ type, props });
      return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    },
  });
  Object.defineProperties(context, {
    setupBusy: { get: () => ui.busy },
    completionOutcome: { get: () => ui.outcome },
    smsDenied: { get: () => ui.denied },
    failedCompletion: { get: () => ui.step === 'complete' && ui.outcome === 'failed' },
  });
  const isOverlayVisible = () => vm.runInNewContext(overlayExpression, context, { filename: sourcePath });
  const renderProgram = ts.transpileModule(`() => [${[...completionFragments.values()].join(',\n')}];`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    fileName: 'actual-completion-fragments.tsx',
  }).outputText;
  const render = vm.runInNewContext(renderProgram, context, { filename: sourcePath });
  return { ...handlers, events, ui, ledger, isOverlayVisible,
    isBackDisabled: () => vm.runInNewContext(backDisabledExpression, context, { filename: sourcePath }),
    renderCompletion: () => isOverlayVisible() ? render() : null };
}
const calls = (h, name) => h.events.filter(event => event[0] === name);
function before(h, first, second) {
  const a = h.events.findIndex(event => event[0] === first);
  const b = h.events.findIndex(event => event[0] === second);
  assert.ok(a >= 0 && b > a, `${first} must precede ${second}: ${JSON.stringify(h.events)}`);
}
function remainsEmpty(h) {
  assert.deepEqual(h.ledger.transactions, []);
  assert.deepEqual(h.ledger.accounts, []);
}
const fails = async () => { throw new Error('synthetic service failure'); };

test('manual choice waits for durable opt-out even with retained Android SMS access', async () => {
  const gate = deferred();
  const h = actions({ granted: true, setCaptureOptOut: () => gate.promise });
  const pending = h.continueManually();
  await flush();
  assert.equal(h.ui.outcome, null, 'No manual success before the write settles');
  assert.equal(h.ledger.captureOptOut, false);
  assert.equal(calls(h, 'requestSmsPermission').length, 0);
  assert.equal(calls(h, 'beginHistoryImport').length, 0);
  gate.resolve(); await pending;
  assert.equal(h.ledger.captureOptOut, true);
  assert.equal(h.ui.outcome, 'manual');
  assert.equal(h.ui.step, 'complete');
  assert.equal(h.ledger.onboarded, false, 'Choice does not bypass the final action');
  before(h, 'capture-write-durable', 'outcome');
  remainsEmpty(h);
});

test('manual choice reports a failed opt-out write without claiming setup success', async () => {
  const h = actions({ setCaptureOptOut: fails });
  await h.continueManually();
  assert.equal(h.ui.outcome, 'failed');
  assert.equal(h.ledger.onboarded, false);
  assert.equal(calls(h, 'capture-write-durable').length, 0);
  assert.equal(calls(h, 'getRelayConfigStrict').length, 0);
  remainsEmpty(h);
});

test('iOS manual fallback revokes a previously paired relay before clearing setup return', async () => {
  const relay = { id: 'synthetic-relay', ingestToken: 'synthetic-token' };
  const h = actions({ platform: 'ios', relay });
  await h.continueManually();
  assert.equal(h.ui.outcome, 'manual');
  assert.equal(h.ui.cleanup, 'revoked');
  assert.deepEqual(calls(h, 'unpairDevice'), [['unpairDevice', relay]]);
  assert.deepEqual(calls(h, 'dispatchIosMessageSetup'), [['dispatchIosMessageSetup', { type: 'onboarding-return-cleared' }]]);
  before(h, 'capture-write-durable', 'getRelayConfigStrict');
  before(h, 'unpairDevice', 'dispatchIosMessageSetup');
  before(h, 'dispatchIosMessageSetup', 'outcome');
  remainsEmpty(h);
});

for (const service of ['getRelayConfigStrict', 'unpairDevice']) {
  test(`iOS manual fallback keeps failure visible when ${service} fails`, async () => {
    const h = actions({ platform: 'ios', relay: { id: 'synthetic-relay' }, [service]: fails });
    await h.continueManually();
    assert.equal(h.ledger.captureOptOut, true, 'The immediate local stop remains active');
    assert.equal(h.ui.outcome, 'failed');
    assert.equal(h.ui.cleanup, 'uncertain', 'Never represent uncertain revocation as done');
    assert.equal(calls(h, 'disableRelayBackgroundSync').length, 1);
    assert.equal(calls(h, 'dispatchIosMessageSetup').length, 0);
    assert.equal(h.ledger.onboarded, false);
    remainsEmpty(h);
  });
}

test('iOS manual fallback with no relay does not pretend it revoked one', async () => {
  const h = actions({ platform: 'ios' });
  await h.continueManually();
  assert.equal(h.ui.outcome, 'manual');
  assert.equal(h.ui.cleanup, null);
  assert.equal(calls(h, 'unpairDevice').length, 0);
  assert.equal(calls(h, 'disableRelayBackgroundSync').length, 1);
  assert.equal(calls(h, 'dispatchIosMessageSetup').length, 1);
});

test('best-effort background unregister failure does not undo successful iOS relay revocation', async () => {
  const h = actions({ platform: 'ios', relay: { id: 'synthetic-relay' }, disableRelayBackgroundSync: fails });
  await h.continueManually();
  assert.equal(h.ui.outcome, 'manual');
  assert.equal(h.ui.cleanup, 'revoked');
  assert.equal(h.ledger.captureOptOut, true);
  before(h, 'unpairDevice', 'dispatchIosMessageSetup');
});

test('iOS return-marker persistence failure prevents manual success', async () => {
  const h = actions({ platform: 'ios', dispatchIosMessageSetup: fails });
  await h.continueManually();
  assert.equal(h.ui.outcome, 'failed');
  assert.equal(h.ledger.captureOptOut, true);
  assert.equal(h.ledger.onboarded, false);
});

test('Android capture clears the manual choice durably before reading history', async () => {
  const gate = deferred();
  const h = actions({ optOut: true, setCaptureOptOut: () => gate.promise });
  const pending = h.startScan();
  await flush();
  assert.equal(h.ledger.captureOptOut, true);
  assert.equal(calls(h, 'beginHistoryImport').length, 0);
  assert.equal(h.ui.outcome, null);
  gate.resolve(); await pending;
  assert.equal(h.ledger.captureOptOut, false);
  assert.equal(h.ui.outcome, 'automatic');
  before(h, 'requestSmsPermission', 'capture-write-start');
  before(h, 'capture-write-durable', 'beginHistoryImport');
  before(h, 'beginHistoryImport', 'setOnboarded');
  before(h, 'ensureDurable', 'committed');
  remainsEmpty(h);
});

test('Android permission denial preserves the manual choice and offers a denied result', async () => {
  const h = actions({ optOut: true, granted: false });
  await h.startScan();
  assert.equal(h.ui.outcome, 'denied');
  assert.equal(h.ui.denied, true);
  assert.equal(h.ledger.captureOptOut, true);
  assert.equal(h.ledger.onboarded, false);
  assert.equal(calls(h, 'capture-write-start').length, 0);
  assert.equal(calls(h, 'beginHistoryImport').length, 0);
});

for (const service of ['requestSmsPermission', 'setCaptureOptOut', 'beginHistoryImport', 'ensureDurable']) {
  test(`Android capture shows failure without a committed success when ${service} fails`, async () => {
    const h = actions({ optOut: true, [service]: fails });
    await h.startScan();
    assert.equal(h.ui.outcome, 'failed');
    assert.equal(h.ui.step, 'complete');
    assert.equal(calls(h, 'committed').length, 0);
    if (service !== 'ensureDurable') assert.equal(h.ledger.onboarded, false);
    if (service === 'requestSmsPermission' || service === 'setCaptureOptOut') {
      assert.equal(calls(h, 'beginHistoryImport').length, 0);
      assert.equal(h.ledger.captureOptOut, true);
    }
    remainsEmpty(h);
  });
}

test('Android capture entry point delegates to the permission and history path', async () => {
  const h = actions({ granted: false });
  await h.beginCapture(); await flush();
  assert.equal(calls(h, 'requestSmsPermission').length, 1);
  assert.equal(h.ui.outcome, 'denied');
  assert.equal(calls(h, 'route').length, 0);
});

test('unavailable Android SMS bridge reports setup failure until the user explicitly chooses manual tracking', async () => {
  const h = actions({ platform: 'android', scanAvailable: false });
  await h.runSetupAction(h.beginCapture);
  assert.equal(h.ui.outcome, 'failed', 'An unavailable bridge cannot stand in for the manual choice');
  assert.equal(h.ui.step, 'complete');
  assert.equal(h.ledger.onboarded, false);
  assert.equal(h.ledger.captureOptOut, false);
  assert.equal(calls(h, 'capture-write-start').length, 0, 'Do not invent manual consent');
  assert.equal(calls(h, 'requestSmsPermission').length, 0);
  assert.equal(calls(h, 'beginHistoryImport').length, 0);
  assert.equal(calls(h, 'committed').length, 0);
  assert.equal(calls(h, 'route').length, 0);
  remainsEmpty(h);
  const buttons = walk(h.renderCompletion()).filter(node => node.type === 'Button');
  assert.deepEqual(buttons.map(node => node.props.label), ['onboardRetrySetup', 'onboardManualChoice'],
    'Failure offers setup retry and explicit manual consent, without completion or entry promotion');
  buttons.find(node => node.props.label === 'onboardManualChoice').props.onPress();
  await flush();
  assert.equal(h.ui.outcome, 'manual');
  assert.equal(h.ledger.captureOptOut, true, 'The rendered manual action persists the explicit choice');
  assert.equal(h.ledger.onboarded, false, 'Manual choice still leaves the final completion action to the user');
  remainsEmpty(h);
});

test('iOS automatic choice waits for its opt-in write before entering local setup', async () => {
  const gate = deferred();
  const h = actions({ platform: 'ios', optOut: true, setCaptureOptOut: () => gate.promise });
  const pending = h.beginCapture();
  await flush();
  assert.equal(calls(h, 'route').length, 0);
  gate.resolve(); await pending;
  assert.deepEqual(calls(h, 'route'), [['route', '/ios-setup?fromOnboarding=1']]);
  assert.equal(h.ui.outcome, null, 'Entering setup is not setup completion');
  assert.equal(h.ledger.onboarded, false);
  assert.equal(calls(h, 'requestSmsPermission').length, 0);
  assert.equal(calls(h, 'beginHistoryImport').length, 0);
  assert.equal(calls(h, 'dispatchIosMessageSetup').length, 0, 'Do not manufacture Shortcut/history evidence');
});

test('failed iOS opt-in stays in onboarding and never opens setup', async () => {
  const h = actions({ platform: 'ios', optOut: true, setCaptureOptOut: fails });
  await h.beginCapture();
  assert.equal(h.ui.outcome, 'failed');
  assert.equal(calls(h, 'route').length, 0);
  assert.equal(h.ledger.captureOptOut, true);
});

test('pending Android setup rejects a second choice until the entire scan settles', async () => {
  const gate = deferred();
  const h = actions({ beginHistoryImport: () => gate.promise });
  const first = h.runSetupAction(h.beginCapture);
  await flush();
  assert.equal(h.ui.busy, true, 'The entry action must await its scan');
  await h.runSetupAction(h.continueManually);
  assert.deepEqual(calls(h, 'capture-write-start'), [['capture-write-start', false]],
    'A rapid manual tap cannot race the already-running automatic choice');
  assert.equal(calls(h, 'requestSmsPermission').length, 1);
  assert.equal(calls(h, 'beginHistoryImport').length, 1);
  gate.resolve(); await first;
  assert.equal(h.ui.busy, false);
  await h.runSetupAction(h.continueManually);
  assert.equal(h.ui.outcome, 'manual', 'Later intentional choices remain usable');
  assert.equal(h.ledger.captureOptOut, true);
});

test('setup serialization releases the busy state after an unexpected rejection', async () => {
  const h = actions();
  await assert.rejects(h.runSetupAction(fails), /synthetic service failure/);
  assert.equal(h.ui.busy, false);
  await h.runSetupAction(h.continueManually);
  assert.equal(h.ui.outcome, 'manual');
});

test('add-first-entry navigation waits for durable onboarding and repeated taps open it once', async () => {
  const gate = deferred();
  const h = actions({ ensureDurable: () => gate.promise });
  const first = h.runSetupAction(() => h.openWafra(true));
  await flush();
  assert.equal(calls(h, 'route').length, 0);
  assert.equal(calls(h, 'committed').length, 0);
  assert.equal(h.ui.busy, true);
  await h.runSetupAction(() => h.openWafra(true));
  assert.equal(calls(h, 'setOnboarded').length, 1);
  gate.resolve(); await first;
  assert.deepEqual(calls(h, 'route'), [['route', '/add-transaction']]);
  before(h, 'ensureDurable', 'committed');
  before(h, 'committed', 'route');
  assert.equal(h.ui.busy, false);
  remainsEmpty(h);
});

test('manual empty Home completion stays on Home after persistence without adding sample entries', async () => {
  const h = actions();
  await h.continueManually();
  await h.runSetupAction(() => h.openWafra());
  assert.equal(h.ledger.captureOptOut, true);
  assert.equal(h.ledger.onboarded, true);
  assert.equal(calls(h, 'ensureDurable').length, 1);
  assert.equal(calls(h, 'route').length, 0);
  assert.equal(calls(h, 'committed').length, 1);
  remainsEmpty(h);
});

test('failed final save blocks add-first-entry navigation and releases the action for retry', async () => {
  let attempts = 0;
  const h = actions({ ensureDurable: async () => { if (++attempts === 1) await fails(); } });
  await h.runSetupAction(() => h.openWafra(true));
  assert.equal(h.ui.outcome, 'failed');
  assert.equal(h.ui.busy, false);
  assert.equal(calls(h, 'route').length, 0);
  assert.equal(calls(h, 'committed').length, 0);
  await h.runSetupAction(() => h.openWafra(true));
  assert.deepEqual(calls(h, 'route'), [['route', '/add-transaction']]);
  assert.equal(calls(h, 'committed').length, 1);
  remainsEmpty(h);
});

test('the real overlay stays visible through a failed completion save and its rendered Retry preserves Add first entry', async () => {
  const firstSave = deferred();
  const retrySave = deferred();
  let saves = 0;
  const h = actions({ ensureDurable: () => ++saves === 1 ? firstSave.promise : retrySave.promise });
  await h.continueManually();
  const pending = h.runSetupAction(() => h.openWafra(true));
  await flush();
  assert.equal(h.ledger.onboarded, true, 'Model the real reducer update before persistence');
  assert.equal(h.isOverlayVisible(), true, 'Home must remain covered while the completion write is pending');
  assert.equal(h.isBackDisabled(), true);
  firstSave.reject(new Error('synthetic completion write failure'));
  await pending;
  assert.equal(h.isOverlayVisible(), true, 'Failure UI must remain visible despite the earlier onboarded dispatch');
  assert.equal(h.ui.busy, false, 'The actual retry control can become enabled');
  assert.equal(h.isBackDisabled(), true, 'Failure cannot navigate back into capture after completion was dispatched');
  const failed = h.renderCompletion();
  assert.ok(failed, 'The real render condition admits the failure surface');
  assert.match(text(failed), /onboardFinishSaveFailedTitle/);
  assert.match(text(failed), /onboardFinishSaveFailedBody/);
  const buttons = walk(failed).filter(node => node.type === 'Button');
  assert.equal(buttons.length, 1, 'Failure exposes one save retry rather than restarting capture');
  assert.equal(buttons[0].props.label, 'storageRecoveryRetry');
  assert.equal(buttons[0].props.disabled, false);
  buttons[0].props.onPress();
  await flush();
  assert.equal(saves, 2, 'Click the rendered shipping retry, not a substitute handler');
  assert.equal(h.isOverlayVisible(), true);
  assert.equal(calls(h, 'route').length, 0);
  retrySave.resolve(); await flush();
  assert.equal(h.isOverlayVisible(), false, 'Only successful persistence releases the overlay');
  assert.equal(h.ui.finishSaveFailed, false);
  assert.equal(h.isBackDisabled(), false);
  assert.deepEqual(calls(h, 'route'), [['route', '/add-transaction']], 'Retry retains the original requested destination');
  assert.equal(calls(h, 'beginHistoryImport').length, 0);
  assert.equal(calls(h, 'getRelayConfigStrict').length, 0);
  remainsEmpty(h);
});

test('automatic capture final-save failure retains the overlay and rendered Retry saves without another permission or history scan', async () => {
  const firstSave = deferred();
  const retrySave = deferred();
  let saves = 0;
  const h = actions({ optOut: true, ensureDurable: () => ++saves === 1 ? firstSave.promise : retrySave.promise });
  const pending = h.runSetupAction(h.beginCapture);
  await flush();
  assert.equal(calls(h, 'requestSmsPermission').length, 1);
  assert.equal(calls(h, 'beginHistoryImport').length, 1);
  assert.equal(h.ledger.captureOptOut, false);
  assert.equal(h.ledger.onboarded, true);
  assert.equal(h.isOverlayVisible(), true, 'Automatic completion stays covered until its final write is durable');
  firstSave.reject(new Error('synthetic automatic completion save failure'));
  await pending;
  assert.equal(h.isOverlayVisible(), true, 'The save failure stays visible after the onboarded dispatch');
  assert.equal(h.isBackDisabled(), true);
  assert.equal(h.ledger.captureOptOut, false, 'A save failure must not undo the successful capture choice');
  const failure = h.renderCompletion();
  assert.match(text(failure), /onboardFinishSaveFailedTitle/);
  assert.match(text(failure), /onboardFinishSaveFailedBody/);
  const buttons = walk(failure).filter(node => node.type === 'Button');
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].props.label, 'storageRecoveryRetry');
  assert.equal(buttons[0].props.disabled, false);
  buttons[0].props.onPress();
  await flush();
  assert.equal(saves, 2, 'The real rendered action retries only persistence');
  assert.equal(calls(h, 'requestSmsPermission').length, 1);
  assert.equal(calls(h, 'beginHistoryImport').length, 1);
  assert.deepEqual(calls(h, 'capture-write-start'), [['capture-write-start', false]]);
  assert.equal(h.isOverlayVisible(), true);
  assert.equal(calls(h, 'committed').length, 0);
  retrySave.resolve(); await flush();
  assert.equal(h.isOverlayVisible(), false);
  assert.equal(h.ui.finishSaveFailed, false);
  assert.equal(h.ledger.captureOptOut, false);
  assert.equal(calls(h, 'route').length, 0, 'Automatic setup retry does not open the manual entry form');
  assert.equal(calls(h, 'committed').length, 1);
});

// The complete preview module gets only rendering, localization and haptic
// dependencies. Any future store, parser, native or persistence import fails
// closed rather than supplying a mock that could silently accept a write.
function preview(language) {
  const hooks = []; let index = 0;
  const jsx = (type, props = {}) => ({ type, props });
  const themes = load(path.join(root, 'src/constants/theme.ts'), {
    '@/global.css': {}, 'react-native': { Platform: { select: values => values.android } },
  });
  const i18n = load(process.env.WAFRA_ONBOARDING_I18N || path.join(root, 'src/lib/i18n.ts'));
  const deps = {
    react: { useState(initial) {
      const position = index++;
      if (!(position in hooks)) hooks[position] = typeof initial === 'function' ? initial() : initial;
      return [hooks[position], value => { hooks[position] = typeof value === 'function' ? value(hooks[position]) : value; }];
    } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Pressable: 'Pressable', View: 'View', StyleSheet: { create: value => value, hairlineWidth: 1 } },
    'react-native-reanimated': { __esModule: true, default: { View: 'Animated.View' },
      FadeIn: { duration: () => ({}) }, FadeInDown: { duration: () => ({}) } },
    '@/components/themed-text': { ThemedText: 'Text' },
    '@/components/ui/icon': { Icon: 'Icon' },
    '@/constants/theme': themes,
    '@/hooks/use-language': { useLanguage: () => language },
    '@/lib/i18n': i18n,
    '@/lib/haptics': { tapped() {} },
  };
  const component = load(process.env.WAFRA_ONBOARDING_PREVIEW || path.join(root, 'src/components/onboarding/money-preview.tsx'), deps).MoneyPreview;
  return { render() { index = 0; return component({ reducedMotion: true }); }, i18n };
}
function walk(node, out = []) {
  if (Array.isArray(node)) node.forEach(child => walk(child, out));
  else if (node && typeof node === 'object') { out.push(node); walk(node.props?.children, out); }
  return out;
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join(' ');
  return node && typeof node === 'object' ? text(node.props?.children) : typeof node === 'string' ? node : '';
}
for (const language of ['en', 'ar']) {
  test(`sample interaction remains local and labeled before and after reveal/reset: ${language}`, () => {
    const h = preview(language);
    let tree = h.render();
    for (let press = 0; press < 3; press++) {
      assert.ok(text(tree).includes(h.i18n.t('onboardSampleLabel', language)));
      assert.ok(text(tree).includes(h.i18n.t('onboardSampleNote', language)));
      const button = walk(tree).find(node => node.type === 'Pressable' && typeof node.props.onPress === 'function');
      assert.ok(button, 'The real preview has an interactive action');
      const previous = text(tree);
      button.props.onPress(); tree = h.render();
      assert.notEqual(text(tree), previous, 'The actual action changes its preview');
      assert.equal(walk(tree).filter(node => node.type === 'Animated.View' && node.props.entering !== undefined).length, 0,
        'Reduced-motion render does not request an entering animation');
    }
  });
}
