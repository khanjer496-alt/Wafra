'use strict';
// Actual screen and teaching/core/runtime source. Native presentation,
// keychain IO and the durable action promise are explicit boundaries.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const load = require('./load-typescript.cjs');
const { createWorkflowHarness, walk, text } = require('../workflows/workflow-harness.cjs');
const createLoader = require('../../universal-test/load-ts.cjs').createLoader;
const root = path.resolve(__dirname, '../../..');
const NOW = Date.parse('2026-10-12T12:00:00Z');
const FIRST = 'Sample Bank: Your card ending 1234 was charged USD 10.50 to Jane Doe on 2026-09-08. Available balance USD 900.00.';
const SECOND = 'Sample Bank: Your card ending 6789 was charged USD 20.75 to Cedar Bookshop on 2026-10-09. Available balance USD 879.25.';
const byId = (tree, id) => walk(tree).find(node => node.props?.testID === id);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function storeCallback(name, next, bindings) {
  const source = fs.readFileSync(path.join(root, 'src/lib/store.tsx'), 'utf8');
  const start = source.indexOf(`  const ${name} = useCallback`);
  const end = source.indexOf(`  const ${next} = useCallback`, start);
  assert.ok(start >= 0 && end > start, `shipping ${name} callback is present`);
  const compiled = ts.transpileModule(source.slice(start, end), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  return Function(...Object.keys(bindings), compiled + `\nreturn ${name};`)(...Object.values(bindings));
}

function harness({ language = 'en', country = 'US', platform = 'ios', privateMode = false, holdPrepare = false, holdValidation = false } = {}) {
  const h = createWorkflowHarness({ language, platform, state: { language, country, privateMode,
    hydrated: true, privateAlertFormats: { version: 1, templates: [] } } });
  h.deps['@/lib/haptics'].committed = () => {};
  const real = createLoader();
  const core = real('@/lib/private-alert-formats');
  const coreCalls = { create: 0, validate: 0 };
  const create = core.createPrivateAlertFormat, validate = core.validatePrivateAlertFormat;
  core.createPrivateAlertFormat = (...args) => { coreCalls.create++; return create(...args); };
  core.validatePrivateAlertFormat = (...args) => { coreCalls.validate++; return validate(...args); };
  const teaching = real('@/lib/private-alert-teaching');
  h.deps['@/lib/private-alert-format-copy'] = real('@/lib/private-alert-format-copy');
  // Sharing a taught shape is opt-in and silent; the real pure modules run, the relay stays unpaired.
  h.deps['@/lib/learned-alert-formats'] = real('@/lib/learned-alert-formats');
  h.deps['@/lib/shared-alert-formats'] = real('@/lib/shared-alert-formats');
  h.deps['@/lib/shared-alert-format-sync'] = real('@/lib/shared-alert-format-sync');
  const runtimeModule = real('@/lib/private-alert-format-runtime');
  const nativeCalls = [];
  let secret = null;
  const prepareGate = deferred(), validationGate = deferred();
  let waitingValidation = false;
  const runtime = runtimeModule.createPrivateAlertFormatRuntime({
    isNative: () => platform !== 'web',
    async readSecret() { nativeCalls.push('read'); if (holdPrepare) await prepareGate.promise; if (waitingValidation) await validationGate.promise; return secret; },
    async writeSecret(value) { nativeCalls.push('write'); secret = value; },
    async removeSecret() { secret = null; },
    async randomBytes() { return Uint8Array.from({ length: 32 }, (_, i) => i + 1); },
  });
  runtime.activate(core.emptyPrivateAlertFormatStore());
  h.deps['@/lib/private-alert-teaching'] = teaching;
  h.deps['@/lib/country'] = real('@/lib/country');
  const pendingInputs = [], pendingSamples = [];
  h.deps['@/lib/private-alert-format-runtime'] = {
    preparePrivateAlertFormat: (...args) => runtime.prepare(...args),
    validatePrivateAlertFormatSample: (...args) => runtime.validate(...args),
    preparePrivateAlertFormatFromInput(readInput, cancelled) {
      pendingInputs.push(readInput());
      return runtime.prepareFromInput(readInput, cancelled);
    },
    validatePrivateAlertFormatFromSample(template, readSample, options, cancelled) {
      pendingSamples.push(readSample());
      if (holdValidation) { waitingValidation = true; runtime.activate(authoritativeState.current.privateAlertFormats); }
      return runtime.validateFromSample(template, readSample, options, cancelled);
    },
  };
  h.deps['expo-router'].Stack.Screen = props => h.jsx('ScreenOptions', props);
  const states = [], refs = [], callbacks = [], effects = [];
  let stateIndex = 0, refIndex = 0, callbackIndex = 0, effectIndex = 0, dirty = false, focused = true, mounted = true;
  const effectQueue = [];
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));
  h.deps.react.useState = initial => {
    const index = stateIndex++;
    if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
    return [states[index], value => { const next = typeof value === 'function' ? value(states[index]) : value; if (!Object.is(next, states[index])) { states[index] = next; dirty = true; } }];
  };
  h.deps.react.useRef = initial => refs[refIndex++] ??= { current: initial };
  h.deps.react.useCallback = (callback, deps) => {
    const index = callbackIndex++;
    if (!callbacks[index] || changed(callbacks[index].deps, deps)) callbacks[index] = { callback, deps };
    return callbacks[index].callback;
  };
  h.deps.react.useEffect = (callback, deps) => {
    const index = effectIndex++;
    if (!effects[index] || changed(effects[index].deps, deps)) {
      effectQueue.push(() => { effects[index]?.cleanup?.(); effects[index] = { deps, cleanup: callback() }; });
    }
  };
  h.deps['@react-navigation/native'].useIsFocused = () => focused;
  const lifecycle = new Set();
  h.deps['react-native'].AppState.addEventListener = (_event, callback) => {
    lifecycle.add(callback); return { remove: () => lifecycle.delete(callback) };
  };
  const store = h.deps['@/lib/store'].useStore();
  h.deps['@/lib/store'].usePrivateMode = () => store.state.privateMode;
  const saves = [], forgets = [], persisted = [];
  const authoritativeState = { current: h.state }, stateGeneration = { current: 1 };
  let actionKind = 'save', actionTemplate = null, actionId = null;
  const bindings = {
    useCallback: callback => callback, authoritativeState, stateGeneration, saveTimer: { current: null },
    clearTimeout,
    // The shipping reducer's private-format branch changes this one field;
    // broader reducer ingress/races are independently covered by storage tests.
    dispatch(action) {
      assert.equal(action.type, 'setPrivateAlertFormats');
      assert.equal(core.isValidPrivateAlertFormatStore(action.formats), true);
      runtime.invalidate();
      const next = { ...authoritativeState.current, privateAlertFormats: action.formats };
      authoritativeState.current = next; store.state = next; dirty = true; return next;
    },
    persist(next) {
      const gate = deferred(); const snapshot = JSON.stringify(next.privateAlertFormats);
      (actionKind === 'save' ? saves : forgets).push({ gate, template: actionTemplate, id: actionId });
      return gate.promise.then(() => { persisted.push(snapshot); return true; }, () => false);
    },
    canSavePrivateAlertFormat: runtime.canSave,
    isValidPrivateAlertFormatStore: core.isValidPrivateAlertFormatStore,
    emptyPrivateAlertFormatStore: core.emptyPrivateAlertFormatStore,
    removePrivateAlertFormat: core.removePrivateAlertFormat,
    activatePrivateAlertFormats: runtime.activate,
    invalidatePrivateAlertFormats: runtime.invalidate,
  };
  const add = storeCallback('addPrivateAlertFormat', 'removePrivateAlertFormatAction', bindings);
  const forget = storeCallback('removePrivateAlertFormatAction', 'clearPrivateAlertFormats', bindings);
  store.addPrivateAlertFormat = template => { actionKind = 'save'; actionTemplate = template; return add(template); };
  store.removePrivateAlertFormat = id => { actionKind = 'forget'; actionId = id; return forget(id); };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [NOW])); }
    static now() { return NOW; }
  }
  const screen = load(path.join(root, 'src/app/teach-bank-format.tsx'), h.deps, { Date: Clock }).default;
  const render = () => {
    assert.equal(mounted, true);
    let tree;
    for (let pass = 0; pass < 8; pass++) {
      stateIndex = refIndex = callbackIndex = effectIndex = 0; dirty = false;
      tree = screen();
      while (effectQueue.length) effectQueue.shift()();
      if (!dirty) return tree;
    }
    throw Error('Screen did not settle after effect updates');
  };
  const type = (id, value) => { const node = byId(render(), id); assert.ok(node, id); assert.notEqual(node.props.editable, false, `${id} editable`); node.props.onChangeText(value); return render(); };
  const press = id => { const node = byId(render(), id); assert.ok(node, id); assert.notEqual(node.props.disabled, true, `${id} enabled`); node.props.onPress(); return render(); };
  const settle = async () => { await tick(); await tick(); return render(); };
  const background = () => { for (const callback of lifecycle) callback('background'); return render(); };
  const blur = () => { focused = false; return render(); };
  const unmount = () => { mounted = false; for (const effect of effects) effect?.cleanup?.(); };
  const result = { ...h, core, coreCalls, runtime, store, states, nativeCalls, saves, forgets, persisted, pendingInputs, pendingSamples, prepareGate, validationGate,
    render, type, press, settle, background, blur, unmount };
  Object.defineProperty(result, 'state', { enumerable: true, get: () => authoritativeState.current });
  return result;
}

