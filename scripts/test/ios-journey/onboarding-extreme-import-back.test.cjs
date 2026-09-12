'use strict';
// Execute the shipping import header, its reachable exit handlers, and the
// real ConfirmSheet (including onClose-before-onConfirm). AST extraction keeps
// parsing, ledger saves and unrelated import rendering outside this harness.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const load = require('../repair/load-typescript.cjs');
const root = process.env.WAFRA_REPO_ROOT || path.resolve(__dirname, '../../..');
const sourceFile = path.join(root, 'src/app/import-sms.tsx');
const SESSION_A = 'PAGED-11111111-2222-4333-8444-555555555555';
const SESSION_B = 'PAGED-AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE';
const turn = () => new Promise(resolve => setImmediate(resolve));
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk)
  : [node, ...walk(node.props?.children), ...walk(node.props?.footer)];
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

function importExitProgram(fixtureNames) {
  const source = fs.readFileSync(sourceFile, 'utf8');
  const ast = ts.createSourceFile(sourceFile, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ImportSmsScreen');
  assert.ok(component?.body, 'Shipping import screen exists');
  const declarations = new Map(), selected = new Set(), fragments = [];
  function bindings(node) {
    if (ts.isIdentifier(node)) return [node.text];
    if (ts.isArrayBindingPattern(node) || ts.isObjectBindingPattern(node)) return node.elements.flatMap(element =>
      ts.isBindingElement(element) ? bindings(element.name) : []);
    return [];
  }
  for (const statement of component.body.statements) {
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations)
      for (const name of bindings(declaration.name)) declarations.set(name, declaration);
  }
  function scan(node) {
    if (ts.isJsxSelfClosingElement(node) && ['ScreenHeader', 'ConfirmSheet'].includes(node.tagName.getText(ast))) fragments.push(node);
    ts.forEachChild(node, scan);
  }
  scan(component.body);
  assert.equal(fragments.filter(node => node.tagName.getText(ast) === 'ScreenHeader').length, 1,
    'Exactly one real import header is tested');
  function collect(node) {
    if (ts.isIdentifier(node) && !fixtureNames.has(node.text)) {
      const declaration = declarations.get(node.text);
      if (declaration && !selected.has(declaration)) {
        selected.add(declaration); if (declaration.initializer) collect(declaration.initializer);
      }
    }
    ts.forEachChild(node, collect);
  }
  fragments.forEach(collect);
  // Include component-level assignments/effects for newly added confirmation
  // state/refs, while excluding effects for unrelated history loading.
  const selectedStateNames = new Set([...selected].filter(declaration =>
    ts.isCallExpression(declaration.initializer) && ['useState', 'useRef'].includes(declaration.initializer.expression.getText(ast)))
    .flatMap(declaration => bindings(declaration.name)));
  const touchesSelection = node => {
    if (ts.isIdentifier(node) && selectedStateNames.has(node.text)) return true;
    return ts.forEachChild(node, touchesSelection) ?? false;
  };
  const effectStatements = component.body.statements.filter(statement => ts.isExpressionStatement(statement) &&
    touchesSelection(statement));
  effectStatements.forEach(collect);
  const body = component.body.statements.flatMap(statement => {
    if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.filter(node => selected.has(node))
      .map(node => `const ${node.getText(ast)};`);
    return effectStatements.includes(statement) ? [statement.getText(ast)] : [];
  }).join('\n');
  const program = `(function renderImportExit({ history, historyCommitState, applying, scanning, plan, historyResult }) {
    ${body}
    return [${fragments.map(node => node.getText(ast)).join(',\n')}];
  })`;
  return ts.transpileModule(program, { fileName: 'shipping-import-exit.tsx', compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
}

function screen(options = {}) {
  const nativeCalls = [], changes = [], routes = [], notices = [], events = [], slots = [], effects = [];
  let cursor = 0, tree, live = true;
  const input = { history: options.history === undefined ? SESSION_A : options.history,
    historyCommitState: options.commitState ?? 'idle', applying: options.applying ?? false,
    scanning: false, plan: { txCount: 3 }, historyResult: { sessionId: SESSION_A } };
  const services = { ...options.services };
  const storage = { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} };
  const setup = load(path.join(root, 'src/lib/ios-history-setup.ts'), { '@react-native-async-storage/async-storage': storage }, { process: { env: {} } });
  const importer = load(path.join(root, 'src/lib/ios-history-import.ts'), {
    '@/lib/alert-review-tray': { REVIEW_ALERT_CAP: 100 },
    '@/lib/launch-alert-parser': { createLaunchAlertSession() { throw new Error('Parser outside exit test'); } },
    '@/lib/historical-import': { MAX_HISTORICAL_RECORDS: 3000, parseHistoricalMessageRecords() { throw new Error('Parser outside exit test'); } },
  });
  const controller = setup.createIosHistoryOperationController();
  const lock = { current: options.locked ?? false };
  const jsx = (type, props = {}) => typeof type === 'function' ? type(props) : ({ type, props });
  const slot = create => { const n = cursor++; return slots[n] ?? (slots[n] = create()); };
  const react = {
    useRef: value => slot(() => ({ current: value })),
    useState(value) { const s = slot(() => ({ value: typeof value === 'function' ? value() : value }));
      return [s.value, value => { s.value = typeof value === 'function' ? value(s.value) : value; }]; },
    useCallback(fn, deps) { const s = slot(() => ({})); if (!s.deps || deps.some((v, i) => !Object.is(v, s.deps[i]))) { s.deps = deps; s.value = fn; } return s.value; },
    useEffect(fn, deps) { const s = slot(() => ({})); if (!s.deps || deps.some((v, i) => !Object.is(v, s.deps[i]))) {
      s.deps = deps; effects.push(() => { s.cleanup?.(); s.cleanup = fn(); });
    } },
  };
  const confirm = load(path.join(root, 'src/components/ui/confirm-sheet.tsx'), {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { StyleSheet: { create: v => v }, View: 'View' },
    '@/components/themed-text': { ThemedText: 'Text' }, '@/components/ui/bottom-sheet': { BottomSheet: 'BottomSheet' },
    '@/components/ui/controls': { Button: 'Button' }, '@/constants/theme': { Spacing: { two: 8 } },
    '@/hooks/use-language': { useLanguage: () => 'en' }, '@/lib/i18n': { t: key => key },
  }).ConfirmSheet;
  const native = { async discardSession(id) { nativeCalls.push(id); events.push('discard'); if (services.discardSession) await services.discardSession(id); } };
  const fixtures = {
    ...react, exports: {}, Platform: { OS: options.platform ?? 'ios' },
    history: input.history, historyCommitState: input.historyCommitState, applying: input.applying,
    scanning: input.scanning, plan: input.plan, historyResult: input.historyResult,
    historyOperationLocked: lock, historyOperationController: controller,
    historyNativeModule: async () => { if (services.nativeModule) await services.nativeModule(); return native; },
    discardIosHistorySession: importer.discardIosHistorySession,
    validIosHistorySessionId: setup.validIosHistorySessionId,
    iosHistoryCleanupStateAfterFailure: setup.iosHistoryCleanupStateAfterFailure,
    iosHistorySuccessRoute: setup.iosHistorySuccessRoute,
    iosHistorySetupStorageCoordinator: { run: fn => fn() },
    loadIosMessageSetupProgress: async () => ({ returnToOnboarding: true }),
    clearIosHistoryHandoff: async () => { events.push('clear-handoff'); },
    consumeIosHistoryReturnOrigin: async () => 'onboarding',
    dispatchIosMessageSetup: async event => { changes.push(event); events.push('mark-history'); return { returnToOnboarding: true }; },
    setHistoryCommitState: value => { input.historyCommitState = value; }, setNotice: value => notices.push(value),
    router: { replace: route => routes.push(['replace', route]), back: () => routes.push(['back']) },
    t: key => key, ScreenHeader: 'ScreenHeader', ConfirmSheet: confirm,
    require: name => { assert.equal(name, 'react/jsx-runtime'); return { jsx, jsxs: jsx, Fragment: 'Fragment' }; },
  };
  const renderActual = vm.runInNewContext(importExitProgram(new Set(Object.keys(fixtures))), fixtures, { filename: sourceFile });
  function render() { cursor = 0; tree = renderActual(input); for (const effect of effects.splice(0)) effect(); return tree; }
  const flush = async () => { for (let i = 0; i < 5; i++) { await turn(); if (live) render(); } };
  render();
  const dialog = () => walk(tree).find(node => node.type === 'BottomSheet' && node.props.visible);
  const confirmButton = () => {
    const sheet = dialog(); assert.ok(sheet, 'An explicit discard confirmation must be visible');
    const buttons = walk(sheet.props.footer).filter(node => node.type === 'Button');
    assert.equal(buttons.length, 2, 'Real ConfirmSheet exposes cancel and confirm'); return buttons[1].props;
  };
  return { input, services, nativeCalls, changes, routes, notices, events, controller, lock, flush, render, dialog, confirmButton,
    header: () => walk(tree).find(node => node.type === 'ScreenHeader').props,
    async back() { const header = this.header(); header.onBack(); await flush(); },
    async cancel() { const sheet = dialog(); assert.ok(sheet); sheet.props.onClose(); await flush(); },
    async confirm() { confirmButton().onPress(); await flush(); },
    async replaceSession(id) { input.history = id; input.historyResult = { sessionId: id }; render(); await flush(); },
    unmount() { live = false; slots.forEach(slot => slot.cleanup?.()); },
  };
}

test('Back on an unsaved valid import asks before discarding or skipping it', async () => {
  const h = screen(); await h.back();
  assert.deepEqual(h.nativeCalls, [], 'Back alone must not discard the protected source');
  assert.deepEqual(h.changes, []); assert.deepEqual(h.routes, []);
  assert.ok(h.dialog(), 'The user must receive an explicit choice');
});

test('dismissing import Back confirmation keeps the session and review open', async () => {
  const h = screen(); await h.back(); await h.cancel();
  assert.deepEqual(h.nativeCalls, []); assert.deepEqual(h.changes, []); assert.deepEqual(h.routes, []);
  assert.equal(h.dialog(), undefined); assert.equal(h.input.history, SESSION_A);
});

test('twenty rapid Back taps open one choice and never discard without consent', async () => {
  const h = screen(); const back = h.header().onBack;
  await Promise.all(Array.from({ length: 20 }, () => back())); await h.flush();
  assert.deepEqual(h.nativeCalls, []); assert.deepEqual(h.routes, []); assert.ok(h.dialog());
});

test('confirmed import discard uses the existing controller once and marks skipped only after deletion', async () => {
  const discard = deferred(); const h = screen({ services: { discardSession: () => discard.promise } });
  await h.back(); const button = h.confirmButton();
  button.onPress(); button.onPress(); await h.flush();
  assert.deepEqual(h.nativeCalls, [SESSION_A]); assert.deepEqual(h.changes, []); assert.deepEqual(h.routes, []);
  discard.resolve(); await h.flush();
  assert.deepEqual(h.nativeCalls, [SESSION_A]);
  assert.deepEqual(JSON.parse(JSON.stringify(h.changes)), [{ type: 'history-status-changed', status: 'skipped' }]);
  assert.deepEqual(h.events, ['discard', 'clear-handoff', 'mark-history']);
  assert.deepEqual(h.routes, [['replace', '/ios-setup?fromOnboarding=1']]);
});

test('failed ledger save remains protected from Back and never offers destructive confirmation', async () => {
  const h = screen({ commitState: 'storage-failed' }); await h.back();
  assert.deepEqual(h.nativeCalls, []); assert.deepEqual(h.changes, []); assert.deepEqual(h.routes, []);
  assert.equal(h.dialog(), undefined); assert.ok(h.notices.some(value => value.title === 'historyStorageFailed'));
});

test('an in-flight finalization cannot be discarded through Back or confirmation', async () => {
  const save = deferred(); const h = screen({ applying: true, commitState: 'writing' });
  const running = h.controller.finalize({ save: () => save.promise, discard: async () => {} });
  await h.back(); if (h.dialog()) await h.confirm();
  assert.deepEqual(h.nativeCalls, []); assert.deepEqual(h.changes, []); assert.deepEqual(h.routes, []);
  save.resolve(); await running;
});

test('a reminder write holding the shared import lock cannot be cancelled by Back', async () => {
  const h = screen({ applying: true, locked: true }); await h.back();
  if (h.dialog()) await h.confirm();
  assert.deepEqual(h.nativeCalls, []); assert.deepEqual(h.changes, []); assert.deepEqual(h.routes, []);
});

test('a stale confirmation cannot discard or navigate over a replacement history session', async () => {
  const h = screen(); await h.back(); const oldConfirm = h.confirmButton();
  await h.replaceSession(SESSION_B);
  oldConfirm.onPress(); await h.flush();
  assert.deepEqual(h.nativeCalls, [], 'Consent to the old session does not authorize the replacement');
  assert.deepEqual(h.changes, []); assert.deepEqual(h.routes, []);
});

test('a session replacement during native discard cannot redirect the new review away', async () => {
  const discard = deferred(); const h = screen({ services: { discardSession: () => discard.promise } });
  await h.back(); h.confirmButton().onPress(); await h.flush();
  assert.deepEqual(h.nativeCalls, [SESSION_A]);
  await h.replaceSession(SESSION_B); discard.resolve(); await h.flush();
  assert.ok(!h.nativeCalls.includes(SESSION_B));
  assert.deepEqual(h.routes, [], 'Finishing the previous cancellation cannot navigate over the new review');
  assert.deepEqual(h.changes, [], 'The old cancellation cannot mark the replacement import skipped');
});

test('save failure arising while a discard confirmation is open preserves recovery', async () => {
  const h = screen(); await h.back();
  h.input.historyCommitState = 'storage-failed'; h.render(); await h.flush();
  if (h.dialog()) await h.confirm();
  assert.deepEqual(h.nativeCalls, []); assert.deepEqual(h.changes, []); assert.deepEqual(h.routes, []);
});

test('native discard failure remains visible without marking the import skipped', async () => {
  const h = screen({ services: { discardSession: async () => { throw new Error('synthetic native deletion failure'); } } });
  await h.back(); await h.confirm();
  assert.deepEqual(h.nativeCalls, [SESSION_A]); assert.deepEqual(h.changes, []); assert.deepEqual(h.routes, []);
  assert.equal(h.input.historyCommitState, 'cancel-cleanup-failed');
  assert.ok(h.notices.some(value => value.body === 'historyCancelCleanupFailed'));
});

test('ordinary paste Back keeps its existing navigation and respects the write lock', async () => {
  for (const history of [null, 'bad']) {
    const unlocked = screen({ history }); await unlocked.back();
    assert.deepEqual(unlocked.routes, [['back']]); assert.deepEqual(unlocked.nativeCalls, []);
    const locked = screen({ history, locked: true }); await locked.back();
    assert.deepEqual(locked.routes, []); assert.deepEqual(locked.nativeCalls, []);
  }
});
