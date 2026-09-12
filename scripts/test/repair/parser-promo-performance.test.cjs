'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { performance } = require('node:perf_hooks');
const ts = require('typescript');

const root = path.resolve(__dirname, '../../..');
const parserSource = fs.readFileSync(path.join(root, 'src/lib/sms-parser.ts'), 'utf8');
const guardCall = 'PROMO_SENTENCE_TRIGGER_RE.test(contactFreeText)';

/** Actual source, including its market grammar; instrument only regex calls. */
function loadParser(forceOriginal = false) {
  const cache = new Map();
  let promoExecutions = 0;
  class ObservedRegExp extends RegExp {
    exec(text) {
      if (this.source.includes('redeem') && this.source.includes('conditions')) promoExecutions += 1;
      return super.exec(text);
    }
  }
  function load(name) {
    if (cache.has(name)) return cache.get(name).exports;
    const file = path.join(root, `src/lib/${name}.ts`);
    let source = name === 'sms-parser' ? parserSource : fs.readFileSync(file, 'utf8');
    if (name === 'sms-parser') {
      // Force the old unconditional cleanup without copying the entire parser.
      if (forceOriginal) source = source.replace(guardCall, 'true');
      source += '\nexport const __promoExpression = PROMO_SENTENCE_RE;';
      source += '\nexport const __promoTrigger = typeof PROMO_SENTENCE_TRIGGER_RE === "undefined" ? null : PROMO_SENTENCE_TRIGGER_RE;';
    }
    const module = { exports: {} };
    cache.set(name, module);
    const output = ts.transpileModule(source, { fileName: file, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
    } }).outputText;
    Function('require', 'module', 'exports', 'RegExp', output)((id) => {
      assert.ok(id.startsWith('@/lib/'), `unexpected parser dependency: ${id}`);
      return load(id.slice('@/lib/'.length));
    }, module, module.exports, ObservedRegExp);
    return module.exports;
  }
  const parser = load('sms-parser');
  return { ...parser, executions: () => promoExecutions, market: load('markets') };
}

const ordinary = [
  'AED 35.00 was spent on your Credit Card ending 1234 at CARREFOUR on 12/09/2026. Available balance AED 5000.00.',
  'Purchase of AED 18.50 with Debit Card ending 4321 at STARBUCKS DUBAI on 12/09/2026. Available balance AED 15200.75.',
  'AED 267.00 was spent on your Credit Card ending 1234 at Noon.com on 12/09/2026. Available balance AED 5000.00.',
];

test('ordinary posted purchases bypass expensive promotional sentence matching', () => {
  const parser = loadParser();
  for (const raw of ordinary) assert.equal(parser.parseSms(raw)?.kind, 'transaction');
  assert.equal(parser.executions(), 0, 'non-promotional SMS must not run the backtracking promo regex');
});

test('necessary-token guard retains every promo alternative and original parser output', () => {
  const guarded = loadParser();
  const original = loadParser(true);
  const phrases = [
    '5% cashback at ENOC stations', '10 % OFF', 'Enjoy 20% at Noon.com', 'up to 5 % savings',
    'redeem reward points', 'Redeem points', 'pay utility bills in our app',
    'manage electricity bills online', 'pay water bills online', 'manage telecom bills in app',
    'pay internet bills through our app', 'T&C apply', 'T&Cs apply', 'conditions apply', 'terms apply',
    'VAT @5% on toll transactions', 'redemption of points', 'payroll credited', 'management service',
    'conditions\napply', 'terms\tapply', 'redeem\npoints', 'T&Cs!',
    'شراء ببطاقة 1234 لدى كارفور', 'CARREFOUR', 'Noon.com', '',
  ];
  let seed = 0x16af23;
  const next = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
  const separators = [' ', '. ', '.', '\n', '; ', '\t', '\u00a0'];
  const bodies = [...phrases, ...phrases.map(phrase => `${ordinary[0]} ${phrase}.`)];
  for (let i = 0; i < 500; i += 1) {
    bodies.push([ordinary[next(ordinary.length)], phrases[next(phrases.length)],
      phrases[next(phrases.length)]].join(separators[next(separators.length)]).slice(0, 300));
  }
  assert.ok(guarded.__promoTrigger, 'production parser must define the cheap necessary-token test');
  let matched = 0;
  for (const body of bodies) {
    original.__promoExpression.lastIndex = 0;
    if (original.__promoExpression.test(body)) {
      matched += 1;
      assert.ok(guarded.__promoTrigger.test(body), `guard must admit every original match: ${JSON.stringify(body)}`);
    }
    assert.deepEqual(guarded.parseSms(body), original.parseSms(body), `parser output changed: ${JSON.stringify(body)}`);
  }
  assert.ok(matched > 100, 'differential corpus must exercise promotional matches');
  for (const market of ['AE', 'SA']) {
    guarded.market.setActiveMarket(market);
    original.market.setActiveMarket(market);
    const raw = 'SAR 35.00 was spent on your Credit Card ending 1234 at CARREFOUR on 12/09/2026. Enjoy 5% cashback. T&Cs apply.';
    assert.deepEqual(guarded.parseSms(raw), original.parseSms(raw));
  }
});

test('report ordinary-message parser timings without a machine-dependent pass threshold', () => {
  const guarded = loadParser();
  const original = loadParser(true);
  const repetitions = 1000;
  const measure = parser => {
    const start = performance.now();
    for (let i = 0; i < repetitions; i += 1) parser.parseSms(ordinary[i % ordinary.length]);
    return +(performance.now() - start).toFixed(2);
  };
  // Warm both copies, then alternate order so compilation is outside the report.
  measure(original); measure(guarded);
  const originalMs = [], guardedMs = [];
  for (let i = 0; i < 3; i += 1) {
    if (i % 2) { guardedMs.push(measure(guarded)); originalMs.push(measure(original)); }
    else { originalMs.push(measure(original)); guardedMs.push(measure(guarded)); }
  }
  assert.equal(guarded.executions(), 0);
  assert.ok(original.executions() >= repetitions * 4, 'baseline must execute the original expensive path');
  console.log(JSON.stringify({ scope: 'desktop Node parser, synthetic SMS <= 300 chars', repetitions,
    originalMs, guardedMs }));
});
