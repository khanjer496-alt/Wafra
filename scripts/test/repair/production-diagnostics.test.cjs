'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const ts = require('typescript');
const { createWorkflowHarness, walk } = require('../workflows/workflow-harness.cjs');
const root = path.resolve(__dirname, '../../..');

test('customer Data and help keeps normal exports but has no diagnostic collection controls', () => {
  const h = createWorkflowHarness({ platform: 'android', state: { hydrated: true } });
  for (const [name, key] of [['diagnostic-export-control', 'DiagnosticExportControl'], ['tester-diagnostics-control', 'TesterDiagnosticsControl']]) {
    h.deps[`@/components/${name}`] = { [key]: () => h.jsx('forbidden-diagnostic-control', {}) };
  }
  const tree = h.renderScreen('settings-data');
  assert.equal(walk(tree).some(node => node.type === 'forbidden-diagnostic-control'), false);
  const source = fs.readFileSync(path.join(root, 'src/app/settings-data.tsx'), 'utf8');
  assert.doesNotMatch(source, /DiagnosticExportControl|TesterDiagnosticsControl/);
  for (const action of ['exportCsv', 'backupJson', 'restoreFromFile']) assert.ok(source.includes(action));
});

test('release diagnostic upload entry point rejects before reading the payload or opening a socket', async () => {
  let calls = 0;
  const transport = load(path.join(root, 'src/lib/feedback-transport.ts'), {
    '@/lib/feedback': { setFeedbackTransport() {} },
    '@/lib/feedback-wire': { FEEDBACK_DIAGNOSTIC_MAX_BYTES: 24000, serializeFeedbackWire() { throw Error('not expected'); } },
    '@/lib/relay': { DEFAULT_RELAY_URL: 'https://relay.invalid' },
  }, { __DEV__: false, TextEncoder, AbortController, fetch: async () => { calls++; throw Error('network called'); } });
  const wire = { get diagnostic() { throw Error('payload read'); } };
  await assert.rejects(transport.submitTesterDiagnostics(wire), error => error.code === 'disabled');
  assert.equal(calls, 0);
});

test('release research transport refuses reports before reading or transmitting their contents', async () => {
  let calls = 0;
  const transport = load(path.join(root, 'src/lib/feedback-transport.ts'), {
    '@/lib/feedback': { setFeedbackTransport() {} },
    '@/lib/feedback-wire': { FEEDBACK_DIAGNOSTIC_MAX_BYTES: 24000 },
    '@/lib/relay': { DEFAULT_RELAY_URL: 'https://relay.invalid' },
  }, { __DEV__: false, TextEncoder, AbortController, process: { env: {} },
    fetch: async () => { calls++; throw Error('network called'); } });
  await assert.rejects(transport.submitParserResearchFeedback({ get diagnostic() { throw Error('payload read'); } }),
    error => error.code === 'disabled');
  assert.equal(calls, 0);
});

test('a diagnostic environment flag cannot expose launch exports in a release build', () => {
  const api = load(path.join(root, 'src/lib/launch-performance.ts'), {}, {
    __DEV__: false, process: { env: { EXPO_PUBLIC_WAFRA_INTERNAL_DIAGNOSTICS: '1' } },
  });
  assert.equal(api.isInternalLaunchDiagnosticsEnabled(), false);
});

test('disabled research deep links redirect without exposing the research UI', () => {
  const filename = path.join(root, 'src/app/parser-research.tsx');
  const h = createWorkflowHarness({ platform: 'android' });
  const ast = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  const unused = new Proxy(function forbiddenResearchWork() { throw Error('research dependency executed'); }, {
    get(_target, key) { return key === '__esModule' ? true : unused; },
  });
  for (const node of ast.statements.filter(ts.isImportDeclaration)) {
    if (!Object.hasOwn(h.deps, node.moduleSpecifier.text)) h.deps[node.moduleSpecifier.text] = unused;
  }
  h.deps['@/lib/store'] = { useStore() { throw Error('private state accessed by a disabled route'); } };
  h.deps['@/lib/parser-research-source'] = { isParserResearchBuild: () => false };
  const api = load(filename, h.deps, { __DEV__: false });
  const tree = api.default();
  assert.equal(tree.type, 'Redirect');
  assert.equal(tree.props.href, '/settings-data');
});