async function firstSample(h, body = FIRST, merchant = 'Jane Doe', date = '2026-09-08') {
  h.type('format-sender', 'SAMPLEBANK'); h.type('format-source', body);
  h.press('format-money-0'); h.press('format-debit');
  if (merchant) h.type('format-merchant', merchant);
  if (date) h.type('format-date', date);
  h.press('format-next'); return h.settle();
}
async function verify(h, body = SECOND) { h.type('format-source', body); h.press('format-check'); return h.settle(); }
const errorText = h => text(byId(h.render(), 'format-error'));
const transientGone = h => {
  const tree = h.render(); assert.equal(byId(tree, 'format-source')?.props.value, '');
  assert.equal(byId(tree, 'format-sender')?.props.value, '');
  assert.equal(byId(tree, 'format-preview'), undefined); assert.equal(byId(tree, 'format-check'), undefined);
};

for (const platform of ['ios', 'android']) test(`real ${platform} teaching flow clears samples and waits for durable confirmation before saved or forgotten`, async () => {
  const h = harness({ platform });
  h.type('format-source', FIRST);
  assert.equal(byId(h.render(), 'format-money-1').props.disabled, true, 'balance is not a principal choice');
  await firstSample(h);
  assert.equal(byId(h.render(), 'format-source').props.value, '');
  assert.ok(byId(h.render(), 'format-check'), 'first confirmation is a temporary draft');
  assert.equal(h.state.privateAlertFormats.templates.length, 0);
  await verify(h);
  const preview = byId(h.render(), 'format-preview');
  assert.ok(preview); assert.ok(text(preview).includes('USD 20.75')); assert.ok(text(preview).includes('Cedar Bookshop'));
  assert.ok(text(preview).includes('2026-10-09')); assert.equal(byId(h.render(), 'format-source'), undefined);
  assert.equal(h.state.privateAlertFormats.templates.length, 0);
  h.press('format-save'); await h.settle();
  assert.equal(h.saves.length, 1); assert.equal(h.state.privateAlertFormats.templates.length, 1, 'the source action stages metadata before durability');
  assert.equal(await h.runtime.read(SECOND, 'SAMPLEBANK', NOW, { country: 'US' }), null, 'uncommitted format cannot advise capture');
  assert.equal(byId(h.render(), 'format-saved'), undefined);
  assert.equal(byId(h.render(), 'format-save').props.disabled, true);
  assert.equal(walk(h.render()).find(node => node.type === 'BandScaffold').props.nav.backDisabled, true);
  assert.equal(walk(h.render()).find(node => node.type === 'ScreenOptions').props.options.gestureEnabled, false);
  h.saves[0].gate.resolve(); await h.settle();
  assert.ok(byId(h.render(), 'format-saved')); assert.equal(h.state.privateAlertFormats.templates.length, 1);
  assert.equal(h.state.privateAlertFormats.templates[0].status, 'validated');
  for (const body of [FIRST, SECOND, 'Jane Doe', 'Cedar Bookshop', 'SAMPLEBANK']) assert.equal(h.persisted.join('\n').includes(body), false);
  h.press('format-forget-0'); await h.settle();
  assert.equal(h.forgets.length, 1); assert.equal(h.state.privateAlertFormats.templates.length, 0, 'source action stages removal immediately');
  assert.equal(await h.runtime.read(SECOND, 'SAMPLEBANK', NOW, { country: 'US' }), null);
  h.forgets[0].gate.resolve(); await h.settle();
  assert.equal(h.state.privateAlertFormats.templates.length, 0); assert.equal(byId(h.render(), 'format-forget-0'), undefined);
});

