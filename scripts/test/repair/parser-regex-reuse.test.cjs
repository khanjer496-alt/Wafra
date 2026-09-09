'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const compiled = name => require(path.join(root, 'scripts/test/build', `${name}.js`));
const plain = value => JSON.parse(JSON.stringify(value));

function counted(name, dependencies) {
  const calls = [];
  const Constructor = new Proxy(RegExp, {
    construct(target, args) { calls.push({ pattern: String(args[0]), flags: args[1] }); return Reflect.construct(target, args); },
  });
  return { api: load(path.join(root, 'src/lib', `${name}.ts`), dependencies, { RegExp: Constructor }), calls };
}

test('market vocabulary compiles once, keeps the exact result and never uses message text as a cache key', () => {
  const h = counted('alert-semantics', {
    '@/lib/alert-draft': compiled('alert-draft'),
    '@/lib/alert-event-evidence': compiled('alert-event-evidence'),
    '@/lib/alert-institution-grammars': compiled('alert-institution-grammars'),
    '@/lib/alert-market-packs': compiled('alert-market-packs'),
  });
  const markets = ['US','GB','FR','DE','ES','IT','NL','IN','QA','KW','BH','OM','EG','JO'];
  const source = 'Unknown event with PRIVATE_SOURCE_SENTINEL_9385. Account ending 1234 balance AED 12.50';
  const first = markets.map(m => plain(h.api.inspectMarketAlert(source, m)));
  const cold = h.calls.length;
  assert.ok(cold > 20 && cold < 1024, 'fixed vocabulary fits the bounded cache');
  for (let i = 0; i < 10; i++) assert.deepEqual(markets.map(m => plain(h.api.inspectMarketAlert(source, m))), first);
  assert.equal(h.calls.length, cold, 'no new term expressions after warmup');
  assert.ok(h.calls.every(c => !c.pattern.includes('PRIVATE_SOURCE_SENTINEL_9385')));
  assert.ok(h.calls.every(c => c.flags === 'iu'), 'cached term tests have no stateful matching cursor');
});

test('alias cache reuses only syntax, not currency values, money, offsets or cross-message results', () => {
  const h = counted('alert-draft', { '@/lib/currency-metadata': compiled('currency-metadata') });
  const run = (source, currency) => plain(h.api.inspectAlertDraft(source, { currencyAliases: { dirham: [currency] } }));
  const first = run('Paid dirham 12.50 at TEST', 'AED');
  const cold = h.calls.filter(c => c.flags === 'giu').length;
  assert.equal(first.candidates[0].currency, 'AED');
  assert.equal(first.candidates[0].minorUnits, '1250');
  assert.deepEqual(run('Paid dirham 12.50 at TEST', 'AED'), first);
  assert.equal(h.calls.filter(c => c.flags === 'giu').length, cold, 'same alias token grammar is not recompiled');
  assert.equal(run('Paid dirham 12.50 at TEST', 'SAR').candidates[0].currency, 'SAR', 'current alias mapping always wins');
  assert.equal(run('Paid dirham 19.25 at TEST', 'AED').candidates[0].minorUnits, '1925');
  const moved = run('Longer prefix dirham 19.25', 'AED').candidates[0];
  assert.equal(moved.span.start, 'Longer prefix '.length);
  assert.deepEqual(run('Paid dirham 12.50 at TEST', 'AED'), first, 'global iterator cursor cannot leak to the next source');
});

test('alias escaping, token ordering, changing token sets and bounded eviction retain existing outputs', () => {
  const h = counted('alert-draft', { '@/lib/currency-metadata': compiled('currency-metadata') });
  const reference = compiled('alert-draft');
  const cases = [
    ['Paid D.h 12.50', { 'D.h': ['AED'] }],
    ['Paid dh 12.50', { dh: ['AED'], DH: ['SAR'] }],
    ['Paid DH 12.50', { DH: ['SAR'], dh: ['AED'] }],
    ['Paid درهم ١٢٫٥٠', { 'درهم': ['AED'] }],
    ['Paid dirham 12.50', { dirham: ['AED', 'SAR'] }],
    ['Paid dirham 12.50', {}],
  ];
  for (const [source, currencyAliases] of cases) {
    assert.deepEqual(plain(h.api.inspectAlertDraft(source, { currencyAliases })),
      plain(reference.inspectAlertDraft(source, { currencyAliases })));
  }
  for (let i = 0; i < 40; i++) h.api.inspectAlertDraft('No monetary value', { currencyAliases: { [`token${i}`]: ['AED'] } });
  for (const [source, currencyAliases] of cases) {
    assert.deepEqual(plain(h.api.inspectAlertDraft(source, { currencyAliases })),
      plain(reference.inspectAlertDraft(source, { currencyAliases })));
  }
});

test('universal fixed phrases retain negative and conditional controls without recompiling non-global phrases', () => {
  const h = counted('universal-parser', {
    '@/lib/universal-types': compiled('universal-types'),
    '@/lib/alert-semantics': compiled('alert-semantics'),
    '@/lib/universal-fields': compiled('universal-fields'),
    '@/lib/universal-money': compiled('universal-money'),
  });
  const sources = [
    'Your account 1234 was debited USD 12.50 at TEST on 2026-09-09.',
    'If paiement effectué EUR 12.50 par carte 1234 on 2026-09-09.',
    'Paiement non effectué EUR 12.50 carte 1234.',
    'Card 1234 payment USD 12.50 not completed.',
    'Card 1234 was credited USD 12.50 and debited USD 12.50.',
  ];
  const first = sources.map(s => plain(h.api.inspectUniversalBankEvent(s)));
  const cold = h.calls.filter(c => c.flags === 'iu').length;
  assert.ok(cold > 10 && cold < 64);
  for (let i = 0; i < 5; i++) assert.deepEqual(sources.map(s => plain(h.api.inspectUniversalBankEvent(s))), first);
  assert.equal(h.calls.filter(c => c.flags === 'iu').length, cold);
  for (let i = 0; i < sources.length; i++) assert.deepEqual(first[i], plain(compiled('universal-parser').inspectUniversalBankEvent(sources[i])));
});
