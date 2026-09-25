'use strict';
/**
 * The downloaded E5 encoder is OFF by default: nothing downloads or starts it
 * on install, launch, a question or a Review alert. Research builds opt in
 * with EXPO_PUBLIC_WAFRA_LOCAL_E5=1.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const flagsFile = path.join(root, 'src/lib/local-semantic-flags.ts');

test('the E5 flag is off unless the build explicitly sets EXPO_PUBLIC_WAFRA_LOCAL_E5=1', () => {
  assert.equal(load(flagsFile, {}, { process: { env: {} } }).LOCAL_SEMANTIC_E5_ENABLED, false);
  assert.equal(load(flagsFile, {}, { process: { env: { EXPO_PUBLIC_WAFRA_LOCAL_E5: '0' } } }).LOCAL_SEMANTIC_E5_ENABLED, false);
  assert.equal(load(flagsFile, {}, { process: { env: { EXPO_PUBLIC_WAFRA_LOCAL_E5: 'true' } } }).LOCAL_SEMANTIC_E5_ENABLED, false);
  assert.equal(load(flagsFile, {}, { process: { env: { EXPO_PUBLIC_WAFRA_LOCAL_E5: '1' } } }).LOCAL_SEMANTIC_E5_ENABLED, true);
  // Expo inlines EXPO_PUBLIC_* only for this literal member access.
  assert.match(fs.readFileSync(flagsFile, 'utf8'), /process\.env\.EXPO_PUBLIC_WAFRA_LOCAL_E5 === '1'/);
});

test('Ask never starts the E5 download when the flag is off, even with the model not downloaded', async () => {
  let warm = 0;
  const module = load(path.join(root, 'src/lib/local-semantic-assistant.native.ts'), {
    '@/lib/local-semantic-bundle': { LOCAL_ASSISTANT_PROTOTYPE_INDEX: {} },
    '@/lib/local-semantic-model': { chooseLocalSemanticAssistantPlan: async () => { throw new Error('must not run'); },
      createLocalSemanticRetriever: () => { throw new Error('must not run'); } },
    '@/lib/local-semantic-runtime': {
      localSemanticRuntimeStatus: () => ({ state: 'not-downloaded' }),
      getLocalSemanticEncoder: async () => { warm++; throw new Error('download'); },
    },
    '@/lib/local-semantic-flags': { LOCAL_SEMANTIC_E5_ENABLED: false },
  });
  const help = { tool: 'help' };
  const out = await module.improveAssistantRequestLocally({
    question: 'Give me a fiscal digest', deterministicRequest: help, defaultPeriod: { mode: 'all' }, currentPeriod: { mode: 'all' },
  });
  assert.equal(out, help);
  assert.equal(warm, 0, 'no download, no session');
});

test('Review shows no local-AI badge and runs no inference when E5 is off', async () => {
  let evaluated = 0;
  const { createLocalReviewAdvisor } = load(path.join(root, 'src/lib/local-semantic-review.ts'), {
    '@/lib/local-semantic-review-runtime': { evaluateLocalReviewWindow: async () => { evaluated++; return { kind: 'refused' }; } },
  });
  const advisor = createLocalReviewAdvisor(async () => { evaluated++; return { kind: 'refused' }; }, () => false);
  const missing = () => ({ value: null, evidence: 'missing', alternatives: [], spans: [], issues: [] });
  const event = { family: 'unknown', decision: 'review', status: 'posted', direction: 'debit', issues: [],
    amount: { ...missing(), evidence: 'explicit', value: { currency: 'AED', minorUnits: '4500', exponent: 2 } },
    merchant: missing(), balance: missing(), creditLimit: missing(), minimumDue: missing(), statementTotal: missing() };
  const item = { kind: 'universal', id: 'review_e5_off_0001', sourceKey: 'source_e5_off_01', observedAt: Date.now(),
    expiresAt: Date.now() + 60_000, event };
  await advisor.enqueue(item, event, 'movement <money>');
  assert.equal(advisor.get(item), null, 'no pending/unavailable badge');
  assert.equal(evaluated, 0);

  const shipped = fs.readFileSync(path.join(root, 'src/lib/local-semantic-review.ts'), 'utf8');
  assert.match(shipped, /createLocalReviewAdvisor\(evaluateLocalReviewWindow, \(\) => LOCAL_SEMANTIC_E5_ENABLED\)/);
});

test('the root layout warms E5 only behind the flag', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/app-root-layout.tsx'), 'utf8');
  const guard = source.indexOf('if (!LOCAL_SEMANTIC_E5_ENABLED || !active || !state.hydrated || warmStarted) return;');
  const warm = source.indexOf('getLocalSemanticEncoder({ background: true })');
  assert.ok(guard > 0, 'the warm-start effect returns early when E5 is disabled');
  assert.ok(warm > guard, 'the only encoder start sits after the guard');
  assert.equal(source.split('getLocalSemanticEncoder(').length - 1, 1, 'no other launch-time encoder start');
});

test('no shipping module other than the gated paths can start the E5 encoder', () => {
  const lib = path.join(root, 'src');
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name) && fs.readFileSync(full, 'utf8').includes('getLocalSemanticEncoder(')) {
        offenders.push(path.relative(root, full));
      }
    }
  };
  walk(lib);
  // Runtime defines it; the shadow/review paths call it only when the model is
  // already 'ready' (which never happens unless a gated path downloaded it).
  assert.deepEqual(offenders.sort(), [
    'src/components/app-root-layout.tsx',
    'src/lib/local-semantic-assistant.native.ts',
    'src/lib/local-semantic-review-runtime.ts',
    'src/lib/local-semantic-runtime.native.ts',
    'src/lib/local-semantic-runtime.ts',
    'src/lib/local-semantic-shadow.ts',
  ]);
  for (const file of ['src/lib/local-semantic-review-runtime.ts', 'src/lib/local-semantic-shadow.ts']) {
    assert.match(fs.readFileSync(path.join(root, file), 'utf8'), /localSemanticRuntimeStatus\(\)\.state !== 'ready'/, file);
  }
});
