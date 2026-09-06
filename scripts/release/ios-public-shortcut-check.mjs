import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { spawnSync } from 'node:child_process';
import { buildHistoryShortcut, verifyHistoryShortcutGraph } from '../build-ios-history-shortcut.mjs';
import { buildLocalCaptureShortcut, verifyLocalCaptureShortcutGraph } from '../build-ios-local-capture-shortcut.mjs';

// Public, read-only iCloud downloads. Never execute or install a Shortcut.
const out = 'ios-release-evidence';
mkdirSync(out, { recursive: true });
const checks = [
  { kind: 'history', id: '2869584d40ed454691cf3f916cbee158', build: buildHistoryShortcut, verify: verifyHistoryShortcutGraph },
  { kind: 'future', id: '96f93402213144e8885db33f48fc6168', build: buildLocalCaptureShortcut, verify: verifyLocalCaptureShortcutGraph },
];
const report = { sourceCommit: process.env.GITHUB_SHA, checkedAt: new Date().toISOString(), scope: 'public artifact equality only, not physical automation execution', results: [] };
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const decoder = 'import sys,plistlib,json\nx=plistlib.loads(sys.stdin.buffer.read())\nprint(json.dumps(x))\n';
for (const check of checks) {
  const expected = check.build();
  check.verify(expected);
  const item = { kind: check.kind, publicId: check.id, canonicalActions: expected.WFWorkflowActions.length, canonicalValid: true };
  report.results.push(item);
  try {
    const response = await fetch(`https://www.icloud.com/shortcuts/api/records/${check.id}`, { signal: AbortSignal.timeout(30000) });
    item.recordHttpStatus = response.status;
    if (!response.ok) throw new Error('public-record-unavailable');
    const record = await response.json();
    item.recordName = record.recordName;
    item.signingStatus = record.fields?.signingStatus?.value ?? null;
    const asset = record.fields?.shortcut?.value;
    const assetUrl = asset?.downloadURL;
    if (typeof assetUrl !== 'string') {
      item.availableFields = Object.keys(record.fields ?? {});
      throw new Error('unsigned-graph-download-missing');
    }
    const url = new URL(assetUrl);
    if (url.protocol !== 'https:' || !(url.hostname.endsWith('.icloud-content.com') || url.hostname.endsWith('.apple.com') || url.hostname.endsWith('.icloud.com'))) throw new Error('unexpected-asset-host');
    const download = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!download.ok) throw new Error('graph-download-failed');
    const declared = Number(download.headers.get('content-length') ?? 0);
    if (declared > 2000000) throw new Error('graph-too-large');
    const reader = download.body.getReader();
    const chunks = []; let size = 0;
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength;
      if (size > 2000000) { await reader.cancel(); throw new Error('graph-too-large'); } chunks.push(chunk.value); }
    const bytes = Buffer.concat(chunks);
    item.downloadSha256 = sha256(bytes);
    const decoded = spawnSync('python3', ['-c', decoder], { input: bytes, encoding: 'utf8', maxBuffer: 4000000 });
    if (decoded.status !== 0) throw new Error('unsigned-plist-decode-failed');
    const graph = JSON.parse(decoded.stdout);
    item.publishedActions = graph.WFWorkflowActions?.length;
    // Apple share metadata differs across client versions. Never normalize
    // action parameters, input classes, dataflow, URLs, or permission actions.
    const metadata = ['WFWorkflowName', 'WFWorkflowMinimumClientVersion', 'WFWorkflowMinimumClientVersionString', 'WFWorkflowClientVersion', 'WFQuickActionSurfaces'];
    const normalized = structuredClone(graph);
    item.shareMetadataDifferences = [];
    for (const key of metadata) {
      if (!isDeepStrictEqual(normalized[key], expected[key])) {
        item.shareMetadataDifferences.push(key);
        if (Object.hasOwn(expected, key)) normalized[key] = expected[key]; else delete normalized[key];
      }
    }
    item.actionsIdentical = isDeepStrictEqual(graph.WFWorkflowActions, expected.WFWorkflowActions);
    item.graphIdenticalAfterShareMetadata = isDeepStrictEqual(normalized, expected);
    item.otherDifferentTopLevelKeys = [...new Set([...Object.keys(normalized), ...Object.keys(expected)])].filter((key) => !isDeepStrictEqual(normalized[key], expected[key]));
    if (item.graphIdenticalAfterShareMetadata) { check.verify(normalized); item.publicValidation = 'passed'; }
    else item.publicValidation = 'mismatch';
  } catch (error) {
    const allowed = new Set(['public-record-unavailable', 'unsigned-graph-download-missing', 'unexpected-asset-host', 'graph-download-failed', 'graph-too-large', 'unsigned-plist-decode-failed']);
    item.publicValidation = 'not-verified'; item.failure = allowed.has(error.message) ? error.message : 'fetch-or-validation-failed';
  }
}
writeFileSync(`${out}/public-shortcuts.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (report.results.some((r) => r.publicValidation !== 'passed')) process.exitCode = 1;
