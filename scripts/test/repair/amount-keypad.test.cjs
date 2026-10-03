'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const file = path.join(root, 'src/lib/amount-keypad.ts');
const {
  applyKeypadKey, keypadMinorUnits, keypadTextFromMinor, keypadDisplay, keypadHasDecimal, KEYPAD_MAX_WHOLE_DIGITS,
} = load(file);

const type = (keys, exponent, start = '') => keys.reduce((text, key) => applyKeypadKey(text, key, exponent), start);
const digits = (value) => [...value].map((c) => (c === '.' ? 'decimal' : c));

test('the decimal key exists only for currencies with minor units', () => {
  assert.equal(keypadHasDecimal(0), false, 'JPY-style whole units');
  assert.equal(keypadHasDecimal(2), true);
  assert.equal(keypadHasDecimal(3), true, 'KWD-style three decimals');
});

test('two-decimal entry builds the canonical string and converts exactly', () => {
  assert.equal(type(digits('18.00'), 2), '18.00');
  assert.equal(keypadMinorUnits('18.00', 2), 1800);
  assert.equal(keypadMinorUnits('18', 2), 1800);
  assert.equal(keypadMinorUnits('18.5', 2), 1850);
  assert.equal(keypadMinorUnits('0.07', 2), 7);
  // A third decimal is refused by the key, not truncated by the parser.
  assert.equal(type(digits('1.239'), 2), '1.23');
  assert.equal(keypadMinorUnits('1.239', 2), null);
});

test('three-decimal (KWD) and zero-decimal (JPY) currencies follow their exponent', () => {
  assert.equal(type(digits('12.345'), 3), '12.345');
  assert.equal(keypadMinorUnits('12.345', 3), 12345);
  assert.equal(keypadMinorUnits('12.3', 3), 12300);
  assert.equal(type(['1', '5', 'decimal', '0', '0'], 0), '1500', 'no decimal for JPY: the key does nothing');
  assert.equal(keypadMinorUnits('1500', 0), 1500);
  assert.equal(keypadMinorUnits('15.0', 0), null, 'a decimal can never mean anything at exponent 0');
});

test('leading zeros, empty and zero amounts', () => {
  assert.equal(type(['0', '0', '5'], 2), '5', 'a lone leading zero is replaced');
  assert.equal(type(['decimal', '5'], 2), '0.5', 'decimal first reads as 0.');
  assert.equal(type(['decimal', 'decimal', '5'], 2), '0.5', 'a second decimal is ignored');
  assert.equal(keypadMinorUnits('', 2), null);
  assert.equal(keypadMinorUnits('0', 2), null);
  assert.equal(keypadMinorUnits('0.', 2), null);
  assert.equal(keypadMinorUnits('0.00', 2), null);
});

test('backspace removes one character at a time', () => {
  assert.equal(type(['backspace'], 2, '18.5'), '18.');
  assert.equal(type(['backspace', 'backspace'], 2, '18.5'), '18');
  assert.equal(type(['backspace'], 2, ''), '');
});

test('the whole-digit cap keeps every accepted amount a safe integer', () => {
  const max = '9'.repeat(KEYPAD_MAX_WHOLE_DIGITS);
  assert.equal(type([...max, '9'], 3), max, 'one more whole digit is refused');
  const minor = keypadMinorUnits(`${max}.999`, 3);
  assert.equal(minor, Number(`${max}999`));
  assert.ok(Number.isSafeInteger(minor));
  assert.equal(keypadMinorUnits(`${max}9`, 2), null, 'over the cap is not something the keypad produces');
});

test('conversion never uses floating-point arithmetic', () => {
  // 0.1 + 0.2 style traps: every value is exact.
  assert.equal(keypadMinorUnits('0.29', 2), 29);
  assert.equal(keypadMinorUnits('1.005', 3), 1005);
  assert.equal(keypadMinorUnits('4.35', 2), 435);
  const source = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.doesNotMatch(source, /parseFloat|Math\.round|toFixed|\* ?100\b|\/ ?100\b/);
});

test('garbage never converts', () => {
  for (const bad of ['1,000', '١٢', '12.3.4', '-5', ' 5', 'abc', '.']) {
    assert.equal(keypadMinorUnits(bad, 2), null, bad);
  }
  assert.equal(applyKeypadKey('1,000', '5', 2), '5', 'a non-canonical start is discarded, not extended');
});

test('switching from typing back to the keypad keeps the exact value', () => {
  for (const [minor, exponent, text] of [[1800, 2, '18'], [1850, 2, '18.5'], [7, 2, '0.07'], [12345, 3, '12.345'],
    [1500, 0, '1500'], [100, 3, '0.1']]) {
    assert.equal(keypadTextFromMinor(minor, exponent), text);
    assert.equal(keypadMinorUnits(text, exponent), minor, 'round trip');
  }
  assert.equal(keypadTextFromMinor(null, 2), '');
  assert.equal(keypadTextFromMinor(0, 2), '');
  assert.equal(keypadTextFromMinor(1.5, 2), '', 'never a fractional minor unit');
});

test('display groups whole digits and keeps the fraction exactly as typed', () => {
  const group = (whole) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  assert.equal(keypadDisplay('', group, '.'), '0');
  assert.equal(keypadDisplay('1284', group, '.'), '1,284');
  assert.equal(keypadDisplay('1284.', group, '.'), '1,284.', 'the pending decimal stays visible');
  assert.equal(keypadDisplay('1284.5', group, '.'), '1,284.5');
  const de = (whole) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  assert.equal(keypadDisplay('1284.5', de, ','), '1.284,5', 'device conventions for display only');
});
