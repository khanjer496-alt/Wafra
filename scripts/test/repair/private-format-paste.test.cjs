'use strict';
// Shipping screen, parser, Review admission and secure runtime. Rendering,
// native key IO and durable storage are explicit boundaries, not phone proof.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadSource = require('./load-typescript.cjs');
const { createWorkflowHarness, walk } = require('../workflows/workflow-harness.cjs');
const { createLoader } = require('../../universal-test/load-ts.cjs');
const root = path.resolve(__dirname, '../../..');
const NOW = Date.parse('2026-10-12T12:00:00Z');
const SOURCE = 'Bank alert: account ending 1357. GBP 46.80 at CEDAR BAKERY. Date: 2026-10-10.';
const NEXT = SOURCE.replace('46.80', '73.25').replace('CEDAR BAKERY', 'MAPLE SHOP');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

async function fixture(options = {}) {
  const load = createLoader();
  const country = load('@/lib/country'); country.setActiveCountry(options.country ?? 'GB');
  const markets = load('@/lib/markets'); markets.setActiveMarket(options.market ?? 'ZZ'); markets.setLedgerCurrency(options.currency ?? 'GBP', 2);
  const core = load('@/lib/private-alert-formats');
  const module = load('@/lib/private-alert-format-runtime');
  let secret = null, hold = false, nativeReads = 0, nativeWrites = 0, sourceReads = 0, matches = 0;
  const keyGate = deferred();
  const actualMatch = core.matchPrivateAlertFormat;
  core.matchPrivateAlertFormat = (...args) => { matches++; return actualMatch(...args); };
  const runtime = module.createPrivateAlertFormatRuntime({
    isNative: () => options.platform !== 'web',
    async readSecret() { nativeReads++; if (hold) await keyGate.promise; return secret; },
    async writeSecret(value) { nativeWrites++; secret = value; },
    async removeSecret() { secret = null; },
    async randomBytes() { return new Uint8Array(32).fill(29); },
  });
  runtime.activate(core.emptyPrivateAlertFormatStore());
  const first = SOURCE.replace('2026-10-10', '2026-10-08');
  const created = await runtime.prepare({ source: first, sender: options.sender ?? '',
    confirmed: { amountMinor: 4680, currency: 'GBP', exponent: 2, direction: 'debit', merchant: 'CEDAR BAKERY', date: '2026-10-08' },
    context: { country: 'GB', dateOrder: 'DMY' }, now: NOW });
  assert.equal(created.ok, true, created.reason);
  const validated = await runtime.validate(created.template,
    SOURCE.replace('46.80', '57.90').replace('CEDAR BAKERY', 'ASTER SHOP').replace('2026-10-10', '2026-10-09'),
    options.sender ?? '', { now: NOW, country: 'GB', dateOrder: 'DMY' });
  assert.equal(validated.ok, true, validated.reason);
  const formats = { version: 1, templates: options.draft ? [created.template] : options.empty ? [] : [validated.template] };
  runtime.activate(formats);
  if (options.missingKey) secret = null;
  hold = options.holdKey ?? false;
  const sessions = [];
  module.createPrivateAlertFormatSession = options => {
    const session = runtime.session(options);
    const read = session.readFromSource;
    session.readFromSource = (getter, context) => read(() => { sourceReads++; return getter(); }, context);
    sessions.push(session); return session;
  };
  return { load, runtime, module, formats, keyGate, sessions,
    holdKey(value) { hold = value; }, counts: () => ({ nativeReads, nativeWrites, sourceReads, matches }) };
}

