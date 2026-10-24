'use strict';
// Store wiring for shared alert shapes: defaults, migration, hydrate
// re-validation, reducer actions, and the on-device prefill-only matching path.
// Needs the shared build: bash scripts/test/build.sh. Run:
//   node --test scripts/test/shared-alert-format-store.test.cjs
const assert = require('node:assert/strict');
const test = require('node:test');
const { loadStore, ledger } = require('../perf/load-store.cjs');
const { createLoader } = require('../universal-test/load-ts.cjs');

const { store, reducer } = loadStore();
const load = createLoader();
const L = load('@/lib/learned-alert-formats');
const S = load('@/lib/shared-alert-formats');
const Active = load('@/lib/shared-alert-format-active');
const Share = load('@/lib/shared-alert-format-share');
const NOW = Date.parse('2026-09-25T10:00:00Z');

const TAUPE = 'Taupe Bank: Rs 450.00 debited from A/c XX1234 on 03-09-2026 at SWIGGY BANGALORE. Avl Bal Rs 9,550.00.';
const learned = L.learnFromConfirmation({ source: TAUPE, sender: 'TAUPEB', now: NOW, context: { country: 'IN' },
  confirmed: { amountMinor: 45000, currency: 'INR', exponent: 2, direction: 'debit', merchant: 'SWIGGY BANGALORE', date: '2026-09-03' } });
const made = S.toSharedAlertShape(learned.template);
assert.equal(made.ok, true);
const format = { hash: made.hash, shape: made.shape };
const clone = (value) => JSON.parse(JSON.stringify(value));
const EMPTY = { hydrated: false, transactions: [], accounts: [] };
const hydrate = (extra) => reducer({ ...EMPTY }, { type: 'hydrate', state: store.migratePersistedState({ ...clone(ledger(5)), ...extra }) });

test('defaults: consent is never-chose (on) and the downloaded set is empty', () => {
  const migrated = store.migratePersistedState(clone(ledger(5)));
  assert.equal(migrated.shareAlertFormats, undefined);
  assert.equal(Share.sharesAlertFormats(migrated), true, 'never chose = on');
  assert.deepEqual(migrated.sharedAlertFormats, { etag: null, fetchedAt: null, formats: [] });
  const state = hydrate({});
  assert.equal(state.shareAlertFormats, undefined);
  assert.equal(Share.sharesAlertFormats(state), true);
  assert.equal(Share.sharesAlertFormats({ ...state, privateMode: true }), false, 'Private Mode never sends');
  assert.deepEqual(state.sharedAlertFormats, { etag: null, fetchedAt: null, formats: [] });
});

test('migration: only a boolean is a choice; explicit false stays false; the list is re-validated', () => {
  assert.equal(store.migratePersistedState({ ...clone(ledger(5)), shareAlertFormats: 'yes' }).shareAlertFormats, undefined);
  assert.equal(store.migratePersistedState({ ...clone(ledger(5)), shareAlertFormats: false }).shareAlertFormats, false);
  assert.equal(store.migratePersistedState({ ...clone(ledger(5)), shareAlertFormats: true }).shareAlertFormats, true);
  const tampered = clone(format); tampered.shape.tokens.unshift({ k: 'L', v: 'Acct 99887766' });
  const migrated = store.migratePersistedState({ ...clone(ledger(5)),
    sharedAlertFormats: { etag: '"e"', fetchedAt: 42, formats: [format, tampered, { hash: 'x', shape: {} }] } });
  assert.deepEqual(migrated.sharedAlertFormats, { etag: '"e"', fetchedAt: 42, formats: [format] });
});

test('hydrate: a hand-edited store cannot smuggle an invalid shape; junk consent means never chose; false stays false', () => {
  const bad = clone(format); bad.shape.sender = 'hacker@example.com';
  const state = reducer({ ...EMPTY }, { type: 'hydrate', state: {
    ...store.migratePersistedState(clone(ledger(5))), shareAlertFormats: 1,
    sharedAlertFormats: { etag: null, fetchedAt: 1, formats: [bad, format] } } });
  assert.equal(state.shareAlertFormats, undefined);
  assert.deepEqual(state.sharedAlertFormats.formats, [format]);
  assert.equal(hydrate({ shareAlertFormats: false }).shareAlertFormats, false);
  assert.equal(Share.sharesAlertFormats(hydrate({ shareAlertFormats: false })), false);
});

test('actions: consent, replace, touch and clear', () => {
  let state = hydrate({});
  state = reducer(state, { type: 'setShareAlertFormats', enabled: true });
  assert.equal(state.shareAlertFormats, true);
  assert.equal(reducer(state, { type: 'setShareAlertFormats', enabled: undefined }).shareAlertFormats, undefined);
  state = reducer(state, { type: 'setSharedAlertFormats', etag: '"e1"', fetchedAt: 100, formats: [format, { hash: 'bad', shape: format.shape }] });
  assert.deepEqual(state.sharedAlertFormats, { etag: '"e1"', fetchedAt: 100, formats: [format] });
  state = reducer(state, { type: 'touchSharedAlertFormats', fetchedAt: 200 });
  assert.deepEqual(state.sharedAlertFormats, { etag: '"e1"', fetchedAt: 200, formats: [format] });
  state = reducer(state, { type: 'clearSharedAlertFormats' });
  assert.deepEqual(state.sharedAlertFormats, { etag: null, fetchedAt: null, formats: [] });
  assert.equal(state.shareAlertFormats, true, 'clearing the downloaded set keeps the consent choice');
  state = reducer(state, { type: 'setShareAlertFormats', enabled: false });
  assert.equal(state.shareAlertFormats, false);
});

