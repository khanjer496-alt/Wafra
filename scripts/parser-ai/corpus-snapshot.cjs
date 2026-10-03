'use strict';
/**
 * Snapshot the current pipeline's decision for every row of the given JSONL
 * sets, so two checkouts can be diffed (flags OFF must be identical).
 * Writes {id: digest} plus a readable decision WITHOUT message text.
 *
 *   node scripts/parser-ai/corpus-snapshot.cjs <out.json> <rows.jsonl>...
 *   node scripts/parser-ai/corpus-snapshot.cjs --diff <a.json> <b.json>
 */
const fs = require('node:fs');
const crypto = require('node:crypto');

function snapshot(out, files) {
  const { runLedger, runExtraction } = require('./pipeline.cjs');
  const snap = {};
  for (const file of files) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      const ledger = runLedger(row);
      const { event: _event, ...extraction } = runExtraction(row);
      const decision = { ledger, extraction };
      snap[row.id] = { d: crypto.createHash('sha256').update(JSON.stringify(decision)).digest('hex').slice(0, 16),
        posted: ledger.posted, category: ledger.category ?? null };
    }
  }
  fs.writeFileSync(out, JSON.stringify(snap));
  console.log(JSON.stringify({ rows: Object.keys(snap).length, posted: Object.values(snap).filter((s) => s.posted).length }));
}

function diff(a, b) {
  const A = JSON.parse(fs.readFileSync(a, 'utf8'));
  const B = JSON.parse(fs.readFileSync(b, 'utf8'));
  const out = { rows: 0, identical: 0, changed: 0, postedChanged: 0, categoryOnly: 0, categoryChanges: {}, missing: 0 };
  for (const [id, x] of Object.entries(A)) {
    const y = B[id];
    out.rows++;
    if (!y) { out.missing++; continue; }
    if (x.d === y.d) { out.identical++; continue; }
    out.changed++;
    if (x.posted !== y.posted) out.postedChanged++;
    else if (x.category !== y.category) {
      out.categoryOnly++;
      const k = `${x.category}->${y.category}`;
      out.categoryChanges[k] = (out.categoryChanges[k] ?? 0) + 1;
    }
  }
  console.log(JSON.stringify(out));
}

const args = process.argv.slice(2);
if (args[0] === '--diff') diff(args[1], args[2]);
else snapshot(args[0], args.slice(1));
