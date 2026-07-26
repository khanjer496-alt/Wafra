// Runs a corpus file (the "#N (seen Nx, read as ...)" export the app produces)
// through the parser and prints what each message currently resolves to.
const fs = require('fs');
const { parseSms } = require('./build/sms-parser');

const text = fs.readFileSync(process.argv[2], 'utf8');
const blocks = [];
let cur = null;
for (const line of text.split('\n')) {
  const head = line.match(/^#(\d+)\s+\(seen[^)]*\):\s*$/);
  if (head) {
    if (cur) blocks.push(cur);
    cur = { n: Number(head[1]), lines: [] };
    continue;
  }
  if (cur) cur.lines.push(line);
}
if (cur) blocks.push(cur);

const only = process.argv[3] ? new Set(process.argv[3].split(',').map(Number)) : null;
for (const b of blocks) {
  if (only && !only.has(b.n)) continue;
  const msg = b.lines.join('\n').replace(/\n{2,}[\s\S]*$/, '').trim();
  if (!msg) continue;
  const p = parseSms(msg);
  const out = p
    ? `${p.kind}/${p.type} ${(p.amountFils / 100).toFixed(2)} | "${p.merchant}" | ${p.categoryGuess}${p.transferHint ? ' | TRANSFER' : ''} | ${p.date ?? '-'}`
    : 'SKIPPED';
  console.log(`#${String(b.n).padStart(3)} ${out}`);
}