test('a repeated first alert stays a draft and explains that another received sample is required', async () => {
  const h = harness(); await firstSample(h); await verify(h, FIRST);
  assert.equal(byId(h.render(), 'format-preview'), undefined); assert.ok(byId(h.render(), 'format-check'));
  assert.match(errorText(h), /different received alert|another received alert/i);
  assert.equal(h.saves.length, 0);
});

test('a failed durable save keeps the second preview available for an explicit retry', async () => {
  const h = harness(); await firstSample(h); await verify(h);
  h.press('format-save'); await h.settle(); h.saves[0].gate.reject(Error('fictional local storage failure')); await h.settle();
  assert.equal(h.state.privateAlertFormats.templates.length, 0); assert.equal(byId(h.render(), 'format-saved'), undefined);
  assert.ok(byId(h.render(), 'format-preview')); assert.match(errorText(h), /not saved.*try again/i);
  assert.equal(byId(h.render(), 'format-save').props.disabled, false);
  h.press('format-save'); await h.settle(); assert.equal(h.saves.length, 2);
  h.saves[1].gate.resolve(); await h.settle(); assert.ok(byId(h.render(), 'format-saved'));
});

test('forget failure leaves the durable format listed and allows an explicit retry', async () => {
  const h = harness(); await firstSample(h); await verify(h); h.press('format-save'); await h.settle();
  h.saves[0].gate.resolve(); await h.settle(); const savedId = h.state.privateAlertFormats.templates[0].id;
  h.press('format-forget-0'); await h.settle(); h.forgets[0].gate.reject(Error('fictional erase persistence failure')); await h.settle();
  assert.equal(h.state.privateAlertFormats.templates.length, 1, 'failed removal must restore the durable rule instead of claiming it is gone');
  assert.equal(h.state.privateAlertFormats.templates[0].id, savedId);
  assert.ok(byId(h.render(), 'format-forget-0')); assert.match(errorText(h), /could not be forgotten.*try again/i);
  assert.equal(byId(h.render(), 'format-forget-0').props.disabled, false);
  h.press('format-forget-0'); await h.settle(); h.forgets[1].gate.resolve(); await h.settle();
  assert.equal(h.state.privateAlertFormats.templates.length, 0);
});

