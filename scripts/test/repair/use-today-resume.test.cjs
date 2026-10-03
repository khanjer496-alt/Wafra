'use strict';
// useToday must keep ONE Date object while the local day is unchanged, so
// Wallet/Bills/Cards ledger memos keyed on it do not recompute on every app
// switch; useResumeClock keeps the minute-level refresh for "ago" text.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadHook() {
  const file = path.resolve(__dirname, '../../../src/hooks/use-today.ts');
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const listeners = [];
  const cell = { value: undefined };
  const react = {
    useState(initial) {
      if (cell.value === undefined) cell.value = typeof initial === 'function' ? initial() : initial;
      return [cell.value, (next) => { cell.value = typeof next === 'function' ? next(cell.value) : next; }];
    },
    useEffect(effect) { effect(); },
  };
  const rn = { AppState: { addEventListener: (_name, fn) => { listeners.push(fn); return { remove() {} }; } } };
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)(
    (id) => (id === 'react' ? react : id === 'react-native' ? rn : assert.fail(id)), module, module.exports);
  return { hooks: module.exports, listeners, cell };
}

function withClock(start, run) {
  const RealDate = Date;
  let now = start.getTime();
  global.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  try { return run((ms) => { now = ms; }); } finally { global.Date = RealDate; }
}

test('useToday returns the same object across same-day resumes and a new one after midnight', () => {
  withClock(new Date(2026, 8, 24, 9, 0), (set) => {
    const { hooks, listeners, cell } = loadHook();
    const first = hooks.useToday();
    set(new Date(2026, 8, 24, 23, 59).getTime());
    listeners.forEach((fn) => fn('active'));
    assert.equal(cell.value, first, 'same local day keeps identity');
    listeners.forEach((fn) => fn('background'));
    set(new Date(2026, 8, 25, 0, 1).getTime());
    listeners.forEach((fn) => fn('active'));
    assert.notEqual(cell.value, first);
    assert.equal(cell.value.getDate(), 25);
  });
});

test('useResumeClock still refreshes on every resume', () => {
  withClock(new Date(2026, 8, 24, 9, 0), (set) => {
    const { hooks, listeners, cell } = loadHook();
    const first = hooks.useResumeClock();
    set(new Date(2026, 8, 24, 9, 5).getTime());
    listeners.forEach((fn) => fn('active'));
    assert.notEqual(cell.value, first);
    assert.equal(cell.value.getMinutes(), 5);
  });
});
