'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const hash = 'a'.repeat(64);
const api = load(path.join(root, 'src/lib/ios-native-parser-context.ts'), {
  '@/lib/ios-background-parser-source.generated': { IOS_BACKGROUND_PARSER_SOURCE_HASH: hash },
  '@/lib/country': load(path.join(root, 'src/lib/country.ts'), {
    '@/lib/country-names': load(path.join(root, 'src/lib/country-names.ts')),
  }),
  '@/lib/currency-metadata': load(path.join(root, 'src/lib/currency-metadata.ts')),
});
const state = (patch = {}) => ({ hydrated: true, onboarded: true, country: 'AE', marketId: 'AE',
  ledgerMoney: { currency: 'AED', exponent: 2 }, ...patch });
test('snapshot contains only validated preferences and source hash', () => {
  const value = api.buildIosNativeParserContext(state({ raw: 'private', accounts: [{ balance: 100 }] }));
  assert.deepEqual(JSON.parse(JSON.stringify(value)), { v: 1, country: 'AE', parserMarket: 'AE', ledgerMoney: { currency: 'AED', exponent: 2 }, sourceHash: hash });
  assert.doesNotMatch(JSON.stringify(value), /private|accounts|balance/);
});
test('foreign ledger stays separate from country and parser pack', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(api.buildIosNativeParserContext(state({ ledgerMoney: { currency: 'JOD', exponent: 3 } })).ledgerMoney)),
    { currency: 'JOD', exponent: 3 });
  assert.equal(api.buildIosNativeParserContext(state({ country: null, marketId: 'ZZ' })).country, null);
});
test('invalid or absent source preferences cannot invent a context', () => {
  for (const patch of [{ hydrated: false }, { onboarded: false }, { country: 'XX' }, { marketId: 'evil' },
    { ledgerMoney: { currency: 'JOD', exponent: 2 } }, { ledgerMoney: { currency: 'ZZZ', exponent: 2 } }]) {
    assert.equal(api.buildIosNativeParserContext(state(patch)), null);
  }
});
test('older native binaries stay compatible', async () => {
  assert.equal(await api.syncIosNativeParserContext({}, state()), false);
});
test('unhydrated startup does not erase the last valid background context', async () => {
  let writes = 0;
  assert.equal(await api.syncIosNativeParserContext({ async setNativeParserContext() { writes++; } }, state({ hydrated: false })), false);
  assert.equal(writes, 0);
});
test('latest context wins across delayed writes and duplicate requests', async () => {
  const writes = []; let release; let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const native = { async setNativeParserContext(json) {
    writes.push(json); if (writes.length === 1) { entered(); await held; }
  } };
  const a = api.syncIosNativeParserContext(native, state()); await started;
  const b = api.syncIosNativeParserContext(native, state({ country: 'GB', marketId: 'ZZ', ledgerMoney: { currency: 'GBP', exponent: 2 } }));
  const cState = state({ country: 'JO', marketId: 'ZZ', ledgerMoney: { currency: 'JOD', exponent: 3 } });
  const c = api.syncIosNativeParserContext(native, cState); release(); await Promise.all([a, b, c]);
  assert.equal(writes.length, 2);
  assert.equal(JSON.parse(writes[1]).country, 'JO');
  assert.equal(await api.syncIosNativeParserContext(native, cState), false);
});
test('invalid hydrated preferences clear preview context only', async () => {
  const writes = [];
  await api.syncIosNativeParserContext({ async setNativeParserContext(json) { writes.push(json); } }, state({ ledgerMoney: { currency: 'JOD', exponent: 2 } }));
  assert.deepEqual(writes, [null]);
});
test('native erase invalidation allows the same preferences to be restored', async () => {
  const writes = [];
  const native = { async setNativeParserContext(json) { writes.push(json); } };
  assert.equal(await api.syncIosNativeParserContext(native, state()), true);
  api.invalidateIosNativeParserContext(native);
  assert.equal(await api.syncIosNativeParserContext(native, state()), true);
  assert.equal(writes.length, 2);
});
test('an in-flight pre-erase write cannot mark an erased context as synchronized', async () => {
  const writes = []; let release; let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const native = { async setNativeParserContext(json) {
    writes.push(json); if (writes.length === 1) { entered(); await held; }
  } };
  const old = api.syncIosNativeParserContext(native, state()); await started;
  api.invalidateIosNativeParserContext(native);
  const fresh = api.syncIosNativeParserContext(native, state()); release();
  await Promise.all([old, fresh]);
  assert.equal(writes.length, 2);
  assert.equal(await api.syncIosNativeParserContext(native, state()), false);
});
