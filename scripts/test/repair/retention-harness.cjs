'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
const cache = new Map();
function evaluate(text, filename, bindings = {}, dependencies = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(text, { fileName: filename, compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(output, { module, exports: module.exports, require: name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (!name.startsWith('@/')) return require(name);
    // Dependencies are lazy so unused parser/native imports never execute.
    return new Proxy({}, { get: (_, key) => source(name.slice(2))[key] });
  }, console, Date, Promise, Set, Map, setTimeout, clearTimeout, ...bindings }, { filename });
  return module.exports;
}
function source(name) {
  if (cache.has(name)) return cache.get(name);
  const base = path.join(root, 'src', name);
  const filename = ['.ts', '.tsx'].map(ext => base + ext).find(fs.existsSync);
  assert.ok(filename, `source module ${name}`);
  const value = evaluate(fs.readFileSync(filename, 'utf8'), filename);
  cache.set(name, value);
  return value;
}
const tray = source('lib/alert-review-tray');
const now = Date.now();
const missing = () => ({ value: null, alternatives: [], evidence: 'missing', spans: [], issues: [] });
const field = value => ({ ...missing(), value, evidence: 'explicit' });
function payment(i) {
  return tray.prepareUniversalReviewAlert({ ...tray.appleMessageReviewIdentity((i + 1).toString(16).padStart(64, '0')), observedAt: now - 1000 + i,
    channel: 'shortcut', event: { version: 1, decision: 'review', family: 'card-payment', status: 'posted',
      direction: 'credit', amount: field({ currency: 'AED', exponent: 2, minorUnits: String(50000 + i) }),
      statementTotal: missing(), minimumDue: missing(), balance: missing(), creditLimit: missing(),
      merchant: missing(), transactionDate: missing(), dueDate: missing(), statementDate: missing(),
      instrument: field({ kind: 'card', last4: '1234' }), observations: [], issues: [] } });
}
// Extract the shipped action and reducer rather than maintaining a staging double.
const storeText = fs.readFileSync(path.join(root, 'src/lib/store.tsx'), 'utf8');
const storeAst = ts.createSourceFile('store.tsx', storeText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let stageNode;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(storeAst) === 'stageReviewAlerts') stageNode = node.initializer.arguments[0];
  ts.forEachChild(node, visit);
}
visit(storeAst);
const reduceNode = storeAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'reduceState');
assert.ok(stageNode && reduceNode);
const reduceState = evaluate(reduceNode.getText(storeAst) + '\nexports.reduce = reduceState;', 'reducer.ts').reduce;
function storeHarness(occupied = []) {
  const authoritativeState = { current: { hydrated: true, transactions: [], trustedNotificationPackages: [],
    reviewTray: tray.admitPreparedReviewAlerts(tray.emptyAlertReviewTray(), occupied, now).state } };
  const stateGeneration = { current: 0 };
  let write = async () => true;
  const callbacks = { ...tray, authoritativeState, stateGeneration, saveTimer: { current: null },
    reviewQualificationMap: () => new Map(),
    reconcileReviewSourceBindings: source('lib/review-source-bindings').reconcileReviewSourceBindings,
    ensureDurable: async () => { if (!await write(authoritativeState.current)) throw new Error('write failed'); },
    persist: state => write(state), persistedQualificationIds: () => [],
    dispatch: action => (authoritativeState.current = reduceState(authoritativeState.current, action)),
  };
  const stage = evaluate(`exports.stage = ${stageNode.getText(storeAst)};`, 'stage.ts', callbacks).stage;
  return { stage, get state() { return authoritativeState.current; }, get generation() { return stateGeneration.current; },
    update(patch) { authoritativeState.current = { ...authoritativeState.current, ...patch }; },
    setWrite(fn) { write = fn; }, replace() { stateGeneration.current++; authoritativeState.current = { ...authoritativeState.current, reviewTray: tray.emptyAlertReviewTray() }; },
    dismiss(item) { authoritativeState.current = { ...authoritativeState.current,
      reviewTray: tray.resolveReviewAlert(authoritativeState.current.reviewTray, item.id, 'dismissed', now) }; } };
}

module.exports = { evaluate, source, root, tray, now, payment, storeHarness };