async function harness(options = {}) {
  const f = await fixture(options);
  const h = createWorkflowHarness({ platform: options.platform ?? 'android', params: { manual: '1' }, empty: true,
    state: { language: 'en', country: options.country ?? 'GB', marketId: options.market ?? 'ZZ', privateMode: true,
      ledgerMoney: { schemaVersion: 2, currency: options.currency ?? 'GBP', exponent: 2 }, merchantOverrides: {}, billAliases: {},
      lastScanTs: 0, privateAlertFormats: f.formats, statementCoverage: [], accountHints: {}, localCaptureQualifications: [] } });
  const d = h.deps;
  // UI children render their props; their presentation has separate suites.
  const screenFile = path.join(root, 'src/app/import-sms.tsx');
  const screenSource = fs.readFileSync(screenFile, 'utf8');
  for (const found of screenSource.matchAll(/import\s+\{([^}]+)\}\s+from\s+['"](@\/components\/[^'"]+)['"]/g)) {
    const exports = {};
    for (const declaration of found[1].split(',')) {
      const name = declaration.trim(); if (!name || name.startsWith('type ')) continue;
      exports[name] = props => h.jsx(name, props);
    }
    d[found[2]] = exports;
  }
  d['@/components/ui/band-scaffold'].BandScaffold = props => h.jsx('BandScaffold', { ...props, children: [props.bandContent, props.children] });
  d['@/components/ui/band/stat-tile'].statTileColors = band => ({ fg: band.onBand });
  d['@/components/ios-message-setup/history-details-sheet'].HistoryDetailsSheet = function HistoryDetailsSheet() { return null; };
  d['@/components/ui/confirm-sheet'].ConfirmSheet = function ConfirmSheet() { return null; };
  d['@/lib/private-alert-format-runtime'] = f.module;
  for (const name of ['private-alert-format-copy', 'private-alert-format-review', 'universal-parser', 'launch-alert-parser', 'country', 'alert-review-tray',
    'sms-parser', 'import-plan', 'ios-history-setup', 'ios-paged-setup', 'review-source-bindings', 'ledger-money', 'paste-sample']) {
    d['@/lib/' + name] = f.load('@/lib/' + name);
  }
  d['@/lib/auto-import'] = { ...d['@/lib/auto-import'], buildImportPlan: f.load('@/lib/import-plan').buildImportPlan,
    isSmsScanningAvailable: () => false };
  d['@/lib/markets'] = f.load('@/lib/markets');
  d['@/lib/ios-history-import'] = {};
  d['@/lib/wallet-near-match'] = f.load('@/lib/wallet-near-match');
  d['@/lib/motion-android-copy'] = f.load('@/lib/motion-android-copy');
  d['expo-crypto'] = { randomUUID: () => `${String(++nonce).padStart(8, '0')}-1234-4567-8910-123456789012` };
  d['expo-router'].useLocalSearchParams = () => ({ manual: '1' });
  d['expo-router'].Stack.Screen = function StackScreen() { return null; };
  let nonce = 0, generation = 1, focused = true, mounted = true, dirty = false;
  const states = [], refs = [], callbacks = [], effects = [], effectQueue = [];
  let stateIndex = 0, refIndex = 0, callbackIndex = 0, effectIndex = 0;
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));
  d.react.useState = initial => {
    const index = stateIndex++;
    if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
    return [states[index], value => { const next = typeof value === 'function' ? value(states[index]) : value;
      if (!Object.is(next, states[index])) { states[index] = next; dirty = true; } }];
  };
  d.react.useRef = initial => refs[refIndex++] ??= { current: initial };
  d.react.useCallback = (callback, deps) => {
    const index = callbackIndex++;
    if (!callbacks[index] || changed(callbacks[index].deps, deps)) callbacks[index] = { callback, deps };
    return callbacks[index].callback;
  };
  d.react.useEffect = (callback, deps) => {
    const index = effectIndex++;
    if (!effects[index] || changed(effects[index].deps, deps)) effectQueue.push(() => {
      effects[index]?.cleanup?.(); effects[index] = { deps, cleanup: callback() };
    });
  };
  d['@react-navigation/native'].useIsFocused = () => focused;
  const lifecycle = new Set();
  d['react-native'].AppState.currentState = 'active';
  d['react-native'].AppState.addEventListener = (_event, callback) => { lifecycle.add(callback); return { remove: () => lifecycle.delete(callback) }; };
  const store = d['@/lib/store'].useStore();
  store.getStateSnapshot = () => store.state;
  store.getStateGeneration = () => generation;
  const stages = [], imports = [], durability = [];
  store.importBatch = batch => { imports.push(batch); return { durable: Promise.resolve() }; };
  store.stageReviewAlerts = items => {
    stages.push(items);
    store.state.reviewTray.pending = [...new Map([...store.state.reviewTray.pending, ...items].map(item => [item.id, item])).values()];
    const gate = deferred(); durability.push(gate);
    if (!options.holdDurable) gate.resolve();
    return { durable: gate.promise };
  };
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [NOW])); } static now() { return NOW; } }
  const screen = loadSource(screenFile, d, { Date: Clock }).default;
  const render = () => {
    assert.equal(mounted, true);
    let tree;
    for (let pass = 0; pass < 10; pass++) {
      stateIndex = refIndex = callbackIndex = effectIndex = 0; dirty = false;
      tree = screen();
      while (effectQueue.length) effectQueue.shift()();
      if (!dirty) return tree;
    }
    throw Error('Paste screen did not settle');
  };
  const input = () => walk(render()).find(node => node.type === 'TextInput');
  const type = value => { const node = input(); assert.ok(node, 'shipping paste field'); node.props.onChangeText(value); return render(); };
  const parse = () => {
    const node = walk(render()).find(node => node.type === 'Button' && node.props.label === d['@/lib/i18n'].t('parsePastedText'));
    assert.ok(node, 'shipping paste button'); assert.notEqual(node.props.disabled, true); return node.props.onPress();
  };
  const settle = async () => { await tick(); await tick(); return render(); };
  const background = () => { for (const callback of lifecycle) callback('background'); return render(); };
  const foreground = () => { for (const callback of lifecycle) callback('active'); return render(); };
  const blur = () => { focused = false; return render(); };
  const reset = () => { generation++; store.state = { ...store.state, privateAlertFormats: { version: 1, templates: [] } }; f.runtime.activate(store.state.privateAlertFormats); return render(); };
  const unmount = () => {
    mounted = false; for (const effect of effects) effect?.cleanup?.();
    // React destroys the unmounted form's state. Retained external refs and
    // pending async closures remain below, so their cleanup is still exercised.
    states.length = 0;
  };
  render();
  return { ...h, ...f, store, states, refs, stages, imports, durability, lifecycle, render, input, type, parse, settle, background, foreground, blur, reset, unmount };
}