test('actions leave ledger rows and accounts untouched', () => {
  const state = hydrate({});
  const next = reducer(state, { type: 'setSharedAlertFormats', etag: null, fetchedAt: 1, formats: [format] });
  assert.equal(next.transactions, state.transactions);
  assert.equal(next.accounts, state.accounts);
});

test('restore normalizes whatever list it is handed', () => {
  const state = hydrate({});
  const restored = reducer(state, { type: 'restore', state: { ...store.migratePersistedState(clone(ledger(5))),
    shareAlertFormats: true, sharedAlertFormats: { etag: 'x', fetchedAt: 1, formats: [format] } } });
  // restoreBackup() passes this phone's own consent and list; the reducer only normalizes.
  assert.equal(restored.shareAlertFormats, true);
  assert.deepEqual(restored.sharedAlertFormats.formats, [format]);
  const off = reducer(state, { type: 'restore', state: { ...store.migratePersistedState(clone(ledger(5))), shareAlertFormats: false } });
  assert.equal(off.shareAlertFormats, false, 'an explicit off survives restore');
});

test('on-device matching: a published shape yields a trusted prefill (never a post) after private formats decline', async () => {
  const runtimeModule = load('@/lib/private-alert-format-runtime');
  const runtime = runtimeModule.createPrivateAlertFormatRuntime({
    isNative: () => true, readSecret: async () => null, writeSecret: async () => {}, removeSecret: async () => {},
    randomBytes: async () => new Uint8Array(32).fill(7),
  });
  runtime.activate({ version: 1, templates: [] });
  const second = 'Taupe Bank: Rs 1,299.50 debited from A/c XX9876 on 14-09-2026 at AMAZON PAY INDIA. Avl Bal Rs 100.00.';
  const session = runtime.session({});
  assert.equal(await session.read(second, 'TAUPEB', NOW, { country: 'IN' }), null, 'nothing downloaded yet');
  runtime.setSharedMatcher(Active.sharedMatcherFor([format]));
  const hit = await session.read(second, 'TAUPEB', NOW, { country: 'IN' });
  assert.ok(hit, 'shared shape matched');
  assert.equal(hit.kind, 'prefill');
  assert.equal(hit.fields.amountMinor, 129950);
  assert.equal(hit.fields.direction, 'debit');
  assert.equal(runtimeModule.isTrustedPrivateAlertFormatMatch(hit, second, 'TAUPEB', NOW), true);
  assert.equal(runtimeModule.isTrustedPrivateAlertFormatMatch(hit, second + ' ', 'TAUPEB', NOW), false, 'bound to this exact source');
  assert.equal(runtimeModule.isTrustedPrivateAlertFormatMatch({ ...hit }, second, 'TAUPEB', NOW), false, 'a copy is not a capability');
  // Launch markets are never overridden.
  assert.equal(await session.read(second, 'TAUPEB', NOW, { country: 'AE', routedMarket: 'AE' }), null);
  // A different sender, or a message that is not this layout, matches nothing.
  assert.equal(await session.read(second, 'OTHERB', NOW, { country: 'IN' }), null);
  assert.equal(await session.read('Taupe Bank: your OTP is 123456', 'TAUPEB', NOW, { country: 'IN' }), null);
  // Clearing the downloaded set stops matching.
  runtime.setSharedMatcher(Active.sharedMatcherFor([]));
  assert.equal(await session.read(second, 'TAUPEB', NOW, { country: 'IN' }), null);
  // Invalid entries are never activated.
  const bad = clone(format); bad.shape.sender = 'a@b.c';
  runtime.setSharedMatcher(Active.sharedMatcherFor([bad]));
  assert.equal(await session.read(second, 'TAUPEB', NOW, { country: 'IN' }), null);
});

test('turning consent off or Private Mode on strips sharing candidates from Review items', () => {
  const item = { kind: 'universal', id: 'i', sourceKey: 's', shareShape: format.shape, shareHash: format.hash,
    shareBasis: { amountMinor: 1, currency: 'INR', direction: 'debit' }, event: {} };
  const start = hydrate({});
  const base = { ...start, reviewTray: { ...start.reviewTray, pending: [item] } };
  for (const action of [{ type: 'setShareAlertFormats', enabled: false }, { type: 'setPrivateMode', enabled: true }]) {
    const kept = reducer(base, action).reviewTray.pending[0];
    assert.equal(kept.shareShape, undefined); assert.equal(kept.shareHash, undefined); assert.equal(kept.shareBasis, undefined);
    assert.equal(kept.id, 'i');
  }
  assert.equal(reducer(base, { type: 'setShareAlertFormats', enabled: true }).reviewTray.pending[0].shareShape, format.shape);
});
