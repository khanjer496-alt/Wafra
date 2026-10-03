'use strict';
/**
 * Held-out REAL evaluation set: bank/wallet alert bodies published verbatim on
 * public web pages, redacted, with hand-assigned TRUE labels (schema.cjs).
 *
 * Two inputs, same row shape:
 *  - committed:  scripts/test/fixtures/public-real-samples.js (official bank /
 *                government pages and permissively licensed sources only);
 *  - local-only: an optional JSON array at $PARSER_AI_PUBLIC_LOCAL holding
 *                samples whose source has no redistribution licence. It is
 *                never committed; rows are tagged `origin: 'local-only'`.
 *
 * Evaluation only — never feed these rows to training, synthesis templates or
 * rule tuning, or they stop measuring generalisation.
 *
 *   PARSER_AI_PUBLIC_LOCAL=/path/public-local-only.json \
 *     node scripts/parser-ai/public-real-eval-set.cjs      # row counts only
 */
const fs = require('node:fs');
const path = require('node:path');
const { COUNTRY_CURRENCY, STATUSES, FAMILIES, DIRECTIONS } = require('./schema.cjs');

const root = path.resolve(__dirname, '../..');
const SAMPLES = 'scripts/test/fixtures/public-real-samples.js';

function validate(r, origin) {
  const L = r.label;
  const where = `public-real ${origin} ${r.id}`;
  if (!(r.country in COUNTRY_CURRENCY)) throw new Error(`${where}: no currency for ${r.country}`);
  if (!STATUSES.includes(L.status)) throw new Error(`${where}: bad status ${L.status}`);
  if (!FAMILIES.includes(L.family)) throw new Error(`${where}: bad family ${L.family}`);
  if (!DIRECTIONS.includes(L.direction)) throw new Error(`${where}: bad direction ${L.direction}`);
  if (L.shouldPost && (L.status !== 'completed' || L.family === 'non-posting' || L.direction === 'none')) {
    throw new Error(`${where}: a posting row must be a completed debit/credit movement`);
  }
  if (!L.shouldPost && (L.family !== 'non-posting' || L.direction !== 'none')) {
    throw new Error(`${where}: non-posting row must be family non-posting, direction none`);
  }
  if (L.amount && (!/^\d+$/.test(L.amount.minor) || !/^[A-Z]{3}$/.test(L.amount.currency))) {
    throw new Error(`${where}: bad amount`);
  }
  if (L.date && !/^\d{4}-\d{2}-\d{2}$/.test(L.date)) throw new Error(`${where}: bad date ${L.date}`);
  if (!/^https?:\/\//.test(r.url) || !/^\d{4}-\d{2}-\d{2}$/.test(r.retrieved ?? '')) {
    throw new Error(`${where}: missing provenance`);
  }
}

function toRow(s, origin) {
  validate(s, origin);
  const index = /-(\d+)$/.exec(s.id)?.[1] ?? s.id;
  return {
    id: `public-real:${s.id}`, source: 'public-real', origin, country: s.country, language: s.language,
    bank: s.bank ?? null, sender: s.sender ?? '', template: `public:${s.country}:${index}`, split: 'eval',
    url: s.url, retrieved: s.retrieved, ...(s.note ? { note: s.note } : {}), ...(s.title ? { title: s.title } : {}),
    body: s.body, label: { ...s.label },
  };
}

/**
 * @param {{ localPath?: string|null }} [options] local-only JSON path; defaults
 *   to $PARSER_AI_PUBLIC_LOCAL. A missing file is skipped silently.
 */
function buildPublicRealEvalSet({ localPath = process.env.PARSER_AI_PUBLIC_LOCAL ?? null } = {}) {
  const rows = require(path.join(root, SAMPLES)).map((s) => toRow(s, 'committed'));
  if (localPath && fs.existsSync(localPath)) {
    for (const s of JSON.parse(fs.readFileSync(localPath, 'utf8'))) rows.push(toRow(s, 'local-only'));
  }
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.id)) throw new Error(`public-real: duplicate id ${r.id}`);
    seen.add(r.id);
  }
  return rows;
}

module.exports = { buildPublicRealEvalSet };

if (require.main === module) {
  const rows = buildPublicRealEvalSet();
  const by = {};
  for (const r of rows) {
    const k = `${r.origin} ${r.country}`;
    by[k] = (by[k] ?? 0) + 1;
  }
  console.log(rows.length, by);
}
