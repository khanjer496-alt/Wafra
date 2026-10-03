'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('web acceptance server supports bounded video seeks, suffixes and HEAD', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'wafra-video-range-'));
  const bytes = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');
  writeFileSync(path.join(directory, 'sample.mp4'), bytes);
  writeFileSync(path.join(directory, 'index.html'), '<p>preview</p>');
  const child = spawn(process.execPath, [path.resolve(__dirname, '../../e2e/serve.mjs'), directory, '0']);
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('preview server did not start')), 10000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.stdout.on('data', chunk => {
        const address = String(chunk).match(/http:\/\/localhost:\d+/)?.[0];
        if (address) { clearTimeout(timer); resolve(address); }
      });
    });
    const full = await fetch(`${base}/sample.mp4`);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('content-type'), 'video/mp4');
    assert.equal(full.headers.get('content-length'), String(bytes.length));
    assert.equal(full.headers.get('accept-ranges'), 'bytes');
    assert.deepEqual(Buffer.from(await full.arrayBuffer()), bytes);
    for (const [range, start, end] of [['bytes=0-7', 0, 7], ['bytes=8-', 8, 35], ['bytes=-5', 31, 35], ['bytes=0-999', 0, 35]]) {
      const response = await fetch(`${base}/sample.mp4`, { headers: { Range: range } });
      assert.equal(response.status, 206);
      assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/36`);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(start, end + 1));
    }
    for (const range of ['bytes=36-', 'bytes=7-2', 'bytes=-0', 'bytes=0-1,4-5']) {
      const response = await fetch(`${base}/sample.mp4`, { headers: { Range: range } });
      assert.equal(response.status, 416);
      assert.equal(response.headers.get('content-range'), 'bytes */36');
    }
    const head = await fetch(`${base}/sample.mp4`, { method: 'HEAD', headers: { Range: 'bytes=8-12' } });
    assert.equal(head.status, 206);
    assert.equal(head.headers.get('content-length'), '5');
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.equal(await (await fetch(base)).text(), '<p>preview</p>');
  } finally {
    child.kill(); rmSync(directory, { recursive: true, force: true });
  }
});
