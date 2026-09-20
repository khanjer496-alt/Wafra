'use strict';
/**
 * Export Wafra's bank-alert fixture corpora to JSON for the amount-role
 * safety benchmark.
 *
 * These rows are privacy-safe near-real templates and standard-derived
 * reconstructions, NOT consented customer evidence -- see
 * scripts/test/fixtures/README.md.  They are used here only to exercise
 * deterministic amount/currency extraction and amount-role selection against
 * balance / limit / statement / minimum-due decoys.  They are never used to
 * train or tune the semantic model.
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');

const sources = [
  ['global-alert-formats', require(path.join(ROOT, 'scripts/test/fixtures/global-alert-formats'))],
  ['uae-bank-formats', require(path.join(ROOT, 'scripts/test/fixtures/uae-bank-formats'))],
  ['saudi-bank-formats', require(path.join(ROOT, 'scripts/test/fixtures/saudi-bank-formats'))],
];

const rows = [];
for (const [corpus, mod] of sources) {
  const list = Array.isArray(mod) ? mod : Object.values(mod).filter((v) => v && v.body);
  for (const r of list) {
    if (!r || typeof r.body !== 'string') continue;
    const e = r.expected || {};
    const x = r.expect || {};
    const expected = {
      decision: e.decision ?? null,
      status: e.status ?? (x.kind === 'transaction' ? 'posted' : null),
      family: e.family ?? null,
      direction: e.direction ?? (x.type === 'income' ? 'credit' : x.type === 'expense' ? 'debit' : null),
      currency: e.currency ?? x.currency ?? null,
      minorUnits: e.minorUnits != null ? String(e.minorUnits)
        : x.amountFils != null ? String(x.amountFils) : null,
      decoyMinorUnits: x.snapshotFils != null ? String(x.snapshotFils) : null,
      decoyKind: x.snapshotKind ?? null,
    };
    rows.push({
      corpus,
      id: r.id,
      market: r.market || null,
      institution: r.institution || r.bank || null,
      provenance: r.provenance || r.evidence || null,
      basis: r.basis || null,
      body: r.body,
      expected,
    });
  }
}

process.stdout.write(JSON.stringify({ generated: new Date().toISOString(), count: rows.length, rows }, null, 2));
