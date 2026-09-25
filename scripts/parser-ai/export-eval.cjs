'use strict';
/**
 * Write the eval sets as JSONL for the model probe (scratch only, never committed).
 *   node scripts/parser-ai/export-eval.cjs <outDir>
 */
const fs = require('node:fs');
const path = require('node:path');
const { buildRepoEvalSet } = require('./repo-eval-set.cjs');
const { generate } = require('./synth/generate.cjs');

const out = process.argv[2];
if (!out) throw new Error('usage: export-eval.cjs <outDir>');
fs.mkdirSync(out, { recursive: true });
const write = (name, rows) => fs.writeFileSync(path.join(out, name), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
write('repo.jsonl', buildRepoEvalSet());
const synth = generate();
for (const split of ['train', 'dev', 'test']) write(`${split}.jsonl`, synth.filter((r) => r.split === split));
console.log('ok');
