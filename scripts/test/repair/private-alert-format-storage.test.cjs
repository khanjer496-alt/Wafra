'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const ts = require('typescript');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const source = path.join(root, 'src/lib/private-alert-format-runtime.ts');
const empty = () => ({ version: 1, templates: [] });
const template = { id: 'format-1', status: 'validated', seal: 'authenticated' };
function fixture(options = {}) {
  const counts = { read: 0, write: 0, random: 0, remove: 0 };
  let secret = options.secret ?? null;
  const engine = {
    emptyPrivateAlertFormatStore: empty,
    normalizePrivateAlertFormatStore: value => value?.version === 1 && Array.isArray(value.templates) ? JSON.parse(JSON.stringify(value)) : empty(),
    authenticatePrivateAlertFormat: value => value?.seal === 'authenticated',
    isValidPrivateAlertFormatStore: value => value?.version === 1 && Array.isArray(value.templates),
    createPrivateAlertFormat: () => ({ ok: true, template: { ...template, status: 'draft' } }),
    validatePrivateAlertFormat: value => ({ ok: true, template: { ...value, status: 'validated' }, fields: { amountMinor: 1200 } }),
    matchPrivateAlertFormat: (_source, _sender, store, key) => store.templates.length && key[0] === 23
      ? { kind: 'prefill', fields: { amountMinor: 1200, currency: 'GBP', exponent: 2, direction: 'debit' }, templateId: 'format-1' }
      : { kind: 'none' },
  };
  const exports = load(source, { '@/lib/private-alert-formats': engine,
    '@noble/hashes/hmac.js': require('@noble/hashes/hmac.js'), '@noble/hashes/sha2.js': require('@noble/hashes/sha2.js'),
    '@noble/hashes/utils.js': require('@noble/hashes/utils.js') });
  const runtime = exports.createPrivateAlertFormatRuntime({
    isNative: () => options.native !== false,
    readSecret: async () => { counts.read++; await options.beforeRead?.(); return secret; },
    writeSecret: async value => { counts.write++; await options.beforeWrite?.(); secret = value; },
    removeSecret: async () => { counts.remove++; secret = null; },
    randomBytes: async () => { counts.random++; return new Uint8Array(32).fill(23); },
  });
  return { runtime, exports, counts, getSecret: () => secret };
}
const input = { source: 'synthetic', sender: 'TEST', confirmed: {}, now: 123 };
test('construction, empty/unhydrated reads, and history repair never touch secure storage', async () => {
  const f = fixture();
  assert.equal(await f.runtime.read('source', 'TEST', 123), null);
  f.runtime.activate(empty());
  assert.equal(await f.runtime.read('source', 'TEST', 123), null);
  f.runtime.activate({ version: 1, templates: [template] });
  assert.equal(await f.runtime.session({ historyRepair: true }).read('source', 'TEST', 123), null);
  assert.deepEqual(f.counts, { read: 0, write: 0, random: 0, remove: 0 });
});
test('explicit teaching creates one device key, while matching never creates a missing key', async () => {
  const f = fixture(); f.runtime.activate(empty());
  const created = await Promise.all([f.runtime.prepare(input), f.runtime.prepare(input)]);
  assert.ok(created.every(row => row.ok));
  assert.equal(f.counts.write, 1); assert.equal(f.counts.random, 1);
  assert.equal(f.getSecret().length, 64);
  f.runtime.activate({ version: 1, templates: [template] });
  assert.equal((await f.runtime.read('source', 'TEST', 123)).kind, 'prefill');
  const missing = fixture(); missing.runtime.activate({ version: 1, templates: [template] });
  assert.equal(await missing.runtime.read('source', 'TEST', 123), null);
  assert.equal(missing.counts.write, 0); assert.equal(missing.counts.random, 0);
});
test('web, malformed secrets, failed secure reads and wrong keys fail closed', async () => {
  const web = fixture({ native: false }); web.runtime.activate(empty());
  assert.equal((await web.runtime.prepare(input)).ok, false); assert.equal(web.counts.read, 0);
  for (const secret of ['broken', '00'.repeat(32)]) {
    const f = fixture({ secret }); f.runtime.activate({ version: 1, templates: [template] });
    assert.equal(await f.runtime.read('source', 'TEST', 123), null); assert.equal(f.counts.write, 0);
  }
  const f = fixture({ beforeRead: async () => { throw new Error('secret must not escape'); } });
  f.runtime.activate({ version: 1, templates: [template] });
  assert.equal(await f.runtime.read('source', 'TEST', 123), null);
  assert.deepEqual(JSON.parse(JSON.stringify(await f.runtime.prepare(input))), { ok: false, reason: 'device-key-unavailable' });
});
test('invalidation cancels in-flight matching and old sessions even after a new activation', async () => {
  let release; const wait = new Promise(resolve => { release = resolve; });
  const f = fixture({ secret: '17'.repeat(32), beforeRead: () => wait });
  f.runtime.activate({ version: 1, templates: [template] });
  const session = f.runtime.session(); const pending = session.read('source', 'TEST', 123);
  await Promise.resolve(); f.runtime.invalidate(); f.runtime.activate({ version: 1, templates: [template] }); release();
  assert.equal(await pending, null); assert.equal(await session.read('source', 'TEST', 123), null);
});
test('key erase is serialized after in-flight teaching and never leaves its key behind', async () => {
  let release; const wait = new Promise(resolve => { release = resolve; });
  const f = fixture({ beforeWrite: () => wait }); f.runtime.activate(empty());
  const pending = f.runtime.prepare(input); await new Promise(resolve => setTimeout(resolve, 0));
  const erased = f.runtime.eraseKey(); release(); await erased;
  assert.equal((await pending).ok, false); assert.equal(f.getSecret(), null); assert.equal(f.counts.remove, 1);
});
test('template admission authenticates a validated capsule and exposes neither key nor source in state', async () => {
  const f = fixture(); f.runtime.activate(empty()); await f.runtime.prepare(input);
  assert.equal(await f.runtime.canSave(template), true);
  assert.equal(await f.runtime.canSave({ ...template, status: 'draft' }), false);
  assert.equal(await f.runtime.canSave({ ...template, seal: 'tampered' }), false);
  assert.equal(Object.keys(f.runtime).some(key => /secret|key|cache/i.test(key) && key !== 'eraseKey'), false);
});
test('issued match capabilities bind exact source, sender, time and live runtime generation', async () => {
  const f = fixture({ secret: '17'.repeat(32) }); f.runtime.activate({ version: 1, templates: [template] });
  const match = await f.runtime.read('source', 'TEST', 123); const check = f.exports.isTrustedPrivateAlertFormatMatch;
  assert.equal(check(match, 'source', 'TEST', 123), true);
  for (const args of [[match, 'changed', 'TEST', 123], [match, 'source', 'OTHER', 123], [match, 'source', 'TEST', 124], [{ ...match }, 'source', 'TEST', 123]]) assert.equal(check(...args), false);
  assert.equal(Object.isFrozen(match.fields), true);
  f.runtime.invalidate(); assert.equal(check(match, 'source', 'TEST', 123), false);
});

