'use strict';
// Alert-lab safety gate (scripts/alert-lab/README.md).
//
// Generated, labelled bank alerts for every launch market are run through the
// shipping capture boundaries (Android SMS LaunchAlertSession, iOS History
// import). The gate grades one fixed DEV-split sample and fails when a case
// books unsafe money (WRONG amount/currency/direction/kind, or a FALSE-POST of
// a declined/pending/conditional/question/negated/OTP/promo/request/statement/
// balance/chat/scam alert) that is not already recorded in
// scripts/alert-lab/known-unsafe.json. That file is a ratchet: entries are
// deleted as the parser lanes fix them, and KNOWN_UNSAFE_CEILING below keeps
// anyone from silencing a new unsafe case by appending it. The file also
// records the gate sample's hash: editing the generator changes the sample,
// and the list must then be re-derived and re-reviewed, not reused.
//
// Requires scripts/test/build (bash scripts/test/build.sh), which run.sh
// builds before the repair suites.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const LAB = path.join(__dirname, '..', '..', 'alert-lab');
const REPO = path.resolve(__dirname, '..', '..', '..');
const { runGate, runDriftGate, GATE, DRIFT_GATE, loadKnown } = require(path.join(LAB, 'gate.cjs'));
const { generate, splitManifest, FAMILIES } = require(path.join(LAB, 'generate.cjs'));
const { createDriver } = require(path.join(LAB, 'lab-eval.cjs'));
const { adversarialRows } = require(path.join(LAB, 'lib', 'adversarial.cjs'));
const { MARKETS } = require(path.join(LAB, 'inventory', 'markets.cjs'));

// Lower this when known-unsafe.json shrinks. Never raise it to admit a new case.
const KNOWN_UNSAFE_CEILING = 0;

test('alert lab: generation is deterministic and independent per market', () => {
  const both = generate({ split: 'dev', n: 1, seed: 'determinism', markets: ['DE', 'SA'], neg: 2, inv: 1 });
  const alone = generate({ split: 'dev', n: 1, seed: 'determinism', markets: ['SA'], neg: 2, inv: 1 });
  assert.deepEqual(both.filter((r) => r.market === 'SA'), alone);
  assert.deepEqual(generate({ split: 'holdout', n: 1, seed: 's', markets: ['US'] }), generate({ split: 'holdout', n: 1, seed: 's', markets: ['US'] }));
});

test('alert lab: DEV and HOLDOUT draw disjoint vocabulary, every market and family in both', () => {
  const manifest = splitManifest();
  const devOnly = new Set();
  for (const [group, sides] of Object.entries(manifest)) {
    const dev = new Set(sides.dev);
    assert.deepEqual(sides.holdout.filter((id) => dev.has(id)), [], `${group} has ids in both halves`);
    for (const id of sides.dev) devOnly.add(id);
  }
  for (const split of ['dev', 'holdout']) {
    const rows = generate({ split, n: 1, seed: 'coverage', neg: 1, inv: 1 });
    const positives = rows.filter((r) => r.kind === 'positive');
    assert.equal(positives.length, MARKETS.length * FAMILIES.length, `${split} positives`);
    assert.ok(rows.every((r) => !r.leaks), `${split} rows borrowed vocabulary across the split`);
    if (split === 'holdout') {
      const ids = (slots) => Object.values(slots).flat().filter((v) => typeof v === 'string');
      const leaked = rows.flatMap((r) => ids(r.slots)).filter((id) => devOnly.has(id));
      assert.deepEqual([...new Set(leaked)], [], 'holdout rows used DEV-only items');
    }
    for (const r of positives) {
      assert.ok(Number.isSafeInteger(r.label.amountMinor) && r.label.amountMinor > 0, r.id);
      assert.match(r.label.currency, /^[A-Z]{3}$/, r.id);
    }
  }
});

