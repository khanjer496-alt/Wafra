'use strict';
// shareConfirmedAlertFormat: consent, Private Mode, launch route, refusals, one submit.
// Needs the shared build: bash scripts/test/build.sh. Run:
//   node --test scripts/test/shared-alert-format-share.test.cjs
const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader } = require('../universal-test/load-ts.cjs');
const { shareConfirmedAlertFormat } = createLoader()('@/lib/shared-alert-format-share');

const NOW = Date.parse('2026-09-25T10:00:00Z');
const TAUPE = 'Taupe Bank: Rs 450.00 debited from A/c XX1234 on 03-09-2026 at SWIGGY BANGALORE. Avl Bal Rs 9,550.00.';
const base = () => ({
  source: TAUPE, sender: 'TAUPEB', consent: undefined, privateMode: false, launchRoute: false, country: 'IN', now: NOW,
  confirmed: { amountMinor: 45000, currency: 'INR', exponent: 2, direction: 'debit', merchant: 'SWIGGY BANGALORE', date: '2026-09-03' },
});
const deps = (calls, cfg = { baseUrl: 'https://relay.example', syncToken: 't' }) => ({
  getConfig: async () => cfg, submit: async (c, shape) => { calls.push(shape); return { ok: true }; },
});

test('never chose (undefined) and explicit true submit exactly one digit-free shape', async () => {
  for (const consent of [undefined, true]) {
    const calls = [];
    assert.equal(await shareConfirmedAlertFormat({ ...base(), consent }, deps(calls)), true);
    assert.equal(calls.length, 1);
    // Slot formats like "xx####" are placeholders; no literal carries a digit and no source value appears.
    assert.equal(calls[0].tokens.some((t) => t.k === 'L' && /\d/.test(t.v)), false);
    for (const value of ['450', '1234', '2026', '9,550', '9550']) assert.equal(JSON.stringify(calls[0]).includes(value), false);
    assert.equal(JSON.stringify(calls[0]).includes('SWIGGY'), false);
  }
});

test('consent off, Private Mode and launch route never submit', async () => {
  for (const patch of [{ consent: false }, { privateMode: true }, { launchRoute: true }, { sender: 'ADCB' }]) {
    const calls = [];
    assert.equal(await shareConfirmedAlertFormat({ ...base(), ...patch }, deps(calls)), false);
    assert.equal(calls.length, 0);
  }
});

test('refusals, no pairing and failures stay silent and submit nothing', async () => {
  const calls = [];
  const b = base();
  assert.equal(await shareConfirmedAlertFormat({ ...b, source: 'Taupe Bank: Rs 450.00 debited to Ahmed Khalid today.',
    confirmed: { ...b.confirmed, merchant: null, date: null } }, deps(calls)), false, 'possible-name refusal');
  assert.equal(await shareConfirmedAlertFormat(base(), deps(calls, null)), false, 'no pairing');
  assert.equal(await shareConfirmedAlertFormat({ ...base(), sender: null }, deps(calls)), false, 'no sender');
  assert.equal(await shareConfirmedAlertFormat(base(), { getConfig: async () => { throw new Error('x'); }, submit: async () => {} }), false);
  assert.equal(calls.length, 0);
});

test('a merchant that is not an exact substring is dropped; the unslotted name then refuses', async () => {
  const calls = [];
  const b = base();
  assert.equal(await shareConfirmedAlertFormat({ ...b, confirmed: { ...b.confirmed, merchant: 'Swiggy' } }, deps(calls)), false);
  assert.equal(calls.length, 0);
});
