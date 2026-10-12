// Worldwide bank-alert coverage, measured through the shipping capture paths.
//
// scripts/universal-launch-eval/evaluate.cjs drives LaunchAlertSession the way
// Android SMS capture and the iPhone History import do, for alerts outside the
// UAE/Saudi launch grammar. This suite turns its measurements into a gate:
//
//  - corpus/ and holdout/ rows may MISS (the alert waits in Review), but none
//    may be booked when it should not be, and none may be booked with the
//    wrong amount, currency or direction. Recall may not fall below the
//    recorded floor.
//  - regressions/ rows pin individual fixes and their negative controls:
//    every one must give exactly the expected outcome.
//
// The rows are synthetic text modelled on each bank's published or commonly
// reported format, with fictional values. They are not consented real alerts
// and never count toward the automatic-import gates in
// docs/universal-parser-rollout.md.
const fs = require('node:fs');
const path = require('node:path');
const { evaluateRows, loadCorpus } = require('../universal-launch-eval/evaluate.cjs');

let pass = 0;
let fail = 0;
function ok(name, condition, detail) {
  if (condition) { pass += 1; console.log(`✓ ${name}`); }
  else { fail += 1; console.log(`✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail)); }
}

const ROOT = path.join(__dirname, '..', 'universal-launch-eval');
const filesIn = (dir) => fs.existsSync(path.join(ROOT, dir))
  ? fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(ROOT, dir, f))
  : [];
const floors = JSON.parse(fs.readFileSync(path.join(ROOT, 'floors.json'), 'utf8'));

const unsafe = (results) => results.filter((r) => r.verdict === 'false-post' || r.verdict === 'wrong' || r.verdict === 'error');
const brief = (r) => ({ id: r.id, path: r.path, verdict: r.verdict, detail: r.detail, parsed: r.parsed });

for (const set of ['corpus', 'holdout']) {
  const files = filesIn(set);
  if (!files.length) continue;
  const rows = loadCorpus(files);
  const ids = rows.map((row) => row.id);
  ok(`${set}: row ids are unique`, new Set(ids).size === ids.length,
    ids.filter((id, i) => ids.indexOf(id) !== i));
  const { results, tally } = evaluateRows(rows);
  // A ratchet, not an allowance: floors.json names the rows the parser still
  // books wrongly. Anything else that is unsafe fails, and a listed row that
  // has been fixed must leave the list so it can never silently come back.
  const known = new Set(floors.knownUnsafe?.[set] ?? []);
  const bad = unsafe(results);
  const fresh = bad.filter((r) => !known.has(`${r.id}/${r.path}`));
  ok(`${set}: no alert is booked when it must not be, or with the wrong amount, currency or direction`,
    fresh.length === 0, fresh.slice(0, 20).map(brief));
  const stillBad = new Set(bad.map((r) => `${r.id}/${r.path}`));
  const fixed = [...known].filter((key) => !stillBad.has(key));
  ok(`${set}: every row listed as known-unsafe is still unsafe (remove fixed rows from floors.json)`,
    fixed.length === 0, fixed);
  for (const [name, t] of Object.entries(tally)) {
    const recall = t.positives ? t.posted / t.positives : 1;
    const floor = floors[set]?.[name];
    console.log(`  ${set}/${name}: posted ${t.posted}/${t.positives} (${(100 * recall).toFixed(1)}%), ` +
      `held ${t.held}/${t.negatives}, soft ${t.soft}`);
    if (typeof floor === 'number') {
      ok(`${set}/${name}: recall ${(100 * recall).toFixed(1)}% stays at or above the ${(100 * floor).toFixed(1)}% floor`,
        recall + 1e-9 >= floor, { posted: t.posted, positives: t.positives });
    }
  }
}

{
  const files = filesIn('regressions');
  const rows = loadCorpus(files);
  const ids = rows.map((row) => row.id);
  ok('regressions: row ids are unique', new Set(ids).size === ids.length,
    ids.filter((id, i) => ids.indexOf(id) !== i));
  const { results } = evaluateRows(rows);
  for (const r of results) {
    const row = rows.find((x) => x.id === r.id);
    const want = row.expect.post ? `books ${row.expect.amountMinor} ${row.ledger} ${row.expect.type ?? ''}`.trim() : 'is not booked';
    ok(`${r.id} [${r.path}] ${want}`, r.verdict === 'pass' && !(row.expect.merchant && r.soft?.startsWith('merchant')),
      brief(r));
  }
}

console.log(`\nuniversal-launch-coverage: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