test('alert lab: registered Gulf senders route to their launch market, fictional banks do not', () => {
  const driver = createDriver(REPO);
  for (const market of MARKETS) {
    for (const bank of market.banks) {
      for (const sender of bank.senders) {
        if (bank.registered) assert.equal(driver.launchRoute(sender), bank.registered, `${bank.name} sender ${sender}`);
        if (bank.fictional) assert.equal(driver.launchRoute(sender), null, `${bank.name} sender ${sender}`);
      }
    }
  }
});

test('alert lab gate: no new WRONG or FALSE-POST on the fixed DEV sample', (t) => {
  const gate = runGate(REPO);
  const known = loadKnown();
  assert.equal(gate.sampleHash, gate.recordedHash,
    'the gate sample changed (an alert-lab inventory or the generator was edited): re-derive known-unsafe.json with `node scripts/alert-lab/run.cjs --gate`, review every case, and record the new sampleHash');
  assert.equal(known.length, KNOWN_UNSAFE_CEILING, `known-unsafe.json has ${known.length} cases but the ratchet is ${KNOWN_UNSAFE_CEILING}; delete fixed cases and lower the ceiling together, never add cases`);
  for (const c of gate.fixed) t.diagnostic(`now safe, delete from known-unsafe.json and lower the ceiling: ${c.key}`);
  const describe = (u) => `${u.verdict} ${u.path} ${u.id} (${u.negType ?? u.invType ?? u.family}): ${u.detail}\n    [${u.sender}] ${JSON.stringify(u.body)}`;
  assert.equal(gate.newUnsafe.length, 0,
    `${gate.newUnsafe.length} new unsafe case(s) in the alert-lab gate (GATE ${JSON.stringify(GATE)}):\n${gate.newUnsafe.map(describe).join('\n')}`);
  assert.ok(gate.report.cases > 1500, 'gate sample unexpectedly small');
});

// Long inputs must stay cheap: a phone scans thousands of messages. These
// 4 KB / 8 KB bodies parse in tens of milliseconds on origin/main; the budget
// is generous for a loaded CI machine but catches the quadratic and worse
// regex scans the round-1 english review found (7.7 s for 4000 digits).
// Known-slow shapes that already time out on origin/main (a long whitespace
// run in a Gulf alert, `adv:spaces-*`) are reported by run.cjs, not gated.
test('alert lab: adversarial long bodies parse within budget on both paths', () => {
  const driver = createDriver(REPO);
  const gated = adversarialRows().filter((r) => /^adv:(digits|grouped|repeat|merchant)-(4|8)k$/.test(r.id));
  assert.ok(gated.length >= 8);
  for (const row of gated) {
    for (const p of ['android-sms', 'ios-history']) {
      const t0 = process.hrtime.bigint();
      driver.run(row, p);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      assert.ok(ms < 2500, `${row.id} on ${p} took ${ms.toFixed(0)} ms (${Buffer.byteLength(row.body)} bytes)`);
    }
  }
});

// Template drift (scripts/alert-lab/drift.cjs): label-preserving rewordings,
// re-orderings, restyles and noise of alerts the parser already books. Losing
// a booking is reported by run.cjs --drift (survival); booking WRONG money
// because an alert drifted is never acceptable.
test('alert lab drift: no drift variant of a correctly-booked alert books wrong money', () => {
  const rep = runDriftGate(REPO);
  assert.ok(rep.variants > 100, `drift sample unexpectedly small (${rep.variants})`);
  const describe = (w) => `${w.path} ${w.id} [${w.ops.join('+')}]: ${w.detail}\n    ${JSON.stringify(w.before)}\n -> ${JSON.stringify(w.after)}`;
  assert.equal(rep.wrong.length, 0, `${rep.wrong.length} drift variant(s) booked wrong money (DRIFT_GATE ${JSON.stringify(DRIFT_GATE)}):\n${rep.wrong.map(describe).join('\n')}`);
});