test('retrying a failed source add reaches a fresh durable write rather than staying permanently unready', async () => {
  const h = harness(); await firstSample(h); await verify(h); h.press('format-save'); await h.settle();
  h.saves[0].gate.reject(Error('fictional first-write failure')); await h.settle();
  assert.ok(byId(h.render(), 'format-preview')); h.press('format-save'); await h.settle();
  assert.equal(h.saves.length, 2, 'real runtime must authenticate the preserved preview after the source action invalidated capture readiness');
  h.saves[1].gate.resolve(); await h.settle(); assert.ok(byId(h.render(), 'format-saved'));
});

test('local format save can be retried in Private Mode after a durable write fails', async () => {
  const h = harness({ privateMode: true }); await firstSample(h); await verify(h); h.press('format-save'); await h.settle();
  h.saves[0].gate.reject(Error('fictional first-write failure')); await h.settle();
  assert.ok(byId(h.render(), 'format-preview')); h.press('format-save'); await h.settle();
  assert.equal(h.saves.length, 2, 'Private Mode is compatible with on-device learning and must not permanently disable retry');
  h.saves[1].gate.resolve(); await h.settle(); assert.ok(byId(h.render(), 'format-saved'));
});

test('the teaching helper exposes a completed standalone fee as a selectable principal', () => {
  const body = 'Sample Bank: Service fee USD 2.50 was debited from account 1234 on 2026-09-08.';
  const choices = createLoader()('@/lib/private-alert-teaching').privateTeachingChoices(body, 'US');
  assert.equal(choices.money.length, 1); assert.equal(choices.money[0].role, 'fee');
  assert.equal(choices.money[0].selectable, true, 'a completed fee principal is supported by the private core');
});