const noTransientSource = h => {
  assert.equal(h.states.includes(NEXT), false, 'form state releases full source');
  assert.ok(h.refs.every(ref => !ref.current || typeof ref.current !== 'object' ||
    (ref.current.input !== NEXT && (!ref.current.ids || ref.current.ids.size === 0))), 'source identity map is cleared');
  assert.equal(h.refs.some(ref => ref.current?.blocks?.includes(NEXT)), false, 'pending deferred source is cleared');
};

for (const platform of ['ios', 'android']) test(`${platform} paste reuses a validated senderless format as source-owned Review without posting`, async () => {
  const h = await harness({ platform }); h.type(NEXT); await h.parse();
  assert.equal(h.imports.length, 0); assert.equal(h.stages.length, 1);
  const item = h.stages[0][0];
  assert.equal(item.channel, 'paste'); assert.equal(item.observedAt, NOW);
  assert.equal(item.event.decision, 'review'); assert.equal(item.event.direction, 'debit'); assert.equal(item.event.status, 'unknown');
  assert.equal(item.event.amount.value.minorUnits, '7325'); assert.equal(item.event.amount.value.currency, 'GBP');
  assert.equal(item.event.merchant.value, 'MAPLE SHOP'); assert.equal(item.event.transactionDate.value, '2026-10-10');
  assert.ok(item.event.issues.includes('learned-format')); assert.ok(!JSON.stringify(item).includes(NEXT));
  const identity = { id: item.id, sourceKey: item.sourceKey, observedAt: item.observedAt };
  await h.parse();
  assert.deepEqual({ id: h.stages[1][0].id, sourceKey: h.stages[1][0].sourceKey, observedAt: h.stages[1][0].observedAt }, identity);
  assert.equal(h.store.state.reviewTray.pending.length, 1, 're-reading the same open paste keeps one Review identity');
});

