'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../../..');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const candidates = [
  { name: 'Wafra Capture v3', generator: 'scripts/build-ios-local-capture-shortcut.mjs',
    build: 'buildLocalCaptureV3Shortcut', verify: 'verifyLocalCaptureV3ShortcutGraph', actions: 37,
    graphHash: '6f4b452223de37c2e7858c99d4a19b4b0155c19b5172ca2341ea43863682e655',
    bytes: 25672, signedHash: 'e3d04e986a0d14a1ffd510c6ad6257fbe907496cd7c160716ddf0ba5c45a1f76' },
  { name: 'Wafra History v8', generator: 'scripts/build-ios-paged-history-shortcut.mjs',
    build: 'buildRecoveryHistoryShortcut', verify: 'verifyRecoveryHistoryShortcut', actions: 207,
    graphHash: 'eb959ecfd89e22820647fe81ed584b4d26a16d0df395dc5be4e38dfd0d2cb63e',
    bytes: 47954, signedHash: '48474dc34cdc337718638320e06675b65a11fdc6ea09aefab05c0f6b82c50fd0' },
];

for (const candidate of candidates) {
  test(`${candidate.name} bundles the exact signed candidate with its verified source graph`, async () => {
    const generator = await import(pathToFileURL(path.join(root, candidate.generator)));
    const graph = generator[candidate.build]();
    assert.equal(generator[candidate.verify](graph), true);
    assert.equal(graph.WFWorkflowName, candidate.name);
    assert.equal(graph.WFWorkflowActions.length, candidate.actions);
    assert.equal(hash(Buffer.from(JSON.stringify(graph, null, 2) + '\n')), candidate.graphHash,
      'Changing the source graph requires reviewing and signing a matching new asset');
    const bytes = fs.readFileSync(path.join(root, `modules/wafra-live-capture/ios/Resources/${candidate.name}.shortcut`));
    assert.equal(bytes.length, candidate.bytes);
    assert.equal(bytes.subarray(0, 4).toString(), 'AEA1');
    assert.equal(hash(bytes), candidate.signedHash);
  });
}

test('the local module packages both trusted Shortcut assets with its existing resource bundle', () => {
  const podspec = fs.readFileSync(path.join(root, 'modules/wafra-live-capture/ios/WafraLiveCapture.podspec'), 'utf8');
  assert.match(podspec, /s\.resource_bundles\s*=\s*\{\s*['"]WafraLiveCaptureResources['"]\s*=>\s*\[['"]Resources\/\*\*\/\*['"]\]/);
});
