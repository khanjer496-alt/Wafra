'use strict';
/**
 * The alert-lab safety gate: one fixed, small, DEV-split sample graded on
 * both capture paths. Shared by scripts/test/repair/alert-lab.test.cjs and
 * `node scripts/alert-lab/run.cjs --gate`, so the ratchet file is always
 * compared against exactly the sample the test runs.
 *
 * known-unsafe.json is a ratchet: every WRONG / FALSE-POST / ERROR case in
 * this sample must be listed there (by content key), the list may only
 * shrink, and its length must equal KNOWN_UNSAFE_CEILING in the test. A
 * listed case that is now safe is reported as "fixed" so its entry can be
 * deleted (and the ceiling lowered with it). The file also records the
 * sample's hash, so a generator edit forces a fresh, reviewed list.
 */
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { generate } = require('./generate.cjs');
const { createDriver, evaluateRows } = require('./lab-eval.cjs');

const GATE = Object.freeze({ split: 'dev', n: 1, seed: 'alert-lab-gate-v1', neg: 3, inv: 1 });
const KNOWN_FILE = path.join(__dirname, 'known-unsafe.json');

function loadKnown() {
  const data = JSON.parse(fs.readFileSync(KNOWN_FILE, 'utf8'));
  return data.cases ?? [];
}

/**
 * Fingerprint of the whole gate sample. Editing any inventory changes which
 * alerts the gate generates; the test then requires known-unsafe.json to be
 * re-derived and re-reviewed (its `sampleHash`), instead of silently
 * comparing a new sample against an old list.
 */
const sampleHash = (rows) => createHash('sha256').update(rows.map((r) => `${r.id}\u0000${r.sender}\u0000${r.body}`).join('\u0001')).digest('hex').slice(0, 16);
const loadRecordedHash = () => JSON.parse(fs.readFileSync(KNOWN_FILE, 'utf8')).sampleHash ?? null;

function runGate(repo = path.resolve(__dirname, '..', '..')) {
  const driver = createDriver(repo);
  const rows = generate(GATE);
  const report = evaluateRows(driver, rows, { androidReview: false });
  const known = loadKnown();
  const knownKeys = new Set(known.map((c) => c.key));
  const unsafeKeys = new Set(report.unsafe.map((u) => u.key));
  return {
    rows, report, known, sampleHash: sampleHash(rows), recordedHash: loadRecordedHash(),
    newUnsafe: report.unsafe.filter((u) => !knownKeys.has(u.key)),
    fixed: known.filter((c) => !unsafeKeys.has(c.key)),
  };
}

/**
 * Drift gate: K drift variants of every correctly-booked positive in a fixed
 * DEV sample. Survival is reported, not gated; any variant that books WRONG
 * money fails the test.
 */
const DRIFT_GATE = Object.freeze({ split: 'dev', n: 1, seed: 'alert-lab-drift-gate-v1', K: 4 });
function runDriftGate(repo = path.resolve(__dirname, '..', '..')) {
  const { evaluateDrift } = require('./drift.cjs');
  const driver = createDriver(repo);
  const positives = generate({ split: DRIFT_GATE.split, n: DRIFT_GATE.n, seed: DRIFT_GATE.seed, neg: 0, inv: 0 });
  return evaluateDrift(driver, positives, { K: DRIFT_GATE.K, seed: `${DRIFT_GATE.seed}:drift` });
}

module.exports = { GATE, DRIFT_GATE, KNOWN_FILE, runGate, runDriftGate, loadKnown, sampleHash };
