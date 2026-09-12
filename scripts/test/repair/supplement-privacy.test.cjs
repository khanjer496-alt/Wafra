'use strict';
// Execute the actual component and its mount effects. Native storage and
// network services are explicit boundaries; no personal data or shared build.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { createWorkflowHarness, walk } = require('../workflows/workflow-harness.cjs');
const root = path.resolve(__dirname, '../../..');

for (const platform of ['ios', 'android']) {
  for (const language of ['en', 'ar']) {
    for (const privateMode of [true, false]) {
      test(`${platform}/${language}: existing cloud import respects saved local-only=${privateMode}`, async () => {
        const h = createWorkflowHarness({ platform, language, state: { privateMode } });
        const deps = h.deps;
        const effects = [];
        const requests = [];
        const config = { deviceId: 'fixture-device' };
        deps.react.useEffect = effect => effects.push(effect);
        deps['expo-clipboard'] = { getStringAsync: async () => '', setStringAsync: async () => {} };
        deps['expo-file-system'] = { File: class {} };
        deps['expo-haptics'] = {};
        deps['@/lib/capture-executor'] = { createCaptureExecutor: () => ({}) };
        deps['@/lib/cloud-import'] = {
          getImportCapabilities: async active => { requests.push(active); return {}; },
        };
        deps['@/lib/cloud-import-contract'] = { CloudImportError: class extends Error {} };
        deps['@/lib/relay'].getRelayConfig = async () => config;
        h.local('@/lib/supplement-copy', 'src/lib/supplement-copy.ts');

        const { SupplementImports } = load(path.join(root, 'src/components/supplement-imports.tsx'), deps);
        const tree = SupplementImports();
        const cleanups = effects.map(effect => effect());
        await new Promise(resolve => setImmediate(resolve));

        assert.deepEqual(requests, privateMode ? [] : [config],
          'reading saved credentials must not contact the import service when local-only is saved');
        assert.equal(h.state.privateMode, privateMode);
        assert.ok(!h.events.some(event => event[0] === 'setPrivateMode'),
          'mounting imports never opts the person into online features');

        if (privateMode) {
          const copy = deps['@/lib/supplement-copy'].SUPPLEMENT_COPY[language];
          const review = walk(tree).find(node => node.props?.accessibilityLabel === copy.reviewPrivacy);
          assert.ok(review, 'the blocked import includes a named preference recovery action');
          review.props.onPress();
          assert.deepEqual(h.events.filter(event => event[0] === 'route'), [['route', '/settings?section=privacy']]);
          assert.ok(!h.events.some(event => event[0] === 'setPrivateMode'),
            'review opens the disclosure without changing the saved choice');
        }
        for (const cleanup of cleanups) cleanup?.();
      });
    }
  }
}
