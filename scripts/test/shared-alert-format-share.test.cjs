'use strict';
// Candidate shape at Review creation + submit decision at confirmation.
// Needs the shared build: bash scripts/test/build.sh. Run:
//   node --test scripts/test/shared-alert-format-share.test.cjs
const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader } = require('../universal-test/load-ts.cjs');
const load = createLoader();
const Share = load('@/lib/shared-alert-format-share');
const Tray = load('@/lib/alert-review-tray');
const Generic = load('@/lib/universal-parser');
const Auto = load('@/lib/auto-import');

const TAUPE = 'Taupe Bank: Rs 450.00 debited from A/c XX1234 on 03-09-2026 at SWIGGY BANGALORE. Avl Bal Rs 9,550.00.';
const event = () => {
  const e = Generic.inspectUniversalBankEvent
    ? Generic.inspectUniversalBankEvent(TAUPE, { sender: 'TAUPEB', observedAt: Date.parse('2026-09-25T10:00:00Z') }) : null;
  return e;
};
const manual = () => ({
  version: 1, decision: 'review', family: 'purchase', status: 'unknown', direction: 'debit',
  amount: { value: { currency: 'INR', minorUnits: '45000', exponent: 2 }, evidence: 'explicit', spans: [], alternatives: [], issues: [] },
  merchant: { value: 'SWIGGY BANGALORE', evidence: 'explicit', spans: [], alternatives: [], issues: [] },
  transactionDate: { value: '2026-09-03', evidence: 'explicit', spans: [], alternatives: [], issues: [] },
});
const ev = () => ({ ...(event() ?? {}), ...manual() });

test('candidate: consent off or Private Mode builds nothing (active flag mirrors both)', () => {
  assert.equal(Share.buildCandidateShareShape(TAUPE, 'TAUPEB', ev(), { active: false, country: 'IN' }), null);
  Share.setAlertFormatSharingActive(false);
  assert.equal(Share.buildCandidateShareShape(TAUPE, 'TAUPEB', ev(), { country: 'IN' }), null, 'default is off until hydrated');
});

test('candidate: value-free shape plus local basis; never the text', () => {
  const c = Share.buildCandidateShareShape(TAUPE, 'TAUPEB', ev(), { active: true, country: 'IN' });
  assert.ok(c);
  assert.deepEqual(c.shareBasis, { amountMinor: 45000, currency: 'INR', direction: 'debit' });
  const shapeJson = JSON.stringify(c.shareShape);
  for (const v of ['450', '1234', '2026', '9,550', 'SWIGGY', 'BANGALORE']) assert.equal(shapeJson.includes(v), false, v);
  const item = Tray.prepareUniversalReviewAlert({
    id: 'a'.repeat(20), sourceKey: 'paste_review_source_' + 'b'.repeat(20), observedAt: Date.parse('2026-09-25T10:00:00Z'),
    channel: 'paste', event: ev(), ...c });
  assert.ok(item, 'item admitted');
  {
    assert.deepEqual(item.shareShape, c.shareShape);
    assert.equal(item.shareHash, c.shareHash);
    const json = JSON.stringify({ shareShape: item.shareShape, shareHash: item.shareHash });
    assert.equal(json.includes(TAUPE), false);
    assert.equal(json.includes('450'), false);
  }
});

test('candidate: launch routes, possible names and missing sender refuse', () => {
  const opts = { active: true, country: 'IN' };
  assert.equal(Share.buildCandidateShareShape(TAUPE, 'ADCB', ev(), opts), null);
  assert.equal(Share.buildCandidateShareShape(TAUPE, 'TAUPEB', ev(), { active: true, country: 'AE' }), null);
  assert.equal(Share.buildCandidateShareShape(TAUPE, null, ev(), opts), null);
  const noAmount = { ...ev(), amount: { value: null, evidence: 'missing', spans: [], alternatives: [], issues: [] } };
  assert.equal(Share.buildCandidateShareShape(TAUPE, 'TAUPEB', noAmount, opts), null);
  const named = 'Taupe Bank: Rs 450.00 debited to Ahmed Khalid today.';
  assert.equal(Share.buildCandidateShareShape(named, 'TAUPEB', { ...ev(), merchant: { ...ev().merchant, value: null, evidence: 'missing' },
    transactionDate: { ...ev().transactionDate, value: null, evidence: 'missing' } }, opts), null);
});

