/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
let currency = 'AED', exponent = 2;
const cache = new Map();
function load(name) {
  if (name === 'markets') return {
    ledgerCurrencyCode: () => currency, ledgerCurrencyDisplay: () => currency,
    ledgerCurrencyExponent: () => exponent,
  };
  if (name === 'i18n') return {getLanguage: () => 'en', t: k => k};
  if (cache.has(name)) return cache.get(name);
  assert.ok(['format','ledger-money','currency-metadata','arabic-sms'].includes(name), name);
  const file = path.resolve(__dirname,'../../src/lib',name+'.ts');
  const code = ts.transpileModule(fs.readFileSync(file,'utf8'),{
    fileName: file, compilerOptions: {module: ts.ModuleKind.CommonJS,target: ts.ScriptTarget.ES2022},
  }).outputText;
  const exports = {}; cache.set(name,exports);
  vm.runInNewContext(code,{exports,require: id => {
    assert.ok(id.startsWith('@/lib/')); return load(id.slice(6));
  }},{filename:file});
  return exports;
}
const fmt = load('format');
const cases = [
  ['AED',2,'12.50',1250],
  ['AED',2,'12٫50',1250],
  ['AED',2,'١٢٫٥٠',1250],
  ['AED',2,'۱۲٫۵۰',1250],
  ['AED',2,'١٢.٥٠',1250],
  ['AED',2,'1٬234٫56',123456],
  ['AED',2,'١٬٢٣٤٫٥٦',123456],
  ['AED',2,'AED ١٬٢٣٤٫٥٦',123456],
  ['AED',2,'0٫01',1],
  ['AED',2,'٠٫٠١',1],
  ['AED',2,'١٢٫٥٠٠',null],
  ['AED',2,'١٢٬٣٤',null],
  ['AED',2,'12,50',null],
  ['AED',2,'١٢٫٥٫٠',null],
  ['AED',2,'٠',null],
  ['AED',2,'not a number',null],
  ['KWD',3,'١٫٢٣٤',1234],
  ['KWD',3,'0٫001',1],
  ['KWD',3,'١٫٢٣٤٥',null],
  ['JPY',0,'١٬٢٣٤',1234],
  ['JPY',0,'١٢٫٥٠',null],
  ['AED',2,'٩٠٠٧١٩٩٢٥٤٧٤٠٩٫٩٢',null],
];
for (const [code,digits,text,expected] of cases) {
  currency=code; exponent=digits;
  assert.equal(fmt.parseAmountToFils(text),expected,code+': '+text);
  console.log('PASS numeric input:',code,JSON.stringify(text));
}
const arabic=load('arabic-sms');
assert.equal(arabic.normalizeArabicNumerals('مبلغ ١٬٢٣٤٫٥٦'),'مبلغ 1,234.56',
  'numeric normalization must not rewrite words or infer financial semantics');
assert.equal(arabic.normalizeArabicNumerals('AED 12.50'),'AED 12.50',
  'ASCII input remains byte-for-byte unchanged');
console.log('24 numeric-input regressions passed');