test('an explicit direction conflicting with the received source cannot create a draft', async () => {
  const h = harness(); h.type('format-source', FIRST); h.press('format-money-0'); h.press('format-credit'); h.press('format-next'); await h.settle();
  assert.ok(byId(h.render(), 'format-error')); assert.equal(byId(h.render(), 'format-check'), undefined);
  assert.equal(h.state.privateAlertFormats.templates.length, 0);
  h.press('format-debit'); h.press('format-next'); await h.settle(); assert.ok(byId(h.render(), 'format-check'));
});

test('no amount or direction is guessed when the person has not selected it', async () => {
  const h = harness(); h.type('format-source', FIRST); h.press('format-next'); await h.settle();
  assert.match(errorText(h), /choose the transaction amount/i); assert.deepEqual(h.nativeCalls, []);
  h.press('format-money-0'); h.press('format-next'); await h.settle();
  assert.match(errorText(h), /whether money left or entered/i); assert.deepEqual(h.nativeCalls, []);
});

test('long input is shown intact and cannot be prepared', () => {
  const h = harness(); const body = FIRST + 'x'.repeat(1001 - FIRST.length); h.type('format-source', body);
  assert.equal(byId(h.render(), 'format-source').props.value, body);
  assert.equal(byId(h.render(), 'format-next').props.disabled, true); assert.match(text(h.render()), /not been shortened/i);
});

test('background and focus loss clear pasted samples and unfinished draft capsules', async () => {
  const h = harness(); h.type('format-sender', 'SAMPLEBANK'); h.type('format-source', FIRST); h.background(); transientGone(h);
  await firstSample(h); h.background(); transientGone(h);
  await firstSample(h); h.blur(); transientGone(h);
  assert.equal(h.saves.length, 0);
});

test('back before a secure-key operation completes clears the sample and retires its late result', async () => {
  const h = harness({ holdPrepare: true });
  h.type('format-sender', 'SAMPLEBANK'); h.type('format-source', FIRST); h.press('format-money-0'); h.press('format-debit'); h.press('format-next'); await h.settle();
  walk(h.render()).find(node => node.type === 'BandScaffold').props.nav.back(); transientGone(h);
  assert.equal(h.pendingInputs[0].source, ''); assert.equal(h.pendingInputs[0].sender, null);
  assert.equal(h.pendingInputs[0].confirmed.merchant, null); assert.equal(h.pendingInputs[0].confirmed.date, null);
  assert.ok(h.events.some(event => event[0] === 'back'));
  h.prepareGate.resolve(); await h.settle(); transientGone(h); assert.equal(h.saves.length, 0); assert.equal(h.coreCalls.create, 0);
});

