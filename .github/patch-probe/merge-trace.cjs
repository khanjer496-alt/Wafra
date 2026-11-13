'use strict';
// Merge the per-process trace files into one sorted JSONL: [fn, body, sender, [shapes...]] per line.
const fs = require('node:fs');
const path = require('node:path');
const [dir, out] = process.argv.slice(2);
const merged = new Map();
let files = 0;
for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
  if (!name.endsWith('.jsonl')) continue;
  files++;
  for (const line of fs.readFileSync(path.join(dir, name), 'utf8').split('\n')) {
    if (!line) continue;
    const [fn, body, sender, shapes] = JSON.parse(line);
    const key = JSON.stringify([fn, body, sender]);
    if (!merged.has(key)) merged.set(key, new Set());
    for (const s of shapes) merged.get(key).add(s);
  }
}
const keys = [...merged.keys()].sort();
fs.writeFileSync(out, keys.map((k) => JSON.stringify([...JSON.parse(k), [...merged.get(k)].sort()])).join('\n') + '\n');
const byFn = {};
for (const k of keys) { const fn = JSON.parse(k)[0]; byFn[fn] = (byFn[fn] || 0) + 1; }
console.log(JSON.stringify({ files, keys: keys.length, byFn }));
