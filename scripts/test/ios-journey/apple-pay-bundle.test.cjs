const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('Apple Pay bundle pins the exact signed six-action candidate and verified graph', async () => {
  const { buildApplePayShortcut, verifyApplePayShortcutGraph } = await import(pathToFileURL(path.join(root, 'scripts/build-ios-apple-pay-shortcut.mjs')));
  const graph = buildApplePayShortcut();
  assert.equal(verifyApplePayShortcutGraph(graph), true);
  assert.equal(graph.WFWorkflowName, 'Wafra Apple Pay v1');
  assert.equal(graph.WFWorkflowActions.length, 6);
  assert.equal(hash(Buffer.from(JSON.stringify(graph, null, 2) + '\n')), '21fccb5a72188f04419a9e4093cdd63b0514b2b59575a0b777c7539d648d4662');
  const bytes = fs.readFileSync(path.join(root, 'modules/wafra-live-capture/ios/Resources/Wafra Apple Pay v1.shortcut'));
  assert.equal(bytes.length, 22481);
  assert.equal(bytes.subarray(0, 4).toString(), 'AEA1');
  assert.equal(hash(bytes), '130368a18c06a73a782c6a9d6cc80936a5cc3c73636e97abb3bc76ed5c5e67e1');
});