for (const [name, options] of [['sender-bound format', { sender: 'SAMPLEBANK' }], ['unvalidated draft', { draft: true }],
  ['missing device key', { missingKey: true }], ['no saved formats', { empty: true }]]) {
  test(`${name} preserves generic paste Review and never creates a key while reading`, async () => {
    const h = await harness(options); const writes = h.counts().nativeWrites; h.type(NEXT); await h.parse();
    assert.equal(h.stages.length, 1); const event = h.stages[0][0].event;
    assert.equal(event.direction, 'unknown'); assert.ok(!event.issues.includes('learned-format'));
    assert.equal(h.counts().nativeWrites, writes); assert.equal(h.imports.length, 0);
  });
}

for (const [name, stop] of [['background', h => h.background()], ['blur', h => h.blur()],
  ['ledger reset', h => h.reset()], ['unmount', h => h.unmount()]]) {
  test(`${name} releases paste source and prevents key IO from reading or staging its late result`, async () => {
    const h = await harness({ holdKey: true }); h.type(NEXT); const baseline = h.counts();
    const pending = h.parse(); await tick(); assert.ok(h.counts().nativeReads > baseline.nativeReads, 'held actual device-key read');
    stop(h); noTransientSource(h);
    h.keyGate.resolve(); await pending;
    assert.equal(h.counts().sourceReads, baseline.sourceReads); assert.equal(h.counts().matches, baseline.matches);
    assert.equal(h.stages.length, 0); assert.equal(h.imports.length, 0); noTransientSource(h);
    if (name === 'unmount') assert.equal(h.lifecycle.size, 0);
  });
}

test('a retired paste finishing cannot clear or replace a new foreground paste', async () => {
  const h = await harness({ holdKey: true }); h.type(NEXT); const old = h.parse(); await tick();
  h.background(); h.foreground();
  const fresh = NEXT.replace('73.25', '82.40').replace('MAPLE SHOP', 'FIR MARKET'); h.type(fresh); const current = h.parse();
  h.keyGate.resolve(); await old; await current; await h.settle();
  assert.equal(h.stages.length, 1); assert.equal(h.stages[0][0].event.amount.value.minorUnits, '8240');
  assert.equal(h.input().props.value, fresh); assert.equal(h.imports.length, 0);
});

test('background during Review durability preserves admitted structured Review but never restores a paste preview', async () => {
  const h = await harness({ holdDurable: true }); h.type(NEXT); const pending = h.parse(); await tick();
  assert.equal(h.stages.length, 1); h.background(); noTransientSource(h);
  h.durability[0].resolve(); await pending; await h.settle();
  assert.equal(h.input().props.value, ''); assert.equal(h.store.state.reviewTray.pending.length, 1); assert.equal(h.imports.length, 0);
});

test('failed Review durability retains the open-form identity for retry and reports the failure', async () => {
  const h = await harness({ holdDurable: true }); h.type(NEXT); const first = h.parse(); await tick();
  const prior = h.stages[0][0]; h.durability[0].reject(Error('storage unavailable')); await first; await h.settle();
  assert.equal(h.input().props.value, NEXT);
  const retry = h.parse(); await tick(); h.durability[1].resolve(); await retry;
  assert.equal(h.stages[1][0].id, prior.id); assert.equal(h.stages[1][0].observedAt, prior.observedAt); assert.equal(h.imports.length, 0);
});

for (const suffix of [' Your OTP is 123456.', ' Payment failed.', ' Payment scheduled tomorrow.', ' Payment pending.',
  ' Statement total GBP 73.25.', ' Credit limit GBP 73.25.', ' Minimum due GBP 73.25.']) {
  test(`whole-source refusal is never reopened by a saved paste format: ${suffix}`, async () => {
    const h = await harness(); h.type(NEXT + suffix); await h.parse();
    assert.ok(h.stages.flat().every(item => !item.event.issues.includes('learned-format'))); assert.equal(h.imports.length, 0);
  });
}