const coreBoundary = {
  emptyPrivateAlertFormatStore: empty,
  isValidPrivateAlertFormatStore: value => value?.version === 1 && Array.isArray(value.templates) && value.templates.length <= 50 &&
    value.templates.every(row => row.status === 'validated' && row.seal === 'authenticated'),
  normalizePrivateAlertFormatStore: value => coreBoundary.isValidPrivateAlertFormatStore(value) ? JSON.parse(JSON.stringify(value)) : empty(),
  removePrivateAlertFormat: (store, id) => ({ version: 1, templates: store.templates.filter(row => row.id !== id) }),
};
function storeFixture() {
  const filename = path.join(root, 'scripts/perf/load-store.cjs'); const module = { exports: {} };
  const runtime = { activatePrivateAlertFormats() {}, invalidatePrivateAlertFormats() {}, erasePrivateAlertFormatKey: async () => {}, canSavePrivateAlertFormat: async () => true };
  const overrides = { '@/lib/private-alert-formats': coreBoundary, '@/lib/private-alert-format-runtime': runtime };
  const body = fs.readFileSync(filename, 'utf8').replace('const resolve = (id) => {', 'const resolve = (id) => { if (Object.hasOwn(overrides,id)) return overrides[id];');
  Function('require', 'module', 'exports', '__dirname', 'overrides', body)(createRequire(filename), module, module.exports, path.dirname(filename), overrides);
  const { reducer, store } = module.exports.loadStore();
  const hydrate = (state = {}) => reducer({ hydrated: false, accounts: [], transactions: [] }, { type: 'hydrate', state: { onboarded: true, country: 'GB', marketId: 'ZZ', language: 'en', ledgerMoney: { schemaVersion: 2, currency: 'GBP', exponent: 2 }, transactions: [], accounts: [], ...state } });
  return { reducer, store, hydrate };
}
function callback(name, next, bindings) {
  const body = fs.readFileSync(path.join(root, 'src/lib/store.tsx'), 'utf8');
  const start = body.indexOf(`  const ${name} = useCallback`), end = body.indexOf(`  const ${next} = useCallback`, start);
  assert.ok(start >= 0 && end > start, `shipping ${name} callback exists`);
  const code = ts.transpileModule(body.slice(start, end), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  return Function(...Object.keys(bindings), code + `\nreturn ${name};`)(...Object.values(bindings));
}
test('encrypted state hydrates bounded formats, while external restores and erase drop them', () => {
  const f = storeFixture(); const formats = { version: 1, templates: [template] };
  const hydrated = f.hydrate({ privateAlertFormats: formats }); assert.equal(hydrated.privateAlertFormats.templates.length, 1);
  assert.equal(f.reducer(hydrated, { type: 'restore', state: hydrated }).privateAlertFormats.templates.length, 0);
  assert.equal(f.reducer(hydrated, { type: 'clearAll' }).privateAlertFormats.templates.length, 0);
  assert.equal(f.hydrate({ privateAlertFormats: { ...formats, templates: Array(51).fill(template) } }).privateAlertFormats.templates.length, 0);
  // The compiled backup validator is deliberately real: use an authenticated,
  // schema-valid capsule rather than the lightweight fixture used above.
  const real = require('../../universal-test/load-ts.cjs').createLoader();
  const actual = real('@/lib/private-alert-formats');
  const key = new Uint8Array(32).fill(31), now = Date.parse('2026-10-12T12:00:00Z');
  const source = 'Bank alert: Card ending 2468. Ledger item GBP 46.80 at SAMPLE SHOP. Date: 2026-10-10.';
  const first = actual.createPrivateAlertFormat({ source, sender: 'TEST', context: { country: 'GB', dateOrder: 'DMY' }, now,
    confirmed: { amountMinor: '4680', currency: 'GBP', exponent: 2, direction: 'debit', merchant: 'SAMPLE SHOP', date: '2026-10-10' } }, key);
  assert.equal(first.ok, true);
  const checked = actual.validatePrivateAlertFormat(first.template, source.replace('46.80', '57.90'), 'TEST', key,
    { now, country: 'GB', dateOrder: 'DMY' });
  assert.equal(checked.ok, true);
  const realHydrated = { ...hydrated, privateAlertFormats: { version: 1, templates: [checked.template] } };
  const parsed = f.store.parseBackupForRestore(JSON.stringify({ app: 'wafra', version: 1, data: realHydrated }));
  assert.ok(parsed); assert.equal(parsed.privateAlertFormats.templates.length, 0);
});
test('add action validates finished formats and awaits encrypted durability before activation', async () => {
  const f = storeFixture(); const authoritativeState = { current: f.hydrate() }; const stateGeneration = { current: 1 }; const saveTimer = { current: null };
  let release; const committed = new Promise(resolve => { release = resolve; }); const activated = [];
  const bindings = { useCallback: fn => fn, authoritativeState, stateGeneration, saveTimer,
    dispatch: action => authoritativeState.current = f.reducer(authoritativeState.current, action), persist: () => committed,
    canSavePrivateAlertFormat: async () => true, isValidPrivateAlertFormatStore: coreBoundary.isValidPrivateAlertFormatStore,
    emptyPrivateAlertFormatStore: empty, activatePrivateAlertFormats: value => activated.push(value), invalidatePrivateAlertFormats() {},
  };
  const add = callback('addPrivateAlertFormat', 'removePrivateAlertFormatAction', bindings);
  const pending = add(template); await Promise.resolve(); await Promise.resolve();
  assert.equal(activated.length, 0); release(true); await pending;
  assert.equal(authoritativeState.current.privateAlertFormats.templates.length, 1); assert.equal(activated.length, 1);
  await assert.rejects(() => add({ ...template, status: 'draft' }));
  bindings.canSavePrivateAlertFormat = async () => false;
  const denied = callback('addPrivateAlertFormat', 'removePrivateAlertFormatAction', bindings);
  await assert.rejects(() => denied(template));
});
test('failed add writes never activate formats or report UI success', async () => {
  const f = storeFixture(); const authoritativeState = { current: f.hydrate() }; const activated = [];
  const add = callback('addPrivateAlertFormat', 'removePrivateAlertFormatAction', {
    useCallback: fn => fn, authoritativeState, stateGeneration: { current: 1 }, saveTimer: { current: null },
    dispatch: action => authoritativeState.current = f.reducer(authoritativeState.current, action), persist: async () => false,
    canSavePrivateAlertFormat: async () => true, isValidPrivateAlertFormatStore: coreBoundary.isValidPrivateAlertFormatStore,
    emptyPrivateAlertFormatStore: empty, activatePrivateAlertFormats: value => activated.push(value), invalidatePrivateAlertFormats() {},
  });
  await assert.rejects(() => add(template), /saved/);
  assert.equal(authoritativeState.current.privateAlertFormats.templates.length, 0);
  assert.ok(activated.every(store => store.templates.length === 0), 'only the prior committed store is reactivated');
});

for (const preference of ['privateMode', 'captureOptOut']) test(`local format readiness survives unrelated writes after ${preference} changes`, async () => {
  const f = storeFixture();
  const formats = empty(), stateGeneration = { current: 1 };
  const authoritativeState = { current: { ...f.hydrate(), privateAlertFormats: formats } };
  const activated = [];
  const bindings = { useCallback: fn => fn, authoritativeState, stateGeneration, saveTimer: { current: null },
    Platform: { OS: 'web' }, clearTimeout,
    dispatch: action => authoritativeState.current = { ...authoritativeState.current, [preference]: action.enabled },
    persist: async next => { authoritativeState.current = { ...next, historyImport: {} }; return true; },
    activatePrivateAlertFormats: value => activated.push(value),
  };
  const action = preference === 'privateMode'
    ? callback('setPrivateMode', 'setCaptureOptOut', bindings)
    : callback('setCaptureOptOut', 'setAndroidCaptureSources', bindings);
  await action(preference === 'privateMode');
  assert.equal(activated.length, 1);
  assert.equal(activated[0], formats);
  activated.length = 0;
  bindings.persist = async next => { stateGeneration.current++; authoritativeState.current = { ...next }; return true; };
  const replaced = preference === 'privateMode'
    ? callback('setPrivateMode', 'setCaptureOptOut', bindings)
    : callback('setCaptureOptOut', 'setAndroidCaptureSources', bindings);
  await replaced(preference === 'privateMode');
  assert.equal(activated.length, 0, 'a replaced ledger owns the runtime');
});

test('real engine, secure key runtime and encrypted-state ingress preserve changed-value matching without portable rules', async () => {
  const realLoad = require('../../universal-test/load-ts.cjs').createLoader();
  const engine = realLoad('@/lib/private-alert-formats'); const api = realLoad('@/lib/private-alert-format-runtime');
  let secret = null;
  const runtime = api.createPrivateAlertFormatRuntime({ isNative: () => true, readSecret: async () => secret,
    writeSecret: async value => { secret = value; }, removeSecret: async () => { secret = null; }, randomBytes: async () => new Uint8Array(32).fill(19) });
  runtime.activate(engine.emptyPrivateAlertFormatStore());
  const now = Date.parse('2026-10-12T12:00:00Z');
  const first = 'Sample Bank: Your card ending 1234 was charged USD 10.50 to Jane Doe on 2026-09-08. Available balance USD 900.00.';
  const second = 'Sample Bank: Your card ending 6789 was charged USD 20.75 to Cedar Bookshop on 2026-10-09. Available balance USD 879.25.';
  const learned = await runtime.prepare({ source: first, sender: 'SAMPLEBANK', confirmed: { amountMinor: 1050, currency: 'USD', exponent: 2, direction: 'debit', merchant: 'Jane Doe', date: '2026-09-08' }, context: { country: 'US' }, now });
  assert.equal(learned.ok, true, learned.reason);
  const checked = await runtime.validate(learned.template, second, 'SAMPLEBANK', { country: 'US', now }); assert.equal(checked.ok, true, checked.reason);
  assert.equal(await runtime.canSave(checked.template), true);
  const formats = { version: 1, templates: [checked.template] }; assert.equal(engine.isValidPrivateAlertFormatStore(formats), true);
  runtime.activate(formats);
  const third = second.replace('20.75', '32.10').replace('Cedar Bookshop', 'Aster Market');
  const hit = await runtime.session({ country: 'US', enabled: true, historyRepair: false, cancelled: () => false }).read(third, 'SAMPLEBANK', now);
  assert.equal(hit.fields.amountMinor, 3210); assert.equal(hit.fields.merchant, 'Aster Market');
  assert.equal(api.isTrustedPrivateAlertFormatMatch(hit, third, 'SAMPLEBANK', now), true);
  for (const sensitive of ['Jane Doe', 'Cedar Bookshop', '1234', '10.50', 'SAMPLEBANK', secret]) assert.equal(JSON.stringify(formats).includes(sensitive), false);
  await runtime.eraseKey(); runtime.activate(formats);
  assert.equal(await runtime.read(third, 'SAMPLEBANK', now), null); assert.equal(secret, null);
});

test('production native adapter writes only a random secret to this-device SecureStore with no ledger entry', async () => {
  const realLoad = require('../../universal-test/load-ts.cjs').createLoader();
  const secure = realLoad('expo-secure-store'); secure.__keychain.reset();
  const platform = realLoad('react-native'); platform.Platform.OS = 'ios';
  const api = realLoad('@/lib/private-alert-format-runtime');
  api.activatePrivateAlertFormats({ version: 1, templates: [] });
  assert.equal(secure.__keychain.writes.length, 0);
  const learned = await api.preparePrivateAlertFormat({ source: 'Sample Bank card charged USD 10.50 at Aster Market.', sender: 'SAMPLEBANK',
    confirmed: { amountMinor: 1050, currency: 'USD', exponent: 2, direction: 'debit', merchant: 'Aster Market' }, context: { country: 'US' }, now: Date.now() });
  assert.equal(learned.ok, true, learned.reason); assert.equal(secure.__keychain.writes.length, 1);
  const write = secure.__keychain.writes[0];
  assert.equal(write.options.keychainAccessible, secure.WHEN_UNLOCKED_THIS_DEVICE_ONLY);
  assert.match(secure.__keychain.items.get(write.key), /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(learned.template).includes(secure.__keychain.items.get(write.key)), false);
  await api.erasePrivateAlertFormatKey(); assert.equal(secure.__keychain.items.size, 0);
});

test('forget invalidates an in-flight match immediately while the encrypted removal is pending', async () => {
  let releaseKey; const keyWait = new Promise(resolve => { releaseKey = resolve; });
  const local = fixture({ secret: '17'.repeat(32), beforeRead: () => keyWait }); const f = storeFixture();
  const authoritativeState = { current: f.hydrate({ privateAlertFormats: { version: 1, templates: [template] } }) };
  local.runtime.activate(authoritativeState.current.privateAlertFormats); const session = local.runtime.session();
  const hit = session.read('source', 'TEST', 123); await Promise.resolve();
  let releaseSave; const saving = new Promise(resolve => { releaseSave = resolve; });
  const remove = callback('removePrivateAlertFormatAction', 'clearPrivateAlertFormats', {
    useCallback: fn => fn, authoritativeState, stateGeneration: { current: 1 }, saveTimer: { current: null },
    dispatch: action => { local.runtime.invalidate(); return authoritativeState.current = f.reducer(authoritativeState.current, action); },
    persist: () => saving, removePrivateAlertFormat: coreBoundary.removePrivateAlertFormat,
    emptyPrivateAlertFormatStore: empty, isValidPrivateAlertFormatStore: coreBoundary.isValidPrivateAlertFormatStore,
    activatePrivateAlertFormats: local.runtime.activate,
  });
  const pending = remove(template.id); releaseKey(); assert.equal(await hit, null);
  assert.equal(authoritativeState.current.privateAlertFormats.templates.length, 0);
  releaseSave(true); await pending; assert.equal(await session.read('source', 'TEST', 123), null);
});

test('a restore racing an add cannot reactivate the older private store after its write commits', async () => {
  const f = storeFixture(); const authoritativeState = { current: f.hydrate() }; const stateGeneration = { current: 1 }; const activated = [];
  let release; const saving = new Promise(resolve => { release = resolve; });
  const add = callback('addPrivateAlertFormat', 'removePrivateAlertFormatAction', {
    useCallback: fn => fn, authoritativeState, stateGeneration, saveTimer: { current: null },
    dispatch: action => authoritativeState.current = f.reducer(authoritativeState.current, action), persist: () => saving,
    canSavePrivateAlertFormat: async () => true, isValidPrivateAlertFormatStore: coreBoundary.isValidPrivateAlertFormatStore,
    emptyPrivateAlertFormatStore: empty, activatePrivateAlertFormats: value => activated.push(value),
  });
  const pending = add(template); await Promise.resolve(); await Promise.resolve();
  authoritativeState.current = f.reducer(authoritativeState.current, { type: 'restore', state: authoritativeState.current }); stateGeneration.current++;
  release(true); await pending; assert.equal(activated.length, 0); assert.equal(authoritativeState.current.privateAlertFormats.templates.length, 0);
});