test('a validation finishing after background cannot restore a private preview', async () => {
  const h = harness({ holdValidation: true }); await firstSample(h); h.type('format-source', SECOND); h.press('format-check'); await h.settle();
  h.background(); transientGone(h);
  assert.equal(h.pendingSamples[0].source, ''); assert.equal(h.pendingSamples[0].sender, null);
  h.validationGate.resolve(); await h.settle(); transientGone(h);
  assert.equal(h.saves.length, 0); assert.equal(h.coreCalls.validate, 0);
});

test('unmount retires preparation and releases the AppState subscription', async () => {
  const h = harness({ holdPrepare: true });
  h.type('format-source', FIRST); h.press('format-money-0'); h.press('format-debit'); h.press('format-next'); await h.settle();
  h.unmount(); const before = h.states.slice();
  assert.equal(h.pendingInputs[0].source, ''); assert.equal(h.pendingInputs[0].sender, null);
  h.prepareGate.resolve(); await tick(); await tick();
  assert.deepEqual(h.states, before, 'late preparation performs no writes into retired React state');
  assert.equal(h.state.privateAlertFormats.templates.length, 0); assert.equal(h.saves.length, 0); assert.equal(h.coreCalls.create, 0);
});

test('enabling private mode while teaching clears source and unsaved preview', async () => {
  const h = harness(); await firstSample(h); await verify(h);
  h.state.privateMode = true; transientGone(h); assert.equal(h.state.privateAlertFormats.templates.length, 0);
});

test('the Arabic screen uses Arabic choices and source selection learns Arabic digits through the real core', async () => {
  const h = harness({ language: 'ar', country: 'JO' });
  const first = 'بنك المثال: تم خصم JOD ١٠٫٥٠٠ من بطاقة ١٢٣٤ لدى متجر النور بتاريخ ٢٠٢٦-٠٩-٠٨. الرصيد المتاح JOD ٩٠٠٫٠٠٠.';
  const second = 'بنك المثال: تم خصم JOD ٢٣٫٧٥٠ من بطاقة ٦٧٨٩ لدى مكتبة الياسمين بتاريخ ٢٠٢٦-١٠-٠٩. الرصيد المتاح JOD ٨٧٦٫٢٥٠.';
  h.type('format-source', first);
  assert.equal(byId(h.render(), 'format-debit').props.accessibilityLabel, 'خرج المال من حسابي');
  for (const node of walk(h.render()).filter(node => node.props?.accessibilityRole === 'radio')) assert.doesNotMatch(node.props.accessibilityLabel, /\btransaction\b|\bbalance\b|\bunknown\b/);
  await firstSample(h, first, 'متجر النور', '2026-09-08'); await verify(h, second);
  const preview = byId(h.render(), 'format-preview'); assert.ok(preview);
  assert.ok(text(preview).includes('JOD 23.750')); assert.ok(text(preview).includes('مكتبة الياسمين'));
  assert.equal(byId(h.render(), 'format-save').props.accessibilityLabel, 'القيم صحيحة — احفظ النموذج');
});

test('a web preview and an unhydrated phone cannot create or save private formats', () => {
  const web = harness({ platform: 'web' }); web.type('format-source', FIRST);
  assert.equal(byId(web.render(), 'format-next').props.disabled, true); assert.deepEqual(web.nativeCalls, []);
  const native = harness(); native.state.hydrated = false; native.type('format-source', FIRST);
  assert.equal(byId(native.render(), 'format-next').props.disabled, true); assert.deepEqual(native.nativeCalls, []);
});
