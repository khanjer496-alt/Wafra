import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { buildCapabilityRows, renderCapabilityMarkdown } = require('./parser-capabilities.cjs');
const uae = require('./test/fixtures/uae-bank-formats.js');
const saudi = require('./test/fixtures/saudi-bank-formats.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'docs/parser-capabilities.md');

await writeFile(target, renderCapabilityMarkdown(buildCapabilityRows([...uae, ...saudi])));
console.log(target);