test('tray re-validates stored candidates and drops invalid ones without dropping the item', () => {
  const c = Share.buildCandidateShareShape(TAUPE, 'TAUPEB', ev(), { active: true, country: 'IN' });
  const base = { id: 'a'.repeat(20), sourceKey: 'paste_review_source_' + 'b'.repeat(20), observedAt: Date.parse('2026-09-25T10:00:00Z'),
    channel: 'paste', event: ev() };
  const bad = [
    { ...c, shareHash: 'x' },
    { ...c, shareBasis: { ...c.shareBasis, amountMinor: -1 } },
    { ...c, shareBasis: { ...c.shareBasis, currency: 'USD' } },
    { ...c, shareShape: { ...c.shareShape, sender: 'a@b.c' } },
  ];
  for (const b of bad) {
    const item = Tray.prepareUniversalReviewAlert({ ...base, ...b });
    if (item) assert.equal(item.shareShape, undefined);
  }
  assert.equal(Tray.validateReviewShareCandidate(c).shareHash, c.shareHash);
});

test('confirm: unchanged reading submits only while consent is on now', () => {
  const c = Share.buildCandidateShareShape(TAUPE, 'TAUPEB', ev(), { active: true, country: 'IN' });
  const confirmed = { amountMinor: 45000, currency: 'INR', direction: 'debit' };
  assert.equal(Share.shouldSubmitConfirmedShape(c, confirmed, {}), true);
  assert.equal(Share.shouldSubmitConfirmedShape(c, confirmed, { shareAlertFormats: true }), true);
  assert.equal(Share.shouldSubmitConfirmedShape(c, confirmed, { shareAlertFormats: false }), false, 'turned off since creation');
  assert.equal(Share.shouldSubmitConfirmedShape(c, confirmed, { privateMode: true }), false);
  assert.equal(Share.shouldSubmitConfirmedShape(c, { ...confirmed, amountMinor: 45001 }, {}), false, 'corrected amount');
  assert.equal(Share.shouldSubmitConfirmedShape(c, { ...confirmed, currency: 'USD' }, {}), false);
  assert.equal(Share.shouldSubmitConfirmedShape(c, { ...confirmed, direction: 'credit' }, {}), false, 'corrected direction');
  assert.equal(Share.shouldSubmitConfirmedShape({}, confirmed, {}), false, 'no candidate');
});

test('creation hook: a refused generic alert carries a value-free candidate, never text, only while active', () => {
  const BuiltShare = require('./build/shared-alert-format-share');
  const { createLaunchAlertSession } = require('./build/launch-alert-parser');
  const { inspectSourceFreeRefusedAlert } = require('./build/auto-import');
  const BODY = 'Hartley Bank: GBP 18.40 spent with card ending 4821 at PRET A MANGER on 03/09/2026. Available balance GBP 412.10.';
  const run = () => {
    const session = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'GBP', fxLookup: () => null,
      bestEffort: { enabled: false, country: 'GB' } });
    return inspectSourceFreeRefusedAlert({ source: BODY, sender: 'HARTLEY', session,
      existingInspection: session.inspect(BODY, 'HARTLEY'), observedAt: Date.parse('2026-09-03T12:00:00Z'), channel: 'inbox' });
  };
  BuiltShare.setAlertFormatSharingActive(false);
  const off = run();
  assert.equal(off.kind, 'review');
  assert.equal(off.candidate.shareShape, undefined, 'consent off or Private Mode: nothing stored');
  BuiltShare.setAlertFormatSharingActive(true);
  try {
    const on = run();
    assert.equal(on.kind, 'review');
    if (on.candidate.shareShape) {
      assert.deepEqual(on.candidate.shareBasis, { amountMinor: 1840, currency: 'GBP', direction: 'debit' });
      // The existing source-free event already carries its structured facts; the new fields add none.
      const whole = JSON.stringify(on.candidate);
      for (const v of ['Hartley Bank', 'spent with card', '412.10', 'Available balance']) assert.equal(whole.includes(v), false, 'item JSON has ' + v);
      const shared = JSON.stringify({ s: on.candidate.shareShape, h: on.candidate.shareHash });
      for (const v of ['1840', '18.40', '4821', '412', 'PRET', 'MANGER', '2026']) assert.equal(shared.includes(v), false, 'share fields have ' + v);
    } else assert.fail('expected a candidate shape: ' + JSON.stringify(on.candidate.event?.issues));
  } finally { BuiltShare.setAlertFormatSharingActive(false); }
});
