'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { createRequire } = require('node:module');
const { performance } = require('node:perf_hooks');
const { patchQueryString } = require('../../patch-react-native-screens.cjs');
const project = path.resolve(process.env.WAFRA_URI_TEST_ROOT ?? path.join(__dirname, '../../..'));

function query() {
  const manifest = JSON.parse(fs.readFileSync(path.join(project, 'node_modules/decode-uri-component/package.json'), 'utf8'));
  assert.equal(manifest.version, '0.5.1', 'execute malformed input only against the pinned security fix');
  patchQueryString(project);
  return createRequire(path.join(project, 'package.json'))('query-string');
}

test('the SDK55 query parser accepts the patched ESM decoder and preserves normal URL values', () => {
  const api = query();
  assert.deepEqual({ ...api.parse('name=caf%C3%A9&space=one+two&percent=100%25&id=a&id=b') },
    { name: 'café', space: 'one two', percent: '100%', id: ['a', 'b'] });
  assert.equal(api.parseUrl('wafra://pro?message=%D9%88%D9%81%D8%B1%D8%A9').query.message, 'وفرة');
});

test('malformed percent sequences are bounded without losing the rest of the query', () => {
  const api = query();
  let payload = '';
  for (let i = 0; i < 4000; i++) payload += `%${Math.floor(i / 256).toString(16).padStart(2, '0')}%${(i % 256).toString(16).padStart(2, '0')}x`;
  const started = performance.now();
  const result = api.parse(`data=${payload}%zz&safe=ok`);
  assert.equal(result.safe, 'ok');
  assert.equal(typeof result.data, 'string');
  assert.ok(performance.now() - started < 2000, 'patched decoding remains responsive');
});

test('dependency interop patch is idempotent', () => {
  query();
  assert.equal(patchQueryString(project).changed, false);
});

test('compatibility patch refuses shared dependency folders', t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-uri-link-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  fs.symlinkSync(path.join(project, 'node_modules'), path.join(temporary, 'node_modules'), 'dir');
  assert.throws(() => patchQueryString(temporary), /shared node_modules/);
});

test('unknown dependency contents fail before any file is rewritten', t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-uri-unknown-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  for (const [name, version] of [['query-string', '7.1.3'], ['decode-uri-component', '0.5.1']]) {
    const folder = path.join(temporary, 'node_modules', name);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name, version }));
  }
  const file = path.join(temporary, 'node_modules/query-string/index.js');
  fs.writeFileSync(file, 'unrecognized source');
  assert.throws(() => patchQueryString(temporary), /Unrecognized query-string/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'unrecognized source');
});
