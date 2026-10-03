// Turns one or two e2e-large-text.mjs JSON results into the Markdown
// surface × scale failure map used in docs/design/2026-09-25-large-text-audit.md.
//
//   node scripts/e2e/large-text-map.mjs before.json [after.json]
import { readFileSync } from 'node:fs';

const [beforePath, afterPath] = process.argv.slice(2);
// A path may list several result files joined by '+': later files replace the
// states they re-ran (e.g. after a harness error).
const load = (p) => {
  if (!p) return null;
  const merged = new Map();
  for (const file of p.split('+')) {
    for (const r of JSON.parse(readFileSync(file, 'utf8'))) merged.set(`${r.surface}|${r.language}|${r.viewport}|${r.scale}`, r);
  }
  return [...merged.values()];
};
const before = load(beforePath);
const after = load(afterPath);

// Harness errors (a navigation that timed out) are not layout failures; they
// are listed separately and those states re-run.
const hard = (r) => r.failures.filter((f) => f.kind !== 'truncated' && f.kind !== 'error').length;
const scales = [...new Set(before.map((r) => r.scale))].sort((a, b) => a - b);
const surfaces = [...new Set(before.map((r) => r.surface))];
// One cell sums both languages and both viewports.
const cell = (rows, surface, scale) => rows
  .filter((r) => r.surface === surface && r.scale === scale)
  .reduce((n, r) => n + hard(r), 0);

const header = `| Surface | ${scales.map((s) => `${s}x`).join(' | ')} |`;
console.log(header);
console.log(`|---|${scales.map(() => '---').join('|')}|`);
for (const surface of surfaces) {
  const cells = scales.map((scale) => {
    const b = cell(before, surface, scale);
    if (!after) return String(b);
    const a = cell(after, surface, scale);
    return `${b} → ${a}`;
  });
  console.log(`| ${surface} | ${cells.join(' | ')} |`);
}
const totals = scales.map((scale) => {
  const b = before.filter((r) => r.scale === scale).reduce((n, r) => n + hard(r), 0);
  if (!after) return `**${b}**`;
  const a = after.filter((r) => r.scale === scale).reduce((n, r) => n + hard(r), 0);
  return `**${b} → ${a}**`;
});
console.log(`| **Total** | ${totals.join(' | ')} |`);

const kinds = (rows) => rows.flatMap((r) => r.failures).reduce((m, f) => {
  if (f.kind !== 'truncated' && f.kind !== 'error') m[f.kind] = (m[f.kind] ?? 0) + 1;
  return m;
}, {});
const errored = (rows) => rows.filter((r) => r.failures.some((f) => f.kind === 'error')).length;
console.log(`\nHarness errors: before ${errored(before)}${after ? `, after ${errored(after)}` : ''}`);
console.log(`\nBy kind (before): ${JSON.stringify(kinds(before))}`);
if (after) console.log(`By kind (after): ${JSON.stringify(kinds(after))}`);

// DETAIL=1: every distinct failure with the states it appears in.
if (process.env.DETAIL === '1') {
  const rows = after ?? before;
  const seen = new Map();
  for (const r of rows) for (const f of r.failures) {
    if (f.kind === 'truncated' || f.kind === 'error') continue;
    const key = `${r.surface} | ${f.kind} | ${f.text.slice(0, 60)} | ${f.detail.split(' ')[0]}`;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(`${r.language}${r.viewport.slice(0, 3)}@${r.scale}`);
  }
  console.log('');
  for (const [key, where] of [...seen].sort()) console.log(`${key} :: ${where.join(',')}`);
}