test('the deferred runtime getter reads once after IO and issues the same source-bound capability as the existing API', async () => {
  const f = await fixture({ holdKey: true }); let source = NEXT, calls = 0;
  const session = f.runtime.session({ country: 'GB', dateOrder: 'DMY' });
  const pending = session.readFromSource(() => { calls++; return source ? { source, sender: '', observedAt: NOW } : null; });
  await tick(); assert.equal(calls, 0);
  f.keyGate.resolve(); const result = await pending;
  assert.ok(result); assert.equal(calls, 1);
  assert.equal(f.module.isTrustedPrivateAlertFormatMatch(result, NEXT, '', NOW), true);
  assert.equal(f.module.isTrustedPrivateAlertFormatMatch(result, SOURCE, '', NOW), false);
  f.runtime.activate(f.formats); assert.equal(session.isCurrent(), false);
  assert.equal(f.module.isTrustedPrivateAlertFormatMatch(result, NEXT, '', NOW), false);
  source = ''; assert.equal(await session.readFromSource(() => { throw Error('retired getter must not run'); }), null);
});

test('an already cancelled deferred read performs no native IO and never asks for the source', async () => {
  const f = await fixture(); const prior = f.counts();
  const session = f.runtime.session({ cancelled: () => true });
  assert.equal(await session.readFromSource(() => { throw Error('cancelled getter must not run'); }), null);
  assert.deepEqual(f.counts(), prior);
});

test('already parsed paste rows retain their ordinary preview and do not read private format keys', async () => {
  const h = await harness({ market: 'AE', currency: 'AED' });
  const source = 'ADCB: Your card ending 1234 was used for AED 31.25 at CEDAR BAKERY on 10/10/2026.';
  const baseline = h.load('@/lib/launch-alert-parser').parsePastedBankAlerts(source, {});
  assert.equal(baseline.length, 1, 'ordinary mature paste route qualifies');
  const counts = h.counts(); h.type(source); await h.parse();
  const plan = h.states.find(value => value?.batch?.transactions?.length);
  assert.ok(plan); assert.equal(plan.txCount, 1); assert.equal(plan.batch.transactions[0].amountFils, 3125);
  assert.equal(h.stages.length, 0); assert.equal(h.imports.length, 0); assert.deepEqual(h.counts(), counts);
});

test('mature Gulf paste Review remains generic and never opens the private format key', async () => {
  const h = await harness({ country: 'AE', market: 'AE', currency: 'AED' });
  const counts = h.counts(); h.type(NEXT); await h.parse();
  assert.equal(h.stages.length, 1); assert.ok(!h.stages[0][0].event.issues.includes('learned-format'));
  assert.deepEqual(h.counts(), counts); assert.equal(h.imports.length, 0);
});

test('mixed paste cancellation clears the pending parsed row and preview copies without changing stored ledger rows', async () => {
  const h = await harness({ holdKey: true, market: 'AE', currency: 'AED' });
  const parsedSource = 'ADCB: Your card ending 1234 was used for AED 31.25 at CEDAR BAKERY on 10/10/2026.';
  h.store.state.transactions.push({ id: 'old', date: '2026-10-01', type: 'expense', amountFils: 900,
    title: 'Already saved', category: 'other', accountId: '', source: 'manual', raw: 'Stored source remains owned by the ledger' });
  h.type(parsedSource + '\n\n' + NEXT); const pending = h.parse(); await tick();
  const buffer = h.refs.find(ref => ref.current?.blocks?.length)?.current;
  assert.ok(buffer); assert.equal(buffer.parsed.length, 1); const plan = buffer.plan;
  h.background(); assert.equal(buffer.parsed.length, 0); assert.equal(buffer.blocks.length, 0); assert.equal(buffer.plan, null);
  assert.ok(plan.batch.transactions.every(row => row.raw === undefined));
  assert.equal(h.store.state.transactions[0].raw, 'Stored source remains owned by the ledger');
  h.keyGate.resolve(); await pending; assert.equal(h.stages.length, 0); assert.equal(h.imports.length, 0);
});
